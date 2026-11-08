/**
 * A blink the reading window's edge or a sampling gap cuts is counted, not classified (rule blink-r2,
 * Round 91; audit 86 CAM-8).
 *
 * Under blink-r1 a blink already under way at the window's first sample was classified on the part
 * left in view — onset at the first sample, depth what remained — and one still under way at the last
 * sample on the part before it. A COMPLETE blink cut while the lid was 60-75% of the way open read as
 * INCOMPLETE in the primary outcome: twenty complete blinks and one such edge gave a ratio of 1/21. The
 * live graph had refused to mark exactly that blink since Round 82; the record kept counting it.
 *
 * The series is the finder's (and the verifier's): 24 fps, an open baseline of 0.30, twenty complete
 * blinks reaching 0.20 x baseline, over about three minutes.
 */
import { describe, it, expect } from 'vitest';
import { countBlinks } from '@/tracking/blinkCount';
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import {
  BLINK_RULE_BEFORE, BLINK_RULE_VERSION, blinkRatePerMinute, classifyBlinks, isCutBlink, observedDurationMs, samplingGapThreshold,
  summariseBlinks, type EarSample,
} from '@/tracking/blink';
import { makeRng } from '@/sim/rng';
import { exportedBlinkCounts, recordBlinkCounts, blinkStarts } from '@/tracking/blinkLog';
import type { EyeMetricsRecord } from '@/storage/types';
import { readFileSync } from 'node:fs';
import { buildExportFiles } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { auditBundle } from '@/storage/integrity';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { splitCsvRow } from './helpers/csv';

const B = 0.3;
const DT = 1000 / 24;
/** One complete blink: open, down to 0.06 (0.2 x baseline), open again, over ten frames. */
const BLINK = [0.27, 0.18, 0.09, 0.06, 0.07, 0.12, 0.19, 0.21, 0.25, 0.28];

function series(prefix: number[] = [], suffix: number[] = [], t0 = 1_000_000): EarSample[] {
  const ears: number[] = [...prefix];
  for (let k = 0; k < 20; k++) { for (let i = 0; i < 80; i++) ears.push(B); ears.push(...BLINK); }
  for (let i = 0; i < 40; i++) ears.push(B);
  ears.push(...suffix);
  return ears.map((ear, i) => ({ t_ms: t0 + i * DT, ear }));
}

/** The shipped aggregator over `s`, finalised as the camera would be at the end of a reading window. */
function finalised(s: EarSample[]) {
  const agg = new EyeMetricsAggregator();
  for (const x of s) {
    agg.ingest({ t_ms: x.t_ms, ear: x.ear, earLeft: x.ear, earRight: x.ear, pose: { pitch: 0, yaw: 0, roll: 0 }, offAxis: false, onScreen: null, facePresent: true, faceSize: 0.3, luma: null });
  }
  return { agg, ...agg.finalizeWithEvents({
    conditionId: 'C1', sessionId: 'S1', cameraActive: true, baselineEarValue: B, earThresholdUsed: B * 0.75, earCompleteThreshold: B * 0.6,
    gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null, lockedExposure100us: null,
  }) };
}

