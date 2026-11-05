/**
 * The inter-blink interval counts only the time the face was seen (Round 88, audit 86 D2; rule ibi-r2).
 *
 * Up to Round 87 the interval was the mean gap between every pair of successive blink onsets, so the
 * interval spanning a face dropout carried the unobserved seconds — and the blinks nobody saw in them.
 * The finder's reproduction, through the real aggregator: three minutes at 30 fps, a full blink every
 * 4 s, one 10 s look-away (face present 94% of the exposure, which passes every gate) gave a mean
 * interval of 4,190-4,293 ms instead of 4,000 and a CV of 0.29-0.43 instead of 0 — the two signatures
 * the codebook reads as suppressed and erratic blinking.
 */
import { describe, it, expect } from 'vitest';
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import {
  IBI_RULE_VERSION, IBI_RULE_BEFORE, interBlinkInterval, observedDurationMs, samplingGapThreshold, samplingGaps,
  type BlinkEvent, type EarSample,
} from '@/tracking/blink';
import { buildExportFiles } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { splitCsvRow } from './helpers/csv';
import { exportedInterBlinkInterval, recordInterBlinkInterval } from '@/tracking/blinkLog';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import type { EyeMetricsRecord } from '@/storage/types';

const OPEN = 0.312;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
const T0 = 500_000;

/** A reading window through the real aggregator: a full blink every `everyS` seconds, faces lost in `drops`. */
function reading(drops: Array<[number, number]>, opts: { totalS?: number; everyS?: number; firstS?: number; baseline?: number | null } = {}) {
  const totalS = opts.totalS ?? 180;
  const everyS = opts.everyS ?? 4;
  const agg = new EyeMetricsAggregator();
  const n = totalS * FPS;
  const ear = new Array<number>(n).fill(OPEN);
  for (let s = opts.firstS ?? 2; s < totalS; s += everyS) [0.2, 0.12, 0.1, 0.18].forEach((v, k) => { ear[Math.round(s * FPS) + k] = v; });
  const pose = { pitch: 0, yaw: 0, roll: 0 };
  for (let k = 0; k < n; k++) {
    const t = T0 + k * FRAME_MS;
    const lost = drops.some(([from, len]) => t >= T0 + from * 1000 && t < T0 + (from + len) * 1000);
    if (lost) agg.ingest({ t_ms: t, ear: 0, pose, offAxis: false, facePresent: false, faceSize: 0, luma: null });
    else agg.ingest({ t_ms: t, ear: ear[k], earLeft: ear[k], earRight: ear[k], pose, offAxis: false, facePresent: true, faceSize: 0.22, luma: null });
  }
  const baseline = opts.baseline === undefined ? OPEN : opts.baseline;
  const out = agg.finalizeWithEvents({
    conditionId: 'C1', sessionId: 'S1', cameraActive: true, baselineEarValue: baseline,
    earThresholdUsed: 0.234, gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
  });
  // The reading window as the app keeps it (07b, 07c): the same events, the same frames.
  const kept = agg.blinkLog({ conditionId: 'C1', sessionId: 'S1', baseline, events: out.events });
  return Object.assign(out.record, { kept });
}

