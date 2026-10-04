/**
 * Pre-flight's ruler check gates Continue, and reports only what was measured.
 *
 * Continue is given for a plausible measurement or for a written acknowledgement that none was taken
 * — never for nothing — and a viewing distance in range is always required. A reading taken at one
 * display scale is refused once the bar has been redrawn at another. Rendered for real in jsdom.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScreenCalibration, type ScreenCalibrationResult } from '@/start/ScreenCalibration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

function mount(scale = 1, screen: string | null = '1152x720') {
  const last: { r: ScreenCalibrationResult | null } = { r: null };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const render = (s: number) => act(() => {
    root.render(createElement(ScreenCalibration, { scale: s, screen, onChange: (r) => { last.r = r; } }));
  });
  render(scale);
  const q = (id: string) => host.querySelector(`[data-testid=${id}]`) as HTMLInputElement | null;
  const type = (id: string, v: string) => act(() => {
    const el = q(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const tick = (id: string) => act(() => { q(id)!.click(); });
  return { last, q, type, tick, render, text: () => host.textContent ?? '' };
}

describe('ScreenCalibration', () => {
  it('draws the bar at 500 design px and asks for it in millimetres, distance prefilled at 55', () => {
    const m = mount();
    expect((m.q('calibration-bar') as unknown as HTMLElement).style.width).toBe('500px');
    expect(m.q('viewing-distance')!.value).toBe('55');
    expect(m.text()).toMatch(/about 102\.8 mm/);
    // Nothing measured, nothing acknowledged: no Continue.
    expect(m.last.r!.ok).toBe(false);
  });

  it('accepts a plausible reading and reports what follows from it', () => {
    const m = mount();
    m.type('calibration-bar-mm', '102.75');
    expect(m.last.r).toMatchObject({ ok: true, skipped: false, viewingDistanceCm: 55 });
    expect(m.last.r!.calibration!.mmPerCssPx).toBeCloseTo(0.2055, 6);
    expect(m.q('calibration-result')!.textContent).toMatch(/14\.9′ of arc at 55 cm/);
    // The skip box is not offered once a measurement is in.
    expect(m.q('calibration-skip-ack')).toBeNull();
  });

  it('refuses a misread ruler, and offers the acknowledged skip instead', () => {
    const m = mount();
    m.type('calibration-bar-mm', '10.3');
    expect(m.q('calibration-range-error')).not.toBeNull();
    expect(m.last.r!.ok).toBe(false);
    m.tick('calibration-skip-ack');
    expect(m.last.r).toMatchObject({ ok: true, skipped: true, calibration: null });
  });

  it('requires a distance in range whatever else is done', () => {
    const m = mount();
    m.type('calibration-bar-mm', '102.75');
    m.type('viewing-distance', '30');
    expect(m.last.r!.ok).toBe(false);
    m.type('viewing-distance', '58,5');
    expect(m.last.r).toMatchObject({ ok: true, viewingDistanceCm: 58.5 });
  });

  it('a reading taken at one scale is refused once the bar is redrawn at another', () => {
    const m = mount(1.66, '1920x1200');
    m.type('calibration-bar-mm', '102.3');
    expect(m.last.r!.calibration!.scale).toBe(1.66);
    m.render(1.56);                         // the address bar came back
    expect(m.q('calibration-stale')).not.toBeNull();
    expect(m.last.r!.ok).toBe(false);
    m.type('calibration-bar-mm', '96.2');
    expect(m.last.r!.calibration!.scale).toBe(1.56);
    expect(m.last.r!.ok).toBe(true);
  });

  it('says when a plausible reading does not look like the study tablet', () => {
    const m = mount();
    m.type('calibration-bar-mm', '130');
    expect(m.last.r!.ok).toBe(true);
    expect(m.q('calibration-panel-note')!.textContent).toMatch(/27% longer/);
  });
});
