/**
 * The reaction task's onset is the begin time of the frame after the one that painted the dot (Round 92,
 * audit 86 P1; rt_timing_version rt-t2).
 *
 * It was the clock read inside the second frame callback after the dot was rendered. With the camera on,
 * the face tracker works earlier in the same frame (the browser runs video-frame callbacks before
 * animation-frame callbacks), so the clock was read after its work: every such reaction time short by it.
 * The audit measured the stamp 95-140 ms after the start of its frame in headless Chromium.
 *
 * The frames here are driven by hand: each frame has a begin time, the "tracker" advances the clock by a
 * set amount before the frame's callbacks run, and the dot is put in the document in a chosen frame.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stampOnsetAfterPaint, RT_TIMING_VERSION, RT_TIMING_VERSION_V1, ONSET_SEARCH_MAX_FRAMES, type FrameHost } from '@/lib/rtOnset';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { buildAnalysisDataset, ANALYSIS_LONG_COLUMNS } from '@/storage/analysisExport';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';
import { splitCsvRow } from './helpers/csv';

const FRAME_MS = 1000 / 60;

/** A page's frames, run one at a time: tracker work first (it moves the clock), then the callbacks. */
function frames(trackerMsPerFrame: number) {
  let clock = 10_000;
  let frame = 0;
  let queue: Array<(ts: number) => void> = [];
  const begins: number[] = [];
  const host: FrameHost = { requestAnimationFrame: (cb) => { queue.push(cb); return queue.length; } };
  const runFrame = () => {
    const ts = 10_000 + frame * FRAME_MS;
    begins.push(ts);
    clock = ts + trackerMsPerFrame; // the video-frame callback's synchronous work, before the rAF callbacks
    const run = queue;
    queue = [];
    for (const cb of run) {
      cb(ts);
      clock += 0.3;
    }
    frame += 1;
  };
  return { host, runFrame, begins, now: () => clock, frameIndex: () => frame };
}

describe('the onset is the frame after the paint, from the frame\'s own timestamp (audit 86 P1)', () => {
  for (const tracker of [0, 23, 110]) {
    it(`with ${tracker} ms of tracker work in every frame, the onset is the next frame's begin time, not the clock`, async () => {
      const f = frames(tracker);
      let drawn = false;
      let stampedAtClock = NaN;
      let onset = NaN;
      const done = stampOnsetAfterPaint(() => drawn, (ts) => { onset = ts; stampedAtClock = f.now(); }, f.host);
      // React commits the dot in the task after it was asked for: in the document before the next frame.
      drawn = true;
      f.runFrame(); // paints the dot
      f.runFrame(); // the frame after: the stamp
      await done;
      expect(onset).toBe(f.begins[1]);
      // The callback ran after the tracker's work; the stamp does not carry it.
      expect(stampedAtClock - onset).toBeGreaterThanOrEqual(tracker);
    });
  }

  it('a dot committed late is painted late, and the onset waits for the frame after its paint', async () => {
    const f = frames(40);
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
    const f = frames(0);
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
    const f = frames(0);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let onset = NaN;
    const done = stampOnsetAfterPaint(() => false, (ts) => { onset = ts; }, f.host);
    for (let k = 0; k <= ONSET_SEARCH_MAX_FRAMES; k++) f.runFrame();
    await done;
    expect(onset).toBe(f.begins[ONSET_SEARCH_MAX_FRAMES]);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('the task stamps through it, with the frame time, and flips the phase in the same callback', () => {
    const src = readFileSync(resolve(__dirname, '../src/tasks/ReactionTimeTask.tsx'), 'utf8');
    const mark = src.slice(src.indexOf('const markOnsetAtPaint ='), src.indexOf('const runTrial ='));
    expect(mark).toMatch(/stampOnsetAfterPaint\(\(\) => dotRef\.current\?\.isConnected === true, \(frameTime\) => \{/);
    expect(mark).toMatch(/onsetRef\.current = frameTime;\s*phaseRef\.current = 'stimulus';/);
    expect(mark).not.toMatch(/now\(\)/);
    expect(src).toMatch(/ref=\{dotRef\}\s*aria-hidden\s*data-testid="rt-dot"/);
  });
});

describe('versioned: rt_timing_version', () => {
  it('rt-t2 when stamped, rt-t1 for a row recorded before, in 02 and analysis_long, with codebook entries', () => {
    expect(RT_TIMING_VERSION).toBe('rt-t2');
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

  it('the R template pins the same version and refits the RT model without rt-t1 camera-on rows', () => {
    const r = readFileSync(resolve(__dirname, '../src/analysis/analysis_template.R'), 'utf8');
    expect(r).toContain(`RT_TIMING_VERSION <- "${RT_TIMING_VERSION}"`);
    expect(r).toMatch(/m_rt_t2 <- tryCatch\(lmer\(formula\(m_rt\), data = rt\[!rt_t1_cam, , drop = FALSE\]\)/);
  });
});
