/**
 * Regression tests for the ocular pipeline's failure modes.
 *
 * Every case here previously produced a plausible-looking NUMBER from broken or absent input,
 * which is the worst possible failure for a primary outcome: it is indistinguishable from a real
 * measurement and survives every downstream check.
 */
import { describe, it, expect } from 'vitest';
import {
  baselineEar, classifyBlinks, summariseBlinks, blinkRatePerMinute,
  computeClosureMetrics, faceEar, MIN_RATE_WINDOW_MS, type EarSample,
} from '@/tracking/blink';

const series = (ears: number[]): EarSample[] => ears.map((ear, i) => ({ t_ms: i * 33, ear }));
/** A closure deep enough to register, then recovery. */
const blinkPattern = [0.3, 0.3, 0.1, 0.3, 0.3];

describe('EAR baseline: a tracking dropout must not poison every threshold', () => {
  it('drops non-finite samples instead of letting one NaN take the percentile', () => {
    // MediaPipe emits NaN landmark coordinates when tracking momentarily fails.
    expect(faceEar(Array.from({ length: 400 }, () => ({ x: NaN, y: 0 })))).toBeNaN();
    const b = baselineEar([0.30, NaN, 0.31, Infinity, 0.29]);
    expect(b).not.toBeNull();
    expect(Number.isFinite(b!)).toBe(true);
    expect(b).toBeGreaterThan(0.2);
  });

  it('returns null rather than a fabricated population default when nothing is usable', () => {
    // The old code returned 0.3 for an empty set — asserting a population-typical eye for a
    // participant who was never successfully calibrated.
    expect(baselineEar([])).toBeNull();
    expect(baselineEar([NaN, NaN])).toBeNull();
    expect(baselineEar([0, -1])).toBeNull();
  });
});

describe('blink classification refuses to run on an invalid baseline', () => {
  it.each([null, NaN, 0, -1, Infinity])('yields no events for baseline %s', (b) => {
    expect(classifyBlinks(series(blinkPattern), b as number | null)).toEqual([]);
  });

  it('skips non-finite frames without losing the real closures around them', () => {
    const withDropouts = series([0.3, NaN, 0.3, 0.1, NaN, 0.3, 0.3]);
    const events = classifyBlinks(withDropouts, 0.3);
    // The NaN frames must not silently swallow the closure between them.
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(Number.isFinite(e.min_ear)).toBe(true);
      expect(Number.isFinite(e.duration_ms)).toBe(true);
    }
  });
});

describe('the primary outcome is null, never a clean zero, when unmeasurable', () => {
  it('reports null for a condition in which no blink was detected', () => {
    // A failed camera, an uncalibrated baseline and an aborted condition all produce zero events.
    // Reporting 0 would read as "blinked perfectly throughout" — the cleanest possible result,
    // manufactured from no data.
    const s = summariseBlinks([], 60000);
    expect(s.incomplete_blink_ratio).toBeNull();
    expect(s.blink_rate).toBe(0);
  });

  it('reports a real ratio once blinks exist', () => {
    const events = classifyBlinks(series([0.3, 0.1, 0.3, 0.3, 0.2, 0.3]), 0.3);
    const s = summariseBlinks(events, 60000);
    if (events.length > 0) {
      expect(s.incomplete_blink_ratio).not.toBeNull();
      expect(s.incomplete_blink_ratio!).toBeGreaterThanOrEqual(0);
      expect(s.incomplete_blink_ratio!).toBeLessThanOrEqual(1);
    }
  });
});

describe('blink rate cannot be manufactured from a vanishing window', () => {
  it('reports NULL below the minimum rate window rather than dividing by a sliver', () => {
    // `durationMs > 0` was too weak: an instantly-aborted condition gave a rate in the thousands.
    // And the answer is null, not 0: the hypothesis under test is that blink rate FALLS under
    // strain, so a fabricated zero does not merely add noise, it supports the hypothesis.
    expect(blinkRatePerMinute(1, 1e-308)).toBeNull();
    expect(blinkRatePerMinute(5, 10)).toBeNull();
    expect(blinkRatePerMinute(5, MIN_RATE_WINDOW_MS - 1)).toBeNull();
  });

  it('computes a normal rate above the window', () => {
    expect(blinkRatePerMinute(13, 60000)).toBeCloseTo(13, 6);
  });

  it.each([NaN, Infinity, -1])('rejects a non-sensical count %s', (c) => {
    expect(blinkRatePerMinute(c, 60000)).toBeNull();
  });

  it.each([NaN, Infinity, -1])('rejects a non-sensical duration %s', (d) => {
    expect(blinkRatePerMinute(10, d)).toBeNull();
  });
});

