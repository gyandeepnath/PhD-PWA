/**
 * Choosing the face tracker: measured on the device, kept per device, frozen by config, falling back
 * toward the legacy solution and never away from it.
 */
import { describe, it, expect, vi } from 'vitest';
import { pickFastest, earNoise, resolveTracker, loadTrackerChoice, saveTrackerChoice, type TrackerTrial, type StoredTrackerChoice } from '@/tracking/trackerChoice';
import { fallbackChain, startTracker, type FaceTracker, type TrackerBackend } from '@/tracking/trackers';

const trial = (backend: TrackerBackend, o: Partial<TrackerTrial> = {}): TrackerTrial => ({
  backend, ok: true, initMs: 500, cameraFps: 30, trackerFps: 20, faceFps: 20,
  processMsP50: 45, processMsP95: 60, faceShare: 1, earNoise: 0.01, ...o,
});

describe('pickFastest', () => {
  it('chooses the backend that solves the most face frames per second', () => {
    expect(pickFastest([
      trial('tasks-gpu', { faceFps: 29, processMsP50: 20 }),
      trial('tasks-cpu', { faceFps: 16, processMsP50: 60 }),
      trial('legacy', { faceFps: 8, processMsP50: 120 }),
    ])).toBe('tasks-gpu');
  });

  it('between two within 1 fps (both at the camera rate), prefers the one taking less time per frame', () => {
    expect(pickFastest([
      trial('tasks-gpu', { faceFps: 29.5, processMsP50: 22 }),
      trial('tasks-cpu', { faceFps: 29.8, processMsP50: 14 }),
    ])).toBe('tasks-cpu');
  });

  it('does not let a trial that saw no face win on a measurement of nothing', () => {
    // With no face, a tracker runs only its cheap detector and processes frames quickly.
    expect(pickFastest([
      trial('tasks-gpu', { faceFps: 0, trackerFps: 30, faceShare: 0, processMsP50: 8 }),
      trial('legacy', { faceFps: 12, trackerFps: 12, faceShare: 0.95 }),
    ])).toBe('legacy');
  });

  it('chooses nothing when no trial had a face in view — a detector-only speed is not a measurement (round 77)', () => {
    expect(pickFastest([
      trial('tasks-gpu', { faceFps: 0, trackerFps: 9, faceShare: 0 }),
      trial('tasks-cpu', { faceFps: 0, trackerFps: 18, faceShare: 0 }),
      trial('legacy', { faceFps: 4, trackerFps: 12, faceShare: 0.3 }),
    ])).toBeNull();
    expect(pickFastest([trial('tasks-cpu', { faceShare: null })])).toBeNull();
  });

  it('ignores backends that could not start, and returns null when none could', () => {
    expect(pickFastest([trial('tasks-gpu', { ok: false, error: 'no WebGL' }), trial('legacy', { faceFps: 5 })])).toBe('legacy');
    expect(pickFastest([trial('tasks-gpu', { ok: false }), trial('tasks-cpu', { ok: false })])).toBeNull();
  });
});

describe('earNoise', () => {
  it('is the median frame-to-frame change relative to the median EAR, and ignores brief blinks', () => {
    const steady = Array.from({ length: 60 }, (_, i) => 0.3 + (i % 2 ? 0.003 : -0.003));
    const withBlink = [...steady];
    withBlink.splice(30, 3, 0.12, 0.08, 0.15);
    expect(earNoise(steady)!).toBeCloseTo(0.02, 2);
    expect(earNoise(withBlink)!).toBeCloseTo(0.02, 2);
  });
  it('is null below ten frames', () => {
    expect(earNoise([0.3, 0.31, 0.29])).toBeNull();
  });
});

describe('resolveTracker', () => {
  const stored: StoredTrackerChoice = { backend: 'tasks-cpu', measuredAt: 1, appVersion: 'x', trials: [] };
  it('a backend named in config wins over anything stored: frozen for the study', () => {
    expect(resolveTracker('legacy', stored)).toEqual({ backend: 'legacy', source: 'config' });
  });
  it('under auto, the device keeps what was measured on it', () => {
    expect(resolveTracker('auto', stored)).toEqual({ backend: 'tasks-cpu', source: 'stored' });
  });
  it('under auto with nothing measured, starts at the head of the fallback order', () => {
    expect(resolveTracker('auto', null)).toEqual({ backend: 'tasks-gpu', source: 'default' });
  });
});