describe('blink-r2: a blink whose start or end was not observed is counted and not classified', () => {
  it('a clean window: twenty complete blinks, none cut', () => {
    const c = countBlinks(series(), B, 'final');
    expect(c).toMatchObject({ blinks: 20, incomplete: 0, complete: 20, cut: 0 });
  });

  it('the window opens as the eye reopens from a complete blink: that blink is cut, not incomplete', () => {
    const s = series([0.19, 0.21]);
    const c = countBlinks(s, B, 'final');
    expect(c).toMatchObject({ blinks: 21, incomplete: 0, complete: 20, cut: 1 });
    expect(c.events[0]).toMatchObject({ onset_ms: s[0].t_ms, started_by: 'window_start', ended_by: 'reopened', tier: 'incomplete' });
    const { record } = finalised(s);
    expect(record).toMatchObject({
      blink_rule_version: BLINK_RULE_VERSION, blink_count_full: 20, blink_count_micro: 0, blink_count_incomplete: 0,
      blink_count_cut: 1, incomplete_blink_ratio: 0,
    });
  });

  it('the window closes while the eye is closing: that blink is cut, not incomplete', () => {
    const s = series([], [0.27, 0.21, 0.2]);
    const c = countBlinks(s, B, 'final');
    expect(c).toMatchObject({ blinks: 21, incomplete: 0, cut: 1 });
    expect(c.events[20]).toMatchObject({ ended_by: 'window_end', tier: 'incomplete' });
    expect(finalised(s).record).toMatchObject({ blink_count_incomplete: 0, blink_count_cut: 1, incomplete_blink_ratio: 0 });
  });

  it('the face comes back mid-blink after a sampling gap: that blink is cut too', () => {
    // A second without the face (a look-away), coming back on the reopening tail of a blink.
    const head = series().slice(0, 300);
    const back = head[head.length - 1].t_ms + 1000;
    const tail = [0.19, 0.21, ...Array(60).fill(B)].map((ear, i) => ({ t_ms: back + i * DT, ear }));
    const c = countBlinks([...head, ...tail], B, 'final');
    const resumed = c.events.find((e) => e.onset_ms === back)!;
    expect(resumed).toMatchObject({ started_by: 'gap', tier: 'incomplete' });
    expect(isCutBlink(resumed)).toBe(true);
    expect(c.incomplete).toBe(0);
    expect(c.cut).toBe(1);
  });

  it('cut blinks stay in blink_rate: only what is classified changed', () => {
    const s = series([0.19, 0.21], [0.27, 0.21, 0.2]);
    const { record, events } = finalised(s);
    const r1 = summariseBlinks(events, observedDurationMs(s), BLINK_RULE_BEFORE);
    // blink-r1 put both edge blinks in the numerator: 2 of 22. blink-r2: 0 of 20, and 2 cut.
    expect(r1).toMatchObject({ blink_count_incomplete: 2, blink_count_cut: null });
    expect(r1.incomplete_blink_ratio).toBeCloseTo(2 / 22, 12);
    expect(record).toMatchObject({ blink_count_incomplete: 0, blink_count_full: 20, blink_count_cut: 2, incomplete_blink_ratio: 0 });
    expect(record.blink_rate).toBeCloseTo(r1.blink_rate!, 12);
    // The fitted sensitivity is over the same twenty.
    expect(record.blink_count_incomplete_fit).toBe(0);
    expect(record.incomplete_blink_ratio_fit).toBe(0);
  });

  it('classifies exactly as blink-r1 did every blink observed whole', () => {
    const s = series([0.19, 0.21], [0.27, 0.21, 0.2]);
    const events = classifyBlinks(s, B);
    const whole = events.filter((e) => !isCutBlink(e));
    expect(whole).toHaveLength(20);
    expect(whole.every((e) => e.started_by === 'onset' && e.ended_by === 'reopened' && e.tier === 'full')).toBe(true);
  });
});

describe('the stored blinks reproduce both rules, and a blink-r1 row is exported under blink-r2', () => {
  const s = series([0.19, 0.21], [0.27, 0.21, 0.2]);
  const { agg, record, events, fits, fitExposure } = finalised(s);
  const kept = agg.blinkLog({ conditionId: 'C1', sessionId: 'S1', baseline: B, events, fits, fitExposure });

  it('stores how each blink began, and recounts the row under its own rule from 07b', () => {
    expect(kept.events.map((e) => e.started_by).filter((x) => x !== 'onset')).toEqual(['window_start']);
    const r2 = recordBlinkCounts(kept, record.observed_duration_ms, BLINK_RULE_VERSION);
    expect(r2).toMatchObject({ blink_count_full: 20, blink_count_incomplete: 0, blink_count_cut: 2, incomplete_blink_ratio: 0 });
    const r1 = recordBlinkCounts(kept, record.observed_duration_ms, BLINK_RULE_BEFORE);
    expect(r1).toMatchObject({ blink_count_incomplete: 2, blink_count_cut: null });
  });

  it('derives how a blink stored before Round 91 began from the trace, exactly as the classifier did', () => {
    const old = { ...kept, events: kept.events.map(({ started_by: _drop, ...e }) => e) };
    expect(blinkStarts(old)).toEqual(kept.events.map((e) => e.started_by));
  });

  it('exports a row recorded under blink-r1 recomputed under blink-r2; one with no kept window stays blink-r1', () => {
    const { blink_count_cut: _c, blink_rule_version: _v, ...rest } = record;
    const r1Row: EyeMetricsRecord = { ...rest, ...{ blink_count_incomplete: 2, incomplete_blink_ratio: 2 / 22 } };
    const ex = exportedBlinkCounts(r1Row, [kept]);
    expect(ex).toMatchObject({ blink_rule_version: BLINK_RULE_VERSION, blink_recomputed: true, blink_count_incomplete: 0, blink_count_cut: 2, incomplete_blink_ratio: 0 });
    expect(exportedBlinkCounts(r1Row, [])).toMatchObject({ blink_rule_version: BLINK_RULE_BEFORE, blink_recomputed: false, blink_count_incomplete: 2 });
    expect(exportedBlinkCounts(record, [kept])).toMatchObject({ blink_rule_version: BLINK_RULE_VERSION, blink_recomputed: false, blink_count_cut: 2 });
  });
});

