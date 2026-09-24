/**
 * The eye-metrics aggregator under partial and hostile frames.
 *
 * MediaPipe emits NaN for any channel when a frame is only partially solved. Filtering has to
 * happen at INGEST, because a NaN survives smoothing - a window of NaNs averages to NaN - and one
 * bad frame then produced a NaN head pose and postural load for the entire condition.
 */
import { describe, it, expect } from 'vitest';
import { EyeMetricsAggregator, type FrameSample } from '@/tracking/aggregator';

const frame = (t_ms: number, ear: number, over: Partial<FrameSample> = {}): FrameSample => ({
  t_ms, ear,
  pose: { pitch: 1, yaw: 2, roll: 0.5 },
  zone: 'cc', isCenter: true, offAxis: false,
  facePresent: true, faceSize: 0.22, luma: 120,
  ...over,
});

const finalize = (feed: (a: EyeMetricsAggregator) => void) => {
  const a = new EyeMetricsAggregator();
  feed(a);
  return a.finalize({
    conditionId: 'c', sessionId: 's', cameraActive: true,
    baselineEarValue: 0.3, earThresholdUsed: 0.18,
    gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
  });
};
const nonFinite = (rec: Record<string, unknown>) =>
  Object.entries(rec).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v));

describe('every numeric channel is filtered at ingest', () => {
  it.each([
    ['all pose values NaN', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, 0.3, { pose: { pitch: NaN, yaw: NaN, roll: NaN } })); }],
    ['all EAR NaN', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, NaN)); }],
    ['face size NaN', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, 0.3, { faceSize: NaN })); }],
    ['luma NaN', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, 0.3, { luma: NaN })); }],
    ['timestamps NaN', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(NaN, 0.3)); }],
    ['no frames at all', () => {}],
    ['face never present', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, 0.3, { facePresent: false })); }],
    ['timestamps backwards', (a: EyeMetricsAggregator) => { for (let i = 200; i > 0; i--) a.ingest(frame(i * 33, 0.3)); }],
    ['identical timestamps', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(1000, 0.3)); }],
    ['EAR constant zero', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, 0)); }],
    ['EAR enormous', (a: EyeMetricsAggregator) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, 1e9)); }],
  ] as [string, (a: EyeMetricsAggregator) => void][])('produces no non-finite metric: %s', (_label, feed) => {
    const rec = finalize(feed);
    expect(nonFinite(rec as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('keeps the good frames when only some are corrupt', () => {
    const rec = finalize((a) => {
      for (let i = 0; i < 300; i++) {
        const bad = i % 7 === 0;
        a.ingest(frame(i * 33, bad ? NaN : (i % 45 < 3 ? 0.1 : 0.31),
          bad ? { pose: { pitch: NaN, yaw: NaN, roll: NaN } } : {}));
      }
    });
    expect(nonFinite(rec as unknown as Record<string, unknown>)).toEqual([]);
    expect(rec.head_pitch_mean).toBeCloseTo(1, 3);
    expect(rec.blink_rate).toBeGreaterThan(0);
  });

  it('reports a null primary outcome when no blink survived, never a clean zero', () => {
    const rec = finalize((a) => { for (let i = 0; i < 200; i++) a.ingest(frame(i * 33, NaN)); });
    expect(rec.incomplete_blink_ratio).toBeNull();
  });
});

describe('without an open-eye baseline there is no blink measure — not a count of zero', () => {
  /*
   * The operator can continue past calibration "without ocular measures", which promises they will be
   * empty. With the camera on and no baseline, classifyBlinks finds no events and the row reported 0
   * blinks at 0 per minute over a normal observed duration — a fabricated fatigue marker.
   */
  const feedBlinks = (a: EyeMetricsAggregator) => {
    let t = 0;
    for (let b = 0; b < 20; b++) {
      for (let k = 0; k < 60; k++) a.ingest(frame((t += 33), 0.3));
      for (let k = 0; k < 5; k++) a.ingest(frame((t += 33), 0.05));
    }
  };
  const run = (baseline: number | null) => {
    const a = new EyeMetricsAggregator();
    feedBlinks(a);
    return a.finalize({
      conditionId: 'c', sessionId: 's', cameraActive: true,
      baselineEarValue: baseline, earThresholdUsed: null,
      gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
    });
  };

  it('with a baseline, the same frames are measured', () => {
    const r = run(0.3);
    expect(r.blink_count_full! + r.blink_count_incomplete! + r.blink_count_micro!).toBeGreaterThan(0);
    expect(r.blink_rate).toBeGreaterThan(0);
  });

  it('without one, every blink-derived value is blank', () => {
    const r = run(null);
    for (const k of ['blink_rate', 'blink_rate_full', 'blink_rate_micro', 'blink_count_full', 'blink_count_micro',
      'blink_count_incomplete', 'incomplete_blink_ratio', 'long_closure_count', 'long_closure_total_ms'] as const) {
      expect(r[k], k).toBeNull();
    }
    expect(r.bins).toEqual({ first_half_blink_rate: null, second_half_blink_rate: null });
    expect(r.camera_active).toBe(true);            // the camera DID run; the frames are real
    expect(r.ear_sample_count).toBeGreaterThan(0);
  });
});
