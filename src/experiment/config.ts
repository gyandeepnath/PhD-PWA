/**
 * Experiment timing & task configuration.
 *
 * Values are the bundle's authoritative numbers where known, with the audit refinements applied
 * (longer adaptation on polarity switch; neutral RT background; reading as a per-page minimum
 * floor rather than a hard cutoff). All are centralised here so a protocol change is one edit.
 */
export const CONFIG = {
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

  // Reaction time (Eriksen colour flanker, go/no-go).
  RT_TRIALS_PER_CONDITION: 48,
  RT_RESPONSE_WINDOW_MS: 1500,
  RT_FIXATION_MIN_MS: 400,
  RT_FIXATION_MAX_MS: 600,
  RT_DELAY_MIN_MS: 800,
  RT_DELAY_MAX_MS: 1500,
  RT_ITI_MIN_MS: 400,
  RT_ITI_MAX_MS: 700,
  RT_FLANKER_DOT_PX: 44,
  RT_FLANKER_SPACING_PX: 56,
  /** Target dots and flankers sit on a fixed neutral background to decouple salience from
   *  condition polarity (audit fix — red dot is 5.74:1 on white vs 3.66:1 on black). */
  RT_STIMULUS_BACKGROUND: '#808080',
  RT_TARGET_COLOR: '#C81E1E',
  RT_DISTRACTOR_COLORS: ['#1E4ED8', '#C9A400', '#00A651'],

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
} as const;

/** Number of measured sub-stages per condition (excludes ADAPTATION). */
export const TASKS_PER_CONDITION = 6;
/** Setup stages tracked in the progress bar. */
export const SETUP_STEPS = 4;
