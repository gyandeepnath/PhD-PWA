/**
 * Per-condition aggregation. Joins conditions with RT/fatigue/search/perception/eye/comprehension
 * records into one row per condition (ordered by serial position). Used by both the dashboard
 * charts/tables and the wide-format CSV, so the numbers are guaranteed consistent.
 */
import type { SessionBundle } from '@/storage/gather';
import { CONFIG } from '@/experiment/config';
import { FPS_RATIO_THRESHOLD, FPS_TIER_THRESHOLD } from '@/tracking/blink';
import type { FatigueRecord, DisplayPerceptionRecord, ComprehensionRecord, RtSummaryRecord, EyeMetricsRecord } from '@/storage/types';
import { PASSAGES } from '@/experiment/passages';
import { isConditionComplete } from '@/storage/conditionStatus';

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
  /**
   * Hidden time ANYWHERE in the condition beyond this means its timing measures are not
   * interpretable.
   *
   * Lower than the reading threshold, and deliberately. Reading is self-paced and dwell-gated, so a
   * few seconds away cost time and nothing else. The reaction-time block is a sequence of
   * one-second trials with one-second response windows, and a browser throttles timers in a hidden
   * tab — two seconds of absence there is several trials that resolve as misses because the clock
   * stopped, not because the participant did.
   */
  CONDITION_HIDDEN_MAX_MS: 2000,
  /**
   * RT block reads as disengaged when the participant taps more than this share of the NO-GO dots.
   *
   * COMMISSION ERRORS ONLY. This used to fire on any of false-alarm rate, error rate or lapse rate
   * above 0.3. The latter two are made of OMISSIONS — go-dots not tapped, or tapped late — and since
   * the go-target became the condition's own text colour (see `rtStimulusColours`), omissions are
   * legitimately driven by how visible that colour is: yellow on white is 2.39:1, and a participant
   * who is trying hard and genuinely cannot see the dot misses it. Firing on omissions would have
   * marked the hardest conditions as "disengaged" at a higher rate than the easy ones, and the
   * pre-registered sensitivity analysis drops flagged rows — differential attrition on the very
   * factor the study manipulates.
   *
   * A commission error is different. The no-go dots are the other text colours of the polarity,
   * most of them highly visible, and tapping them is impulsive responding whatever the target's
   * colour. So that signal is kept, and the omission signals stay in the export (error_rate,
   * lapse_rate) as outcomes to model, where their dependence on the display is the point.
   *
   * Same principle as the interruption rule below: rates that a non-participant cause can explain
   * are not evidence about the participant. Not pre-registered; changed before any data collection.
   */
  RT_FALSE_ALARM_MAX: 0.3,
  /** Camera face presence below this (when camera active) flags the participant turning away. */
  FACE_PRESENCE_MIN: 0.5,
  /**
   * Face presence at or above which the QC tile reads GOOD. The protocol gate, not a display default.
   *
   * The codebook entry for `face_presence_ratio` states the pilot gate as ">= 0.90 in at least 90%
   * of condition-runs", and analysis_template.R applies exactly that as QC_FACE_PRESENCE_MIN. The
   * dashboard tile was judged against a bare literal 0.8, so a condition-run at 0.85 was coloured
   * green for the operator while the analysis that later reads the same column counts it as failing
   * the gate. The operator is the ONLY person who can still act on it -- by re-seating the
   * participant and re-running the condition, on the day -- and the green tick is what stopped them.
   *
   * Same defect as the fps flag (tier floor 25 vs ratio floor 30, fixed in buildConditionSummaries):
   * a display threshold drifting away from the threshold the science is held to. Both are now named
   * against their source, and tests/export.test.ts asserts the three statements of this gate --
   * codebook prose, dashboard flag, R template constant -- still agree.
   */
  FACE_PRESENCE_PILOT_GATE: 0.9,
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
  /**
   * The run FINISHED (its reaction-time block completed and stamped completed_at). False for a
   * condition that was paused, crashed or abandoned part-way: its rows are real but partial, and it
   * is not a measurement of that condition. See storage/conditionStatus.ts.
   */
  condition_complete: boolean;
  /** How many times this condition was started, counting this run; above 1 means a redo after an interruption. */
  attempt_number: number | null;
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
  /** The app was backgrounded somewhere in the condition — which the reading flag does not cover. */
  condition_interrupted: boolean;
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
  /** The app was hidden somewhere in the condition, which invalidates its timing measures. */
  condition_interrupted: boolean;
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
  /** Time the app was hidden anywhere in the condition, which covers the timed tasks reading does not. */
  condition_hidden_ms?: number | null;
  /** Time the tablet spent in portrait during the condition, behind the blocking overlay. */
  condition_portrait_ms?: number | null;
  word_count: number | null;
  fatigue?: FatigueRecord;
  perception?: DisplayPerceptionRecord;
  comprehension?: ComprehensionRecord[];
  rt?: RtSummaryRecord;
  eye?: EyeMetricsRecord;
}): EngagementResult {
  const {
    reading_time_ms, reading_min_page_dwell_ms, reading_hidden_ms, condition_hidden_ms,
    condition_portrait_ms, word_count, fatigue, perception, comprehension, rt, eye,
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

  /*
   * The app left the screen somewhere in this condition — not necessarily during reading.
   *
   * reading_hidden_ms above covers the passage only, and it was the only interruption this scorer
   * could see. Every other task in a condition is also timed, and the reaction-time block is the
   * one that cannot survive being backgrounded at all: one-second trials, one-second response
   * windows, and a browser that throttles timers in a hidden tab.
   */
  const hiddenTooLong = condition_hidden_ms != null
    && condition_hidden_ms > ENGAGEMENT.CONDITION_HIDDEN_MAX_MS;
  /*
   * PORTRAIT IS AN INTERRUPTION TOO, and it was measured and then ignored here.
   *
   * Rotating the tablet raises a blocking overlay over the running task: taps never reach it, so
   * every go-trial in a reaction-time block becomes a miss, while the page stays visible and
   * condition_hidden_ms stays at 0. Before the disengagement rule was narrowed to commission errors
   * this produced "reaction-time block shows disengagement", blaming the participant for what the
   * tablet did; after it, the block read as engagement GOOD and its induced misses flowed into
   * hit_rate and d-prime as though they were a display-colour effect. Both are wrong the same way
   * hidden time was once wrong, and the answer is the same: name the interruption, withhold the
   * verdict about the participant. Same threshold as hidden time — the overlay blocks input exactly
   * as backgrounding throttles it.
   */
  const rotatedTooLong = condition_portrait_ms != null
    && condition_portrait_ms > ENGAGEMENT.CONDITION_HIDDEN_MAX_MS;
  const condition_interrupted = hiddenTooLong || rotatedTooLong;
  if (hiddenTooLong && !reading_interrupted) {
    penalise(0.25, `app was hidden for ${Math.round(condition_hidden_ms! / 1000)}s during this condition, outside the passage`);
  }
  if (rotatedTooLong) {
    penalise(0.25, `tablet was in portrait for ${Math.round(condition_portrait_ms! / 1000)}s during this condition — the task could not be answered while the overlay was up`);
  }

  // RT block disengagement: COMMISSION errors only — see ENGAGEMENT.RT_FALSE_ALARM_MAX for why
  // omissions (error_rate, lapse_rate) no longer count, now that the go-target's visibility varies
  // with the condition. An unmeasured false-alarm rate is not evidence either way, so the guard is
  // explicit rather than relying on `null > x` being false.
  const rtRatesHigh = !!rt
    && rt.false_alarm_rate != null && rt.false_alarm_rate > ENGAGEMENT.RT_FALSE_ALARM_MAX;

  /*
   * A BLOCK THAT RAN AND SCORED NOTHING IS THE DISENGAGEMENT THIS TASK EXISTS TO DETECT.
   *
   * Every rate above is null-guarded, and correctly — an unmeasured rate is not evidence either way.
   * But that leaves the worst case falling through all three: a participant tapping rhythmically has
   * every response land inside the 150 ms anticipation cutoff, so every trial is an anticipation,
   * all four detection pools come back empty, and all three rates are null. Nothing fired.
   *
   * It used to be worse and in the opposite direction — error_rate was fabricated as 0 for exactly
   * this block, and `0 > 0.3` is false, so the fabricated perfect score silenced the detector. Now
   * the rates are honestly null, which stops the fabrication but does not by itself catch anyone.
   * This is the rule that does: trials were presented and not one produced a detection judgement.
   *
   * Checked on the SCORED pools rather than on the anticipation count, so it catches the same state
   * however it arises — rhythmic tapping, a rotation that blocked every response, a stylus held
   * down — rather than only the one route that motivated it.
   */
  const rtRanButScoredNothing = !!rt
    && rt.total_trials > 0
    && rt.hit_rate == null
    && rt.false_alarm_rate == null;
  /*
   * HIGH ERROR RATES IN AN INTERRUPTED CONDITION ARE NOT EVIDENCE ABOUT THE PARTICIPANT.
   *
   * A backgrounded RT block comes back as misses and lapses produced by the throttled clock, so
   * this flag fired and the reason string read "reaction-time block shows disengagement" — blaming
   * the participant for what the device did, and costing the condition 0.3 on a score the
   * pre-registered filter drops on. The two causes cannot be told apart from the rates alone, so
   * the flag is withheld and the interruption is named instead. The interruption is already
   * penalised above; penalising both would charge one event twice.
   */
  const rtDisengagementSignal = rtRatesHigh || rtRanButScoredNothing;
  const rt_disengaged = rtDisengagementSignal && !condition_interrupted;
  if (rt_disengaged) {
    penalise(
      0.3,
      rtRanButScoredNothing
        ? `reaction-time block ran ${rt!.total_trials} trials and scored none of them — every `
          + 'response fell inside the anticipation cutoff, which is what rhythmic tapping produces'
        // Reached only via rtRatesHigh, which requires a non-null false_alarm_rate.
        : `reaction-time block shows disengagement — tapped ${Math.round(Number(rt!.false_alarm_rate) * 100)}% of the no-go dots`,
    );
  } else if (rtDisengagementSignal) {
    reasons.push(
      rtRanButScoredNothing
        ? 'the reaction-time block scored no trial at all, but the app was hidden during this '
          + 'condition — a throttled block can produce the same signature, so this cannot be read '
          + 'as disengagement'
        : 'reaction-time error rates are high, but the app was hidden during this condition — the '
          + 'timers are throttled while hidden, so this cannot be read as disengagement',
    );
  }

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
    reading_skim, reading_interrupted, condition_interrupted,
    comprehension_wrong, rt_disengaged, low_face_presence,
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

    /*
     * Green only at the protocol's own gate. See ENGAGEMENT.FACE_PRESENCE_PILOT_GATE for why 0.9 and
     * not the 0.8 that used to be written here as a literal.
     */
    const facePresenceFlag: QcFlag = cameraActive
      ? flag(facePresence, ENGAGEMENT.FACE_PRESENCE_PILOT_GATE, ENGAGEMENT.FACE_PRESENCE_MIN)
      : 'warn';
    /*
     * Judged on FPS_RATIO_THRESHOLD, not FPS_TIER_THRESHOLD.
     *
     * This read `flag(fps, 25, 15)`. 25 is the floor for the micro/partial TIERS; the primary
     * outcome needs 30, and tests/ocularIntegrity.test.ts exists to assert that gap — "27 fps is
     * fine for the tiers and not fine for the ratio". So a condition at 26-29.9 fps was flagged
     * `good`, coloured green in the QC table, and rolled up into a `good` qc.overall, while this
     * same file's own reason string said the ratio for that condition is biased upward. The caveat
     * existed as prose in a different table from the green tick the operator was reading.
     *
     * Now: good only at or above the ratio threshold, warn between the two floors — the band where
     * the tiers are usable and the primary outcome is not — and bad below the tier floor.
     */
    const fpsFlag: QcFlag = cameraActive ? flag(fps, FPS_RATIO_THRESHOLD, FPS_TIER_THRESHOLD) : 'warn';
    const offAxisFlag: QcFlag = cameraActive ? flag(offAxis, 0.2, 0.4, false) : 'warn';
    // Lighting: 'good' is in range; 'low'/'overexposed' degrade blink/EAR detection → warn.
    const lightingQuality = cameraActive ? (eye?.lighting_quality ?? null) : null;
    const lightingFlag: QcFlag = !cameraActive ? 'warn' : lightingQuality == null ? 'warn' : lightingQuality === 'good' ? 'good' : 'warn';

    const eng = conditionEngagement({
      reading_time_ms: c.reading_time_ms,
      reading_min_page_dwell_ms: c.reading_min_page_dwell_ms ?? null,
      reading_hidden_ms: c.reading_hidden_ms ?? null,
      condition_hidden_ms: c.condition_hidden_ms ?? null,
      condition_portrait_ms: c.condition_portrait_ms ?? null,
      word_count: PASSAGES[c.passage_id]?.wordCount ?? null,
      fatigue: fat, perception: perc, comprehension: comp, rt, eye,
    });

    return {
      condition_id: c.condition_id,
      condition_complete: isConditionComplete(c),
      attempt_number: c.attempt_number ?? null,
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
      condition_interrupted: eng.condition_interrupted,
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
      /*
       * Gated on camera_active, which the eight ocular fields below already were and these three —
       * including the PRIMARY OUTCOME — were not. aggregator.ts says why in terms: "camera_active =
       * false is not a sufficient guard on its own: it puts the burden on every downstream consumer
       * to remember to filter, and the app's own dashboard did not." The defence was added to eight
       * fields and omitted from the three that matter most.
       *
       * The live writer nulls everything when the camera is off, so this is not currently reachable
       * from a fresh run — but the shape is representable and exists in the repo's own fixtures and
       * fuzz generator, and a restored backup from an older schema would display
       * "incomplete-blink ratio 0" and "blink rate 0/min" for a condition the QC table beside it
       * labels camera-off. A zero primary outcome reads as the cleanest possible result. The gate
       * costs nothing.
       */
      blink_rate: cameraActive ? (eye?.blink_rate ?? null) : null,
      blink_rate_full: cameraActive ? (eye?.blink_rate_full ?? null) : null,
      incomplete_blink_ratio: cameraActive ? (eye?.incomplete_blink_ratio ?? null) : null,
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

/* ==========================================================================================
 * COHORT VIEW — every participant at once, beside the one being looked at.
 *
 * The dashboard was strictly per-sitting: pick a session, gather that bundle, show its tabs. That
 * answers "did this sitting work" and cannot answer "is the study working", and the two fail in
 * different ways. A single sitting looks fine while a condition is quietly broken in all of them; a
 * colour that never produces usable blink data, a position that is always thin, an exclusion rule
 * firing far more often than expected. Those are visible only across participants, and if they are
 * first noticed at analysis the participants have gone home.
 *
 * This reads the POOLED analysis file rather than recomputing from bundles, deliberately: the
 * numbers shown are then the ones the analysis will actually see, not a parallel calculation that
 * can drift from it.
 * ========================================================================================== */

export interface CohortConditionRow {
  condition_label: string;
  polarity: string;
  text_colour: string;
  /** Rows present for this condition across all participants. */
  n: number;
  /**
   * Rows whose run was started and never finished (condition_complete = FALSE). Counted, and kept
   * out of the outcome mean and the position balance: a paused condition is not a measurement.
   */
  n_unfinished: number;
  /** Rows the exporter judged analysable. */
  n_analysable: number;
  /** Rows with a usable primary outcome — a denominator of at least one blink. */
  n_with_outcome: number;
  /** Mean incomplete-blink ratio over rows that have one. Null when none do. */
  mean_ibr: number | null;
  /** Total blinks behind that mean. The ratio's precision rests on this, not on n. */
  blinks_total: number;
  /** Rows whose frame rate was too low for the ratio to be trusted. */
  n_fps_inadequate: number;
}

export interface CohortSummary {
  participants: number;
  analysable_participants: number;
  rows: number;
  /** One row per condition, in condition_label order. */
  conditions: CohortConditionRow[];
  /** condition_label -> how many times it ran at each session position. */
  positionBalance: Record<string, number[]>;
  /** Counts of each exclusion_reason actually seen, worst first. */
  exclusions: { reason: string; n: number }[];
  /** Blocking and warning issues from the join check. */
  issues: { code: string; severity: string; detail: string }[];
  /** The smallest and largest condition n — an early warning that one is falling behind. */
  minConditionN: number;
  maxConditionN: number;
}

/** Minimal RFC-4180 reader. The pooled file is written by toCsv, which quotes and doubles quotes. */
function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const isTrue = (v: string | undefined) => v === 'true' || v === 'TRUE' || v === '1';

/**
 * Summarise the pooled dataset for the cohort tab.
 *
 * `analysisFiles` is what buildAnalysisDataset returns; the long file is located by name rather than
 * by index so a reordering of the export cannot silently point this at the wrong table.
 */
export function cohortSummary(
  analysisFiles: { filename: string; content: string }[],
  integrity: { total_participants: number; analysable_participants: number; issues: { code: string; severity: string; detail: string }[] },
  nConditions: number,
): CohortSummary {
  const long = analysisFiles.find((f) => f.filename === 'analysis_long.csv');
  const rows = long ? readCsv(long.content) : [];

  const byCondition = new Map<string, CohortConditionRow>();
  const positionBalance: Record<string, number[]> = {};
  const exclusionCounts = new Map<string, number>();

  for (const r of rows) {
    const label = r.condition_label || '(unlabelled)';
    let c = byCondition.get(label);
    if (!c) {
      c = {
        condition_label: label, polarity: r.polarity ?? '', text_colour: r.text_colour ?? '',
        n: 0, n_unfinished: 0, n_analysable: 0, n_with_outcome: 0, mean_ibr: null, blinks_total: 0, n_fps_inadequate: 0,
      };
      byCondition.set(label, c);
    }
    c.n++;
    /*
     * An unfinished run contributes to the row count and nothing else. This view pools every sitting
     * on the device as it is saved, so a sitting paused mid-condition and then opened here used to
     * put its partial condition into the cohort mean of the primary outcome and into the
     * position-balance check — the very tab that exists to show whether conditions are behaving as
     * expected. A blank (a row written before the column existed) is read as finished, which is what
     * every such row was, since the column arrived with the fix.
     */
    const reason = (r.exclusion_reason ?? '').trim();
    if (reason) exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + 1);
    if (r.condition_complete === 'false' || r.condition_complete === 'FALSE') {
      c.n_unfinished++;
      continue;
    }
    if (isTrue(r.analysable)) c.n_analysable++;
    // fps_adequate_for_ratio is only meaningful where the camera ran at all; a blank is "unknown",
    // which is not the same as inadequate and must not be counted as either.
    if (r.fps_adequate_for_ratio !== '' && !isTrue(r.fps_adequate_for_ratio)) c.n_fps_inadequate++;

    const denom = Number(r.n_blinks_total);
    const ratio = Number(r.incomplete_blink_ratio);
    if (Number.isFinite(denom) && denom > 0 && Number.isFinite(ratio)) {
      // Accumulated as a running sum in mean_ibr, divided out below. The blink total is carried
      // because it, not the row count, is what the ratio's precision actually rests on.
      c.mean_ibr = (c.mean_ibr ?? 0) + ratio;
      c.n_with_outcome++;
      c.blinks_total += denom;
    }

    const pos = Number(r.session_position);
    if (Number.isFinite(pos) && pos >= 0 && pos < nConditions) {
      (positionBalance[label] ??= Array.from({ length: nConditions }, () => 0))[pos]++;
    }
  }

  const conditions = [...byCondition.values()]
    .map((c) => ({ ...c, mean_ibr: c.n_with_outcome > 0 && c.mean_ibr != null ? c.mean_ibr / c.n_with_outcome : null }))
    .sort((a, b) => a.condition_label.localeCompare(b.condition_label));

  const ns = conditions.map((c) => c.n);
  return {
    participants: integrity.total_participants,
    analysable_participants: integrity.analysable_participants,
    rows: rows.length,
    conditions,
    positionBalance,
    exclusions: [...exclusionCounts.entries()]
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n),
    issues: integrity.issues,
    minConditionN: ns.length ? Math.min(...ns) : 0,
    maxConditionN: ns.length ? Math.max(...ns) : 0,
  };
}
