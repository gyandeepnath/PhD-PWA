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
# Point DATA_DIR at a folder that CONTAINS one exported folder per sitting (the
# per-session "Export" bundles) AND the pooled analysis export (Dashboard -> "Download
# analysis dataset": analysis_long.csv, analysis_join_report.csv, ...), in any
# sub-folder. The per-sitting folders carry the data; analysis_join_report.csv carries
# the exporter's verdict on which participants may be analysed, and this file applies
# that verdict rather than re-deriving a second one. See "WHICH ROWS ARE MODELLED".
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
#
# `with_folder = TRUE` adds `sitting_folder`, the folder each row was read from. One exported folder
# is one sitting, so the folder is the one key that ties a row of 01_session_info.csv (which carries
# no session_id) to the condition rows of the same sitting without going through session_index —
# which the analysis codebook warns is not unique within a participant. It is added only where it is
# used, so it does not ride into every join and come back suffixed .x/.y.
read_export <- function(name, with_folder = FALSE) {
  paths <- list.files(DATA_DIR, pattern = paste0("^", name, "$"),
                      full.names = TRUE, recursive = TRUE)
  if (length(paths) == 0) {
    stop(sprintf("no %s found under DATA_DIR (%s). Point DATA_DIR at an exported folder, or at a folder of them.",
                 name, normalizePath(DATA_DIR, mustWork = FALSE)))
  }
  parts <- lapply(paths, function(p) {
    d <- read_csv(p, col_types = cols(.default = col_character()), progress = FALSE)
    if (with_folder) d$sitting_folder <- rep(dirname(p), nrow(d))
    d
  })
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
session_info <- read_export("01_session_info.csv", with_folder = TRUE)

conditions  <- read_export("02_conditions.csv", with_folder = TRUE)
fatigue     <- read_export("03_fatigue_scores.csv")
comprehension <- read_export("04_comprehension.csv")
rt_summary  <- read_export("09_rt_summary.csv")
eye_metrics <- read_export("07_eye_metrics.csv")
quality     <- read_export("12_quality_flags.csv")  # engagement / careless-responding
wide        <- read_export("10_wide_summary.csv")   # carries session_index per condition
participant <- read_export("11_participant.csv", with_folder = TRUE)   # demographics + vision covariates
cvsq        <- read_export("13_cvsq.csv", with_folder = TRUE)          # CVS-Q symptom questionnaire (per item)

# --- A SITTING EXPORTED TWICE STOPS THE RUN --------------------------------------------------
# The loader pools every folder it finds, so the same sitting copied into two folders (two exports
# of one session, or a folder duplicated while organising) is read twice. Nothing downstream can
# tell: the joins on condition_id fan out many-to-many with only a dplyr warning, and the models
# fitted RT, fatigue and comprehension on 419 rows where there were 109 before the CVS-Q pivot
# crashed. Stopped here, before any row is counted, naming the folders.
dup_cid <- unique(conditions$condition_id[duplicated(conditions$condition_id)])
if (length(dup_cid) > 0) {
  where <- unique(conditions$sitting_folder[conditions$condition_id %in% dup_cid[1]])
  stop(sprintf(paste0("[DUPLICATED EXPORT] %d condition_id value(s) occur more than once under DATA_DIR ",
                      "(e.g. %s, in: %s). The same sitting has been exported into more than one folder, ",
                      "so every row of it would be counted twice. Remove the duplicate folder and run again."),
               length(dup_cid), dup_cid[1], paste(where, collapse = " AND ")), call. = FALSE)
}
folder_sessions <- conditions %>% distinct(sitting_folder, session_id)
if (anyDuplicated(folder_sessions$sitting_folder)) {
  stop("[MIXED FOLDER] one folder holds condition rows from more than one session_id: ",
       folder_sessions$sitting_folder[duplicated(folder_sessions$sitting_folder)][1],
       ". Each exported folder is one sitting; keep the files of different sittings apart.", call. = FALSE)
}

# ===========================================================================================
# WHICH ROWS ARE MODELLED: THE EXPORTER'S VERDICT, APPLIED — NOT A SECOND ONE MADE HERE
#
# This file used to drop withdrawn participants and unfinished runs and nothing else, while the
# exporter's join check (src/storage/joinIntegrity.ts) also marks as NOT analysable:
#   - a participant without a complete condition set (ANALYSIS_PLAN.md §1: the confirmatory
#     analysis is complete-case);
#   - a sitting run under the end-to-end test harness (e2e_timing), whose own integrity report says
#     "Do not pool it with collected data";
#   - a sitting blocked by its per-sitting integrity audit — duplicate ids, orphan rows, a summary
#     that disagrees with its trials, ocular data with no camera consent behind it;
#   - repeated or ambiguous sittings, mixed builds within a participant, an unattributable session.
# On a cohort where three participants had abandoned their sittings part-way, this file fitted 108
# rows from all twelve; an e2e test session was modelled as a participant. The dashboard's cohort
# tab claimed meanwhile that the analysis models analysable rows only. It does now.
#
# analysis_join_report.csv is the verdict, one row per participant: whether they are analysable,
# and the codes of every issue that excluded them. It is read, never recomputed, so the exporter,
# the dashboard, this file and the Python cross-check cannot come to four different conclusions.
#
# CONFIRMATORY SET (every model): analysable, not withdrawn, not a test-harness sitting, the
# participant's first protocol pass (protocol_pass 0; blank on sittings recorded before the column
# existed, which were all first passes), and this condition-run finished.
#
# SENSITIVITY SET (one refit of the primary): the confirmatory set PLUS the finished runs of
# participants excluded ONLY because their condition set is incomplete — the analysis §1 calls
# "reasonable and should be reported as such". Nothing excluded for any other reason enters it:
# integrity faults, missing consent, test sessions and repeat passes are not completeness questions.
# ===========================================================================================
COMPLETENESS_CODES <- c("condition_incomplete", "condition_coverage", "incomplete_split_sitting",
                        "incomplete_crossover", "sitting_not_in_data_dir")

verdict_paths <- list.files(DATA_DIR, pattern = "^analysis_join_report\\.csv$", full.names = TRUE, recursive = TRUE)
if (length(verdict_paths) == 0) {
  stop(paste0("[NO VERDICT] analysis_join_report.csv was not found under DATA_DIR (",
              normalizePath(DATA_DIR, mustWork = FALSE), "). Which participants may be analysed is decided ",
              "by the exporter's join check, not by this file. Take the pooled export (Dashboard -> ",
              "'Download analysis dataset') from the same tablet and put its folder inside DATA_DIR beside ",
              "the per-sitting folders."), call. = FALSE)
}
if (length(verdict_paths) > 1) {
  stop("[TWO VERDICTS] more than one analysis_join_report.csv under DATA_DIR (",
       paste(verdict_paths, collapse = " AND "), "). Keep only the pooled export taken after the last ",
       "sitting was collected.", call. = FALSE)
}
as_flag <- function(x) !is.na(x) & toupper(trimws(as.character(x))) %in% c("TRUE", "1")
verdict <- read_csv(verdict_paths, col_types = cols(.default = col_character()), progress = FALSE) %>%
  transmute(participant_key = participant_id, session_id = session_ids,
            p_analysable = as_flag(analysable), excluded_by = coalesce(excluded_by, "")) %>%
  tidyr::separate_rows(session_id, sep = ";")

# Session-level facts, per FOLDER. Older exports lack a column: it is then read as absent (FALSE / 0).
for (col in c("withdrawn", "e2e_timing", "protocol_pass")) {
  if (!col %in% names(session_info)) session_info[[col]] <- NA
}
sitting_flags <- session_info %>%
  transmute(sitting_folder,
            sitting_withdrawn = as_flag(withdrawn),
            test_harness = as_flag(e2e_timing),
            repeat_pass = coalesce(suppressWarnings(as.numeric(protocol_pass)), 0) > 0)
# A withdrawal applies to the PARTICIPANT: every sitting of theirs goes, not only the one it was
# recorded on — as the pooled export's join check (participant_withdrawn) has always done.
wd_pids <- unique(session_info$participant_id[as_flag(session_info$withdrawn)])
if (!"condition_complete" %in% names(conditions)) conditions$condition_complete <- NA
present_sessions <- unique(conditions$session_id)
# A participant the verdict lists with a sitting that has no condition rows here: their data under
# DATA_DIR is not the data the verdict was given. Not complete-case, whatever the verdict said.
short_keys <- unique(verdict$participant_key[!(verdict$session_id %in% present_sessions)])

runs <- conditions %>%
  select(condition_id, participant_id, session_id, sitting_folder, condition_complete) %>%
  left_join(sitting_flags, by = "sitting_folder") %>%
  left_join(verdict, by = "session_id") %>%
  mutate(finished = is.na(condition_complete) | as_flag(condition_complete),
         has_verdict = !is.na(p_analysable),
         p_withdrawn = participant_id %in% wd_pids,
         short = !is.na(participant_key) & participant_key %in% short_keys)
runs$reasons <- Map(
  function(codes, fin, wd, e2e, rep, hv, short) unique(c(
    codes[nzchar(codes)],
    if (!fin) "run_unfinished",
    if (wd) "participant_withdrawn",
    if (isTRUE(e2e)) "audit_e2e_timing",
    if (isTRUE(rep)) "protocol_pass_repeat",
    if (!hv) "no_verdict_for_sitting",
    if (short) "sitting_not_in_data_dir")),
  strsplit(coalesce(runs$excluded_by, ""), ";", fixed = TRUE),
  runs$finished, runs$p_withdrawn, runs$test_harness, runs$repeat_pass, runs$has_verdict, runs$short)
runs$confirmatory <- lengths(runs$reasons) == 0
runs$sensitivity <- vapply(runs$reasons, function(r) all(r %in% COMPLETENESS_CODES), logical(1))

cat("\n==========================================================================\n")
cat("WHICH ROWS ARE MODELLED — the exporter's verdict (", basename(verdict_paths), ")\n", sep = "")
cat("==========================================================================\n")
cat("condition-runs under DATA_DIR:", nrow(runs), "from", n_distinct(runs$participant_id), "participant(s)\n")
cat("withdrawn participants removed before modelling:", length(wd_pids), "\n")
cat("unfinished condition-runs removed before modelling (paused or interrupted):", sum(!runs$finished), "\n")
reason_long <- tibble(participant_id = rep(runs$participant_id, lengths(runs$reasons)),
                      reason = unlist(runs$reasons))
if (nrow(reason_long) > 0) {
  cat("\nexclusion reasons (a run can carry several; a participant-level code applies to every run of\n")
  cat("that participant; run_unfinished is the run itself):\n")
  reason_tab <- reason_long %>% group_by(reason) %>%
    summarise(condition_runs = n(), participants = n_distinct(participant_id), .groups = "drop") %>%
    arrange(desc(condition_runs), reason)
  for (i in seq_len(nrow(reason_tab))) {
    cat(sprintf("  [exclusion] %-34s %5d condition-run(s)  %4d participant(s)\n",
                reason_tab$reason[i], reason_tab$condition_runs[i], reason_tab$participants[i]))
  }
} else {
  cat("no condition-run is excluded.\n")
}
cat(sprintf("\nCONFIRMATORY SET: %d condition-runs from %d participants\n",
            sum(runs$confirmatory), n_distinct(runs$participant_id[runs$confirmatory])))
cat(sprintf("SENSITIVITY SET:  %d condition-runs from %d participants (adds finished runs of participants\n",
            sum(runs$sensitivity), n_distinct(runs$participant_id[runs$sensitivity])))
cat("                  excluded only for an incomplete condition set; ANALYSIS_PLAN.md §1)\n")

# The untrimmed tables are kept for the ONE sensitivity refit; every other model sees only the
# confirmatory set, trimmed here once, at the source, from every table before any join, so no model
# further down can pick up an excluded row by a route nobody thought of.
sens_ids <- runs$condition_id[runs$sensitivity]
sens_folders <- unique(runs$sitting_folder[runs$sensitivity])
conditions_all <- conditions; eye_metrics_all <- eye_metrics; wide_all <- wide; quality_all <- quality
session_info_all <- session_info; participant_all <- participant
keep_ids <- runs$condition_id[runs$confirmatory]
keep_folders <- unique(runs$sitting_folder[runs$confirmatory])
keep_rows <- function(d) {
  if ("condition_id" %in% names(d)) d[d$condition_id %in% keep_ids, , drop = FALSE] else d
}
conditions    <- keep_rows(conditions)
fatigue       <- keep_rows(fatigue)
comprehension <- keep_rows(comprehension)
rt_summary    <- keep_rows(rt_summary)
eye_metrics   <- keep_rows(eye_metrics)
quality       <- keep_rows(quality)
wide          <- keep_rows(wide)
# Session-level tables follow their sitting: a folder with no confirmatory run contributes nothing.
session_info  <- session_info[session_info$sitting_folder %in% keep_folders, , drop = FALSE]
participant   <- participant[participant$sitting_folder %in% keep_folders, , drop = FALSE]
cvsq          <- cvsq[cvsq$sitting_folder %in% keep_folders, , drop = FALSE]

# --- WHAT THE CONFIRMATORY SET CAN SUPPORT, checked before any model is fitted ----------------
# Each of these used to surface as an lme4 or contrasts error deep in the run — "grouping factors
# must have > 1 sampled level", "contrasts can be applied only to factors with 2 or more levels" —
# after some output had printed and with nothing naming the cause. A dataset in either state cannot
# answer the study's question, so the run stops here and says why.
n_participants <- n_distinct(conditions$participant_id)
if (n_participants < 2) {
  stop(sprintf(paste0("[TOO FEW PARTICIPANTS] the confirmatory set holds %d participant(s). A random ",
                      "intercept per participant needs at least two, and a population claim many more. ",
                      "See the exclusion counts above for who was left out and why."), n_participants),
       call. = FALSE)
}
if (n_distinct(na.omit(conditions$polarity)) < 2) {
  stop(paste0("[ONE POLARITY] every confirmatory condition-run has polarity '",
              paste(unique(na.omit(conditions$polarity)), collapse = "', '"),
              "'. The study's question is the CONTRAST between polarities, which this data cannot ",
              "estimate. Check the condition table and the exclusions above."), call. = FALSE)
}
SMALL_N_WARN <- 20   # ANALYST DEFAULT — not in the protocol. Below this many participants every
                     # standard error and p-value below rests on few clusters, and the variance
                     # components behind them are poorly estimated; read them as provisional.
if (n_participants < SMALL_N_WARN) {
  cat(sprintf(paste0("\n[SMALL N] %d participants in the confirmatory set (fewer than %d, an ANALYST DEFAULT).\n",
                     "          Standard errors, p-values and the random-effect variances rest on few clusters;\n",
                     "          treat every inferential result below as provisional.\n"), n_participants, SMALL_N_WARN))
}

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
# Written as a function because the SENSITIVITY refit of the primary needs the identical frame built
# from the untrimmed tables; two copies of this pipeline would drift apart.
build_cond <- function(conditions, wide, quality, participant, session_info) {
  d <- conditions %>%
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
    # Session-level columns: the illumination level lives on the SESSION record, not the condition
    # record, so it must be joined in before it can enter the model.
    #
    # Joined on the FOLDER the two rows were read from — one exported folder is one sitting — and not on
    # participant_id + session_index: 01_session_info.csv carries no session_id, and session_index is
    # not unique within a participant when a sitting was binned while a later one started (see the
    # analysis codebook). session_index itself comes from 02_conditions.csv.
    left_join(session_info %>% select(sitting_folder, ambient_illumination_level,
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
              by = "sitting_folder") %>%
    mutate(
      log_contrast = log10(wcag_contrast_ratio),
      polarity = factor(polarity, levels = c("positive", "negative")),
      # Text colour is a FIVE-level factor with the same levels in both polarities. Achromatic is a
      # single level (not "black" and "white"), which is what makes polarity x colour estimable.
      colour = factor(color_name, levels = c("achromatic", "blue", "red", "yellow", "green")),
      # Ambient illumination: a session-level factor in archived two-level data; constant now.
      illumination = droplevels(factor(ambient_illumination_level, levels = c("dim", "moderate"))),
      below_aa = as.integer(below_wcag_aa),
      # session_index is NOT filled in where it is missing. This used to read
      # ifelse(is.na(session_index), 1L, session_index), relabelling a sitting of unknown index as
      # sitting 1 — which assigns it whatever sitting 1's covariates are — while the Python template
      # deliberately refused to do the same, so the two toolchains modelled different data. A missing
      # index is counted below, and a model with a sitting term reports the rows it dropped.
      passage_id = factor(passage_id)
    )
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
  # Set inside build_cond so the sensitivity frame is coded identically.
  contrasts(d$polarity) <- contr.sum(nlevels(d$polarity)) / 2
  contrasts(d$colour)   <- contr.sum(nlevels(d$colour))
  d
}
cond <- build_cond(conditions, wide, quality, participant, session_info)
cat("\ncontrast coding — polarity:", paste(levels(cond$polarity), collapse = " / "),
    "as sum-to-zero +/-0.5; colour: sum-to-zero over",
    nlevels(cond$colour), "levels. Main effects are AVERAGE effects, not simple effects.\n")

n_si_missing <- sum(is.na(cond$session_index))
if (n_si_missing > 0) {
  cat("\n[session_index] ", n_si_missing, " confirmatory condition-run(s) carry no session_index. They are NOT\n",
      "relabelled sitting 1. A model with a sitting term drops them; its [n] line says how many rows it used.\n", sep = "")
}
# The sitting term exists only when more than one sitting index occurs: a split sitting, or archived
# two-level data. NA is not a level — counting it as one put a sitting term into a single-sitting
# dataset and silently dropped every row whose index was missing.
USE_SESSION_INDEX <- n_distinct(na.omit(cond$session_index)) > 1
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
# The sitting intercept is a stratum only when there is more than one sitting.
re_sitting <- if (USE_SESSION_INDEX) " + (1 | participant_id:session_index)" else ""
if (!USE_ILLUMINATION) cat(paste0(
  "\n[PROTOCOL NOTE] One ambient illumination level in this dataset, so every illumination term is\n",
  "omitted and NO illumination effect is estimable. This is the protocol, not a fault in the data.\n",
  "See docs/ILLUMINATION_AMENDMENT.md.\n"))

# --- PASSAGE, IN EVERY MODEL --------------------------------------------------------------------
# ANALYSIS_PLAN.md §2: passage is NOT balanced against condition. The rotation makes passage uniform
# against serial position, not against condition, and against POLARITY the imbalance grows with
# recruitment: tabulated from blockPlan, balanced at N = 10, a largest per-passage positive/negative
# gap of 6 at N = 20 and 30 at N = 130, where passages 2-4 are read 80:50 under positive polarity and
# 7-9 50:80. Whatever makes a passage harder therefore loads onto the polarity contrast in any model
# that leaves passage out — and only the primary carried it. The comprehension, reading-speed,
# search, blink-rate, anchor and Objective-2 models did not, while an earlier comment here said
# passage was "decoupled from condition", which the plan has retracted.
#
# A random intercept, as in the primary. It is a nuisance term in every model; where a dataset has
# a single passage it is omitted and that is said.
re_passage <- if (n_distinct(na.omit(cond$passage_id)) > 1) " + (1 | passage_id)" else ""
if (!nzchar(re_passage)) {
  cat("\nNOTE: fewer than two distinct passage_id values — the (1 | passage_id) intercept that\n")
  cat("      ANALYSIS_PLAN.md §2 prescribes cannot be fitted and passage variance stays in the residual.\n")
}

# Every model reports how many rows it used of the rows it was given. A missing value in ANY term —
# a covariate, a session_index, a frame rate — drops the row inside lme4 without a word: on a
# dataset with mostly-missing frame rates the primary fell from 120 rows to 23 and printed nothing
# to say so.
# The formula actually fitted is printed beside it, on one line: lmerTest's summary prints the CALL,
# which for a formula built with paste0() shows as.formula(paste0(...)) and hides the terms.
report_n <- function(m, data, label) {
  if (is.null(m)) return(invisible(NULL))
  used <- nobs(m)
  cat(sprintf("[n] %s: %d of %d rows used%s\n", label, used, nrow(data),
              if (used < nrow(data)) sprintf(" — %d dropped for a missing value in a model term", nrow(data) - used) else ""))
  cat(sprintf("[model] %s: %s\n", label, paste(deparse(formula(m), width.cutoff = 500L), collapse = " ")))
}

# --- ENGAGEMENT: counted, retained, and a sensitivity on the PRIMARY only ---------------------
# DROP_DISENGAGED used to default to TRUE, which removed every condition-run flagged "bad" from
# EVERY model, silently (no count was printed), and the "with and without" comparison its comment
# and the codebook promised never ran. Three things were wrong with that:
#  1. Synopsis §3.9 places the exclusion of flagged conditions in the SENSITIVITY analyses.
#  2. The flag is built (src/dashboard/aggregate.ts, conditionEngagement) from penalties that
#     include comprehension_wrong, reading_skim and rt_disengaged (a false-alarm rate) — the
#     outcomes of the comprehension, reading-speed and d-prime/criterion models. Dropping rows on
#     it before those models selects on the dependent variable.
#  3. Its penalty weights and good/warn/bad cut-offs are ANALYST DEFAULTS, not pre-registered values.
# So every model keeps every confirmatory run; the primary is refitted without the "bad" runs as a
# LABELLED sensitivity (no engagement signal is built from an ocular outcome); and no secondary is
# ever filtered on this flag. Setting DROP_DISENGAGED to TRUE removes "bad" runs from the OCULAR
# models only, for the same reason.
DROP_DISENGAGED <- FALSE   # ANALYST DEFAULT — FALSE keeps every confirmatory run in every model.
n_bad <- sum(cond$engagement_flag %in% "bad")
cat(sprintf("\n[engagement] %d of %d confirmatory condition-runs are flagged 'bad'. %s\n",
            n_bad, nrow(cond),
            if (DROP_DISENGAGED) "DROP_DISENGAGED is TRUE: they are removed from the OCULAR models only."
            else "RETAINED in every model; the primary is refitted without them as a labelled sensitivity."))

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
# covaries with face illumination, which display polarity changes, so dropping flagged rows deletes
# data non-randomly with respect to a factor. The panel reports, sets `qc_clean`, and a sensitivity
# refit in the primary section shows whether the conclusion depends on the flagged rows.
#
# ON THRESHOLDS. QC_FACE_PRESENCE_MIN is DERIVED FROM the protocol's pilot gate — the codebook entry
# for face_presence_ratio states it as ">= 0.90 in at least 90% of condition-runs", a SITTING-level
# rule — and is applied here PER ROW, which is an analyst's choice. The other two are ANALYST
# DEFAULTS. They are named here, at the top, so they can be changed deliberately and so that no one
# can mistake them for pre-registered values. The distributions are printed beside each count so the
# choice is an informed one rather than an inherited one.
# ===========================================================================================
QC_FACE_PRESENCE_MIN <- 0.90   # PROTOCOL-DERIVED: the pilot gate's 0.90 (codebook, face_presence_ratio),
                               # applied PER ROW here — the gate itself is per sitting (analyst choice).
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

# The ocular frame: camera-on confirmatory runs. Built here, once, because the quality checks read
# it; the primary further down narrows it to runs with at least one blink.
# CVS markers: blink_rate (expected to DROP with screen concentration) and incomplete_blink_ratio
# (expected to RISE — the marker that correlates with CVS symptoms; Portello, Rosenfield & Chu 2013).
# Drowsiness covariate: perclos_p80. Blink rate is non-monotonic, so model the set, not rate alone.
eye <- eye_metrics %>% left_join(cond, by = c("participant_id", "condition_id")) %>% filter(camera_active == 1)
if (DROP_DISENGAGED) eye <- eye %>% filter(!(engagement_flag %in% "bad"))

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
# From the SESSION table, not from the camera-on rows: the lux readings are taken whether or not the
# camera runs, and a sitting whose camera was declined used to vanish from this check.
sess_qc <- session_info
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

if (nrow(eye) == 0) {
  cat("\n5.3-5.5 not computable: no camera-on condition-run in the confirmatory set.\n")
  eye$qc_clean <- logical(0)
} else {
  # --- §5.3 Was the participant present? -----------------------------------------------
  low_presence <- with(eye, is.finite(face_presence_ratio) & face_presence_ratio < QC_FACE_PRESENCE_MIN)
  high_offaxis <- with(eye, is.finite(off_axis_ratio) & off_axis_ratio > QC_OFF_AXIS_MAX)
  cat("\n5.3 participant present\n")
  cat("    face_presence_ratio:           ", qc_rng(eye$face_presence_ratio), "\n")
  cat("    below", QC_FACE_PRESENCE_MIN, "(pilot gate, per row):", qc_pct(sum(low_presence), nrow(eye)), "\n")
  cat("    off_axis_ratio:                ", qc_rng(eye$off_axis_ratio), "\n")
  cat("    above", QC_OFF_AXIS_MAX, "(ANALYST DEFAULT):  ", qc_pct(sum(high_offaxis), nrow(eye)), "\n")

  # --- §5.4 Was the exposure complete? -------------------------------------------------
  # The dangerous one: when the camera stops part-way, every RATE in the row still looks entirely
  # normal, because a rate divides by the time actually observed. Only this comparison shows it.
  eye$observed_frac <- with(eye, ifelse(is.finite(observed_duration_ms) & is.finite(reading_time_ms) & reading_time_ms > 0,
                                        observed_duration_ms / reading_time_ms, NA_real_))
  short_exposure <- with(eye, is.finite(observed_frac) & observed_frac < QC_EXPOSURE_MIN_FRAC)
  cat("\n5.4 exposure completeness (observed_duration_ms / reading_time_ms)\n")
  cat("    observed fraction:             ", qc_rng(eye$observed_frac), "\n")
  cat("    below", QC_EXPOSURE_MIN_FRAC, "(ANALYST DEFAULT):  ", qc_pct(sum(short_exposure), nrow(eye)), "\n")
  cat("    not computable (a duration missing):", qc_pct(sum(is.na(eye$observed_frac)), nrow(eye)), "\n")

  # --- §5.5 Careless responding --------------------------------------------------------
  # Now joined per condition rather than counted study-wide, because the export carries condition_id
  # in 12_quality_flags.csv. The distinction matters: a study-wide rate says how often careless
  # responding happened, and a per-row flag says WHICH rows it happened in — which is the only form
  # that can enter a sensitivity analysis or be crossed with the design factors.
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
  # --- the combined flag ---------------------------------------------------------------
  eye$qc_clean <- !(low_presence | high_offaxis | short_exposure)
}

# --- §1 complete case ------------------------------------------------------------------
cat("\n1.  completeness of sittings\n")
cat("    session_complete FALSE:        ", qc_pct(sum(!sess_qc$session_complete, na.rm = TRUE), nrow(sess_qc)), "\n")
if ("session_status" %in% names(sess_qc)) {
  st <- table(sess_qc$session_status, useNA = "ifany")
  cat("    session_status:                ", paste(names(st), as.integer(st), sep = "=", collapse = ", "), "\n")
}

cat("\nrows failing at least one §5 check:", qc_pct(sum(!eye$qc_clean), nrow(eye)),
    "- RETAINED. The primary is refitted without them as a sensitivity (QC-clean refit below).\n")
cat("==========================================================================\n")

# ===========================================================================================
# BEHAVIOURAL AND QUESTIONNAIRE OUTCOMES — none of them needs the camera.
#
# They used to sit partly before and partly INSIDE the ocular section. The PERCLOS block opened its
# brace before reading speed and closed it after visual search, so reading speed, criterion, d-prime
# and visual search ran only when PERCLOS had a value: with PERCLOS all missing those four sections
# vanished from the output with no message. Reading speed was fitted on the camera-on frame, so a
# participant who declined the camera lost their reading speeds too. And with every camera off,
# stopifnot(!is.null(m_primary)) ended the run before any of them. They are fitted here, on the
# confirmatory condition frame, before anything ocular can stop them.
# ===========================================================================================
rt <- rt_summary %>%
  left_join(cond, by = c("participant_id", "condition_id")) %>%
  filter(!is.na(mean_rt_hits_ms))

# --- Reaction time: contrast, polarity, fatigue accumulation -------------------------------
# Random intercept per participant absorbs individual differences; the passage intercept is there
# for the reason given at re_passage.
m_rt <- lmer(
  as.formula(paste0("mean_rt_hits_ms ~ log_contrast + polarity + session_position", si_term,
                    " + (1 | participant_id)", re_passage)),
  data = rt
)
cat("\n=== RT mixed model ===\n"); print(summary(m_rt)); report_n(m_rt, rt, "RT")
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
  as.formula(paste0(fat_response, " ~ log_contrast + polarity + session_position", si_term,
                    " + (1 | participant_id)", re_passage)),
  data = fat
)
cat("\n=== Fatigue mixed model ===\n"); print(summary(m_fat)); report_n(m_fat, fat, "fatigue")

# --- Comprehension accuracy (logistic mixed model) -----------------------------------------
# passage_id is taken from the condition frame: 04_comprehension.csv carries its own copy, and the two
# arrived as passage_id.x and passage_id.y, so no model could name it.
comp <- comprehension %>% select(-any_of("passage_id")) %>%
  left_join(cond, by = c("participant_id", "condition_id")) %>%
  mutate(item = interaction(passage_id, question_index, drop = TRUE))
# (1 | participant_id/condition_id), not (1 | participant_id) alone.
#
# 04_comprehension.csv is one row per ITEM, three per condition, and the three share a passage, a
# display condition and a single reading episode. Without a condition-level random effect they are
# treated as conditionally independent — textbook pseudo-replication, which inflates the test
# statistic for every CONDITION-level predictor (polarity, contrast, illumination) because the
# effective N is roughly three times too large. illumination and question_kind are entered too;
# the model previously omitted the whole-plot factor entirely.
#
# And the ITEMS are crossed with participants: every participant answers the same thirty questions
# (three per passage), which differ in difficulty, and which passage — hence which items — a
# condition meets is not balanced against polarity (see re_passage). (1 | passage_id) carries
# passage difficulty and (1 | item) the question within it; without them an easy passage read more
# often under one polarity is a polarity effect.
re_item <- if (nzchar(re_passage)) paste0(re_passage, " + (1 | item)") else " + (1 | item)"
m_comp <- glmer(
  as.formula(paste0("is_correct ~ log_contrast + polarity", ilx_term, " + question_kind + session_position",
                    si_term, " + (1 | participant_id/condition_id)", re_item)),
  data = comp, family = binomial
)
cat("\n=== Comprehension logistic mixed model ===\n"); print(summary(m_comp)); report_n(m_comp, comp, "comprehension")

# --- d-prime: aggregate ACROSS conditions per participant (per-condition d' is unstable) ----
dprime_overall <- rt_summary %>%
  group_by(participant_id) %>%
  summarise(mean_dprime = mean(d_prime, na.rm = TRUE),
            any_unstable = any(d_prime_unstable, na.rm = TRUE))
cat("\n=== Aggregated d' per participant ===\n"); print(dprime_overall)

# ===========================================================================================
# SECONDARY OUTCOMES from ANALYSIS_PLAN.md §4 that this file did not model at all.
#
# Four of the seven rows of that table were missing: reading speed, visual search, sensitivity
# (d-prime was averaged descriptively, never modelled) and response bias. They are pre-registered
# outcomes, so their absence is not a stylistic gap — an analyst running this file produced a
# thesis with four of its own stated outcomes unanalysed.
# ===========================================================================================

# --- Reading speed (§4: LMM) -------------------------------------------------------------
# From the CONDITION frame. It was fitted on the camera-on frame, so every run of a participant who
# declined the camera lost its reading speed — on a cohort with three cameras off, 90 rows from 9 of
# 12 participants. Reading speed is timed by the app, not the camera.
#
# "Check against observed_duration_ms first — a truncated exposure produces a normal-looking
# speed." That check is §5.4 above, which computes observed_frac on the camera-on runs; it is
# reported here beside the model rather than left for the reader to connect.
if ("reading_speed_wpm" %in% names(cond) && sum(is.finite(cond$reading_speed_wpm)) > 0) {
  cat("\n=== Reading speed (secondary, §4) ===\n")
  cat("exposure completeness on the camera-on runs: ",
      if (nrow(eye) > 0) qc_rng(eye$observed_frac) else "no camera-on run", "\n")
  m_wpm <- tryCatch(
    lmer(as.formula(paste0("reading_speed_wpm ~ polarity * colour", ilx_term,
                           " + session_position + (1 | participant_id)", re_sitting, re_passage)),
         data = cond),
    error = function(err) NULL
  )
  if (is.null(m_wpm)) cat("the reading-speed model did not fit.\n") else { print(summary(m_wpm)); report_n(m_wpm, cond, "reading speed") }
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
                           " + session_position + (1 | participant_id)", re_sitting, re_passage)),
         data = rt),
    error = function(err) NULL
  )
  if (is.null(m_crit)) cat("the criterion model did not fit.\n") else { print(summary(m_crit)); report_n(m_crit, rt, "criterion") }
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
                           " + session_position + (1 | participant_id)", re_sitting, re_passage)),
         data = dp, weights = dp$dp_w),
    error = function(err) NULL
  )
  if (is.null(m_dp)) cat("the d-prime model did not fit.\n") else { print(summary(m_dp)); report_n(m_dp, dp, "d-prime") }
}

