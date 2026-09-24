# VisuLab — analysis template (R)
# ---------------------------------------------------------------------------
# Authoritative inference for the within-subjects design: linear mixed models
# with a random intercept per participant. Run after exporting the CSV bundle.
#
#   install.packages(c("tidyverse","lme4","lmerTest","emmeans","performance"))
#
# `afex` was listed here and is never loaded; `see` was NOT listed and check_model()
# hard-requires it. An analyst who installed exactly what this line named therefore
# hit "Package `see` required for model diagnostic plots" part-way through the run,
# after the primary model had been fitted and before the sections below it.
#
# Point DATA_DIR at the folder holding the exported CSVs, OR at a folder that
# CONTAINS one exported folder per participant. Both work — see read_export below.
# ---------------------------------------------------------------------------

library(tidyverse)
library(lme4)
library(lmerTest)   # p-values for lmer via Satterthwaite
library(emmeans)
library(performance)

# Edit this, or set VISULAB_DATA_DIR in the environment and leave it alone. The
# environment variable exists so that scripts/verifyAnalysis.mjs can point this file at a
# fixture export WITHOUT editing it — the gate then checks the bytes the analyst is
# actually given, rather than a copy of them that has been altered to be testable.
DATA_DIR <- Sys.getenv("VISULAB_DATA_DIR", unset = ".")

# ---------------------------------------------------------------------------
# Load one numbered export file, pooled across every participant folder found.
#
# The app exports ONE FOLDER PER SITTING. 130 participants is 130 folders, and this
# file used to read a single folder — so every model below was asked to fit
# `(1 | participant_id)` against one participant and stopped at
#
#     Error: grouping factors must have > 1 sampled level
#
# The documented instruction ("point DATA_DIR at the folder containing the exported
# CSVs") therefore described a run that cannot produce the thesis result, and the
# alternative was for the analyst to concatenate 130 folders by hand — which
# src/storage/analysisExport.ts calls out as "where analysis errors are actually
# introduced: a mis-sorted join, a participant counted twice, a sitting silently
# missing".
#
# Pooling here instead. DATA_DIR may be one exported folder or a parent of many;
# recursive = TRUE finds both, and a single folder still yields exactly one file, so
# the single-sitting case behaves as before.
#
# Types are read from the union of all files rather than guessed per file, because
# readr guesses column types from the first rows of EACH file independently: a
# column that is empty for participant 001 and numeric for 002 would otherwise be
# chr in one and dbl in the other, and bind_rows() would abort mid-load.
# ---------------------------------------------------------------------------
read_export <- function(name) {
  paths <- list.files(DATA_DIR, pattern = paste0("^", name, "$"),
                      full.names = TRUE, recursive = TRUE)
  if (length(paths) == 0) {
    stop(sprintf("no %s found under DATA_DIR (%s). Point DATA_DIR at an exported folder, or at a folder of them.",
                 name, normalizePath(DATA_DIR, mustWork = FALSE)))
  }
  parts <- lapply(paths, function(p) read_csv(p, col_types = cols(.default = col_character()),
                                              progress = FALSE))
  out <- bind_rows(parts)
  # Re-infer types ONCE, over the pooled frame, so every column is typed from all
  # the evidence rather than from whichever participant happened to be read first.
  out <- type_convert(out, col_types = cols(), na = c("", "NA"))
  attr(out, "n_folders") <- length(paths)
  out
}

# Photometry covariates (per session, in 01_session_info.csv): screen_white_luminance_cd_m2 and
# brightness_percent. With a single fixed device they are constant and can be ignored; across
# devices/brightness settings, join them in as a between-session covariate alongside log_contrast.
session_info <- read_export("01_session_info.csv")

conditions  <- read_export("02_conditions.csv")
fatigue     <- read_export("03_fatigue_scores.csv")
comprehension <- read_export("04_comprehension.csv")
rt_summary  <- read_export("09_rt_summary.csv")
eye_metrics <- read_export("07_eye_metrics.csv")
quality     <- read_export("12_quality_flags.csv")  # engagement / careless-responding
wide        <- read_export("10_wide_summary.csv")   # carries session_index per condition
participant <- read_export("11_participant.csv")   # demographics + vision covariates
cvsq        <- read_export("13_cvsq.csv")          # CVS-Q symptom questionnaire (per item)

# --- UNFINISHED CONDITION-RUNS ARE NOT MEASUREMENTS ------------------------------------------
# A condition that was started and not finished — paused, crashed, or abandoned part-way — leaves
# real but partial rows in every per-condition file. The Pause dialog tells the operator it "will be
# restarted on resume"; if the sitting never was, the rows stay. Until condition_complete existed,
# nothing in this bundle said which runs had finished, and this template modelled them all.
# Removed here, ONCE, at the source — from every per-condition table before any join — so that no
# model further down can pick one up by a route nobody thought of. Not a sensitivity choice: a run
# that did not end is not a measurement of its condition. Exports older than the column carry no
# unfinished runs to drop, and are passed through unchanged.
if ("condition_complete" %in% names(conditions)) {
  unfinished_ids <- conditions$condition_id[!is.na(conditions$condition_complete) &
                                              !as.logical(conditions$condition_complete)]
  cat("\nunfinished condition-runs removed before modelling (paused or interrupted):",
      length(unfinished_ids), "\n")
  drop_unfinished <- function(d) {
    if ("condition_id" %in% names(d)) d[!(d$condition_id %in% unfinished_ids), , drop = FALSE] else d
  }
  conditions    <- drop_unfinished(conditions)
  fatigue       <- drop_unfinished(fatigue)
  comprehension <- drop_unfinished(comprehension)
  rt_summary    <- drop_unfinished(rt_summary)
  eye_metrics   <- drop_unfinished(eye_metrics)
  quality       <- drop_unfinished(quality)
  wide          <- drop_unfinished(wide)
}

# --- Quality control: optionally exclude disengaged conditions -----------------------------
# Boredom/disengagement over the long session mimics fatigue and adds noise. The engagement
# flag (good/warn/bad) lets you run a sensitivity analysis: fit models on the full set AND on the
# clean subset (drop "bad"); if conclusions agree, disengagement is not driving the result.
DROP_DISENGAGED <- TRUE   # set FALSE to keep every condition
clean_ids <- quality %>% filter(engagement_flag != "bad") %>% select(participant_id, condition_label)

