/**
 * The system Back gesture is the top-left chip of the screen it is made on, never a way out of the app
 * (lib/systemBack.ts; Round 87, audit 86 F6). The module on jsdom's own history — history.back() is a
 * same-document traversal there, with a popstate, as Back is in the app — and the two components that
 * claim the gesture on every screen, the chip and the confirmation dialog, rendered for real.
 * e2e/systemBack.spec.ts drives it through a sitting in the browser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { claimSystemBack, installSystemBack, resetSystemBack } from '@/lib/systemBack';
import { NavChip } from '@/components/NavChip';
import { useDialog, type DialogApi } from '@/components/ConfirmDialog';
import { resetTapGuard } from '@/lib/tapGuard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The gesture: a traversal back one entry, and the popstate it fires. */
async function back() {
  await act(async () => {
    history.back();
    await new Promise((r) => setTimeout(r, 20));
  });
}
const onAppEntry = () => {
  const s = history.state as Record<string, unknown> | null;
  return s != null && typeof s.visulabBack === 'string';
};

let uninstall: () => void = () => {};
let releases: Array<() => void> = [];
const claim = (...a: Parameters<typeof claimSystemBack>) => { const r = claimSystemBack(...a); releases.push(r); return r; };
beforeEach(() => {
  resetSystemBack();
  resetTapGuard();
  // Every test starts on an entry that is not the app's own, as the app is opened.
  history.replaceState(null, '');
  uninstall = installSystemBack(window);
});
afterEach(() => {
  for (const r of releases) r();
  releases = [];
  uninstall();
  resetSystemBack();
});

describe('the system Back guard', () => {
  it('pushes nothing until a screen claims Back, then keeps one entry of the app’s own on top', async () => {
    const before = history.length;
    expect(onAppEntry()).toBe(false);
    const run = vi.fn();
    claim('control', run);
    expect(history.length).toBe(before + 1);
    expect(onAppEntry()).toBe(true);
    // A second claim does not push a second entry.
    claim('screen', () => {});
    expect(history.length).toBe(before + 1);
    await back();
    expect(run).toHaveBeenCalledTimes(1);
    // Put back for the next Back, which is caught as well.
    expect(onAppEntry()).toBe(true);
    await back();
    expect(run).toHaveBeenCalledTimes(2);
    expect(onAppEntry()).toBe(true);
  });

  it('gives Back to the topmost claim: a notice over a dialog over a chip over the screen, whatever order they came in', async () => {
    const chip = vi.fn();
    const dialog = vi.fn();
    const screen = vi.fn();
    // A child's effect runs before its parent's: the chip claims before the screen that draws it.
    claim('control', chip);
    claim('screen', screen);
    await back();
    expect(chip).toHaveBeenCalledTimes(1);
    expect(screen).not.toHaveBeenCalled();
    const releaseDialog = claim('dialog', dialog);
    await back();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(chip).toHaveBeenCalledTimes(1);
    // A blocking notice covers the chip and any dialog: Back does nothing under it, and keeps the entry.
    const releaseNotice = claim('notice', () => {});
    await back();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(chip).toHaveBeenCalledTimes(1);
    expect(onAppEntry()).toBe(true);
    releaseNotice();
    releaseDialog();
    await back();
    expect(chip).toHaveBeenCalledTimes(2);
  });

  it('gives Back, within one layer, to the latest claim', async () => {
    const first = vi.fn();
    const second = vi.fn();
    claim('control', first);
    const release = claim('control', second);
    await back();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    release();
    await back();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('leaves Back to the browser where nothing claims it (the landing page), and takes it again with the next claim', async () => {
    const release = claim('control', () => {});
    const len = history.length;
    release();
    await back();
    // Nothing put back: the next Back is the browser's — on the tablet, the app closing from its first screen.
    expect(onAppEntry()).toBe(false);
    expect(history.length).toBe(len);
    const run = vi.fn();
    claim('control', run);
    expect(onAppEntry()).toBe(true);
    await back();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not take a sentinel an earlier load of the page left for its own: after a reload a new one is pushed over it', async () => {
    // A reload keeps the entry and its state; the entry beneath it belonged to the document that went.
    history.replaceState({ visulabBack: 'an-earlier-load' }, '');
    const len = history.length;
    const run = vi.fn();
    claim('control', run);
    expect(history.length).toBe(len + 1);
    await back();
    // Back from this load's sentinel lands on the old one — this document's now — and is caught.
    expect(run).toHaveBeenCalledTimes(1);
    expect(onAppEntry()).toBe(true);
  });
});

describe('the components that claim it', () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  let api: DialogApi | null = null;
  function render(node: ReturnType<typeof createElement>) {
    if (!host) {
      host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
    }
    act(() => { root!.render(node); });
  }
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null; host = null; api = null;
  });

  it('Back is what a tap on the top-left chip does; a disabled chip makes it nothing', async () => {
    const onClick = vi.fn();
    render(createElement(NavChip, { label: 'Exit — resume later', onClick }));
    await back();
    expect(onClick).toHaveBeenCalledTimes(1);
    render(createElement(NavChip, { label: 'Exit — resume later', onClick, disabled: true }));
    await back();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onAppEntry()).toBe(true);
    // The handler Back runs is the chip's latest, not the one it was first drawn with.
    const later = vi.fn();
    render(createElement(NavChip, { label: 'Pause', onClick: later }));
    await back();
    expect(later).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Back over an open confirmation declines it — as Escape does — and never reaches the chip under it', async () => {
    const chip = vi.fn();
    function Screen() {
      api = useDialog();
      return createElement(Fragment, null, createElement(NavChip, { label: 'Pause', onClick: chip }), api.element);
    }
    render(createElement(Screen));
    let answer!: Promise<boolean>;
    act(() => { answer = api!.confirm({ title: 'Pause and exit to the session manager?', confirmLabel: 'Pause and exit', cancelLabel: 'Keep going' }); });
    expect(document.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    await back();
    await expect(answer).resolves.toBe(false);
    expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    expect(chip).not.toHaveBeenCalled();
    // Closed, the chip has Back again.
    await back();
    expect(chip).toHaveBeenCalledTimes(1);
  });
});
