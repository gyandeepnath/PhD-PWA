/**
 * A touch that starts as the screen changes was aimed at the screen that went (lib/tapGuard.ts, Round
 * 86, audit 86 F8, F11, M1, M2). The guard itself, driven with synthetic touches on a faked clock; and
 * two of the screens the audit found taking a carried tap, rendered for real in jsdom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TAP_GUARD_MS, CONSENT_TAP_GUARD_MS, TAP_GUARD_VERSION, TAP_GUARD_VERSION_V1, armTapGuard, installTapGuard, resetTapGuard,
} from '@/lib/tapGuard';
import { IshiharaTest } from '@/screening/IshiharaTest';
import { Consent } from '@/start/setupStages';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { splitCsvRow } from './helpers/csv';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A pointer event of `type` from a finger (or a mouse), stamped `at` on the performance clock. */
function pointer(type: string, at: number, pointerType = 'touch'): Event {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'pointerId', { value: pointerType === 'mouse' ? 1 : 7 });
  Object.defineProperty(e, 'timeStamp', { value: at });
  return e;
}
function plain(type: string, at: number): Event {
  const e = type.startsWith('touch') ? new Event(type, { bubbles: true, cancelable: true }) : new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'timeStamp', { value: at });
  return e;
}

/** What a tap is, as Chrome delivers it: pointer, touch, then the mouse events and the click it makes. */
function tap(el: Element, at: number, pointerType = 'touch') {
  act(() => {
    el.dispatchEvent(pointer('pointerdown', at, pointerType));
    if (pointerType !== 'mouse') el.dispatchEvent(plain('touchstart', at));
    el.dispatchEvent(pointer('pointerup', at + 60, pointerType));
    if (pointerType !== 'mouse') el.dispatchEvent(plain('touchend', at + 60));
    el.dispatchEvent(plain('mousedown', at + 62));
    el.dispatchEvent(plain('mouseup', at + 62));
    el.dispatchEvent(plain('click', at + 63));
  });
}

let uninstall: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  resetTapGuard();
  uninstall = installTapGuard(window);
});
afterEach(() => {
  uninstall();
  resetTapGuard();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the tap guard', () => {
  /** A button and a log of what reached it. */
  function target() {
    const b = document.createElement('button');
    document.body.appendChild(b);
    const got: string[] = [];
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
      b.addEventListener(type, () => got.push(type));
    }
    return { b, got };
  }

  it('drops a whole touch that starts inside the window after a screen change, and nothing outside it', () => {
    const { b, got } = target();
    const t0 = performance.now();
    armTapGuard(TAP_GUARD_MS, t0);
    tap(b, t0 + 130); // the second tap of a double tap, 130 ms after the screen it lands on appeared
    expect(got).toEqual([]);
    tap(b, t0 + TAP_GUARD_MS + 1);
    expect(got).toEqual(['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click']);
  });

  it('a dropped click does not reach a label: the checkbox under it stays unticked', () => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    label.appendChild(box);
    label.appendChild(document.createTextNode('Use the camera'));
    document.body.appendChild(label);
    const t0 = performance.now();
    armTapGuard(TAP_GUARD_MS, t0);
    tap(label, t0 + 130);
    expect(box.checked).toBe(false);
    tap(label, t0 + 2000);
    expect(box.checked).toBe(true);
  });

  it('drops the rest of a touch that began on a screen that has since gone', () => {
    const { b, got } = target();
    const t0 = performance.now();
    act(() => { b.dispatchEvent(pointer('pointerdown', t0)); });
    expect(got).toEqual(['pointerdown']); // nothing armed yet: the old screen takes it
    armTapGuard(TAP_GUARD_MS, t0 + 50); // the screen changes under the finger
    act(() => {
      b.dispatchEvent(pointer('pointerup', t0 + 900));
      b.dispatchEvent(plain('click', t0 + 902));
    });
    expect(got).toEqual(['pointerdown']);
  });

  it('never touches a mouse: the test suite clicks through screens faster than any participant', () => {
    const { b, got } = target();
    const t0 = performance.now();
    armTapGuard(TAP_GUARD_MS, t0);
    tap(b, t0 + 10, 'mouse');
    expect(got).toEqual(['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']);
  });

  it('a touch let through reaches the app unchanged: same event, same timestamp', () => {
    const b = document.createElement('button');
    document.body.appendChild(b);
    const seen: number[] = [];
    b.addEventListener('pointerdown', (e) => seen.push(e.timeStamp));
    const t0 = performance.now();
    armTapGuard(TAP_GUARD_MS, t0);
    const e = pointer('pointerdown', t0 + 731.25);
    act(() => { b.dispatchEvent(e); });
    expect(seen).toEqual([t0 + 731.25]);
    expect(e.defaultPrevented).toBe(false);
  });

  it('a longer hold (the consent screen) is not cut short by a shorter one armed in the same commit', () => {
    const { b, got } = target();
    const t0 = performance.now();
    armTapGuard(CONSENT_TAP_GUARD_MS, t0);
    armTapGuard(TAP_GUARD_MS, t0); // the stage change, armed by Experiment after the screen's own
    tap(b, t0 + 800);
    expect(got).toEqual([]);
    tap(b, t0 + CONSENT_TAP_GUARD_MS + 1);
    expect(got).toContain('click');
  });
});