# --- Build a per-condition modelling frame -------------------------------------------------
# Contrast (WCAG ratio), session_position (0-9 fatigue accumulation) and session_index (sitting
# number for split sessions) are recorded as covariates; log-transform contrast.
# JOIN ON condition_id, NEVER on participant_id + condition_label.
#
# Each participant runs all ten condition labels in EACH illumination block, so "P1" occurs twice
# per participant on both sides of a label join: 2 x 2 = four rows per condition, half of them
# carrying the wrong sitting and therefore the wrong illumination level. The illumination main
# effect — the whole-plot factor — is then attenuated toward zero while n is inflated fourfold and
# every standard error halves: a false negative with false precision, on the study's headline
# contrast. 02_conditions.csv now carries session_id and session_index, and 10_wide_summary.csv
# carries condition_id, so the key path exists.
#
# The participant table is one row per EXPORT, i.e. per sitting, and its mutable covariates can
# differ between them, so it is de-duplicated before joining rather than silently multiplying rows.
cond <- conditions %>%
  # fatigue_delta rides along here because it lives in 10_wide_summary.csv and nowhere
  # else: ANALYSIS_PLAN.md §4 specifies it as the fatigue response, but this join pulled
  # only engagement_flag, so the specified response was unreachable and the model
  # silently fitted fatigue_mean instead.
  left_join(wide %>% select(condition_id, engagement_flag, fatigue_delta), by = "condition_id") %>%
  # The careless-responding signals of §5.5, joined PER CONDITION.
  #
  # This could not be done before: 12_quality_flags.csv carried only participant_id +
  # condition_label + session_index, and joining on a label is what the note at the top of this file
  # warns against because labels repeat across sittings. The flags were therefore reportable only as
  # study-wide counts, which answers "how often did this happen" and not "was THIS condition for THIS
  # participant rushed" — the question §5.5 actually asks. The export now carries condition_id in
  # that file, so the join is the same safe one every other table uses.
  left_join(quality %>% select(condition_id, careless_straight_lined, careless_rushed_fatigue,
                               careless_rushed_perception, low_face_presence, reading_skim),
            by = "condition_id") %>%
  left_join(participant %>%
              select(participant_id, age, gender, daily_screen_hours, correction_type, cvd_status) %>%
              distinct(participant_id, .keep_all = TRUE),
            by = "participant_id") %>%
  # Session-level (whole-plot) columns: the illumination factor lives on the SESSION record, not
  # the condition record, so it must be joined in before it can enter the model.
  left_join(session_info %>% select(participant_id, session_index, ambient_illumination_level,
                                    illumination_block, illumination_order_first, lux_mean,
                                    # lux_logged_all_in_range, NOT lux_all_in_range. The bare name
                                    # exists — in analysis_long.csv, a different export product —
                                    # and this file reads the numbered bundle, where the exporter
                                    # renames it deliberately: it reports only on readings actually
                                    # TAKEN, so it must be read together with lux_complete. Selecting
                                    # the wrong one raised "Column `lux_all_in_range` doesn't exist"
                                    # at this join, and nothing below it had ever run.
                                    lux_complete, lux_logged_all_in_range,
                                    session_status, session_complete),
            by = c("participant_id", "session_index")) %>%
  mutate(
    log_contrast = log10(wcag_contrast_ratio),
    polarity = factor(polarity, levels = c("positive", "negative")),
    # Text colour is a FIVE-level factor with the same levels in both polarities. Achromatic is a
    # single level (not "black" and "white"), which is what makes polarity x colour estimable.
    colour = factor(color_name, levels = c("achromatic", "blue", "red", "yellow", "green")),
    # Ambient illumination: the session-level (whole-plot) factor.
    illumination = droplevels(factor(ambient_illumination_level, levels = c("dim", "moderate"))),
    below_aa = as.integer(below_wcag_aa),
    session_index = ifelse(is.na(session_index), 1L, session_index)
  )

# ---------------------------------------------------------------------------
# SUM-TO-ZERO CODING for the two crossed design factors. docs/ANALYSIS_PLAN.md §2:
# "polarity_c — sum-to-zero coded (+/-0.5). With an interaction present, a dummy-coded
# main effect is the simple effect at the other factor's reference level rather than
# an average effect. This is not a stylistic preference; it changes what the
# coefficient means."
#
# This file used R's default treatment contrasts, so the `polarity` row of
# summary(m_primary) was the polarity effect IN ACHROMATIC TEXT ONLY — a duplicate of
# the achromatic anchor model fitted separately further down precisely because that is
# the matched-contrast special case. The plan states H1's falsification rule on that
# coefficient, so the study's headline hypothesis was being adjudicated against an
# estimand the plan did not specify.
#
# COLOUR is sum-coded too, and that is the part that does the work: a main effect of
# polarity averages over the other factor only when the other factor is sum-coded.
# contr.sum(2)/2 gives exactly the +/-0.5 the plan names (positive +0.5, negative -0.5).
# emmeans is invariant to the coding, so every marginal-mean section below is unchanged.
# ---------------------------------------------------------------------------
contrasts(cond$polarity) <- contr.sum(nlevels(cond$polarity)) / 2
contrasts(cond$colour)   <- contr.sum(nlevels(cond$colour))
cat("\ncontrast coding — polarity:", paste(levels(cond$polarity), collapse = " / "),
    "as sum-to-zero +/-0.5; colour: sum-to-zero over",
    nlevels(cond$colour), "levels. Main effects are AVERAGE effects, not simple effects.\n")
if (DROP_DISENGAGED) cond <- cond %>% filter(is.na(engagement_flag) | engagement_flag != "bad")
# When all data come from single sittings, session_index is constant — drop it from the formula
# automatically to avoid a rank-deficient fit.
USE_SESSION_INDEX <- length(unique(cond$session_index)) > 1
si_term <- if (USE_SESSION_INDEX) " + session_index" else ""

# Ambient illumination is a SINGLE level under the current protocol (300 lux throughout), so it
# cannot enter any model: a one-level factor is aliased with the intercept, and R either drops it
# rank-deficiently or — for illumination_order_first, which arrives as a character column — errors
# outright with "contrasts can be applied only to factors with 2 or more levels".
#
# Detected from the data rather than assumed, exactly as session_index is above, so this file still
# analyses earlier TWO-LEVEL data unchanged and needs no flag set by hand.
USE_ILLUMINATION <- length(unique(na.omit(cond$ambient_illumination_level))) > 1
il_term  <- if (USE_ILLUMINATION) " + illumination" else ""
ilx_term <- if (USE_ILLUMINATION) " * illumination" else ""
ord_term <- if (USE_ILLUMINATION) " + illumination_order_first" else ""
# The sitting stratum is only a stratum when there is more than one sitting.
re_sitting <- if (USE_SESSION_INDEX) " + (1 | participant_id:session_index)" else ""
if (!USE_ILLUMINATION) cat(paste0(
  "\n[PROTOCOL NOTE] One ambient illumination level in this dataset, so every illumination term is\n",
  "omitted and NO illumination effect is estimable. This is the protocol, not a fault in the data.\n",
  "See docs/ILLUMINATION_AMENDMENT.md.\n"))

rt <- rt_summary %>%
  left_join(cond, by = c("participant_id", "condition_id")) %>%
  filter(!is.na(mean_rt_hits_ms))

# --- Reaction time: contrast, polarity, fatigue accumulation -------------------------------
# Random intercept per participant absorbs individual differences.
m_rt <- lmer(
  as.formula(paste0("mean_rt_hits_ms ~ log_contrast + polarity + session_position", si_term, " + (1 | participant_id)")),
  data = rt
)
cat("\n=== RT mixed model ===\n"); print(summary(m_rt))
cat("\nMarginal means by polarity:\n"); print(emmeans(m_rt, ~ polarity))

# --- Subjective fatigue (post-condition VAS composite) -------------------------------------
fat <- fatigue %>%
  filter(stage == "post_condition") %>%
  left_join(cond, by = c("participant_id", "condition_id"))
