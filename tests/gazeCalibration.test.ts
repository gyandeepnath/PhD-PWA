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

  /*
   * The QC column and the validity test must count the same thing. They did not: the exported
   * count filtered raw samples while the fit filtered finite ones, so a target that returned
   * nothing but NaN — the degenerate-landmark case faceEar produces — was simultaneously
   * "detected" in the export and absent from the calibration.
   */
  it('does not count a target whose samples are all non-finite', async () => {
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    const s = goodSamples();
    s.tl = [{ h: NaN, v: NaN }, { h: NaN, v: NaN }, { h: NaN, v: NaN }];
    const cal = fitGazeCalibration(s);
    expect(cal.targetsWithSamples).toBe(GAZE_TARGETS.length - 1);
  });

  it('reports a detected count that agrees with the validity verdict it was judged on', async () => {
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    const MIN_TARGETS = Math.ceil(GAZE_TARGETS.length * (2 / 3));

    // All nine usable: counted as nine, and validity is not blocked by coverage.
    expect(fitGazeCalibration(goodSamples()).targetsWithSamples).toBe(GAZE_TARGETS.length);

    // Four targets reduced to NaN leaves five usable, below the two-thirds floor. A count that
    // still said nine would contradict the invalid verdict sitting beside it in the same row.
    const s = goodSamples();
    for (const id of ['tl', 'tr', 'bl', 'br'] as const) s[id] = [{ h: NaN, v: NaN }];
    const cal = fitGazeCalibration(s);
    expect(cal.targetsWithSamples).toBe(GAZE_TARGETS.length - 4);
    expect(cal.targetsWithSamples).toBeLessThan(MIN_TARGETS);
    expect(cal.valid).toBe(false);
  });
});

/*
 * The coverage bar is a METHODS decision, and it used to be a bare `> 0` inside a filter. Naming it
 * only helps if changing it actually changes the verdict — otherwise the constant is decoration.
 */
describe('the per-target coverage bar is the thing that decides coverage', () => {
  const spread = (h: number, v: number, n: number) => Array.from({ length: n }, () => ({ h, v }));
  const runWith = async (perTarget: number) => {
    const { fitGazeCalibration } = await import('@/tracking/gazeCalibration');
    return fitGazeCalibration({
      cc: spread(0, 0, perTarget),
      ml: spread(-0.20, 0, perTarget), mr: spread(0.20, 0, perTarget),
      tc: spread(0, -0.20, perTarget), bc: spread(0, 0.20, perTarget),
      tl: spread(-0.18, -0.18, perTarget), tr: spread(0.18, -0.18, perTarget),
      bl: spread(-0.18, 0.18, perTarget), br: spread(0.18, 0.18, perTarget),
    });
  };

  it('accepts a run at exactly the bar, and counts every target', async () => {
    const { MIN_SAMPLES_PER_TARGET, GAZE_TARGETS } = await import('@/tracking/gazeCalibration');
    const cal = await runWith(MIN_SAMPLES_PER_TARGET);
    expect(cal.targetsWithSamples).toBe(GAZE_TARGETS.length);
    expect(cal.valid).toBe(true);
  });

  it('counts no target when every dwell falls one sample short of the bar', async () => {
    const { MIN_SAMPLES_PER_TARGET } = await import('@/tracking/gazeCalibration');
    // At a bar of 1 this is the empty run; at 5 it is four samples per target. Either way the
    // verdict must follow the constant rather than a hardcoded `> 0`.
    const cal = await runWith(MIN_SAMPLES_PER_TARGET - 1);
    expect(cal.targetsWithSamples).toBe(0);
    expect(cal.valid).toBe(false);
  });

  it('documents the bar currently in force, so raising it is a deliberate edit', async () => {
    const { MIN_SAMPLES_PER_TARGET } = await import('@/tracking/gazeCalibration');
    // The original audit finding asked for 5. This assertion is a tripwire, not an endorsement:
    // changing the constant must come with changing this line, and with the investigator's decision.
    expect(MIN_SAMPLES_PER_TARGET).toBe(1);
  });
});
