import { describe, it, expect } from 'vitest';
import { estimateHeadPose, isOffAxis, OFF_AXIS_YAW_DEG } from '@/tracking/headPose';
import { estimateGaze } from '@/tracking/gaze';
import { classifyLighting, pixelLuma } from '@/tracking/lighting';
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import { computeClosureMetrics, interBlinkInterval, classifyBlinks, type EarSample, type Point } from '@/tracking/blink';

/** Build a 478-point landmark array, all at origin, then override specific indices. */
function landmarks(overrides: Record<number, Point>): Point[] {
  const lm: Point[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (const [i, p] of Object.entries(overrides)) lm[Number(i)] = p;
  return lm;
}

describe('head pose', () => {
  // Frontal face: eye-line at 0.5, chin at 0.7, nose at 45% of the way down (≈ pitch 0).
  const frontal = () => landmarks({
    1: { x: 0.5, y: 0.59 }, 152: { x: 0.5, y: 0.7 },
    234: { x: 0.3, y: 0.5 }, 454: { x: 0.7, y: 0.5 },
    133: { x: 0.45, y: 0.5 }, 362: { x: 0.55, y: 0.5 },
  });

  it('frontal face has ~0 yaw, ~0 roll and ~0 pitch', () => {
    const pose = estimateHeadPose(frontal());
    expect(Math.abs(pose.yaw)).toBeLessThan(1);
    expect(Math.abs(pose.roll)).toBeLessThan(1);
    expect(Math.abs(pose.pitch)).toBeLessThan(2); // regression: pitch was a constant +22.5°
  });

  it('pitch varies with head tilt and is not pinned to a constant', () => {
    // Nose tip nearer the eye-line ⇒ head pitched down ⇒ positive pitch; lower ⇒ negative.
    const down = estimateHeadPose(landmarks({
      1: { x: 0.5, y: 0.54 }, 152: { x: 0.5, y: 0.7 }, 234: { x: 0.3, y: 0.5 }, 454: { x: 0.7, y: 0.5 },
      133: { x: 0.45, y: 0.5 }, 362: { x: 0.55, y: 0.5 },
    })).pitch;
    const up = estimateHeadPose(landmarks({
      1: { x: 0.5, y: 0.66 }, 152: { x: 0.5, y: 0.7 }, 234: { x: 0.3, y: 0.5 }, 454: { x: 0.7, y: 0.5 },
      133: { x: 0.45, y: 0.5 }, 362: { x: 0.55, y: 0.5 },
    })).pitch;
    expect(down).toBeGreaterThan(estimateHeadPose(frontal()).pitch);
    expect(up).toBeLessThan(estimateHeadPose(frontal()).pitch);
    expect(down).not.toBeCloseTo(up, 1);
  });

  it('a frontal face is NOT flagged off-axis (regression: was always true)', () => {
    expect(isOffAxis(estimateHeadPose(frontal()))).toBe(false);
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

describe('PERCLOS + closure dynamics', () => {
  const open = (n: number, ear = 0.3): EarSample[] =>
    Array.from({ length: n }, (_, i) => ({ t_ms: i * 33, ear }));

  it('reports ~0 PERCLOS and no long closures for a fully-open series', () => {
    const c = computeClosureMetrics(open(60), 0.3, []);
    expect(c.perclos_p80).toBe(0);
    expect(c.long_closure_count).toBe(0);
  });

  it('captures a sustained long closure (>500 ms) and raises PERCLOS', () => {
    const samples: EarSample[] = [];
    for (let t = 0; t < 2000; t += 33) samples.push({ t_ms: t, ear: t >= 500 && t < 1300 ? 0.05 : 0.3 });
    const c = computeClosureMetrics(samples, 0.3, []);
    expect(c.perclos_p80).toBeGreaterThan(0.2); // ~800/2000 of the window is closed
    expect(c.long_closure_count).toBe(1);
    expect(c.long_closure_total_ms).toBeGreaterThan(500);
  });

  it('is frame-rate robust: halving the sample rate barely moves PERCLOS', () => {
    const mk = (step: number) => {
      const s: EarSample[] = [];
      for (let t = 0; t < 2000; t += step) s.push({ t_ms: t, ear: t >= 500 && t < 1300 ? 0.05 : 0.3 });
      return computeClosureMetrics(s, 0.3, []).perclos_p80!;
    };
    expect(Math.abs(mk(33) - mk(66))).toBeLessThan(0.08);
  });

  it('inter-blink interval is the mean onset gap', () => {
    // EAR dips at ~0, ~1000, ~2000 ms → two ~1000 ms gaps.
    const samples: EarSample[] = [];
    for (let t = 0; t <= 2200; t += 33) {
      const blink = [0, 1000, 2000].some((c) => Math.abs(t - c) < 50);
      samples.push({ t_ms: t, ear: blink ? 0.05 : 0.3 });
    }
    const events = classifyBlinks(samples, 0.3);
    const ibi = interBlinkInterval(events);
    expect(ibi.mean_inter_blink_interval_ms).toBeGreaterThan(800);
    expect(ibi.mean_inter_blink_interval_ms).toBeLessThan(1200);
  });

  it('inter-blink interval is null with fewer than two blinks', () => {
    expect(interBlinkInterval([]).mean_inter_blink_interval_ms).toBeNull();
  });
});

describe('eye metrics aggregator', () => {
  it('summarises a stable, face-present reading window', () => {
    const agg = new EyeMetricsAggregator();
    for (let t = 0; t <= 2000; t += 33) {
      agg.ingest({
        t_ms: t, ear: 0.3,
        pose: { pitch: 2, yaw: 1, roll: 0 },
        zone: 'cc', isCenter: true, offAxis: false, facePresent: true, faceSize: 0.2, luma: 130,
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
    // Lighting QC: mean luma well inside the 'good' band.
    expect(rec.mean_face_luma).toBeCloseTo(130, 5);
    expect(rec.lighting_quality).toBe('good');
  });

  it('flags low lighting and leaves it null when no luma was sampled', () => {
    const dim = new EyeMetricsAggregator();
    for (let t = 0; t <= 1000; t += 33) {
      dim.ingest({ t_ms: t, ear: 0.3, pose: { pitch: 0, yaw: 0, roll: 0 }, zone: 'cc', isCenter: true, offAxis: false, facePresent: true, faceSize: 0.2, luma: 30 });
    }
    expect(dim.finalize({ conditionId: 'C', sessionId: 'S', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.18, gazeCalibrated: false, baselineBlinkRate: null }).lighting_quality).toBe('low');

    const noLuma = new EyeMetricsAggregator();
    for (let t = 0; t <= 1000; t += 33) {
      noLuma.ingest({ t_ms: t, ear: 0.3, pose: { pitch: 0, yaw: 0, roll: 0 }, zone: 'cc', isCenter: true, offAxis: false, facePresent: true, faceSize: 0.2, luma: null });
    }
    const rec = noLuma.finalize({ conditionId: 'C', sessionId: 'S', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.18, gazeCalibrated: false, baselineBlinkRate: null });
    expect(rec.mean_face_luma).toBeNull();
    expect(rec.lighting_quality).toBeNull();
  });

  it('counts missing-face frames against presence ratio', () => {
    const agg = new EyeMetricsAggregator();
    for (let t = 0; t < 10; t++) {
      agg.ingest({
        t_ms: t * 33, ear: 0, pose: { pitch: 0, yaw: 0, roll: 0 },
        zone: 'cc', isCenter: false, offAxis: false, facePresent: t < 5, faceSize: 0, luma: null,
      });
    }
    const rec = agg.finalize({
      conditionId: 'C', sessionId: 'S', cameraActive: true,
      baselineEarValue: 0.3, earThresholdUsed: 0.18, gazeCalibrated: false, baselineBlinkRate: null,
    });
    expect(rec.face_presence_ratio).toBeCloseTo(0.5, 2);
  });
});