# docs/ANALYSIS_PLAN.md §4 specifies `fatigue_delta`: "Change from the participant's own
# baseline removes between-person scale use. Use `fatigue_mean` only if baselines are
# missing." This fitted fatigue_mean unconditionally, carrying every participant's
# scale-use bias into the residual. The fallback is kept — and announced, so a run that
# silently lacked baselines cannot be mistaken for the specified analysis.
fat_response <- if ("fatigue_delta" %in% names(fat) && any(!is.na(fat$fatigue_delta))) {
  "fatigue_delta"
} else {
  cat("\n[fatigue] fatigue_delta unavailable — falling back to fatigue_mean, which ANALYSIS_PLAN.md §4 permits only when baselines are missing.\n")
  "fatigue_mean"
}
cat("\n[fatigue] response:", fat_response, "\n")
m_fat <- lmer(
  as.formula(paste0(fat_response, " ~ log_contrast + polarity + session_position", si_term, " + (1 | participant_id)")),
  data = fat
)
cat("\n=== Fatigue mixed model ===\n"); print(summary(m_fat))

# --- Comprehension accuracy (logistic mixed model) -----------------------------------------
comp <- comprehension %>% left_join(cond, by = c("participant_id", "condition_id"))
# (1 | participant_id/condition_id), not (1 | participant_id) alone.
#
# 04_comprehension.csv is one row per ITEM, three per condition, and the three share a passage, a
# display condition and a single reading episode. Without a condition-level random effect they are
# treated as conditionally independent — textbook pseudo-replication, which inflates the test
# statistic for every CONDITION-level predictor (polarity, contrast, illumination) because the
# effective N is roughly three times too large. illumination and question_kind are entered too;
# the model previously omitted the whole-plot factor entirely.
m_comp <- glmer(
  as.formula(paste0("is_correct ~ log_contrast + polarity", ilx_term, " + question_kind + session_position",
                    si_term, " + (1 | participant_id/condition_id)")),
  data = comp, family = binomial
)
cat("\n=== Comprehension logistic mixed model ===\n"); print(summary(m_comp))

# --- d-prime: aggregate ACROSS conditions per participant (per-condition d' is unstable) ----
dprime_overall <- rt_summary %>%
  group_by(participant_id) %>%
  summarise(mean_dprime = mean(d_prime, na.rm = TRUE),
            any_unstable = any(d_prime_unstable, na.rm = TRUE))
cat("\n=== Aggregated d' per participant ===\n"); print(dprime_overall)


# --- Ocular fatigue (interpret per the codebook; gate duration tiers on effective_fps) -----
# CVS markers: blink_rate (expected to DROP with screen concentration) and incomplete_blink_ratio
# (expected to RISE — the marker that correlates with CVS symptoms; Portello & Rosenfield 2013).
# Drowsiness covariate: perclos_p80. Blink rate is non-monotonic, so model the set, not rate alone.
eye <- eye_metrics %>% left_join(cond, by = c("participant_id", "condition_id")) %>% filter(camera_active == 1)

# ===========================================================================================
# QUALITY CHECKS — ANALYSIS_PLAN.md §5, "These are not optional and they come first."
#
# They were not implemented. §5.2 (frame rate) was, and is further down; §5.1 selected the lux
# columns and never used them; §5.3, §5.4 and §5.5 appeared nowhere in this file at all. The
# consequence is one-directional: conditions where the face left frame, or where the camera saw only
# part of the exposure, entered the primary fit at full weight, and every one of those dilutes a
# real polarity or colour effect toward null.
#
# NOTHING IS DROPPED HERE. These are checks, and §5.2 states the reason in general terms: frame rate
# covaries with ambient illumination, so dropping flagged rows deletes data non-randomly with
# respect to a factor. The panel reports, sets `qc_clean`, and a single sensitivity refit at the end
# of the primary section shows whether the conclusion depends on the flagged rows.
#
# ON THRESHOLDS. Only ONE of these numbers comes from the protocol: face_presence_ratio >= 0.90 is
# the pilot gate stated in the codebook entry for that column. The other two are ANALYST DEFAULTS.
# They are named here, at the top, so they can be changed deliberately and so that no one can mistake
# them for pre-registered values. The distributions are printed beside each count so the choice is an
# informed one rather than an inherited one.
# ===========================================================================================
QC_FACE_PRESENCE_MIN <- 0.90   # PROTOCOL: codebook, face_presence_ratio — "pilot gate: >= 0.90".
QC_OFF_AXIS_MAX      <- 0.20   # ANALYST DEFAULT — not in the protocol. Change deliberately.
QC_EXPOSURE_MIN_FRAC <- 0.90   # ANALYST DEFAULT — not in the protocol. Fraction of reading_time_ms
                               # the camera must actually have observed.

# The remaining numeric thresholds this file applies, named here rather than buried as bare literals
# at their use sites. Three of the QC bounds above were already labelled with their provenance and
# these four were not, which is an inconsistency in this file's own standard: a number that decides
# how a result is read has to say where it came from, or nobody can defend it or reproduce it.
DISPERSION_REFIT_AT  <- 1.5     # PROTOCOL: ANALYSIS_PLAN.md §2 — "if the dispersion statistic
                                # exceeds ~1.5, refit with glmmTMB(..., family = betabinomial)".
CENSOR_SPREAD_WARN_PP <- 10     # ANALYST DEFAULT — not in the protocol. Percentage points of spread
                                # in the visual-search censoring rate ACROSS CONDITIONS beyond which
                                # the time model must not be read unqualified. Any non-zero spread is
                                # a problem in principle; this is the point at which it stops being
                                # arguably negligible.
COMPLETION_INFORMATIVE <- c(0.05, 0.95)  # ANALYST DEFAULT — not in the protocol. Outside this band
                                # the completion outcome is near-constant and carries little
                                # information, so the time model is the better instrument.
PERCLOS_LOGIT_SQUEEZE <- 5e-4   # ANALYST DEFAULT — not in the protocol. Exact 0 and 1 have no logit,
                                # so endpoints are moved inward by this much. The count of values
                                # moved is REPORTED, because silently relocating data is how a
                                # bounded outcome quietly becomes a different one.

cat("\n\n==========================================================================\n")
cat("QUALITY CHECKS (ANALYSIS_PLAN.md §5) — reported before any inference\n")
cat("==========================================================================\n")

qc_pct <- function(n, d) if (d > 0) sprintf("%d/%d (%.1f%%)", n, d, 100 * n / d) else "0/0"
qc_rng <- function(x) {
  x <- x[is.finite(x)]
  if (!length(x)) return("no finite values")
  sprintf("median %.3f, range %.3f-%.3f", median(x), min(x), max(x))
}

# --- §5.1 Did the illumination CONTROL hold? -------------------------------------------
# A constancy check, not a separation check: the design holds illuminance fixed, so the reading
# should be a tight cluster and a sitting outside 250-350 lux is a protocol deviation.
sess_qc <- eye %>% distinct(participant_id, session_index, .keep_all = TRUE)
cat("\n5.1 illumination constancy\n")
cat("    lux_mean across sittings:      ", qc_rng(sess_qc$lux_mean), "\n")
# The accepted band is NOT re-derived here. It lives in src/experiment/illumination.ts (min 250,
# max 350 for the level this protocol uses) and the app writes its own verdict into
# lux_logged_all_in_range. This file used to hardcode 250 and 350 as bare literals, which duplicates
# an app constant so the two can drift — and this project has already been bitten by exactly that,
# when an end-to-end helper's hardcoded lux literal silently put every test out of range after the
# protocol retargeted its illuminance to 300. Reading the flag cannot drift. The observed range is
# printed above so a reader can still see where the readings actually sat.
cat("    a LOGGED reading out of band:  ",
    qc_pct(sum(!sess_qc$lux_logged_all_in_range, na.rm = TRUE), nrow(sess_qc)),
    " (the app's own verdict; says nothing about readings NEVER TAKEN)\n")
