/**
 * The pipeline meter must say WHICH stage limits the face-solved frame rate.
 *
 * The camera self-test failed on frame rate "every time" on the study tablet, and the only number the
 * app had was the face-solved rate. A camera giving 15 fps, a tracker taking 60 ms a frame and a face
 * out of view all look the same through that one number, and they need opposite remedies (more light;
 * close other apps; reseat the participant). These tests hold the meter to the three counts and the
 * verdict built on them.
 */
import { describe, it, expect } from 'vitest';
import { PipelineMeter, pipelineLimit, quantile } from '@/tracking/pipelineStats';

/** Drive the meter like a camera at `camFps` and a tracker taking `ms` per frame, synchronously. */
function simulate(meter: PipelineMeter, opts: { camFps: number; ms: number; seconds: number; face?: (i: number) => boolean }) {
  const frameMs = 1000 / opts.camFps;
  let presented = 0;
  let busyUntil = -Infinity;
  let processed = 0;
  for (let t = 0; t <= opts.seconds * 1000; t += frameMs) {
    presented += 1;
    // A synchronous tracker: the callback runs only when the main thread is free, and carries the
    // browser's running count of presented frames (requestVideoFrameCallback's presentedFrames).
    if (t < busyUntil) continue;
    meter.delivered(t, presented);
    meter.processed(t + opts.ms, opts.ms, opts.face ? opts.face(processed) : true);
    processed += 1;
    busyUntil = t + opts.ms;
  }
}

describe('PipelineMeter', () => {
  it('counts every frame the camera delivered, including those the tracker was too busy to see', () => {
    const m = new PipelineMeter(2000);
    const w = m.open();
    simulate(m, { camFps: 30, ms: 50, seconds: 4 });
    const s = w.close();
    expect(s.cameraFps!).toBeGreaterThan(28);
    expect(s.cameraFps!).toBeLessThan(31);
    // A 50 ms tracker on a 30 fps camera processes every other frame: the newest one each time.
    expect(s.trackerFps!).toBeGreaterThan(14);
    expect(s.trackerFps!).toBeLessThan(16);
    expect(s.framesSkipped).toBeGreaterThan(s.framesProcessed * 0.8);
    expect(s.processMsP50).toBe(50);
    expect(s.deliveredSource).toBe('presented-frames');
  });

  it('separates frames processed from frames with a face', () => {
    const m = new PipelineMeter(2000);
    const w = m.open();
    simulate(m, { camFps: 30, ms: 20, seconds: 3, face: (i) => i % 2 === 0 });
    const s = w.close();
    expect(s.trackerFps!).toBeGreaterThan(28);
    expect(s.faceFps!).toBeGreaterThan(13);
    expect(s.faceFps!).toBeLessThan(16);
    expect(s.framesWithFace).toBeLessThan(s.framesProcessed);
  });

  it('counts one frame per callback when the browser gives no counter, and says so', () => {
    const m = new PipelineMeter(2000);
    for (let i = 0; i < 30; i++) m.delivered(i * 33.3, null);
    expect(m.live().deliveredSource).toBe('callbacks');
    expect(m.live().framesDelivered).toBe(30);
  });

  it('treats a counter that runs backwards (a new stream) as one frame, not a negative count', () => {
    const m = new PipelineMeter(2000);
    m.delivered(0, 500);
    m.delivered(33, 501);
    m.delivered(66, 3);   // restarted
    m.delivered(99, 4);
    expect(m.live().framesDelivered).toBe(4); // 1 (first) + 1 + 1 + 1
  });

  it('keeps a window open across the live readout trimming, and stops counting when closed', () => {
    const m = new PipelineMeter(500);
    const w = m.open();
    simulate(m, { camFps: 30, ms: 10, seconds: 3 });
    const s = w.close();
    expect(s.framesProcessed).toBeGreaterThan(80);     // the window saw all 3 s
    expect(m.live().framesProcessed).toBeLessThan(20); // the live view only the last half second
    m.processed(99999, 10, true);
    expect(w.read().framesProcessed).toBe(s.framesProcessed);
  });

  it('reports nulls, not zeros, when nothing happened', () => {
    const s = new PipelineMeter().live();
    expect(s.cameraFps).toBeNull();
    expect(s.trackerFps).toBeNull();
    expect(s.faceFps).toBeNull();
    expect(s.processMsP50).toBeNull();
    expect(s.deliveredSource).toBeNull();
  });
});

describe('pipelineLimit names the stage that is short', () => {
  const floor = 25;
  it('the camera, when it delivers fewer frames than the floor', () => {
    expect(pipelineLimit({ cameraFps: 15, trackerFps: 15, faceFps: 15, deliveredSource: 'presented-frames' }, floor)).toBe('camera');
  });
  it('the tracker, when the camera delivers enough but the tracker processes fewer', () => {
    expect(pipelineLimit({ cameraFps: 30, trackerFps: 16, faceFps: 16, deliveredSource: 'presented-frames' }, floor)).toBe('tracker');
  });
  it('the face, when frames are processed but the face is found in too few', () => {
    expect(pipelineLimit({ cameraFps: 30, trackerFps: 29, faceFps: 9, deliveredSource: 'presented-frames' }, floor)).toBe('face');
  });
  it('nothing, when the face-solved rate meets the floor', () => {
    expect(pipelineLimit({ cameraFps: 30, trackerFps: 29, faceFps: 28, deliveredSource: 'presented-frames' }, floor)).toBeNull();
  });
  it('refuses to blame the camera when frames were counted per callback', () => {
    // A busy main thread suppresses callbacks, so a low callback count may be the tracker's doing.
    expect(pipelineLimit({ cameraFps: 15, trackerFps: 15, faceFps: 15, deliveredSource: 'callbacks' }, floor)).toBe('undetermined');
  });
  it('the tracker, when frames arrived but almost none were processed', () => {
    expect(pipelineLimit({ cameraFps: 30, trackerFps: null, faceFps: null, deliveredSource: 'presented-frames' }, floor)).toBe('tracker');
  });
});

describe('quantile', () => {
  it('is the nearest-rank value and ignores non-finite entries', () => {
    expect(quantile([5, 1, 3, NaN, 2, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(quantile([], 0.5)).toBeNull();
  });
});