# --- Visual search (§4: LMM, censored) ----------------------------------------------------
# §4: "`search_termination` says whether the block ended by completion or by the 60 s cap. Capped
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
# Trimmed to the confirmatory set like every other table. It was read here, after the trimming at the
# top, and never trimmed at all: a withdrawn participant's searches entered the censoring tables, and
# reached the models only as rows with no polarity that lme4 then dropped without a word.
if (!is.null(search)) search <- keep_rows(search)
if (!is.null(search) && "search_time_ms" %in% names(search)) {
  # passage_id from the condition frame, as for comprehension: the search file carries its own copy.
  vs <- search %>% select(-any_of("passage_id")) %>% left_join(cond, by = c("participant_id", "condition_id")) %>%
    filter(is.finite(search_time_ms))
  cat("\n=== Visual search (secondary, §4) ===\n")
  # CENSORED MEANS "DID NOT FIND EVERY TARGET", NOT ONLY "RAN OUT OF TIME". A participant who taps
  # Done before finding them all (voluntary_early) has a search_time_ms that is a time to QUIT: the
  # time to find every target was not observed, exactly as at the cap. Counting only time_limit as
  # censored treated those quit times as completions and understated the censoring — and giving up
  # early is plausibly commoner in the hardest conditions, so the understatement is not uniform.
  if ("termination_mode" %in% names(vs)) {
    tm <- table(vs$termination_mode, useNA = "ifany")
    cat("termination_mode: ", paste(names(tm), as.integer(tm), sep = "=", collapse = ", "), "\n")
    capped <- sum(vs$termination_mode == "time_limit", na.rm = TRUE)
    quit_early <- sum(vs$termination_mode == "voluntary_early", na.rm = TRUE)
    cat("blocks ending before every target was found (right-censored): ",
        qc_pct(capped + quit_early, nrow(vs)), "\n")
    cat("  of which at the time limit:", capped, "; stopped early by the participant:", quit_early, "\n")
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
    vs$quit_early <- vs$termination_mode == "voluntary_early"
    vs$censored <- vs$termination_mode != "voluntary_full"
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
                pct_quit_early = round(100 * mean(quit_early, na.rm = TRUE), 1),
                pct_censored = round(100 * mean(censored, na.rm = TRUE), 1),
                pct_completed = round(100 * mean(completed, na.rm = TRUE), 1),
                .groups = "drop")
    print(as.data.frame(by_cond))
    # On everything censored, not only the cap: see above.
    spread_pct <- diff(range(by_cond$pct_censored))
    cat("\nspread in censoring across conditions:", round(spread_pct, 1), "percentage points\n")
    if (is.finite(spread_pct) && spread_pct > CENSOR_SPREAD_WARN_PP) {
      cat("*** The censoring rate differs by more than", CENSOR_SPREAD_WARN_PP, "points between conditions. The mean search\n")
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
                                " + session_position + (1 | participant_id)", re_sitting, re_passage)),
              data = vs, family = binomial),
        error = function(err) NULL
      )
      if (is.null(m_vs_done)) cat("the completion model did not fit.\n") else { print(summary(m_vs_done)); report_n(m_vs_done, vs, "search completion") }
    }
  }

  cat("\n=== Visual search: time, UNCENSORED (read the censoring table above first) ===\n")
  m_vs <- tryCatch(
    lmer(as.formula(paste0("search_time_ms ~ polarity * colour", ilx_term,
                           " + session_position + (1 | participant_id)", re_sitting, re_passage)),
         data = vs),
    error = function(err) NULL
  )
  if (is.null(m_vs)) cat("the visual-search model did not fit.\n") else { print(summary(m_vs)); report_n(m_vs, vs, "search time") }
} else {
  cat("\n[visual search] 05_visual_search.csv not found or carries no search_time_ms.\n")
}

