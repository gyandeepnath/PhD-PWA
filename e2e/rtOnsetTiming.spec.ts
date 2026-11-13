import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, dbAll, throughCameraAndCalibration } from './helpers';
import { faceCameraLaunchOptions } from './fixtures/syntheticFace';
import { RT_TIMING_VERSION } from '../src/lib/rtOnset';

/*
 * THE REACTION TASK'S ONSET IS WHEN THE DOT COULD FIRST BE ON THE SCREEN, WITH THE CAMERA ON OR OFF, AND
 * WHEN THE FRAME THAT PAINTS IT RUNS LONG (audit 86 P1, rt-t2; Round 93, review REVA-1 and REVA-2, rt-t3).
 *
 * The onset used to be the clock read inside the second animation-frame callback after the dot was
 * rendered. With the camera on, the face tracker works synchronously on the main thread inside the
 * video-frame callback, which the browser runs in the same rendering step BEFORE the animation-frame
 * callbacks; so whenever a camera frame was processed in the stamping frame, the clock was read after the
 * tracker's work, and the reaction time was short by it. The audit measured the stamp 95-140 ms after the
 * start of its frame in headless Chromium (tracker about 110 ms a frame there), against 0.5-1 ms with the
 * camera off; this harness, before the fix, 23-28 ms late on two trials of four (tracker about 23 ms).
 *
 * Now the tracker sits out the trials (useTracking holdFrames) and the onset is a frame's own timestamp:
 * that of the first frame that begins after the frame that painted the dot was rendered (lib/rtOnset.ts).
 * Measured here, independently of the app's logic: when the dot entered the document (a MutationObserver),
 * every frame's begin time, when that frame's rendering had finished (a message posted from an
 * animation-frame callback is handled after the frame is rendered), the order of those events (one counter
 * for all of them, since two can share a coarsened clock value), and the synchronous duration of every
 * video-frame callback (the tracker's work). For each stored trial the frame that painted the dot is the
 * first whose animation-frame callback ran after the dot was in the document, and the onset must be
 *   - no earlier than the moment that paint had finished (the dot cannot be on the screen before it was
 *     painted), allowing half a millisecond for the clock's coarsening — ONE-SIDED: rt-t2 passed a check of
 *     "within one frame either way" with every onset 14 ms before the paint ended (review REVA-2) — and
 *   - no more than one frame after it (the first frame that begins after the paint, not a later one);
 * and with an ordinary paint frame it is the begin time of the very next frame, with the stored overrun 0.
 * "One frame" is measured, as the median interval between frame begin times in the same run.
 *
 * The third test makes the paint frame long on purpose: 30 ms of other main-thread work in it, after the
 * app has found the dot (a garbage collection or a long render stands in). The next frame is then handed
 * the timestamp of the vsync it missed, before the paint had finished; under rt-t2 that was the onset
 * (review REVA-1: 14.2-14.6 ms before the paint's end). Under rt-t3 the onset is the frame after, and the
 * trial says by how much the message from the paint frame was late (onset_paint_overrun_ms).
 *
 * The fourth holds the message instead (Round 94, review REVA93-A1): the paint ends in time, but a task of
 * 25 or 45 ms is queued ahead of the app's message, so the onset moves to a later frame although rt-t2's
 * (the next frame) was right — by whole frames, two for the 45 ms task, not "up to a frame". It requires
 * the stored overrun and onset_moved_ms, and the bound as the code states it.
 */

// The drawn face, so the tracker finds a face and does its full work in the camera-on run. The camera-off
// run declines the camera at its set-up, so no frame reaches a tracker there.
test.use({ launchOptions: faceCameraLaunchOptions() });

interface Probe {
  seq: number;
  frames: { ts: number; at: number; seq: number; done: number | null }[];
  dots: { at: number; seq: number; queuedMs: number }[];
  vfc: { s: number; e: number }[];
}

/**
 * Watch the page from now on: frames, the dot's insertions, video-frame callbacks. With `paintWorkMs`, the
 * frame that paints each dot also gets that much other main-thread work, in an animation-frame callback
 * queued when the dot enters the document — after the app's own, which was queued a frame earlier. With
 * `queuedWorkMs` (cycled over the dots), the probe's own callback in the paint frame — which runs before the
 * app's, having been registered first — posts, after its paint-done message, a message whose handler works
 * that long: a task queued AHEAD of the message the app posts later in the same frame (review REVA93-A1).
 */