describe('the stored choice', () => {
  it('round-trips, and an unknown backend in storage is ignored rather than started', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    saveTrackerChoice({ backend: 'legacy', measuredAt: 5, appVersion: '2.3.0', trials: [] }, st);
    expect(loadTrackerChoice(st)?.backend).toBe('legacy');
    mem.set('visulab.tracker.choice.v1', JSON.stringify({ backend: 'mystery', measuredAt: 1, trials: [] }));
    expect(loadTrackerChoice(st)).toBeNull();
    mem.set('visulab.tracker.choice.v1', '{not json');
    expect(loadTrackerChoice(st)).toBeNull();
  });
});

describe('the fallback chain', () => {
  it('runs toward the legacy solution and never away from it', () => {
    expect(fallbackChain('tasks-gpu')).toEqual(['tasks-gpu', 'tasks-cpu', 'legacy']);
    expect(fallbackChain('tasks-cpu')).toEqual(['tasks-cpu', 'legacy']);
    // A tracker frozen to the legacy model never silently becomes a different model.
    expect(fallbackChain('legacy')).toEqual(['legacy']);
  });

  const fake = (backend: TrackerBackend, detect: () => unknown = () => null): FaceTracker => ({
    backend, detect: detect as FaceTracker['detect'], close: vi.fn(),
  });

  it('records why each backend was passed over and starts the next', async () => {
    const created: FaceTracker[] = [];
    const create = async (b: TrackerBackend) => {
      if (b === 'tasks-gpu') throw new Error('WebGL2 unavailable');
      const t = fake(b, b === 'tasks-cpu' ? () => { throw new Error('first frame failed'); } : undefined);
      created.push(t);
      return t;
    };
    const probe = {} as HTMLVideoElement;
    const r = await startTracker('tasks-gpu', probe, create);
    expect(r.tracker.backend).toBe('legacy');
    expect(r.failures.map((f) => f.backend)).toEqual(['tasks-gpu', 'tasks-cpu']);
    expect(r.failures[0].error).toMatch(/WebGL2/);
    // The CPU tracker constructed and then failed its first frame: it was closed, not leaked.
    expect(created[0].close).toHaveBeenCalled();
  });

  it('throws with every reason when nothing in the chain starts', async () => {
    await expect(startTracker('tasks-cpu', null, async (b) => { throw new Error(`${b} broken`); }))
      .rejects.toThrow(/tasks-cpu broken.*legacy broken/);
  });
});

describe('errorSummary', () => {
  it('keeps the first line of a wasm abort, not the Emscripten stack trace', async () => {
    const { errorSummary } = await import('@/tracking/trackers');
    const e = new Error('abort(Module.noExitRuntime has been replaced) at Error at jsStackTrace (http://x/face_mesh.js:9:1) at stackTrace (http://x:9)');
    expect(errorSummary(e)).toBe('abort(Module.noExitRuntime has been replaced)');
    expect(errorSummary('x'.repeat(500)).length).toBe(160);
  });

  it('names a failed script load instead of recording [object Event] (round 77)', async () => {
    const { errorSummary } = await import('@/tracking/trackers');
    // What Emscripten / FilesetResolver reject with when the loader <script> fails: its error Event.
    const script = document.createElement('script');
    script.src = 'https://example.test/tasks-vision/vision_wasm_internal.js';
    const ev = new Event('error');
    Object.defineProperty(ev, 'target', { value: script });
    expect(errorSummary(ev)).toBe('error event loading https://example.test/tasks-vision/vision_wasm_internal.js');
    expect(errorSummary(new Event('error'))).toBe('error event loading a tracker asset');
  });

  it('never records a bare [object …] for other non-Error values', async () => {
    const { errorSummary } = await import('@/tracking/trackers');
    expect(errorSummary({ message: 'wasm fetch failed' })).toBe('wasm fetch failed');
    expect(errorSummary({ code: 3 })).toBe('{"code":3}');
    expect(errorSummary({})).toBe('Object with no message');
    const e = new Error('');
    expect(errorSummary(e)).toBe('Error');
    for (const v of [new Event('error'), {}, { code: 3 }]) expect(errorSummary(v)).not.toMatch(/\[object /);
  });
});
