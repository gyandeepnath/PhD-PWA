/**
 * Ground-truth effect parameters for the simulation.
 *
 * These are the "true" effects baked into synthetic data so the analysis pipeline can be
 * validated by checking it RECOVERS them (sign, magnitude, direction). All effects are
 * literature-plausible:
 *  - higher luminance contrast -> faster RT, better comprehension, less fatigue
 *  - negative polarity -> slightly slower RT (the red dot is less salient on black: 3.66 vs 5.74)
 *  - serial position -> fatigue accumulation (slower RT, more fatigue, rising blink rate)
 *  - incongruent flankers -> slower RT (the flanker congruency effect)
 */
export interface GroundTruth {
  rt: {
    base_mu_ms: number;
    sigma_ms: number;
    tau_ms: number;
    /** ms per unit log10(WCAG ratio); negative = higher contrast is faster. */
    beta_log_contrast: number;
    /** ms added for negative polarity. */
    beta_negative_polarity: number;
    /** ms added per serial position (fatigue accumulation). */
    beta_position: number;
    /** ms added for incongruent flankers (the FCE). */
    congruency_effect_ms: number;
    /** SD of per-participant random intercept. */
    participant_sd_ms: number;
  };
  hit: { intercept: number; beta_log_contrast: number; beta_position: number };
  falseAlarm: { intercept: number; beta_below_aa: number };
  comprehension: { intercept: number; beta_log_contrast: number; beta_position: number };
  fatigue: {
    base: number;
    beta_position: number;
    beta_below_aa: number;
    participant_sd: number;
    item_sd: number;
  };
  blink: {
    /** Suppressed reading baseline (blinks/min). */
    base_rate: number;
    /** Rise per serial position (fatigue dynamics). */
    beta_position: number;
    participant_sd: number;
  };
  search: {
    /** Base seconds per target. */
    sec_per_target: number;
    /** Extra seconds per target for low (below-AA) contrast. */
    below_aa_penalty_sec_per_target: number;
  };
}

export const GROUND_TRUTH: GroundTruth = {
  rt: {
    base_mu_ms: 470,
    sigma_ms: 40,
    tau_ms: 70,
    beta_log_contrast: -28,
    beta_negative_polarity: 18,
    beta_position: 4,
    congruency_effect_ms: 55,
    participant_sd_ms: 35,
  },
  hit: { intercept: 2.0, beta_log_contrast: 0.6, beta_position: -0.05 },
  falseAlarm: { intercept: -2.2, beta_below_aa: 0.4 },
  comprehension: { intercept: 1.0, beta_log_contrast: 0.9, beta_position: -0.07 },
  fatigue: { base: 1.4, beta_position: 0.35, beta_below_aa: 0.9, participant_sd: 0.8, item_sd: 0.6 },
  blink: { base_rate: 9, beta_position: 0.45, participant_sd: 2 },
  search: { sec_per_target: 2.2, below_aa_penalty_sec_per_target: 1.3 },
};
