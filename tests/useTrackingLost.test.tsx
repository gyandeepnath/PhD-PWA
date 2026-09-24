/**
 * The camera-lost path, exercised through the REAL hook rather than by reading its source.
 *
 * The hook is rendered in jsdom with the camera, the face model and the frame pump replaced by
 * fakes, so the logic under test — what happens when a started camera's track ends — is the shipped
 * code. A review of the fix pointed out that the earlier tests only pattern-matched the source, which
 * a reordering (say, resetting the lost flag in the wrong place) would have passed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { get, _resetForTests } from '@/storage/db';
import type { EyeMetricsRecord } from '@/storage/types';

const modelFails = vi.hoisted(() => ({ value: false }));
vi.mock('@/tracking/faceMeshLoader', () => ({
  faceMeshAssetPath: (f: string) => f,
  loadFaceMesh: async () => {
    if (modelFails.value) throw new Error('model did not load');
    return class {
      setOptions() {}
      onResults() {}
      async send() {}
    };
  },
}));
vi.mock('@/tracking/framePump', () => ({
  startFramePump: () => ({ stop: () => {} }),
}));

import { useTracking } from '@/tracking/useTracking';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeTrack extends EventTarget {
  stopped = false;
  stop() { this.stopped = true; }
}

function fakeCamera() {
  const track = new FakeTrack();
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
  HTMLMediaElement.prototype.play = function play() { return Promise.resolve(); };
  return { track, stream };
}

function mount() {
  const api: { current: ReturnType<typeof useTracking> | null } = { current: null };
  function Probe() { api.current = useTracking(); return null; }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => { root.render(createElement(Probe)); });
  return { api: () => api.current!, unmount: () => act(() => root.unmount()) };
}

describe('useTracking — a camera that stops', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); modelFails.value = false; });

  it('an ended track is reported, the camera released, and the condition written as lost', async () => {
    const { track } = fakeCamera();
    const h = mount();
    await act(async () => { await h.api().start(); });
    expect(h.api().status).toBe('active');
    expect(h.api().cameraLostAt).toBeNull();

    h.api().beginCondition();
    await act(async () => { track.dispatchEvent(new Event('ended')); });
    expect(h.api().cameraLostAt).toBeTypeOf('number');
    expect(h.api().status).toBe('failed');
    expect(track.stopped).toBe(true);
    expect(h.api().mediaSource()).toBeNull();          // no frozen frame to photograph

    await act(async () => { await h.api().endCondition('C1', 'S1'); });
    const row = await get('eye_metrics', 'C1') as EyeMetricsRecord;
    expect(row.camera_active).toBe(false);
    expect(row.camera_inactive_reason).toBe('lost');
    h.unmount();
  });

  it('a camera that never started writes not_running, not lost', async () => {
    const h = mount();
    h.api().beginCondition();
    await act(async () => { await h.api().endCondition('C2', 'S1'); });
    const row = await get('eye_metrics', 'C2') as EyeMetricsRecord;
    expect(row.camera_inactive_reason).toBe('not_running');
    h.unmount();
  });

  it('two starts at once share one camera', async () => {
    fakeCamera();
    const h = mount();
    await act(async () => { await Promise.all([h.api().start(), h.api().start()]); });
    expect((navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    h.unmount();
  });

  it('a start that fails after acquiring the camera releases it and is not later reported as lost', async () => {
    const { track } = fakeCamera();
    // Fails AFTER getUserMedia and after the `ended` listener is attached: the face model.
    modelFails.value = true;
    const h = mount();
    await act(async () => { await h.api().start(); });
    expect(h.api().status).toBe('failed');
    expect(track.stopped).toBe(true);
    await act(async () => { track.dispatchEvent(new Event('ended')); });
    expect(h.api().cameraLostAt).toBeNull();
    h.unmount();
  });
});
