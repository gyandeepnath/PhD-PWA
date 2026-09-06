/**
 * Per-condition aggregation. Joins conditions with RT/fatigue/search/perception/eye/comprehension
 * records into one row per condition (ordered by serial position). Used by both the dashboard
 * charts/tables and the wide-format CSV, so the numbers are guaranteed consistent.
 */
import type { SessionBundle } from '@/storage/gather';
import { CONFIG } from '@/experiment/config';
import { FPS_RATIO_THRESHOLD } from '@/tracking/blink';
import type { FatigueRecord, DisplayPerceptionRecord, ComprehensionRecord, RtSummaryRecord, EyeMetricsRecord } from '@/storage/types';
import { PASSAGES } from '@/experiment/passages';

export type QcFlag = 'good' | 'warn' | 'bad';

/**
 * Engagement / careless-responding thresholds.
 *
 * Boredom and disengagement over a long within-subjects session mimic visual fatigue (slower,
 * more variable RT, lapses, rushed/straight-lined ratings, skimming). These thresholds flag
 * conditions whose data quality is suspect so the analyst can exclude or model them — they are
 * deliberately conservative so genuine responding is not discarded. All reuse existing recorded
 * fields; nothing extra is shown to the participant (no performance feedback → no confound).
 */
export const ENGAGEMENT = {
  /** Fatigue questionnaire (5 sliders) faster than this is implausibly rushed. */
  FATIGUE_RUSHED_MS: 3000,
  /** Perception rating (2 sliders) faster than this is implausibly rushed. */
  PERCEPTION_RUSHED_MS: 2000,
  /** Reading faster than wordCount / this (wpm) is an implausible skim (normal reading ≤ ~400 wpm). */
  SKIM_WPM_CEILING: 400,
  /**
   * A page advanced within this long of its own unlock was waited out, not read. Generous enough
   * that a reader who finishes just as the button becomes live is not flagged for a fast page.
   */
  PAGE_UNLOCK_GRACE_MS: 1500,
  /** Hidden time during a passage beyond this means the exposure window is not what it claims. */
  READING_HIDDEN_MAX_MS: 5000,
  /** RT block is disengaged if any of these existing rates exceed their cutoff. */
  RT_FALSE_ALARM_MAX: 0.3,
  RT_ERROR_MAX: 0.3,
  RT_LAPSE_MAX: 0.3,
  /** Camera face presence below this (when camera active) flags the participant turning away. */
  FACE_PRESENCE_MIN: 0.5,
  /**
   * Minimum blinks in a condition for its incomplete-blink RATIO to be worth interpreting.
   *
   * The ratio is a binomial proportion, so its precision depends entirely on how many blinks were
   * captured. At p = 0.16 the standard error is sqrt(p(1-p)/n): 30 blinks gives SE 0.067, 20 gives
   * 0.082, 10 gives 0.116. A ratio computed from a handful of blinks is not a measurement of that
   * condition, and averaging such values across participants does not rescue them — it propagates
   * the noise into the contrast the study exists to estimate.
   *
   * 20 is set as the floor at which the ratio is reported without a caveat. Runs below it are
   * flagged so they can be down-weighted or excluded in a sensitivity analysis, and so a thin
   * exposure window cannot be mistaken for a clean null.
   */
  MIN_BLINKS_FOR_RATIO: 20,
  /** quality_score >= GOOD → good; >= WARN → warn; else bad. */
  QUALITY_GOOD: 0.8,
  QUALITY_WARN: 0.5,
} as const;

export interface ConditionSummary {
  condition_id: string;
  condition_label: string;
  session_position: number;
  polarity: 'positive' | 'negative';
  color_name: string;
  passage_id: number | null;
  wcag_contrast_ratio: number;
  wcag_level: string;
  below_wcag_aa: boolean;

  // Reaction time
  mean_rt_hits_ms: number | null;
  hit_rate: number | null;
  false_alarm_rate: number | null;
  d_prime: number | null;
  d_prime_se: number | null;
  d_prime_unstable: boolean;
  criterion: number | null;

