/**
 * Is this condition's blink data reliable? One verdict, rule rel-r1 (Round 83), read off the checks the
 * analysis itself applies — nothing new is decided here.
 *
 * WHY. The dashboard judged blink data by its own thresholds, which were not the analysis's: a face in
 * view 80% of the time was "Not trustworthy" there and an ordinary row of the confirmatory model in the
 * templates; a camera covered for 30 s was "Not trustworthy" while the camera-off and no-baseline rows
 * beside it read "warn" in the same page's QC table. The investigator, testing the build, saw most
 * conditions marked bad and could not tell which rule had failed. A verdict an operator acts on — reseat
 * the participant, re-run the condition — has to mean what the analysis will do with the row.
 *
 * THE THREE WORDS, and what each means for the analysis (ANALYSIS_PLAN.md §5):
 *
 *   not usable  The row is NOT IN the confirmatory eye-data models at all: the camera was off or stopped,
 *               no blink was counted (without an open-eye baseline nothing is counted), or the eye
 *               sampling rate is tier C under gate fps-g2. The R template's own filters, in its order.
 *   usable      The row IS in the confirmatory models, and a pre-specified check flags it, so one of the
 *               pre-registered re-fits leaves it out: tier B (the tier-A-only refit), a rate more than
 *               2 fps off the participant's usual (the consistent-rows refit), or a §5.3–5.4 check (the
 *               QC-clean refit: face in view under 0.90, head turned away over 0.20, the camera seeing
 *               under 0.90 of the reading).
 *   good        In the confirmatory models, and no check flags it.
 *
 * NOT IN THE VERDICT, shown beside it as notes (aggregate.ts): few blinks, the light, a covered camera, an
 * open eye narrower than at calibration. No analysis rule uses them — the binomial model already weights
 * each run by its blinks — so they cannot make a row worse than the analysis treats it. They are still
 * worth reading, which is why they are on the screen.
 *
 * THE THRESHOLDS ARE THE TEMPLATES'. Face in view 0.90 is the protocol's pilot gate (R
 * QC_FACE_PRESENCE_MIN); head turned away 0.20 and the observed share 0.90 are the R template's ANALYST
 * DEFAULTS (QC_OFF_AXIS_MAX, QC_EXPOSURE_MIN_FRAC), labelled so there. tests/ocularReliability.test.ts
 * reads them out of analysis_template.R and fails if either side moves, and the analysis gate checks
 * that R's §5 count and this rule's count agree on the same cohort.
 *
 * VERSIONED. Every export row that carries the verdict carries `reliability_rule_version`. A change to
 * a check, a threshold or the mapping to the three words must change RELIABILITY_RULE_VERSION.
 *
 * Pure: the same function serves the dashboard (from a sitting's records) and the export (from the
 * columns of analysis_long.csv), so the screen and the file cannot disagree.
 */
import { FPS_GATE, fpsTier } from './frameRateGate';
import { MEASURE } from './measurementSchedule';

/** Any change to a check, a threshold or the mapping to the three words must change this string. */
export const RELIABILITY_RULE_VERSION = 'rel-r1';

/** The R template's §5.3–5.4 thresholds (analysis_template.R), pinned by tests/ocularReliability.test.ts. */
export const RELIABILITY_GATES = {
  /** §5.3 — PROTOCOL-DERIVED: the pilot gate's 0.90 (R QC_FACE_PRESENCE_MIN), applied per row. */
  FACE_IN_VIEW_MIN: 0.9,
  /** §5.3 — ANALYST DEFAULT (R QC_OFF_AXIS_MAX): share of face frames with the head turned away. */
  HEAD_TURNED_AWAY_MAX: 0.2,
  /** §5.4 — ANALYST DEFAULT (R QC_EXPOSURE_MIN_FRAC): observed_duration_ms / reading_time_ms. */
  EXPOSURE_MIN_FRAC: 0.9,
} as const;

export type Reliability = 'good' | 'usable' | 'not_usable';

