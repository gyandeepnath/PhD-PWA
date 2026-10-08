/**
 * The fitted minimum (Round 79, rule fit-r1): the lid's deepest point estimated between frames, from a
 * template averaged over each frame's exposure. A sensitivity analysis only; the primary rule is the
 * lowest frame (blink-r1).
 *
 * THE NUMBERS THESE TESTS USE, WORKED OUT. A blink of the mean shape (down 100 ms, up 220 ms) sampled at
 * 24 fps puts two frames about 42 ms apart either side of its deepest point. The lowest frame is worst
 * when the two straddle the deepest point so that they read the same; with a 40-ms exposure that frame
 * then sees about 94% of the full closure, so it overstates the openness at the deepest point by about
 * 0.06 x (1 - depth) — 0.025 for a blink of true depth 0.58. So the lowest frame can only misread blinks
 * whose true depth is within about 0.025 of the 0.60 cut; the test blinks are chosen inside that band,
 * and at the phase that is worst for the lowest frame (searched, not assumed).
 *
 * Exposure blur lowers the deepest point the frames could ever show: the template averaged over a 40-ms
 * window peaks at 0.987 of full closure, not 1 (computed below). A fit that ignores the exposure fits that
 * blurred curve, so it reads the blink shallower than it was, by at least about that loss.
 */
import { describe, it, expect } from 'vitest';
import {
  fitBlinkMinimum, templateClosure, templateIntegral, frameClosure, FIT_RULE_VERSION, FIT_MIN_FRAMES,
} from '@/tracking/blinkFit';
import type { EarSample } from '@/tracking/blink';

const OPEN = 0.3;
const START = 1000;

/**
 * A noise-free two-phase raised-cosine blink of true lowest openness `depth`, sampled at `fps` from
 * `phase` (a fraction of a frame), each frame averaged over the `exposureMs` before its stamp. The average
 * is taken NUMERICALLY (200 points), independently of the fit's closed form.
 */
function blink(depth: number, fps: number, exposureMs: number, phase: number, down = 100, up = 220): EarSample[] {
  const dt = 1000 / fps;
  const out: EarSample[] = [];
  for (let t = phase * dt; t < 2000; t += dt) {
    let g = 0;
    if (exposureMs > 0) {
      const k = 200;
      for (let i = 0; i < k; i++) g += templateClosure(t - exposureMs + (exposureMs * (i + 0.5)) / k - START, down, up);
      g /= k;
    } else g = templateClosure(t - START, down, up);
    out.push({ t_ms: t, ear: OPEN * (1 - (1 - depth) * g) });
  }
  return out;
}
const lowest = (s: EarSample[]) => s.reduce((m, x, i) => (x.ear < s[m].ear ? i : m), 0);
/** The sampling phase at which the lowest frame overstates the openness most. */
function worstPhase(depth: number, fps: number, exposureMs: number, down = 100, up = 220): number {
  let worst = { phase: 0, v: -Infinity };
  for (let p = 0; p < 1; p += 0.01) {
    const s = blink(depth, fps, exposureMs, p, down, up);
    const v = s[lowest(s)].ear;
    if (v > worst.v) worst = { phase: p, v };
  }
  return worst.phase;
}
/** The deepest closure a frame with this exposure can show: the box-averaged template's peak. */
function blurredPeak(exposureMs: number, down = 100, up = 220): number {
  let best = 0;
  for (let t = 0; t < down + up + exposureMs; t += 0.1) best = Math.max(best, frameClosure(t, 0, down, up, exposureMs));
  return best;
}

