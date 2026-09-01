import type { QuestionKind } from '@/experiment/passages';
/**
 * VisuLab data model (IndexedDB schema v6).
 *
 * Carries the original v5 stores forward and adds the refinement fields from the literature
 * audit: vision covariates, display photometry, decoupled passage_id, effective FPS,
 * within-task blink bins, CVS-Q, session position, slider touched-flags, and build provenance.
 * All physical units are explicit in field names (ms, deg, cd/m2, ratio, 0-10).
 */
import type { Polarity, WcagLevel } from './schemaEnums';
import type { IlluminationLevel } from '@/experiment/illumination';
import type { MediaConsent, MediaRecord } from './media';

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
  | 'NASA_TLX'
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
  cvd_status: 'normal' | 'self_reported_deficient' | 'screen_failed' | 'screen_inconclusive' | 'unknown';
  /**
   * The app's own six-plate digital screen: plates correct / total, null if not run.
   *
   * NOT the Ishihara test, and no longer named as though it were. It has no published operating
   * characteristics and is a covariate and a flag, never the basis for exclusion.
   */
  cvd_screen_correct: number | null;
  cvd_screen_total: number | null;
  /**
   * The operator's FORMAL plate result (Ishihara or Farnsworth), which the operator manual already
   * requires alongside the app. This is what excludes.
   */
  cvd_clinical: 'normal' | 'deficient' | 'not_done';
  /**
   * The FIRST sitting's values, kept for continuity. Per-sitting values are on the session record:
   * this row is shared across a participant's sittings and cannot hold two of anything that varies
   * between them. Analyses that need caffeine or sleep as a covariate must read the session's.
   */
  caffeine_today: boolean | null;
  hours_since_sleep: number | null;
  /** Eligibility gate outcome. */
  eligible: boolean;
  exclusion_reason: string | null;

  /**
   * The FIRST sitting's pre-condition fatigue rating; null when none was administered. Per-sitting
   * baselines live in fatigue_scores (stage='baseline'), which is what fatigue_delta uses — this
   * record is shared across sittings and cannot hold two.
   */
  baseline_fatigue: number | null;
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
  /** Illuminance at the eye at session start, lux (the 'start' checkpoint reading). */
  ambient_lux: number;
  /**
   * Ambient illumination level — the session-level (whole-plot) IV. ASSIGNED by counterbalancing
   * from the enrolment number, not chosen: see experiment/illumination.ts.
   */
  ambient_illumination_level: IlluminationLevel | null;
  /** 0-based illumination block: 0 = this participant's first level, 1 = their second. */
  illumination_block: number;
  /** Which level the participant received first — the counterbalancing assignment, for reporting. */
  illumination_order_first: IlluminationLevel | null;
  /** Illuminance logged at start / middle / end of the session (§3.4). */
  lux_readings: { checkpoint: 'start' | 'middle' | 'end'; lux: number; at: number }[];
  /** True when every logged reading fell inside the accepted range for the assigned level. */
  lux_all_in_range: boolean | null;
  /** Set when the researcher ran the session outside the accepted lux range — a protocol deviation. */
  lux_deviation_note: string | null;
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
  /**
   * When this session was last exported. Null means this device holds the only copy of it, which
   * is why the recycle bin refuses to auto-purge such a session however long it has been there.
   */
  exported_at?: number | null;
  /**
   * True when this session ran with the E2E harness's collapsed timing constants. Such a session is
   * a test artefact, not data: every protocol duration was replaced with a token value.
   */
  e2e_timing: boolean;
  /**
   * Condition index this sitting should resume at, 0-based. Held here as well as in localStorage
   * because the two are evicted independently: a browser that clears site data partially can take
   * the localStorage pointer while leaving every measurement in IndexedDB, which turned a resumable
   * session into an uncontinuable one with all its data intact.
   */
  resume_next_index?: number;
  /**
   * State covariates recorded at THIS sitting's profile stage.
   *
   * They live here and not on the participant record because they legitimately differ between the
   * two sittings — that is the point of collecting them — while the participant record is created
   * once and shared across both. Holding them there meant sitting 2 overwrote sitting 1's values
   * and the analysis saw one participant with a single caffeine/sleep state for both sessions.
   */
  caffeine_today?: boolean | null;
  hours_since_sleep?: number | null;
  /**
   * Whether the vendored stimulus typeface was actually available when pre-flight ran. null where
   * the browser gave no answer. The typeface is part of the display condition, so a session that
   * rendered the passage in a fallback face is a session whose stimulus differed from the others.
   */
  stimulus_font_ok?: boolean | null;
  /** Informed consent recorded. */
  consent_given: boolean;
  consent_time: number | null;
  /**
   * Granular media permissions. Separate from consent_given because §3.10 requires camera-based
   * measurement to be refusable without affecting participation — and retaining pixels is a
   * strictly stronger ask than deriving numbers from them, so it needs its own grant.
   */
  media_consent: MediaConsent;
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
  /** Serial position in this session (0-9) — fatigue-accumulation covariate. */
  session_position: number;
  condition_label: string;
  polarity: Polarity;
  background_color: string;
  text_color: string;
  /** Text-colour factor level: achromatic | blue | red | yellow | green (same 5 in both polarities). */
  color_name: string;
  /** Human-readable ink name (black/white/blue/...). Display only, never an analysis factor. */
  ink_name: string;
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
  /**
   * How many times this participant has now read this passage, counting this run: 1 in the first
   * sitting, 2 in the second. There are ten passages and twenty condition-runs, so every passage is
   * re-read. Illumination is confounded with session order within a participant, so without this
   * column the practice effect is indistinguishable from the illumination main effect.
   */
  passage_repeat_number: number;
  /** Total time spent on the reading task (ms), self-paced; null until reading completes. */
  /** Reading exposure, with any time the app spent hidden already subtracted. */
  reading_time_ms: number | null;
  /** The unadjusted span, so the adjustment is auditable rather than silent. */
  reading_wall_clock_ms?: number | null;
  /** Time the app was backgrounded or the screen off during the passage. */
  reading_hidden_ms?: number | null;
  /** Dwell on each page in order. */
  reading_page_dwells_ms?: number[];
  /** Shortest single-page dwell. The skim signal: a page finished at its unlock was not read. */
  reading_min_page_dwell_ms?: number | null;
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
  /**
   * The recall frame the participant was given.
   *
   * 'habitual_computer_work' is the validated CVS-Q frame, whose frequency anchors are defined in
   * events per week and whose >= 6 cut-off is calibrated against it. 'this_session' is a deliberate
   * re-anchoring to the ~90-minute exposure: a coherent question, but a DEVIATION from the
   * validated instrument, so its total must not be read against the published cut-off or against
   * published norms. Recorded per row because the two are otherwise indistinguishable in the data.
   */
  frame: 'habitual_computer_work' | 'this_session';
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

