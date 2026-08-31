/**
 * What the tracker does when it stops seeing the participant.
 *
 * The EAR series is not a continuous signal. A frame in which no face is found contributes no
 * sample at all, so consecutive entries can be seconds apart — the participant glanced away, the
 * tracker lost them, the tablet dropped frames under load. Everything downstream treated that array
 * as contiguous, and each of these tests covers a way that produced a number out of nothing.
 *
 * The shared theme: a tracking failure must never be indistinguishable from the effect under study.
 * A reduced blink rate IS this protocol's marker of visual fatigue, so charging unobserved time to
 * the rate turns a dropout into a finding.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyBlinks, observedDurationMs, samplingGapThreshold, faceEar, eyeAspectRatio,
  LEFT_EYE_EAR, RIGHT_EYE_EAR, type EarSample,
} from '@/tracking/blink';

const BASE = 0.30;

/** A steady 30 fps series; `blinkAt` indices are driven to a deep closure for 3 frames. */
function series(n: number, blinkAt: number[], t0 = 0, step = 33): EarSample[] {
  const deep = new Set<number>();
  for (const b of blinkAt) { deep.add(b); deep.add(b + 1); deep.add(b + 2); }
  return Array.from({ length: n }, (_, i) => ({
    t_ms: t0 + i * step,
    ear: deep.has(i) ? BASE * 0.45 : BASE,
  }));
}

describe('a face-loss gap does not become a blink', () => {
  it('abandons a blink that was still in progress when the face was lost', () => {
    // Closure begins, then the face disappears for four seconds, then returns wide open.
    const before = series(30, [27]);            // ends mid-closure
    const after: EarSample[] = Array.from({ length: 30 }, (_, i) => ({
      t_ms: before[before.length - 1].t_ms + 4000 + i * 33,
      ear: BASE,
    }));
    const events = classifyBlinks([...before, ...after], BASE);

    // The old behaviour emitted ONE event spanning the whole dropout.
    for (const e of events) {
      expect(e.duration_ms).toBeLessThan(1000);
    }
    expect(events.some((e) => e.duration_ms > 3000)).toBe(false);
  });

  it('still detects ordinary blinks either side of a gap', () => {
    const a = series(60, [10, 40]);
    const b = series(60, [10, 40], a[a.length - 1].t_ms + 5000);
    const events = classifyBlinks([...a, ...b], BASE);
    // Four real blinks, none of them spanning the gap.
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...events.map((e) => e.duration_ms))).toBeLessThan(1000);
  });

  it('derives the gap threshold from the series rather than assuming a frame rate', () => {
    const fast = series(60, []);                       // 33 ms steps
    const slow = series(60, [], 0, 100);               // 100 ms steps
    expect(samplingGapThreshold(fast)).toBeLessThan(samplingGapThreshold(slow));
    // A steady but slow series must not be read as one continuous dropout.
    expect(samplingGapThreshold(slow)).toBeGreaterThan(100);
  });
});

describe('rates are computed over observed time, not wall clock', () => {
  it('excludes a dropout from the denominator', () => {
    const a = series(60, []);                                    // ~2 s observed
    const b = series(60, [], a[a.length - 1].t_ms + 10_000);     // ~2 s observed, 10 s later
    const all = [...a, ...b];

    const span = all[all.length - 1].t_ms - all[0].t_ms;
    const observed = observedDurationMs(all);

    expect(span).toBeGreaterThan(13_000);
    // Roughly the 4 s actually watched, not the 14 s elapsed.
    expect(observed).toBeLessThan(5_000);
    expect(observed).toBeGreaterThan(3_000);
  });

  it('equals the span when nothing was dropped', () => {
    const s = series(100, []);
    const span = s[s.length - 1].t_ms - s[0].t_ms;
    expect(observedDurationMs(s)).toBeCloseTo(span, 0);
  });
});

describe('degenerate landmark geometry reports absence, not a maximal blink', () => {
  const pt = (x: number, y: number) => ({ x, y });

  it('returns NaN for a collapsed eye rather than a finite EAR of 0', () => {
    // Every landmark at the same point. The old denominator (2*0 + 1e-6) gave a finite 0, which is
    // not "missing" — it is the deepest possible closure, and the classifier scored it as one.
    const collapsed = Array.from({ length: 6 }, () => pt(0.5, 0.5));
    expect(Number.isNaN(eyeAspectRatio(collapsed))).toBe(true);
  });

  it('returns NaN rather than throwing on a short landmark array', () => {
    // MediaPipe can return fewer landmarks than the full mesh. Indexing past the end gave
    // undefined, on which the distance helper threw — and the exception took the whole frame out
    // of the EAR series, the face-presence denominator and the frame-rate estimate at once.
    expect(() => faceEar([])).not.toThrow();
    expect(Number.isNaN(faceEar([]))).toBe(true);
    expect(Number.isNaN(faceEar(Array.from({ length: 100 }, () => pt(0.5, 0.5))))).toBe(true);
  });

  it('returns NaN when a landmark carries a non-finite coordinate', () => {
    const marks = Array.from({ length: 480 }, () => pt(0.5, 0.5));
    for (const i of [...LEFT_EYE_EAR, ...RIGHT_EYE_EAR]) marks[i] = pt(0.4 + i * 1e-3, 0.5);
    marks[LEFT_EYE_EAR[0]] = pt(NaN, 0.5);
    expect(Number.isNaN(faceEar(marks))).toBe(true);
  });

  it('still computes a normal EAR for plausible geometry', () => {
    const p = [pt(0.40, 0.50), pt(0.43, 0.47), pt(0.47, 0.47), pt(0.50, 0.50), pt(0.47, 0.53), pt(0.43, 0.53)];
    const ear = eyeAspectRatio(p);
    expect(Number.isFinite(ear)).toBe(true);
    expect(ear).toBeGreaterThan(0.1);
    expect(ear).toBeLessThan(1);
  });
});
