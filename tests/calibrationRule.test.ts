/**
 * The calibration's rules as data (Round 80): the baseline window cal-r2 (at least 6 s, then until 30
 * usable frames, at most 12 s; its live state and its failure reason) and the gaze check gaze-r2 (three
 * dots, a share of the frames the camera delivered, one range of horizontal iris offset, and the
 * on-screen test every frame is put through). Pure functions; the screen is in calibrationRoutine.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import {
  baselineWindowDone, baselineFailure, eyeState, gazeDotNeeded, calibrationSequence,
  CALIBRATION_MIN_SHARE, CALIBRATION_GROUND, CALIBRATION_RULE, GAZE_DOTS, GAZE_DOT_SAMPLE_MS,
  NOMINAL_DELIVERED_FPS, STEADY_WINDOW_MS,
} from '@/tracking/calibrationSequence';
import { fitGazeCheck, onScreenFrame, gazeCheckTrust, GAZE_RANGE_MARGIN, GAZE_RULE } from '@/tracking/gazeCalibration';
import { MIN_EAR_BASELINE_SAMPLES } from '@/tracking/blink';
import { CONFIG } from '@/experiment/config';
import { STIMULUS_COLUMN_PX, DESIGN_WIDTH } from '@/lib/viewportScale';
import { STUDY_TABLET_MM_PER_LAYOUT_PX, NOMINAL_VIEWING_DISTANCE_MM } from '@/lib/rtLocations';

const step = { ms: 6000, maxMs: 12000, minSamples: 30 };

describe('the baseline window, rule cal-r2', () => {
  it('is the rule the sequence runs, on the grey field', () => {
    expect(CALIBRATION_RULE).toBe('cal-r2');
    expect(CALIBRATION_GROUND).toBe(CONFIG.ADAPTATION_COLOR);
    const b = calibrationSequence()[0];
    expect(b).toMatchObject({ kind: 'ear_baseline', ms: CONFIG.EAR_BASELINE_MS, maxMs: CONFIG.EAR_BASELINE_MAX_MS, minSamples: MIN_EAR_BASELINE_SAMPLES });
  });

  it('runs at least its least time, even with plenty of frames', () => {
    expect(baselineWindowDone(5999, 200, step)).toBe(false);
    expect(baselineWindowDone(6000, 200, step)).toBe(true);
  });

  it('runs on past its least time until it has the frames the fit needs', () => {
    expect(baselineWindowDone(8000, 29, step)).toBe(false);
    expect(baselineWindowDone(8000, 30, step)).toBe(true);
  });

  it('stops at its most whatever it has', () => {
    expect(baselineWindowDone(12000, 3, step)).toBe(true);
  });

  it('does not lower the floor of usable frames', () => {
    expect(MIN_EAR_BASELINE_SAMPLES).toBe(30);
    expect(CONFIG.EAR_BASELINE_MAX_MS).toBeGreaterThan(CONFIG.EAR_BASELINE_MS);
  });

  it('names the reason a window gave no baseline, in the order to check', () => {
    expect(baselineFailure({ frames: 0, faceFrames: 0, usable: 0 })).toBe('no_frames');
    expect(baselineFailure({ frames: 280, faceFrames: 100, usable: 25 })).toBe('no_face');
    expect(baselineFailure({ frames: 280, faceFrames: 270, usable: 20 })).toBe('eyes_not_measured');
    expect(baselineFailure({ frames: 28, faceFrames: 28, usable: 28 })).toBe('too_few_frames');
    expect(baselineFailure({ frames: 280, faceFrames: 270, usable: 30 })).toBeNull();
  });
});

describe('the live state: eyes found, steady', () => {
  const at24 = (from: number, to: number) => {
    const out: number[] = [];
    for (let t = from; t <= to; t += 1000 / 24) out.push(t);
    return out;
  };
  it('a face and open eyes in every frame at 24 fps: found and steady', () => {
    const ts = at24(0, 3000);
    expect(eyeState({ now: 3000, faceTimes: ts, usableTimes: ts, deliveredFps: 24 })).toEqual({ eyes: 'found', steady: true });
  });
  it('the eyes measured in only a third of the frames: found, not steady', () => {
    const ts = at24(0, 3000);
    const third = ts.filter((_, i) => i % 3 === 0);
    expect(eyeState({ now: 3000, faceTimes: ts, usableTimes: third, deliveredFps: 24 })).toEqual({ eyes: 'found', steady: false });
  });
  it('a face but no usable eye: face only', () => {
    expect(eyeState({ now: 3000, faceTimes: at24(0, 3000), usableTimes: [], deliveredFps: 24 }).eyes).toBe('face_only');
  });
  it('nothing for half a second: searching', () => {
    const ts = at24(0, 2400);
    expect(eyeState({ now: 3000, faceTimes: ts, usableTimes: ts, deliveredFps: 24 })).toEqual({ eyes: 'searching', steady: false });
  });
  it('judges steady against the camera\'s measured rate, and the nominal 30 only when there is none', () => {
    // 13 usable frames in the last second: steady against a 24-fps camera (needs 12), not against 30 (15).
    const ts = Array.from({ length: 13 }, (_, i) => 3000 - i * 70);
    expect(eyeState({ now: 3000, faceTimes: ts, usableTimes: ts, deliveredFps: 24 }).steady).toBe(true);
    expect(eyeState({ now: 3000, faceTimes: ts, usableTimes: ts, deliveredFps: null }).steady).toBe(false);
    expect(NOMINAL_DELIVERED_FPS).toBe(30);
    expect(STEADY_WINDOW_MS).toBe(1000);
  });
});

describe('the gaze check, rule gaze-r2', () => {
  it('three dots on a mid-height reading line: its middle and its two ends', () => {
    expect(GAZE_RULE).toBe('gaze-r2');
    expect(GAZE_DOTS.map((d) => d.id)).toEqual(['centre', 'left', 'right']);
    expect(GAZE_DOTS.map((d) => d.dx)).toEqual([0, -STIMULUS_COLUMN_PX / 2, STIMULUS_COLUMN_PX / 2]);
    // The ends are inside the screen: 520 of the 576 root px to the edge.
    expect(STIMULUS_COLUMN_PX / 2).toBeLessThan(DESIGN_WIDTH / 2);
  });

  it('asks each dot for half the frames the camera delivered in its second', () => {
    expect(CALIBRATION_MIN_SHARE).toBe(0.5);
    expect(GAZE_DOT_SAMPLE_MS).toBe(1000);
    expect(gazeDotNeeded(24)).toBe(12);
    expect(gazeDotNeeded(30)).toBe(15);
    expect(gazeDotNeeded(15)).toBe(8);
    expect(gazeDotNeeded(null)).toBe(15);
  });

  it('the margin is the screen edge plus 3 degrees, from the geometry', () => {
    const deg = (mm: number) => Math.atan(mm / NOMINAL_VIEWING_DISTANCE_MM);
    const dot = deg((STIMULUS_COLUMN_PX / 2) * STUDY_TABLET_MM_PER_LAYOUT_PX);
    const edge = deg((DESIGN_WIDTH / 2) * STUDY_TABLET_MM_PER_LAYOUT_PX) + (3 * Math.PI) / 180;
    expect(Math.sin(edge) / Math.sin(dot) - 1).toBeCloseTo(GAZE_RANGE_MARGIN, 2);
  });

  const noisy = (centre: number, n: number, sd = 0.01) => Array.from({ length: n }, (_, i) => centre + (i % 2 ? sd : -sd));
  const need = { centre: 12, left: 12, right: 12 };

  it('fits a range from ends that clear the centre\'s own scatter, on either side', () => {
    const fit = fitGazeCheck({ centre: noisy(0.02, 20), left: noisy(0.14, 20), right: noisy(-0.10, 20) }, need);
    expect(fit.valid).toBe(true);
    expect(fit.reason).toBeNull();
    expect(fit.hCentre).toBeCloseTo(0.02, 6);
    const half = 0.12;
    expect(fit.range!.lo).toBeCloseTo(-0.10 - GAZE_RANGE_MARGIN * half, 6);
    expect(fit.range!.hi).toBeCloseTo(0.14 + GAZE_RANGE_MARGIN * half, 6);
    expect(gazeCheckTrust(fit)).toBe('good');
  });

  it('fails a dot short of its frames, and says which', () => {
    const fit = fitGazeCheck({ centre: noisy(0, 20), left: noisy(0.12, 5), right: noisy(-0.12, 20) }, need);
    expect(fit.valid).toBe(false);
    expect(fit.reason).toBe('too_few_samples');
    expect(fit.shortDots).toEqual(['left']);
    expect(fit.range).toBeNull();
    expect(gazeCheckTrust(fit)).toBe('unusable');
  });

  it('fails ends on the same side of the centre, or inside its scatter', () => {
    expect(fitGazeCheck({ centre: noisy(0, 20), left: noisy(0.12, 20), right: noisy(0.10, 20) }, need).reason).toBe('not_separable');
    expect(fitGazeCheck({ centre: noisy(0, 20, 0.05), left: noisy(0.06, 20), right: noisy(-0.06, 20) }, need).reason).toBe('not_separable');
  });

  it('drops a closed or partly solved eye (NaN) before counting', () => {
    const fit = fitGazeCheck({ centre: [...noisy(0, 12), NaN, NaN], left: noisy(0.12, 12), right: noisy(-0.12, 12) }, need);
    expect(fit.samplesPerDot.centre).toBe(12);
    expect(fit.valid).toBe(true);
  });

  it('a frame is on screen inside the range with the head toward the tablet; never measured with the eye closed', () => {
    const range = { lo: -0.15, hi: 0.18 };
    expect(onScreenFrame(0.0, false, range)).toBe(true);
    expect(onScreenFrame(0.25, false, range)).toBe(false);
    expect(onScreenFrame(0.0, true, range)).toBe(false);
    expect(onScreenFrame(NaN, false, range)).toBeNull();
    expect(onScreenFrame(NaN, true, range)).toBeNull();
    expect(onScreenFrame(0.0, false, null)).toBeNull();
  });
});