/*
 * THE RULE CHANGE IS ONLY WHAT IS CLASSIFIED. blink-r1's classifier and summary exactly as they shipped
 * before Round 91 (src/tracking/blink.ts at 26e909c, comments dropped), held against the current code on
 * many random windows: dips of every depth, frame jitter, face losses (gaps) mid-blink and between
 * blinks, and windows that open or close mid-blink. The same blinks must be registered with the same
 * times, depths and tiers (no cut, micro rule or gap rule changed); blink-r1's numbers must come back
 * from the current summary asked for 'blink-r1'; and under blink-r2 every blink observed whole must be
 * classified exactly as blink-r1 classified it, the cut ones being precisely those whose start or end
 * the series does not contain.
 */
type R1Event = Omit<ReturnType<typeof classifyBlinks>[number], 'started_by'>;
function classifyR1(samples: EarSample[], baseline: number): R1Event[] {
  samples = samples.filter((s) => Number.isFinite(s.ear) && Number.isFinite(s.t_ms));
  if (samples.length === 0) return [];
  const partialT = baseline * 0.75;
  const gapMs = samplingGapThreshold(samples);
  const events: R1Event[] = [];
  let inBlink = false, onset = 0, minEar = Infinity, minAt = 0, below = 0;
  const open = (s: EarSample) => { inBlink = true; onset = s.t_ms; minEar = s.ear; minAt = s.t_ms; below = 1; };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!inBlink && s.ear < partialT) {
      open(s);
    } else if (inBlink) {
      const prev = samples[i - 1];
      if (prev && s.t_ms - prev.t_ms > gapMs) {
        inBlink = false;
        minEar = Infinity;
        if (s.ear < partialT) open(s);
        continue;
      }
      if (s.ear < minEar) { minEar = s.ear; minAt = s.t_ms; }
      if (s.ear < partialT) below++;
      if (s.ear >= partialT || i === samples.length - 1) {
        const duration = s.t_ms - onset;
        const ratio = minEar / baseline;
        const tier = ratio < 0.6 ? (duration < 40 ? 'micro' : 'full') : 'incomplete';
        events.push({
          onset_ms: onset, duration_ms: duration, min_ear: minEar, tier,
          offset_ms: s.t_ms, min_at_ms: minAt, frames_below: below,
          ended_by: s.ear >= partialT ? 'reopened' : 'window_end',
        });
        inBlink = false;
        minEar = Infinity;
      }
    }
  }
  return events;
}
function summariseR1(events: R1Event[], durationMs: number) {
  const by = (t: string) => events.filter((e) => e.tier === t).length;
  const rate = (n: number) => blinkRatePerMinute(n, durationMs);
  const durations = events.map((e) => e.duration_ms);
  return {
    blink_rate: rate(events.length), blink_rate_full: rate(by('full')), blink_rate_micro: rate(by('micro')),
    blink_count_full: by('full'), blink_count_micro: by('micro'), blink_count_incomplete: by('incomplete'),
    incomplete_blink_ratio: events.length > 0 ? by('incomplete') / events.length : null,
    blink_duration_mean_ms: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
  };
}