# ===========================================================================================
# KEY SECONDARY: CVS-Q change (and, in archived two-level data, its contrast across illumination).
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
#
# ONE ROW PER STAGE PER SITTING is what the pivot assumes, and the app's integrity audit
# (one_cvsq_per_stage) exists because it can fail. A duplicated stage used to make pivot_wider build
# list-columns, and the next line died with "non-numeric argument to binary operator" — taking the
# primary model's printout with it, because that was printed further down. The first row is kept and
# the duplicate is named, so the reason the number may be wrong is on the page.
# ===========================================================================================
cvsq_dupes <- cvsq %>% count(participant_id, sitting_folder, stage) %>% filter(n > 1)
if (nrow(cvsq_dupes) > 0) {
  cat("\n[cvsq] ", nrow(cvsq_dupes), " sitting x stage combination(s) carry more than one CVS-Q row (e.g. ",
      cvsq_dupes$participant_id[1], ", stage ", cvsq_dupes$stage[1], "); the FIRST row of each is kept. ",
      "The per-sitting audit (one_cvsq_per_stage) should have blocked this sitting — check its ",
      "16_integrity_report.csv and whether the pooled export predates the data.\n", sep = "")
}
cvsq_change <- cvsq %>%
  select(participant_id, sitting_folder, session_index, ambient_illumination_level, stage, total_score) %>%
  tidyr::pivot_wider(names_from = stage, values_from = total_score, values_fn = function(v) v[1]) %>%
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
    cat(sprintf("mean change = %.2f (n = %d sitting(s), %d participant(s))\n", mean(cvsq_change$change),
                nrow(cvsq_change), n_distinct(cvsq_change$participant_id)))
  }
} else {
  cat("\n[CVS-Q change not modelled: needs BOTH stages present]\n")
}

