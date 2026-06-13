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
