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

/**
 * PERCLOS must not be a function of the primary outcome.
 *
 * PERCLOS is in this protocol as a DROWSINESS covariate — the thing that lets an analyst separate
 * sleepiness from display-induced visual fatigue. Its openness scale used to run from the median of
 * this condition's own blink minima up to the baseline, which made it a function of how deeply the
 * participant blinked — i.e. of the incomplete-blink ratio, the primary outcome. Adjusting for such
 * a covariate would partial out part of the effect under study.
 */
describe('PERCLOS is measured against the calibrated baseline, not against this condition\'s blinks', () => {
  const at = (n: number, dips: number[], depth: number, t0 = 0): EarSample[] => {
    const deep = new Set<number>();
    for (const d of dips) { deep.add(d); deep.add(d + 1); deep.add(d + 2); }
    return Array.from({ length: n }, (_, i) => ({ t_ms: t0 + i * 33, ear: deep.has(i) ? BASE * depth : BASE }));
  };

  it('does not inflate PERCLOS for a participant whose blinks are all incomplete', async () => {
    const { classifyBlinks, computeClosureMetrics } = await import('@/tracking/blink');
    const dips = [20, 60, 100, 140, 180];
    // Never closes past 70% of baseline: by definition not a closure at all.
    const shallow = at(240, dips, 0.70);
    const ev = classifyBlinks(shallow, BASE);
    const m = computeClosureMetrics(shallow, BASE, ev);
    expect(ev.length).toBeGreaterThan(0);
    // The old scale rescaled those 0.70 dips to the bottom of the openness range and counted them.
    expect(m.perclos_p80).toBe(0);
  });

  it('still detects real closure', async () => {
    const { classifyBlinks, computeClosureMetrics } = await import('@/tracking/blink');
    const dips = [20, 60, 100, 140, 180];
    const deep = at(240, dips, 0.10);
    const m = computeClosureMetrics(deep, BASE, classifyBlinks(deep, BASE));
    expect(m.perclos_p80).toBeGreaterThan(0);
  });

  it('gives the same PERCLOS for the same eye behaviour regardless of blink depth elsewhere', async () => {
    // The decoupling property stated directly: identical near-closed samples must score identically
    // whether or not the condition also contains shallow blinks that would have moved the old
    // reference point.
    const { classifyBlinks, computeClosureMetrics } = await import('@/tracking/blink');
    const withShallow = [...at(120, [20, 60], 0.10), ...at(120, [20, 60], 0.70, 4000)];
    const withoutShallow = [...at(120, [20, 60], 0.10), ...at(120, [], 0, 4000)];
    const a = computeClosureMetrics(withShallow, BASE, classifyBlinks(withShallow, BASE));
    const b = computeClosureMetrics(withoutShallow, BASE, classifyBlinks(withoutShallow, BASE));
    expect(a.perclos_p80).toBeCloseTo(b.perclos_p80!, 6);
  });
});

/**
 * Gaze must not be driven by blinking.
 *
 * The vertical component was scaled by the eyelid APERTURE, which collapses toward zero during a
 * blink — so the division blew up and every blink registered as a large vertical gaze excursion.
 * That inflated zone_transition_count and gaze_deviation_ratio, and coupled both to blink
 * behaviour, which is the primary outcome: a participant who blinked more looked, in the data, like
 * one whose gaze wandered more.
 */
describe('gaze is blink-invariant', () => {
  // A synthetic face: only the landmarks estimateGaze() reads need to be real.
  const face = (aperture: number, irisDy = 0) => {
    const lm: { x: number; y: number }[] = Array.from({ length: 480 }, () => ({ x: 0.5, y: 0.5 }));
    const put = (i: number, x: number, y: number) => { lm[i] = { x, y }; };
    // Left eye around x 0.35-0.45, right eye 0.55-0.65; width 0.10 each.
    put(33, 0.35, 0.50); put(133, 0.45, 0.50);            // left outer / inner
    put(362, 0.55, 0.50); put(263, 0.65, 0.50);           // right inner / outer
    put(159, 0.40, 0.50 - aperture / 2); put(145, 0.40, 0.50 + aperture / 2);  // left top/bot
    put(386, 0.60, 0.50 - aperture / 2); put(374, 0.60, 0.50 + aperture / 2);  // right top/bot
    put(468, 0.40, 0.50 + irisDy); put(473, 0.60, 0.50 + irisDy);              // irises
    return lm;
  };

  it('reports no gaze at all while the lid is mostly shut', async () => {
    const { estimateGaze } = await import("@/tracking/gaze");
    const open = estimateGaze(face(0.035), 0.18, 0.18, 0, 0);
    const closing = estimateGaze(face(0.004), 0.18, 0.18, 0, 0);
    expect(Number.isFinite(open.v)).toBe(true);
    // Unresolved, which the aggregator treats as not-measured rather than as a centred gaze.
    expect(Number.isNaN(closing.v)).toBe(true);
  });

  it('gives the same gaze for the same eye direction at different lid openings', async () => {
    // The invariance property. With aperture-scaled vertical these differed by a factor of two.
    const { estimateGaze } = await import("@/tracking/gaze");
    const wide = estimateGaze(face(0.040, 0.004), 0.18, 0.18, 0, 0);
    const narrower = estimateGaze(face(0.024, 0.004), 0.18, 0.18, 0, 0);
    expect(narrower.v).toBeCloseTo(wide.v, 6);
    expect(narrower.zone).toBe(wide.zone);
  });

  it('still detects a genuine vertical gaze shift', async () => {
    const { estimateGaze } = await import("@/tracking/gaze");
    const centre = estimateGaze(face(0.035, 0), 0.05, 0.05, 0, 0);
    const down = estimateGaze(face(0.035, 0.010), 0.05, 0.05, 0, 0);
    expect(down.v).toBeGreaterThan(centre.v);
    expect(down.zone).not.toBe(centre.zone);
  });
});