# --- NASA-TLX: SESSION-level workload -------------------------------------------------------
# Administered once per session, so it supports inference about a session-level factor only (the
# illumination contrast in archived two-level data). Polarity and colour vary within a session and
# cannot be attributed a single end-of-session rating — do not model them here (§4.3).
#
# It was never analysed. The file was looked for at DATA_DIR's top level only — file.path(DATA_DIR,
# "14_nasa_tlx.csv") — so the one-folder-per-sitting layout every real export has never found it, and
# the block skipped in silence; when it did find a single folder's file, it read it with no exclusion
# applied. It is read like every other file now, and trimmed to the confirmatory sittings.
tlx <- tryCatch(read_export("14_nasa_tlx.csv", with_folder = TRUE), error = function(err) NULL)
if (is.null(tlx)) {
  cat("\n[NASA-TLX] 14_nasa_tlx.csv not found under DATA_DIR — not summarised.\n")
} else {
  tlx <- tlx[tlx$sitting_folder %in% keep_folders, , drop = FALSE] %>%
    mutate(illumination = factor(ambient_illumination_level, levels = c("dim", "moderate")))
  tlx_dupes <- tlx %>% count(sitting_folder) %>% filter(n > 1)
  if (nrow(tlx_dupes) > 0) {
    cat("\n[NASA-TLX] ", nrow(tlx_dupes), " sitting(s) carry more than one NASA-TLX row; the FIRST is kept ",
        "(the per-sitting audit, one_tlx_per_session, should have blocked them).\n", sep = "")
    tlx <- tlx %>% distinct(sitting_folder, .keep_all = TRUE)
  }
  if (nrow(tlx) > 0 && length(unique(na.omit(tlx$illumination))) > 1) {
    m_tlx <- lmer(raw_tlx ~ illumination + (1 | participant_id), data = tlx)
    cat("\n=== NASA-TLX raw score by illumination (session level) ===\n"); print(summary(m_tlx))
    print(emmeans(m_tlx, ~ illumination))
  } else if (nrow(tlx) > 0) {
    # Previously this skipped in TOTAL SILENCE. With one illumination level and one rating per
    # participant there is no within-participant contrast of any kind, so the descriptive summary
    # is the whole of what NASA-TLX supports here — and saying so beats printing nothing.
    cat("\n=== NASA-TLX raw score (session level, descriptive) ===\n")
    cat("One rating per sitting and one illumination level: no contrast is estimable.\n")
    print(summary(tlx$raw_tlx))
    cat(sprintf("n = %d sitting(s), %d participant(s)\n", nrow(tlx), n_distinct(tlx$participant_id)))
  } else {
    cat("\n[NASA-TLX not summarised: no confirmatory sitting has a rating]\n")
  }
}

