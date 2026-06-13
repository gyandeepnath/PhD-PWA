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

# --- Build a per-condition modelling frame -------------------------------------------------
# Contrast (WCAG ratio) and session_position are recorded as covariates; log-transform contrast.
cond <- conditions %>%
  mutate(
    log_contrast = log10(wcag_contrast_ratio),
    polarity = factor(polarity, levels = c("positive", "negative")),
    below_aa = as.integer(below_wcag_aa)
  )

rt <- rt_summary %>%
  left_join(cond, by = c("participant_id", "condition_id")) %>%
  filter(!is.na(mean_rt_hits_ms))

# --- Reaction time: contrast, polarity, fatigue accumulation -------------------------------
# Random intercept per participant absorbs individual differences.
m_rt <- lmer(
  mean_rt_hits_ms ~ log_contrast + polarity + session_position + (1 | participant_id),
  data = rt
)
cat("\n=== RT mixed model ===\n"); print(summary(m_rt))
cat("\nMarginal means by polarity:\n"); print(emmeans(m_rt, ~ polarity))

# --- Subjective fatigue (post-condition VAS composite) -------------------------------------
fat <- fatigue %>%
  filter(stage == "post_condition") %>%
  left_join(cond, by = c("participant_id", "condition_id"))
m_fat <- lmer(
  fatigue_mean ~ log_contrast + polarity + session_position + (1 | participant_id),
  data = fat
)
cat("\n=== Fatigue mixed model ===\n"); print(summary(m_fat))

# --- Comprehension accuracy (logistic mixed model) -----------------------------------------
comp <- comprehension %>% left_join(cond, by = c("participant_id", "condition_id"))
m_comp <- glmer(
  is_correct ~ log_contrast + polarity + session_position + (1 | participant_id),
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
