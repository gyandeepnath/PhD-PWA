/**
 * "Measure trackers" ending with no face tracker left to run is a lost camera, not a camera "on" that
 * measures nothing (Round 96; the camera-setup half of audit 86 CAM-7). Driven through the real hook
 * with fake face trackers and no frame pump.
 *
 * Each trial closes the tracker before it so that the one measured runs alone. When the last trial fails
 * there is none running, and the comparison then starts the winner, or, when no trial measured a face,
 * the tracker asked for when the camera started (with its fallback chain). If that start fails too, the catch only recorded the failure: noTrackerLeft
 * does not act while a comparison runs, and holdWatchdog had disarmed the stall watchdog, so the camera
 * stayed 'active' and every row would have been written camera_active TRUE with no samples.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';

const mode = vi.hoisted(() => ({
  startFails: false, detectFails: true, starts: 0,
  /** Set: the next start is held until the test rejects it (the camera can be stopped meanwhile). */
  hold: null as null | { entered: () => void; reject: (e: Error) => void },
}));
vi.mock('@/tracking/trackers', async (orig) => {
  const real = await orig<typeof import('@/tracking/trackers')>();
  const make = (backend: string) => ({
    backend,
    // Every backend constructs, then throws on its first frame: no trial is measured.
    detect: () => { if (mode.detectFails) throw new Error(`${backend}: detect failed`); return null; },
    close: () => {},
  });
  return {
    ...real,
    createTracker: async (b: string) => make(b),
    startTracker: async (b: string) => {
      mode.starts++;
      const h = mode.hold;
      if (h) {
        mode.hold = null;
        return new Promise((_resolve, reject) => { h.reject = reject; h.entered(); });
      }
      if (mode.startFails) throw new Error(`${b}: could not start`);
      return { tracker: make(b), failures: [] };
    },
  };
});
vi.mock('@/tracking/trackerChoice', async (orig) => {
  const real = await orig<typeof import('@/tracking/trackerChoice')>();
  return { ...real, saveTrackerChoice: () => {}, loadTrackerChoice: () => null };
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

async function running(detectFails = true) {
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
  // The camera starts on a tracker that works; the comparison is where everything fails.
  mode.startFails = false;
  mode.detectFails = detectFails;
  await act(async () => { await api.current!.start(); });
  expect(api.current!.status).toBe('active');
  return { api, root };
}

async function compareThenRestart(restartFails: boolean, detectFails = true) {
  const { api, root } = await running(detectFails);
  const startsBefore = mode.starts;
  mode.startFails = restartFails;
  await act(async () => { await api.current!.compareTrackers(); });
  const out = {
    status: api.current!.status,
    lostAt: api.current!.cameraLostAt,
    startError: api.current!.startError,
    restartTried: mode.starts > startsBefore,
  };
  act(() => root.unmount());
  return out;
}

beforeEach(() => { mode.startFails = false; mode.detectFails = true; mode.starts = 0; mode.hold = null; });

describe('measuring the trackers leaves none running', () => {
  it('every trial fails and the restart fails: the camera is lost and says why', async () => {
    const r = await compareThenRestart(true);
    expect(r.restartTried).toBe(true);
    expect(r.status).toBe('failed');
    expect(r.lostAt).not.toBeNull();
    expect(r.startError).toMatch(/No face tracker could run on this device/);
  });

  it('control: every trial fails but the restart works: the camera stays on', async () => {
    const r = await compareThenRestart(false);
    expect(r.restartTried).toBe(true);
    expect(r.status).toBe('active');
    expect(r.lostAt).toBeNull();
  });

  it('control: the trials run and the restart fails: the last trial\'s tracker keeps running, the camera stays on', async () => {
    const r = await compareThenRestart(true, false);
    expect(r.status).toBe('active');
    expect(r.lostAt).toBeNull();
  });

  it('the camera is stopped while the restart is pending: the restart failing then does not mark it lost', async () => {
    const { api, root } = await running();
    let entered!: () => void;
    const restartBegun = new Promise<void>((r) => { entered = r; });
    const hold = { entered: () => entered(), reject: (_e: Error) => {} };
    mode.hold = hold;
    let comparison: Promise<unknown> = Promise.resolve();
    await act(async () => { comparison = api.current!.compareTrackers(); await restartBegun; });
    act(() => { api.current!.stop(); });
    await act(async () => { hold.reject(new Error('could not start')); await comparison; });
    expect(api.current!.status).toBe('stopped');
    expect(api.current!.cameraLostAt).toBeNull();
    act(() => root.unmount());
  });
});