  // Fatigue
  fatigue_mean: number | null;
  fatigue_delta: number | null;
  eye_strain: number | null;
  dryness: number | null;
  blur: number | null;
  burning: number | null;
  headache: number | null;

  // Comprehension
  comprehension_correct: number | null;
  comprehension_rt_ms: number | null;

  // Reading + engagement / careless-responding (boredom/disengagement detection)
  reading_time_ms: number | null;
  fatigue_response_ms: number | null;
  perception_response_ms: number | null;
  /** Blinks captured during the condition; null when the camera was inactive. */
  blink_count_total: number | null;
  /** Too few blinks for the incomplete-blink ratio to be precise (see ENGAGEMENT.MIN_BLINKS_FOR_RATIO). */
  insufficient_blinks: boolean;
  /** Composite engagement flag and 0-1 quality score, with human-readable reasons. */
  engagement: QcFlag;
  quality_score: number;
  engagement_reasons: string[];
  /** Individual careless-responding signals (also exported in the quality-flags CSV). */
  careless_straight_lined: boolean;
  careless_rushed_fatigue: boolean;
  careless_rushed_perception: boolean;
  reading_skim: boolean;
  /** The app was backgrounded or the screen went off during the reading exposure. */
  reading_interrupted: boolean;
  comprehension_wrong: boolean;
  rt_disengaged: boolean;
  low_face_presence: boolean;

  // Visual search
  search_time_ms: number | null;
  search_accuracy: number | null;
  search_efficiency: number | null;
  false_detections: number | null;
  targets_found: number | null;
  targets_in_set: number | null;

  // Perception
  comfort_score: number | null;
  clarity_score: number | null;

  // Eye metrics + QC
  camera_active: boolean;
  blink_rate: number | null;
  blink_rate_full: number | null;
  incomplete_blink_ratio: number | null;
  mean_inter_blink_interval_ms: number | null;
  perclos_p80: number | null;
  perclos_p70: number | null;
  long_closure_count: number | null;
  effective_fps: number | null;
  fps_adequate_for_tiers: boolean;
  face_presence_ratio: number | null;
  off_axis_ratio: number | null;
  zone_center_ratio: number | null;
  mean_face_luma: number | null;
  lighting_quality: 'low' | 'good' | 'overexposed' | null;
  qc: { facePresence: QcFlag; fps: QcFlag; offAxis: QcFlag; lighting: QcFlag; overall: QcFlag };
}

function flag(value: number | null, good: number, warn: number, higherIsBetter = true): QcFlag {
  if (value == null) return 'bad';
  if (higherIsBetter) return value >= good ? 'good' : value >= warn ? 'warn' : 'bad';
  return value <= good ? 'good' : value <= warn ? 'warn' : 'bad';
}

const worst = (flags: QcFlag[]): QcFlag =>
  flags.includes('bad') ? 'bad' : flags.includes('warn') ? 'warn' : 'good';

export interface EngagementResult {
  engagement: QcFlag;
  quality_score: number;
  reasons: string[];
  /** Blinks captured in the condition; null when the camera was inactive. */
  blink_count_total: number | null;
  /** True when too few blinks were captured for the incomplete-blink ratio to be precise. */
  insufficient_blinks: boolean;
  careless_straight_lined: boolean;
  careless_rushed_fatigue: boolean;
  careless_rushed_perception: boolean;
  reading_skim: boolean;
  reading_interrupted: boolean;
  comprehension_wrong: boolean;
  rt_disengaged: boolean;
  low_face_presence: boolean;
}

/**
 * True when all five fatigue items are identical AND that value is not the floor.
 *
 * Straight-lining is a careless-responding signature, but "0 on every item" is also the expected
 * HONEST answer for a healthy 18-35 participant early in a sitting. Flagging it penalised exactly
 * the least symptomatic participants at exactly the earliest conditions — and since the
 * pre-registered sensitivity analysis re-fits the models excluding flagged conditions, it would
 * have removed preferentially the low-fatigue, early-position runs, biasing both the time-on-task
 * and the condition effects upward.
 *
 * The ceiling is exempted for the same reason in the other direction: five 10s late in a sitting
 * is a plausible report, not evidence of carelessness.
 */
