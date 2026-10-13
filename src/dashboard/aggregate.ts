/**
 * Per-condition aggregation. Joins conditions with RT/fatigue/search/perception/eye/comprehension
 * records into one row per condition (ordered by serial position). Used by both the dashboard
 * charts/tables and the wide-format CSV, so the numbers are guaranteed consistent.
 */
import type { SessionBundle } from '@/storage/gather';
import { CONFIG } from '@/experiment/config';
import { FPS_GATE, fpsTier, gateParticipant, type FpsTier } from '@/tracking/frameRateGate';
import {
  ocularReliability, reliabilityHeadline, type Reliability, type ReliabilityCheck, type ReliabilityResult,
} from '@/tracking/ocularReliability';
import type { FatigueRecord, DisplayPerceptionRecord, ComprehensionRecord, RtSummaryRecord, EyeMetricsRecord } from '@/storage/types';
import { PASSAGES } from '@/experiment/passages';
import { isConditionComplete } from '@/storage/conditionStatus';
import { COMPLETENESS_EXCLUSIONS } from '@/storage/joinIntegrity';

export type QcFlag = 'good' | 'warn' | 'bad';

/**
 * Engagement / careless-responding thresholds.
 *
 * Boredom and disengagement over a long within-subjects session mimic visual fatigue (slower,
 * more variable RT, lapses, rushed/straight-lined ratings, skimming). These thresholds flag
 * conditions whose data quality is suspect so the analyst can exclude or model them — they are
 * deliberately conservative so genuine responding is not discarded. All reuse existing recorded
 * fields; nothing extra is shown to the participant (no performance feedback → no confound).
 *
 * PROVENANCE. Every value here is an ANALYST DEFAULT — chosen for this app, not pre-registered and
 * not taken from a cited source — EXCEPT FACE_PRESENCE_PILOT_GATE, which is the protocol's pilot gate.
 * The same is true of the penalty weights (ENGAGEMENT_PENALTY) and of the good/warn/bad cut-offs
 * (QUALITY_GOOD, QUALITY_WARN). They were unlabelled while the analysis templates dropped every
 * "bad" run from every model by default, which made a set of unlabelled analyst choices decide which
 * rows the confirmatory analysis saw.
 *
 * WHAT THE COMPOSITE FLAG MAY BE USED FOR. It is built partly from OUTCOMES — comprehension_wrong,
 * reading_skim and rt_disengaged (a false-alarm rate) are the comprehension, reading-speed and
 * d-prime/criterion outcomes — so it must never filter a model of those outcomes: that is selection
 * on the dependent variable. Both analysis templates keep every run in every model and use the flag
 * for one labelled sensitivity refit of the PRIMARY (no signal here is built from an ocular outcome).
 */
export const ENGAGEMENT = {
  /** Fatigue questionnaire (5 sliders) faster than this is implausibly rushed. ANALYST DEFAULT. */
  FATIGUE_RUSHED_MS: 3000,
  /** Perception rating (2 sliders) faster than this is implausibly rushed. ANALYST DEFAULT. */
  PERCEPTION_RUSHED_MS: 2000,
  /** Reading faster than wordCount / this (wpm) is an implausible skim (normal reading ≤ ~400 wpm). ANALYST DEFAULT. */
  SKIM_WPM_CEILING: 400,
  /**
   * A page advanced within this long of its own unlock was waited out, not read. Generous enough
   * that a reader who finishes just as the button becomes live is not flagged for a fast page.
   * ANALYST DEFAULT.
   */
  PAGE_UNLOCK_GRACE_MS: 1500,
  /** Hidden time during a passage beyond this means the exposure window is not what it claims. ANALYST DEFAULT. */
  READING_HIDDEN_MAX_MS: 5000,
  /**
   * Hidden time ANYWHERE in the condition beyond this means its timing measures are not
   * interpretable.
   *
   * Lower than the reading threshold, and deliberately. Reading is self-paced and dwell-gated, so a
   * few seconds away cost time and nothing else. The reaction-time block is a sequence of
   * one-second trials with one-second response windows, and a browser throttles timers in a hidden
   * tab — two seconds of absence there is several trials that resolve as misses because the clock
   * stopped, not because the participant did. ANALYST DEFAULT.
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
   * ANALYST DEFAULT.
   */
  RT_FALSE_ALARM_MAX: 0.3,
  /** Camera face presence below this (when camera active) flags the participant turning away. ANALYST DEFAULT. */
  FACE_PRESENCE_MIN: 0.5,
  /**
   * Face presence at or above which the QC tile reads GOOD. PROTOCOL: the pilot gate, not a display default.
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
   * exposure window cannot be mistaken for a clean null. ANALYST DEFAULT (the SE arithmetic above is
   * why, not a source).
   */
  MIN_BLINKS_FOR_RATIO: 20,
  /** quality_score >= GOOD → good; >= WARN → warn; else bad. ANALYST DEFAULT. */
  QUALITY_GOOD: 0.8,
  /** The warn/bad boundary. ANALYST DEFAULT. */
  QUALITY_WARN: 0.5,
} as const;

