/**
 * The shared timing model for the protocol.
 *
 * Extracted so that every script that reasons about session length reads the SAME per-step
 * durations. Two scripts consume it — simulateParticipant.ts (how long is the protocol as it
 * stands?) and protocolFrontier.ts (what would shortening it cost?) — and if either carried its
 * own copy of these numbers the two would answer the same question differently within a week.
 *
 * Every app-controlled duration is read from the real CONFIG. Every participant-controlled
 * duration is drawn from a distribution whose basis is documented at each call site and in
 * docs/TIMING_MODEL.md.
 */
import { CONFIG } from '../../src/experiment/config';
import { CONDITIONS } from '../../src/experiment/conditions';
import { PASSAGES, QUESTIONS_PER_PASSAGE } from '../../src/experiment/passages';
import { blockPlan } from '../../src/experiment/counterbalance';
import { nonAgingDelay } from '../../src/lib/foreperiod';

// ---------------------------------------------------------------- rng
let seed = 20260817;
export function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
export function gauss(mean: number, sd: number): number {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const S = 1000;

// ---------------------------------------------------------------- population model
export interface Person {
  /** Words per minute on dense expository prose, read for comprehension. */
  wpm: number;
  /** Deliberation multiplier: scales every self-paced rating/questionnaire step. */
  care: number;
  /** Break-taking multiplier. */
  restiness: number;
  /** Blinks per minute while reading. */
  blinkRate: number;
  /** Baseline proportion of blinks that fail to close fully. */
  incompleteP: number;
}
export function samplePerson(): Person {
  return {
    wpm: clamp(gauss(215, 45), 90, 400),
    care: clamp(gauss(1.0, 0.28), 0.5, 2.4),
    restiness: clamp(gauss(1.0, 0.5), 0.2, 3.5),
    blinkRate: clamp(gauss(13, 4), 4, 28),
    incompleteP: clamp(gauss(0.16, 0.11), 0.01, 0.6),
  };
}

// ---------------------------------------------------------------- per-step models (seconds)
/** Mean seconds the RT block takes, from the real trial-structure constants. */
/**
 * Mean of the foreperiod delay, sampled from the app's own generator.
 *
 * Cached: it is a fixed property of the CONFIG constants, and the simulation calls rtBlockSeconds
 * once per condition per simulated participant.
 */
let cachedDelayMean: number | null = null;
function measuredDelayMean(): number {
  if (cachedDelayMean != null) return cachedDelayMean;
  const N = 20000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    sum += nonAgingDelay(CONFIG.RT_DELAY_MIN_MS, CONFIG.RT_DELAY_MAX_MS, CONFIG.RT_DELAY_MEAN_MS, rnd);
  }
  cachedDelayMean = sum / N;
  return cachedDelayMean;
}

export function rtBlockSeconds(nTrials: number, meanRtMs = 360): number {
  const fix = (CONFIG.RT_FIXATION_MIN_MS + CONFIG.RT_FIXATION_MAX_MS) / 2;
  /*
   * The delay's realised mean, MEASURED from the same function the app draws with.
   *
   * This read (min + max) / 2, which was right while the delay was uniform and wrong the moment it
   * became a truncated exponential: 950 ms assumed against a realised 650, overstating every RT
   * block by 300 ms a trial — 1.6 minutes a sitting. The header of simulateParticipant.ts promises
   * that every app-controlled duration is read from the real CONFIG so the model "cannot drift from
   * what the instrument does". Averaging the bounds of a non-uniform distribution is exactly that
   * drift, so the mean is sampled rather than assumed and the promise holds by construction.
   */
  const del = measuredDelayMean();
  const iti = (CONFIG.RT_ITI_MIN_MS + CONFIG.RT_ITI_MAX_MS) / 2;
  const nGo = Math.round(nTrials * CONFIG.RT_GO_RATE);
  const nNo = nTrials - nGo;
  // A go trial ends on response; a no-go trial waits the whole response window out.
  const go = fix + del + meanRtMs + iti;
  const no = fix + del + CONFIG.RT_RESPONSE_WINDOW_MS + iti;
  return (nGo * go + nNo * no) / S;
}

export interface Breakdown { [k: string]: number }

