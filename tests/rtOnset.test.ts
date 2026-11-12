/**
 * The reaction task's onset is the begin time of the first frame that begins after the frame that painted
 * the dot has been rendered (Round 92, audit 86 P1, rt-t2; Round 93, review REVA-1, rt-t3).
 *
 * It was the clock read inside the second frame callback after the dot was rendered. With the camera on,
 * the face tracker works earlier in the same frame (the browser runs video-frame callbacks before
 * animation-frame callbacks), so the clock was read after its work: every such reaction time short by it.
 * The audit measured the stamp 95-140 ms after the start of its frame in headless Chromium. Round 92 took
 * the frame's own timestamp of the frame after the paint frame instead; but when the paint frame itself
 * ran past the next vsync, that frame's timestamp came before the paint had finished (review REVA-1:
 * 14.2-14.6 ms before it with 30 ms of extra work in the paint frame).
 *
 * The frames here are driven by hand, as Chromium runs them (measured, headless): a frame begins at a
 * vsync; work before its animation-frame callbacks (the video-frame callback) and after them moves the
 * clock; its rendering takes RENDER_MS; a task posted from one of its callbacks runs once it is rendered;
 * a frame cannot start before the previous one has finished, and when it starts late it is handed the
 * timestamp of the latest vsync it missed (25 ms of extra work: the next timestamp 16.7 ms after the paint
 * frame's; 40 ms: 33.3 ms).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  stampOnsetAfterPaint, RT_TIMING_VERSION, RT_TIMING_VERSION_T2, RT_TIMING_VERSION_V1, ONSET_SEARCH_MAX_FRAMES, type FrameHost,
} from '@/lib/rtOnset';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { buildAnalysisDataset, ANALYSIS_LONG_COLUMNS } from '@/storage/analysisExport';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';
import { splitCsvRow } from './helpers/csv';

const FRAME_MS = 1000 / 60;
const BASE = 10_000;
const RENDER_MS = 1;

interface FrameWork {
  /** Main-thread work before the frame's animation-frame callbacks: a video-frame callback (the tracker). */
  before?: number;
  /** Other main-thread work after them in the same frame: a garbage collection, a long render. */
  after?: number;
}

/** A page's frames, run one at a time. `work(k)` is frame k's extra work; `lateTasks` defers posted tasks a frame. */
function frames(work: (k: number) => FrameWork = () => ({}), lateTasks = false) {
  let clock = BASE;
  let lastTs = BASE - FRAME_MS;
  let frame = 0;
  let queue: Array<(ts: number) => void> = [];
  let tasks: Array<() => void> = [];
  let deferred: Array<() => void> = [];
  const begins: number[] = [];
  const paintEnds: number[] = [];
  const host: FrameHost = {
    requestAnimationFrame: (cb) => { queue.push(cb); return queue.length; },
    postTask: (cb) => { tasks.push(cb); },
    now: () => clock,
  };
  const runFrame = () => {
    const ts = Math.max(lastTs + FRAME_MS, BASE + Math.floor((clock - BASE + 1e-9) / FRAME_MS) * FRAME_MS);
    lastTs = ts;
    begins.push(ts);
    clock = Math.max(clock, ts);
    const w = work(frame);
    clock += w.before ?? 0;
    const run = queue;
    queue = [];
    for (const cb of run) {
      cb(ts);
      clock += 0.3;
    }
    clock += (w.after ?? 0) + RENDER_MS;
    paintEnds.push(clock);
    for (const t of deferred) t();
    deferred = [];
    if (lateTasks) deferred = tasks;
    else for (const t of tasks) t();
    tasks = [];
    frame += 1;
  };
  return { host, runFrame, begins, paintEnds, now: () => clock, frameIndex: () => frame };
}

/** Stamp a dot that is in the document from the first frame on; run frames until the stamp is taken. */
async function stampWith(f: ReturnType<typeof frames>) {
  let onset = NaN;
  let overrun: number | null | undefined;
  let stampedAtClock = NaN;
  let done = false;
  const p = stampOnsetAfterPaint(() => true, (ts, o) => { onset = ts; overrun = o; stampedAtClock = f.now(); done = true; }, f.host);
  for (let k = 0; k < 20 && !done; k++) f.runFrame();
  await p;
  return { onset, overrun, stampedAtClock };
}