/** The verdict in words, the same on the dashboard and in the export codebook. */
export const RELIABILITY_WORD: Record<Reliability, string> = { good: 'Good', usable: 'Usable', not_usable: 'Not usable' };

/** pass: the check holds. flag: kept, left out of one re-fit. fail: out of the eye-data models. */
export type CheckStatus = 'pass' | 'flag' | 'fail' | 'not_judged';

export interface ReliabilityCheck {
  /** Stable key, the same on every row whatever the status. */
  key: 'camera' | 'blinks' | 'rate' | 'consistency' | 'face' | 'head' | 'exposure';
  /** Written to the export (ocular_reliability_checks) when the check flags or fails; '' when it passes. */
  code: string;
  /** The measure's one screen name (MEASURE). */
  label: string;
  status: CheckStatus;
  /** What was measured, in words. */
  value: string;
  /** What the check needs, in words. */
  needed: string;
  /** Which rule this is, short: the gate and the plan section. */
  gate: string;
  /** What the analysis does with the row when this check is not passed; '' when it passes. */
  consequence: string;
  /** One short phrase for a headline; '' when it passes. */
  phrase: string;
}

export interface ReliabilityResult {
  reliability: Reliability;
  rule_version: typeof RELIABILITY_RULE_VERSION;
  /** Every check, in a fixed order. */
  checks: ReliabilityCheck[];
  /** The codes of the checks that failed or flagged, fails first, ';'-joined — the export column. */
  codes: string;
}