describe('the fitted minimum', () => {
  it('is versioned', () => {
    expect(FIT_RULE_VERSION).toBe('fit-r1');
  });

  it('integrates the template exactly', () => {
    // The closed form against a fine numerical integral, inside each phase and across the joins.
    for (const x of [0, 30, 100, 150, 320, 400]) {
      let num = 0;
      const k = 20000;
      for (let i = 0; i < k; i++) num += templateClosure((x * (i + 0.5)) / k, 100, 220) * (x / k);
      expect(templateIntegral(x, 100, 220)).toBeCloseTo(num, 4);
    }
    expect(templateIntegral(1000, 100, 220)).toBe(160); // half of the 320-ms blink
  });

  it('recovers a blink\'s depth between frames that the lowest frame misses', () => {
    // True depth 0.58: a complete blink. At the worst phase for 24 fps and a 40-ms exposure, its lowest
    // frame reads above the 0.60 cut — an incomplete blink by the lowest-frame rule.
    const s = blink(0.58, 24, 40, worstPhase(0.58, 24, 40));
    const i = lowest(s);
    expect(s[i].ear / OPEN).toBeGreaterThan(0.6);
    const f = fitBlinkMinimum(s, i, OPEN, 40)!;
    expect(Math.abs(f.min_ear / OPEN - 0.58)).toBeLessThan(0.001);
    expect(f.min_ear / OPEN).toBeLessThan(0.6);
    expect(f.exposure_ms).toBe(40);
    expect(f.rmse).toBeLessThan(1e-5);
    // It found the blink's own shape, not just a depth.
    expect(f.down_ms).toBeCloseTo(100, 0);
    expect(f.up_ms).toBeCloseTo(220, 0);
  });

  it('recovers a short blink the lowest frame misses by more', () => {
    // A quicker blink (60/150 ms) has a sharper bottom, so the frames miss more of it: depth 0.55 reads
    // above 0.60 from its lowest frame at the worst phase.
    const s = blink(0.55, 24, 40, worstPhase(0.55, 24, 40, 60, 150), 60, 150);
    const i = lowest(s);
    expect(s[i].ear / OPEN).toBeGreaterThan(0.6);
    const f = fitBlinkMinimum(s, i, OPEN, 40)!;
    expect(Math.abs(f.min_ear / OPEN - 0.55)).toBeLessThan(0.001);
  });

  it('recovers the depth wherever the frames fall', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      for (const [fps, E] of [[20, 50], [24, 40], [30, 30], [30, 0]]) {
        const s = blink(0.45, fps, E, phase);
        const f = fitBlinkMinimum(s, lowest(s), OPEN, E)!;
        expect(Math.abs(f.min_ear / OPEN - 0.45), `fps ${fps}, exposure ${E}, phase ${phase}`).toBeLessThan(0.001);
      }
    }
  });

  it('under-corrects when it assumes no exposure for frames that had one', () => {
    const depth = 0.4, E = 40;
    const s = blink(depth, 25, E, worstPhase(depth, 25, E));
    const i = lowest(s);
    const right = fitBlinkMinimum(s, i, OPEN, E)!;
    const wrong = fitBlinkMinimum(s, i, OPEN, 0)!;
    expect(Math.abs(right.min_ear / OPEN - depth)).toBeLessThan(0.001);
    // What the blur alone hides: (1 - depth) x (1 - the blurred template's peak) = 0.6 x 0.013 = 0.008.
    const blurLoss = (1 - depth) * (1 - blurredPeak(E));
    expect(blurLoss).toBeGreaterThan(0.007);
    expect(blurLoss).toBeLessThan(0.009);
    // Treating blurred frames as instantaneous reads the blink shallower than it was, by at least most
    // of that — and still deeper than the lowest frame.
    expect(wrong.min_ear / OPEN - depth).toBeGreaterThan(0.75 * blurLoss);
    expect(wrong.min_ear).toBeLessThan(s[i].ear);
  });

  it('over-corrects when it assumes more exposure than the frames had', () => {
    // A 30-fps camera with a 10-ms exposure, fitted as if each frame were exposed for the whole 33 ms
    // (what an unknown exposure defaults to): it un-blurs blur that was not there, and reads deeper.
    const depth = 0.4;
    const s = blink(depth, 30, 10, worstPhase(depth, 30, 10));
    const i = lowest(s);
    const right = fitBlinkMinimum(s, i, OPEN, 10)!;
    const over = fitBlinkMinimum(s, i, OPEN, 1000 / 30)!;
    expect(Math.abs(right.min_ear / OPEN - depth)).toBeLessThan(0.001);
    expect(over.min_ear / OPEN).toBeLessThan(depth - 0.003);
  });

  it('gives no fit rather than a guess when the frames cannot support one', () => {
    const s = blink(0.3, 24, 0, 0.3);
    const i = lowest(s);
    expect(fitBlinkMinimum(s.slice(i - 1, i + 2), 1, OPEN, 0)).toBeNull(); // too few frames
    expect(FIT_MIN_FRAMES).toBe(5);
    // A face lost for 300 ms right after the deepest frame.
    const gapped = s.filter((x) => x.t_ms <= s[i].t_ms || x.t_ms > s[i].t_ms + 300);
    expect(fitBlinkMinimum(gapped, i, OPEN, 0)).toBeNull();
    expect(fitBlinkMinimum(s, i, 0, 0)).toBeNull();
    expect(fitBlinkMinimum(s, i, NaN, 0)).toBeNull();
    expect(fitBlinkMinimum(s, -1, OPEN, 0)).toBeNull();
    expect(fitBlinkMinimum(s, s.length, OPEN, 0)).toBeNull();
  });

  it('never reports a minimum below closed or above the open level', () => {
    for (const depth of [0.05, 0.3, 0.7, 0.74]) {
      const s = blink(depth, 20, 50, 0.4);
      const f = fitBlinkMinimum(s, lowest(s), OPEN, 50)!;
      expect(f.min_ear).toBeGreaterThanOrEqual(0);
      expect(f.min_ear).toBeLessThanOrEqual(OPEN);
    }
    // Frames dipping below zero (noise on a fully closed eye) still give a minimum of at least 0.
    const s = blink(0, 24, 0, 0.5).map((x) => ({ ...x, ear: x.ear - 0.02 }));
    const f = fitBlinkMinimum(s, lowest(s), OPEN, 0)!;
    expect(f.min_ear).toBeGreaterThanOrEqual(0);
  });
});
