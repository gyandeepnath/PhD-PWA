/**
 * Experiment timing & task configuration.
 *
 * Values are the bundle's authoritative numbers where known, with the audit refinements applied
 * (longer adaptation on polarity switch; neutral RT background; reading as a per-page minimum
 * floor rather than a hard cutoff). All are centralised here so a protocol change is one edit.
 */
const BASE_CONFIG = {
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

  // Reaction time (colour go/no-go). Default is a PURE colour go/no-go (one dot at a random
  // location) — best matched to the fatigue/attention-stability hypothesis and to RT-variability
  // reliability. Set RT_USE_FLANKERS true to add the Eriksen flanker congruency layer instead.
  RT_USE_FLANKERS: false,
  RT_TRIALS_PER_CONDITION: 40,
  /** Proportion of go (target-colour) trials when not using flankers. */
  RT_GO_RATE: 0.6,
  /** Max time to respond. The trial ends as soon as a response is made (efficiency); only no-go
   *  trials wait out the full window. */
  RT_RESPONSE_WINDOW_MS: 1000,
  RT_FIXATION_MIN_MS: 300,
  RT_FIXATION_MAX_MS: 500,
  RT_DELAY_MIN_MS: 400,
  RT_DELAY_MAX_MS: 900,
  RT_ITI_MIN_MS: 300,
  RT_ITI_MAX_MS: 500,
  RT_FLANKER_DOT_PX: 44,
  RT_FLANKER_SPACING_PX: 56,
  /** Go-target colour: GREEN — the only colour not used by any display condition, so the target is
   *  constant and unconfounded across conditions (protocol §11: "respond only to the target colour").
   *  Stimuli render on the CONDITION's own background, keeping the participant under the display. */
  RT_TARGET_COLOR: '#00A651',
  RT_DISTRACTOR_COLORS: ['#C81E1E', '#1E4ED8', '#C9A400'],

  // Adaptation: longer than the original 20 s; doubled on a polarity switch.
  ADAPTATION_SAME_POLARITY_MS: 60000,
  ADAPTATION_SWITCH_POLARITY_MS: 120000,
  ADAPTATION_COLOR: '#808080',

  // Camera.
  CAMERA_WIDTH: 1280,
  CAMERA_HEIGHT: 720,
  CAMERA_FPS: 30,
  PROCESS_EVERY_N_FRAMES: 2,
  EAR_CALIBRATION_SAMPLES: 150,

  // Touch target minimum.
  MIN_TOUCH_TARGET_PX: 48,
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
  RT_RESPONSE_WINDOW_MS: 120,
  RT_FIXATION_MIN_MS: 30,
  RT_FIXATION_MAX_MS: 40,
  RT_DELAY_MIN_MS: 30,
  RT_DELAY_MAX_MS: 50,
  RT_ITI_MIN_MS: 20,
  RT_ITI_MAX_MS: 30,
  ADAPTATION_SAME_POLARITY_MS: 200,
  ADAPTATION_SWITCH_POLARITY_MS: 300,
};

export const CONFIG = isE2E() ? { ...BASE_CONFIG, ...E2E_OVERRIDES } : BASE_CONFIG;

/** Number of measured sub-stages per condition (excludes ADAPTATION). */
export const TASKS_PER_CONDITION = 6;
