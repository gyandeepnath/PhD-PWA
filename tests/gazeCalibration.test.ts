/**
 * The gaze check (rule gaze-r2, Round 80) end to end at the level of the landmarks: the iris offset
 * estimateGaze reads, a fit from frames shaped like a real check, the per-frame on-screen test, and
 * the on-screen ratio the reading window stores. The rule's arithmetic is in calibrationRule.test.ts;
 * the screen is in calibrationRoutine.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { fitGazeCheck, onScreenFrame, GAZE_RULE } from '@/tracking/gazeCalibration';
import { estimateGaze } from '@/tracking/gaze';
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import type { Point } from '@/tracking/blink';

/** A landmark set where the iris sits at normalised offset `irisH` in a unit eye box; `open` false shuts the lids. */
function lm(irisH: number, open = true): Point[] {
  const a: Point[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  a[33] = { x: 0.3, y: 0 }; a[133] = { x: 0.4, y: 0 };
  a[362] = { x: 0.6, y: 0 }; a[263] = { x: 0.7, y: 0 };
  const gap = open ? 0.05 : 0.002;
  a[159] = { x: 0, y: 0.5 - gap }; a[145] = { x: 0, y: 0.5 + gap };
  a[386] = { x: 0, y: 0.5 - gap }; a[374] = { x: 0, y: 0.5 + gap };
  a[468] = { x: 0.3 + (irisH / 2 + 0.5) * 0.1, y: 0.5 };
  a[473] = { x: 0.6 + (irisH / 2 + 0.5) * 0.1, y: 0.5 };
  return a;
}

describe('the offset the gaze check reads', () => {
  it('estimateGaze returns the horizontal offset it was built with', () => {
    expect(estimateGaze(lm(0.2)).h).toBeCloseTo(0.2, 4);
    expect(estimateGaze(lm(-0.15)).h).toBeCloseTo(-0.15, 4);
  });
  it('a closed eye gives no offset, so it can never be on or off screen', () => {
    expect(Number.isNaN(estimateGaze(lm(0.0, false)).h)).toBe(true);
    expect(onScreenFrame(estimateGaze(lm(0.0, false)).h, false, { lo: -1, hi: 1 })).toBeNull();
  });
});

describe('a check from frames, then reading', () => {
  // A participant whose straight-ahead offset reads +0.05 (head slightly turned), the line's ends at
  // -0.07 and +0.17, with a little jitter: the iris moves about 0.12 either way (R2, C1).
  const jitter = (c: number, n: number) => Array.from({ length: n }, (_, i) => estimateGaze(lm(c + ((i % 3) - 1) * 0.01)).h);
  const fit = fitGazeCheck({ centre: jitter(0.05, 20), left: jitter(-0.07, 20), right: jitter(0.17, 20) }, { centre: 12, left: 12, right: 12 });

  it('passes, with a range wider than the line', () => {
    expect(GAZE_RULE).toBe('gaze-r2');
    expect(fit.valid).toBe(true);
    expect(fit.range!.lo).toBeLessThan(-0.07);
    expect(fit.range!.hi).toBeGreaterThan(0.17);
  });

  it('counts the reading window on screen, a glance away off, and a blink as neither', () => {
    const agg = new EyeMetricsAggregator();
    const frame = (t: number, h: number, open: boolean, offAxis = false) => {
      const g = estimateGaze(lm(h, open));
      agg.ingest({
        t_ms: t, ear: open ? 0.3 : 0.05, pose: { pitch: 0, yaw: 0, roll: 0 }, offAxis,
        onScreen: onScreenFrame(g.h, offAxis, fit.range), facePresent: true, faceSize: 0.2, luma: null,
      });
    };
    let t = 0;
    for (let i = 0; i < 60; i++) frame((t += 40), 0.05 + (i % 10) * 0.012, true); // reading along the line
    for (let i = 0; i < 20; i++) frame((t += 40), 0.6, true);                      // a glance far to the side
    for (let i = 0; i < 20; i++) frame((t += 40), 0.05, true, true);              // head turned away
    for (let i = 0; i < 10; i++) frame((t += 40), 0.05, false);                   // a long blink
    const rec = agg.finalize({ conditionId: 'c', sessionId: 's', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.225, gazeCalibrated: true, headPitchCalibrated: true, calibrationId: 'k' });
    expect(rec.on_screen_ratio).toBeCloseTo(60 / 100, 6);
    expect(rec.gaze_rule_version).toBe('gaze-r2');
    // The nine-point zones are not measured any more: null, never the "best" value 0.
    expect(rec.gaze_deviation_ratio).toBeNull();
    expect(rec.zone_center_ratio).toBeNull();
    expect(rec.zone_transition_count).toBeNull();
  });

  it('stores no on-screen ratio without a passed check', () => {
    const agg = new EyeMetricsAggregator();
    for (let i = 0; i < 30; i++) {
      agg.ingest({ t_ms: i * 40, ear: 0.3, pose: { pitch: 0, yaw: 0, roll: 0 }, offAxis: false, onScreen: onScreenFrame(0.05, false, null), facePresent: true, faceSize: 0.2, luma: null });
    }
    const rec = agg.finalize({ conditionId: 'c', sessionId: 's', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.225, gazeCalibrated: false, headPitchCalibrated: true, calibrationId: 'k' });
    expect(rec.on_screen_ratio).toBeNull();
  });
});
