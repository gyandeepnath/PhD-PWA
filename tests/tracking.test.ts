import { describe, it, expect } from 'vitest';
import { estimateHeadPose, isOffAxis, OFF_AXIS_YAW_DEG } from '@/tracking/headPose';
import { estimateGaze } from '@/tracking/gaze';
import { classifyLighting, pixelLuma } from '@/tracking/lighting';
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import type { Point } from '@/tracking/blink';

/** Build a 478-point landmark array, all at origin, then override specific indices. */
function landmarks(overrides: Record<number, Point>): Point[] {
  const lm: Point[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (const [i, p] of Object.entries(overrides)) lm[Number(i)] = p;
  return lm;
}

describe('head pose', () => {
  it('frontal face has ~0 yaw and ~0 roll', () => {
    const lm = landmarks({
      1: { x: 0.5, y: 0.5 }, 152: { x: 0.5, y: 0.7 },
      234: { x: 0.3, y: 0.5 }, 454: { x: 0.7, y: 0.5 },
      133: { x: 0.45, y: 0.5 }, 362: { x: 0.55, y: 0.5 },
    });
    const pose = estimateHeadPose(lm);
    expect(Math.abs(pose.yaw)).toBeLessThan(1);
    expect(Math.abs(pose.roll)).toBeLessThan(1);
  });

  it('off-axis uses the raised yaw threshold (15°)', () => {
    expect(isOffAxis({ pitch: 0, yaw: OFF_AXIS_YAW_DEG + 1, roll: 0 })).toBe(true);
    expect(isOffAxis({ pitch: 0, yaw: OFF_AXIS_YAW_DEG - 1, roll: 0 })).toBe(false);
  });
});

describe('gaze', () => {
  it('centered iris classifies as the centre zone', () => {
    const lm = landmarks({
      468: { x: 0.35, y: 0.5 }, 473: { x: 0.65, y: 0.5 },
      33: { x: 0.3, y: 0 }, 133: { x: 0.4, y: 0 },
      362: { x: 0.6, y: 0 }, 263: { x: 0.7, y: 0 },
      159: { x: 0, y: 0.45 }, 145: { x: 0, y: 0.55 },
      386: { x: 0, y: 0.45 }, 374: { x: 0, y: 0.55 },
    });
    const g = estimateGaze(lm);
    expect(g.zone).toBe('cc');
    expect(g.isCenter).toBe(true);
    expect(Math.abs(g.h)).toBeLessThan(0.05);
  });
});

describe('lighting', () => {
  it('bands luminance', () => {
    expect(classifyLighting(30)).toBe('low');
    expect(classifyLighting(120)).toBe('good');
    expect(classifyLighting(230)).toBe('overexposed');
  });
  it('pixel luma is BT.601', () => {
    expect(pixelLuma(255, 255, 255)).toBeCloseTo(255, 0);
    expect(pixelLuma(0, 0, 0)).toBe(0);
  });
});

describe('eye metrics aggregator', () => {
  it('summarises a stable, face-present reading window', () => {
    const agg = new EyeMetricsAggregator();
    for (let t = 0; t <= 2000; t += 33) {
      agg.ingest({
        t_ms: t, ear: 0.3,
        pose: { pitch: 2, yaw: 1, roll: 0 },
        zone: 'cc', isCenter: true, offAxis: false, facePresent: true, faceSize: 0.2,
      });
    }
    const rec = agg.finalize({
      conditionId: 'C', sessionId: 'S', cameraActive: true,
      baselineEarValue: 0.3, earThresholdUsed: 0.18, gazeCalibrated: false, baselineBlinkRate: 10,
    });
    expect(rec.face_presence_ratio).toBeCloseTo(1, 2);
    expect(rec.zone_center_ratio).toBeCloseTo(1, 2);
    expect(rec.blink_rate).toBe(0); // no dips => no blinks
    expect(rec.effective_fps).toBeGreaterThan(25);
    expect(rec.fps_adequate_for_tiers).toBe(true);
    expect(rec.blink_rate_delta_from_baseline).toBeCloseTo(-10, 5);
  });

  it('counts missing-face frames against presence ratio', () => {
    const agg = new EyeMetricsAggregator();
    for (let t = 0; t < 10; t++) {
      agg.ingest({
        t_ms: t * 33, ear: 0, pose: { pitch: 0, yaw: 0, roll: 0 },
        zone: 'cc', isCenter: false, offAxis: false, facePresent: t < 5, faceSize: 0,
      });
    }
    const rec = agg.finalize({
      conditionId: 'C', sessionId: 'S', cameraActive: true,
      baselineEarValue: 0.3, earThresholdUsed: 0.18, gazeCalibrated: false, baselineBlinkRate: null,
    });
    expect(rec.face_presence_ratio).toBeCloseTo(0.5, 2);
  });
});