/**
 * NASA-TLX, once per session (Hart & Staveland, 1988). Session-level, not per-condition — so it
 * supports inference about the ILLUMINATION contrast only; see scales/nasaTlx.ts.
 */
export interface NasaTlxRecord {
  tlx_id: string;
  session_id: string;
  /** Raw responses as given, 0-100 in steps of 5. Performance is NOT reversed here. */
  mental_demand: number;
  physical_demand: number;
  temporal_demand: number;
  performance: number;
  effort: number;
  frustration: number;
  /** Unweighted mean of the six load-aligned subscales (Performance reversed), 0-100. */
  raw_tlx: number;
  /** Performance after reversal, stored so the composite is reproducible from the columns. */
  /** Every slider must be touched before submit; retained as a data-quality flag. */
  all_touched: boolean;
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

/**
 * One row per comprehension ITEM, not per condition. Each passage carries three items (gist,
 * inference, detail), so a condition contributes three of these. Anything joining this store to a
 * condition must aggregate rather than take the first match.
 */
export interface ComprehensionRecord {
  comprehension_id: string;
  session_id: string;
  condition_id: string;
  passage_id: number;
  /** Position of the item within the passage, 0-based. */
  question_index: number;
  /** What the item probes, so accuracy can be reported by item type rather than pooled. */
  question_kind: QuestionKind;
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
  /** Sensitivity over words as trials. Immune to a tap-everything strategy, which accuracy_rate is not. */
  search_d_prime: number | null;
  /** Non-target words available to be wrongly tapped. */
  distractor_words: number;
  accuracy_rate: number;
  search_efficiency: number; // hits per minute
  mean_inter_target_interval_ms: number | null;
  termination_mode: SearchTermination;
}

/**
 * 'anticipation' is its own outcome, not a hit or a false alarm.
 *
 * A response faster than the anticipation cutoff cannot reflect stimulus processing. Folding it
 * into hit/false_alarm credited a participant who had stopped watching with detections, and the
 * credit was largest exactly where disengagement was largest.
 */
export type RtAccuracy = 'hit' | 'miss' | 'false_alarm' | 'correct_rejection' | 'anticipation';

export interface ReactionTrialRecord {
  trial_id: string;
  condition_id: string;
  session_id: string;
  trial_number: number;
  /** Go/no-go trial type. (This task has no flanker/congruency manipulation.) */
  trial_category: 'signal' | 'noise';
  is_signal: boolean;
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
  /** Overall error rate = (misses + false alarms) / total trials. */
  error_rate: number;
  /** RT coefficient of variation (SD/mean) — fatigue often shows as inconsistency before slowing. */
  rt_cv: number | null;
  /** Responses faster than the anticipation cutoff (excluded from RT means). */
  anticipations: number;
  /** Valid hits slower than the lapse threshold, and the rate over hits — PVT attention-lapse index. */
  lapse_count: number;
  /** Lapses as a proportion of VALID hits. Null when there were none — a condition in which the
   *  participant stopped responding has no lapse rate, and 0 would be the best possible value. */
  lapse_rate: number | null;
  /** Inverse efficiency score = mean RT / proportion correct — speed-accuracy tradeoff control. */
  inverse_efficiency_ms: number | null;
  /** Vigilance: mean hit RT in the first vs second half of the block (rising = within-block fatigue). */
  first_half_mean_rt_ms: number | null;
  second_half_mean_rt_ms: number | null;
  /**
   * Sensitivity d'. NULL when the block produced no trials at all - treat as missing, never as 0.
   * A 0 is a substantive claim of zero sensitivity and will be averaged alongside real values.
   */
  d_prime: number | null;
  /** Standard error of d' (flag if > 0.3 — small-N instability). Null when d' is not estimable. */
  d_prime_se: number | null;
  d_prime_unstable: boolean;
  /** SDT response bias c = -0.5·(zH+zF): >0 conservative (fewer responses), <0 liberal. */
  criterion: number | null;
  /** False when d'/criterion/SE could not be estimated from the trials recorded. */
  d_prime_estimable: boolean;
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
  /**
   * Whether the frame rate supports the PRIMARY OUTCOME. Undersampling biases the measured minimum
   * EAR upward and so inflates incomplete_blink_ratio; it is not symmetric noise. False does not
   * mean the condition should be dropped — see FPS_RATIO_THRESHOLD — but it does mean the ratio
   * carries a known directional bias and must be modelled or sensitivity-tested.
   */
  fps_adequate_for_ratio: boolean;
  /**
   * Milliseconds of the exposure actually observed, dropouts excluded. Compare against
   * reading_time_ms: a large shortfall means the camera stopped part-way and every rate in this row
   * describes only the fraction that was seen.
   */
  observed_duration_ms: number | null;
  /** EAR samples behind this row. Zero means nothing was measured, whatever the other columns say. */
  ear_sample_count: number;