/**
 * A random reading window as the aggregator receives it: one frame per camera tick, a face in most,
 * none during a look-away. Blinks of random depth (0.05 to 0.85 of the open eye) and length; the
 * window may open or close inside one; a look-away may begin or end inside one.
 */
function randomWindow(seed: number): Array<{ t_ms: number; ear: number; face: boolean }> {
  const rng = makeRng(seed);
  const fps = 15 + rng() * 20;
  const dt = 1000 / fps;
  const out: Array<{ t_ms: number; ear: number; face: boolean }> = [];
  let t = 500_000 + rng() * 1000;
  const frame = (ear: number) => out.push({ t_ms: (t += dt * (0.8 + 0.4 * rng())), ear, face: true });
  for (let k = 0; k < 14; k++) {
    const open = 20 + Math.floor(rng() * 60);
    for (let i = 0; i < open; i++) frame(B * (0.97 + 0.06 * rng()));
    const depth = 0.05 + rng() * 0.8;
    const len = 2 + Math.floor(rng() * 9);
    for (let i = 0; i < len; i++) frame(B * (1 - (1 - depth) * Math.sin((Math.PI * (i + 0.5)) / len)));
  }
  // Look-aways: runs of frames with no face, starting and ending anywhere (inside a blink or not).
  for (let k = Math.floor(rng() * 4); k > 0; k--) {
    const at = Math.floor(rng() * out.length);
    const n = 3 + Math.floor(rng() * 30);
    for (let i = at; i < Math.min(out.length, at + n); i++) out[i].face = false;
  }
  // The window opens or closes anywhere in the first or last hundred frames — inside a blink, sometimes.
  const from = rng() < 0.6 ? Math.floor(rng() * 100) : 0;
  const to = rng() < 0.6 ? out.length - Math.floor(rng() * 100) : out.length;
  return out.slice(from, to);
}