/**
 * Where each step's duration comes from. This is the distinction that matters when someone asks
 * whether the total is over-estimated, because only one of the three can be argued down.
 *
 *   'enforced'  the app will not advance before this much time has passed. Read from CONFIG.
 *               Not an estimate at all — a lower bound the instrument imposes.
 *   'corpus'    arithmetic over fixed content: words in the passage divided by a reading rate.
 *               The word count is exact; only the rate is assumed, and it is the best-evidenced
 *               assumption in the model (Brysbaert 2019, 190 studies).
 *   'estimated' my per-item guess for a motivated young adult. This is the ONLY tier where
 *               estimation error lives, so it is the only tier that responds to being challenged.
 */
export type Provenance = 'enforced' | 'corpus' | 'estimated';
export const PROVENANCE: Record<string, Provenance> = {
  'adaptation': 'enforced',
  'rt_block': 'enforced',
  'rt_practice (once)': 'enforced',
  'reading': 'corpus',
};
export const provenanceOf = (k: string): Provenance => PROVENANCE[k] ?? 'estimated';

export interface SittingSpec {
  /** Room illumination for this sitting. Orthogonal to `first` by design (§ counterbalance). */
  illumination: 'dim' | 'bright';
  /** True for a participant's first sitting; the second skips the per-participant setup stages. */
  first: boolean;
  /**
   * Fractional slowing of reading rate under 10 lux relative to 150 lux. ASSUMED, not measured —
   * and deliberately exposed as a knob rather than baked in, because the size of this effect is
   * one of the things the study exists to estimate. Assuming it is large would beg the question;
   * assuming it is zero would understate the dim sitting. Reported across 0 / 0.05 / 0.10.
   */
  dimReadingPenalty: number;
  /**
   * How many of the 10 conditions this sitting runs. Fewer conditions per sitting is the only
   * lever that scales the dominant cost, because adaptation + reading + RT is charged per
   * condition. It does not reduce total condition-runs: those are conserved at
   * n x runs-per-participant, so a shorter sitting is paid for in more sittings or more people.
   */
  conditionsThisSitting?: number;
  /**
   * Where the CVS-Q is administered. 'both' is as shipped (baseline and end of every sitting).
   * 'end-only' drops the within-sitting baseline; 'none' demotes it to a once-per-participant
   * screening covariate. It is 6.4 min per sitting, the largest single item of fixed overhead.
   */
  cvsq?: 'both' | 'end-only' | 'none';
  /**
   * Fraction of each passage actually read. Below 1 the participant reads a truncated passage,
   * which cuts minutes in direct proportion and cuts captured blinks in the same proportion —
   * so it trades against the precision of the primary outcome, one for one.
   */
  readingFraction?: number;
}

