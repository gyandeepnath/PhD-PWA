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
    gazeCalibrated: false, headPitchCalibrated: false,
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
