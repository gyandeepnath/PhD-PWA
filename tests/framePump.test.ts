/**
 * Every camera frame is delivered once, and no frame is delivered twice.
 *
 * The pump was requestAnimationFrame, which fires at the DISPLAY's refresh rate and has nothing to
 * do with the camera's. It sent whatever the video element was holding, without asking whether it
 * was new — so a 30 fps camera on a 60 Hz panel had every frame sent twice. MediaPipe answers each
 * send, so each duplicate produced its own EAR sample and its own timestamp, and effective_fps is
 * computed from those timestamps.
 *
 * That is what makes it a data defect rather than wasted work: FPS_RATIO_THRESHOLD is 30 because a
 * blink lasts 100-150 ms and classifying it as complete or incomplete needs the frame at its
 * minimum aperture. A tablet genuinely delivering 15 fps would have reported 30, passed the gate,
 * and had fps_adequate_for_ratio certify an incomplete-blink ratio drawn from blinks sampled once
 * or twice each.
 */
import { describe, it, expect } from 'vitest';
import { startFramePump, type PumpVideo, type PumpHost } from '@/tracking/framePump';

/** A display that ticks on demand, so a test can run 60 Hz against a 30 fps camera deterministically. */
function fakeHost() {
  const queued = new Map<number, () => void>();
  let next = 1;
  const host: PumpHost = {
    requestAnimationFrame: (cb) => { const h = next++; queued.set(h, cb); return h; },
    cancelAnimationFrame: (h) => { queued.delete(h); },
  };
  const tick = () => {
    const due = [...queued.entries()];
    queued.clear();
    for (const [, cb] of due) cb();
  };
  return { host, tick, pending: () => queued.size };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the animation-frame fallback', () => {
  it('sends a camera frame once, however many times the display refreshes', async () => {
    const video: PumpVideo = { currentTime: 0 };
    const { host, tick } = fakeHost();
    let sends = 0;
    const pump = startFramePump(video, async () => { sends += 1; }, { host });
    expect(pump.mode).toBe('animation-frame');

    // 30 fps camera, 60 Hz panel: each camera frame is on screen for two refreshes.
    for (let cameraFrame = 1; cameraFrame <= 10; cameraFrame++) {
      video.currentTime = cameraFrame / 30;
      tick();
      await flush();
      tick();              // same frame still showing
      await flush();
    }
    pump.stop();
    expect(sends).toBe(10);        // was 20: every frame twice, every sample duplicated
  });

  it('delivers the very first frame rather than skipping it', async () => {
    // currentTime is 0 before playback advances. Seeding the comparison with the current position
    // would make the first callback look like a repeat and drop it.
    const video: PumpVideo = { currentTime: 0 };
    const { host, tick } = fakeHost();
    let sends = 0;
    const pump = startFramePump(video, async () => { sends += 1; }, { host });
    tick();
    await flush();
    pump.stop();
    expect(sends).toBe(1);
  });

  it('keeps pumping after a frame throws', async () => {
    const video: PumpVideo = { currentTime: 0 };
    const { host, tick } = fakeHost();
    let sends = 0;
    const pump = startFramePump(video, async () => {
      sends += 1;
      if (sends === 1) throw new Error('transient decode failure');
    }, { host });
    for (let i = 1; i <= 3; i++) { video.currentTime = i / 30; tick(); await flush(); }
    pump.stop();
    expect(sends).toBe(3);
  });

  it('stops when told to, leaving nothing scheduled', async () => {
    const video: PumpVideo = { currentTime: 0 };
    const { host, tick, pending } = fakeHost();
    let sends = 0;
    const pump = startFramePump(video, async () => { sends += 1; }, { host });
    pump.stop();
    expect(pending()).toBe(0);
    video.currentTime = 1;
    tick();
    await flush();
    expect(sends).toBe(0);
  });

  it('counts CAMERA frames when told to process every Nth', async () => {
    // Under rAF this counted display refreshes, so "every 2nd frame" on a 60 Hz panel with a 30 fps
    // camera dropped nothing at all — it just deduplicated by accident, differently on every device.
    const video: PumpVideo = { currentTime: 0 };
    const { host, tick } = fakeHost();
    let sends = 0;
    const pump = startFramePump(video, async () => { sends += 1; }, { host, everyN: 2 });
    for (let i = 1; i <= 10; i++) { video.currentTime = i / 30; tick(); await flush(); tick(); await flush(); }
    pump.stop();
    expect(sends).toBe(5);
  });
});

describe('requestVideoFrameCallback is preferred where the browser has it', () => {
  /** A video element that presents frames itself, which is what rVFC reports. */
  function rvfcVideo() {
    let cb: ((now: number) => void) | null = null;
    let cancelled = 0;
    const video: PumpVideo = {
      currentTime: 0,
      requestVideoFrameCallback: (fn) => { cb = fn; return 7; },
      cancelVideoFrameCallback: () => { cancelled += 1; cb = null; },
    };
    return { video, present: () => { const f = cb; cb = null; f?.(0); }, cancelled: () => cancelled };
  }

  it('is the mechanism chosen when available', () => {
    const { video } = rvfcVideo();
    const pump = startFramePump(video, async () => {});
    expect(pump.mode).toBe('video-frame-callback');
    pump.stop();
  });

  it('sends exactly one frame per presented frame', async () => {
    const { video, present } = rvfcVideo();
    let sends = 0;
    const pump = startFramePump(video, async () => { sends += 1; });
    for (let i = 0; i < 5; i++) { present(); await flush(); }
    pump.stop();
    expect(sends).toBe(5);
  });

  it('cancels its callback on stop', () => {
    const { video, cancelled } = rvfcVideo();
    startFramePump(video, async () => {}).stop();
    expect(cancelled()).toBe(1);
  });
});

describe('a slow solver is not queued behind itself', () => {
  it('skips frames that arrive while a send is still in flight', async () => {
    // fm.send is awaited so the pump self-paces, but the callback keeps firing. Without the guard,
    // sends would pile up and land out of order on a tablet that cannot keep up — the device where
    // the frame rate matters most.
    const video: PumpVideo = { currentTime: 0 };
    const { host, tick } = fakeHost();
    let started = 0;
    let release: (() => void) | null = null;
    const pump = startFramePump(video, async () => {
      started += 1;
      await new Promise<void>((r) => { release = r; });
    }, { host });

    video.currentTime = 1 / 30; tick(); await flush();
    expect(started).toBe(1);
    video.currentTime = 2 / 30; tick(); await flush();
    expect(started, 'a second send began while the first was still running').toBe(1);

    release!();
    await flush();
    video.currentTime = 3 / 30; tick(); await flush();
    expect(started).toBe(2);
    pump.stop();
  });
});

describe('the hook uses the pump', () => {
  it('no longer drives MediaPipe from requestAnimationFrame directly', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/tracking/useTracking.ts', 'utf8');
    expect(src).toMatch(/startFramePump\(/);
    // The old loop: a bare rAF around fm.send, with no test that the frame was new.
    expect(src).not.toMatch(/rafRef/);
    expect(src).not.toMatch(/requestAnimationFrame\(pump\)/);
  });
});