describe('the guard can never hold over a reaction-task stimulus', () => {
  /*
   * Armed by the "Start" tap's hand-over, the guard must end inside the first trial's FIXED fixation,
   * before the foreperiod's delay begins: then no dot, and no false start in the delay, can fall in it.
   */
  it('on the device, and under the test harness, which keeps the device fixation for this reason', async () => {
    vi.useRealTimers();
    const device = await import('@/experiment/config');
    expect(device.CONFIG.RT_FIXATION_MIN_MS).toBe(400);
    expect(TAP_GUARD_MS).toBeLessThan(device.CONFIG.RT_FIXATION_MIN_MS);
    expect(TAP_GUARD_MS).toBeLessThan(device.CONFIG.RT_FIXATION_MIN_MS + device.CONFIG.RT_DELAY_MIN_MS);
    vi.resetModules();
    vi.stubGlobal('location', { search: '?e2e=1' });
    try {
      const harness = await import('@/experiment/config');
      expect(harness.isE2ETimingActive()).toBe(true);
      expect(TAP_GUARD_MS).toBeLessThan(harness.CONFIG.RT_FIXATION_MIN_MS);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('screens that took a carried tap (audit 86)', () => {
  function mount(el: ReturnType<typeof createElement>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(el); });
    return { host, unmount: () => act(() => root.unmount()) };
  }
  const digit = (host: HTMLElement, d: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === d)!;
  const counter = (host: HTMLElement) => host.textContent!.match(/Colour-vision screening · (\d+)\/(\d+)/)!.slice(1).map(Number);

  it('colour vision: a double tap on a digit answers one plate, not two (F11)', () => {
    const m = mount(createElement(IshiharaTest, { seed: 101, onComplete: () => {}, onDone: () => {} }));
    vi.advanceTimersByTime(2000); // the first plate has been looked at
    expect(counter(m.host)[0]).toBe(1);
    const t = performance.now();
    tap(digit(m.host, '8'), t);
    expect(counter(m.host)[0]).toBe(2);
    tap(digit(m.host, '8'), t + 140); // same button, same place, on the plate just drawn
    expect(counter(m.host)[0]).toBe(2); // it used to read 3: plate 2 answered unseen
    vi.advanceTimersByTime(1500);
    tap(digit(m.host, '3'), performance.now()); // a deliberate answer, once the plate has been seen
    expect(counter(m.host)[0]).toBe(3);
    m.unmount();
  });

  it('consent: a touch in the screen\'s first second ticks nothing; a later one ticks what it touches (F8)', () => {
    const m = mount(createElement(Consent, { onConsent: () => {} }));
    const camera = m.host.querySelector('[data-testid="consent-camera"]') as HTMLInputElement;
    const row = camera.closest('label')!;
    const t = performance.now();
    tap(row, t + 130); // the second tap of a double tap on "Begin setup", which sat over this row
    expect(camera.checked).toBe(false);
    tap(row, t + 700); // a slower second press is still inside the consent screen's hold
    expect(camera.checked).toBe(false);
    vi.advanceTimersByTime(5000);
    tap(row, performance.now());
    expect(camera.checked).toBe(true);
    m.unmount();
  });
});

describe('the record: tap_guard_version', () => {
  /*
   * What reaches a task changed (trial 1 of the reaction task, the search's first touches), so every
   * condition row says which rule its touches were taken under; rows from before it are named, not blank.
   */
  it('is stamped on every condition the sitting starts', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/experiment/Experiment.tsx'), 'utf8');
    expect(src).toMatch(/tap_guard_version: TAP_GUARD_VERSION,/);
    expect(TAP_GUARD_VERSION).not.toBe(TAP_GUARD_VERSION_V1);
  });

  it(`is exported in 02_conditions.csv, ${TAP_GUARD_VERSION_V1} where a row has none`, () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => (i === 0 ? { ...c, tap_guard_version: TAP_GUARD_VERSION } : { ...c, tap_guard_version: undefined }));
    const file = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!;
    const [head, ...rows] = file.content.trim().split('\n').map(splitCsvRow);
    const col = (r: string[]) => r[head.indexOf('tap_guard_version')];
    expect(head).toContain('tap_guard_version');
    expect(col(rows[0])).toBe(TAP_GUARD_VERSION);
    expect(col(rows[1])).toBe(TAP_GUARD_VERSION_V1);
  });
});