/**
 * What each fired signal subtracts from the 1.0 quality score. ANALYST DEFAULTS, every one: weighted
 * so that a single weak signal (one wrong MCQ, a rushed rating) only warns, while a strong behavioural
 * signal (a skim, RT disengagement) or an interruption can, with one more, reach "bad". They were bare
 * literals at the call sites, where nobody could see that they decide the flag.
 */
export const ENGAGEMENT_PENALTY = {
  READING_SKIM: 0.3,
  INTERRUPTED: 0.25,
  RT_DISENGAGED: 0.3,
  RUSHED_FATIGUE: 0.2,
  RUSHED_PERCEPTION: 0.1,
  STRAIGHT_LINED: 0.1,
  COMPREHENSION_BELOW_CHANCE: 0.1,
  LOW_FACE_PRESENCE: 0.25,
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
  /** The same signals with short labels, for the dashboard (EngagementSignal). */
  engagement_signals: EngagementSignal[];
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
  /** How the search ended. time_limit and voluntary_early both mean search_time_ms is censored. */
  search_termination: string | null;
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
  /**
   * The frame-rate gate fps-g2 (tracking/frameRateGate.ts), exactly as the export and the templates
   * apply it: the face-solved rate while the face was seen, its tier, and whether it is within 2 fps of
   * the median of this sitting's camera-on conditions (the analysis takes the participant's median over
   * all of their sittings, which is the same unless the sitting was split). Null with the camera off.
   */
  sampling_fps_observed: number | null;
  fps_tier: FpsTier | null;
  fps_consistent: boolean | null;
  fps_median: number | null;
  face_presence_ratio: number | null;
  off_axis_ratio: number | null;
  /** 07 observed_duration_ms: the time the camera saw the face, dropouts excluded; null when camera off. */
  observed_duration_ms: number | null;
  /** 07 camera_blocked_ms: the feed black and flat (lens covered); null when camera off or not recorded. */
  camera_blocked_ms: number | null;
  /** 07 open_ear_measured / ear_baseline: the open eye here against calibration; null when either is missing. */
  open_eye_vs_baseline: number | null;
  /** 07 on_screen_ratio (gaze-r2): a quality check, null without a passed gaze check or before Round 80. */
  on_screen_ratio: number | null;
  mean_face_luma: number | null;
  lighting_quality: 'low' | 'good' | 'overexposed' | null;
  /**
   * The older per-signal flags and their worst, `qc_overall` in 10_wide_summary.csv and analysis_long.csv.
   * EXPORT ONLY since Round 82, and computed exactly as before so analyses run on the column reproduce:
   * the dashboard shows the reliability verdict (camera_verdict, rule rel-r1) instead, which follows the
   * analysis's own checks. These thresholds were not the templates' (a face in view under 50% was "bad"
   * here and an ordinary confirmatory row there), so the two must not be shown side by side.
   */
  qc: { facePresence: QcFlag; fps: QcFlag; offAxis: QcFlag; lighting: QcFlag; overall: QcFlag };
  /** Minutes of the exposure the camera actually observed (dropouts excluded); null when camera off. */
  observed_minutes: number | null;
  /** "Is the blink data reliable?" for this condition: rule rel-r1, in plain words. See cameraVerdict. */
  camera_verdict: CameraVerdict;
}

/** Something worth knowing about a condition's eye data that no analysis rule uses. */
export interface EyeNote {
  key: 'few_blinks' | 'covered' | 'narrower_eye' | 'lighting';
  text: string;
}

export interface CameraVerdict {
  /** good / warn / bad: the reliability verdict's good / usable / not usable, for colouring. */
  level: QcFlag;
  /** The verdict, rule rel-r1 (tracking/ocularReliability.ts). */
  reliability: Reliability;
  /** One line an operator can read at a glance: the verdict and its first reason. */
  headline: string;
  /** Every check the verdict was read from, in a fixed order, passed or not. */
  checks: ReliabilityCheck[];
  /** The checks that failed or flagged, fails first, in words; empty when good. */
  problems: string[];
  /** Notes beside the verdict (few blinks, light, a covered camera, a narrower eye); never change it. */
  notes: EyeNote[];
  /** The full result, for the export's columns. */
  result: ReliabilityResult;
}

/**
 * Plain-language answer to "is this condition's blink data reliable?" for one condition.
 *
 * The investigator's question after the first real participant was whether the small blink numbers
 * meant the camera was not working, and after testing 2.3.1, why most conditions read "bad". The
 * numbers alone cannot say: a low blink rate is both what a broken pipeline and an absorbed reader
 * produce. What CAN be said is whether the row passes the checks the analysis applies to it, and that
 * is the verdict (rule rel-r1, tracking/ocularReliability.ts): good, usable (kept, left out of one
 * pre-planned re-check), not usable (not in the eye-data models). Until Round 82 this function had
 * thresholds of its own — "Not trustworthy" for a face in view under 80% or a camera covered for 30 s,
 * neither of which the analysis excludes — so its red crosses did not mean what the analysis would do.
 *
 * What is worth knowing and no analysis rule uses comes back as NOTES, beside the verdict and never in
 * it: few blinks, a covered camera, an open eye narrower than at calibration, the light.
 */