describe('blink-r2 changes which blinks are classified, nothing else (held against blink-r1 as it shipped)', () => {
  it('registers the same blinks as blink-r1, and classifies every blink observed whole as blink-r1 did', () => {
    let cutSeen = 0, wholeSeen = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = randomWindow(seed).filter((f) => f.face).map(({ t_ms, ear }) => ({ t_ms, ear }));
      const r2 = classifyBlinks(s, B);
      const r1 = classifyR1(s, B);
      // Same blinks, same times, depths, tiers and ends: no cut, micro rule or gap rule changed.
      expect(r2.map(({ started_by: _s, ...e }) => e), `seed ${seed}`).toEqual(r1);
      // A blink is cut exactly when the series does not hold its start or its end.
      const gap = samplingGapThreshold(s);
      r2.forEach((e) => {
        const j = s.findIndex((x) => x.t_ms === e.onset_ms);
        const startSeen = j > 0 && s[j].t_ms - s[j - 1].t_ms <= gap;
        expect(isCutBlink(e), `seed ${seed} blink at ${e.onset_ms}`).toBe(!startSeen || e.ended_by === 'window_end');
      });
      const d = observedDurationMs(s);
      // blink-r1's numbers come back from the current summary, asked for blink-r1.
      expect(summariseBlinks(r2, d, BLINK_RULE_BEFORE), `seed ${seed}`).toEqual({ ...summariseR1(r1, d), blink_count_cut: null });
      // blink-r2: blink-r1's classification of the blinks observed whole, the rest counted as cut.
      const whole = r1.filter((_, k) => !isCutBlink(r2[k]));
      const now = summariseBlinks(r2, d);
      expect(now, `seed ${seed}`).toEqual({ ...summariseR1(whole, d), blink_rate: summariseR1(r1, d).blink_rate, blink_count_cut: r1.length - whole.length });
      cutSeen += r1.length - whole.length;
      wholeSeen += whole.length;
    }
    // The windows exercised both kinds, many times over.
    expect(cutSeen).toBeGreaterThan(50);
    expect(wholeSeen).toBeGreaterThan(2000);
  });

  it('derives how a stored blink began from 07c exactly as classifyBlinks decided it, gaps and edges included', () => {
    const kinds: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const w = randomWindow(seed);
      const agg = new EyeMetricsAggregator();
      for (const f of w) {
        agg.ingest({ t_ms: f.t_ms, ear: f.face ? f.ear : NaN, earLeft: f.face ? f.ear : undefined, earRight: f.face ? f.ear : undefined, pose: { pitch: 0, yaw: 0, roll: 0 }, offAxis: false, onScreen: null, facePresent: f.face, faceSize: 0.3, luma: null });
      }
      const fin = agg.finalizeWithEvents({
        conditionId: 'C1', sessionId: 'S1', cameraActive: true, baselineEarValue: B, earThresholdUsed: B * 0.75, earCompleteThreshold: B * 0.6,
        gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null, lockedExposure100us: null,
      });
      const kept = agg.blinkLog({ conditionId: 'C1', sessionId: 'S1', baseline: B, events: fin.events, fits: fin.fits, fitExposure: fin.fitExposure });
      const stored = kept.events.map((e) => e.started_by);
      expect(stored, `seed ${seed}`).toEqual(fin.events.map((e) => e.started_by));
      const old = { ...kept, events: kept.events.map(({ started_by: _drop, ...e }) => e) };
      expect(blinkStarts(old), `seed ${seed}`).toEqual(stored);
      // And blink-r1's row, and blink-r2's, come back from the stored blinks.
      const r1 = recordBlinkCounts(old, fin.record.observed_duration_ms, BLINK_RULE_BEFORE);
      expect(r1.blink_count_incomplete, `seed ${seed}`).toBe(summariseBlinks(fin.events, fin.record.observed_duration_ms ?? 0, BLINK_RULE_BEFORE).blink_count_incomplete);
      const r2 = recordBlinkCounts(old, fin.record.observed_duration_ms);
      expect([r2.blink_count_full, r2.blink_count_micro, r2.blink_count_incomplete, r2.blink_count_cut], `seed ${seed}`)
        .toEqual([fin.record.blink_count_full, fin.record.blink_count_micro, fin.record.blink_count_incomplete, fin.record.blink_count_cut]);
      expect(r2.incomplete_blink_ratio, `seed ${seed}`).toBe(fin.record.incomplete_blink_ratio);
      for (const x of stored) kinds[x ?? 'none'] = (kinds[x ?? 'none'] ?? 0) + 1;
    }
    // Both kinds of unobserved start were exercised (20 after a gap, 8 at the window's start, on these seeds).
    expect(kinds.gap).toBeGreaterThanOrEqual(10);
    expect(kinds.window_start).toBeGreaterThanOrEqual(4);
  });
});