cat("    lux_complete FALSE:            ", qc_pct(sum(!sess_qc$lux_complete, na.rm = TRUE), nrow(sess_qc)),
    " (read the two together: a sitting can be in band on the readings it took and still be missing two)\n")

# --- §5.2 pointer ----------------------------------------------------------------------
cat("\n5.2 frame-rate adequacy — reported with the primary model below, where the plan's\n")
cat("    with-and-without refit is run. Not repeated here.\n")

# --- §5.3 Was the participant present? -------------------------------------------------
low_presence <- with(eye, is.finite(face_presence_ratio) & face_presence_ratio < QC_FACE_PRESENCE_MIN)
high_offaxis <- with(eye, is.finite(off_axis_ratio) & off_axis_ratio > QC_OFF_AXIS_MAX)
cat("\n5.3 participant present\n")
cat("    face_presence_ratio:           ", qc_rng(eye$face_presence_ratio), "\n")
cat("    below the", QC_FACE_PRESENCE_MIN, "protocol gate:   ", qc_pct(sum(low_presence), nrow(eye)), "\n")
cat("    off_axis_ratio:                ", qc_rng(eye$off_axis_ratio), "\n")
cat("    above", QC_OFF_AXIS_MAX, "(ANALYST DEFAULT):  ", qc_pct(sum(high_offaxis), nrow(eye)), "\n")

# --- §5.4 Was the exposure complete? ---------------------------------------------------
# The dangerous one: when the camera stops part-way, every RATE in the row still looks entirely
# normal, because a rate divides by the time actually observed. Only this comparison shows it.
eye$observed_frac <- with(eye, ifelse(is.finite(observed_duration_ms) & is.finite(reading_time_ms) & reading_time_ms > 0,
                                      observed_duration_ms / reading_time_ms, NA_real_))
short_exposure <- with(eye, is.finite(observed_frac) & observed_frac < QC_EXPOSURE_MIN_FRAC)
cat("\n5.4 exposure completeness (observed_duration_ms / reading_time_ms)\n")
cat("    observed fraction:             ", qc_rng(eye$observed_frac), "\n")
cat("    below", QC_EXPOSURE_MIN_FRAC, "(ANALYST DEFAULT):  ", qc_pct(sum(short_exposure), nrow(eye)), "\n")
cat("    not computable (a duration missing):", qc_pct(sum(is.na(eye$observed_frac)), nrow(eye)), "\n")

# --- §5.5 Careless responding ----------------------------------------------------------
# Now joined per condition rather than counted study-wide, because the export carries condition_id in
# 12_quality_flags.csv. The distinction matters: a study-wide rate says how often careless responding
# happened, and a per-row flag says WHICH rows it happened in — which is the only form that can enter
# a sensitivity analysis or be crossed with the design factors.
cat("\n5.5 careless responding (joined per condition on condition_id)\n")
careless_flags <- c("careless_straight_lined", "careless_rushed_fatigue", "careless_rushed_perception")
present_flags <- careless_flags[careless_flags %in% names(eye)]
for (flag in present_flags) {
  cat("   ", format(flag, width = 30), qc_pct(sum(eye[[flag]] %in% c(TRUE, "true"), na.rm = TRUE), nrow(eye)), "\n")
}
if (length(present_flags) == 0) {
  cat("    none of the careless-responding columns reached the modelling frame — check the join.\n")
}
# Crossed with the design, because careless responding that clusters in one condition is a
# property of that condition rather than of those participants.
if (length(present_flags) > 0) {
  eye$any_careless <- Reduce(`|`, lapply(present_flags, function(f) eye[[f]] %in% c(TRUE, "true")))
  by_pol <- eye %>% group_by(polarity) %>%
    summarise(pct = round(100 * mean(any_careless, na.rm = TRUE), 1), .groups = "drop")
  cat("    any careless flag, by polarity:",
      paste(by_pol$polarity, paste0(by_pol$pct, "%"), sep = "=", collapse = ", "), "\n")
}

# --- §1 complete case ------------------------------------------------------------------
cat("\n1.  completeness of sittings\n")
cat("    session_complete FALSE:        ", qc_pct(sum(!sess_qc$session_complete, na.rm = TRUE), nrow(sess_qc)), "\n")
if ("session_status" %in% names(sess_qc)) {
  st <- table(sess_qc$session_status, useNA = "ifany")
  cat("    session_status:                ", paste(names(st), as.integer(st), sep = "=", collapse = ", "), "\n")
}

# --- the combined flag -----------------------------------------------------------------
eye$qc_clean <- !(low_presence | high_offaxis | short_exposure)
cat("\nrows failing at least one §5 check:", qc_pct(sum(!eye$qc_clean), nrow(eye)),
    "- RETAINED. The sensitivity refit below reports the conclusion with and without them.\n")
cat("==========================================================================\n")

# ===========================================================================================
# CONFIRMATORY ANALYSIS — the PRIMARY outcome (synopsis §3.9)
#
# Outcome: incomplete_blink_ratio during reading, per condition. A BOUNDED PROPORTION, so it is
# modelled on the logit scale (or as a beta/binomial mixed model) — never as an untransformed
# linear outcome, which would permit predictions outside [0,1] and assume constant variance where
# variance is in fact smallest near the bounds.
#
# Random structure follows the SPLIT-PLOT design: a participant intercept, plus a session
# intercept nested within participant, because ambient illumination is manipulated BETWEEN
# sessions while polarity and colour vary within. Omitting the nested session term treats the two
# sessions as exchangeable observations and understates the standard error on illumination.
#
# If a maximal structure fails to converge, reduce in this PRE-SPECIFIED order and report it:
#   1. drop the random slope for polarity
#   2. drop the session intercept
# ===========================================================================================
# The primary outcome is a BINOMIAL PROPORTION, and is modelled as one.
#
# incomplete_blink_ratio = incomplete / (incomplete + full + micro), and that denominator varies
# from a handful of blinks to several dozen. A Gaussian model of the naked proportion gives a ratio
# from 8 blinks exactly the weight of one from 60, and the earlier logit transform made it worse: a
# fixed epsilon mapped EVERY zero-incomplete condition to logit(0.001) = -6.91 regardless of whether
# it rested on 8 blinks or 40, creating high-leverage points concentrated wherever blink capture is
# thin — which, per the codebook's own note on fps_adequate_for_ratio, covaries with ambient
# illumination. That is a leverage pattern aligned with the whole-plot factor.
#
# The counts are now exported, so the model takes them directly.
eye <- eye %>% mutate(
  blink_total = blink_count_incomplete + blink_count_full + blink_count_micro,
  eff_fps_c   = as.numeric(scale(effective_fps, scale = FALSE))
) %>% filter(!is.na(blink_total), blink_total > 0)