/** What the verdict is read from: columns every 07 row and every analysis_long.csv row carry. */
export interface ReliabilityInput {
  /** An eye record exists for the run. */
  hasEyeRecord: boolean;
  cameraActive: boolean;
  cameraInactiveReason?: 'lost' | 'not_running' | null;
  /** Blinks counted (full + micro + incomplete); null when the blink measures are blank. */
  blinkTotal: number | null;
  /** The open-eye baseline was present; only words depend on it (it says WHY blinks are blank). */
  hasBaseline?: boolean | null;
  /** sampling_fps_observed (gate fps-g2). */
  fps: number | null;
  /** fps_consistent; null when unknown. */
  fpsConsistent: boolean | null;
  /** The participant's median the consistency was judged against, for the words only. */
  fpsMedian?: number | null;
  facePresence: number | null;
  offAxis: number | null;
  observedMs: number | null;
  readingMs: number | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const PASS = { code: '', consequence: '', phrase: '' };

/** The verdict for one condition-run. */
export function ocularReliability(x: ReliabilityInput): ReliabilityResult {
  const on = x.hasEyeRecord && x.cameraActive;
  const checks: ReliabilityCheck[] = [];
  const NOT_JUDGED = (key: ReliabilityCheck['key'], label: string, needed: string, gate: string): ReliabilityCheck =>
    ({ key, label, status: 'not_judged', value: '—', needed, gate, ...PASS });

  // 1. The camera. The R ocular frame is camera_active == 1; everything below needs it.
  const cameraWord = !x.hasEyeRecord ? 'no eye record'
    : x.cameraActive ? 'on'
      : x.cameraInactiveReason === 'lost' ? 'stopped during the reading'
        : x.cameraInactiveReason === 'not_running' ? 'not running'
          : 'not used';
  checks.push({
    key: 'camera', label: 'Camera', value: cameraWord, needed: 'on for the reading', gate: 'camera-on rows only (plan §5)',
    ...(on ? { status: 'pass', ...PASS } : {
      status: 'fail', code: x.hasEyeRecord ? 'camera_off' : 'no_eye_record',
      consequence: 'Not in the eye-data analysis.',
      phrase: x.hasEyeRecord ? `camera ${cameraWord}` : 'no eye record for this condition',
    }),
  });

  // 2. Blinks. The primary needs a denominator: R keeps rows with blink_total > 0.
  const blinksNeeded = 'at least 1';
  const blinksGate = 'the ratio needs blinks (plan §2)';
  if (!on) checks.push(NOT_JUDGED('blinks', MEASURE.blinks.name, blinksNeeded, blinksGate));
  else if (x.blinkTotal == null) {
    checks.push({
      key: 'blinks', label: MEASURE.blinks.name, status: 'fail', code: 'blinks_not_counted',
      value: x.hasBaseline === false ? 'not counted: no open-eye baseline' : 'not counted',
      needed: blinksNeeded, gate: blinksGate,
      consequence: 'No incomplete-blink ratio, so not in the main model.',
      phrase: x.hasBaseline === false ? 'no open-eye baseline, so no blinks were counted' : 'no blink count',
    });
  } else if (x.blinkTotal <= 0) {
    checks.push({
      key: 'blinks', label: MEASURE.blinks.name, status: 'fail', code: 'zero_blinks', value: '0', needed: blinksNeeded, gate: blinksGate,
      consequence: 'No incomplete-blink ratio, so not in the main model.', phrase: 'no blinks were counted',
    });
  } else {
    checks.push({ key: 'blinks', label: MEASURE.blinks.name, status: 'pass', value: String(x.blinkTotal), needed: blinksNeeded, gate: blinksGate, ...PASS });
  }

  // 3. The rate's tier, gate fps-g2. Tier C is out of the confirmatory models; tier B is kept.
  const rateNeeded = `${FPS_GATE.ADEQUATE} a second or more (${FPS_GATE.REDUCED}–${FPS_GATE.ADEQUATE} reduced)`;
  const rateGate = 'fps-g2 tier (plan §5.2)';
  const tier = fpsTier(x.fps);
  // One decimal: a rate rounded to the whole number can land on the floor it failed (19.96 -> "20").
  const r = x.fps == null ? null : x.fps.toFixed(1);
  if (!on) checks.push(NOT_JUDGED('rate', MEASURE.samplingRate.name, rateNeeded, rateGate));
  else if (tier == null) {
    // No rate with the camera on: under a second observed or under two samples. The templates keep such
    // a row if it has blinks, so it is flagged, never passed: nothing vouches for its sampling.
    checks.push({
      key: 'rate', label: MEASURE.samplingRate.name, status: 'flag', code: 'fps_unknown', value: 'not measurable',
      needed: rateNeeded, gate: rateGate, consequence: 'Kept; nothing says how finely the eye was sampled.',
      phrase: 'eye sampling rate not measurable',
    });
  } else if (tier === 'C') {
    checks.push({
      key: 'rate', label: MEASURE.samplingRate.name, status: 'fail', code: 'fps_tier_C', value: `${r} a second (tier C)`,
      needed: rateNeeded, gate: rateGate,
      consequence: 'Out of the main eye-data models; one pre-planned re-check puts it back.',
      phrase: `eye sampling rate too slow (${r} a second; ${FPS_GATE.REDUCED} needed)`,
    });
  } else if (tier === 'B') {
    checks.push({
      key: 'rate', label: MEASURE.samplingRate.name, status: 'flag', code: 'fps_tier_B', value: `${r} a second (tier B)`,
      needed: rateNeeded, gate: rateGate,
      consequence: 'Kept; left out of the tier-A-only re-check.',
      phrase: `eye sampling rate reduced (${r} a second; ${FPS_GATE.ADEQUATE} is adequate)`,
    });
  } else {
    checks.push({ key: 'rate', label: MEASURE.samplingRate.name, status: 'pass', value: `${r} a second (tier A)`, needed: rateNeeded, gate: rateGate, ...PASS });
  }

  // 4. Consistency with the participant's usual rate, the second part of fps-g2.
  const consNeeded = `within ${FPS_GATE.CONSISTENCY_BAND} a second of the usual`;
  const consGate = 'fps-g2 consistency (plan §5.2)';
  const usual = x.fpsMedian == null ? null : x.fpsMedian.toFixed(1);
  if (!on || x.fpsConsistent == null) checks.push(NOT_JUDGED('consistency', `${MEASURE.samplingRate.name}, steady`, consNeeded, consGate));
  else if (!x.fpsConsistent) {
    checks.push({
      key: 'consistency', label: `${MEASURE.samplingRate.name}, steady`, status: 'flag', code: 'fps_off_usual',
      value: `${r} against a usual ${usual ?? '?'}`, needed: consNeeded, gate: consGate,
      consequence: 'Kept; left out of the consistent-rows re-check.',
      phrase: `eye sampling rate ${r}, more than ${FPS_GATE.CONSISTENCY_BAND} from the usual ${usual ?? '?'}`,
    });
  } else {
    checks.push({ key: 'consistency', label: `${MEASURE.samplingRate.name}, steady`, status: 'pass', value: `${r} against a usual ${usual ?? '?'}`, needed: consNeeded, gate: consGate, ...PASS });
  }

  // 5-7. The R template's §5.3–5.4 checks, each a strict inequality as R writes it, and a missing value
  // judged by nobody (R's is.finite guard).
  const qc = (key: 'face' | 'head' | 'exposure', label: string, value: number | null, bad: (v: number) => boolean,
    needed: string, gate: string, code: string, phrase: (v: number) => string) => {
    if (!on || value == null || !Number.isFinite(value)) { checks.push(NOT_JUDGED(key, label, needed, gate)); return; }
    checks.push(bad(value)
      ? { key, label, status: 'flag', code, value: pct(value), needed, gate, consequence: 'Kept; left out of the quality-clean re-check.', phrase: phrase(value) }
      : { key, label, status: 'pass', value: pct(value), needed, gate, ...PASS });
  };
  const G = RELIABILITY_GATES;
  qc('face', MEASURE.faceInView.name, x.facePresence, (v) => v < G.FACE_IN_VIEW_MIN,
    `${pct(G.FACE_IN_VIEW_MIN)} or more`, 'face in view (plan §5.3)', 'face_in_view',
    (v) => `face in view ${pct(v)} (${pct(G.FACE_IN_VIEW_MIN)} needed)`);
  qc('head', MEASURE.headTurnedAway.name, x.offAxis, (v) => v > G.HEAD_TURNED_AWAY_MAX,
    `${pct(G.HEAD_TURNED_AWAY_MAX)} or less`, 'head turned away (plan §5.3)', 'head_turned_away',
    (v) => `head turned away ${pct(v)} of the time (${pct(G.HEAD_TURNED_AWAY_MAX)} at most)`);
  const frac = x.observedMs != null && x.readingMs != null && x.readingMs > 0 ? x.observedMs / x.readingMs : null;
  qc('exposure', 'Reading seen', frac, (v) => v < G.EXPOSURE_MIN_FRAC,
    `${pct(G.EXPOSURE_MIN_FRAC)} or more`, 'reading seen by the camera (plan §5.4)', 'exposure_short',
    (v) => `the camera saw ${pct(v)} of the reading (${pct(G.EXPOSURE_MIN_FRAC)} needed)`);

  const fails = checks.filter((c) => c.status === 'fail');
  const flags = checks.filter((c) => c.status === 'flag');
  return {
    reliability: fails.length ? 'not_usable' : flags.length ? 'usable' : 'good',
    rule_version: RELIABILITY_RULE_VERSION,
    checks,
    codes: [...fails, ...flags].map((c) => c.code).join(';'),
  };
}

/**
 * One plain sentence for a condition: the verdict, then the first reason (and how many more), or what was
 * seen when nothing is wrong. `seen` is e.g. "38 blinks in 2.9 min".
 */
export function reliabilityHeadline(res: ReliabilityResult, seen: string): string {
  const wrong = [...res.checks.filter((c) => c.status === 'fail'), ...res.checks.filter((c) => c.status === 'flag')];
  if (!wrong.length) return `${RELIABILITY_WORD.good}: ${seen}, every check passed`;
  const first = wrong[0].phrase;
  const more = wrong.length > 1 ? ` (+${wrong.length - 1} more)` : '';
  return `${RELIABILITY_WORD[res.reliability]}: ${first}${more}`;
}
