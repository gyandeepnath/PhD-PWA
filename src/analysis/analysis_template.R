# VisuLab — analysis template (R)
# ---------------------------------------------------------------------------
# Authoritative inference for the within-subjects design: linear mixed models
# with a random intercept per participant. Run after exporting the CSV bundle.
#
#   install.packages(c("tidyverse","lme4","lmerTest","afex","emmeans","performance"))
#
# Point DATA_DIR at the folder containing the exported CSVs.
# ---------------------------------------------------------------------------

library(tidyverse)
library(lme4)
library(lmerTest)   # p-values for lmer via Satterthwaite
library(emmeans)
library(performance)

DATA_DIR <- "."

# Photometry covariates (per session, in 01_session_info.csv): screen_white_luminance_cd_m2 and
# brightness_percent. With a single fixed device they are constant and can be ignored; across
# devices/brightness settings, join them in as a between-session covariate alongside log_contrast.
session_info <- read_csv(file.path(DATA_DIR, "01_session_info.csv"))

conditions  <- read_csv(file.path(DATA_DIR, "02_conditions.csv"))
fatigue     <- read_csv(file.path(DATA_DIR, "03_fatigue_scores.csv"))
comprehension <- read_csv(file.path(DATA_DIR, "04_comprehension.csv"))
rt_summary  <- read_csv(file.path(DATA_DIR, "09_rt_summary.csv"))
eye_metrics <- read_csv(file.path(DATA_DIR, "07_eye_metrics.csv"))
quality     <- read_csv(file.path(DATA_DIR, "12_quality_flags.csv"))  # engagement / careless-responding
wide        <- read_csv(file.path(DATA_DIR, "10_wide_summary.csv"))   # carries session_index per condition
participant <- read_csv(file.path(DATA_DIR, "11_participant.csv"))   # demographics + vision covariates
cvsq        <- read_csv(file.path(DATA_DIR, "13_cvsq.csv"))          # CVS-Q symptom questionnaire (per item)

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
  left_join(wide %>% select(condition_id, engagement_flag), by = "condition_id") %>%
  left_join(participant %>%
              select(participant_id, age, gender, daily_screen_hours, correction_type, cvd_status) %>%
              distinct(participant_id, .keep_all = TRUE),
            by = "participant_id") %>%
  # Session-level (whole-plot) columns: the illumination factor lives on the SESSION record, not
  # the condition record, so it must be joined in before it can enter the model.
  left_join(session_info %>% select(participant_id, session_index, ambient_illumination_level,
                                    illumination_block, illumination_order_first, lux_mean,
                                    lux_all_in_range),
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
m_fat <- lmer(
  as.formula(paste0("fatigue_mean ~ log_contrast + polarity + session_position", si_term, " + (1 | participant_id)")),
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

primary_structure <- "maximal: (1 + polarity | participant) + (1 | participant:sitting)"
fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 + polarity | participant_id)", re_sitting))))
if (is.null(fit$model) || isSingular(fit$model)) {
  primary_structure <- "reduction 1: (1 | participant) + (1 | participant:sitting)"
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

cat("\n################################################################\n")
cat("PRIMARY MODEL RANDOM STRUCTURE: ", primary_structure, "\n")
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
cat("\nThe polarity x colour interaction — Objective 2's crossover test:\n")
print(emmeans(m_primary, ~ colour | polarity))

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
  m_perclos <- lmer(as.formula(paste0("perclos_p80 ~ polarity", il_term,
                                      " + session_position + (1 | participant_id)")), data = eye)
  cat("\n=== PERCLOS P80 (drowsiness covariate) ===\n"); print(summary(m_perclos))
  # SENSITIVITY: re-fit the primary model with PERCLOS as a covariate. This is what separates
  # visual fatigue from plain sleepiness — PERCLOS is never an outcome here (§4.3: it is
  # insensitive in moderate drowsiness, so it serves only to adjust).
  m_primary_adj <- fit_binom(paste0("polarity * colour", ilx_term, " + session_position + perclos_p80"),
                             eye %>% filter(!is.na(perclos_p80)))
  cat("\n=== PRIMARY adjusted for PERCLOS (sensitivity) ===\n"); print(summary(m_primary_adj))
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
print(check_model(m_rt))
