/**
 * "Tick all" on the pre-flight room-and-device list (Round 78, the investigator's request).
 *
 * One button ticks the seven researcher checks at once, only after the researcher confirms in words
 * that each was checked; cancelling leaves the list as it was; ticking one by one still works. That
 * the sitting records which way the list was ticked (preflight_bulk_ticked) is checked end to end in
 * e2e/preflightTickAll.spec.ts, and its export column in tests/export.test.ts.
 *
 * Rendered for real in jsdom.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/swUpdate', () => ({
  onUpdateWaiting: (l: (w: boolean) => void) => { l(false); return () => {}; },
  isUpdateWaiting: () => false,
  checkForUpdate: async () => 'current',
  applyUpdate: async () => {},
  installUpdateWatch: async () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

async function renderPreflight() {
  const { Preflight, PREFLIGHT_ITEMS } = await import('@/start/setupStages');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(createElement(Preflight, { onDone: () => {} })); });
  /** The list's own checkboxes, found by their item text: not the display-mode or ruler acknowledgements. */
  const boxes = () => PREFLIGHT_ITEMS.map((item) => {
    const label = [...host.querySelectorAll('label')].find((l) => l.textContent === item);
    expect(label, item).toBeDefined();
    return label!.querySelector('input[type="checkbox"]') as HTMLInputElement;
  });
  const button = () => host.querySelector('[data-testid="preflight-tick-all"]') as HTMLButtonElement;
  const press = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); };
  return { host, boxes, button, press, n: PREFLIGHT_ITEMS.length };
}

describe('pre-flight: Tick all', () => {
  it('asks first, in words, and ticks nothing when the researcher goes back', async () => {
    const { boxes, button, press } = await renderPreflight();
    expect(boxes().every((b) => !b.checked)).toBe(true);
    expect(button().textContent).toBe('Tick all');
    await press(button());
    const dialog = document.querySelector('[data-testid="preflight-tick-all-dialog"]');
    expect(dialog?.textContent).toMatch(/Only if you have checked each of the 7 items/);
    expect(document.querySelector('[data-testid="confirm-ok"]')?.textContent).toBe('I have checked each of these');
    await press(document.querySelector('[data-testid="confirm-cancel"]'));
    expect(document.querySelector('[data-testid="preflight-tick-all-dialog"]')).toBeNull();
    expect(boxes().every((b) => !b.checked)).toBe(true);
  });

  it('ticks every item of the list once confirmed, and only those', async () => {
    const { host, boxes, button, press, n } = await renderPreflight();
    const others = () => [...host.querySelectorAll('input[type="checkbox"]')].filter((b) => !boxes().includes(b as HTMLInputElement)) as HTMLInputElement[];
    const before = others().map((b) => b.checked);
    await press(button());
    await press(document.querySelector('[data-testid="confirm-ok"]'));
    expect(boxes().filter((b) => b.checked)).toHaveLength(n);
    // The single acknowledgements (display mode, skipping the ruler check) are never ticked for you.
    expect(others().map((b) => b.checked)).toEqual(before);
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe('All ticked');
  });

  it('still lets each item be ticked and unticked by hand', async () => {
    const { boxes, button, press } = await renderPreflight();
    await press(boxes()[2]);
    expect(boxes()[2].checked).toBe(true);
    expect(document.querySelector('[data-testid="preflight-tick-all-dialog"]')).toBeNull();
    for (const b of boxes()) if (!b.checked) await press(b);
    expect(boxes().every((b) => b.checked)).toBe(true);
    expect(button().disabled).toBe(true);
    await press(boxes()[0]);
    expect(boxes()[0].checked).toBe(false);
    expect(button().disabled).toBe(false);
  });
});
