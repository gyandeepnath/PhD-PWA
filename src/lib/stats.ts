/**
 * Descriptive statistics and the normal distribution helpers used across scoring.
 *
 * Population SD (divide by N) is used intentionally for frame-level descriptives — we summarise
 * the complete set of captured frames, not estimate a population from a sample (matches the
 * original build's documented choice). Sample SD is provided separately where inference needs it.
 */

/**
 * Arithmetic mean of the FINITE values in xs, or null when none exist.
 *
 * Returning NaN for an empty set was technically correct and practically dangerous: NaN survives
 * every arithmetic step, serialises into a CSV as the literal "NaN", and is only noticed when an
 * analyst's model silently drops the row. A null is an explicit "not measured".
 */
export function meanOrNull(xs: number[]): number | null {
  const f = xs.filter((x) => Number.isFinite(x));
  return f.length === 0 ? null : f.reduce((s, x) => s + x, 0) / f.length;
}

/**
 * Arithmetic mean of the finite values. NaN only when nothing finite is present.
 *
 * Non-finite entries are filtered rather than summed: a single NaN landmark or luma sample used to
 * take the entire summary with it, turning one dropped frame into a NaN head-pose or lighting
 * value for the whole condition. Callers that can legitimately be handed an empty set should use
 * meanOrNull() and record the absence.
 */
export function mean(xs: number[]): number {
  const f = xs.filter((x) => Number.isFinite(x));
  if (f.length === 0) return NaN;
  return f.reduce((s, x) => s + x, 0) / f.length;
}

export function median(xs: number[]): number {
  const f = xs.filter((x) => Number.isFinite(x));
  if (f.length === 0) return NaN;
  const s = f.sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Population standard deviation (÷N). Returns 0 for N<2. */
export function stdPopulation(xs: number[]): number {
  const f = xs.filter((x) => Number.isFinite(x));
  if (f.length < 2) return 0;
  const m = mean(f);
  const v = Math.sqrt(f.reduce((s, x) => s + (x - m) ** 2, 0) / f.length);
  return Number.isFinite(v) ? v : 0;
}

/** Sample standard deviation (÷N-1). Returns 0 for N<2. */
export function stdSample(xs: number[]): number {
  const f = xs.filter((x) => Number.isFinite(x));
  if (f.length < 2) return 0;
  const m = mean(f);
  const v = Math.sqrt(f.reduce((s, x) => s + (x - m) ** 2, 0) / (f.length - 1));
  return Number.isFinite(v) ? v : 0;
}

/** Standard normal probability density function. */
export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Inverse standard normal CDF (probit) via Acklam's rational approximation.
 * Accurate to ~1.15e-9 over the open interval (0,1).
 */
export function probit(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Clamp a rate into (0,1) using the 1/(2N) correction to avoid infinite z-scores. */
export function clampRate(rate: number, n: number): number {
  // Guard tiny/empty pools: n=0 would make the correction +/-Infinity. With n<=1 there is no usable
  // rate information, so the loglinear bound collapses to 0.5 (maximum uncertainty) by construction.
  //
  // The bound is ALSO floored away from 0 and 1 by an epsilon. For an astronomically large n the
  // 1/(2n) correction underflows and `1 - 1/(2n)` rounds to exactly 1.0 in double precision, at
  // which point probit() returns Infinity and d' comes out infinite rather than merely large.
  const safeN = Number.isFinite(n) ? Math.max(1, n) : 1;
  const r = Number.isFinite(rate) ? rate : 0.5;
  const EPS = 1e-12;
  const lo = Math.max(EPS, 1 / (2 * safeN));
  const hi = Math.min(1 - EPS, 1 - 1 / (2 * safeN));
  return Math.min(hi, Math.max(lo, r));
}
