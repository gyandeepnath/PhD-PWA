import { describe, it, expect } from 'vitest';
import { makeRng, gaussian } from '@/sim/rng';
import { generateParticipant, generateCohort } from '@/sim/participant';
import { cohortRows, ols, isSignificant } from '@/sim/analysis';
import { GROUND_TRUTH as GT } from '@/sim/effects';

describe('seeded RNG', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('gaussian has ~0 mean and ~1 sd over many draws', () => {
    const r = makeRng(7);
    const xs = Array.from({ length: 20000 }, () => gaussian(r));
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
    expect(Math.abs(m)).toBeLessThan(0.05);
    expect(Math.abs(sd - 1)).toBeLessThan(0.05);
  });
});

describe('participant generation', () => {
  it('produces 8 condition rows with unique conditions and decoupled passages', () => {
    const p = generateParticipant(1, 123);
    expect(p.rows).toHaveLength(8);
    expect(new Set(p.rows.map((r) => r.condition_label)).size).toBe(8);
    expect(new Set(p.rows.map((r) => r.passage_id)).size).toBe(8);
    // Passage is not yoked to condition for this participant (some differ from index order).
    const yoked = p.rows.every((r, i) => r.passage_id === i);
    expect(yoked).toBe(false);
  });

  it('is deterministic by seed', () => {
    const a = generateCohort(5, 999);
    const b = generateCohort(5, 999);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('analysis recovers injected effects', () => {
  const cohort = generateCohort(50, 20260613);
  const rows = cohortRows(cohort);
  const rt = ols(['log_contrast', 'negative_polarity', 'session_position'], rows, 'mean_rt_hits_ms');

  it('recovers a negative, significant log-contrast effect on RT', () => {
    expect(rt.terms.log_contrast.coef).toBeLessThan(0); // higher contrast -> faster
    expect(isSignificant(rt.terms.log_contrast.t)).toBe(true);
    // within a generous band of the true effect
    expect(rt.terms.log_contrast.coef).toBeGreaterThan(GT.rt.beta_log_contrast - 20);
    expect(rt.terms.log_contrast.coef).toBeLessThan(GT.rt.beta_log_contrast + 20);
  });

  it('recovers positive polarity and position effects (correct sign)', () => {
    expect(rt.terms.negative_polarity.coef).toBeGreaterThan(0);
    expect(rt.terms.session_position.coef).toBeGreaterThan(0);
  });

  it('recovers fatigue accumulation and low-contrast fatigue penalty', () => {
    const fatRows = cohort.flatMap((p) =>
      p.rows.map((r) => ({
        fatigue_mean: r.fatigue_mean,
        session_position: r.session_position,
        below_wcag_aa: r.below_wcag_aa,
      })),
    );
    const fat = ols(['session_position', 'below_wcag_aa'], fatRows, 'fatigue_mean');
    expect(fat.terms.session_position.coef).toBeGreaterThan(0);
    expect(fat.terms.below_wcag_aa.coef).toBeGreaterThan(0);
    expect(isSignificant(fat.terms.session_position.t)).toBe(true);
  });

  it('per-condition d-prime SE reflects small-N instability', () => {
    const meanSE = rows.reduce((s, r) => s + (r.d_prime_se as number), 0) / rows.length;
    expect(meanSE).toBeGreaterThan(0.15);
  });
});