async function installProbe(page: Page, paintWorkMs = 0, queuedWorkMs: number[] = []): Promise<void> {
  await page.evaluate(([PAINT_WORK_MS, QUEUED]) => {
    const p: Probe = { seq: 0, frames: [], dots: [], vfc: [] };
    (window as unknown as { __rtProbe: Probe }).__rtProbe = p;
    const busy = (ms: number) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* work */ } };
    const workCh = new MessageChannel();
    workCh.port1.onmessage = (e: MessageEvent<number>) => busy(e.data);
    let pendingQueued = 0;
    new MutationObserver((records) => {
      const at = performance.now();
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof HTMLElement && (n.matches('[data-testid="rt-dot"]') || n.querySelector('[data-testid="rt-dot"]'))) {
            const queuedMs = QUEUED.length ? QUEUED[p.dots.length % QUEUED.length] : 0;
            p.dots.push({ at, seq: ++p.seq, queuedMs });
            pendingQueued = queuedMs;
            if (PAINT_WORK_MS > 0) {
              requestAnimationFrame(() => busy(PAINT_WORK_MS));
            }
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    const ch = new MessageChannel();
    ch.port1.onmessage = (e: MessageEvent<number>) => { const f = p.frames[e.data]; if (f && f.done == null) f.done = performance.now(); };
    const loop = (ts: number) => {
      p.frames.push({ ts, at: performance.now(), seq: ++p.seq, done: null });
      ch.port2.postMessage(p.frames.length - 1);
      // The first frame after the dot entered the document paints it: queue the work behind our own
      // paint-done message and ahead of the app's.
      if (pendingQueued > 0) { workCh.port2.postMessage(pendingQueued); pendingQueued = 0; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // The tracker's work: each video-frame callback's synchronous part. Patched on the prototype, which
    // the frame pump looks the method up on at every re-registration.
    type VfcProto = { requestVideoFrameCallback?: (cb: (n: number, m: unknown) => void) => number };
    const proto = HTMLVideoElement.prototype as unknown as VfcProto;
    const orig = proto.requestVideoFrameCallback;
    if (orig) {
      proto.requestVideoFrameCallback = function (this: HTMLVideoElement, cb: (n: number, m: unknown) => void) {
        return orig.call(this, (n: number, m: unknown) => {
          const s = performance.now();
          try { cb(n, m); } finally { p.vfc.push({ s, e: performance.now() }); }
        });
      };
    }
  }, [paintWorkMs, queuedWorkMs] as [number, number[]]);
}

/**
 * Drive through the first two reaction blocks with the probe on, and measure every stored onset. Two
 * blocks, eight scored trials under the harness's timing: with the camera on, the tracker used to work in
 * some frames and not others, and the old stamp was late only on a trial whose stamping frame it worked in.
 */
async function measureTwoBlocks(page: Page, withCamera: boolean, paintWorkMs = 0, queuedWorkMs: number[] = []) {
  await startNewExperiment(page);
  let blocks = 0;
  for (let i = 0; i < 600 && blocks < 2; i++) {
    const stage = await stageNow(page);
    if (stage === 'CAMERA_SETUP' && withCamera) {
      await throughCameraAndCalibration(page);
      continue;
    }
    if (stage === 'REACTION_TIME' && (await page.getByRole('button', { name: /Start/ }).count()) > 0) {
      if (blocks === 0) await installProbe(page, paintWorkMs, queuedWorkMs);
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: /Start/ }).first().click();
      await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'REACTION_TIME', null, { timeout: 120_000 });
      blocks += 1;
      continue;
    }
    await handleStage(page, stage);
  }
  expect(blocks).toBe(2);

  const probe = await page.evaluate(() => (window as unknown as { __rtProbe: Probe }).__rtProbe);
  const conditions = await dbAll<{ condition_id: string; session_position: number; rt_timing_version?: string }>(page, 'conditions');
  const trials = (await dbAll<{ condition_id: string; trial_number: number; stimulus_onset_time: number; onset_paint_overrun_ms?: number | null; onset_moved_ms?: number | null }>(page, 'reaction_trials'))
    .sort((a, b) => a.stimulus_onset_time - b.stimulus_onset_time);
  const eye = await dbAll<{ condition_id: string; camera_active: boolean }>(page, 'eye_metrics');

  const gaps = probe.frames.slice(1).map((f, k) => f.ts - probe.frames[k].ts).filter((d) => d > 0).sort((a, b) => a - b);
  const frameMs = gaps[Math.floor(gaps.length / 2)];
  const rows = trials.map((t) => {
    const onset = t.stimulus_onset_time;
    const dom = probe.dots.filter((d) => d.at <= onset).reduce((a, d) => (d.seq > a.seq ? d : a));
    const p = probe.frames.findIndex((f) => f.seq > dom.seq);
    const paint = probe.frames[p];
    const next = probe.frames[p + 1];
    // The tracker's work run inside the frame the old stamp was read in, before it.
    const trackerBeforeStamp = next ? probe.vfc.filter((v) => v.s >= next.ts - 0.5 && v.e <= onset).reduce((a, v) => a + (v.e - v.s), 0) : 0;
    return {
      trial: `${t.condition_id}#${t.trial_number}`,
      onset_minus_next_frame_ms: next ? onset - next.ts : NaN,
      onset_minus_paint_done_ms: paint?.done != null ? onset - paint.done : NaN,
      // How far the paint ran past the next frame's begin time, as this probe saw it.
      probe_overrun_ms: paint?.done != null && next ? paint.done - next.ts : NaN,
      stored_overrun_ms: t.onset_paint_overrun_ms,
      stored_moved_ms: t.onset_moved_ms,
      queued_ms: dom.queuedMs,
      // The onset is some frame's own begin time.
      onset_is_a_frame_begin: probe.frames.some((f) => f.ts === onset),
      tracker_in_stamp_frame_ms: trackerBeforeStamp,
    };
  });
  // Video-frame callbacks inside the trials: from each dot's fixation cross (400 ms before it, at least)
  // to the end of its response window (the harness's is 120 ms).
  const trackerInTrials = probe.vfc.filter((v) => trials.some((t) => v.s >= t.stimulus_onset_time - 400 && v.s <= t.stimulus_onset_time + 100));
  // And between the blocks — the second display's reading among them — where the tracker must be working.
  const byPos = new Map(conditions.map((c) => [c.condition_id, c.session_position]));
  const first = trials.filter((t) => byPos.get(t.condition_id) === 0);
  const second = trials.filter((t) => byPos.get(t.condition_id) === 1);
  const between = first.length && second.length
    ? probe.vfc.filter((v) => v.s > first[first.length - 1].stimulus_onset_time + 1000 && v.s < second[0].stimulus_onset_time - 3000)
    : [];
  return { conditions, trials, rows, frameMs, trackerInTrials, between, eye };
}

