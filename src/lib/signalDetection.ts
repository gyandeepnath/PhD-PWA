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
  hit_rate: number;
  false_alarm_rate: number;
  d_prime: number;
  criterion: number;
  d_prime_se: number;
  d_prime_unstable: boolean;
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

export function computeSdt(input: SdtInput): SdtResult {
  const nSignal = input.hits + input.misses;
  const nNoise = input.falseAlarms + input.correctRejections;

  const rawH = nSignal > 0 ? input.hits / nSignal : 0;
  const rawF = nNoise > 0 ? input.falseAlarms / nNoise : 0;

  // Loglinear-style clamp using each pool's N to avoid infinite z-scores at 0/1.
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
    d_prime_unstable: se > 0.3,
  };
}