# ===========================================================================================
# CONFIRMATORY ANALYSIS — the PRIMARY outcome (synopsis §3.9)
#
# Outcome: incomplete_blink_ratio during reading, per condition. A BOUNDED PROPORTION, so it is
# modelled on the logit scale (or as a beta/binomial mixed model) — never as an untransformed
# linear outcome, which would permit predictions outside [0,1] and assume constant variance where
# variance is in fact smallest near the bounds.
#
# Random structure: ANALYSIS_PLAN.md §1 — one sitting per participant, so a single random-effect
# stratum, the participant, with a random polarity slope; plus the passage intercept of §2. This
# comment used to describe a SPLIT-PLOT design with a session intercept nested in participant, which
# the single-level amendment retired. A sitting intercept is still added when a dataset holds more
# than one sitting per participant (a split sitting, or archived two-level data, where illumination
# varied between sittings) — re_sitting is empty otherwise.
#
# If the maximal structure is singular or fails to fit, reduce in this PRE-SPECIFIED order and report
# it — the structure actually fitted is printed from the model, not from a label:
#   1. drop the random slope for polarity
#   2. drop the sitting intercept (only present when there are several sittings)
# ===========================================================================================
primary_failed <- FALSE
eye <- eye %>% mutate(
  blink_total = blink_count_incomplete + blink_count_full + blink_count_micro,
  eff_fps_c   = as.numeric(scale(effective_fps, scale = FALSE))
) %>% filter(!is.na(blink_total), blink_total > 0)

