import { describe, it, expect } from 'vitest';
import { fitGazeCalibration, GAZE_TARGETS, type GazeSample } from '@/tracking/gazeCalibration';
import { estimateGaze } from '@/tracking/gaze';
import type { Point } from '@/tracking/blink';

describe('gaze calibration fitting', () => {
  it('fits a neutral bias and separable thresholds from clean samples', () => {
    // Centre fixation has a small +0.1 bias; edges deviate strongly along their axis.
    const s: Record<string, GazeSample[]> = {};
    for (const t of GAZE_TARGETS) {
      const dirH = t.x < 0.5 ? -0.5 : t.x > 0.5 ? 0.5 : 0;
      const dirV = t.y < 0.5 ? -0.5 : t.y > 0.5 ? 0.5 : 0;
      s[t.id] = [{ h: 0.1 + dirH, v: 0.0 + dirV }];
    }
    const cal = fitGazeCalibration(s);
    expect(cal.valid).toBe(true);
    expect(cal.h0).toBeCloseTo(0.1, 2); // recovered bias
    expect(cal.v0).toBeCloseTo(0.0, 2);
    expect(cal.hThreshold).toBeGreaterThan(0.06);
    expect(cal.vThreshold).toBeGreaterThan(0.06);
  });

  it('is invalid (falls back) when edges are not separable from centre', () => {
    const s: Record<string, GazeSample[]> = {};
    for (const t of GAZE_TARGETS) s[t.id] = [{ h: 0.0, v: 0.0 }]; // no deviation anywhere
    const cal = fitGazeCalibration(s);
    expect(cal.valid).toBe(false);
    expect(cal.hThreshold).toBeCloseTo(0.18, 5); // default
  });

  it('is invalid with too few samples', () => {
    expect(fitGazeCalibration({ cc: [{ h: 0, v: 0 }] }).valid).toBe(false);
  });
});

describe('estimateGaze with fitted neutral bias', () => {
  function lm(irisH: number): Point[] {
    // Build a landmark set where the iris sits at offset irisH within a unit eye box.
    const a: Point[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
    a[33] = { x: 0.3, y: 0 }; a[133] = { x: 0.4, y: 0 };
    a[362] = { x: 0.6, y: 0 }; a[263] = { x: 0.7, y: 0 };
    a[159] = { x: 0, y: 0.45 }; a[145] = { x: 0, y: 0.55 };
    a[386] = { x: 0, y: 0.45 }; a[374] = { x: 0, y: 0.55 };
    // iris x mapped so normalised h ≈ irisH
    a[468] = { x: 0.3 + (irisH / 2 + 0.5) * 0.1, y: 0.5 };
    a[473] = { x: 0.6 + (irisH / 2 + 0.5) * 0.1, y: 0.5 };
    return a;
  }

  it('classifies a biased-but-centred gaze as centre once calibrated', () => {
    // A participant whose neutral gaze reads h≈0.2 (head turned). Uncalibrated → off-centre.
    const uncal = estimateGaze(lm(0.2));
    expect(uncal.zone).not.toBe('cc');
    // With h0=0.2 neutral correction, the same gaze is centre.
    const cal = estimateGaze(lm(0.2), 0.18, 0.18, 0.2, 0);
    expect(cal.isCenter).toBe(true);
  });
});

/**
 * What counts as a valid calibration.
 *
 * `gaze_calibrated` is exported as a boolean and the analysis is told that gaze zones are
 * meaningful only when it is true. So the bar for true has to be a real one. It was not: the test
 * was nine samples across all nine targets COMBINED, which two targets could satisfy on their own,
 * and separability on EITHER axis was enough — leaving the other axis's threshold at an unfitted
 * default while the flag still said calibrated.
 */
describe('calibration validity requires coverage and both axes', () => {
  const spread = (h: number, v: number, n = 6) =>
    Array.from({ length: n }, () => ({ h, v }));

  /** A well-covered calibration: centre tight, edges displaced on both axes. */
  const goodSamples = () => ({
    cc: spread(0, 0),
    ml: spread(-0.20, 0), mr: spread(0.20, 0),
    tc: spread(0, -0.20), bc: spread(0, 0.20),
    tl: spread(-0.18, -0.18), tr: spread(0.18, -0.18),
    bl: spread(-0.18, 0.18), br: spread(0.18, 0.18),
  });

  it('accepts a properly covered nine-point run', async () => {
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    expect(fitGazeCalibration(goodSamples()).valid).toBe(true);
  });

  it('rejects a run where only two targets produced samples', async () => {
    // Ten samples in total — enough to pass the old count-based test — from two targets.
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    const sparse = { cc: spread(0, 0, 5), mr: spread(0.2, 0, 5) };
    expect(fitGazeCalibration(sparse).valid).toBe(false);
  });

  it('rejects a run that separates horizontally but not vertically', async () => {
    // The vertical threshold would otherwise stay at its unfitted floor while the flag said TRUE,
    // making every vertical gaze zone in the sitting a guess presented as a measurement.
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    const s = goodSamples();
    for (const id of ['tc', 'bc', 'tl', 'tr', 'bl', 'br'] as const) {
      s[id] = s[id].map((p) => ({ h: p.h, v: 0 }));
    }
    expect(fitGazeCalibration(s).valid).toBe(false);
  });

  it('falls back to the default thresholds when it declares itself invalid', async () => {
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    const { DEFAULT_GAZE_THRESHOLD } = await import('@/tracking/gaze');
    const r = fitGazeCalibration({ cc: spread(0, 0, 5), mr: spread(0.2, 0, 5) });
    expect(r.valid).toBe(false);
    expect(r.hThreshold).toBe(DEFAULT_GAZE_THRESHOLD);
    expect(r.vThreshold).toBe(DEFAULT_GAZE_THRESHOLD);
  });
});