describe('the inter-blink interval leaves out the time the face was not seen (ibi-r2)', () => {
  const clean = reading([]);

  it('a run with no dropout is unchanged: 4,000 ms, CV 0, every interval used', () => {
    expect(clean.mean_inter_blink_interval_ms).toBeCloseTo(4000, 0);
    expect(clean.inter_blink_interval_cv).toBeLessThan(0.01);
    expect(clean.ibi_interval_count).toBe(44); // 45 blinks at 2, 6, ..., 178 s
    expect(clean.ibi_rule_version).toBe(IBI_RULE_VERSION);
  });

  it.each([
    ['one 10 s look-away', [[80, 10]]],
    ['one 20 s look-away', [[80, 20]]],
    ['one 40 s look-away', [[60, 40]]],
    ['three 5 s look-aways', [[30, 5], [90, 5], [140, 5]]],
    ['one 3 s look-away', [[100, 3]]],
  ] as Array<[string, Array<[number, number]>]>)('%s: the mean stays within a frame of 4,000 ms and the CV near 0', (_label, drops) => {
    const r = reading(drops);
    // The look-aways pass the presence gate the analysis applies, so nothing else would have caught it.
    expect(r.face_presence_ratio!).toBeGreaterThan(0.75);
    expect(Math.abs(r.mean_inter_blink_interval_ms! - 4000)).toBeLessThan(FRAME_MS);
    expect(r.inter_blink_interval_cv!).toBeLessThan(0.05);
    // Fewer intervals than the clean run: those a dropout fell in are not counted.
    expect(r.ibi_interval_count!).toBeLessThan(clean.ibi_interval_count!);
    // The blink RATE already used observed time; it and the interval now agree on the same rule.
    expect(Math.abs(60000 / r.mean_inter_blink_interval_ms! - r.blink_rate!)).toBeLessThan(0.5);
  });

  it('an interval is dropped exactly when observed time drops a gap between its onsets', () => {
    // Blinks at 1 s, 2 s, 3 s, 4 s on a 30 fps series with the face lost from 2.4 s to 2.8 s.
    const samples: EarSample[] = [];
    for (let t = 0; t <= 5000; t += FRAME_MS) if (t < 2400 || t >= 2800) samples.push({ t_ms: t, ear: OPEN });
    const gapMs = samplingGapThreshold(samples);
    const gaps = samplingGaps(samples, gapMs);
    expect(gaps).toHaveLength(1);
    // The same pairs observed time leaves out: the span minus the gap is the observed duration.
    const span = samples[samples.length - 1].t_ms - samples[0].t_ms;
    expect(observedDurationMs(samples, gapMs)).toBeCloseTo(span - (gaps[0][1] - gaps[0][0]), 6);
    const ev = (onset_ms: number): BlinkEvent => ({ onset_ms, duration_ms: 150, min_ear: 0.1, tier: 'full' });
    const onsetNear = (ms: number) => samples.reduce((a, s) => (Math.abs(s.t_ms - ms) < Math.abs(a - ms) ? s.t_ms : a), 0);
    const events = [1000, 2000, 3000, 4000].map((ms) => ev(onsetNear(ms)));
    const r = interBlinkInterval(events, samples, gapMs);
    expect(r.ibi_interval_count).toBe(2);
    expect(r.mean_inter_blink_interval_ms).toBeCloseTo(1000, -1);
  });

  it('every interval spanning a gap gives no interval at all, not a number', () => {
    // A blink every 20 s with a 10 s look-away inside every interval.
    const r = reading([[12, 10], [32, 10], [52, 10]], { totalS: 70, everyS: 20, firstS: 2 });
    expect(r.ibi_interval_count).toBe(0);
    expect(r.mean_inter_blink_interval_ms).toBeNull();
    expect(r.inter_blink_interval_cv).toBeNull();
  });

  it('one observed interval gives a mean and no CV: the spread of one interval is unmeasured, not zero', () => {
    const r = reading([], { totalS: 12, everyS: 5, firstS: 2 }); // blinks at 2 s and 7 s only
    expect(r.ibi_interval_count).toBe(1);
    expect(r.mean_inter_blink_interval_ms).toBeCloseTo(5000, -1);
    expect(r.inter_blink_interval_cv).toBeNull();
  });

  it('without a calibrated baseline there are no blinks and the interval count is blank, not 0', () => {
    const r = reading([], { baseline: null });
    expect(r.mean_inter_blink_interval_ms).toBeNull();
    expect(r.ibi_interval_count).toBeNull();
  });
});

