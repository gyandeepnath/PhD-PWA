import { describe, it, expect } from 'vitest';
import {
  TLX_DIMENSIONS, TLX_MAX, TLX_MIN, TLX_STEP,
  defaultTlxRatings, scoreTlx, tlxContribution, type TlxRatings,
} from '@/scales/nasaTlx';

const flat = (v: number): TlxRatings =>
  Object.fromEntries(TLX_DIMENSIONS.map((d) => [d.key, v])) as TlxRatings;

describe('NASA-TLX instrument', () => {
  it('has the six canonical dimensions', () => {
    expect(TLX_DIMENSIONS.map((d) => d.key)).toEqual([
      'mental_demand', 'physical_demand', 'temporal_demand', 'performance', 'effort', 'frustration',
    ]);
  });

  it('uses the original 21-point 0-100 scale', () => {
    expect(TLX_MIN).toBe(0);
    expect(TLX_MAX).toBe(100);
    expect(TLX_STEP).toBe(5);
    expect((TLX_MAX - TLX_MIN) / TLX_STEP + 1).toBe(21);
  });

  it('reverses nothing: every subscale is already in the load direction as anchored', () => {
    // Performance runs Perfect(0) to Failure(100), so a higher mark already means worse
    // performance and therefore more load. It used to be flagged reversed, which flipped the sign
    // of one subscale in six.
    expect(TLX_DIMENSIONS.filter((d) => d.reversed).map((d) => d.key)).toEqual([]);
  });

  it('maps a good Performance rating to a LOW load contribution', () => {
    const perf = TLX_DIMENSIONS.find((d) => d.key === 'performance')!;
    // Perfect(0) contributes no load; Failure(100) contributes maximum load — the same direction
    // as every other subscale, which is what makes the unweighted mean coherent.
    expect(tlxContribution(perf, 0)).toBe(0);
    expect(tlxContribution(perf, 100)).toBe(100);
    const mental = TLX_DIMENSIONS.find((d) => d.key === 'mental_demand')!;
    expect(tlxContribution(mental, 0)).toBe(0);
    expect(tlxContribution(mental, 100)).toBe(100);
  });

  it('scores raw TLX as the unweighted mean of the six ratings as marked', () => {
    expect(scoreTlx(flat(0)).raw_tlx).toBeCloseTo(0, 6);
    expect(scoreTlx(flat(100)).raw_tlx).toBeCloseTo(100, 6);
    expect(scoreTlx(flat(50)).raw_tlx).toBeCloseTo(50, 6);
  });

  it('does not report a participant who performed perfectly as maximally loaded', () => {
    // The defect this replaces: with Performance reversed, a participant reporting zero demand,
    // zero effort, zero frustration and PERFECT performance came out at 100/6 rather than 0.
    const s = scoreTlx({ ...flat(0), performance: 0 });
    expect(s.contributions.performance).toBe(0);
    expect(s.raw_tlx).toBeCloseTo(0, 6);
  });

  it('moves raw TLX UP when performance degrades', () => {
    // The direction that matters for the study: if a display condition makes the task go worse,
    // marks move toward Failure and the workload index must rise. Under the old reversal it fell,
    // masking the effect the instrument exists to detect.
    const good = scoreTlx({ ...flat(40), performance: 10 });
    const poor = scoreTlx({ ...flat(40), performance: 90 });
    expect(poor.raw_tlx).toBeGreaterThan(good.raw_tlx);
  });

  it('keeps raw ratings separate from contributions', () => {
    const r = { ...flat(20), performance: 80 };
    const s = scoreTlx(r);
    expect(s.ratings.performance).toBe(80);
    // With no reversal the contribution is the rating itself.
    expect(s.contributions.performance).toBe(80);
    expect(s.raw_tlx).toBeCloseTo((20 * 5 + 80) / 6, 6);
  });

  it('defaults every slider to the midpoint', () => {
    const d = defaultTlxRatings();
    for (const dim of TLX_DIMENSIONS) expect(d[dim.key]).toBe(50);
  });

  it('bounds raw TLX to the scale range for any valid input', () => {
    for (let v = TLX_MIN; v <= TLX_MAX; v += TLX_STEP) {
      const s = scoreTlx(flat(v));
      expect(s.raw_tlx).toBeGreaterThanOrEqual(TLX_MIN);
      expect(s.raw_tlx).toBeLessThanOrEqual(TLX_MAX);
    }
  });
});

/**
 * The direction of the Performance subscale, which is the thing that was wrong.
 *
 * NASA-TLX anchors Performance "Perfect" to "Failure", so a higher mark already means worse
 * performance and therefore more load: it needs no reversal. It was flagged `reversed: true`, and
 * the effect was a sign flip on one subscale in six.
 */
describe('Performance points the same way as every other subscale', () => {
  it('does not turn a near-perfect report into near-maximal load', async () => {
    const { scoreTlx } = await import('@/scales/nasaTlx');
    const r = {
      mental_demand: 60, physical_demand: 20, temporal_demand: 40,
      performance: 10, effort: 55, frustration: 30,
    };
    // The reversed implementation contributed 90 here and reported 49.2.
    expect(scoreTlx(r).contributions.performance).toBe(10);
    expect(scoreTlx(r).raw_tlx).toBeCloseTo(215 / 6, 6);
  });

  it('cannot mask a condition that degrades performance', async () => {
    // This is why it mattered. If a display condition made the task go worse, marks moved toward
    // Failure and the reversed contribution moved DOWN, pulling raw_tlx down with it — so the
    // instrument reported LESS workload for the condition that impaired the participant most.
    const { scoreTlx } = await import('@/scales/nasaTlx');
    const base = { mental_demand: 50, physical_demand: 20, temporal_demand: 50, effort: 50, frustration: 40 };
    const degraded = scoreTlx({ ...base, performance: 85 }).raw_tlx;
    const fine = scoreTlx({ ...base, performance: 15 }).raw_tlx;
    expect(degraded).toBeGreaterThan(fine);
  });
});
