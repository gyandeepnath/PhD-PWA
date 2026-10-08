/**
 * The frame-rate gate fps-g2 (Round 79; src/tracking/frameRateGate.ts): its numbers, its rounding, and
 * that every place that applies it gets the same answer from the same stored columns.
 */
import { describe, expect, it } from 'vitest';
import {
  FPS_GATE, FPS_GATE_V1, FPS_GATE_VERSION, fpsConsistent, fpsTier, gateParticipant, medianFps,
  rowGateVersion, samplingFpsObserved,
} from '@/tracking/frameRateGate';
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { splitCsvRow } from './helpers/csv';

const parseCsv = (content: string): Array<Record<string, string>> => {
  const [head, ...lines] = content.split('\n').filter((l) => l.length > 0);
  const cols = splitCsvRow(head);
  return lines.map((l) => { const v = splitCsvRow(l); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
};

describe('fps-g2: the numbers the simulation fixed', () => {
  it('is 20 / 15 with a 2-fps band, under the version that names it', () => {
    // docs/FPS_GATE_SIMULATION.md: C1 gives 20 (detection >= 0.98) and 15 (>= 0.95); C3 gives 2.
    // Changing one of these without the version string makes old and new rows indistinguishable.
    expect(FPS_GATE).toEqual({ ADEQUATE: 20, REDUCED: 15, CONSISTENCY_BAND: 2 });
    expect(FPS_GATE_VERSION).toBe('fps-g2');
    expect(FPS_GATE_V1).toBe('g1-25/30');
  });

  it('tiers at the boundaries: 20 is A, 19.99 B, 15 B, 14.99 C, nothing is null', () => {
    expect(fpsTier(20)).toBe('A');
    expect(fpsTier(31)).toBe('A');
    expect(fpsTier(19.99)).toBe('B');
    expect(fpsTier(15)).toBe('B');
    expect(fpsTier(14.99)).toBe('C');
    expect(fpsTier(0)).toBe('C');
    expect(fpsTier(null)).toBeNull();
    expect(fpsTier(Number.NaN)).toBeNull();
  });
});

describe('sampling_fps_observed', () => {
  it('is (samples - 1) / observed ms x 1000, to 0.01 half up', () => {
    // 4321 samples over 180 s: 24.0 exactly.
    expect(samplingFpsObserved(4321, 180_000)).toBe(24);
    // 1000 * 2000 / 99_999 = 20.0002 -> 20.
    expect(samplingFpsObserved(2001, 99_999)).toBe(20);
    // Half up, not to even: 2 samples over 1600 ms is 0.625 fps -> 0.63 (R and Python round() give 0.62).
    expect(samplingFpsObserved(2, 1600)).toBe(0.63);
  });

  it('states no rate under a second observed, or with fewer than two samples', () => {
    expect(samplingFpsObserved(30, 999)).toBeNull();
    expect(samplingFpsObserved(1, 60_000)).toBeNull();
    expect(samplingFpsObserved(0, 60_000)).toBeNull();
    expect(samplingFpsObserved(null, 60_000)).toBeNull();
    expect(samplingFpsObserved(100, null)).toBeNull();
  });

  it('does not charge face loss to the rate, as effective_fps does', () => {
    // 25 fps while the face is seen; the face is lost for 10 s in the middle of a 100-s window.
    const agg = new EyeMetricsAggregator();
    const t0 = 1_000;
    const base = { pose: { pitch: 0, yaw: 0, roll: 0 }, zone: 'cc' as const, isCenter: true, offAxis: false, faceSize: 0.3, luma: null };
    for (let t = 0; t <= 100_000; t += 40) {
      const lost = t > 45_000 && t < 55_000;
      agg.ingest({ ...base, t_ms: t0 + t, ear: lost ? Number.NaN : 0.3, facePresent: !lost });
    }
    const { record } = agg.finalizeWithEvents({
      conditionId: 'c', sessionId: 's', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.225,
      gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
    });
    expect(record.fps_gate_version).toBe(FPS_GATE_VERSION);
    expect(record.effective_fps!).toBeLessThan(23);
    // 25 within the one-sample-per-dropout approximation the module states.
    expect(samplingFpsObserved(record.ear_sample_count, record.observed_duration_ms)!).toBeCloseTo(25, 1);
  });
});

describe('consistency with the participant\'s own median', () => {
  it('flags a condition more than 2 fps from the median, and nothing without a rate', () => {
    expect(medianFps([24, 25, null, 23, 26])).toBe(24.5);
    expect(medianFps([null, undefined])).toBeNull();
    expect(fpsConsistent(26.5, 24.5)).toBe(true);
    expect(fpsConsistent(26.51, 24.5)).toBe(false);
    expect(fpsConsistent(22.5, 24.5)).toBe(true);
    expect(fpsConsistent(null, 24.5)).toBeNull();
  });

  it('takes the median over every camera-on row with a rate, and leaves camera-off rows out', () => {
    const rows = gateParticipant([
      { cameraActive: true, sampleCount: 4321, observedMs: 180_000 }, // 24
      { cameraActive: true, sampleCount: 4501, observedMs: 180_000 }, // 25
      { cameraActive: false, sampleCount: 4321, observedMs: 180_000 }, // camera off: no rate
      { cameraActive: true, sampleCount: 3061, observedMs: 180_000 }, // 17: tier B, and 7 below
      { cameraActive: true, sampleCount: 4141, observedMs: 180_000 }, // 23
    ]);
    expect(rows.map((r) => r.fps)).toEqual([24, 25, null, 17, 23]);
    expect(rows.map((r) => r.tier)).toEqual(['A', 'A', null, 'B', 'A']);
    expect(rows[0].participantMedian).toBe(23.5);
    expect(rows.map((r) => r.consistent)).toEqual([true, true, null, false, true]);
  });

  it('names the gate a row was recorded under: fps-g2 from Round 79, g1 before, none with the camera off', () => {
    expect(rowGateVersion({ camera_active: true, fps_gate_version: 'fps-g2' })).toBe('fps-g2');
    expect(rowGateVersion({ camera_active: true })).toBe('g1-25/30');
    expect(rowGateVersion({ camera_active: false, fps_gate_version: 'fps-g2' })).toBeNull();
  });
});

describe('one gate, one answer: the export and the analysis file agree with the module', () => {
  it('07 and analysis_long carry the same rate and tier, and an old row is re-tiered under the g1 label', () => {
    const b = buildFixtureBundle();
    // One row as a sitting before Round 79 left it (no version), and one slowed to 12 fps (tier C).
    delete (b.eyeMetrics[0] as { fps_gate_version?: string }).fps_gate_version;
    b.eyeMetrics[1] = { ...b.eyeMetrics[1], ear_sample_count: Math.round((b.eyeMetrics[1].observed_duration_ms! / 1000) * 12) + 1 };
    const files = buildExportFiles(b);
    const e07 = parseCsv(files.find((f) => f.filename === '07_eye_metrics.csv')!.content);
    expect(e07).toHaveLength(b.eyeMetrics.length);
    for (const [i, r] of e07.entries()) {
      const e = b.eyeMetrics.find((x) => x.condition_id === r.condition_id)!;
      const fps = e.camera_active ? samplingFpsObserved(e.ear_sample_count, e.observed_duration_ms) : null;
      expect(r.sampling_fps_observed, `row ${i}`).toBe(fps == null ? '' : String(fps));
      expect(r.fps_tier, `row ${i}`).toBe(fpsTier(fps) ?? '');
    }
    const row = (cid: string) => e07.find((r) => r.condition_id === cid)!;
    expect(row(b.eyeMetrics[0].condition_id).fps_gate_version).toBe(FPS_GATE_V1);
    expect(row(b.eyeMetrics[1].condition_id).fps_tier).toBe('C');

    const long = parseCsv(buildAnalysisDataset([b]).files.find((f) => f.filename === 'analysis_long.csv')!.content);
    const rated = long.filter((r) => r.sampling_fps_observed !== '');
    expect(rated.length).toBeGreaterThan(5);
    const med = medianFps(rated.map((r) => Number(r.sampling_fps_observed)));
    for (const r of long) {
      const e = row(r.row_id.split('|').pop()!);
      expect(r.sampling_fps_observed).toBe(e.sampling_fps_observed);
      expect(r.fps_tier).toBe(e.fps_tier);
      expect(r.fps_gate_version).toBe(e.fps_gate_version);
      const want = r.sampling_fps_observed === '' ? null : fpsConsistent(Number(r.sampling_fps_observed), med);
      expect(r.fps_consistent).toBe(want == null ? '' : String(want));
    }
    // The tier-C row is the one far from the participant's median.
    expect(long.find((r) => r.fps_tier === 'C')!.fps_consistent).toBe('false');
  });
});
