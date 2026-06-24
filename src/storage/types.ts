/**
 * VisuLab data model (IndexedDB schema v6).
 *
 * Carries the original v5 stores forward and adds the refinement fields from the literature
 * audit: vision covariates, display photometry, decoupled passage_id, effective FPS,
 * within-task blink bins, CVS-Q, session position, slider touched-flags, and build provenance.
 * All physical units are explicit in field names (ms, deg, cd/m2, ratio, 0-10).
 */
import type { Polarity, WcagLevel } from './schemaEnums';

export type Stage =
  | 'SESSION_INIT'
  | 'CONSENT'
  | 'PARTICIPANT_PROFILE'
  | 'COLOR_VISION'
  | 'PREFLIGHT'
  | 'CAMERA_SETUP'
  | 'CALIBRATION'
  | 'CVSQ_BASELINE'
  | 'BASELINE_FATIGUE'
  | 'INSTRUCTIONS'
  | 'READING_TASK'
  | 'COMPREHENSION'
  | 'DISPLAY_PERCEPTION'
  | 'POST_FATIGUE'
  | 'VISUAL_SEARCH'
  | 'REACTION_TIME'
  | 'ADAPTATION'
  | 'BREAK_SCREEN'
  | 'SESSION_COMPLETE'
  | 'CVSQ_END'
  | 'EXPORT_DASHBOARD';

export type CameraStatus = 'active' | 'denied' | 'failed' | 'unavailable';

/** Build/version provenance stamped into sessions and exports. */
export interface Provenance {
  app_version: string;
  git_hash: string;
  build_time: string;
  condition_def_hash: string;
  schema_version: number;
}

export interface ParticipantRecord {
  participant_id: string;
  /** Sequential enrolment index (1-based) — drives counterbalancing, NOT a hash of the ID. */
  enrolment_number: number;
  age: number;
  gender: string;
  /** Numeric daily screen hours (refined from the original free-text/string). */
  daily_screen_hours: number;
  device_familiarity: 'low' | 'moderate' | 'high';
  lighting_habit: 'bright' | 'moderate' | 'dim';

  // --- Vision covariates (audit additions) ---
  correction_type: 'none' | 'glasses' | 'contacts';
  /** Self-reported / screened colour-vision status. */
  cvd_status: 'normal' | 'self_reported_deficient' | 'screen_failed' | 'unknown';
  /** Digital Ishihara screening score (plates correct / total), null if not run. */
  ishihara_correct: number | null;
  ishihara_total: number | null;
  /** Optional context covariates. */
  caffeine_today: boolean | null;
  hours_since_sleep: number | null;
  /** Eligibility gate outcome. */
  eligible: boolean;
  exclusion_reason: string | null;

  baseline_fatigue: number;
  session_id: string;
}

export interface SessionRecord {
  session_id: string;
  participant_id: string;
  enrolment_number: number;
  /** Lifecycle status for the session manager. */
  status: 'in_progress' | 'complete';
  /** Soft-delete tombstone (ms). Non-null = in the recycle bin; auto-purged after 30 days. */
  deleted_at: number | null;
  /** Optional researcher-editable display label (rename). Falls back to participant_id. */
  display_label: string | null;
  ambient_lux: number;
  /** Ambient illumination category (study IV) selected by the researcher; null if not set. */
  ambient_illumination_level: 'low' | 'moderate' | 'high' | null;
  /** Measured white-screen luminance (cd/m2), entered by researcher; null if not measured. */
  screen_white_luminance_cd_m2: number | null;
  /** Locked display brightness percentage, null if unknown. */
  brightness_percent: number | null;
  session_start_time: number;
  session_end_time: number | null;
  /** Deterministic order driver. */
  randomisation_seed: number;
  /** Ordered condition indices (into CONDITIONS) for this participant. */
  condition_order: number[];
  /** Pre-flight checklist fully completed. */
  preflight_complete: boolean;
  /** Informed consent recorded. */
  consent_given: boolean;
  consent_time: number | null;
  provenance: Provenance;
  device_type: string;
  browser: string;
  screen_resolution: string;

  // --- Split-session / boredom-mitigation fields ---
  /** How many of the 8 conditions are run in this sitting (8 = single session, 4 = split). */
  conditions_per_session: number;
  /** Conditions already completed by this participant in prior sittings (global serial offset). */
  condition_offset: number;
  /** 1-based sitting number for this participant (1 for a single session or the first split). */
  session_index: number;
}

