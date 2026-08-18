/**
 * The no-fabrication contract.
 *
 * Sixteen bugs across six stress rounds were all one species: a function returning a plausible
 * NUMBER where it had no measurement. Each looked different at the call site - a population
 * default for a failed calibration, a zero proportion over an empty set, a level head pose from a
 * collapsed solve, a sensitivity estimate from a block with no signal trials - and each was
 * invisible downstream, because the output was indistinguishable from a real reading.
 *
 * Fixing them one at a time does not stop the seventeenth. This file states the class as a rule
 * and checks every summary-producing function against it:
 *
 *   Given input carrying NO information about a quantity, a function must report the absence -
 *   null, or a non-finite value its consumer is documented to filter - and must NEVER return a
 *   value that reads as a measurement.
 *
 * Zero is the dangerous case throughout. Zero blinks incomplete, zero degrees of head pitch, zero
 * sensitivity and zero face size are all substantive claims that an analyst will average alongside
 * real values, and none of them means "not measured".
 */
import { describe, it, expect } from 'vitest';
import { summariseBlinks, baselineEar, classifyBlinks, computeClosureMetrics, blinkRatePerMinute } from '@/tracking/blink';
import { computeSdt } from '@/lib/signalDetection';
import { estimateHeadPose } from '@/tracking/headPose';
import { summariseLux } from '@/experiment/illumination';
import { meanOrNull } from '@/lib/stats';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { buildFixtureBundle } from '@/sim/bundleFixture';

/** A value that correctly signals "no measurement": null, or non-finite for filtered channels. */
const absent = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));

describe('the primary outcome never invents a value', () => {
  it('reports absence, not zero, when no blink was detected', () => {
    expect(absent(summariseBlinks([], 60000).incomplete_blink_ratio)).toBe(true);
  });

  it('reports absence when the baseline could not be established', () => {
    expect(absent(baselineEar([]))).toBe(true);
    expect(absent(baselineEar([NaN, NaN]))).toBe(true);
    // ...and refuses to classify against an absent baseline rather than finding zero blinks.
    expect(classifyBlinks([{ t_ms: 0, ear: 0.1 }], null)).toEqual([]);
  });

  it('reports absence for PERCLOS without a baseline', () => {
    const m = computeClosureMetrics([{ t_ms: 0, ear: 0.3 }], null, []);
    expect(absent(m.perclos_p80)).toBe(true);
    expect(absent(m.perclos_p70)).toBe(true);
  });

  it('returns a rate of zero only for a real window with no blinks, never for no window', () => {
    // A rate of 0 over a measured minute IS a finding; a rate over no window is not.
    expect(blinkRatePerMinute(0, 60000)).toBe(0);
    expect(blinkRatePerMinute(5, 1)).toBe(0);
  });
});

describe('sensitivity is never estimated from a missing distribution', () => {
  it.each([
    ['no trials at all', { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 }],
    ['no signal trials', { hits: 0, misses: 0, falseAlarms: 1, correctRejections: 11 }],
    ['no noise trials', { hits: 19, misses: 1, falseAlarms: 0, correctRejections: 0 }],
  ])('reports absence: %s', (_label, input) => {
    const r = computeSdt(input);
    expect(r.estimable).toBe(false);
    expect(absent(r.d_prime)).toBe(true);
    expect(absent(r.criterion)).toBe(true);
    expect(absent(r.d_prime_se)).toBe(true);
  });

  it('estimates normally once both distributions exist', () => {
    const r = computeSdt({ hits: 19, misses: 1, falseAlarms: 1, correctRejections: 11 });
    expect(r.estimable).toBe(true);
    expect(Number.isFinite(r.d_prime!)).toBe(true);
  });
});

describe('head pose never reports a level head it did not measure', () => {
  it.each([
    ['no landmarks', []],
    ['every landmark identical', Array.from({ length: 478 }, () => ({ x: 0, y: 0 }))],
    ['solve failed', Array.from({ length: 478 }, () => ({ x: NaN, y: NaN }))],
  ])('reports absence on all three axes: %s', (_label, lm) => {
    const p = estimateHeadPose(lm);
    expect(absent(p.pitch)).toBe(true);
    expect(absent(p.yaw)).toBe(true);
    expect(absent(p.roll)).toBe(true);
  });
});

describe('session-level summaries report absence rather than a default', () => {
  it('summarises no lux readings as absent, not as zero lux', () => {
    const s = summariseLux('dim', []);
    expect(absent(s.mean)).toBe(true);
    expect(absent(s.max_deviation)).toBe(true);
    expect(s.n).toBe(0);
  });

  it('reports absence for the mean of nothing', () => {
    expect(absent(meanOrNull([]))).toBe(true);
    expect(absent(meanOrNull([NaN, Infinity]))).toBe(true);
    expect(meanOrNull([1, 2, 3])).toBe(2);
  });
});

describe('the class rule holds across a bundle with no measurements at all', () => {
  it('produces no numeric value for any quantity that was never measured', () => {
    const b = buildFixtureBundle();
    // A session where the participant consented to nothing and every task was skipped.
    b.eyeMetrics = [];
    b.rtSummaries = [];
    b.fatigue = [];
    b.perception = [];
    b.comprehension = [];
    b.visualSearch = [];

    const summaries = buildConditionSummaries(b);
    expect(summaries).toHaveLength(b.conditions.length);

    // Quantities that can only come from a measurement must be absent - never 0, which would read
    // as "measured, and the answer was none".
    const MUST_BE_ABSENT = [
      'incomplete_blink_ratio', 'blink_rate', 'mean_rt_hits_ms', 'd_prime',
      'fatigue_mean', 'fatigue_delta', 'comfort_score', 'clarity_score',
      'search_accuracy', 'comprehension_correct',
    ] as const;

    for (const s of summaries) {
      for (const key of MUST_BE_ABSENT) {
        const v = (s as unknown as Record<string, unknown>)[key];
        expect(absent(v), `${s.condition_label}.${key} = ${String(v)} — a value was invented for a quantity that was never measured`).toBe(true);
      }
    }
  });
});