describe('the onset is the frame after the paint, from the frame\'s own timestamp (audit 86 P1)', () => {
  for (const tracker of [0, 23, 110]) {
    it(`with ${tracker} ms of tracker work in the stamping frame, the onset is that frame's begin time, not the clock`, async () => {
      // Frame 0 paints the dot; the tracker works in frame 1, before its callbacks.
      const f = frames((k) => (k === 1 ? { before: tracker } : {}));
      const r = await stampWith(f);
      expect(r.onset).toBe(f.begins[1]);
      expect(r.overrun).toBe(0);
      // The callback ran after the tracker's work; the stamp does not carry it.
      expect(r.stampedAtClock - r.onset).toBeGreaterThanOrEqual(tracker);
    });
  }

  it('a dot committed late is painted late, and the onset waits for the frame after its paint', async () => {
    const f = frames();
    let drawn = false;
    let onset = NaN;
    const done = stampOnsetAfterPaint(() => drawn, (ts) => { onset = ts; }, f.host);
    f.runFrame(); // not in the document yet: this frame does not paint it
    f.runFrame();
    drawn = true; // committed between frames 1 and 2
    f.runFrame(); // frame 2 paints it
    f.runFrame(); // frame 3: the stamp
    await done;
    expect(onset).toBe(f.begins[3]);
  });

  it('the caller\'s phase flips inside the stamping frame\'s callback, with the stamp', async () => {
    const f = frames();
    const order: string[] = [];
    const done = stampOnsetAfterPaint(() => true, () => order.push(`stamp@${f.frameIndex()}`), f.host).then(() => order.push('resolved'));
    f.runFrame();
    expect(order).toEqual([]);
    f.runFrame();
    expect(order).toEqual(['stamp@1']);
    await done;
    expect(order).toEqual(['stamp@1', 'resolved']);
  });

  it('a dot that is never drawn cannot keep it looking forever', async () => {
    const f = frames();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let onset = NaN;
    const done = stampOnsetAfterPaint(() => false, (ts) => { onset = ts; }, f.host);
    for (let k = 0; k <= ONSET_SEARCH_MAX_FRAMES; k++) f.runFrame();
    await done;
    expect(onset).toBe(f.begins[ONSET_SEARCH_MAX_FRAMES]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('the task stamps through it, with the frame time and the overrun, and flips the phase in the same callback', () => {
    const src = readFileSync(resolve(__dirname, '../src/tasks/ReactionTimeTask.tsx'), 'utf8');
    const mark = src.slice(src.indexOf('const markOnsetAtPaint ='), src.indexOf('const runTrial ='));
    expect(mark).toMatch(/stampOnsetAfterPaint\(\(\) => dotRef\.current\?\.isConnected === true, \(frameTime, paintOverrunMs\) => \{/);
    expect(mark).toMatch(/onsetRef\.current = frameTime;\s*overrunRef\.current = paintOverrunMs;\s*phaseRef\.current = 'stimulus';/);
    expect(mark).not.toMatch(/now\(\)/);
    expect(src).toMatch(/stimulus_onset_time: onsetRef\.current,\s*onset_paint_overrun_ms: overrunRef\.current,/);
    expect(src).toMatch(/ref=\{dotRef\}\s*aria-hidden\s*data-testid="rt-dot"/);
  });
});

/*
 * A LONG PAINT FRAME (Round 93, review REVA-1; rt-t3). Work in the frame that paints the dot delays the
 * paint; when it runs past the next vsync, the next frame is handed that vsync's timestamp although it
 * starts only after the paint. Under rt-t2 that timestamp was the onset: before the dot could be on the
 * screen. The onset is now the first frame that begins no earlier than the paint's end.
 */
describe('the onset never comes before the paint has finished (review REVA-1, rt-t3)', () => {
  it('work in the paint frame that ends before the next frame begins changes nothing: the next frame, overrun 0', async () => {
    const f = frames((k) => (k === 0 ? { after: 10 } : {}));
    const r = await stampWith(f);
    expect(r.onset).toBe(f.begins[1]);
    expect(r.overrun).toBe(0);
    expect(r.onset).toBeGreaterThan(f.paintEnds[0]);
  });

  for (const [where, w] of [['after the callbacks (a GC, a long render)', { after: 30 }], ['before them (a tracker call)', { before: 30 }]] as const) {
    it(`30 ms of work ${where} in the paint frame: the onset moves to the first frame after the paint, and the overrun is kept`, async () => {
      const f = frames((k) => (k === 0 ? w : {}));
      const r = await stampWith(f);
      // The frame after the paint frame was handed the vsync it missed, 16.7 ms in, before the paint ended (~31 ms).
      expect(f.begins[1]).toBeCloseTo(BASE + FRAME_MS, 6);
      expect(f.begins[1]).toBeLessThan(f.paintEnds[0]);
      expect(r.onset).toBe(f.begins[2]);
      expect(r.onset).toBeGreaterThanOrEqual(f.paintEnds[0]);
      expect(r.overrun).toBeCloseTo(f.paintEnds[0] - f.begins[1], 2);
      expect(r.overrun!).toBeGreaterThan(14);
    });
  }

  it('work past two vsyncs: the onset is still the first frame that begins after the paint', async () => {
    const f = frames((k) => (k === 0 ? { after: 45 } : {}));
    const r = await stampWith(f);
    expect(f.begins[1]).toBeCloseTo(BASE + 2 * FRAME_MS, 6); // Chromium hands the latest missed vsync
    expect(r.onset).toBe(f.begins[2]);
    expect(r.onset).toBeGreaterThanOrEqual(f.paintEnds[0]);
    expect(r.onset - f.paintEnds[0]).toBeLessThan(FRAME_MS);
    expect(r.overrun!).toBeGreaterThan(0);
  });

  it('for any amount of work in the paint frame, the onset is the first vsync at or after the paint\'s end', async () => {
    for (let ms = 0; ms <= 60; ms += 0.5) {
      const f = frames((k) => (k === 0 ? { after: ms } : {}));
      const r = await stampWith(f);
      expect(r.onset, `${ms} ms`).toBeGreaterThanOrEqual(f.paintEnds[0]);
      expect(r.onset - f.paintEnds[0], `${ms} ms`).toBeLessThan(FRAME_MS + 1e-6);
      // Moved exactly when the paint ran past the next frame's begin time, and the overrun says so.
      expect(r.onset === f.begins[1], `${ms} ms`).toBe(r.overrun === 0);
    }
  });

  it('if the end of the paint has not been seen by the next frame, it waits a frame rather than guess', async () => {
    const f = frames(() => ({}), true);
    const r = await stampWith(f);
    expect(r.onset).toBe(f.begins[2]);
    expect(r.overrun!).toBeGreaterThan(0);
  });
});

describe('versioned: rt_timing_version', () => {
  it('rt-t3 when stamped, rt-t1 for a row recorded before any stamp, in 02 and analysis_long, with codebook entries', () => {
    expect(RT_TIMING_VERSION).toBe('rt-t3');
    expect(RT_TIMING_VERSION_T2).toBe('rt-t2');
    expect(RT_TIMING_VERSION_V1).toBe('rt-t1');
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => (i === 0 ? { ...c, rt_timing_version: RT_TIMING_VERSION } : { ...c, rt_timing_version: undefined }));
    const csv = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!.content.trim().split('\n');
    const col = splitCsvRow(csv[0]).indexOf('rt_timing_version');
    expect(col).toBeGreaterThan(-1);
    expect(new Set(csv.slice(1).map((l) => splitCsvRow(l)[col]))).toEqual(new Set([RT_TIMING_VERSION, RT_TIMING_VERSION_V1]));
    expect(ANALYSIS_LONG_COLUMNS).toContain('rt_timing_version');
    const long = buildAnalysisDataset([b]).files.find((f) => f.filename === 'analysis_long.csv')!.content.trim().split('\n');
    const lcol = splitCsvRow(long[0]).indexOf('rt_timing_version');
    expect(new Set(long.slice(1).map((l) => splitCsvRow(l)[lcol]))).toEqual(new Set([RT_TIMING_VERSION, RT_TIMING_VERSION_V1]));
    expect(CODEBOOK.find((r) => r.file === '02_conditions.csv' && r.column === 'rt_timing_version')!.description).toMatch(/rt-t1' before/);
    expect(ANALYSIS_CODEBOOK.find((r) => r.column === 'rt_timing_version')).toBeTruthy();
  });

  /*
   * Review REVA93-A3 (Round 94): nothing tested that the overrun is blank, never 0, on a row recorded before
   * rt-t3, and the fixture wrote the one combination the app never writes (every condition rt-t1, every
   * trial overrun 0). Exported with '?? 0' in place of '?? null', every test and the export gate passed.
   */
  it('08 onset_paint_overrun_ms: blank where it was not measured, never a 0 it did not see; 0 and fractions as measured', () => {
    const b = buildFixtureBundle();
    // The fixture's conditions say which rule their trials were stamped under.
    expect(new Set(b.conditions.map((c) => c.rt_timing_version))).toEqual(new Set([RT_TIMING_VERSION]));
    const old = b.conditions[0].condition_id;
    b.conditions = b.conditions.map((c, i) => (i === 0 ? { ...c, rt_timing_version: undefined } : c));
    const cur = b.conditions[1].condition_id;
    const ofOld = b.reactionTrials.filter((t) => t.condition_id === old);
    const ofCur = b.reactionTrials.filter((t) => t.condition_id === cur);
    // A trial recorded before rt-t3 has no field at all.
    for (const t of ofOld) delete (t as { onset_paint_overrun_ms?: number | null }).onset_paint_overrun_ms;
    ofCur[0].onset_paint_overrun_ms = null;    // the end of the paint not seen
    ofCur[1].onset_paint_overrun_ms = 0;       // an ordinary trial
    ofCur[2].onset_paint_overrun_ms = 14.456;  // a moved one
    const lines = buildExportFiles(b).find((f) => f.filename === '08_reaction_trials.csv')!.content.trim().split('\n');
    const head = splitCsvRow(lines[0]);
    const rows = lines.slice(1).map(splitCsvRow);
    const col = head.indexOf('onset_paint_overrun_ms');
    const cidCol = head.indexOf('condition_id');
    const trialCol = head.indexOf('trial_number');
    const cell = (cid: string, n: number) => rows.find((r) => r[cidCol] === cid && r[trialCol] === String(n))![col];
    expect(col).toBeGreaterThan(-1);
    expect(new Set(rows.filter((r) => r[cidCol] === old).map((r) => r[col]))).toEqual(new Set(['']));
    expect(cell(cur, ofCur[0].trial_number)).toBe('');
    expect(cell(cur, ofCur[1].trial_number)).toBe('0');
    expect(cell(cur, ofCur[2].trial_number)).toBe('14.46');
    // And over the export: every row of a condition not stamped under rt-t3 is blank.
    const c02 = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!.content.trim().split('\n');
    const h02 = splitCsvRow(c02[0]);
    const notT3 = new Set(c02.slice(1).map(splitCsvRow).filter((r) => r[h02.indexOf('rt_timing_version')] !== RT_TIMING_VERSION).map((r) => r[h02.indexOf('condition_id')]));
    expect(notT3).toEqual(new Set([old]));
    for (const r of rows.filter((x) => notT3.has(x[cidCol]))) expect(r[col]).toBe('');
  });

  it('the R template pins the same version and refits the RT model without rt-t1 camera-on rows', () => {
    const r = readFileSync(resolve(__dirname, '../src/analysis/analysis_template.R'), 'utf8');
    expect(r).toContain(`RT_TIMING_VERSION <- "${RT_TIMING_VERSION}"`);
    // The refit leaves out rt-t1 camera-on rows only: rt-t2 rows are not short by a tracker call.
    expect(r).toMatch(/rt_t1_cam <- rt_timing == "rt-t1" & paste\(rt\$participant_id, rt\$condition_id\) %in% rt_cam_keys/);
    expect(r).toMatch(/m_rt_no_t1 <- tryCatch\(lmer\(formula\(m_rt\), data = rt\[!rt_t1_cam, , drop = FALSE\]\)/);
  });
});