export interface ConditionRecord {
  condition_id: string;
  session_id: string;
  /** Serial position in this session (0-7) — fatigue-accumulation covariate. */
  session_position: number;
  condition_label: string;
  polarity: Polarity;
  background_color: string;
  text_color: string;
  color_name: string;
  /** Decoupled passage shown under this condition. */
  passage_id: number;
  // Photometric covariates (computed; see lib/contrast.ts).
  wcag_contrast_ratio: number;
  wcag_level: WcagLevel;
  michelson_contrast: number;
  below_wcag_aa: boolean;
  started_at: number;
  completed_at: number | null;
  condition_duration_sec: number | null;
  /** Adaptation duration that preceded this condition (ms) — varies on polarity switch. */
  adaptation_ms_before: number;
  /** Total time spent on the reading task (ms), self-paced; null until reading completes. */
  reading_time_ms: number | null;
}

export type FatigueStage = 'baseline' | 'post_condition';

export interface FatigueRecord {
  fatigue_id: string;
  session_id: string;
  condition_id: string | null;
  stage: FatigueStage;
  eye_strain: number;
  dryness: number;
  blur: number;
  burning: number;
  headache: number;
  fatigue_mean: number;
  /** Per-item touched flags — distinguishes a genuine 0 from an untouched slider. */
  touched: {
    eye_strain: boolean;
    dryness: boolean;
    blur: boolean;
    burning: boolean;
    headache: boolean;
  };
  all_touched: boolean;
  /** Time from scale mount to submit (ms) — engagement/careless-responding signal. */
  response_time_ms: number | null;
}

/** Validated CVS-Q (Seguí 2015): 16 items, frequency x intensity, cutoff >=6. Baseline + end only. */
export interface CvsqRecord {
  cvsq_id: string;
  session_id: string;
  stage: 'baseline' | 'session_end';
  /** Per-item frequency (0 never, 1 occasionally, 2 often/always). */
  frequency: number[];
  /** Per-item intensity (1 moderate, 2 intense); 0 when frequency is 0. */
  intensity: number[];
  /** Total CVS-Q score (sum of frequency x intensity weights). */
  total_score: number;
  symptomatic: boolean;
  /** Time from questionnaire mount to submit (ms) — engagement signal. */
  response_time_ms: number | null;
}

export interface DisplayPerceptionRecord {
  perception_id: string;
  session_id: string;
  condition_id: string;
  display_comfort_score: number; // 0-100
  text_clarity_score: number; // 0-100
  comfort_touched: boolean;
  clarity_touched: boolean;
  /** Time from rating mount to submit (ms) — engagement signal. */
  response_time_ms: number | null;
}

export interface ComprehensionRecord {
  comprehension_id: string;
  session_id: string;
  condition_id: string;
  passage_id: number;
  selected_index: number;
  correct_index: number;
  is_correct: boolean;
  response_time_ms: number;
}

export type SearchTermination =
  | 'time_limit'
  | 'voluntary_full'
  | 'voluntary_early'
  | 'session_terminated';

export interface VisualSearchRecord {
  condition_id: string;
  session_id: string;
  passage_id: number;
  search_target: string;
  /** Authoritative target occurrences (computed from passage). */
  targets_in_set: number;
  search_time_ms: number;
  time_to_first_target_ms: number | null;
  targets_found: number;
  targets_missed: number;
  false_detections: number;
  accuracy_rate: number;
  search_efficiency: number; // hits per minute
  mean_inter_target_interval_ms: number | null;
  termination_mode: SearchTermination;
}

export type RtAccuracy = 'hit' | 'miss' | 'false_alarm' | 'correct_rejection';

export interface ReactionTrialRecord {
  trial_id: string;
  condition_id: string;
  session_id: string;
  trial_number: number;
  trial_category: 'signal_congruent' | 'signal_incongruent' | 'noise_congruent' | 'noise_incongruent';
  is_signal: boolean;
  is_congruent: boolean;
  stimulus_onset_time: number;
  response_time_ms: number | null;
  accuracy: RtAccuracy;
  false_start: boolean;
  /** Response faster than the anticipation cutoff (excluded from RT means, counted separately). */
  anticipatory: boolean;
}

