/**
 * Lightweight analysis used to VALIDATE the simulation: ordinary least squares with standard
 * errors, an effect-recovery check, and a Monte-Carlo power estimate.
 *
 * NOTE: OLS on condition rows treats observations as independent; it is sufficient to demonstrate
 * that injected effects are recoverable and to estimate power. The AUTHORITATIVE inference for the
 * real study is the linear mixed model (random intercept per participant) in the R/Python templates.
 */
import { generateParticipant } from './participant';
import type { ConditionRow } from './participant';

// ---- small dense linear algebra ----
function transpose(m: number[][]): number[][] {
  return m[0].map((_, j) => m.map((row) => row[j]));
}
function matMul(a: number[][], b: number[][]): number[][] {
  const bt = transpose(b);
  return a.map((row) => bt.map((col) => row.reduce((s, v, k) => s + v * col[k], 0)));
}
function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
}
/** Invert a square matrix via Gauss-Jordan elimination. */
function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    if (Math.abs(div) < 1e-12) throw new Error('singular design matrix');
    for (let j = 0; j < 2 * n; j++) a[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export interface OlsResult {
  /** Predictor name -> { coef, se, t }. Includes 'intercept'. */
  terms: Record<string, { coef: number; se: number; t: number }>;
  n: number;
  rSquared: number;
}

/** Multiple linear regression of y on the given predictor columns (intercept added automatically). */
export function ols(predictors: string[], rows: Record<string, number>[], yKey: string): OlsResult {
  const names = ['intercept', ...predictors];
  const X = rows.map((r) => [1, ...predictors.map((p) => r[p])]);
  const y = rows.map((r) => r[yKey]);
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXinv = invert(XtX);
  const beta = matVec(XtXinv, matVec(Xt, y));

  const yhat = matVec(X, beta);
  const resid = y.map((yi, i) => yi - yhat[i]);
  const dof = Math.max(1, y.length - names.length);
  const sigma2 = resid.reduce((s, e) => s + e * e, 0) / dof;
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = resid.reduce((s, e) => s + e * e, 0);

  const terms: OlsResult['terms'] = {};
  names.forEach((name, i) => {
    const se = Math.sqrt(sigma2 * XtXinv[i][i]);
    terms[name] = { coef: beta[i], se, t: beta[i] / se };
  });
  return { terms, n: y.length, rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

/** Flatten a cohort to numeric analysis rows (drops null RT rows for the RT model). */
export function cohortRows(participants: { rows: ConditionRow[] }[]): Record<string, number>[] {
  const out: Record<string, number>[] = [];
  for (const p of participants) {
    for (const r of p.rows) {
      // Rows without an estimable d' are excluded rather than coerced: a null means the block
      // produced no trials, and substituting 0 would enter a fabricated sensitivity into the fit.
      if (r.mean_rt_hits_ms == null || r.d_prime == null || r.d_prime_se == null) continue;
      out.push({
        mean_rt_hits_ms: r.mean_rt_hits_ms,
        log_contrast: r.log_contrast,
        negative_polarity: r.negative_polarity,
        session_position: r.session_position,
        below_wcag_aa: r.below_wcag_aa,
        fatigue_mean: r.fatigue_mean,
        comprehension_correct: r.comprehension_correct,
        d_prime: r.d_prime,
        d_prime_se: r.d_prime_se,
        comfort_score: r.comfort_score,
      });
    }
  }
  return out;
}

/** |t| > ~1.96 ⇒ significant at α=0.05 (large-sample normal approximation). */
export function isSignificant(t: number, alpha = 0.05): boolean {
  const crit = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.645;
  return Math.abs(t) > crit;
}

/**
 * Monte-Carlo power for detecting the log-contrast effect on RT at sample size n.
 * Each replication uses a different cohort seed.
 */
export function powerForN(n: number, replications = 200, seedBase = 1): number {
  let detected = 0;
  for (let rep = 0; rep < replications; rep++) {
    const cohort = Array.from({ length: n }, (_, i) =>
      generateParticipant(i + 1, seedBase + rep * 100003),
    );
    const rows = cohortRows(cohort);
    const fit = ols(['log_contrast', 'negative_polarity', 'session_position'], rows, 'mean_rt_hits_ms');
    if (isSignificant(fit.terms.log_contrast.t)) detected++;
  }
  return detected / replications;
}