function logRows(r: Awaited<ReturnType<typeof measureTwoBlocks>>, label: string) {
  console.log(`[rt onset, ${label}] one frame = ${r.frameMs.toFixed(1)} ms; per trial (onset - next frame begin, onset - paint done, paint overrun seen / stored, tracker in the stamping frame):`,
    r.rows.map((x) => `${x.onset_minus_next_frame_ms.toFixed(1)} / ${x.onset_minus_paint_done_ms.toFixed(1)} / ${x.probe_overrun_ms.toFixed(1)}:${x.stored_overrun_ms ?? 'null'} / ${x.tracker_in_stamp_frame_ms.toFixed(1)}${x.queued_ms ? ` [queued ${x.queued_ms} ms, moved ${x.stored_moved_ms}]` : ''}`).join('; '));
}

/**
 * Never before the paint ended (half a millisecond for clock coarsening), and — unless the paint-end
 * message was held behind a queued task (`held`) — no more than a frame after it. onset_moved_ms is the
 * onset minus the next frame's begin time, as the probe sees it.
 */
function assertNeverBeforePaint(r: Awaited<ReturnType<typeof measureTwoBlocks>>, held = false) {
  expect(r.trials.length).toBeGreaterThanOrEqual(8);
  for (const x of r.rows) {
    expect(x.onset_minus_paint_done_ms, `trial ${x.trial}: onset stamped before the dot's paint had finished`).toBeGreaterThanOrEqual(-0.5);
    if (!held) expect(x.onset_minus_paint_done_ms, `trial ${x.trial}: onset more than one frame after the dot's paint`).toBeLessThanOrEqual(r.frameMs + 1);
    expect(x.onset_is_a_frame_begin, `trial ${x.trial}: the onset is not a frame's begin time`).toBe(true);
    expect(typeof x.stored_moved_ms, `trial ${x.trial}: no onset_moved_ms stored`).toBe('number');
    expect(Math.abs((x.stored_moved_ms as number) - x.onset_minus_next_frame_ms), `trial ${x.trial}: onset_moved_ms ${x.stored_moved_ms} against ${x.onset_minus_next_frame_ms}`).toBeLessThanOrEqual(0.01);
  }
  // Each condition says which onset rule its block ran under.
  expect(r.conditions.filter((c) => r.trials.some((t) => t.condition_id === c.condition_id)).map((c) => c.rt_timing_version)).toEqual([RT_TIMING_VERSION, RT_TIMING_VERSION]);
}

