/**
 * The straight-lining simulation behind rule str-r2 (Round 85; src/sim/straightLine.ts,
 * scripts/straightLineSim.ts, ANALYSIS_PLAN.md §4c). The full run is not part of verify; this pins a
 * small fixed-seed run of what the plan reports, so a change to the rule that moves those conclusions
 * shows here.
 */
import { describe, it, expect } from 'vitest';
import { runStraightLine } from '@/sim/straightLine';
import { STRAIGHT_LINE } from '@/dashboard/straightLine';

const RUNS = 20000;

describe('the straight-lining rule on the 100 mm line, under simulation', () => {
  it('is the width the criterion picks: 5 mm', () => {
    expect(STRAIGHT_LINE.VAS_SPREAD_MM).toBe(5);
    expect(STRAIGHT_LINE.VAS_END_ZONE_MM).toBe(5);
  });

  it('flags an honest rater no more often than the old whole-number rule did, and 6 mm would', () => {
    for (const [s, seed] of [[3, 11], [5, 12], [10, 13], [20, 14]] as const) {
      const r = runStraightLine({ kind: 'honest', itemSpreadMm: s }, RUNS, seed);
      expect(r.strR2).toBeLessThanOrEqual(r.oldWhole);
    }
    for (const [s, seed] of [[3, 21], [5, 22]] as const) {
      const r = runStraightLine({ kind: 'honest', itemSpreadMm: s }, RUNS, seed);
      expect(r.spread[6]).toBeGreaterThan(r.oldWhole);
    }
  });

  it('flags a careless tapper with 1 mm scatter almost always, where whole points missed a quarter', () => {
    const r = runStraightLine({ kind: 'careless', scatterMm: 1 }, RUNS, 31);
    expect(r.strR2).toBeGreaterThan(0.99);
    expect(r.round84).toBeLessThan(0.8);
  });

  it('keeps an honest "none" exempt by the average of the marks, which "every mark at the end" did not', () => {
    const r = runStraightLine({ kind: 'end', scatterMm: 3 }, RUNS, 41);
    expect(r.strR2).toBeLessThan(0.001);
    expect(r.everyMarkEnd).toBeGreaterThan(0.1);
  });
});
