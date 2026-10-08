/**
 * When the camera or the tracker cannot start, camera setup shows the library's own reason.
 *
 * Round 77: requestCamera() awaited camera.start() and then read camera.startError from the `camera`
 * prop captured at the render that began the request. useTracking sets startError in React state, so
 * that captured object still held null and ' Details: …' never appeared — on exactly the tablet whose
 * tracker cannot start. The harness below holds startError in state the same way useTracking does, so
 * the screen sees it only through a new render, as in the app.
 *
 * Rendered for real in jsdom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act, useState, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CameraSetupTracking } from '@/start/setupStages';
import type { CameraStatus } from '@/storage/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

const REASON = "Cannot read properties of undefined (reading 'activeTexture')";

async function render(result: CameraStatus): Promise<HTMLElement> {
  const { CameraSetup } = await import('@/start/setupStages');
  function Harness() {
    const [status, setStatus] = useState<CameraStatus>('unavailable');
    const [startError, setStartError] = useState<string | null>(null);
    const start = useCallback(async () => {
      // As useTracking: the reason goes into state, then the promise resolves with the status.
      if (result === 'failed') setStartError(REASON);
      setStatus(result);
      return result;
    }, []);
    const camera: CameraSetupTracking = {
      status, start, stop: () => {}, startError,
      subscribeLive: () => () => {}, stream: () => null, pipelineInfo: () => null,
      compareTrackers: async () => null, setExposure: async () => null,
    };
    return createElement(CameraSetup, { camera, onContinue: () => {}, onSkip: () => {} });
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(createElement(Harness)); });
  const enable = [...host.querySelectorAll('button')].find((b) => /Enable camera/.test(b.textContent ?? ''));
  expect(enable).toBeTruthy();
  await act(async () => { enable!.click(); });
  return host;
}

describe('camera setup failure screen', () => {
  it('shows the reason start() recorded, read from the current props', async () => {
    const host = await render('failed');
    const box = host.querySelector('[data-testid="camera-start-error"]');
    expect(box?.textContent).toMatch(/could not be started/);
    expect(host.querySelector('[data-testid="camera-start-details"]')?.textContent).toBe(` Details: ${REASON}`);
  });

  it('adds no Details line to a permission refusal', async () => {
    const host = await render('denied');
    expect(host.querySelector('[data-testid="camera-start-error"]')?.textContent).toMatch(/permission was denied/);
    expect(host.querySelector('[data-testid="camera-start-details"]')).toBeNull();
  });
});