/** An ordinary paint frame: the onset is the very next frame (as under rt-t2), and the stored overrun is 0. */
function assertOnsetAtPaint(r: Awaited<ReturnType<typeof measureTwoBlocks>>, label: string) {
  logRows(r, label);
  assertNeverBeforePaint(r);
  for (const x of r.rows) {
    expect(x.onset_minus_next_frame_ms, `trial ${x.trial}: the onset is not the frame after the paint`).toBeCloseTo(0, 6);
    expect(x.stored_overrun_ms, `trial ${x.trial}: an overrun stored for an ordinary paint frame`).toBe(0);
  }
}

test.describe('the reaction onset, camera off', () => {
  test('is the begin time of the frame after the dot was painted', async ({ page }) => {
    test.setTimeout(400_000);
    const r = await measureTwoBlocks(page, false);
    expect(r.trackerInTrials, 'a camera was running in the camera-off run').toHaveLength(0);
    assertOnsetAtPaint(r, 'camera off');
  });
});

test.describe('the reaction onset, camera on', () => {
  test('is the begin time of the frame after the dot was painted; the tracker sits out the trials and only them', async ({ page }) => {
    test.setTimeout(500_000);
    const r = await measureTwoBlocks(page, true);
    const busy = (vs: { s: number; e: number }[]) => vs.filter((v) => v.e - v.s > 2);
    console.log(`[rt onset, camera on] video-frame callbacks over 2 ms: ${busy(r.trackerInTrials).length} of ${r.trackerInTrials.length} inside the trials, ${busy(r.between).length} of ${r.between.length} between the blocks`);
    // The camera kept running through the trials (frames still arrive, counted), and the tracker did no
    // work on them.
    expect(r.trackerInTrials.length, 'no camera frame arrived during the trials').toBeGreaterThan(5);
    expect(busy(r.trackerInTrials), 'the face tracker worked during the reaction trials').toHaveLength(0);
    // It worked again after them, and the camera was never taken for lost: both displays' readings were
    // measured with the camera on.
    expect(busy(r.between).length, 'the tracker did not resume after the first block').toBeGreaterThan(10);
    expect(r.eye.map((e) => e.camera_active)).toEqual([true, true]);
    assertOnsetAtPaint(r, 'camera on');
  });
});

/*
 * A LONG PAINT FRAME (Round 93, review REVA-1 and REVA-2). 30 ms of other work in the frame that paints each
 * dot. The frame after it is usually handed the vsync it missed, ~14 ms before the paint ends; rt-t2 stored
 * that as the onset, and this test fails on it. rt-t3 waits for the first frame that begins after the paint,
 * and stores the overrun. Not always: the browser may hand the next frame a later vsync, nearer the paint's
 * end (one trial of eight in a Round 94 run: 0.5 ms before it), or after it. So each trial is held to the
 * rule — an overrun stored as the probe saw it, the onset moved exactly when one is stored, never before the
 * paint — and the long paint itself (an overrun of more than 5 ms) is required on most trials, not all, so
 * that the test cannot pass without exercising it (Round 94).
 */
