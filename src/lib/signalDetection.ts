/**
 * Signal Detection Theory metrics for the reaction-time (colour go/no-go) task.
 *
 * d' = z(H) - z(F). With only ~24 signal trials per condition the per-condition d' is unstable
 * (the audit flagged this), so we also return its standard error (Macmillan & Creelman) and a
 * flag when SE > 0.3 — the analysis should prefer d' aggregated across conditions.
 */
import { probit, normalPdf, clampRate } from './stats';

export interface SdtInput {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
}

export interface SdtResult {
  /** Hits / signal trials. Null when the block held no signal trials — never 0, which is a claim. */
  hit_rate: number | null;
  /** False alarms / noise trials. Null when the block held no noise trials. */
  false_alarm_rate: number | null;
  /**
   * Sensitivity. NULL when neither response pool contains a trial, because there is nothing to
   * estimate from. This previously returned 0 - a substantive claim of zero sensitivity - for a
   * condition whose reaction-time block never ran, and 0 is a value an analyst will happily
   * average alongside real ones.
   */
  d_prime: number | null;
  criterion: number | null;
  d_prime_se: number | null;
  d_prime_unstable: boolean;
  /** False when the inputs could not support an estimate; d_prime/criterion/se are then null. */
  estimable: boolean;
}

/**
 * Standard error of d' from the hit/FA rates and trial counts.
 * SE(d') = sqrt( H(1-H)/(nS·φ(zH)²) + F(1-F)/(nN·φ(zF)²) ).
 */
function dPrimeStandardError(
  hRate: number,
  fRate: number,
  nSignal: number,
  nNoise: number,
): number {
  const zH = probit(hRate);
  const zF = probit(fRate);
  const phiH = normalPdf(zH);
  const phiF = normalPdf(zF);
  const termH = (hRate * (1 - hRate)) / (nSignal * phiH * phiH);
  const termF = (fRate * (1 - fRate)) / (nNoise * phiF * phiF);
  return Math.sqrt(termH + termF);
}

/** Coerce a trial count to a non-negative integer; anything else is not a count. */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export function computeSdt(input: SdtInput): SdtResult {
  // Counts arrive from tallying stored trial records, which an import or a partial write can
  // corrupt. Anything that is not a non-negative finite integer is treated as absent rather than
  // propagated into a z-score, where NaN or Infinity would surface as a real-looking d'.
  const hits = count(input.hits);
  const misses = count(input.misses);
  const falseAlarms = count(input.falseAlarms);
  const correctRejections = count(input.correctRejections);
  const nSignal = hits + misses;
  const nNoise = falseAlarms + correctRejections;

  // EITHER pool being empty makes d' unestimable, not just both.
  //
  // This read `&&`, so a block with 12 noise trials and no signal trials reported d' = 1.38 with
  // estimable = true - a real sensitivity estimate from data containing no signal to detect. The
  // clamp turned the absent rate into 0.5 and probit happily produced a z-score from it.
  // Sensitivity is the separation between a signal and a noise distribution; with one of them
  // missing there is no separation to measure, however many trials the other pool holds.
  if (nSignal === 0 || nNoise === 0) {
    /*
     * Every field here reports absence, the rates included.
     *
     * They used to return 0, which is a measurement: a hit rate of zero says the participant never
     * responded to a signal, which is a real and damning finding. "There were no signal trials" is
     * a different statement entirely, and exporting the first when the second is true fabricates
     * data — the one thing this file's own comments are otherwise careful never to do.
     */
    return {
      hit_rate: nSignal === 0 ? null : hits / nSignal,
      false_alarm_rate: nNoise === 0 ? null : falseAlarms / nNoise,
      d_prime: null, criterion: null, d_prime_se: null,
      d_prime_unstable: true, estimable: false,
    };
  }

  const rawH = nSignal > 0 ? hits / nSignal : 0;
  const rawF = nNoise > 0 ? falseAlarms / nNoise : 0;

  /*
   * The 1/(2N) rule, NOT the log-linear correction — an earlier comment here called it
   * "loglinear-style", and they are different, separately named procedures.
   *
   * This clamps a rate into [1/(2N), 1 - 1/(2N)], so it touches ONLY the extremes: a hit rate of
   * 0.95 on 20 signal trials passes through unchanged. The log-linear correction adds 0.5 to every
   * cell — (hits + 0.5) / (N + 1) — and so shifts every rate, extreme or not, which on the same
   * input gives 0.929 instead of 0.95.
   *
   * The choice is defensible either way; conflating them in a comment is not, and it left the
   * protocol timing model predicting a d-prime standard error for an estimator the app does not
   * use. scripts/lib/timingModel.ts now applies this same rule.
   */
  const H = clampRate(rawH, Math.max(1, nSignal));
  const F = clampRate(rawF, Math.max(1, nNoise));

  const zH = probit(H);
  const zF = probit(F);
  const dPrime = zH - zF;
  const criterion = -0.5 * (zH + zF);
  const se = dPrimeStandardError(H, F, Math.max(1, nSignal), Math.max(1, nNoise));

  return {
    hit_rate: rawH,
    false_alarm_rate: rawF,
    d_prime: dPrime,
    criterion,
    d_prime_se: se,
    d_prime_unstable: !Number.isFinite(se) || se > 0.3,
    estimable: true,
  };
}