function isStraightLined(fat?: FatigueRecord): boolean {
  if (!fat || !fat.all_touched) return false;
  const v = [fat.eye_strain, fat.dryness, fat.blur, fat.burning, fat.headache];
  if (!v.every((x) => x === v[0])) return false;
  return v[0] !== FATIGUE_MIN && v[0] !== FATIGUE_MAX;
}

/** Endpoints of the 0-10 per-item fatigue scale. */
const FATIGUE_MIN = 0;
const FATIGUE_MAX = 10;

/**
 * Per-condition engagement / careless-responding assessment. Pure and unit-tested. Each fired
 * signal subtracts a weight from a 1.0 quality score; the composite flag is derived from the
 * remaining score. Weighted so a single weak signal (e.g. one wrong MCQ) only warns, while the
 * strong behavioural signals (skim, RT disengagement) can push a condition to "bad".
 */
export function conditionEngagement(args: {
  reading_time_ms: number | null;
  /** Shortest single-page dwell; the per-page skim signal. */
  reading_min_page_dwell_ms?: number | null;
  /** Time the app was hidden during the passage. */
  reading_hidden_ms?: number | null;
  word_count: number | null;
  fatigue?: FatigueRecord;
  perception?: DisplayPerceptionRecord;
  comprehension?: ComprehensionRecord[];
  rt?: RtSummaryRecord;
  eye?: EyeMetricsRecord;
}): EngagementResult {
  const {
    reading_time_ms, reading_min_page_dwell_ms, reading_hidden_ms,
    word_count, fatigue, perception, comprehension, rt, eye,
  } = args;
  const reasons: string[] = [];
  let score = 1;
  const penalise = (amount: number, reason: string) => { score -= amount; reasons.push(reason); };

  /**
   * Reading skim, judged PER PAGE rather than over the whole passage.
   *
   * The whole-passage rule could barely fire. The dwell gate guarantees at least
   * 4 x 20 s = 80 s, while the corpus skim floor is 85.7-90.2 s, so the flag lived in a 5.6-10.2 s
   * band: a participant who waited out each countdown and paused two seconds longer per page was
   * never flagged, and a genuinely fast reader at ~440 wpm was flagged and had their fastest
   * conditions dropped.
   *
   * A page finished within a moment of its own unlock was not read — the participant was waiting,
   * not reading — and that is true regardless of how long they lingered on the others. The
   * whole-passage rule is kept as a second, independent signal.
   */
  const skimFloorMs = word_count != null && word_count > 0 ? (word_count / ENGAGEMENT.SKIM_WPM_CEILING) * 60000 : null;
  const wholePassageSkim = reading_time_ms != null && skimFloorMs != null && reading_time_ms < skimFloorMs;
  const pageWaitedOut = reading_min_page_dwell_ms != null
    && reading_min_page_dwell_ms < CONFIG.READING_PAGE_MIN_MS + ENGAGEMENT.PAGE_UNLOCK_GRACE_MS;
  const reading_skim = wholePassageSkim || pageWaitedOut;
  if (wholePassageSkim) {
    penalise(0.3, `reading skimmed (${Math.round(reading_time_ms!)}ms < ${Math.round(skimFloorMs!)}ms floor)`);
  } else if (pageWaitedOut) {
    penalise(0.3, `a page was advanced ${Math.round(reading_min_page_dwell_ms! - CONFIG.READING_PAGE_MIN_MS)}ms after its unlock — waited out, not read`);
  }

  // Time the app spent hidden during the passage: the participant was not looking at the stimulus,
  // and if it is large the ocular measures for this condition cover a window that includes it.
  const reading_interrupted = reading_hidden_ms != null && reading_hidden_ms > ENGAGEMENT.READING_HIDDEN_MAX_MS;
  if (reading_interrupted) {
    penalise(0.25, `app was hidden for ${Math.round(reading_hidden_ms! / 1000)}s during reading`);
  }

  // RT block disengagement — reuse existing rates.
  // An unmeasured false-alarm rate is not evidence of engagement OR of disengagement, so it must
  // not satisfy the comparison. `null > x` is false in JS, which happens to be right here, but
  // relying on that coercion would be an accident; the guard says so explicitly.
  const rt_disengaged = !!rt && (
    (rt.false_alarm_rate != null && rt.false_alarm_rate > ENGAGEMENT.RT_FALSE_ALARM_MAX) ||
    rt.error_rate > ENGAGEMENT.RT_ERROR_MAX ||
    (rt.lapse_rate != null && rt.lapse_rate > ENGAGEMENT.RT_LAPSE_MAX)
  );
  if (rt_disengaged) penalise(0.3, 'reaction-time block shows disengagement (high FA/error/lapse rate)');

  // Rushed questionnaires.
  const careless_rushed_fatigue = !!fatigue && fatigue.response_time_ms != null && fatigue.response_time_ms < ENGAGEMENT.FATIGUE_RUSHED_MS;
  if (careless_rushed_fatigue) penalise(0.2, `fatigue scale rushed (${Math.round(fatigue!.response_time_ms!)}ms)`);
  const careless_rushed_perception = !!perception && perception.response_time_ms != null && perception.response_time_ms < ENGAGEMENT.PERCEPTION_RUSHED_MS;
  if (careless_rushed_perception) penalise(0.1, `perception rating rushed (${Math.round(perception!.response_time_ms!)}ms)`);

  // Straight-lined fatigue ratings.
  const careless_straight_lined = isStraightLined(fatigue);
  if (careless_straight_lined) penalise(0.1, 'fatigue ratings straight-lined (all five identical)');

  // Comprehension miss (weak on its own). With three items per passage a single slip is not
  // evidence of disengagement, so the flag fires only at or below chance, which for three
  // 4-option items means fewer than half correct.
  const compAnswered = comprehension?.length ?? 0;
  const compCorrect = comprehension?.filter((x) => x.is_correct).length ?? 0;
  const comprehension_wrong = compAnswered > 0 && compCorrect / compAnswered < 0.5;
  if (comprehension_wrong) penalise(0.1, `comprehension below chance (${compCorrect}/${compAnswered})`);

  // Camera: participant turned away for a large share of the condition.
  // Null face presence means no face was ever found; that is not "low presence", it is no
  // measurement at all, and it is already reported by camera_active plus the null ocular columns.
  const low_face_presence = !!eye && eye.camera_active && eye.face_presence_ratio != null
    && eye.face_presence_ratio < ENGAGEMENT.FACE_PRESENCE_MIN;
  // Raised from 0.1: at 0.1 a condition whose face was found in a third of frames still scored 0.9
  // and passed as "good", so the pre-registered drop-disengaged filter did not remove it.
  if (low_face_presence) penalise(0.25, `low face presence (${Math.round((eye!.face_presence_ratio as number) * 100)}%)`);

  // Too few blinks for the PRIMARY outcome to mean anything in this condition. Flagged rather than
  // dropped: the run's other measures are still valid, and silently discarding it would bias the
  // sample toward high blinkers. This does not penalise the participant's engagement score, since a
  // low blink count is a measurement-window property, not evidence of carelessness.
  // Null when the camera was off: the counts are absent, not zero, so there is no blink count to
  // judge as insufficient. Summing them as 0 would report "0 blinks captured" for a condition that
  // was never observed, which is the same fabrication the null encoding exists to prevent.
  const blinkCount = eye && eye.blink_count_full != null && eye.blink_count_micro != null
    && eye.blink_count_incomplete != null
    ? eye.blink_count_full + eye.blink_count_micro + eye.blink_count_incomplete
    : null;
  const insufficient_blinks = !!eye && eye.camera_active && blinkCount != null
    && blinkCount < ENGAGEMENT.MIN_BLINKS_FOR_RATIO;
  if (insufficient_blinks) {
    reasons.push(`only ${blinkCount} blinks captured — incomplete-blink ratio is imprecise (need >= ${ENGAGEMENT.MIN_BLINKS_FOR_RATIO})`);
  }

  // Frame rate too low for the PRIMARY OUTCOME. Reported, not penalised and not dropped: a low
  // frame rate is a property of the device and the light, not of the participant's engagement, and
  // dropping these conditions would bias the sample toward whichever participants, devices and
  // seating positions sustain a high frame rate. Ambient illumination is held constant by protocol
  // now rather than manipulated, so it is no longer the axis at risk — but face illuminance still
  // varies with display polarity, which IS an independent variable, so the bias is not neutral.
  // Undersampling biases the sampled minimum EAR upward, so the ratio is inflated, directionally.
  const low_fps_for_ratio = !!eye && eye.camera_active && !eye.fps_adequate_for_ratio;
  if (low_fps_for_ratio) {
    const fps = eye!.effective_fps;
    reasons.push(
      `${fps == null ? 'unknown' : fps.toFixed(1)} fps — below the ${FPS_RATIO_THRESHOLD} fps needed for the `
      + `incomplete-blink ratio; the ratio for this condition is biased upward`,
    );
  }

  const quality_score = Math.max(0, Math.round(score * 100) / 100);
  const engagement: QcFlag = quality_score >= ENGAGEMENT.QUALITY_GOOD ? 'good' : quality_score >= ENGAGEMENT.QUALITY_WARN ? 'warn' : 'bad';

  return {
    engagement, quality_score, reasons,
    blink_count_total: blinkCount, insufficient_blinks,
    careless_straight_lined, careless_rushed_fatigue, careless_rushed_perception,
    reading_skim, reading_interrupted, comprehension_wrong, rt_disengaged, low_face_presence,
  };
}