# effective_fps enters as a covariate because undersampling biases the measured minimum EAR upward
# and so inflates the ratio — a DIRECTIONAL bias, and one that covaries with ambient illumination.
# Without it a camera artefact is indistinguishable from the illumination effect being tested.
# passage_repeat_number was the PERIOD term, for when every passage was re-read in a second sitting.
# Under the single-sitting protocol each of the ten passages is read exactly ONCE, so the column is
# constant at 1 and is omitted with the illumination terms rather than left to alias silently.
rep_term <- if (length(unique(na.omit(eye$passage_repeat_number))) > 1) " + passage_repeat_number" else ""

# The binomial response, defined ONCE. Five secondary models below used to name a variable
# `ibr_logit` that no part of this file ever created — a leftover from the fixed-epsilon logit
# approach that the note above the mutate explains was abandoned. They now share this response.
RESP <- "cbind(blink_count_incomplete, blink_count_full + blink_count_micro)"
f_primary <- as.formula(paste0(
  RESP, " ~ polarity * colour", ilx_term, " + session_position", ord_term, rep_term, " + eff_fps_c"))

# Fit maximal, then reduce in the PRE-SPECIFIED order. Warnings are RECORDED, not used to discard a
# fitted model: a `boundary (singular) fit` on a random slope is routine, and treating it as failure
# silently walked the model all the way down to (1 | participant_id) — which drops the sitting
# stratum entirely and tests the whole-plot factor against within-sitting residual df. That
# understates the standard error on illumination by roughly the square root of the number of
# conditions per sitting, and can turn a null into p < 0.05.
fit_noting <- function(formula) {
  notes <- character(0)
  m <- withCallingHandlers(
    tryCatch(glmer(formula, data = eye, family = binomial), error = function(e) NULL),
    warning = function(w) { notes <<- c(notes, conditionMessage(w)); invokeRestart("muffleWarning") }
  )
  list(model = m, notes = notes)
}

# Secondary models share the primary response. Written as a helper rather than repeated, because
# repeating it is how five of them came to name a variable that did not exist.
fit_binom <- function(rhs, data, extra_re = re_sitting) {
  glmer(as.formula(paste0(RESP, " ~ ", rhs, " + (1 | participant_id)", extra_re)),
        data = data, family = binomial,
        control = glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 2e5)))
}

# ANALYSIS_PLAN.md §2 prescribes a passage intercept: "passage is decoupled from condition by
# design, so it can carry its own intercept and is not confounded with the display factors." It
# appeared nowhere in this file, while §5b asserted that a passage effect "loads onto the residual
# in the Python fit and not in the R one" — a safeguard the documentation claimed and the code did
# not have. Because passage is decoupled from condition it does not bias the display coefficients;
# what it does is leave passage variance in the residual, and in a binomial GLMM unmodelled cluster
# structure surfaces as overdispersion, i.e. as understated standard errors on the condition-level
# terms actually being tested.
#
# It is carried through every rung of the ladder rather than being the first thing dropped, because
# the plan's pre-specified reduction order is about the PARTICIPANT structure (drop the polarity
# slope, then the sitting intercept) and says nothing about passage. A dataset with too few distinct
# passages to support it is handled at the end, loudly, the same way reduction 2 is.
re_passage <- if (length(unique(na.omit(eye$passage_id))) > 1) " + (1 | passage_id)" else ""
if (!nzchar(re_passage)) {
  cat("\nNOTE: fewer than two distinct passage_id values — the (1 | passage_id) intercept that\n")
  cat("      ANALYSIS_PLAN.md §2 prescribes cannot be fitted and passage variance stays in the residual.\n")
}

primary_structure <- "maximal: (1 + polarity | participant) + (1 | participant:sitting) + (1 | passage)"
fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 + polarity | participant_id)", re_sitting, re_passage))))
if (is.null(fit$model) || isSingular(fit$model)) {
  primary_structure <- "reduction 1: (1 | participant) + (1 | participant:sitting) + (1 | passage)"
  fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 | participant_id)", re_sitting, re_passage))))
}
if (is.null(fit$model) && nzchar(re_passage)) {
  # The passage intercept is prescribed, so it is dropped only when keeping it prevents a fit at
  # all — and then it is said out loud, because §5b's claim that R fits it stops being true here.
  primary_structure <- "reduction 1b: (1 | participant) + (1 | participant:sitting) - NO PASSAGE INTERCEPT"
  cat("\nNOTE: the model would not fit with (1 | passage_id); it has been dropped and passage\n")
  cat("      variance now loads onto the residual.\n")
  fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 | participant_id)", re_sitting))))
}
if (is.null(fit$model)) {
  # Reduction 2 removes the SITTING stratum, so the illumination contrast is no longer tested
  # against the right unit of replication. It is reported loudly, at the top of the output, and any
  # illumination inference drawn from it has to be labelled accordingly.
  primary_structure <- "reduction 2: (1 | participant) ONLY - NO SITTING STRATUM, ILLUMINATION INFERENCE IS NOT VALID"
  fit <- fit_noting(update(f_primary, . ~ . + (1 | participant_id)))
}
m_primary <- fit$model
stopifnot(!is.null(m_primary))

# ---------------------------------------------------------------------------
# OVERDISPERSION. ANALYSIS_PLAN.md §2: "Overdispersion must be checked. Blinks within a
# condition are not independent Bernoulli trials; if the dispersion statistic exceeds
# ~1.5, refit with glmmTMB(..., family = betabinomial)."
#
# It was never checked here. Blink classification within one condition is serially
# correlated, so dispersion above 1 is the expectation rather than a worry — and an
# unadjusted binomial GLMM then understates every standard error on the primary outcome,
# which inflates significance on exactly the polarity x colour interaction the study is
# built to test. Note the asymmetry this created with the Python cross-check: its GEE
# carries robust sandwich standard errors and is protected, so the two files could
# disagree on significance for a purely mechanical reason while the plan requires them
# to agree on it.
#
# Reported, never applied silently: refitting as beta-binomial changes the model the
# thesis reports, and that is the investigator's call to make deliberately.
# ---------------------------------------------------------------------------
dispersion_note <- tryCatch({
  od <- performance::check_overdispersion(m_primary)
  ratio <- as.numeric(od$dispersion_ratio)
  cat("\n=== OVERDISPERSION CHECK (ANALYSIS_PLAN.md §2) ===\n")
  print(od)
  if (is.finite(ratio) && ratio > DISPERSION_REFIT_AT) {
    cat("\n*** dispersion ratio ", round(ratio, 2), " EXCEEDS ", DISPERSION_REFIT_AT, ".\n",
        "*** The plan requires a refit as glmmTMB(..., family = betabinomial) before\n",
        "*** any inference is drawn from the standard errors below.\n", sep = "")
    sprintf("OVERDISPERSED (ratio %.2f) — betabinomial refit required", ratio)
  } else {
    sprintf("dispersion ratio %.2f, within tolerance", ratio)
  }
}, error = function(e) paste("overdispersion check could not be computed:", conditionMessage(e)))

cat("\n################################################################\n")
cat("PRIMARY MODEL RANDOM STRUCTURE: ", primary_structure, "\n")
cat("PRIMARY MODEL DISPERSION:       ", dispersion_note, "\n")
if (length(fit$notes)) cat("fit notes:\n  ", paste(fit$notes, collapse = "\n  "), "\n")
cat("################################################################\n")

