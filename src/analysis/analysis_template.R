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
cond <- conditions %>%
  left_join(wide %>% select(participant_id, condition_label, session_index, engagement_flag),
            by = c("participant_id", "condition_label")) %>%
  left_join(participant %>% select(participant_id, age, gender, daily_screen_hours,
                                    correction_type, cvd_status),
            by = "participant_id") %>%   # participant covariates for adjustment (e.g. + age)
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
    illumination = factor(ambient_illumination_level, levels = c("dim", "moderate")),
    below_aa = as.integer(below_wcag_aa),
    session_index = ifelse(is.na(session_index), 1L, session_index)
  )
if (DROP_DISENGAGED) cond <- cond %>% filter(is.na(engagement_flag) | engagement_flag != "bad")
# When all data come from single sittings, session_index is constant — drop it from the formula
# automatically to avoid a rank-deficient fit.
USE_SESSION_INDEX <- length(unique(cond$session_index)) > 1
si_term <- if (USE_SESSION_INDEX) " + session_index" else ""

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
m_comp <- glmer(
  as.formula(paste0("is_correct ~ log_contrast + polarity + session_position", si_term, " + (1 | participant_id)")),
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
EPS <- 1e-3   # keeps logit finite when a condition yields a ratio of exactly 0 or 1
eye <- eye %>% mutate(
  ibr = pmin(pmax(incomplete_blink_ratio, EPS), 1 - EPS),
  ibr_logit = log(ibr / (1 - ibr))
)

# Maximal model, then the pre-specified reductions on non-convergence.
f_primary <- ibr_logit ~ polarity * colour * illumination + session_position + illumination_order_first
m_primary <- tryCatch(
  lmer(update(f_primary, . ~ . + (1 + polarity | participant_id) + (1 | participant_id:session_index)),
       data = eye, REML = TRUE),
  error = function(e) NULL, warning = function(w) NULL
)
if (is.null(m_primary)) {
  message("Maximal random structure did not converge -> dropping the polarity slope (reduction 1).")
  m_primary <- tryCatch(
    lmer(update(f_primary, . ~ . + (1 | participant_id) + (1 | participant_id:session_index)),
         data = eye, REML = TRUE),
    error = function(e) NULL, warning = function(w) NULL
  )
}
if (is.null(m_primary)) {
  message("Reduction 1 did not converge -> dropping the session intercept (reduction 2).")
  m_primary <- lmer(update(f_primary, . ~ . + (1 | participant_id)), data = eye, REML = TRUE)
}
cat("\n=== PRIMARY: incomplete-blink ratio, logit scale, split-plot random structure ===\n")
print(summary(m_primary))
cat("\nMarginal means (back-transformed to the proportion scale):\n")
print(emmeans(m_primary, ~ polarity | illumination, type = "response"))
cat("\nThe polarity x colour interaction — Objective 2's crossover test:\n")
print(emmeans(m_primary, ~ colour | polarity))

# --- The contrast-matched anchor: the ONE clean test of polarity ----------------------------
# Black-on-white and white-on-black are both 21:1, so this contrast varies polarity with
# luminance contrast held constant. A polarity effect here cannot be attributed to contrast.
ach <- eye %>% filter(colour == "achromatic")
if (nrow(ach) > 0 && length(unique(ach$polarity)) == 2) {
  m_anchor <- lmer(ibr_logit ~ polarity * illumination + session_position +
                     (1 | participant_id) + (1 | participant_id:session_index), data = ach)
  cat("\n=== Achromatic anchor: polarity at matched 21:1 contrast ===\n"); print(summary(m_anchor))
}

# --- OBJECTIVE 2: is colour a proxy for luminance contrast, or is there residual hue? -------
# Two nested families are compared. If contrast does the work, the residual hue terms shrink and
# the parsimonious model is not meaningfully worse.
m_colour_cat <- lmer(ibr_logit ~ polarity * colour + illumination + session_position +
                       (1 | participant_id) + (1 | participant_id:session_index),
                     data = eye, REML = FALSE)
m_contrast   <- lmer(ibr_logit ~ polarity + log_contrast + illumination + session_position +
                       (1 | participant_id) + (1 | participant_id:session_index),
                     data = eye, REML = FALSE)
m_both       <- lmer(ibr_logit ~ polarity + log_contrast + colour + illumination + session_position +
                       (1 | participant_id) + (1 | participant_id:session_index),
                     data = eye, REML = FALSE)
cat("\n=== Objective 2: contrast vs residual hue (ML fits, nested comparison) ===\n")
print(anova(m_contrast, m_both, m_colour_cat))
cat("\nResidual hue terms beyond contrast (small => colour is largely a contrast proxy):\n")
print(summary(m_both)$coefficients)

# --- Secondary ocular measures --------------------------------------------------------------
m_blink <- lmer(blink_rate ~ polarity * colour + illumination + session_position +
                  (1 | participant_id) + (1 | participant_id:session_index), data = eye)
cat("\n=== Blink-rate mixed model (secondary) ===\n"); print(summary(m_blink))
if (any(!is.na(eye$perclos_p80))) {
  m_perclos <- lmer(perclos_p80 ~ polarity + illumination + session_position +
                      (1 | participant_id) + (1 | participant_id:session_index), data = eye)
  cat("\n=== PERCLOS P80 (drowsiness covariate) ===\n"); print(summary(m_perclos))
  # SENSITIVITY: re-fit the primary model with PERCLOS as a covariate. This is what separates
  # visual fatigue from plain sleepiness — PERCLOS is never an outcome here (§4.3: it is
  # insensitive in moderate drowsiness, so it serves only to adjust).
  m_primary_adj <- lmer(ibr_logit ~ polarity * colour * illumination + session_position +
                          perclos_p80 + (1 | participant_id) + (1 | participant_id:session_index),
                        data = eye %>% filter(!is.na(perclos_p80)))
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
  if (nrow(tlx) > 0 && length(unique(tlx$illumination)) == 2) {
    m_tlx <- lmer(raw_tlx ~ illumination + (1 | participant_id), data = tlx)
    cat("\n=== NASA-TLX raw score by illumination (session level) ===\n"); print(summary(m_tlx))
    print(emmeans(m_tlx, ~ illumination))
  }
}

# --- Assumption checks ---------------------------------------------------------------------
cat("\n=== RT model assumption checks ===\n")
print(check_model(m_rt))