describe('every export reads a row under the current blink rule, and the audit under its own', () => {
  const csv = (files: Array<{ filename: string; content: string }>, name: string) => {
    const [head, ...lines] = files.find((f) => f.filename === name)!.content.replace(/^\uFEFF/, '').trim().split('\n');
    const cols = splitCsvRow(head);
    return lines.map((l) => Object.fromEntries(splitCsvRow(l).map((v, i) => [cols[i], v])));
  };

  it('07, 07b, analysis_long and the dashboard agree; a blink-r1 row with its window is recomputed, one without stays blink-r1', () => {
    const b = buildFixtureBundle();
    const camOn = b.eyeMetrics.filter((e) => e.camera_active);
    expect(camOn.length).toBeGreaterThan(2);
    // Row 0: recorded before Round 91 (blink-r1), its window kept — the two edge blinks counted incomplete.
    // Row 1: recorded before Round 91, its window not kept.
    const s = series([0.19, 0.21], [0.27, 0.21, 0.2]);
    const { agg, record, events, fits, fitExposure } = finalised(s);
    const log = agg.blinkLog({ conditionId: 'C1', sessionId: 'S1', baseline: B, events, fits, fitExposure });
    const id0 = camOn[0].condition_id;
    const kept = { ...log, condition_id: id0, record_id: id0, session_id: b.session.session_id,
      events: log.events.map(({ started_by: _s, ...e }) => e) };
    b.ocularEvents = [...(b.ocularEvents ?? []).filter((o) => o.condition_id !== id0 && o.condition_id !== camOn[1].condition_id), kept];
    const r1 = summariseBlinks(events, record.observed_duration_ms ?? 0, BLINK_RULE_BEFORE);
    Object.assign(camOn[0], {
      observed_duration_ms: record.observed_duration_ms, blink_rate: record.blink_rate,
      blink_count_full: r1.blink_count_full, blink_count_micro: r1.blink_count_micro, blink_count_incomplete: r1.blink_count_incomplete,
      incomplete_blink_ratio: r1.incomplete_blink_ratio, blink_rate_full: r1.blink_rate_full, blink_rate_micro: r1.blink_rate_micro,
      blink_duration_mean_ms: r1.blink_duration_mean_ms, blink_count_incomplete_fit: null, incomplete_blink_ratio_fit: null, blinks_not_fitted: null,
    });
    delete camOn[0].blink_rule_version; delete camOn[0].blink_count_cut;
    delete camOn[1].blink_rule_version; delete camOn[1].blink_count_cut;
    expect(camOn[0].blink_count_incomplete).toBe(2);

    const files = buildExportFiles(b);
    const rows = csv(files, '07_eye_metrics.csv');
    const row = (cid: string) => rows.find((r) => r.condition_id === cid)!;
    expect(row(id0)).toMatchObject({ blink_rule_version: BLINK_RULE_VERSION, blink_recomputed: 'true', blink_count_full: '20', blink_count_incomplete: '0', blink_count_cut: '2', incomplete_blink_ratio: '0' });
    expect(row(camOn[1].condition_id)).toMatchObject({ blink_rule_version: BLINK_RULE_BEFORE, blink_recomputed: 'false', blink_count_cut: '', blink_count_incomplete: String(camOn[1].blink_count_incomplete) });
    expect(row(camOn[2].condition_id)).toMatchObject({ blink_rule_version: BLINK_RULE_VERSION, blink_recomputed: 'false', blink_count_cut: '0' });
    // 07b says which blinks are cut, deriving how each began from 07c for blinks stored without it.
    const ev = csv(files, '07b_blink_events.csv').filter((r) => r.condition_id === id0);
    expect(ev.filter((r) => r.cut === 'true').map((r) => [r.started_by, r.ended_by])).toEqual([['window_start', 'reopened'], ['onset', 'window_end']]);
    // The dashboard and the analysis file read the same counts.
    const sum0 = buildConditionSummaries(b).find((x) => x.condition_id === id0)!;
    expect(sum0.incomplete_blink_ratio).toBe(0);
    const long = csv(buildAnalysisDataset([b]).files, 'analysis_long.csv');
    const longRow = (cid: string) => long.find((r) => r.row_id.endsWith(`|${cid}`))!;
    expect(longRow(id0)).toMatchObject({ n_incomplete: '0', n_blinks_total: '20', n_blinks_cut: '2', blink_rule_version: BLINK_RULE_VERSION });
    // The mean duration too: over the blinks observed whole, as 07 has it (a cut blink's is only the part seen).
    expect(Number(longRow(id0).blink_duration_mean_ms)).toBeCloseTo(Number(row(id0).blink_duration_mean_ms), 1);
    expect(Number(row(id0).blink_duration_mean_ms)).not.toBeCloseTo(r1.blink_duration_mean_ms!, 1);
    expect(longRow(camOn[1].condition_id).blink_rule_version).toBe(BLINK_RULE_BEFORE);
    // The integrity audit counts 07b against 07 under the row's own rule: the stored blink-r1 row matches.
    expect(auditBundle(b).findings.filter((f) => f.check === 'blink_events_match_summary' && f.refs.includes(id0))).toEqual([]);
  });

  it('both templates name the app\'s rule and model only rows under it', () => {
    const R = readFileSync('src/analysis/analysis_template.R', 'utf8');
    const py = readFileSync('src/analysis/analysis_template.py', 'utf8');
    expect(/^BLINK_RULE_VERSION <- "([^"]+)"/m.exec(R)?.[1]).toBe(BLINK_RULE_VERSION);
    expect(/^BLINK_RULE_VERSION = "([^"]+)"/m.exec(py)?.[1]).toBe(BLINK_RULE_VERSION);
    expect(R).toMatch(/eye <- eye\[blink_rule == BLINK_RULE_VERSION, , drop = FALSE\]/);
  });
});
