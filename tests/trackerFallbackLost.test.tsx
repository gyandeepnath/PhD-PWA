/**
 * Every face tracker failing on its frames is a lost camera, not a camera "on" that measures nothing
 * (audit 86 CAM-7). Driven through the real hook with fake trackers and a frame pump pumped by hand.
 *
 * The end of the fallback chain used to do nothing: the stall watchdog that was meant to report it arms
 * only once a result has arrived, and the fallback had just disarmed it. The camera stayed 'active', no
 * notice came, and every row was written camera_active TRUE with no samples, no reason and the last
 * failed tracker's name.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import 'fake-indexeddb/auto';

const pump = vi.hoisted(() => ({ onFrame: null as null | ((m: { now: number; captureTime?: number }) => Promise<void> | void) }));
const mode = vi.hoisted(() => ({ answerOnce: false }));
vi.mock('@/tracking/trackers', async (orig) => {
  const real = await orig<typeof import('@/tracking/trackers')>();
  const make = (backend: string) => {
    let calls = 0;
    return {
      backend,
      // Constructs, then throws on every frame (or, in the control, answers once and then stops).
      detect: () => {
        calls++;
        if (mode.answerOnce && calls === 1) return null;
        throw new Error(`${backend}: detect failed`);
      },
      close: () => {},
    };
  };
  return { ...real, createTracker: async (b: string) => make(b), startTracker: async (b: string) => ({ tracker: make(b), failures: [] }) };
});
vi.mock('@/tracking/framePump', async (orig) => ({
  ...(await orig<typeof import('@/tracking/framePump')>()),
  startFramePump: (_v: unknown, onFrame: (m: { now: number }) => Promise<void>) => {
    pump.onFrame = onFrame;
    return { stop: () => { pump.onFrame = null; }, busySkips: 0, mode: 'video-frame-callback' };
  },
}));
vi.mock('@/experiment/config', async (orig) => {
  const real = await orig<typeof import('@/experiment/config')>();
  return { ...real, CONFIG: { ...real.CONFIG, CAMERA_STALL_MS: 300 } };
});
import { useTracking } from '@/tracking/useTracking';
import { get } from '@/storage/db';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function sitting(answerOnce: boolean) {
  mode.answerOnce = answerOnce;
  class FakeTrack extends EventTarget { stop() {} getSettings() { return {}; } }
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
  expect(api.current!.status).toBe('active');
  // Each backend that never answered is given its ten errors, then the next in the chain.
  for (let i = 0; i < 40 && pump.onFrame; i++) {
    await act(async () => { await pump.onFrame?.({ now: performance.now() }); await new Promise((r) => setTimeout(r, 2)); });
  }
  // Past CAMERA_STALL_MS (300 ms here) and two watchdog ticks.
  await act(async () => { await new Promise((r) => setTimeout(r, 2500)); });
  const id = `cond-${answerOnce ? 'control' : 'allfail'}`;
  act(() => { api.current!.beginCondition(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  await act(async () => { await api.current!.endCondition(id, 'S1'); });
  const row = await get('eye_metrics', id);
  const out = { status: api.current!.status, lostAt: api.current!.cameraLostAt, startError: api.current!.startError, row };
  act(() => root.unmount());
  return out;
}

describe('when no face tracker can run', () => {
  it('every backend throws on its frames: the camera is lost, says why, and rows are camera-off rows', async () => {
    const r = await sitting(false);
    expect(r.status).toBe('failed');
    expect(r.lostAt).not.toBeNull();
    expect(r.startError).toMatch(/No face tracker could run on this device: legacy failed on its first frames/);
    // No tracker measured the row, so none is named on it (it used to carry the last one that failed).
    expect(r.row).toMatchObject({ camera_active: false, camera_inactive_reason: 'lost' });
    expect((r.row as { tracker_backend?: string | null } | undefined)?.tracker_backend ?? null).toBeNull();
  }, 20_000);

  it('control: a tracker that answered once and then stopped is lost too, through the stall watchdog', async () => {
    const r = await sitting(true);
    expect(r.status).toBe('failed');
    expect(r.row).toMatchObject({ camera_active: false, camera_inactive_reason: 'lost' });
  }, 20_000);
});