export interface RtSummaryRecord {
  condition_id: string;
  session_id: string;
  total_trials: number;
  signal_trials: number;
  hits: number;
  false_alarms: number;
  misses: number;
  correct_rejections: number;
  hit_rate: number;
  false_alarm_rate: number;
  mean_rt_hits_ms: number | null;
  median_rt_hits_ms: number | null;
  rt_sd_ms: number | null;
  mean_rt_congruent_ms: number | null;
  mean_rt_incongruent_ms: number | null;
  flanker_congruency_effect_ms: number | null;
  /** Overall error rate = (misses + false alarms) / total trials. */
  error_rate: number;
  /** RT coefficient of variation (SD/mean) — fatigue often shows as inconsistency before slowing. */
  rt_cv: number | null;
  /** Responses faster than the anticipation cutoff (excluded from RT means). */
  anticipations: number;
  /** Valid hits slower than the lapse threshold, and the rate over hits — PVT attention-lapse index. */
  lapse_count: number;
  lapse_rate: number;
  /** Inverse efficiency score = mean RT / proportion correct — speed-accuracy tradeoff control. */
  inverse_efficiency_ms: number | null;
  /** Vigilance: mean hit RT in the first vs second half of the block (rising = within-block fatigue). */
  first_half_mean_rt_ms: number | null;
  second_half_mean_rt_ms: number | null;
  d_prime: number;
  /** Standard error of d' (flag if > 0.3 — small-N instability). */
  d_prime_se: number;
  d_prime_unstable: boolean;
}

/** Per-task within-window blink bins to capture fatigue *dynamics* (rising rate = fatigue). */
export interface BlinkBins {
  first_half_blink_rate: number | null;
  second_half_blink_rate: number | null;
}

export interface EyeMetricsRecord {
  condition_id: string;
  session_id: string;
  camera_active: boolean;
  /** Effective achieved sampling rate (frames actually processed/sec). */
  effective_fps: number | null;
  /** True when effective_fps >= 25; gates the micro/partial blink tiers. */
  fps_adequate_for_tiers: boolean;

  // Primary (defensible at ~15 fps)
  blink_rate: number;
  blink_rate_full: number;
  incomplete_blink_ratio: number;
  blink_duration_mean_ms: number | null;
  bins: BlinkBins;
  /** Blink rate change vs session baseline (interpretation aid). */
  blink_rate_delta_from_baseline: number | null;

  // Diagnostic only (sub-Nyquist at 15 fps — flagged in codebook)
  blink_rate_micro: number;
  blink_count_full: number;
  blink_count_partial: number;
  blink_count_micro: number;
  blink_count_incomplete: number;

  ear_baseline: number | null;
  ear_threshold_used: number | null;

  // Head pose (continuous; thresholds raised; smoothed)
  head_pitch_mean: number;
  head_yaw_mean: number;
  head_roll_mean: number;
  head_movement_std: number;
  postural_load: number;
  head_stability_score: number;
  off_axis_ratio: number;

  // Gaze (only meaningful if real calibration ran)
  gaze_calibrated: boolean;
  gaze_deviation_ratio: number;
  zone_center_ratio: number;
  zone_transition_count: number;

  face_presence_ratio: number;
  face_size_ratio: number;
}

export interface PerformanceLogRecord {
  log_id: string;
  session_id: string;
  participant_id: string;
  timestamp: number;
  condition_id: string | null;
  condition_index: number;
  fps_estimate: number;
  frame_interval_ms: number;
  dropped_frames_estimate: number;
  memory_used_mb: number | null;
  memory_total_mb: number | null;
  battery_level: number | null;
  browser_name: string;
  browser_version: string;
  platform: string;
  screen_width: number;
  screen_height: number;
  device_pixel_ratio: number;
}

export interface CalibrationRecord {
  calibration_id: string;
  session_id: string;
  /** True only when real per-participant gaze mapping was fitted (vs positioning check). */
  is_real_calibration: boolean;
  /** Per-target detection success. */
  targets_detected: number;
  targets_total: number;
  ear_baseline: number | null;
  /** Fitted iris-offset thresholds (if real calibration). */
  gaze_h_threshold: number | null;
  gaze_v_threshold: number | null;
}

/** Maps store names to their record types for type-safe DB access. */
export interface StoreMap {
  participants: ParticipantRecord;
  sessions: SessionRecord;
  conditions: ConditionRecord;
  fatigue_scores: FatigueRecord;
  cvsq_scores: CvsqRecord;
  display_perception: DisplayPerceptionRecord;
  comprehension_results: ComprehensionRecord;
  visual_search: VisualSearchRecord;
  reaction_trials: ReactionTrialRecord;
  rt_summaries: RtSummaryRecord;
  eye_metrics: EyeMetricsRecord;
  calibration_data: CalibrationRecord;
  system_performance_logs: PerformanceLogRecord;
}

export type StoreName = keyof StoreMap;
