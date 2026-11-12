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
 * frame's; 40 ms: 33.3 ms). That timestamp is fixed when the previous frame's RENDERING ends: a task that
 * runs after the rendering (a queued task, review REVA93-A1) delays when the next frame starts, not its
 * timestamp — the review measured a frame whose callbacks ran 104.8 ms late with its original vsync's time.
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
  /**
   * A task of this many ms queued during the frame AHEAD of the tasks its callbacks post (another message,
   * a database callback, a timer): it runs after the frame's rendering and before them (review REVA93-A1).
   */
  queued?: number;
}

/** A page's frames, run one at a time. `work(k)` is frame k's extra work; `lateTasks` defers posted tasks a frame. */
function frames(work: (k: number) => FrameWork = () => ({}), lateTasks = false) {
  let clock = BASE;
  let lastTs = BASE - FRAME_MS;
  let lastRenderEnd = BASE;
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
    const ts = Math.max(lastTs + FRAME_MS, BASE + Math.floor((lastRenderEnd - BASE + 1e-9) / FRAME_MS) * FRAME_MS);
    lastTs = ts;
    begins.push(ts);
    clock = Math.max(clock, ts);
    const w = work(frame);
    if (w.queued) tasks.push(() => { clock += w.queued!; });
    clock += w.before ?? 0;
    const run = queue;
    queue = [];
    for (const cb of run) {
      cb(ts);
      clock += 0.3;
    }
    clock += (w.after ?? 0) + RENDER_MS;
    paintEnds.push(clock);
    lastRenderEnd = clock;
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
  let moved = NaN;
  let stampedAtClock = NaN;
  let done = false;
  const p = stampOnsetAfterPaint(() => true, (ts, o, m) => { onset = ts; overrun = o; moved = m; stampedAtClock = f.now(); done = true; }, f.host);
  for (let k = 0; k < 20 && !done; k++) f.runFrame();
  await p;
  return { onset, overrun, moved, stampedAtClock };
}