# The frame-rate confound, made visible before any inference is drawn from the model above.
cat("\nframe-rate adequacy by illumination (the primary outcome's known directional bias):\n")
print(table(eye$illumination, eye$fps_adequate_for_ratio))

# Pre-specified sensitivity refit on adequately-sampled conditions only. If the illumination effect
# only exists in the flagged subset, it is a camera artefact.
if (any(eye$fps_adequate_for_ratio)) {
  m_primary_fps <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 | participant_id)", re_sitting))))$model
  eye_ok <- eye %>% filter(fps_adequate_for_ratio)
  if (nrow(eye_ok) > 0) {
    m_fps_ok <- tryCatch(glmer(update(f_primary, as.formula(paste0(". ~ . + (1 | participant_id)", re_sitting))),
                               data = eye_ok, family = binomial), error = function(e) NULL)
    if (!is.null(m_fps_ok)) {
      cat("\n=== PRIMARY refit on fps_adequate_for_ratio conditions only (sensitivity) ===\n")
      print(summary(m_fps_ok))
    }
  }
}

# ===========================================================================================
# KEY SECONDARY: CVS-Q change, contrasted across the illumination levels.
#
# This was read at the top of the file and then never modelled. 13_cvsq.csv now carries
# session_index and ambient_illumination_level, so the paired change is attributable to a sitting —
# which is the entire reason for administering it twice.
#
# IMPORTANT, and see docs/LITERATURE_VALIDATION.md: the baseline and closing administrations use
# DIFFERENT recall frames (`frame` column). The baseline carries the validated habitual frame; the
# close is re-anchored to the session. A baseline-to-close difference is therefore a difference
# between two different questions, and the CVS-Q's own validation is built on the score being stable
# over 7-15 days. Report this as exploratory.
# ===========================================================================================
cvsq_change <- cvsq %>%
  select(participant_id, session_index, ambient_illumination_level, stage, total_score) %>%
  tidyr::pivot_wider(names_from = stage, values_from = total_score) %>%
  filter(!is.na(baseline), !is.na(session_end)) %>%
  mutate(change = session_end - baseline,
         illumination = factor(ambient_illumination_level))

# The baseline-to-close CHANGE is the key secondary outcome and is estimable with one illumination
# level; only the between-level contrast is gone. Modelling it unconditionally, rather than skipping
# the whole block, is the difference between a reduced analysis and a silently absent one.
if (nrow(cvsq_change) > 0) {
  cat("\n=== KEY SECONDARY (EXPLORATORY): CVS-Q baseline-to-close change ===\n")
  cat("NOTE: baseline and close use different recall frames; see LITERATURE_VALIDATION.md.\n")
  if (dplyr::n_distinct(cvsq_change$illumination) > 1) {
    print(summary(lmer(change ~ illumination + (1 | participant_id), data = cvsq_change)))
  } else {
    cat("One illumination level: reporting the change itself, with no between-level contrast.\n")
    print(summary(cvsq_change$change))
    cat(sprintf("mean change = %.2f (n = %d)\n", mean(cvsq_change$change), nrow(cvsq_change)))
  }
} else {
  cat("\n[CVS-Q change not modelled: needs BOTH stages present]\n")
}
cat("\n=== PRIMARY: incomplete-blink ratio, logit scale, split-plot random structure ===\n")
print(summary(m_primary))
cat("\nMarginal means (back-transformed to the proportion scale):\n")
if (USE_ILLUMINATION) {
  print(emmeans(m_primary, ~ polarity | illumination, type = "response"))
} else {
  print(emmeans(m_primary, ~ polarity, type = "response"))
}
# OMNIBUS TEST of the interaction, before any marginal means are read.
#
# This section previously printed emmeans(~ colour | polarity) under the heading "the polarity x
# colour interaction", and that call returns estimated marginal MEANS — not a contrast, not a test
# statistic, and no p-value. The interaction was therefore never formally tested: all that existed
# were the four separate Wald z's in summary(m_primary), with no omnibus test over them and no
# multiplicity handling across the four.
#
# A likelihood-ratio test against the additive model is the test. It is ONE statistic for the whole
# interaction, which is the question Objective 2 asks — does the polarity effect depend on colour —
# rather than four separate questions about individual cells.
#
# The degrees of freedom are read from the printed table and NOT stated here. A full 2 x 5 crossing
# gives 4, but lme4 drops aliased columns from a rank-deficient design and reports the df it
# actually used; a heading asserting 4 would then be describing a test that was not run.
cat("\n=== OMNIBUS TEST: does the polarity effect depend on colour? (likelihood-ratio test) ===\n")
cat("    Degrees of freedom are in the Df column below. If it is under 4, the design matrix was\n")
cat("    rank deficient and lme4 dropped aliased column(s) — check why before interpreting.\n")
# The formula is kept on a line of its own. tests/analysisTemplates.test.ts harvests model terms
# from any line carrying a `~`, so a tryCatch handler sharing that line contributes `e` and `NULL`
# to the term list and the check reports two undefined symbols that are not model terms at all.
m_additive <- tryCatch(
  update(m_primary, . ~ . - polarity:colour),
  error = function(err) NULL
)
if (is.null(m_additive)) {
  cat("the additive model did not fit, so the interaction could not be tested by LRT.\n")
} else {
  print(anova(m_additive, m_primary))
  cat("\nRead the p-value on the second row: it tests the interaction AS A WHOLE. The per-cell\n")
  cat("contrasts below describe the shape of an interaction; they do not establish that there is one.\n")
}

cat("\nThe polarity x colour interaction — Objective 2's crossover test:\n")
# type = 'response' so these print as proportions. They were printed on the log-odds scale under a
# heading that said 'back-transformed', because this one call omitted it.
print(emmeans(m_primary, ~ colour | polarity, type = "response"))

# --- The contrast-matched anchor: the ONE clean test of polarity ----------------------------
# Black-on-white and white-on-black are both 21:1, so this contrast varies polarity with
# luminance contrast held constant. A polarity effect here cannot be attributed to contrast.
ach <- eye %>% filter(colour == "achromatic")
if (nrow(ach) > 0 && length(unique(ach$polarity)) == 2) {
  m_anchor <- fit_binom(paste0("polarity", ilx_term, " + session_position"), ach)
  cat("\n=== Achromatic anchor: polarity at matched 21:1 contrast ===\n"); print(summary(m_anchor))
}

# --- OBJECTIVE 2: is colour a proxy for luminance contrast, or is there residual hue? -------
# Two nested families are compared. If contrast does the work, the residual hue terms shrink and
# the parsimonious model is not meaningfully worse.
m_colour_cat <- fit_binom(paste0("polarity * colour", il_term, " + session_position"), eye)
m_contrast   <- fit_binom(paste0("polarity + log_contrast", il_term, " + session_position"), eye)
m_both       <- fit_binom(paste0("polarity + log_contrast + colour", il_term, " + session_position"), eye)
cat("\n=== Objective 2: contrast vs residual hue (binomial GLMMs, nested comparison) ===\n")
print(anova(m_contrast, m_both, m_colour_cat))
cat("\nResidual hue terms beyond contrast (small => colour is largely a contrast proxy):\n")
print(summary(m_both)$coefficients)

