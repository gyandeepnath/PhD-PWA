/**
 * Experiment timing & task configuration.
 *
 * Values are the bundle's authoritative numbers where known, with the audit refinements applied
 * (longer adaptation on polarity switch; neutral RT background; reading as a per-page minimum
 * floor rather than a hard cutoff). All are centralised here so a protocol change is one edit.
 */
const BASE_CONFIG = {
  /**
   * Inclusion age band, from the protocol. Named here rather than written inline so the profile
   * form's gate, the eligibility computation and the exported codebook cannot drift apart — which
   * they had: the code accepted 18 to 80 while the synopsis and the codebook both said 18 to 35.
   */
  MIN_AGE: 18,
  MAX_AGE: 35,

  // Reading: per-page minimum dwell (rAF-gated). The Next button unlocks after this; the
  // participant may take longer (self-paced). reading_time_ms is recorded.
  READING_PAGE_MIN_MS: 20000,
  READING_FONT_SIZE_PX: 22,
  READING_LINE_HEIGHT: 1.6,
  READING_MARGIN_PERCENT: 10,

  // Comprehension: post-answer feedback dwell.
  COMPREHENSION_FEEDBACK_MS: 1000,

  // Visual search: hard time limit.
  VS_TIME_LIMIT_MS: 40000,

  // Reaction time — pure colour go/no-go (one dot at a random location; respond only to the target
  // colour), run under the active display condition. Tuned for fatigue/attention-stability goals.
  RT_TRIALS_PER_CONDITION: 32,
  /** Proportion of go (target-colour) trials. 0.625 → 20 go / 12 no-go per condition. */
  RT_GO_RATE: 0.625,
  /** Unscored practice trials shown once, before the first condition's scored block. */
  RT_PRACTICE_TRIALS: 6,
  /** Max time to respond; the trial ends the instant a response is made (only no-go trials wait it out). */
  RT_RESPONSE_WINDOW_MS: 1000,
  RT_FIXATION_MIN_MS: 300,
  RT_FIXATION_MAX_MS: 500,
  RT_DELAY_MIN_MS: 400,
  RT_DELAY_MAX_MS: 900,
  RT_ITI_MIN_MS: 300,
  RT_ITI_MAX_MS: 500,
  RT_DOT_PX: 52,
  /** Responses faster than this (ms) are anticipations — excluded from RT means, counted separately. */
  RT_MIN_VALID_RT_MS: 150,
  /** Valid hits slower than this (ms) count as attention lapses (PVT-style). */
  RT_LAPSE_THRESHOLD_MS: 600,
  /**
   * Go-target: ACHROMATIC, defined relative to the active background — black on light fields,
   * white on dark ones (synopsis §3.6). Target contrast is therefore maximal (21:1) and
   * IDENTICAL in both polarities, so target salience does not vary with display condition and
   * no target hue coincides with the text-colour manipulation.
   *
   * This replaced a fixed green target, which was justified as "the only colour not used by any
   * display condition" — a justification that expired the moment green was added as a fifth text
   * colour. Leaving it would have made the go-target collide with conditions P5/N5, confounding
   * go-signal detectability with the colour factor.
   *
   * The discrimination becomes achromatic-against-chromatic rather than hue-against-hue. That is
   * an easier discrimination, but it preserves the two fatigue-sensitive indices the task exists
   * to measure: reaction-time variability and lapse rate.
   */
  RT_TARGET_LIGHT_BG: '#000000',
  RT_TARGET_DARK_BG: '#FFFFFF',
  /** Distractors: the four chromatic text colours from the condition set. */
  RT_DISTRACTOR_COLORS: ['#C81E1E', '#1E4ED8', '#C9A400', '#00A651'],

  // Adaptation: longer than the original 20 s; doubled on a polarity switch.
  ADAPTATION_SAME_POLARITY_MS: 60000,
  ADAPTATION_SWITCH_POLARITY_MS: 120000,
  ADAPTATION_COLOR: '#808080',

  // Boredom mitigation: a self-paced rest break is offered after every N completed conditions
  // (but never after the last condition of the sitting). Keeps participants fresh without giving
  // any performance feedback that could differentially change effort across conditions.
  BREAK_EVERY_N_CONDITIONS: 2,
  /**
   * Conditions per sitting within ONE illumination block: 10 = the whole block in one sitting,
   * 5 = split into two shorter sittings. The pilot feasibility gate (§3.6) decides which: if the
   * median session runs over 120 min, or withdrawals exceed 1 in 10, or face-presence drops below
   * 0.90 in more than 10% of runs, each illumination level is split into two sittings of five,
   * preserving the counterbalancing scheme and the global serial-position record.
   */
  CONDITIONS_PER_SESSION_DEFAULT: 10,

  /**
   * Length of one retained reading-video segment for the manual blink-annotation sub-study.
   * The synopsis specifies two 3-minute segments per participant in the validation subsample, one
   * per illumination level — so one segment per session at 3 minutes.
   */
  ANNOTATION_SEGMENT_MS: 180000,

  // Camera.
  CAMERA_WIDTH: 1280,
  CAMERA_HEIGHT: 720,
  CAMERA_FPS: 30,
  // Process every camera frame: blinks last 100-400 ms, so ~30 fps is the literature minimum for
  // valid blink detection (sub-Nyquist below ~25 fps). Raise to 2 only if a slow tablet can't keep
  // up — effective_fps records the true achieved rate and gates the duration-based tiers.
  PROCESS_EVERY_N_FRAMES: 1,
};

/** True when running under the E2E harness (?e2e=1) — collapses long waits for fast tests. */
function isE2E(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');
  } catch {
    return false;
  }
}

/** Shortened timings/trial counts for E2E. Identical structure to BASE_CONFIG. */
const E2E_OVERRIDES: Partial<typeof BASE_CONFIG> = {
  READING_PAGE_MIN_MS: 150,
  COMPREHENSION_FEEDBACK_MS: 120,
  VS_TIME_LIMIT_MS: 5000,
  RT_TRIALS_PER_CONDITION: 4,
  RT_PRACTICE_TRIALS: 1,
  RT_RESPONSE_WINDOW_MS: 120,
  RT_FIXATION_MIN_MS: 30,
  RT_FIXATION_MAX_MS: 40,
  RT_DELAY_MIN_MS: 30,
  RT_DELAY_MAX_MS: 50,
  RT_ITI_MIN_MS: 20,
  RT_ITI_MAX_MS: 30,
  ADAPTATION_SAME_POLARITY_MS: 200,
  ADAPTATION_SWITCH_POLARITY_MS: 300,
  ANNOTATION_SEGMENT_MS: 400,
};

export const CONFIG = isE2E() ? { ...BASE_CONFIG, ...E2E_OVERRIDES } : BASE_CONFIG;

/** Number of measured sub-stages per condition (excludes ADAPTATION). */
export const TASKS_PER_CONDITION = 6;