test.describe('the reaction onset, with a long paint frame', () => {
  test('is the first frame that begins after the dot\'s paint has finished, and the trial says the paint overran', async ({ page }) => {
    test.setTimeout(400_000);
    const r = await measureTwoBlocks(page, false, 30);
    logRows(r, 'camera off, 30 ms of work in the paint frame');
    // The work ran well past the next frame's begin time, as the probe saw it, on most trials: the long
    // paint was exercised (the browser picks the next frame's vsync, so not on every one).
    expect(r.rows.filter((x) => x.probe_overrun_ms > 5).length, 'the injected work overran the next frame on fewer than half the trials')
      .toBeGreaterThanOrEqual(Math.ceil(r.rows.length / 2));
    assertNeverBeforePaint(r);
    for (const x of r.rows) {
      // The stored overrun is the one the probe saw — 0 where the paint ended before the next frame began —
      // within a millisecond (two messages, one frame)...
      expect(x.stored_overrun_ms, `trial ${x.trial}: no overrun stored`).not.toBeNull();
      const stored = x.stored_overrun_ms as number;
      expect(Math.abs(stored - Math.max(0, x.probe_overrun_ms)), `trial ${x.trial}: stored overrun ${stored} differs from the probe's ${x.probe_overrun_ms.toFixed(2)}`).toBeLessThanOrEqual(1);
      // ... and the onset moved past the frame after the paint frame exactly when an overrun was stored.
      if (stored > 0) expect(x.onset_minus_next_frame_ms, `trial ${x.trial}: an overrun stored, but the onset stayed on the frame after the paint frame`).toBeGreaterThan(5);
      else expect(x.onset_minus_next_frame_ms, `trial ${x.trial}: no overrun, but the onset moved`).toBeCloseTo(0, 6);
    }
  });
});

/*
 * A HELD MESSAGE (Round 94, review REVA93-A1 and A2). The paint ends a millisecond or two into its frame,
 * but a 25 or 45 ms task is queued ahead of the app's paint-end message. The next frame — rt-t2's onset —
 * was right; rt-t3's onset moves to the first frame after the message arrives: one frame for 25 ms, two for
 * 45 ms. Round 93's text said such an onset is late "by up to a frame"; the bound is the overrun rounded up
 * to whole frames, and the trial says so (onset_paint_overrun_ms above 0, onset_moved_ms the frames moved).
 */
test.describe('the reaction onset, with the paint-end message held behind a queued task', () => {
  test('is late by the overrun rounded up to whole frames, never early, and the trial carries both', async ({ page }) => {
    test.setTimeout(400_000);
    const r = await measureTwoBlocks(page, false, 0, [25, 45]);
    logRows(r, 'camera off, a 25 or 45 ms task queued ahead of the paint-end message');
    assertNeverBeforePaint(r, true);
    // The paint itself ended before the next frame began, so rt-t2's onset was right: on most trials (one
    // in the first runs here had a paint frame of 12.7 ms; a paint that also overran is a mixed case, for
    // which the bound below holds as well).
    expect(r.rows.filter((x) => x.probe_overrun_ms < 0).length, 'the paint itself overran on more than half the trials').toBeGreaterThanOrEqual(Math.ceil(r.rows.length / 2));
    for (const x of r.rows) {
      // The message was held past the next frame's begin time, and the onset moved.
      expect(x.stored_overrun_ms, `trial ${x.trial}: no overrun stored for a held message`).toBeGreaterThan(0);
      expect(x.onset_minus_next_frame_ms, `trial ${x.trial}: the onset stayed on the frame after the paint frame`).toBeGreaterThan(5);
      // The bound as stated: late by the overrun rounded up to whole frames — at least the overrun,
      // under the overrun plus one frame — and within a frame of the message's arrival.
      const moved = x.stored_moved_ms as number;
      const overrun = x.stored_overrun_ms as number;
      expect(moved, `trial ${x.trial}: moved less than the message was late`).toBeGreaterThanOrEqual(overrun - 0.5);
      expect(moved, `trial ${x.trial}: moved more than the overrun plus a frame`).toBeLessThan(overrun + r.frameMs + 1);
      expect(Math.abs(moved / r.frameMs - Math.round(moved / r.frameMs)), `trial ${x.trial}: not a whole number of frames`).toBeLessThan(0.05);
    }
    // More than a frame where the task was longer than one: 'up to a frame' does not hold.
    const long = r.rows.filter((x) => x.queued_ms === 45);
    expect(long.length).toBeGreaterThan(0);
    for (const x of long) expect(x.stored_moved_ms as number, `trial ${x.trial}: a 45 ms task moved the onset less than two frames`).toBeGreaterThan(r.frameMs * 1.5);
  });
});
