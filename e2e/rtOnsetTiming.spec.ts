import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, dbAll, throughCameraAndCalibration } from './helpers';
import { faceCameraLaunchOptions } from './fixtures/syntheticFace';
import { RT_TIMING_VERSION } from '../src/lib/rtOnset';

/*
 * THE REACTION TASK'S ONSET IS WHEN THE DOT REACHED THE SCREEN, WITH THE CAMERA ON OR OFF (audit 86 P1;
 * rt_timing_version rt-t2).
 *
 * The onset used to be the clock read inside the second animation-frame callback after the dot was
 * rendered. With the camera on, the face tracker works synchronously on the main thread inside the
 * video-frame callback, which the browser runs in the same rendering step BEFORE the animation-frame
 * callbacks; so whenever a camera frame was processed in the stamping frame, the clock was read after the
 * tracker's work, and the reaction time was short by it. The audit measured the stamp 95-140 ms after the
 * start of its frame in headless Chromium (tracker about 110 ms a frame there), against 0.5-1 ms with the
 * camera off; this harness, before the fix, 23-28 ms late on two trials of four (tracker about 23 ms).
 *
 * Now the tracker sits out the trials (useTracking holdFrames) and the onset is the frame's own timestamp
 * (lib/rtOnset.ts). Measured here, independently of the app's logic: when the dot entered the document (a
 * MutationObserver), every frame's begin time, when that frame's rendering had finished (a message posted
 * from an animation-frame callback is handled after the frame is rendered), the order of those events
 * (one counter for all of them, since two can share a coarsened clock value), and the synchronous
 * duration of every video-frame callback (the tracker's work). For each stored trial the frame that
 * painted the dot is the first whose animation-frame callback ran after the dot was in the document, and
 * the onset must be
 *   - no earlier than the begin time of the frame after it (the dot cannot be on the screen before it was
 *     painted), and
 *   - within one frame of the moment that paint had finished, either way: with the camera on as off.
 * "One frame" is measured, as the median interval between frame begin times in the same run.
 */

// The drawn face, so the tracker finds a face and does its full work in the camera-on run. The camera-off
// run declines the camera at its set-up, so no frame reaches a tracker there.
test.use({ launchOptions: faceCameraLaunchOptions() });

interface Probe {
  seq: number;
  frames: { ts: number; at: number; seq: number; done: number | null }[];
  dots: { at: number; seq: number }[];
  vfc: { s: number; e: number }[];
}

/** Watch the page from now on: frames, the dot's insertions, video-frame callbacks. */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const p: Probe = { seq: 0, frames: [], dots: [], vfc: [] };
    (window as unknown as { __rtProbe: Probe }).__rtProbe = p;
    new MutationObserver((records) => {
      const at = performance.now();
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof HTMLElement && (n.matches('[data-testid="rt-dot"]') || n.querySelector('[data-testid="rt-dot"]'))) p.dots.push({ at, seq: ++p.seq });
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    const ch = new MessageChannel();
    ch.port1.onmessage = (e: MessageEvent<number>) => { const f = p.frames[e.data]; if (f && f.done == null) f.done = performance.now(); };
    const loop = (ts: number) => {
      p.frames.push({ ts, at: performance.now(), seq: ++p.seq, done: null });
      ch.port2.postMessage(p.frames.length - 1);
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
  });
}

/**
 * Drive through the first two reaction blocks with the probe on, and measure every stored onset. Two
 * blocks, eight scored trials under the harness's timing: with the camera on, the tracker used to work in
 * some frames and not others, and the old stamp was late only on a trial whose stamping frame it worked in.
 */
async function measureTwoBlocks(page: Page, withCamera: boolean) {
  await startNewExperiment(page);
  let blocks = 0;
  for (let i = 0; i < 600 && blocks < 2; i++) {
    const stage = await stageNow(page);
    if (stage === 'CAMERA_SETUP' && withCamera) {
      await throughCameraAndCalibration(page);
      continue;
    }
    if (stage === 'REACTION_TIME' && (await page.getByRole('button', { name: /Start/ }).count()) > 0) {
      if (blocks === 0) await installProbe(page);
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
  const trials = (await dbAll<{ condition_id: string; trial_number: number; stimulus_onset_time: number }>(page, 'reaction_trials'))
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

function assertOnsetAtPaint(r: Awaited<ReturnType<typeof measureTwoBlocks>>, label: string) {
  console.log(`[rt onset, ${label}] one frame = ${r.frameMs.toFixed(1)} ms; per trial (onset - next frame begin, onset - paint done, tracker in the stamping frame):`,
    r.rows.map((x) => `${x.onset_minus_next_frame_ms.toFixed(1)} / ${x.onset_minus_paint_done_ms.toFixed(1)} / ${x.tracker_in_stamp_frame_ms.toFixed(1)}`).join('; '));
  expect(r.trials.length).toBeGreaterThanOrEqual(8);
  for (const x of r.rows) {
    expect(x.onset_minus_next_frame_ms, `trial ${x.trial}: onset stamped before the dot could be on the screen`).toBeGreaterThanOrEqual(-0.01);
    expect(Math.abs(x.onset_minus_paint_done_ms), `trial ${x.trial}: onset more than one frame from the dot's paint`).toBeLessThanOrEqual(r.frameMs + 1);
  }
  // Each condition says which onset rule its block ran under.
  expect(r.conditions.filter((c) => r.trials.some((t) => t.condition_id === c.condition_id)).map((c) => c.rt_timing_version)).toEqual([RT_TIMING_VERSION, RT_TIMING_VERSION]);
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