  // Primary (frame-rate-robust): CVS markers + drowsiness covariates.
  /**
   * Null when the camera was not running. Not 0 — a zero blink rate is a measurement, and reporting
   * one for a condition that was never observed manufactures the cleanest possible datum out of no
   * data. See the note on incomplete_blink_ratio.
   */
  blink_rate: number | null;
  blink_rate_full: number | null;
  /**
   * PRIMARY OUTCOME. Null when no blinks were detected in the condition - a proportion of an empty
   * set is undefined. Treat null as missing, never as 0.
   */
  incomplete_blink_ratio: number | null;
  blink_duration_mean_ms: number | null;
  bins: BlinkBins;
  /** Inter-blink interval (ms) + its CV — longer/erratic with reduced blinking. */
  mean_inter_blink_interval_ms: number | null;
  inter_blink_interval_cv: number | null;
  /** PERCLOS: proportion of time eyes ≥80% / ≥70% closed (validated drowsiness measure). */
  perclos_p80: number | null;
  perclos_p70: number | null;
  /** Sustained eye-closure (>500 ms) events — long-closure / micro-sleep proxy. */
  long_closure_count: number | null;
  long_closure_total_ms: number | null;

  // Diagnostic only (sub-Nyquist below ~25 fps; JSON bundle only, not in the CSV bundle)
  blink_rate_micro: number | null;
  blink_count_full: number | null;
  blink_count_micro: number | null;
  blink_count_incomplete: number | null;