export function cameraVerdict(eye: EyeMetricsRecord | undefined, q: {
  /** sampling_fps_observed: the gate's rate (fps-g2), not effective_fps. */
  facePresence: number | null; fps: number | null; lighting: 'low' | 'good' | 'overexposed' | null;
  blinks: number | null; minutes: number | null;
  /** The gate's consistency part, and the median it was judged against; absent when not known. */
  consistent?: boolean | null; median?: number | null;
  /** off_axis_ratio and reading_time_ms, for the §5.3 and §5.4 checks; absent when not known. */
  offAxis?: number | null; readingMs?: number | null;
}): CameraVerdict {
  const cameraOn = !!eye && eye.camera_active;
  const result = ocularReliability({
    hasEyeRecord: !!eye,
    cameraActive: cameraOn,
    cameraInactiveReason: eye?.camera_inactive_reason ?? null,
    blinkTotal: q.blinks,
    hasBaseline: eye ? eye.ear_baseline != null : null,
    fps: q.fps,
    fpsConsistent: q.consistent ?? null,
    fpsMedian: q.median ?? null,
    facePresence: q.facePresence,
    offAxis: q.offAxis ?? null,
    observedMs: cameraOn ? (eye!.observed_duration_ms ?? null) : null,
    readingMs: q.readingMs ?? null,
  });

  const notes: EyeNote[] = [];
  if (cameraOn) {
    if (q.blinks != null && q.blinks > 0 && q.blinks < ENGAGEMENT.MIN_BLINKS_FOR_RATIO) {
      notes.push({ key: 'few_blinks', text: `Only ${q.blinks} blinks: the ratio is imprecise (${ENGAGEMENT.MIN_BLINKS_FOR_RATIO} or more is steadier). The analysis weights each run by its blinks.` });
    }
    const blockedS = (eye!.camera_blocked_ms ?? 0) / 1000;
    if (blockedS >= 5) notes.push({ key: 'covered', text: `Camera covered or dark for ${Math.round(blockedS)} s; that time is not counted as seen.` });
    if (eye!.open_ear_measured != null && eye!.ear_baseline != null && eye!.ear_baseline > 0 && eye!.open_ear_measured / eye!.ear_baseline < 0.85) {
      notes.push({ key: 'narrower_eye', text: `Open eye ${Math.round(100 * (1 - eye!.open_ear_measured / eye!.ear_baseline))}% narrower than at calibration: some blinks may read as incomplete, or be missed.` });
    }
    if (q.lighting && q.lighting !== 'good') notes.push({ key: 'lighting', text: q.lighting === 'low' ? 'Face dimly lit.' : 'Face over-lit (glare).' });
  }

  const rate = q.blinks != null && q.minutes ? q.blinks / q.minutes : null;
  const seen = q.blinks == null ? 'no blink count' : `${q.blinks} blinks in ${q.minutes == null ? '?' : q.minutes.toFixed(1)} min${rate == null ? '' : ` (${rate.toFixed(1)} a minute)`}`;
  const wrong = [...result.checks.filter((c) => c.status === 'fail'), ...result.checks.filter((c) => c.status === 'flag')];
  return {
    level: result.reliability === 'good' ? 'good' : result.reliability === 'usable' ? 'warn' : 'bad',
    reliability: result.reliability,
    headline: reliabilityHeadline(result, seen),
    checks: result.checks,
    problems: wrong.map((c) => c.phrase),
    notes,
    result,
  };
}

function flag(value: number | null, good: number, warn: number, higherIsBetter = true): QcFlag {
  if (value == null) return 'bad';
  if (higherIsBetter) return value >= good ? 'good' : value >= warn ? 'warn' : 'bad';
  return value <= good ? 'good' : value <= warn ? 'warn' : 'bad';
}

const worst = (flags: QcFlag[]): QcFlag =>
  flags.includes('bad') ? 'bad' : flags.includes('warn') ? 'warn' : 'good';

/**
 * One fired signal, as the dashboard lists it: a few words, the full sentence behind a tap, and what it
 * cost the score (0 for a signal that is reported and not penalised). The full sentences are `reasons`,
 * written to 12_quality_flags.csv unchanged; the short words exist because ten of those sentences side
 * by side were what the investigator called paragraphs.
 */
export interface EngagementSignal {
  short: string;
  detail: string;
  penalty: number;
  /** 'eye': a property of the camera's view, shown with the eye-data verdict rather than here. */
  kind: 'engagement' | 'eye';
}

