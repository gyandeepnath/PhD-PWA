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

  it('reverses Performance and only Performance', () => {
    const reversed = TLX_DIMENSIONS.filter((d) => d.reversed).map((d) => d.key);
    expect(reversed).toEqual(['performance']);
  });

  it('maps a good Performance rating to a LOW load contribution', () => {
    const perf = TLX_DIMENSIONS.find((d) => d.key === 'performance')!;
    // The original anchors Performance "Perfect" (0) to "Failure" (100), so a rating of 0 is
    // excellent performance and must contribute 0 load, not 0 after being read as "no success".
    expect(tlxContribution(perf, 0)).toBe(100);
    expect(tlxContribution(perf, 100)).toBe(0);
    const mental = TLX_DIMENSIONS.find((d) => d.key === 'mental_demand')!;
    expect(tlxContribution(mental, 0)).toBe(0);
    expect(tlxContribution(mental, 100)).toBe(100);
  });

  it('scores raw TLX as the unweighted mean of the six load-aligned subscales', () => {
    // All dimensions at 0 => five contribute 0, Performance contributes 100 (0 = "Perfect").
    expect(scoreTlx(flat(0)).raw_tlx).toBeCloseTo(100 / 6, 6);
    // All at 100 => five contribute 100, Performance contributes 0.
    expect(scoreTlx(flat(100)).raw_tlx).toBeCloseTo(500 / 6, 6);
    // All at the midpoint => every contribution is 50.
    expect(scoreTlx(flat(50)).raw_tlx).toBeCloseTo(50, 6);
  });

  it('would produce an incoherent index if Performance were not reversed', () => {
    // Guards the mistake this reversal exists to prevent: a participant reporting perfect
    // performance and zero demand must not read as maximally loaded.
    const s = scoreTlx({ ...flat(0), performance: 0 });
    const naiveMean = 0; // what an unreversed implementation would report
    expect(s.raw_tlx).not.toBe(naiveMean);
    expect(s.contributions.performance).toBe(100);
  });

  it('keeps raw ratings separate from contributions', () => {
    const r = { ...flat(20), performance: 80 };
    const s = scoreTlx(r);
    expect(s.ratings.performance).toBe(80);
    expect(s.contributions.performance).toBe(20);
    expect(s.raw_tlx).toBeCloseTo(20, 6);
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