describe('a row recorded before Round 88 is exported under the current rule wherever its window was kept', () => {
  const csv = (files: { filename: string; content: string }[], name: string) => {
    const f = files.find((x) => x.filename === name)!;
    const [head, ...rows] = f.content.replace(/^\uFEFF/, '').trim().split('\n');
    const cols = splitCsvRow(head);
    return rows.map((r) => Object.fromEntries(splitCsvRow(r).map((v, i) => [cols[i], v])));
  };
  /** What a build before Round 88 stored for the same window: every interval, no stamp, no count. */
  const asRecordedUnderR1 = (r: ReturnType<typeof reading>): EyeMetricsRecord => {
    const onsets = r.kept.events.map((e) => e.onset_ms);
    const gaps = onsets.slice(1).map((t, i) => t - onsets[i]);
    const m = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const { kept: _kept, ibi_rule_version: _v, ibi_interval_count: _n, ...old } = r;
    return { ...old, mean_inter_blink_interval_ms: m, inter_blink_interval_cv: Math.sqrt(gaps.reduce((a, g) => a + (g - m) ** 2, 0) / gaps.length) / m };
  };

  it('recomputing from the kept blinks and trace gives what the live series gives', () => {
    for (const drops of [[], [[80, 10]], [[30, 5], [90, 5], [140, 5]]] as Array<Array<[number, number]>>) {
      const r = reading(drops);
      const again = recordInterBlinkInterval(r.kept);
      expect(again.ibi_interval_count).toBe(r.ibi_interval_count);
      expect(again.mean_inter_blink_interval_ms!).toBeCloseTo(r.mean_inter_blink_interval_ms!, 1);
      expect(again.inter_blink_interval_cv!).toBeCloseTo(r.inter_blink_interval_cv!, 4);
    }
  });

  it('an unstamped row with its window kept is recomputed (ibi_recomputed TRUE); one without keeps ibi-r1', () => {
    const live = reading([[80, 10]]);
    const old = asRecordedUnderR1(live);
    // The ibi-r1 value the old build recorded carried the look-away; the recomputed one does not.
    expect(old.mean_inter_blink_interval_ms!).toBeGreaterThan(4150);
    const withWindow = exportedInterBlinkInterval(old, [live.kept]);
    expect(withWindow).toMatchObject({ ibi_rule_version: IBI_RULE_VERSION, ibi_recomputed: true, ibi_interval_count: live.ibi_interval_count });
    expect(withWindow.mean_inter_blink_interval_ms!).toBeCloseTo(live.mean_inter_blink_interval_ms!, 1);
    const noWindow = exportedInterBlinkInterval(old, []);
    expect(noWindow).toMatchObject({ ibi_rule_version: IBI_RULE_BEFORE, ibi_recomputed: false, ibi_interval_count: null });
    expect(noWindow.mean_inter_blink_interval_ms).toBe(old.mean_inter_blink_interval_ms);
    // Stamped rows are exported as recorded; camera-off rows carry no rule.
    expect(exportedInterBlinkInterval(live, [])).toMatchObject({ ibi_rule_version: IBI_RULE_VERSION, ibi_recomputed: false });
    expect(exportedInterBlinkInterval({ ...live, camera_active: false }, [live.kept]).ibi_rule_version).toBeNull();
  });

  it('07, analysis_long and the dashboard summary carry the same interval and rule', () => {
    const b = buildFixtureBundle();
    const camOn = b.eyeMetrics.filter((e) => e.camera_active);
    expect(camOn.length).toBeGreaterThan(2);
    const live = reading([[80, 10]]);
    // Row 0: recorded before Round 88, window kept. Row 1: recorded before Round 88, window not kept.
    const kept = { ...live.kept, condition_id: camOn[0].condition_id, record_id: camOn[0].condition_id, session_id: b.session.session_id };
    b.ocularEvents = [...(b.ocularEvents ?? []).filter((o) => o.condition_id !== camOn[0].condition_id && o.condition_id !== camOn[1].condition_id), kept];
    Object.assign(camOn[0], { mean_inter_blink_interval_ms: 4321, inter_blink_interval_cv: 0.43 });
    delete camOn[0].ibi_rule_version; delete camOn[0].ibi_interval_count;
    delete camOn[1].ibi_rule_version; delete camOn[1].ibi_interval_count;
    const rows = csv(buildExportFiles(b), '07_eye_metrics.csv');
    const byCond = (id: string) => rows.find((r) => r.condition_id === id)!;
    expect(byCond(camOn[0].condition_id)).toMatchObject({ ibi_rule_version: IBI_RULE_VERSION, ibi_recomputed: 'true', ibi_interval_count: String(live.ibi_interval_count) });
    expect(Number(byCond(camOn[0].condition_id).mean_inter_blink_interval_ms)).toBeCloseTo(live.mean_inter_blink_interval_ms!, 1);
    expect(byCond(camOn[1].condition_id)).toMatchObject({ ibi_rule_version: IBI_RULE_BEFORE, ibi_recomputed: 'false', ibi_interval_count: '' });
    expect(byCond(camOn[1].condition_id).mean_inter_blink_interval_ms).toBe(String(camOn[1].mean_inter_blink_interval_ms));
    expect(byCond(camOn[2].condition_id)).toMatchObject({ ibi_rule_version: IBI_RULE_VERSION, ibi_recomputed: 'false' });
    const sums = buildConditionSummaries(b);
    const sum0 = sums.find((x) => x.condition_id === camOn[0].condition_id)!;
    expect(sum0.ibi_rule_version).toBe(IBI_RULE_VERSION);
    expect(sum0.mean_inter_blink_interval_ms!).toBeCloseTo(live.mean_inter_blink_interval_ms!, 1);
    const long = csv(buildAnalysisDataset([b]).files, 'analysis_long.csv');
    const longRow = (id: string) => long.find((r) => r.row_id.endsWith(`|${id}`))!;
    expect(longRow(camOn[0].condition_id).ibi_rule_version).toBe(IBI_RULE_VERSION);
    expect(Number(longRow(camOn[0].condition_id).mean_inter_blink_interval_ms)).toBeCloseTo(live.mean_inter_blink_interval_ms!, 0);
    expect(longRow(camOn[1].condition_id).ibi_rule_version).toBe(IBI_RULE_BEFORE);
  });
});

describe('the templates model the current rule', () => {
  it('R names the same rule version as the app, models those rows, and refits with the rest put back', async () => {
    const { readFileSync } = await import('node:fs');
    const R = readFileSync('src/analysis/analysis_template.R', 'utf8');
    expect(/^ {2}IBI_RULE_VERSION <- "([^"]+)"/m.exec(R)?.[1]).toBe(IBI_RULE_VERSION);
    expect(R).toMatch(/eye_ibi <- eye\[has_ibi & ibi_rule == IBI_RULE_VERSION, , drop = FALSE\]/);
    expect(R).toMatch(/m_ibi_all <- tryCatch\(lmer\(f_ibi, data = eye\[has_ibi, , drop = FALSE\]\)/);
  });

  it('Python models no inter-blink interval, so it cannot apply a different rule (ANALYSIS_PLAN.md §5b)', async () => {
    const { readFileSync } = await import('node:fs');
    const py = readFileSync('src/analysis/analysis_template.py', 'utf8');
    // If the cross-check ever models the interval, it must read the rule column as R does.
    if (/mean_inter_blink_interval_ms/.test(py)) expect(py).toMatch(/ibi_rule_version/);
    else expect(py).not.toMatch(/inter_blink/);
  });
});
