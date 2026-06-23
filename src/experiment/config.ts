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
  /** Go-target colour: GREEN — the only colour not used by any display condition (protocol §11). */
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
};

export const CONFIG = isE2E() ? { ...BASE_CONFIG, ...E2E_OVERRIDES } : BASE_CONFIG;

/** Number of measured sub-stages per condition (excludes ADAPTATION). */
export const TASKS_PER_CONDITION = 6;
