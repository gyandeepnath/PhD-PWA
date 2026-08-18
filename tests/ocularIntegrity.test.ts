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
  it('returns 0 below the minimum rate window rather than dividing by a sliver', () => {
    // `durationMs > 0` was too weak: an instantly-aborted condition gave a rate in the thousands.
    expect(blinkRatePerMinute(1, 1e-308)).toBe(0);
    expect(blinkRatePerMinute(5, 10)).toBe(0);
    expect(blinkRatePerMinute(5, MIN_RATE_WINDOW_MS - 1)).toBe(0);
  });

  it('computes a normal rate above the window', () => {
    expect(blinkRatePerMinute(13, 60000)).toBeCloseTo(13, 6);
  });

  it.each([NaN, Infinity, -1])('rejects a non-sensical count %s', (c) => {
    expect(blinkRatePerMinute(c, 60000)).toBe(0);
  });

  it.each([NaN, Infinity, -1])('rejects a non-sensical duration %s', (d) => {
    expect(blinkRatePerMinute(10, d)).toBe(0);
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