export function simulateSitting(
  p: Person,
  enrolment: number,
  block: number,
  cfg = CONFIG,
  spec: SittingSpec = { illumination: 'dim', first: true, dimReadingPenalty: 0 },
) {
  const plan = blockPlan(enrolment, block).slice(0, spec.conditionsThisSitting ?? Infinity);
  const b: Breakdown = {};
  const add = (k: string, v: number) => { b[k] = (b[k] ?? 0) + v; };

  /**
   * Deliberation multiplier. On a second sitting the participant already knows every screen, the
   * slider idiom and the task instructions, so self-paced steps run faster. 10% is an estimate.
   */
  const care = p.care * (spec.first ? 1 : 0.9);

  // ---- setup chain. Which stages run is decided by firstUnsatisfiedSetupStage()'s predicates,
  // and those predicates read from different scopes: consent and the two baselines are SESSION
  // fields, so they repeat every sitting; the profile and the colour-vision screen are PARTICIPANT
  // fields, so they run once in a participant's life. Mirroring that split here rather than
  // assuming it is what makes the second-sitting figure a property of the code and not a guess.
  add('session_init (researcher)', gauss(110, 30) / 1);
  add('consent', gauss(170, 50) * care * (spec.first ? 1 : 0.45)); // re-affirmed, not re-read
  if (spec.first) add('participant_profile', gauss(115, 30) * care);
  add('preflight_checklist', gauss(55, 15));
  if (spec.first) add('colour_vision (5 plates)', gauss(80, 20) * care);
  add('camera_setup', gauss(90, 30));
  add('calibration (9-pt + EAR + pitch)', gauss(150, 40));
  // CVS-Q: 16 items, each a frequency choice plus a conditional intensity choice.
  const cvsq = spec.cvsq ?? 'both';
  if (cvsq === 'both') add('cvsq_baseline (16 items)', 16 * gauss(13, 3) * care / 1);
  add('baseline_fatigue (5 sliders)', 5 * gauss(3.4, 1) * care);
  add('instructions', gauss(55, 18) * care * (spec.first ? 1 : 0.6));

  // ---- per-condition loop
  let polaritySwitches = 0;
  let totalBlinks = 0;
  for (let i = 0; i < plan.length; i++) {
    const cond = CONDITIONS[plan[i].conditionIndex];
    const prev = i > 0 ? CONDITIONS[plan[i - 1].conditionIndex] : null;
    const switched = prev != null && prev.polarity !== cond.polarity;
    if (switched) polaritySwitches++;

    // Adaptation: a grey field before EVERY condition, including the first, and doubled on a
    // polarity switch. The pre-first field was added because without it condition 0 began from the
    // light cream setup UI, so adaptation state at onset was a function of the condition's own
    // polarity — an asymmetry confounded with the study's primary factor. It costs 60 s once.
    add('adaptation', (switched ? cfg.ADAPTATION_SWITCH_POLARITY_MS : cfg.ADAPTATION_SAME_POLARITY_MS) / S);

    // Reading: self-paced above a per-page floor.
    const frac = spec.readingFraction ?? 1;
    const words = PASSAGES[plan[i].passageIndex].wordCount * frac;
    const pages = Math.max(1, Math.round(PASSAGES[plan[i].passageIndex].pages.length * frac));
    // Low-contrast conditions slow reading a little; this is the effect under study, so keep it modest.
    const contrastPenalty = cond.below_wcag_aa ? 1.08 : 1.0;
    const dimPenalty = spec.illumination === 'dim' ? 1 + spec.dimReadingPenalty : 1.0;
    const natural = (words / p.wpm) * 60 * contrastPenalty * dimPenalty * gauss(1, 0.08);
    const floor = (pages * cfg.READING_PAGE_MIN_MS) / S;
    const readSec = Math.max(floor, natural);
    add('reading', readSec);
    totalBlinks += (readSec / 60) * p.blinkRate;

    // One entry per comprehension ITEM. Each is a separate screen with its own read-and-answer
    // and its own feedback dwell, so the cost scales with the item count. Charging one item here
    // while the instrument administers three understated every published feasibility figure.
    add(`comprehension (${QUESTIONS_PER_PASSAGE} items)`,
      QUESTIONS_PER_PASSAGE * ((gauss(14, 5) * care) + cfg.COMPREHENSION_FEEDBACK_MS / S));
    add('display_perception (2 sliders)', 2 * gauss(4.2, 1.2) * care);
    add('fatigue_vas (5 sliders)', 5 * gauss(3.2, 0.9) * care);

    // Visual search: bounded by the hard limit; careful searchers use more of the window.
    add('visual_search', Math.min(cfg.VS_TIME_LIMIT_MS / S, gauss(30, 8) * care));

    // RT: an instruction screen each time, plus the block itself, plus one practice block overall.
    add('rt_instructions', gauss(9, 3) * care);
    add('rt_block', rtBlockSeconds(cfg.RT_TRIALS_PER_CONDITION));
    if (i === 0 && cfg.RT_PRACTICE_TRIALS > 0) {
      add('rt_practice (once)', rtBlockSeconds(cfg.RT_PRACTICE_TRIALS) + cfg.RT_PRACTICE_TRIALS * 1.2);
    }

    // Self-paced break after every N conditions, never after the last of the sitting.
    const done = i + 1;
    if (cfg.BREAK_EVERY_N_CONDITIONS > 0 && done % cfg.BREAK_EVERY_N_CONDITIONS === 0 && done < plan.length) {
      add('breaks', clamp(gauss(45, 25) * p.restiness, 8, 300));
    }
  }

  // ---- close
  if (cvsq !== 'none') add('cvsq_end (16 items)', 16 * gauss(11, 3) * care);
  add('nasa_tlx (6 sliders)', 6 * gauss(6.5, 2) * care + gauss(20, 6) * care);
  add('session_complete', gauss(35, 12));

  const total = Object.values(b).reduce((s, v) => s + v, 0);
  return { breakdown: b, total, polaritySwitches, blinksPerCondition: totalBlinks / plan.length };
}

// ---------------------------------------------------------------- run
/** Reset the deterministic stream so two configurations are compared on the same participants. */
export function reseed(v = 20260817): void { seed = v; }

// ------------------------------------------------------------------ precision and power
/**
 * Standard error of a condition-level incomplete-blink ratio. The ratio is a binomial proportion,
 * so its precision is fixed by the NUMBER OF BLINKS captured — not by the number of frames, the
 * frame rate, or the length of the recording except through the blinks it contains.
 */
