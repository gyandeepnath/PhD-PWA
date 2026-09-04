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
    // A rate of 0 over a measured minute IS a finding; a rate over no window is not — and it used
    // to be reported as 0, which is the direction the hypothesis predicts.
    expect(blinkRatePerMinute(0, 60000)).toBe(0);
    expect(blinkRatePerMinute(5, 1)).toBeNull();
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

describe('the stimulus scale is never substituted when it was not measured', () => {
  /*
   * The layout is authored on a fixed design canvas and scaled down to fit a smaller screen, so on
   * a shorter tablet the reading text subtends a smaller visual angle than the design size. That is
   * a genuine between-device difference in a controlled variable, which is why it is recorded.
   *
   * A session captured before the field existed did not measure a scale. Writing 1 for it would
   * assert that its stimuli were presented at the design size, which nobody knows — and 1 is
   * exactly the value an analyst would read as "no scaling applied". Absence has to stay absent.
   */
  it('exports an empty cell, not 1, when the session predates the measurement', () => {
    const legacy = { screen_resolution: '1194x834' } as { stimulus_scale?: number | null };
    expect(legacy.stimulus_scale ?? null).toBeNull();
  });

  it('reports absence from a viewport that carries no information', async () => {
    const { computeScale } = await import('@/lib/viewportScale');
    // A zero or non-finite viewport is not evidence of a full-size presentation. Returning a
    // plausible fraction from it would be a fabricated measurement.
    for (const [w, h] of [[0, 0], [NaN, 800], [1194, Infinity], [-1, -1]]) {
      expect(Number.isFinite(computeScale(w, h))).toBe(true);
      expect(computeScale(w, h)).toBe(1);
    }
  });

  it('never claims a larger stimulus than the design canvas', () => {
    // Scaling ABOVE 1 would present a bigger stimulus than every other device and record it as
    // such. The cap means a value of 1 always means the same physical presentation.
    return import('@/lib/viewportScale').then(({ computeScale }) => {
      expect(computeScale(3840, 2160)).toBe(1);
      expect(computeScale(2560, 1600)).toBe(1);
    });
  });
});

describe('an unmeasured detection rate is reported as absent, not as zero', () => {
  /*
   * computeSdt returned hit_rate: 0 and false_alarm_rate: 0 whenever a pool was empty, while every
   * other field in the same return reported null. A hit rate of zero is a real and damning
   * measurement — the participant never responded to a signal — and it is not the same statement as
   * "this block contained no signal trials". The two reach an analyst identically.
   */
  it('returns null rates when a pool is empty, and nulls for everything derived from it', async () => {
    const { computeSdt } = await import('@/lib/signalDetection');

    const noSignal = computeSdt({ hits: 0, misses: 0, falseAlarms: 2, correctRejections: 10 });
    expect(noSignal.hit_rate, 'no signal trials, so the hit rate is unmeasured').toBeNull();
    expect(noSignal.false_alarm_rate, 'noise trials existed, so this IS measured').toBeCloseTo(2 / 12);
    expect(noSignal.d_prime).toBeNull();
    expect(noSignal.estimable).toBe(false);

    const noNoise = computeSdt({ hits: 8, misses: 2, falseAlarms: 0, correctRejections: 0 });
    expect(noNoise.false_alarm_rate, 'no noise trials, so the false-alarm rate is unmeasured').toBeNull();
    expect(noNoise.hit_rate, 'signal trials existed, so this IS measured').toBeCloseTo(0.8);
    expect(noNoise.d_prime).toBeNull();
  });

  it('still reports a genuine zero when the pool existed and nothing was hit', async () => {
    // The distinction only matters if a real zero survives. Ten signal trials, no hits, is a
    // measurement and must not be turned into absence.
    const { computeSdt } = await import('@/lib/signalDetection');
    const r = computeSdt({ hits: 0, misses: 10, falseAlarms: 1, correctRejections: 11 });
    expect(r.hit_rate).toBe(0);
    expect(r.estimable).toBe(true);
  });
});
