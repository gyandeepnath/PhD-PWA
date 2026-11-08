/**
 * "Measure trackers" on camera setup (useTracking compareTrackers), driven through the real hook with
 * fake face trackers and no frame pump.
 *
 * Stopped by a rotation to portrait (audit 86 CAM-10): the trials so far were measured on a picture the
 * camera now delivers on its side, and the fastest of them used to be stored as this tablet's tracker for
 * every later sitting. A stopped comparison chooses, stores and records nothing, and the tracker that was
 * running before runs again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';

const made = vi.hoisted(() => ({ list: [] as Array<{ backend: string; closed: boolean }>, saved: [] as unknown[] }));
vi.mock('@/tracking/trackers', async (orig) => {
  const real = await orig<typeof import('@/tracking/trackers')>();
  const make = (backend: string) => {
    const rec = { backend, closed: false };
    made.list.push(rec);
    return { backend, detect: () => null, close: () => { rec.closed = true; } };
  };
  return {
    ...real,
    createTracker: async (b: string) => make(b),
    startTracker: async (b: string) => ({ tracker: make(b), failures: [] }),
  };
});
// With no frame pump no trial sees a face, so the choice is made for it: the last backend, every time.
vi.mock('@/tracking/trackerChoice', async (orig) => {
  const real = await orig<typeof import('@/tracking/trackerChoice')>();
  return {
    ...real,
    pickFastest: () => 'legacy',
    saveTrackerChoice: (c: unknown) => { made.saved.push(c); },
    loadTrackerChoice: () => null,
  };
});
vi.mock('@/tracking/framePump', async (orig) => ({
  ...(await orig<typeof import('@/tracking/framePump')>()),
  startFramePump: () => ({ stop: () => {}, busySkips: 0, mode: 'video-frame-callback' }),
}));
vi.mock('@/experiment/config', async (orig) => {
  const real = await orig<typeof import('@/experiment/config')>();
  return { ...real, CONFIG: { ...real.CONFIG, TRACKER_BACKEND: 'auto', TRACKER_TRIAL_MS: 5, TRACKER_TRIAL_WARMUP_MS: 5 } };
});
import { useTracking } from '@/tracking/useTracking';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function running() {
  class FakeTrack extends EventTarget { stop() {} }
  const track = new FakeTrack();
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
  HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  const api: { current: ReturnType<typeof useTracking> | null } = { current: null };
  function Probe() { api.current = useTracking(); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(Probe)); });
  await act(async () => { await api.current!.start(); });
  return { api, root };
}

beforeEach(() => { made.list.length = 0; made.saved.length = 0; });

describe('measuring the trackers', () => {
  it('run to its end, keeps and records the choice', async () => {
    const { api, root } = await running();
    let trials: unknown = null;
    await act(async () => { trials = await api.current!.compareTrackers(); });
    expect(trials).toHaveLength(3);
    expect(made.saved).toHaveLength(1);
    expect(api.current!.pipelineInfo()).toMatchObject({ tracker_selection: 'measured', tracker_requested: 'legacy' });
    act(() => root.unmount());
  });

  it('stopped by a rotation, chooses, stores and records nothing, and runs the tracker it ran before (CAM-10)', async () => {
    const { api, root } = await running();
    const before = api.current!.pipelineInfo()!;
    const stop = new AbortController();
    let trials: unknown = 'not returned';
    await act(async () => {
      trials = await api.current!.compareTrackers((p) => { if (p.index === 1) stop.abort(); }, stop.signal);
    });
    expect(trials).toBeNull();
    expect(made.saved).toEqual([]);
    const after = api.current!.pipelineInfo()!;
    expect(after.tracker_selection).toBe(before.tracker_selection);
    expect(after.tracker_trials ?? null).toBeNull();
    // The tracker running now is the one requested before the comparison, started again.
    expect(after.tracker_backend).toBe(before.tracker_requested);
    act(() => root.unmount());
  });
});