describe('the onset is the frame after the paint, from the frame\'s own timestamp (audit 86 P1)', () => {
  for (const tracker of [0, 23, 110]) {
    it(`with ${tracker} ms of tracker work in the stamping frame, the onset is that frame's begin time, not the clock`, async () => {
      // Frame 0 paints the dot; the tracker works in frame 1, before its callbacks.
      const f = frames((k) => (k === 1 ? { before: tracker } : {}));
      const r = await stampWith(f);
      expect(r.onset).toBe(f.begins[1]);
      expect(r.overrun).toBe(0);
      expect(r.moved).toBe(0);
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
    expect(mark).toMatch(/stampOnsetAfterPaint\(\(\) => dotRef\.current\?\.isConnected === true, \(frameTime, paintOverrunMs, movedMs\) => \{/);
    expect(mark).toMatch(/onsetRef\.current = frameTime;\s*overrunRef\.current = paintOverrunMs;\s*movedRef\.current = movedMs;\s*phaseRef\.current = 'stimulus';/);
    expect(mark).not.toMatch(/now\(\)/);
    expect(src).toMatch(/stimulus_onset_time: onsetRef\.current,\s*onset_paint_overrun_ms: overrunRef\.current,\s*onset_moved_ms: movedRef\.current,/);
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
      // Moved one frame past rt-t2's onset, and the trial says so.
      expect(r.moved).toBeCloseTo(f.begins[2] - f.begins[1], 2);
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

/*
 * A HELD MESSAGE (Round 94, review REVA93-A1 and A2). The message posted from the paint frame is a task of
 * its own, and a task already queued ahead of it runs first. The paint then ended in time and rt-t2's onset
 * (the next frame) was right, but the message arrives late, the onset moves to the first frame after its
 * arrival, and the reaction time is SHORT by however many frames that is: not by up to a frame, as Round
 * 93's text said, but by the overrun rounded up to whole frames, which is unbounded. The review measured it
 * in headless Chromium: 25, 45 and 120 ms queued tasks moved the onset 1, 2 and 7 frames. tests above
 * modelled every posted task as running straight after the frame, and missed it.
 */
describe('a task queued ahead of the paint-end message moves the onset late, by whole frames (review REVA93-A1)', () => {
  for (const [queued, frames_] of [[25, 1], [45, 2], [120, 7]] as const) {
    it(`a ${queued} ms task queued in the paint frame: the onset moves ${frames_} frame(s), the paint having ended in time`, async () => {
      const f = frames((k) => (k === 0 ? { queued } : {}));
      const r = await stampWith(f);
      // The paint itself ended well before the next frame began: rt-t2's onset, begins[1], was right.
      expect(f.paintEnds[0]).toBeLessThan(f.begins[1]);
      // The overrun is the message's lateness, not the paint's.
      expect(r.overrun!).toBeGreaterThan(0);
      expect(r.overrun).toBeCloseTo(f.paintEnds[0] + queued - f.begins[1], 2);
      // The onset is late by whole frames: the overrun rounded up, under the overrun plus one frame.
      expect(r.moved).toBeCloseTo(r.onset - f.begins[1], 2);
      expect(r.moved / FRAME_MS).toBeCloseTo(frames_, 2); // stored to 0.01 ms
      expect(r.moved).toBeGreaterThanOrEqual(r.overrun!);
      expect(r.moved).toBeLessThan(r.overrun! + FRAME_MS);
      // ... and never before the paint ended.
      expect(r.onset).toBeGreaterThanOrEqual(f.paintEnds[0]);
    });
  }

  it('for any queued task, the onset is never early, and onset_moved_ms is the overrun rounded up to whole frames', async () => {
    for (let ms = 0; ms <= 130; ms += 0.5) {
      const f = frames((k) => (k === 0 ? { queued: ms } : {}));
      const r = await stampWith(f);
      expect(r.onset, `${ms} ms`).toBeGreaterThanOrEqual(f.paintEnds[0]);
      expect(r.moved, `${ms} ms`).toBeCloseTo(r.onset - f.begins[1], 2);
      if (r.overrun === 0) {
        expect(r.moved, `${ms} ms`).toBe(0);
      } else {
        expect(r.moved / FRAME_MS, `${ms} ms`).toBeCloseTo(Math.ceil(r.overrun! / FRAME_MS - 1e-6), 1);
        expect(r.moved, `${ms} ms`).toBeLessThan(r.overrun! + FRAME_MS);
      }
    }
  });

  it('a paint overrun and a held message together: the onset is still between rt-t2\'s and rt-t2\'s plus onset_moved_ms', async () => {
    const f = frames((k) => (k === 0 ? { after: 25, queued: 25 } : {}));
    const r = await stampWith(f);
    // The first frame the dot could be shown at: the first to begin after the paint ended.
    const firstAfterPaint = f.begins.find((b) => b >= f.paintEnds[0])!;
    expect(firstAfterPaint).toBeGreaterThan(f.begins[1]);
    expect(r.onset).toBeGreaterThan(firstAfterPaint); // late, by the held part
    expect(firstAfterPaint).toBeGreaterThanOrEqual(r.onset - r.moved);
    expect(firstAfterPaint).toBeLessThanOrEqual(r.onset);
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

  /*
   * Review REVA93-A1/A2 (Round 94): every document said a held message made the onset "a frame later" and the
   * reaction time "short by up to about a frame", and that only a trial whose paint overran moves. Both are
   * wrong for a task longer than a frame. Held here as each document now states it.
   */
  it('the documents state when the onset moves and by how much as the code does it (review REVA93-A1/A2)', () => {
    const flat = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8').replace(/\n\s*(\*|#|\/\/)?\s?/g, ' ').replace(/\s+/g, ' ');
    const stale = [/short by up to about a frame(?!")/, /a frame later than the dot could first have been shown/, /only a trial whose paint frame overran moves/,
      /by how much the paint overran/, /late by up to a frame/, /the same except on a trial whose paint frame overran/];
    const entry = (file: string, column: string) => CODEBOOK.find((r) => r.file === file && r.column === column)!.description;
    const texts: Record<string, string> = {
      'lib/rtOnset.ts': flat('src/lib/rtOnset.ts'),
      'ReactionTimeTask.tsx': flat('src/tasks/ReactionTimeTask.tsx'),
      'types.ts': flat('src/storage/types.ts'),
      'analysis_template.R': flat('src/analysis/analysis_template.R'),
      'ANALYSIS_PLAN.md': flat('docs/ANALYSIS_PLAN.md'),
      '02 rt_timing_version': entry('02_conditions.csv', 'rt_timing_version'),
      '08 response_time_ms': entry('08_reaction_trials.csv', 'response_time_ms'),
      '08 onset_paint_overrun_ms': entry('08_reaction_trials.csv', 'onset_paint_overrun_ms'),
      'analysis rt_timing_version': ANALYSIS_CODEBOOK.find((r) => r.column === 'rt_timing_version')!.description,
    };
    for (const [where, text] of Object.entries(texts)) for (const re of stale) expect(text, `${where}: ${re}`).not.toMatch(re);
    expect(texts['08 onset_paint_overrun_ms']).toMatch(/held behind a task already queued ahead of it/);
    expect(texts['08 onset_paint_overrun_ms']).toMatch(/no bound of its own/);
    expect(texts['02 rt_timing_version']).toMatch(/held behind a task queued ahead of it/);
    expect(texts['analysis rt_timing_version']).toMatch(/the data cannot tell the two apart/);
    expect(texts['lib/rtOnset.ts']).toMatch(/the overrun rounded up to whole frames/);
    expect(texts['ANALYSIS_PLAN.md']).toMatch(/the reaction time lies between `response_time_ms` and `response_time_ms \+ onset_moved_ms`/);
    expect(entry('08_reaction_trials.csv', 'onset_moved_ms')).toMatch(/Blank on rows recorded before Round 94/);
  });

  it('08 onset_moved_ms: blank where it was not recorded, 0 and whole frames as recorded', () => {
    const b = buildFixtureBundle();
    const cid = b.conditions[0].condition_id;
    const ts = b.reactionTrials.filter((t) => t.condition_id === cid);
    delete (ts[0] as { onset_moved_ms?: number | null }).onset_moved_ms; // recorded by Round 93's build
    ts[1].onset_paint_overrun_ms = 29.64; ts[1].onset_moved_ms = 33.333;
    const lines = buildExportFiles(b).find((f) => f.filename === '08_reaction_trials.csv')!.content.trim().split('\n');
    const head = splitCsvRow(lines[0]);
    const rows = lines.slice(1).map(splitCsvRow).filter((r) => r[head.indexOf('condition_id')] === cid);
    const at = (n: number) => rows.find((r) => r[head.indexOf('trial_number')] === String(n))!;
    const mcol = head.indexOf('onset_moved_ms');
    expect(mcol).toBe(head.indexOf('onset_paint_overrun_ms') + 1);
    expect(at(ts[0].trial_number)[mcol]).toBe('');
    expect(at(ts[1].trial_number)[mcol]).toBe('33.33');
    expect(at(ts[2].trial_number)[mcol]).toBe('0');
  });

  it('the R template pins the same version and refits the RT model without rt-t1 camera-on rows', () => {
    const r = readFileSync(resolve(__dirname, '../src/analysis/analysis_template.R'), 'utf8');
    expect(r).toContain(`RT_TIMING_VERSION <- "${RT_TIMING_VERSION}"`);
    // The refit leaves out rt-t1 camera-on rows only: rt-t2 rows are not short by a tracker call.
    expect(r).toMatch(/rt_t1_cam <- rt_timing == "rt-t1" & paste\(rt\$participant_id, rt\$condition_id\) %in% rt_cam_keys/);
    expect(r).toMatch(/m_rt_no_t1 <- tryCatch\(lmer\(formula\(m_rt\), data = rt\[!rt_t1_cam, , drop = FALSE\]\)/);
  });
});
