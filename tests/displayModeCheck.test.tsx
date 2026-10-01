/**
 * The display-mode check says only what is true.
 *
 * Round 63's review found the pre-flight warning claiming "every stimulus is drawn smaller than the
 * protocol size" whenever the app was not the installed launch — directly above the scale box saying
 * "full size (100%)", in a tab whose address bar was hidden — and telling the operator "the app is
 * open in a browser tab" when the browser had reported no mode at all. The size sentence follows the
 * applied scale; an unreported mode has its own words; the acknowledgement is required either way.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DisplayModeCheck } from '@/start/setupStages';
import type { DisplayMode } from '@/lib/viewportScale';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
function render(mode: DisplayMode | null, scale: number): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => {
    root.render(createElement(DisplayModeCheck, { mode, scale, acknowledged: false, onAcknowledge: () => {} }));
  });
  return host;
}
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

const text = (el: HTMLElement) => el.textContent ?? '';
const ack = (el: HTMLElement) => el.querySelector('[data-testid="display-mode-ack"]');

describe('DisplayModeCheck', () => {
  it('installed: a verdict and nothing to tick', () => {
    for (const mode of ['fullscreen', 'standalone'] as const) {
      const el = render(mode, 1);
      expect(text(el)).toContain('installed, full-screen — correct');
      expect(ack(el)).toBeNull();
    }
  });

  it('a tab drawn at 0.90 says the stimuli are smaller, and by how much', () => {
    const el = render('browser', 0.9);
    expect(text(el)).toContain('display mode: browser');
    expect(text(el)).toContain('open in a browser tab or window');
    expect(text(el)).toContain('drawn smaller than the protocol size (90%)');
    expect(ack(el)).not.toBeNull();
  });

  it('a tab at full size does not claim the stimuli are smaller', () => {
    const el = render('browser', 1);
    expect(text(el)).not.toContain('drawn smaller than the protocol size');
    expect(text(el)).toContain('at its protocol size on this screen at the moment');
    // Still required: the address bar can come back mid-sitting.
    expect(ack(el)).not.toBeNull();
    expect(text(el)).toContain('may not be at their protocol size');
    expect(text(el)).not.toContain('will not be');
  });

  it('an unreported mode is not called a browser tab', () => {
    const el = render(null, 1);
    expect(text(el)).toContain('Display mode not reported');
    expect(text(el)).not.toContain('open in a browser tab');
    expect(text(el)).toContain('cannot be confirmed');
    expect(text(el)).toContain('not confirmed to be the installed app');
    expect(ack(el)).not.toBeNull();
    const small = render(null, 0.9);
    expect(text(small)).toContain('drawn at 90% of its protocol size');
  });
});