  ear_baseline: number | null;
  /** EAR at which a blink is REGISTERED (0.75 x this participant's baseline). */
  ear_threshold_used: number | null;
  /** EAR at or below which a blink counts as COMPLETE (0.60 x baseline). Both are needed to
   *  reproduce the classification from the exported data. */
  ear_complete_threshold: number | null;

  // Head pose (continuous; thresholds raised; smoothed)
  head_pitch_mean: number | null;
  /** True when head_pitch_mean is relative to the participant's calibrated frontal posture (0° =
   *  their straight-ahead), vs the uncalibrated population default. */
  head_pitch_calibrated: boolean;
  head_yaw_mean: number | null;
  head_roll_mean: number | null;
  head_movement_std: number | null;
  postural_load: number | null;
  head_stability_score: number | null;
  off_axis_ratio: number | null;

  // Gaze (only meaningful if real calibration ran)
  gaze_calibrated: boolean;
  gaze_deviation_ratio: number | null;
  zone_center_ratio: number | null;
  zone_transition_count: number;

  face_presence_ratio: number | null;
  face_size_ratio: number | null;

  /** Mean frame luminance (0-255, BT.601) over the condition — webcam exposure / room-light QC. */
  mean_face_luma: number | null;
  /** Classified lighting quality; null when the camera was inactive. */
  lighting_quality: 'low' | 'good' | 'overexposed' | null;
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
  /** Participant's frontal nose fraction (pitch zero); null if not captured. Lets head pitch be
   *  reported relative to this person's natural straight-ahead posture rather than a population mean. */
  pitch_baseline_frac: number | null;
  /**
   * When this calibration was taken. Required to choose between two of them: a resume re-runs
   * calibration, so a session can hold more than one, and the export used to take whichever sorted
   * first by random uuid — a coin toss between the calibration that governed the first half of the
   * sitting and the one that governed the second.
   */
  calibrated_at?: number;
}

/** Maps store names to their record types for type-safe DB access. */
export interface StoreMap {
  participants: ParticipantRecord;
  sessions: SessionRecord;
  conditions: ConditionRecord;
  fatigue_scores: FatigueRecord;
  cvsq_scores: CvsqRecord;
  nasa_tlx: NasaTlxRecord;
  media_captures: MediaRecord;
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