describe('closure metrics degrade to null rather than guessing', () => {
  it.each([null, NaN])('returns nulls for baseline %s', (b) => {
    const m = computeClosureMetrics(series([0.3, 0.1, 0.3]), b as number | null, []);
    expect(m.perclos_p80).toBeNull();
    expect(m.perclos_p70).toBeNull();
  });

  it('never returns a non-finite PERCLOS for any finite input', () => {
    for (const ears of [[], [0.3], [0.3, 0.3], [0.001, 0.3], [1e-9, 1e9]]) {
      for (const base of [0.3, 0.001, 1e6]) {
        const m = computeClosureMetrics(series(ears), base, []);
        for (const v of [m.perclos_p80, m.perclos_p70]) {
          if (v !== null) expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });
});

/**
 * The frame rate behind the primary outcome.
 *
 * The duration-based tiers were gated at 25 fps; the incomplete-blink RATIO — the study's primary
 * outcome — was gated by nothing, so a condition captured at 12 fps entered the analysis
 * indistinguishable from one captured at 30. That is not a conservative default: classifying a
 * blink as complete or incomplete needs the frame at its minimum aperture, and a blink lasts
 * ~100-150 ms, so undersampling biases the measured minimum EAR UPWARD and inflates the ratio.
 * Directional bias, not symmetric noise.
 */
describe('the primary outcome carries its own frame-rate qualification', () => {
  it('flags a frame rate too low for the ratio, separately from the duration tiers', async () => {
    const { fpsAdequateForRatio, fpsAdequateForTiers, FPS_RATIO_THRESHOLD, FPS_TIER_THRESHOLD } =
      await import('@/tracking/blink');

    // The gap between the two thresholds is the whole point: 27 fps is fine for the tiers and
    // not fine for the ratio, and before this the second half of that sentence had no expression.
    expect(FPS_RATIO_THRESHOLD).toBeGreaterThan(FPS_TIER_THRESHOLD);
    const between = (FPS_TIER_THRESHOLD + FPS_RATIO_THRESHOLD) / 2;
    expect(fpsAdequateForTiers(between)).toBe(true);
    expect(fpsAdequateForRatio(between)).toBe(false);

    expect(fpsAdequateForRatio(FPS_RATIO_THRESHOLD)).toBe(true);
    expect(fpsAdequateForRatio(FPS_RATIO_THRESHOLD - 0.1)).toBe(false);
    // An unknown frame rate is not an adequate one.
    expect(fpsAdequateForRatio(null)).toBe(false);
  });

  it('flags rather than drops, because frame rate covaries with an independent variable', async () => {
    const { buildConditionSummaries } = await import('@/dashboard/aggregate');
    const { buildFixtureBundle } = await import('@/sim/bundleFixture');
    const b = buildFixtureBundle();
    const bundle = {
      ...b,
      eyeMetrics: b.eyeMetrics.map((e, i) =>
        i === 0 ? { ...e, effective_fps: 14, fps_adequate_for_ratio: false } : e),
    };
    const sums = buildConditionSummaries(bundle);
    const s = sums.find((x) => x.condition_id === b.eyeMetrics[0].condition_id)!;

    // Still present — dropping it would bias the sample toward the illumination level that
    // sustains a high frame rate.
    expect(s).toBeDefined();
    expect(s.engagement_reasons.join(' ')).toMatch(/fps/i);
    expect(s.engagement_reasons.join(' ')).toMatch(/biased upward/i);
    // Every other condition is unaffected.
    expect(sums.filter((x) => x.engagement_reasons.some((r: string) => /fps/i.test(r)))).toHaveLength(1);
  });
});

/**
 * The within-condition blink bins, against a realistic clock.
 *
 * EarSample.t_ms is performance.now() — milliseconds since the page loaded — while the bin midpoint
 * is half of a SPAN. Comparing them directly meant that once the session had been running for more
 * than a couple of minutes, every blink sorted into the second half: first_half_blink_rate was
 * exactly 0 and second_half_blink_rate exactly double the truth, in every condition of every real
 * run. Every fixture started its clock at zero, which is precisely why no test caught it.
 *
 * So these run the aggregator twice over an IDENTICAL blink stream, differing only in clock origin.
 * The bins must agree.
 */
describe('within-condition bins are computed on the condition clock, not the page clock', () => {
  const runAt = async (t0: number) => {
    const { EyeMetricsAggregator } = await import('@/tracking/aggregator');
    const agg = new EyeMetricsAggregator();
    const BASE = 0.30;
    const fps = 30, secs = 180, step = 1000 / fps;
    // A steady 15 blinks/min: one blink every 4 s, each three frames deep.
    const blinkAt = new Set<number>();
    for (let s = 2; s < secs; s += 4) blinkAt.add(Math.round((s * 1000) / step));
    for (let i = 0; i < fps * secs; i++) {
      const t = t0 + i * step;
      const deep = blinkAt.has(i) || blinkAt.has(i - 1) || blinkAt.has(i - 2);
      agg.ingest({
        t_ms: t,
        ear: deep ? BASE * 0.5 : BASE,
        pose: { pitch: 0, yaw: 0, roll: 0 },
        zone: 'cc' as const, isCenter: true, offAxis: false,
        facePresent: true, faceSize: 0.3, luma: 120,
      });
    }
    return agg.finalize({
      conditionId: 'c', sessionId: 's', cameraActive: true, baselineEarValue: BASE,
      earThresholdUsed: BASE * 0.6, gazeCalibrated: true, headPitchCalibrated: true,
    });
  };

  it('gives the same answer whether the page loaded a second ago or ten minutes ago', async () => {
    const atZero = await runAt(0);
    const tenMinutesIn = await runAt(600_000);

    expect(atZero.bins.first_half_blink_rate).not.toBeNull();
    // The bug: with a realistic origin the first half emptied out completely.
    expect(tenMinutesIn.bins.first_half_blink_rate).not.toBe(0);
    expect(tenMinutesIn.bins.first_half_blink_rate).toBeCloseTo(atZero.bins.first_half_blink_rate!, 5);
    expect(tenMinutesIn.bins.second_half_blink_rate).toBeCloseTo(atZero.bins.second_half_blink_rate!, 5);
  });

  it('splits a steady blink stream evenly between the halves', async () => {
    // A constant rate must not produce apparent within-condition drift.
    const r = await runAt(600_000);
    const a = r.bins.first_half_blink_rate!;
    const b = r.bins.second_half_blink_rate!;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(Math.abs(a - b) / ((a + b) / 2)).toBeLessThan(0.2);
    // And both must be near the true 15/min, not 0 and 30.
    expect(a).toBeGreaterThan(10);
    expect(a).toBeLessThan(20);
  });
});