export function baselineFatigueMean(bundle: SessionBundle): number | null {
  const b = bundle.fatigue.find((f) => f.stage === 'baseline');
  return b ? b.fatigue_mean : null;
}

export function buildConditionSummaries(bundle: SessionBundle): ConditionSummary[] {
  const baseline = baselineFatigueMean(bundle);

  return bundle.conditions.map((c) => {
    const rt = bundle.rtSummaries.find((r) => r.condition_id === c.condition_id);
    const fat = bundle.fatigue.find((f) => f.condition_id === c.condition_id && f.stage === 'post_condition');
    const comp = bundle.comprehension.filter((x) => x.condition_id === c.condition_id);
    const vs = bundle.visualSearch.find((v) => v.condition_id === c.condition_id);
    const perc = bundle.perception.find((p) => p.condition_id === c.condition_id);
    const eye = bundle.eyeMetrics.find((e) => e.condition_id === c.condition_id);

    const cameraActive = eye?.camera_active ?? false;
    const facePresence = cameraActive ? (eye?.face_presence_ratio ?? null) : null;
    const fps = cameraActive ? (eye?.effective_fps ?? null) : null;
    const offAxis = cameraActive ? (eye?.off_axis_ratio ?? null) : null;

    const facePresenceFlag: QcFlag = cameraActive ? flag(facePresence, 0.8, 0.5) : 'warn';
    const fpsFlag: QcFlag = cameraActive ? flag(fps, 25, 15) : 'warn';
    const offAxisFlag: QcFlag = cameraActive ? flag(offAxis, 0.2, 0.4, false) : 'warn';
    // Lighting: 'good' is in range; 'low'/'overexposed' degrade blink/EAR detection → warn.
    const lightingQuality = cameraActive ? (eye?.lighting_quality ?? null) : null;
    const lightingFlag: QcFlag = !cameraActive ? 'warn' : lightingQuality == null ? 'warn' : lightingQuality === 'good' ? 'good' : 'warn';

    const eng = conditionEngagement({
      reading_time_ms: c.reading_time_ms,
      reading_min_page_dwell_ms: c.reading_min_page_dwell_ms ?? null,
      reading_hidden_ms: c.reading_hidden_ms ?? null,
      word_count: PASSAGES[c.passage_id]?.wordCount ?? null,
      fatigue: fat, perception: perc, comprehension: comp, rt, eye,
    });

    return {
      condition_id: c.condition_id,
      condition_label: c.condition_label,
      session_position: c.session_position,
      polarity: c.polarity,
      color_name: c.color_name,
      passage_id: c.passage_id,
      wcag_contrast_ratio: c.wcag_contrast_ratio,
      wcag_level: c.wcag_level,
      below_wcag_aa: c.below_wcag_aa,

      mean_rt_hits_ms: rt?.mean_rt_hits_ms ?? null,
      hit_rate: rt?.hit_rate ?? null,
      false_alarm_rate: rt?.false_alarm_rate ?? null,
      d_prime: rt?.d_prime ?? null,
      d_prime_se: rt?.d_prime_se ?? null,
      d_prime_unstable: rt?.d_prime_unstable ?? false,
      criterion: rt?.criterion ?? null,

      fatigue_mean: fat?.fatigue_mean ?? null,
      fatigue_delta: fat && baseline != null ? fat.fatigue_mean - baseline : null,
      eye_strain: fat?.eye_strain ?? null,
      dryness: fat?.dryness ?? null,
      blur: fat?.blur ?? null,
      burning: fat?.burning ?? null,
      headache: fat?.headache ?? null,

      // Proportion of items answered correctly, not a boolean: a passage carries three items, so
      // this takes the values 0, 1/3, 2/3 or 1. Absent when the condition recorded no item at all,
      // never 0, which would read as "attempted and got none right".
      comprehension_correct: comp.length ? comp.filter((x) => x.is_correct).length / comp.length : null,
      comprehension_rt_ms: comp.length ? comp.reduce((a, x) => a + x.response_time_ms, 0) / comp.length : null,

      reading_time_ms: c.reading_time_ms,
      fatigue_response_ms: fat?.response_time_ms ?? null,
      perception_response_ms: perc?.response_time_ms ?? null,
      engagement: eng.engagement,
      quality_score: eng.quality_score,
      engagement_reasons: eng.reasons,
      blink_count_total: eng.blink_count_total,
      insufficient_blinks: eng.insufficient_blinks,
      careless_straight_lined: eng.careless_straight_lined,
      careless_rushed_fatigue: eng.careless_rushed_fatigue,
      careless_rushed_perception: eng.careless_rushed_perception,
      reading_skim: eng.reading_skim,
      reading_interrupted: eng.reading_interrupted,
      comprehension_wrong: eng.comprehension_wrong,
      rt_disengaged: eng.rt_disengaged,
      low_face_presence: eng.low_face_presence,

      search_time_ms: vs?.search_time_ms ?? null,
      search_accuracy: vs?.accuracy_rate ?? null,
      search_efficiency: vs?.search_efficiency ?? null,
      false_detections: vs?.false_detections ?? null,
      targets_found: vs?.targets_found ?? null,
      targets_in_set: vs?.targets_in_set ?? null,

      comfort_score: perc?.display_comfort_score ?? null,
      clarity_score: perc?.text_clarity_score ?? null,

      camera_active: cameraActive,
      blink_rate: eye?.blink_rate ?? null,
      blink_rate_full: eye?.blink_rate_full ?? null,
      incomplete_blink_ratio: eye?.incomplete_blink_ratio ?? null,
      mean_inter_blink_interval_ms: cameraActive ? (eye?.mean_inter_blink_interval_ms ?? null) : null,
      perclos_p80: cameraActive ? (eye?.perclos_p80 ?? null) : null,
      perclos_p70: cameraActive ? (eye?.perclos_p70 ?? null) : null,
      long_closure_count: cameraActive ? (eye?.long_closure_count ?? null) : null,
      effective_fps: fps,
      fps_adequate_for_tiers: eye?.fps_adequate_for_tiers ?? false,
      face_presence_ratio: facePresence,
      off_axis_ratio: offAxis,
      zone_center_ratio: cameraActive ? (eye?.zone_center_ratio ?? null) : null,
      mean_face_luma: cameraActive ? (eye?.mean_face_luma ?? null) : null,
      lighting_quality: lightingQuality,
      qc: {
        facePresence: facePresenceFlag,
        fps: fpsFlag,
        offAxis: offAxisFlag,
        lighting: lightingFlag,
        overall: worst([facePresenceFlag, fpsFlag, offAxisFlag, lightingFlag]),
      },
    };
  });
}

/** Mean across non-null values; null when none. */
export function meanOrNull(xs: (number | null)[]): number | null {
  const vals = xs.filter((x): x is number => x != null);
  return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
}