if (nrow(eye) == 0) {
  cat("\n################################################################\n")
  cat("[PRIMARY NOT ESTIMABLE] no camera-on condition-run with at least one blink in the confirmatory\n")
  cat("set — the camera was declined, off or lost for every run. The primary outcome, its sensitivity\n")
  cat("refits, the anchor, Objective 2 and the ocular secondaries cannot be estimated from this data.\n")
  cat("The behavioural and questionnaire outcomes above do not depend on the camera and stand.\n")
  cat("################################################################\n")
} else {
  # The primary outcome is a BINOMIAL PROPORTION, and is modelled as one.
  #
  # incomplete_blink_ratio = incomplete / (incomplete + full + micro), and that denominator varies
  # from a handful of blinks to several dozen. A Gaussian model of the naked proportion gives a ratio
  # from 8 blinks exactly the weight of one from 60, and the earlier logit transform made it worse: a
  # fixed epsilon mapped EVERY zero-incomplete condition to logit(0.001) = -6.91 regardless of whether
  # it rested on 8 blinks or 40, creating high-leverage points concentrated wherever blink capture is
  # thin — which, per the codebook's own note on fps_adequate_for_ratio, covaries with face
  # illumination, and so with polarity.
  #
  # The counts are now exported, so the model takes them directly.
  #
  # effective_fps enters as a covariate because undersampling biases the measured minimum EAR upward
  # and so inflates the ratio — a DIRECTIONAL bias. It is not in ANALYSIS_PLAN.md §2's formula, and
  # frame rate plausibly lies on the path from polarity to face illumination, so it is a post-treatment
  # adjustment as well as a nuisance one: the model WITHOUT it is reported beside this one below.
  # passage_repeat_number was the PERIOD term, for when every passage was re-read in a second sitting.
  # Under the single-sitting protocol each of the ten passages is read exactly ONCE, so the column is
  # constant at 1 and is omitted with the illumination terms rather than left to alias silently.
  rep_term <- if (length(unique(na.omit(eye$passage_repeat_number))) > 1) " + passage_repeat_number" else ""

  # The binomial response, defined ONCE. Five secondary models below used to name a variable
  # `ibr_logit` that no part of this file ever created — a leftover from the fixed-epsilon logit
  # approach that the note above explains was abandoned. They now share this response.
  RESP <- "cbind(blink_count_incomplete, blink_count_full + blink_count_micro)"
  f_primary <- as.formula(paste0(
    RESP, " ~ polarity * colour", ilx_term, " + session_position", ord_term, rep_term, " + eff_fps_c"))

  # Fit maximal, then reduce in the PRE-SPECIFIED order. Warnings are RECORDED, not used to discard a
  # fitted model: a `boundary (singular) fit` on a random slope is routine, and treating it as failure
  # silently walked the model all the way down to (1 | participant_id).
  # `data = eye` is written into the call, not passed in as an argument: update() re-evaluates the
  # stored call in the global environment, where an argument named `data` would resolve to utils::data
  # and every update(m_primary, ...) below without its own data = would fail.
  fit_noting <- function(formula) {
    notes <- character(0)
    m <- withCallingHandlers(
      tryCatch(glmer(formula, data = eye, family = binomial), error = function(e) NULL),
      warning = function(w) { notes <<- c(notes, conditionMessage(w)); invokeRestart("muffleWarning") }
    )
    list(model = m, notes = notes)
  }

  # Secondary models share the primary response and its passage and sitting terms. Written as a
  # helper rather than repeated, because repeating it is how five of them came to name a variable that
  # did not exist — and how all of them came to omit the passage intercept the primary carries.
  fit_binom <- function(rhs, data, extra_re = paste0(re_sitting, re_passage)) {
    glmer(as.formula(paste0(RESP, " ~ ", rhs, " + (1 | participant_id)", extra_re)),
          data = data, family = binomial,
          control = glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 2e5)))
  }

  # ANALYSIS_PLAN.md §2 prescribes the passage intercept, and passage is NOT balanced against
  # condition (see re_passage). It is carried through every rung of the ladder rather than being the
  # first thing dropped, because the plan's pre-specified reduction order is about the PARTICIPANT
  # structure and says nothing about passage. A dataset with too few distinct passages to support it
  # is handled at the end, loudly.
  rung <- "maximal"
  fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 + polarity | participant_id)", re_sitting, re_passage))))
  if (is.null(fit$model) || isSingular(fit$model)) {
    rung <- "reduction 1 (no polarity slope)"
    fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 | participant_id)", re_sitting, re_passage))))
  }
  if (is.null(fit$model) && nzchar(re_passage)) {
    # The passage intercept is prescribed, so it is dropped only when keeping it prevents a fit at
    # all — and then it is said out loud.
    rung <- "reduction 1b — NO PASSAGE INTERCEPT, passage variance loads onto the residual"
    fit <- fit_noting(update(f_primary, as.formula(paste0(". ~ . + (1 | participant_id)", re_sitting))))
  }
  if (is.null(fit$model) && nzchar(re_sitting)) {
    rung <- "reduction 2 — NO SITTING INTERCEPT"
    fit <- fit_noting(update(f_primary, . ~ . + (1 | participant_id)))
  }
  m_primary <- fit$model

  if (is.null(m_primary)) {
    # Not stopifnot(): that printed "!is.null(m_primary) is not TRUE" and ended the run. The rest of
    # the ocular section depends on this model and is skipped; the run ends non-zero at the very end
    # with this message repeated, after everything that does not depend on it has printed.
    primary_failed <- TRUE
    cat("\n[PRIMARY NOT FITTED] the primary model could not be fitted at any rung of the reduction ladder,\n")
    cat(sprintf("on %d camera-on condition-runs with at least one blink from %d participant(s).\n",
                nrow(eye), n_distinct(eye$participant_id)))
  } else {
    # Printed IMMEDIATELY. It used to be printed after the CVS-Q block, so a crash there took the
    # primary result down with it.
    cat("\n=== PRIMARY: incomplete-blink ratio, logit scale (binomial GLMM) ===\n")
    print(summary(m_primary)); report_n(m_primary, eye, "primary")
    # The structure actually fitted, read from the model — not a label. The label used to print a
    # sitting term (1 | participant:sitting) that had not been fitted.
    primary_structure <- paste0(rung, ": ",
      paste0("(", vapply(lme4::findbars(formula(m_primary)), function(b) paste(deparse(b), collapse = ""), ""), ")",
             collapse = " + "))

    # -----------------------------------------------------------------------------------------
    # OVERDISPERSION. ANALYSIS_PLAN.md §2: "Overdispersion must be checked. Blinks within a
    # condition are not independent Bernoulli trials; if the dispersion statistic exceeds
    # ~1.5, refit with glmmTMB(..., family = betabinomial)."
    #
    # Blink classification within one condition is serially correlated, so dispersion above 1 is
    # the expectation rather than a worry — and an unadjusted binomial GLMM then understates every
    # standard error on the primary outcome, which inflates significance on exactly the polarity x
    # colour interaction the study is built to test.
    #
    # Reported, never applied silently: refitting as beta-binomial changes the model the thesis
    # reports, and that is the investigator's call to make deliberately.
    # -----------------------------------------------------------------------------------------
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
    # statistic, and no p-value. A likelihood-ratio test against the additive model is the test: ONE
    # statistic for the whole interaction, which is the question Objective 2 asks.
    #
    # The degrees of freedom are read from the printed table and NOT stated here. A full 2 x 5
    # crossing gives 4, but lme4 drops aliased columns from a rank-deficient design and reports the df
    # it actually used; a heading asserting 4 would then be describing a test that was not run.
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
    # type = 'response' so these print as proportions.
    print(emmeans(m_primary, ~ colour | polarity, type = "response"))

    # ===========================================================================================
    # SENSITIVITY REFITS OF THE PRIMARY. Each is the SAME model — update(m_primary, data = ...) — on
    # different rows, so a difference between it and the confirmatory fit is a difference in the
    # rows and nothing else. They used to be fitted with a reduced random structure (no passage
    # intercept, no slope), which made them incomparable with the primary they were meant to test.
    # ===========================================================================================
    pol_row <- function(m) summary(m)$coefficients["polarity1", ]
    sens_line <- function(label, m) {
      if (is.null(m)) { cat(sprintf("  %-42s did not fit\n", label)); return(invisible(NULL)) }
      cat(sprintf("  %-42s polarity %.4f (SE %.4f), n %d\n", label, pol_row(m)[1], pol_row(m)[2], nobs(m)))
    }
    refit_on <- function(rows) tryCatch(suppressWarnings(update(m_primary, data = rows)), error = function(err) NULL)
    cat("\n=== PRIMARY: sensitivity refits (polarity = positive minus negative, log-odds) ===\n")
    sens_line("confirmatory (the primary above)", m_primary)

    # §5.2 frame-rate adequacy. If the effect only exists in the flagged subset, it is a camera
    # artefact. isTRUE(any(..., na.rm = TRUE)): the bare any() errored when no value was TRUE and some
    # were missing. The dead m_primary_fps fit that sat here is gone.
    cat("\nframe-rate adequacy (the primary outcome's known directional bias):\n")
    print(table(fps_adequate_for_ratio = eye$fps_adequate_for_ratio, useNA = "ifany"))
    if (isTRUE(any(eye$fps_adequate_for_ratio, na.rm = TRUE)) && !all(eye$fps_adequate_for_ratio %in% TRUE)) {
      sens_line("fps_adequate_for_ratio conditions only", refit_on(eye %>% filter(fps_adequate_for_ratio %in% TRUE)))
    } else {
      cat("  every camera-on run is adequately sampled (or none is): no frame-rate refit to run.\n")
    }

    # Without eff_fps_c: §2's own formula, and the answer if frame rate is a mediator, not a nuisance.
    # (The formula on its own line, for the reason given at m_additive.)
    m_no_fps <- tryCatch(
      update(m_primary, . ~ . - eff_fps_c),
      error = function(err) NULL
    )
    sens_line("without the eff_fps_c covariate (§2 formula)", m_no_fps)

    # §5 QC-clean. The QC panel said this refit ran; it did not, until now.
    if (any(!eye$qc_clean)) {
      sens_line("rows passing every §5 check", refit_on(eye %>% filter(qc_clean)))
    } else {
      cat("  no row fails a §5 check: the QC-clean refit is the primary itself.\n")
    }

    # Engagement 'bad' runs out — the sensitivity synopsis §3.9 asks for, on the PRIMARY only (see
    # DROP_DISENGAGED above for why no secondary is ever filtered on this flag).
    if (DROP_DISENGAGED) {
      cat("  'bad' engagement runs are already removed from the ocular models (DROP_DISENGAGED).\n")
    } else if (n_bad > 0) {
      sens_line("without engagement 'bad' runs", refit_on(eye %>% filter(!(engagement_flag %in% "bad"))))
    } else {
      cat("  no run is flagged 'bad': the without-'bad' refit is the primary itself.\n")
    }

    # --- SENSITIVITY SET: the complete-case rule relaxed, and nothing else (ANALYSIS_PLAN.md §1) ---
    # "The confirmatory analysis is complete-case; a sensitivity analysis including them is
    # reasonable and should be reported as such." The plan asked for it and nothing ran it: the same
    # model on the confirmatory rows PLUS the finished runs of participants excluded ONLY for an
    # incomplete condition set (see WHICH ROWS ARE MODELLED), built from the untrimmed tables by the
    # same build_cond().
    n_sens_extra <- length(setdiff(sens_ids, keep_ids))
    if (n_sens_extra == 0) {
      cat("  [sensitivity set] identical to the confirmatory set here (no participant was excluded only\n")
      cat("  for an incomplete condition set), so there is nothing to refit.\n")
    } else {
      cond_sens <- build_cond(conditions_all[conditions_all$condition_id %in% sens_ids, , drop = FALSE],
                              wide_all, quality_all,
                              participant_all[participant_all$sitting_folder %in% sens_folders, , drop = FALSE],
                              session_info_all[session_info_all$sitting_folder %in% sens_folders, , drop = FALSE])
      eye_sens <- eye_metrics_all %>% filter(condition_id %in% sens_ids) %>%
        left_join(cond_sens, by = c("participant_id", "condition_id")) %>%
        filter(camera_active == 1) %>%
        mutate(blink_total = blink_count_incomplete + blink_count_full + blink_count_micro,
               eff_fps_c   = as.numeric(scale(effective_fps, scale = FALSE))) %>%
        filter(!is.na(blink_total), blink_total > 0)
      if (DROP_DISENGAGED) eye_sens <- eye_sens %>% filter(!(engagement_flag %in% "bad"))
      m_sens <- refit_on(eye_sens)
      cat("\n=== PRIMARY refit on the SENSITIVITY SET (", n_sens_extra,
          " extra finished run(s) of incomplete participants; ANALYSIS_PLAN.md §1) ===\n", sep = "")
      sens_line("sensitivity set", m_sens)
      if (!is.null(m_sens)) print(summary(m_sens))
    }

    # --- PERCLOS-adjusted (sensitivity) ------------------------------------------------------
    # This is what separates visual fatigue from plain sleepiness. It used to open a brace that
    # closed after visual search, so with PERCLOS missing everywhere four behavioural sections
    # vanished too; it is self-contained now and says when it cannot run.
    if (any(!is.na(eye$perclos_p80))) {
      m_primary_adj <- tryCatch(update(m_primary, . ~ . + perclos_p80, data = eye %>% filter(!is.na(perclos_p80))),
                                error = function(err) NULL)
      cat("\n=== PRIMARY adjusted for PERCLOS (sensitivity) ===\n")
      if (is.null(m_primary_adj)) cat("the PERCLOS-adjusted model did not fit.\n") else {
        print(summary(m_primary_adj)); report_n(m_primary_adj, eye, "PERCLOS-adjusted primary")
      }
    } else {
      cat("\n[perclos] perclos_p80 carries no values — the PERCLOS-adjusted sensitivity is NOT run.\n")
    }
  }

  # --- The contrast-matched anchor: the ONE clean test of polarity ----------------------------
  # Black-on-white and white-on-black are both 21:1, so this contrast varies polarity with
  # luminance contrast held constant. A polarity effect here cannot be attributed to contrast.
  # Carries the passage intercept: the two achromatic conditions do not meet the same passages.
  ach <- eye %>% filter(colour == "achromatic")
  if (nrow(ach) > 0 && length(unique(ach$polarity)) == 2) {
    m_anchor <- tryCatch(fit_binom(paste0("polarity", ilx_term, " + session_position"), ach), error = function(err) NULL)
    cat("\n=== Achromatic anchor: polarity at matched 21:1 contrast ===\n")
    if (is.null(m_anchor)) cat("the anchor model did not fit.\n") else { print(summary(m_anchor)); report_n(m_anchor, ach, "anchor") }
  }

  # --- OBJECTIVE 2: is colour a proxy for luminance contrast, or is there residual hue? -------
  # Two nested families are compared. If contrast does the work, the residual hue terms shrink and
  # the parsimonious model is not meaningfully worse. Every one carries the passage intercept.
  obj2 <- tryCatch(list(
    colour_cat = fit_binom(paste0("polarity * colour", il_term, " + session_position"), eye),
    contrast   = fit_binom(paste0("polarity + log_contrast", il_term, " + session_position"), eye),
    both       = fit_binom(paste0("polarity + log_contrast + colour", il_term, " + session_position"), eye)
  ), error = function(err) NULL)
  cat("\n=== Objective 2: contrast vs residual hue (binomial GLMMs, nested comparison) ===\n")
  if (is.null(obj2)) {
    cat("the Objective 2 models did not fit.\n")
  } else {
    print(anova(obj2$contrast, obj2$both, obj2$colour_cat))
    report_n(obj2$colour_cat, eye, "Objective 2")
    cat("\nResidual hue terms beyond contrast (small => colour is largely a contrast proxy):\n")
    print(summary(obj2$both)$coefficients)
  }

  # --- Secondary ocular measures --------------------------------------------------------------
  m_blink <- tryCatch(lmer(as.formula(paste0("blink_rate ~ polarity * colour", il_term,
                                             " + session_position + (1 | participant_id)", re_passage)), data = eye),
                      error = function(err) NULL)
  cat("\n=== Blink-rate mixed model (secondary) ===\n")
  if (is.null(m_blink)) cat("the blink-rate model did not fit.\n") else { print(summary(m_blink)); report_n(m_blink, eye, "blink rate") }

  if (any(!is.na(eye$perclos_p80))) {
    # ANALYSIS_PLAN.md §4, PERCLOS row: "LMM on logit. Bounded; do not model raw."
    # PERCLOS is a proportion of time with no trial count behind it, so there is no binomial to fall
    # back on and the logit is what the plan asks for. Exact 0 and 1 have no logit, so the ENDPOINTS
    # ONLY are moved inward by PERCLOS_LOGIT_SQUEEZE (a fixed ANALYST DEFAULT — an earlier comment here
    # described a data-driven squeeze the code never implemented) and the count moved is reported,
    # because silently moving data is how a bounded outcome quietly becomes a different one.
    eye_pc <- eye %>% filter(!is.na(perclos_p80))
    n_squeezed <- sum(eye_pc$perclos_p80 <= 0 | eye_pc$perclos_p80 >= 1)
    if (n_squeezed > 0) cat("\n[perclos] ", n_squeezed, " value(s) at 0 or 1 squeezed inward for the logit.\n")
    eye_pc$perclos_logit <- qlogis(pmin(pmax(eye_pc$perclos_p80, PERCLOS_LOGIT_SQUEEZE),
                                        1 - PERCLOS_LOGIT_SQUEEZE))
    m_perclos <- tryCatch(lmer(as.formula(paste0("perclos_logit ~ polarity", il_term,
                                                 " + session_position + (1 | participant_id)", re_passage)), data = eye_pc),
                          error = function(err) NULL)
    cat("\n=== PERCLOS P80 (drowsiness covariate) ===\n")
    if (is.null(m_perclos)) cat("the PERCLOS model did not fit.\n") else { print(summary(m_perclos)); report_n(m_perclos, eye_pc, "PERCLOS") }
  } else {
    cat("\n[perclos] perclos_p80 carries no values — the PERCLOS model is NOT run.\n")
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

# A primary model that could not be fitted on data that HAS camera-on runs is a failed confirmatory
# analysis, and the run must not end looking like a successful one. Raised last, so every result that
# does not depend on it has already printed.
if (primary_failed) {
  stop(sprintf(paste0("[PRIMARY NOT FITTED] the primary model could not be fitted on %d camera-on condition-runs ",
                      "from %d participant(s); see the fit notes above."), nrow(eye), n_distinct(eye$participant_id)),
       call. = FALSE)
}