export function seOfRatio(blinks: number, p = 0.16): number {
  return Math.sqrt((p * (1 - p)) / blinks);
}

/** Power of a two-sided one-sample t-test at alpha = .05, via a normal approximation to the t. */
export function powerT(n: number, dz: number): number {
  if (dz <= 0) return 0.05;
  const ncp = dz * Math.sqrt(n);
  const crit = 1.96 + 1.5 / n; // small-sample nudge toward the t critical value
  const z = ncp - crit;
  const cdf = (x: number) => 0.5 * (1 + Math.sign(x) * Math.sqrt(1 - Math.exp((-2 / Math.PI) * x * x)));
  return cdf(z);
}

/**
 * Measurement SE carried by each contrast of interest, given the per-condition SE.
 *
 * These two lines are the reason the interaction is the binding constraint. The polarity MAIN
 * effect is a difference between two means of five conditions, so averaging shrinks the error by
 * sqrt(5); the polarity x colour INTERACTION is a difference of differences over four SINGLE
 * conditions, so it carries roughly twice the per-condition error. A design change that cuts
 * reading exposure therefore hurts the interaction about four times as much as the main effect.
 */
export const CONTRAST = {
  main: (se: number, nConditions: number) => (se / Math.sqrt(nConditions / 2)) * Math.SQRT2,
  interaction: (se: number) => se * 2,
};

/**
 * Observed d_z after binomial measurement error attenuates the true effect.
 *
 *   observed d_z = true d_z * sqrt( sigma_true^2 / (sigma_true^2 + sigma_measurement^2) )
 */
export function attenuatedDz(trueDz: number, sigmaTrue: number, contrastSe: number): number {
  return trueDz * Math.sqrt((sigmaTrue ** 2) / (sigmaTrue ** 2 + contrastSe ** 2));
}

/**
 * The synopsis power assumptions, in one place so that no script can quietly hold a different
 * effect size than another and reach a different verdict on the same design.
 */
export const SYNOPSIS = {
  /** Between-participant SD of the true within-participant difference score. */
  SIGMA_TRUE: 0.1,
  N_ANALYSED: 130,
  TRUE_DZ_MAIN: 0.3,
  TRUE_DZ_INTERACTION: 0.25,
  /** Targets stated in the synopsis, for comparison. */
  TARGET_POWER_MAIN: 0.92,
  TARGET_POWER_INTERACTION: 0.81,
} as const;

// ------------------------------------------------------------------ d-prime precision
/** Standard normal pdf, for the delta-method variance of a z-transformed proportion. */
const phi = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/**
 * Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.15e-9).
 * Needed because d-prime is a difference of z-transformed rates.
 */
export function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -probit(1 - p);
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Standard error of d-prime for one participant in one condition, by the delta method.
 *
 * d' = z(H) - z(FA), and Var(z(p)) ~= p(1-p) / (n * phi(z(p))^2). The two rates come from
 * DIFFERENT trial counts — go trials give the hit rate, no-go trials the false-alarm rate — and
 * because the no-go trials are the minority (RT_GO_RATE = 0.625), the false-alarm rate is always
 * the noisier half. Halving the block therefore hurts d' more than it hurts the hit rate alone.
 *
 * `hit` and `fa` are an operating point, not a measurement: state it whenever this is quoted.
 */
export function dPrimeSe(nTrials: number, goRate: number, hit = 0.95, fa = 0.1): number {
  const nGo = Math.round(nTrials * goRate);
  const nNo = nTrials - nGo;
  if (nGo < 1 || nNo < 1) return Infinity;
  /*
   * The SAME correction the app applies — the 1/(2N) rule from src/lib/stats.ts — not the
   * log-linear one this used before.
   *
   * A planning tool that predicts the precision of an estimator must model the estimator actually
   * in use. Log-linear shifts every rate; the 1/(2N) rule shifts only the extremes, so on the
   * stated operating point (hit .95, false-alarm .10) the two disagree: .929/.131 against
   * .95/.10, and hence different standard errors for the same block size.
   */
  const clamp = (r: number, n: number) => {
    const lo = 1 / (2 * Math.max(1, n));
    return Math.min(1 - lo, Math.max(lo, r));
  };
  const h = clamp(hit, nGo);
  const f = clamp(fa, nNo);
  const vH = (h * (1 - h)) / (nGo * phi(probit(h)) ** 2);
  const vF = (f * (1 - f)) / (nNo * phi(probit(f)) ** 2);
  return Math.sqrt(vH + vF);
}
