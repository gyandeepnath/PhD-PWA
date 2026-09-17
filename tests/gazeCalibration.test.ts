import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/*
 * THE GIMMICK CASE.
 *
 * `valid` is one boolean over a deliberately lenient bar, and it could not tell apart a calibration
 * that happened from one that barely did: nine targets with a full dwell each, and six targets with
 * a single solved frame each, both returned true, both showed the operator nothing, and both
 * exported gaze_calibration_valid TRUE. These tests exist to keep that distinction real.
 */
describe('gaze quality separates a real calibration from a token one', () => {
  const spread = (h: number, v: number, n: number) => Array.from({ length: n }, () => ({ h, v }));
  const run = async (perTarget: number, only?: string[]) => {
    const { fitGazeCalibration, gazeQuality, GAZE_TARGETS } = await import('@/tracking/gazeCalibration');
    const all: Record<string, { h: number; v: number }[]> = {
      cc: spread(0, 0, perTarget),
      ml: spread(-0.20, 0, perTarget), mr: spread(0.20, 0, perTarget),
      tc: spread(0, -0.20, perTarget), bc: spread(0, 0.20, perTarget),
      tl: spread(-0.18, -0.18, perTarget), tr: spread(0.18, -0.18, perTarget),
      bl: spread(-0.18, 0.18, perTarget), br: spread(0.18, 0.18, perTarget),
    };
    const samples = only ? Object.fromEntries(Object.entries(all).filter(([k]) => only.includes(k))) : all;
    const cal = fitGazeCalibration(samples);
    return { cal, q: gazeQuality(cal), n: GAZE_TARGETS.length };
  };

  it('grades a fully tracked nine-point run as good', async () => {
    // 800 ms at ~30 fps is about 24 samples per target.
    const { cal, q, n } = await run(24);
    expect(cal.valid).toBe(true);
    expect(q.trust).toBe('good');
    expect(q.wellCovered).toBe(n);
  });

  it('grades the one-frame-per-target run as thin, though it passes validity', async () => {
    // THE case. It satisfies the acceptance rule and used to be indistinguishable from the above.
    const { cal, q } = await run(1);
    expect(cal.valid).toBe(true);
    expect(q.trust).toBe('thin');
    expect(q.wellCovered).toBe(0);
  });

  it('grades a rejected fit as unusable, never merely thin', async () => {
    const { cal, q } = await run(24, ['cc', 'mr']);
    expect(cal.valid).toBe(false);
    expect(q.trust).toBe('unusable');
  });

  it('counts a target well covered only past half its dwell', async () => {
    const { GAZE_DWELL_MS, GAZE_WELL_COVERED_FRACTION } = await import('@/tracking/gazeCalibration');
    const expected = Math.round((GAZE_DWELL_MS / 1000) * 30);
    const bar = Math.ceil(expected * GAZE_WELL_COVERED_FRACTION);
    expect((await run(bar)).q.wellCovered).toBe((await run(bar)).n);
    expect((await run(bar - 1)).q.wellCovered).toBe(0);
  });

  it('reports the evidence, not only the grade', async () => {
    // A bare verdict leaves an operator guessing whether the camera is slow or the participant
    // moved. The counts are what make the warning actionable.
    const { q, n } = await run(6);
    expect(q.covered).toBe(n);
    expect(q.medianSamples).toBe(6);
    expect(q.expectedSamples).toBeGreaterThan(6);
  });

  it('records a sample count for every target, including those that produced none', async () => {
    const { GAZE_TARGETS } = await import('@/tracking/gazeCalibration');
    const { cal } = await run(24, ['cc', 'ml', 'mr', 'tc', 'bc']);
    expect(Object.keys(cal.samplesPerTarget).sort()).toEqual(GAZE_TARGETS.map((t) => t.id).sort());
    expect(cal.samplesPerTarget.tl).toBe(0);
  });
});

/*
 * The warning has to be WIRED, not merely available.
 *
 * Deleting the branch that shows it failed no test: the grading above is pure and well covered, and
 * the screen that acts on it was covered by nothing. There is no DOM-rendering harness in this
 * project, and adding one for a single branch is not worth a new dependency, so this is a STATIC
 * assertion over the source — the same technique tests/pwaPolicy.test.ts uses against
 * vite.config.ts and tests/analysisTemplates.test.ts uses against the R template.
 *
 * Be clear about what it does and does not prove. It proves the branch and its controls are present
 * and reachable from the thin verdict. It does not prove the screen renders correctly. A render test
 * would be stronger; this is what stops the warning being quietly deleted.
 */
describe('the thin-calibration warning is wired into the routine', () => {
  const source = () =>
    readFileSync(resolve(__dirname, '..', 'src/start/CalibrationRoutine.tsx'), 'utf8');

  it('branches on the thin verdict before advancing', () => {
    const src = source();
    expect(src).toMatch(/gazeQuality\.trust === 'thin'/);
    // It must come BEFORE onDone(), or the routine advances past its own warning.
    const branch = src.indexOf("gazeQuality.trust === 'thin'");
    const done = src.indexOf('onDone();', branch);
    expect(branch).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(branch);
  });

  it('offers both a re-run and an explicit accept, so the choice is the operator\'s', () => {
    const src = source();
    expect(src).toContain('calibration-retry-thin');
    expect(src).toContain('calibration-accept-thin');
  });

  it('shows the evidence and not just a verdict', () => {
    // An operator told only "thin" cannot tell a slow camera from a participant who moved.
    const src = source();
    for (const field of ['wellCovered', 'medianSamples', 'expectedSamples', 'covered']) {
      expect(src).toContain(`gazeQuality.${field}`);
    }
  });

  it('says that the primary outcome is unaffected', () => {
    // Gaze is secondary; the blink thresholds come from the EAR baseline. An operator who thinks a
    // thin gaze fit has ruined the sitting may abandon a participant who was fine.
    expect(source()).toMatch(/does NOT affect the primary outcome/i);
  });
});