# --- Secondary ocular measures --------------------------------------------------------------
m_blink <- lmer(as.formula(paste0("blink_rate ~ polarity * colour", il_term,
                                  " + session_position + (1 | participant_id)")), data = eye)
cat("\n=== Blink-rate mixed model (secondary) ===\n"); print(summary(m_blink))
if (any(!is.na(eye$perclos_p80))) {
  # ANALYSIS_PLAN.md §4, PERCLOS row: "LMM on logit. Bounded; do not model raw."
  # It was fitted raw — the same error this file's own note correctly rejects for the
  # primary outcome, repeated on the secondary one. PERCLOS is a proportion of time with
  # no trial count behind it, so there is no binomial to fall back on and the logit is
  # what the plan asks for. Exact 0 and 1 have no logit, so they are squeezed inward by
  # half of the smallest non-zero spacing the measure can express; the squeeze is applied
  # to the ENDPOINTS ONLY and reported, because silently moving data is how a bounded
  # outcome quietly becomes a different one.
  eye_pc <- eye %>% filter(!is.na(perclos_p80))
  n_squeezed <- sum(eye_pc$perclos_p80 <= 0 | eye_pc$perclos_p80 >= 1)
  if (n_squeezed > 0) cat("\n[perclos] ", n_squeezed, " value(s) at 0 or 1 squeezed inward for the logit.\n")
  eye_pc$perclos_logit <- qlogis(pmin(pmax(eye_pc$perclos_p80, PERCLOS_LOGIT_SQUEEZE),
                                      1 - PERCLOS_LOGIT_SQUEEZE))
  m_perclos <- lmer(as.formula(paste0("perclos_logit ~ polarity", il_term,
                                      " + session_position + (1 | participant_id)")), data = eye_pc)
  cat("\n=== PERCLOS P80 (drowsiness covariate) ===\n"); print(summary(m_perclos))
  # SENSITIVITY: re-fit the primary model with PERCLOS as a covariate. This is what separates
  # visual fatigue from plain sleepiness — PERCLOS is never an outcome here (§4.3: it is
  # insensitive in moderate drowsiness, so it serves only to adjust).
  m_primary_adj <- fit_binom(paste0("polarity * colour", ilx_term, " + session_position + perclos_p80"),
                             eye %>% filter(!is.na(perclos_p80)))
  cat("\n=== PRIMARY adjusted for PERCLOS (sensitivity) ===\n"); print(summary(m_primary_adj))

# ===========================================================================================
# SECONDARY OUTCOMES from ANALYSIS_PLAN.md §4 that this file did not model at all.
#
# Four of the seven rows of that table were missing: reading speed, visual search, sensitivity
# (d-prime was averaged descriptively, never modelled) and response bias. They are pre-registered
# outcomes, so their absence is not a stylistic gap — an analyst running this file produced a
# thesis with four of its own stated outcomes unanalysed.
# ===========================================================================================

# --- Reading speed (§4: LMM) -------------------------------------------------------------
# "Check against observed_duration_ms first — a truncated exposure produces a normal-looking
# speed." That check is §5.4 above, which computes observed_frac; it is reported here beside the
# model rather than left for the reader to connect.
if ("reading_speed_wpm" %in% names(eye) && sum(is.finite(eye$reading_speed_wpm)) > 0) {
  cat("\n=== Reading speed (secondary, §4) ===\n")
  cat("exposure completeness on these rows: ", qc_rng(eye$observed_frac), "\n")
  m_wpm <- tryCatch(
    lmer(as.formula(paste0("reading_speed_wpm ~ polarity * colour", ilx_term,
                           " + session_position + (1 | participant_id)", re_sitting)),
         data = eye),
    error = function(err) NULL
  )
  if (is.null(m_wpm)) cat("the reading-speed model did not fit.\n") else print(summary(m_wpm))
} else {
  cat("\n[reading speed] reading_speed_wpm carries no finite values — not modelled.\n")
}

# --- Response bias and sensitivity (§4: LMM each) -----------------------------------------
# §4 is explicit about why these are separate: "A polarity effect on `criterion` WITHOUT one on
# `d_prime` is a bias shift, not a sensitivity change. Worth reporting as a distinct finding rather
# than folding into 'RT performance'." Folding them in is exactly what this file did.
if ("criterion" %in% names(rt) && sum(is.finite(rt$criterion)) > 0) {
  cat("\n=== Response bias: criterion (secondary, §4) ===\n")
  m_crit <- tryCatch(
    lmer(as.formula(paste0("criterion ~ polarity * colour", ilx_term,
                           " + session_position + (1 | participant_id)", re_sitting)),
         data = rt),
    error = function(err) NULL
  )
  if (is.null(m_crit)) cat("the criterion model did not fit.\n") else print(summary(m_crit))
}

# §4 on d-prime: "With 20 go and 12 no-go trials, one block's d' is imprecise. Check `d_prime_se`
# and consider weighting." Weighted by inverse variance, so an imprecise block carries the weight it
# has earned rather than the same weight as a precise one. Unstable blocks are reported, not dropped.
if ("d_prime" %in% names(rt) && sum(is.finite(rt$d_prime)) > 0) {
  cat("\n=== Sensitivity: d-prime, inverse-variance weighted (secondary, §4) ===\n")
  dp <- rt %>% filter(is.finite(d_prime))
  n_unstable <- sum(dp$d_prime_unstable %in% c(TRUE, "true"), na.rm = TRUE)
  cat("blocks flagged d_prime_unstable: ", qc_pct(n_unstable, nrow(dp)), " - RETAINED\n")
  usable_se <- with(dp, is.finite(d_prime_se) & d_prime_se > 0)
  if (all(usable_se)) {
    dp$dp_w <- 1 / dp$d_prime_se^2
    cat("weights: 1 / d_prime_se^2\n")
  } else {
    dp$dp_w <- 1
    cat("d_prime_se is missing or zero on ", qc_pct(sum(!usable_se), nrow(dp)),
        " of blocks, so the fit is UNWEIGHTED. §4 asks for weighting to be considered; it could not be applied here.\n")
  }
  m_dp <- tryCatch(
    lmer(as.formula(paste0("d_prime ~ polarity * colour", ilx_term,
                           " + session_position + (1 | participant_id)", re_sitting)),
         data = dp, weights = dp$dp_w),
    error = function(err) NULL
  )
  if (is.null(m_dp)) cat("the d-prime model did not fit.\n") else print(summary(m_dp))
}

# --- Visual search (§4: LMM, censored) ----------------------------------------------------
# §4: "`search_termination` says whether the block ended by completion or by the 40 s cap. Capped
# rows are a lower bound; treating them as measurements biases the mean downward. Either model them
# as censored or report the completion rate alongside."
#
# TWO THINGS TO STATE PLAINLY. The column is called `termination_mode` in the export, not
# `search_termination` — the plan named a column that does not exist, which is the same defect class
# that stopped this whole file running. And the second of the plan's two permitted options is taken:
# the completion rate is reported beside an uncensored fit. A genuinely censored LMM needs a package
# this template does not carry, and adding a dependency silently is worse than saying which option
# was used. The fit below is therefore BIASED DOWNWARD to the extent that rows hit the cap, and the
# completion rate is the number that says how much.
search <- tryCatch(read_export("05_visual_search.csv"), error = function(err) NULL)
if (!is.null(search) && "search_time_ms" %in% names(search)) {
  vs <- search %>% left_join(cond, by = c("participant_id", "condition_id")) %>%
    filter(is.finite(search_time_ms))
  cat("\n=== Visual search (secondary, §4) ===\n")
  if ("termination_mode" %in% names(vs)) {
    tm <- table(vs$termination_mode, useNA = "ifany")
    cat("termination_mode: ", paste(names(tm), as.integer(tm), sep = "=", collapse = ", "), "\n")
    capped <- sum(vs$termination_mode == "time_limit", na.rm = TRUE)
    cat("blocks ending at the time limit (right-censored): ", qc_pct(capped, nrow(vs)), "\n")
    cat("the model below is UNCENSORED, so its mean is biased DOWNWARD by that fraction.\n")
  } else {
    cat("termination_mode absent — the censoring rate cannot be reported for this export.\n")
  }
  # -----------------------------------------------------------------------------------------
  # CENSORING BY CONDITION. This is the part that decides whether the time model means anything.
  #
  # A uniform censoring rate biases every condition's mean downward by roughly the same amount, and
  # a comparison BETWEEN conditions partly survives it. A rate that VARIES by condition does not:
  # if low-contrast or dark-polarity blocks hit the cap more often, then the conditions are censored
  # unequally, and the difference in mean search time is partly a difference in how often the clock
  # ran out. That bias points the same way as the hypothesis, which is the worst possible direction.
  #
  # So the rate is broken out by polarity and colour before any coefficient is read.
  # -----------------------------------------------------------------------------------------
  if ("termination_mode" %in% names(vs)) {
    vs$capped <- vs$termination_mode == "time_limit"
    vs$completed <- vs$termination_mode == "voluntary_full"
    cat("\ncensoring rate by condition (the number that decides whether the time model is usable):\n")
    by_cond <- vs %>%
      group_by(polarity, colour) %>%
      # n_capped, NOT capped: summarise() evaluates its arguments in order and in the same scope, so
      # naming the count `capped` replaced the logical column before the next line averaged it —
      # mean() then returned the COUNT and every rate printed as 1200%.
      summarise(n = dplyr::n(),
                n_capped = sum(capped, na.rm = TRUE),
                pct_capped = round(100 * mean(capped, na.rm = TRUE), 1),
                pct_completed = round(100 * mean(completed, na.rm = TRUE), 1),
                .groups = "drop")
    print(as.data.frame(by_cond))
    spread_pct <- diff(range(by_cond$pct_capped))
    cat("\nspread in censoring across conditions:", round(spread_pct, 1), "percentage points\n")
    if (is.finite(spread_pct) && spread_pct > CENSOR_SPREAD_WARN_PP) {
      cat("*** The censoring rate differs by more than 10 points between conditions. The mean search\n")
      cat("*** time is then partly a measure of how often the clock ran out, and that bias runs WITH\n")
      cat("*** the hypothesis. Use the completion model below as the primary search outcome, or fit\n")
      cat("*** a properly censored model, before drawing any conclusion from the times.\n")
    }

    # COMPLETION AS AN OUTCOME IN ITS OWN RIGHT — "did they find every target inside the window?"
    #
    # This is immune to the censoring problem by construction: it uses the fact that the clock ran
    # out rather than pretending a time was measured. It is a binomial proportion, the same family
    # as the primary outcome. It is LESS powerful than a clean time measure, because someone who
    # finished in 10 s and someone who finished at 59 s both count as a success — so it is reported
    # beside the time model, not instead of it, and which one is primary depends on the censoring
    # rate printed above.
    #
    # It is also only informative if it VARIES. If nearly everyone completes, or nearly no one does,
    # there is almost nothing to model and the time measure is the better instrument.
    cat("\n=== Visual search: completed within the window (binomial, censoring-immune) ===\n")
    rate <- mean(vs$completed, na.rm = TRUE)
    cat("overall completion rate:", round(100 * rate, 1), "%\n")
    if (!is.finite(rate) || rate < COMPLETION_INFORMATIVE[1] || rate > COMPLETION_INFORMATIVE[2]) {
      cat("completion is near-constant at this cap, so it carries little information — read the time\n")
      cat("model instead, and note the cap in the limitations.\n")
    } else {
      m_vs_done <- tryCatch(
        glmer(as.formula(paste0("completed ~ polarity * colour", ilx_term,
                                " + session_position + (1 | participant_id)", re_sitting)),
              data = vs, family = binomial),
        error = function(err) NULL
      )
      if (is.null(m_vs_done)) cat("the completion model did not fit.\n") else print(summary(m_vs_done))
    }
  }

  cat("\n=== Visual search: time, UNCENSORED (read the censoring table above first) ===\n")
  m_vs <- tryCatch(
    lmer(as.formula(paste0("search_time_ms ~ polarity * colour", ilx_term,
                           " + session_position + (1 | participant_id)", re_sitting)),
         data = vs),
    error = function(err) NULL
  )
  if (is.null(m_vs)) cat("the visual-search model did not fit.\n") else print(summary(m_vs))
} else {
  cat("\n[visual search] 05_visual_search.csv not found or carries no search_time_ms.\n")
}
}