export interface EngagementResult {
  engagement: QcFlag;
  quality_score: number;
  reasons: string[];
  /** The same signals as `reasons`, in the same order, each with a short label. */
  signals: EngagementSignal[];
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
 * signal subtracts a weight (ENGAGEMENT_PENALTY) from a 1.0 quality score; the composite flag is
 * derived from the remaining score. Weighted so a single weak signal (e.g. one wrong MCQ) only warns, while the
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
  /** Time a blocking app notice (camera lost) covered the condition. */
  condition_notice_ms?: number | null;
  word_count: number | null;
  fatigue?: FatigueRecord;
  perception?: DisplayPerceptionRecord;
  comprehension?: ComprehensionRecord[];
  rt?: RtSummaryRecord;
  eye?: EyeMetricsRecord;
}): EngagementResult {
  const {
    reading_time_ms, reading_min_page_dwell_ms, reading_hidden_ms, condition_hidden_ms,
    condition_portrait_ms, condition_notice_ms, word_count, fatigue, perception, comprehension, rt, eye,
  } = args;
  const reasons: string[] = [];
  const signals: EngagementSignal[] = [];
  let score = 1;
  const penalise = (amount: number, reason: string, short: string) => {
    score -= amount; reasons.push(reason); signals.push({ short, detail: reason, penalty: amount, kind: 'engagement' });
  };
  const report = (reason: string, short: string, kind: EngagementSignal['kind']) => {
    reasons.push(reason); signals.push({ short, detail: reason, penalty: 0, kind });
  };
  const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

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
    penalise(ENGAGEMENT_PENALTY.READING_SKIM, `reading skimmed (${Math.round(reading_time_ms!)}ms < ${Math.round(skimFloorMs!)}ms floor)`, 'Read too fast');
  } else if (pageWaitedOut) {
    penalise(ENGAGEMENT_PENALTY.READING_SKIM, `a page was advanced ${Math.round(reading_min_page_dwell_ms! - CONFIG.READING_PAGE_MIN_MS)}ms after its unlock — waited out, not read`, 'A page waited out, not read');
  }

  // Time the app spent hidden during the passage: the participant was not looking at the stimulus,
  // and if it is large the ocular measures for this condition cover a window that includes it.
  const reading_interrupted = reading_hidden_ms != null && reading_hidden_ms > ENGAGEMENT.READING_HIDDEN_MAX_MS;
  if (reading_interrupted) {
    penalise(ENGAGEMENT_PENALTY.INTERRUPTED, `app was hidden for ${Math.round(reading_hidden_ms! / 1000)}s during reading`, `App hidden in reading, ${secs(reading_hidden_ms!)}`);
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
  // A blocking notice — the camera lost or blocked, or the operator's Pause confirmation left open —
  // blocks the task exactly as the portrait overlay does; same rule.
  const noticeTooLong = condition_notice_ms != null
    && condition_notice_ms > ENGAGEMENT.CONDITION_HIDDEN_MAX_MS;
  const condition_interrupted = hiddenTooLong || rotatedTooLong || noticeTooLong;
  if (hiddenTooLong && !reading_interrupted) {
    penalise(ENGAGEMENT_PENALTY.INTERRUPTED, `app was hidden for ${Math.round(condition_hidden_ms! / 1000)}s during this condition, outside the passage`, `App hidden, ${secs(condition_hidden_ms!)}`);
  }
  if (rotatedTooLong) {
    penalise(ENGAGEMENT_PENALTY.INTERRUPTED, `tablet was in portrait for ${Math.round(condition_portrait_ms! / 1000)}s during this condition — the task could not be answered while the overlay was up`, `Tablet in portrait, ${secs(condition_portrait_ms!)}`);
  }
  if (noticeTooLong) {
    penalise(ENGAGEMENT_PENALTY.INTERRUPTED, `a notice (camera lost or blocked, or the Pause confirmation) covered the task for ${Math.round(condition_notice_ms! / 1000)}s during this condition`, `A notice covered the task, ${secs(condition_notice_ms!)}`);
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
      ENGAGEMENT_PENALTY.RT_DISENGAGED,
      rtRanButScoredNothing
        ? `reaction-time block ran ${rt!.total_trials} trials and scored none of them — every `
          + 'response fell inside the anticipation cutoff, which is what rhythmic tapping produces'
        // Reached only via rtRatesHigh, which requires a non-null false_alarm_rate.
        : `reaction-time block shows disengagement — tapped ${Math.round(Number(rt!.false_alarm_rate) * 100)}% of the no-go dots`,
      rtRanButScoredNothing ? 'Reaction block: no trial scored' : `Tapped ${Math.round(Number(rt!.false_alarm_rate) * 100)}% of no-go dots`,
    );
  } else if (rtDisengagementSignal) {
    report(
      rtRanButScoredNothing
        ? 'the reaction-time block scored no trial at all, but the app was hidden during this '
          + 'condition — a throttled block can produce the same signature, so this cannot be read '
          + 'as disengagement'
        : 'reaction-time error rates are high, but the app was hidden during this condition — the '
          + 'timers are throttled while hidden, so this cannot be read as disengagement',
      'Reaction errors, but the task was interrupted',
      'engagement',
    );
  }

  // Rushed questionnaires.
  const careless_rushed_fatigue = !!fatigue && fatigue.response_time_ms != null && fatigue.response_time_ms < ENGAGEMENT.FATIGUE_RUSHED_MS;
  if (careless_rushed_fatigue) penalise(ENGAGEMENT_PENALTY.RUSHED_FATIGUE, `fatigue scale rushed (${Math.round(fatigue!.response_time_ms!)}ms)`, `Fatigue scale rushed, ${(fatigue!.response_time_ms! / 1000).toFixed(1)} s`);
  const careless_rushed_perception = !!perception && perception.response_time_ms != null && perception.response_time_ms < ENGAGEMENT.PERCEPTION_RUSHED_MS;
  if (careless_rushed_perception) penalise(ENGAGEMENT_PENALTY.RUSHED_PERCEPTION, `perception rating rushed (${Math.round(perception!.response_time_ms!)}ms)`, `Display rating rushed, ${(perception!.response_time_ms! / 1000).toFixed(1)} s`);

  // Straight-lined fatigue ratings.
  const careless_straight_lined = isStraightLined(fatigue);
  if (careless_straight_lined) penalise(ENGAGEMENT_PENALTY.STRAIGHT_LINED, 'fatigue ratings straight-lined (all five identical)', 'Fatigue ratings all the same');

  // Comprehension miss (weak on its own). With three items per passage a single slip is not
  // evidence of disengagement, so the flag fires only at or below chance, which for three
  // 4-option items means fewer than half correct.
  const compAnswered = comprehension?.length ?? 0;
  const compCorrect = comprehension?.filter((x) => x.is_correct).length ?? 0;
  const comprehension_wrong = compAnswered > 0 && compCorrect / compAnswered < 0.5;
  if (comprehension_wrong) penalise(ENGAGEMENT_PENALTY.COMPREHENSION_BELOW_CHANCE, `comprehension below chance (${compCorrect}/${compAnswered})`, `Comprehension ${compCorrect} of ${compAnswered}`);

  // Camera: participant turned away for a large share of the condition.
  // Null face presence means no face was ever found; that is not "low presence", it is no
  // measurement at all, and it is already reported by camera_active plus the null ocular columns.
  const low_face_presence = !!eye && eye.camera_active && eye.face_presence_ratio != null
    && eye.face_presence_ratio < ENGAGEMENT.FACE_PRESENCE_MIN;
  // Raised from 0.1: at 0.1 a condition whose face was found in a third of frames still scored 0.9
  // and passed as "good", so the pre-registered drop-disengaged filter did not remove it.
  if (low_face_presence) penalise(ENGAGEMENT_PENALTY.LOW_FACE_PRESENCE, `low face presence (${Math.round((eye!.face_presence_ratio as number) * 100)}%)`, `Face in view only ${Math.round((eye!.face_presence_ratio as number) * 100)}%`);

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
    report(`only ${blinkCount} blinks captured — incomplete-blink ratio is imprecise (need >= ${ENGAGEMENT.MIN_BLINKS_FOR_RATIO})`, `Few blinks (${blinkCount})`, 'eye');
  }

  // Frame rate too low for the PRIMARY OUTCOME. Reported, not penalised and not dropped: a low
  // frame rate is a property of the device and the light, not of the participant's engagement, and
  // dropping these conditions would bias the sample toward whichever participants, devices and
  // seating positions sustain a high frame rate. Ambient illumination is held constant by protocol
  // now rather than manipulated, so it is no longer the axis at risk — but face illuminance still
  // varies with display polarity, which IS an independent variable, so the bias is not neutral.
  // Undersampling biases the sampled minimum EAR upward, so the ratio is inflated, directionally.
  // Judged by the frame-rate gate fps-g2 (frameRateGate.ts): tiers B and C only. This used to say
  // "below the 30 fps needed ... biased upward" under a never-verified 30 that nearly every condition
  // on the tablet missed, so it was on almost every row and told the reader nothing.
  const gateFps = eye && eye.camera_active ? samplingFpsObservedOf(eye) : null;
  const gateTier = eye && eye.camera_active ? fpsTier(gateFps) : null;
  if (gateTier === 'B' || gateTier === 'C') {
    report(`frame rate ${gateTier === 'C' ? 'too low' : 'reduced'} (${gateFps!.toFixed(1)} a second; ${FPS_GATE.ADEQUATE} is adequate)`, `Eye sampling rate ${gateTier === 'C' ? 'too slow' : 'reduced'}`, 'eye');
  }

  const quality_score = Math.max(0, Math.round(score * 100) / 100);
  const engagement: QcFlag = quality_score >= ENGAGEMENT.QUALITY_GOOD ? 'good' : quality_score >= ENGAGEMENT.QUALITY_WARN ? 'warn' : 'bad';

  return {
    engagement, quality_score, reasons, signals,
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

/** sampling_fps_observed of one eye row (frameRateGate.ts), from its two stored columns. */
function samplingFpsObservedOf(eye: EyeMetricsRecord): number | null {
  return gateParticipant([{ cameraActive: eye.camera_active, sampleCount: eye.ear_sample_count, observedMs: eye.observed_duration_ms }])[0].fps;
}

export function buildConditionSummaries(bundle: SessionBundle): ConditionSummary[] {
  const baseline = baselineFatigueMean(bundle);
  /*
   * The frame-rate gate over this sitting's conditions at once, because its consistency part compares
   * each condition with the median of all of them — the same rows, first eye record per condition, that
   * analysis_long.csv judges for this sitting.
   */
  const gate = gateParticipant(bundle.conditions.map((c) => {
    const e = bundle.eyeMetrics.find((x) => x.condition_id === c.condition_id);
    return { cameraActive: e?.camera_active === true, sampleCount: e?.ear_sample_count, observedMs: e?.observed_duration_ms };
  }));

  return bundle.conditions.map((c, ci) => {
    const rt = bundle.rtSummaries.find((r) => r.condition_id === c.condition_id);
    const fat = bundle.fatigue.find((f) => f.condition_id === c.condition_id && f.stage === 'post_condition');
    const comp = bundle.comprehension.filter((x) => x.condition_id === c.condition_id);
    const vs = bundle.visualSearch.find((v) => v.condition_id === c.condition_id);
    const perc = bundle.perception.find((p) => p.condition_id === c.condition_id);
    const eye = bundle.eyeMetrics.find((e) => e.condition_id === c.condition_id);

    const cameraActive = eye?.camera_active ?? false;
    const facePresence = cameraActive ? (eye?.face_presence_ratio ?? null) : null;
    const fps = cameraActive ? (eye?.effective_fps ?? null) : null;
    const g = gate[ci];
    const offAxis = cameraActive ? (eye?.off_axis_ratio ?? null) : null;

    /*
     * Green only at the protocol's own gate. See ENGAGEMENT.FACE_PRESENCE_PILOT_GATE for why 0.9 and
     * not the 0.8 that used to be written here as a literal.
     */
    const facePresenceFlag: QcFlag = cameraActive
      ? flag(facePresence, ENGAGEMENT.FACE_PRESENCE_PILOT_GATE, ENGAGEMENT.FACE_PRESENCE_MIN)
      : 'warn';
    /*
     * The frame-rate gate fps-g2 (frameRateGate.ts), as the export and the templates apply it: good in
     * tier A and consistent with the sitting's median, warn in tier B or when more than 2 fps from that
     * median, bad in tier C or with no rate. It was good only at 30 on effective_fps (gate g1), which a
     * tablet delivering 23-25 never reached: every condition was amber or red, so the colour carried no
     * information. The same verdict as the camera-verdict line and the cohort tab.
     */
    const fpsFlag: QcFlag = !cameraActive ? 'warn'
      : g.tier === 'A' ? (g.consistent === false ? 'warn' : 'good')
        : g.tier === 'B' ? 'warn' : 'bad';
    const offAxisFlag: QcFlag = cameraActive ? flag(offAxis, 0.2, 0.4, false) : 'warn';
    // Lighting: 'good' is in range; 'low'/'overexposed' degrade blink/EAR detection → warn.
    const lightingQuality = cameraActive ? (eye?.lighting_quality ?? null) : null;
    const lightingFlag: QcFlag = !cameraActive ? 'warn' : lightingQuality == null ? 'warn' : lightingQuality === 'good' ? 'good' : 'warn';

    const observedMinutes = cameraActive && eye?.observed_duration_ms != null ? eye.observed_duration_ms / 60000 : null;

    const eng = conditionEngagement({
      reading_time_ms: c.reading_time_ms,
      reading_min_page_dwell_ms: c.reading_min_page_dwell_ms ?? null,
      reading_hidden_ms: c.reading_hidden_ms ?? null,
      condition_hidden_ms: c.condition_hidden_ms ?? null,
      condition_portrait_ms: c.condition_portrait_ms ?? null,
      condition_notice_ms: c.condition_notice_ms ?? null,
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
      engagement_signals: eng.signals,
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
      search_termination: vs?.termination_mode ?? null,
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
      sampling_fps_observed: g.fps,
      fps_tier: g.tier,
      fps_consistent: g.consistent,
      fps_median: cameraActive ? g.participantMedian : null,
      face_presence_ratio: facePresence,
      off_axis_ratio: offAxis,
      observed_duration_ms: cameraActive ? (eye?.observed_duration_ms ?? null) : null,
      camera_blocked_ms: cameraActive ? (eye?.camera_blocked_ms ?? null) : null,
      open_eye_vs_baseline: cameraActive && eye?.open_ear_measured != null && eye.ear_baseline != null && eye.ear_baseline > 0
        ? eye.open_ear_measured / eye.ear_baseline : null,
      on_screen_ratio: cameraActive ? (eye?.on_screen_ratio ?? null) : null,
      mean_face_luma: cameraActive ? (eye?.mean_face_luma ?? null) : null,
      lighting_quality: lightingQuality,
      qc: {
        facePresence: facePresenceFlag,
        fps: fpsFlag,
        offAxis: offAxisFlag,
        lighting: lightingFlag,
        overall: worst([facePresenceFlag, fpsFlag, offAxisFlag, lightingFlag]),
      },
      observed_minutes: observedMinutes,
      camera_verdict: cameraVerdict(eye, {
        facePresence, fps: g.fps, lighting: lightingQuality, blinks: eng.blink_count_total, minutes: observedMinutes,
        consistent: g.consistent, median: g.participantMedian, offAxis, readingMs: c.reading_time_ms,
      }),
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
  /**
   * Rows from a participant who WITHDREW. Counted, and kept out of the outcome mean and the position
   * balance for the same reason the analysis templates drop them: a withdrawal is an instruction,
   * not a quality flag, and this tab is the one people read as "how the study is going".
   */
  n_withdrawn: number;
  /**
   * Rows in the CONFIRMATORY SET (inConfirmatorySet): analysable by the join check, not withdrawn,
   * not a test-harness sitting, the first protocol pass. The rows both analysis templates model.
   */
  n_analysable: number;
  /** Rows with a usable primary outcome — a denominator of at least one blink. */
  n_with_outcome: number;
  /**
   * MEAN OF PER-RUN RATIOS over rows that have one; null when none do. Every run counts once,
   * whether its ratio rests on 8 blinks or 60 — which is NOT the quantity the primary model
   * estimates. See pooled_ibr.
   */
  mean_ibr: number | null;
  /**
   * POOLED ratio: incomplete blinks over all blinks, summed across the same rows. The binomial model
   * weights each run by its blink count, so this — not mean_ibr — is the descriptive quantity it is
   * estimating (on the logit scale, conditional on the participant). The two differ noticeably when
   * blink counts vary between runs, so both are shown. Null when no row has a blink.
   */
  pooled_ibr: number | null;
  /** Total blinks behind that mean. The ratio's precision rests on this, not on n. */
  blinks_total: number;
  /** Incomplete blinks summed over the same rows: pooled_ibr = incomplete_total / blinks_total. */
  incomplete_total: number;
  /** Rows below tier A of the frame-rate gate fps-g2 (fps_tier B or C in analysis_long.csv). */
  n_fps_inadequate: number;
  /** Rows more than 2 fps from their participant's median (fps_consistent FALSE). */
  n_fps_inconsistent: number;
  /**
   * The confirmatory rows by ocular_reliability (rule rel-r1), as analysis_long.csv carries it: the same
   * verdict, from the same columns, as the per-sitting tabs show.
   */
  n_good: number;
  n_usable: number;
  n_not_usable: number;
}

export interface CohortSummary {
  participants: number;
  analysable_participants: number;
  rows: number;
  /** The confirmatory set (inConfirmatorySet): what every model in the analysis templates sees. */
  confirmatory: { rows: number; participants: number };
  /**
   * The sensitivity set (inSensitivitySet): the confirmatory set plus the finished runs of
   * participants excluded ONLY for an incomplete condition set. The templates refit the primary on it.
   */
  sensitivity: { rows: number; participants: number };
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
  /**
   * Camera-on confirmatory rows, and how many of them a §5.3–5.4 check flags (face in view, head turned
   * away, the reading seen). The R template prints the same count ("rows failing at least one §5
   * check"), and the analysis gate holds the two equal on the same cohort.
   */
  qcChecks: { flagged: number; of: number };
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

/** protocol_pass above 0: a repeat pass. Blank is a sitting recorded before the column, all first passes. */
const isRepeatPass = (v: string | undefined) => Number.isFinite(Number(v)) && Number(v) > 0;

/**
 * THE CONFIRMATORY SET, row by row, from analysis_long.csv.
 *
 * The same rule analysis_template.R and analysis_template.py apply, from the same verdict: the join
 * check found the participant analysable and this run finished (`analysable` carries both), the
 * participant did not withdraw, the sitting was not run under the test harness, and it is the
 * participant's first pass through the protocol. `analysable` already excludes the first three in
 * every case the join check can see; protocol_pass is checked here because a repeat-pass sitting
 * whose first pass is no longer on the device is analysable to the join check, and the codebook says
 * "Exclude or model those participants; do not pool the two passes as independent observations".
 *
 * This tab used to say "the analysis models analysable rows only" while both templates modelled
 * every finished row of every participant who had not withdrawn — test sessions, integrity-blocked
 * sittings and incomplete participants included. The templates now read the exporter's verdict, so
 * the claim is true; scripts/verifyAnalysis.mjs checks that R, Python and this function count the
 * same rows on the same cohort.
 */
export function inConfirmatorySet(r: Record<string, string>): boolean {
  return isTrue(r.analysable) && !isTrue(r.withdrawn) && !isTrue(r.e2e_timing) && !isRepeatPass(r.protocol_pass);
}

/**
 * THE SENSITIVITY SET: the confirmatory set plus the finished runs of participants whose ONLY
 * exclusion is an incomplete condition set (ANALYSIS_PLAN.md §1; COMPLETENESS_EXCLUSIONS).
 */
export function inSensitivitySet(r: Record<string, string>): boolean {
  if (r.condition_complete === 'false' || r.condition_complete === 'FALSE') return false;
  if (isTrue(r.withdrawn) || isTrue(r.e2e_timing) || isRepeatPass(r.protocol_pass)) return false;
  const codes = (r.exclusion_reason ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  return codes.every((c) => (COMPLETENESS_EXCLUSIONS as readonly string[]).includes(c));
}

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
  let qcFlagged = 0;
  let qcOf = 0;
  const positionBalance: Record<string, number[]> = {};
  const exclusionCounts = new Map<string, number>();

  for (const r of rows) {
    const label = r.condition_label || '(unlabelled)';
    let c = byCondition.get(label);
    if (!c) {
      c = {
        condition_label: label, polarity: r.polarity ?? '', text_colour: r.text_colour ?? '',
        n: 0, n_unfinished: 0, n_withdrawn: 0, n_analysable: 0, n_with_outcome: 0, mean_ibr: null, pooled_ibr: null,
        blinks_total: 0, incomplete_total: 0, n_fps_inadequate: 0, n_fps_inconsistent: 0,
        n_good: 0, n_usable: 0, n_not_usable: 0,
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
    // Withdrawn first: a withdrawn participant's unfinished run is counted once, as withdrawn. The
    // pooled file always carried `withdrawn`; this view read `analysable` and nothing else, so a
    // withdrawn participant's blinks were still averaged into the cohort mean shown here.
    if (isTrue(r.withdrawn)) {
      c.n_withdrawn++;
      continue;
    }
    if (r.condition_complete === 'false' || r.condition_complete === 'FALSE') {
      c.n_unfinished++;
      continue;
    }
    if (inConfirmatorySet(r)) c.n_analysable++;
    /*
     * Only CONFIRMATORY rows reach the outcome mean and the position balance. This tab reads the
     * pooled file so that the numbers shown are the ones the analysis will see, and the analysis
     * models the confirmatory set only (inConfirmatorySet): a test-harness sitting, one with broken
     * joins, or one whose ocular data has no consent behind it (see BLOCKING_AUDIT_CHECKS in
     * joinIntegrity.ts) was averaged in here all the same. Such rows still count in n, so a condition
     * falling behind is still visible.
     */
    if (!inConfirmatorySet(r)) continue;
    // The frame-rate gate fps-g2, as analysis_long.csv carries it. A blank tier is "no rate" (camera
    // off, or too little observed), which is not the same as inadequate and is counted as neither.
    if (r.fps_tier === 'B' || r.fps_tier === 'C') c.n_fps_inadequate++;
    if (r.fps_consistent !== '' && r.fps_consistent != null && !isTrue(r.fps_consistent)) c.n_fps_inconsistent++;
    if (r.ocular_reliability === 'good') c.n_good++;
    else if (r.ocular_reliability === 'usable') c.n_usable++;
    else if (r.ocular_reliability === 'not_usable') c.n_not_usable++;
    if (isTrue(r.camera_active)) {
      qcOf++;
      if (QC_CHECK_CODES.some((k) => (r.ocular_reliability_checks ?? '').split(';').includes(k))) qcFlagged++;
    }

    const denom = Number(r.n_blinks_total);
    const ratio = Number(r.incomplete_blink_ratio);
    const incomplete = Number(r.n_incomplete);
    if (Number.isFinite(denom) && denom > 0 && Number.isFinite(ratio)) {
      // Accumulated as a running sum in mean_ibr, divided out below. The blink total is carried
      // because it, not the row count, is what the ratio's precision actually rests on.
      c.mean_ibr = (c.mean_ibr ?? 0) + ratio;
      c.n_with_outcome++;
      c.blinks_total += denom;
      // The numerator from the exported COUNT, not ratio x denominator, so no rounding of the
      // four-decimal ratio sits between the blink counts and the pooled figure.
      c.incomplete_total += Number.isFinite(incomplete) ? incomplete : ratio * denom;
    }

    const pos = Number(r.session_position);
    if (Number.isFinite(pos) && pos >= 0 && pos < nConditions) {
      (positionBalance[label] ??= Array.from({ length: nConditions }, () => 0))[pos]++;
    }
  }

  const conditions = [...byCondition.values()]
    .map((c) => ({
      ...c,
      mean_ibr: c.n_with_outcome > 0 && c.mean_ibr != null ? c.mean_ibr / c.n_with_outcome : null,
      pooled_ibr: c.blinks_total > 0 ? c.incomplete_total / c.blinks_total : null,
    }))
    .sort((a, b) => a.condition_label.localeCompare(b.condition_label));

  const setSize = (pick: (r: Record<string, string>) => boolean) => {
    const inSet = rows.filter(pick);
    return { rows: inSet.length, participants: new Set(inSet.map((r) => r.participant_id)).size };
  };
  const ns = conditions.map((c) => c.n);
  return {
    participants: integrity.total_participants,
    analysable_participants: integrity.analysable_participants,
    rows: rows.length,
    confirmatory: setSize(inConfirmatorySet),
    sensitivity: setSize(inSensitivitySet),
    conditions,
    positionBalance,
    exclusions: [...exclusionCounts.entries()]
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n),
    issues: integrity.issues,
    minConditionN: ns.length ? Math.min(...ns) : 0,
    maxConditionN: ns.length ? Math.max(...ns) : 0,
    qcChecks: { flagged: qcFlagged, of: qcOf },
  };
}

/** The ocular_reliability_checks codes of the R template's §5.3–5.4 checks, which its qc_clean combines. */
const QC_CHECK_CODES = ['face_in_view', 'head_turned_away', 'exposure_short'];
