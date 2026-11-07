/**
 * Every way past camera set-up without the camera says why, and the export carries it (audit 86 CAM-3).
 *
 * "Continue without camera" on the running preview stopped the camera and told nobody: the tracker
 * still read 'active', calibration and the camera check ran on no frames, and the reading rows were
 * written camera_active TRUE with nothing measured. The other ways past without the camera — before
 * starting it, or after it could not start — were not recorded anywhere either. Camera set-up now hands
 * the reason to the sitting (SessionRecord.camera_off), and 01_session_info.csv exports it.
 *
 * Rendered for real in jsdom, with the tracker reduced to the narrow interface the screen uses.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act, useState, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CameraSetupTracking } from '@/start/setupStages';
import type { CameraOffReason, CameraStatus } from '@/storage/types';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { splitCsvRow } from './helpers/csv';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

/** Camera set-up with a tracker whose start() ends as `result`; records stop() and onSkip calls. */
async function render(result: CameraStatus) {
  const { CameraSetup } = await import('@/start/setupStages');
  const stop = vi.fn();
  const skips: Array<[CameraOffReason, string | null]> = [];
  function Harness() {
    const [status, setStatus] = useState<CameraStatus>('unavailable');
    const [startError, setStartError] = useState<string | null>(null);
    const start = useCallback(async () => {
      if (result !== 'active') setStartError(`${result}: the reason`);
      setStatus(result);
      return result;
    }, []);
    const camera: CameraSetupTracking = {
      status, start, stop, startError,
      subscribeLive: () => () => {}, stream: () => null,
      // A tracker frozen by configuration is not measured on the preview, so its buttons are enabled at once.
      pipelineInfo: () => null,
      compareTrackers: async () => null, setExposure: async () => null, runBench: async () => null,
    };
    return createElement(CameraSetup, { camera, onContinue: () => {}, onSkip: (r: CameraOffReason, e: string | null) => { skips.push([r, e]); } });
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(createElement(Harness)); });
  const button = (re: RegExp) => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))!;
  return { host, stop, skips, button };
}

describe('camera set-up: going on without the camera records why (audit 86 CAM-3)', () => {
  it('before starting it: skipped_before_start, and nothing to stop', async () => {
    const r = await render('active');
    await act(async () => { r.button(/Continue without camera/).click(); });
    expect(r.skips).toEqual([['skipped_before_start', null]]);
    expect(r.stop).not.toHaveBeenCalled();
  });

  it('from the running preview: the camera is stopped first, and the reason is skipped_after_start', async () => {
    const r = await render('active');
    await act(async () => { r.button(/Enable camera/).click(); });
    expect(r.host.querySelector('[data-testid="camera-diagnostics"]')).not.toBeNull();
    await act(async () => { r.button(/Continue without camera/).click(); });
    expect(r.stop).toHaveBeenCalledTimes(1);
    expect(r.skips).toEqual([['skipped_after_start', null]]);
  });

  it.each([
    ['denied', 'permission_denied'],
    ['failed', 'start_failed'],
    ['unavailable', 'unavailable'],
  ] as const)('after a start that ended %s: %s, with the reason the start gave', async (result, reason) => {
    const r = await render(result);
    await act(async () => { r.button(/Enable camera/).click(); });
    await act(async () => { r.button(/Continue without camera/).click(); });
    expect(r.skips).toEqual([[reason, `${result}: the reason`]]);
  });
});

describe('01_session_info.csv camera_off_reason', () => {
  const s01 = (b: ReturnType<typeof buildFixtureBundle>) => {
    const lines = buildExportFiles(b).find((f) => f.filename === '01_session_info.csv')!.content.trim().split('\n');
    const head = splitCsvRow(lines[0]);
    const row = splitCsvRow(lines[1]);
    return Object.fromEntries(head.map((h, i) => [h, row[i]]));
  };

  it('says why the camera was off, and is blank when it ran or the sitting predates it', () => {
    const b = buildFixtureBundle();
    b.session.camera_off = { reason: 'skipped_after_start', at: 1, error: null };
    expect(s01(b).camera_off_reason).toBe('skipped_after_start');
    b.session.camera_off = null;
    expect(s01(b).camera_off_reason).toBe('');
    delete b.session.camera_off;
    expect(s01(b).camera_off_reason).toBe('');
  });

  it('is in the codebook with every level the record can hold', () => {
    const entry = CODEBOOK.find((c) => c.file === '01_session_info.csv' && c.column === 'camera_off_reason');
    expect(entry).toBeTruthy();
    const levels: CameraOffReason[] = ['consent_declined', 'skipped_before_start', 'skipped_after_start', 'permission_denied', 'start_failed', 'unavailable'];
    for (const l of levels) expect(entry!.description).toContain(l);
    expect(entry!.type).toBe(`factor(${levels.length})`);
  });
});
