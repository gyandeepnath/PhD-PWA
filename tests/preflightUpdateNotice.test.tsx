/**
 * A newer build waiting is said at the TOP of pre-flight, and pre-flight never offers to apply it.
 *
 * The investigator reported that "the PWA versions keep updating, the version remains the same". The
 * build identity now says which build is running (lib/env.ts buildIdentity); a waiting build has to be
 * seen too. On the landing page UpdateBanner offers it, gated on no sitting being open. Pre-flight is
 * always inside a sitting, so it cannot offer the button — applying an update reloads every window —
 * but an operator who walked past the landing page must still learn of it before the participant
 * starts. The notice used to sit inside the device box, half-way down the left column (Round 74).
 *
 * Rendered for real in jsdom, with the update watch reporting a waiting build.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let waiting = false;
vi.mock('@/lib/swUpdate', () => ({
  onUpdateWaiting: (l: (w: boolean) => void) => { l(waiting); return () => {}; },
  isUpdateWaiting: () => waiting,
  checkForUpdate: async () => (waiting ? 'waiting' : 'current'),
  applyUpdate: async () => { throw new Error('pre-flight must never apply an update'); },
  installUpdateWatch: async () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

async function renderPreflight(): Promise<HTMLElement> {
  const { Preflight } = await import('@/start/setupStages');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(createElement(Preflight, { onDone: () => {} })); });
  return host;
}

describe('pre-flight and a waiting build', () => {
  it('says a newer build is waiting, above everything the operator has to check', async () => {
    waiting = true;
    const host = await renderPreflight();
    const notice = host.querySelector('[data-testid="preflight-update-waiting"]');
    expect(notice, 'no notice of the waiting build').not.toBeNull();
    expect(notice!.textContent).toContain('A newer build of VisuLab is installed and waiting');
    expect(notice!.textContent).toContain('cannot be applied while a sitting is open');
    // Above the first machine check, the device box and the ruler check — not buried among them.
    for (const id of ['storage-health', 'device-box', 'calibration-box']) {
      const el = host.querySelector(`[data-testid="${id}"]`);
      expect(el, id).not.toBeNull();
      expect(notice!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING, `${id} is above the notice`).toBeTruthy();
    }
    // And no way to apply it from inside a sitting.
    const buttons = [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.some((t) => /update now/i.test(t))).toBe(false);
  });

  it('says nothing when no build is waiting', async () => {
    waiting = false;
    const host = await renderPreflight();
    expect(host.querySelector('[data-testid="preflight-update-waiting"]')).toBeNull();
    // The build is still named, with the check beside it.
    expect(host.querySelector('[data-testid="preflight-build"]')?.textContent).toMatch(/^VisuLab /);
    expect(host.querySelector('[data-testid="update-check"]')).not.toBeNull();
  });
});
