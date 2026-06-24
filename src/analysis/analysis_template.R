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

conditions  <- read_csv(file.path(DATA_DIR, "02_conditions.csv"))
fatigue     <- read_csv(file.path(DATA_DIR, "03_fatigue_scores.csv"))
comprehension <- read_csv(file.path(DATA_DIR, "04_comprehension.csv"))
rt_summary  <- read_csv(file.path(DATA_DIR, "09_rt_summary.csv"))
eye_metrics <- read_csv(file.path(DATA_DIR, "07_eye_metrics.csv"))
quality     <- read_csv(file.path(DATA_DIR, "12_quality_flags.csv"))  # engagement / careless-responding
wide        <- read_csv(file.path(DATA_DIR, "10_wide_summary.csv"))   # carries session_index per condition

# --- Quality control: optionally exclude disengaged conditions -----------------------------
# Boredom/disengagement over the long session mimics fatigue and adds noise. The engagement
# flag (good/warn/bad) lets you run a sensitivity analysis: fit models on the full set AND on the
# clean subset (drop "bad"); if conclusions agree, disengagement is not driving the result.
DROP_DISENGAGED <- TRUE   # set FALSE to keep every condition
clean_ids <- quality %>% filter(engagement_flag != "bad") %>% select(participant_id, condition_label)

# --- Build a per-condition modelling frame -------------------------------------------------
# Contrast (WCAG ratio), session_position (0-7 fatigue accumulation) and session_index (sitting
# number for split sessions) are recorded as covariates; log-transform contrast.
cond <- conditions %>%
  left_join(wide %>% select(participant_id, condition_label, session_index, engagement_flag),
            by = c("participant_id", "condition_label")) %>%
  mutate(
    log_contrast = log10(wcag_contrast_ratio),
    polarity = factor(polarity, levels = c("positive", "negative")),
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

# --- Blink rate (report with caution; gate tiers on effective_fps) -------------------------
eye <- eye_metrics %>% left_join(cond, by = c("participant_id", "condition_id"))
m_blink <- lmer(blink_rate_full ~ session_position + polarity + (1 | participant_id),
                data = eye %>% filter(camera_active == 1))
cat("\n=== Full-blink-rate mixed model ===\n"); print(summary(m_blink))

# --- Assumption checks ---------------------------------------------------------------------
cat("\n=== RT model assumption checks ===\n")
print(check_model(m_rt))