# --- NASA-TLX: SESSION-level workload -------------------------------------------------------
# Administered once per session, so it supports inference about the ILLUMINATION contrast only.
# Polarity and colour vary within a session and cannot be attributed a single end-of-session
# rating — do not model them here (§4.3).
tlx_path <- file.path(DATA_DIR, "14_nasa_tlx.csv")
if (file.exists(tlx_path)) {
  tlx <- read_csv(tlx_path) %>%
    mutate(illumination = factor(ambient_illumination_level, levels = c("dim", "moderate")))
  if (nrow(tlx) > 0 && length(unique(tlx$illumination)) > 1) {
    m_tlx <- lmer(raw_tlx ~ illumination + (1 | participant_id), data = tlx)
    cat("\n=== NASA-TLX raw score by illumination (session level) ===\n"); print(summary(m_tlx))
    print(emmeans(m_tlx, ~ illumination))
  } else if (nrow(tlx) > 0) {
    # Previously this skipped in TOTAL SILENCE. With one illumination level and one rating per
    # participant there is no within-participant contrast of any kind, so the descriptive summary
    # is the whole of what NASA-TLX supports here — and saying so beats printing nothing.
    cat("\n=== NASA-TLX raw score (session level, descriptive) ===\n")
    cat("One rating per participant and one illumination level: no contrast is estimable.\n")
    print(summary(tlx$raw_tlx))
  } else {
    cat("\n[NASA-TLX not summarised: the file is present but empty]\n")
  }
}

# --- Assumption checks ---------------------------------------------------------------------
cat("\n=== RT model assumption checks ===\n")
# Diagnostic PLOTS, and optional by nature: they are looked at, never inferred from.
# An unavailable plotting package must not end a run that has already produced the
# pre-registered inference. `see` is a hard requirement of check_model() and is not
# part of this template's install line, so the common case is that it is absent.
if (requireNamespace("see", quietly = TRUE)) {
  print(check_model(m_rt))
} else {
  cat("\n[diagnostics] install.packages(\"see\") for check_model() plots — skipped, not run.\n")
}
