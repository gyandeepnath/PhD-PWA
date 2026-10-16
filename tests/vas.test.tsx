/**
 * The visual analogue lines of the fatigue and display-perception ratings (Round 84, scales/vas.ts).
 *
 * What is held here: no marker and no value until the participant touches a line (null, not 0); a tap
 * places the answer where it lands and a drag moves it; nothing on the screen ever shows a number for
 * it; Continue waits for every line; the stored values keep their old scales (fatigue 0-10 in tenths,
 * comfort and clarity 0-100), with the format and the drawn length beside them; and the line is 100 mm
 * at this sitting's millimetres per pixel. Rendered for real in jsdom, with the line's on-screen box
 * stubbed (jsdom lays nothing out).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement, act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { FatigueScale, type FatigueResult } from '@/scales/FatigueScale';
import { DisplayPerceptionRating, type PerceptionResult } from '@/scales/DisplayPerceptionRating';
import { drawnLineMm, rowSliderVersion, SLIDER_VERSION, SLIDER_VERSION_V1, vasLineCssPx, vasMm, VAS_LINE_MM } from '@/scales/vas';
import { DOCUMENTED_MM_PER_CSS_PX, STUDY_TABLET_PANEL_LONG_MM } from '@/lib/physicalCalibration';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Where the stubbed line sits on screen, in CSS px. */
const LINE = { left: 100, width: 500 };
const original = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-vas-line')) {
      return { left: LINE.left, width: LINE.width, right: LINE.left + LINE.width, top: 0, bottom: 3, height: 3, x: LINE.left, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
});

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
  for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); }
});

async function render(el: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(el); });
  return host;
}

/** A pointer event at `fraction` of the way along the stubbed line. */
async function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', fraction: number) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: LINE.left + fraction * LINE.width }));
  });
}

const continueButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent ?? '')) as HTMLButtonElement;

/** A sitting whose ruler gave 0.2 mm per CSS px: the 100 mm line is 500 CSS px. */
const MEASURED = { mm_per_css_px: 0.2, device_pixel_ratio: 1 };

describe('vas.ts', () => {
  it('reads a position as whole millimetres of the 100 mm line, clamped to its ends', () => {
    expect(VAS_LINE_MM).toBe(100);
    expect(vasMm(0)).toBe(0);
    expect(vasMm(0.374)).toBe(37);
    expect(vasMm(0.375)).toBe(38);
    expect(vasMm(1)).toBe(100);
    // A tap past an end (the target overshoots the line a little) is that end.
    expect(vasMm(-0.04)).toBe(0);
    expect(vasMm(1.03)).toBe(100);
    expect(vasMm(Number.NaN)).toBe(0);
  });

  it('draws 100 mm at the ruler measurement, and says when it used a fallback instead', () => {
    expect(vasLineCssPx(MEASURED, 1)).toEqual({ cssPx: 500, source: 'measured' });
    // No ruler: the study tablet's panel over the reported screen width — 0.2055 mm at 1152 px.
    const panel = vasLineCssPx({ screen_resolution: '1152x720' }, null);
    expect(panel.source).toBe('assumed_study_tablet_panel');
    expect(panel.cssPx).toBeCloseTo(100 / (STUDY_TABLET_PANEL_LONG_MM / 1152), 6);
    expect(vasLineCssPx({}, null)).toEqual({ cssPx: 100 / DOCUMENTED_MM_PER_CSS_PX, source: 'assumed_0.2055' });
  });

  it('records the length the line was drawn at, from its width on screen', () => {
    expect(drawnLineMm(500, MEASURED, 1)).toBe(100);
    expect(drawnLineMm(437.3, MEASURED, 1)).toBe(87.5);
    expect(drawnLineMm(0, MEASURED, 1)).toBeNull();
    expect(drawnLineMm(Number.NaN, MEASURED, 1)).toBeNull();
  });

  it('names rows from before Round 84 as the old sliders', () => {
    expect(SLIDER_VERSION).toBe('vas-v2');
    expect(rowSliderVersion({})).toBe(SLIDER_VERSION_V1);
    expect(rowSliderVersion({ slider_version: null })).toBe('sl-v1');
    expect(rowSliderVersion({ slider_version: 'vas-v2' })).toBe('vas-v2');
  });
});

describe('the fatigue scale as five visual analogue lines', () => {
  const ITEMS = ['eye_strain', 'dryness', 'blur', 'burning', 'headache'];

  it('opens with no marker, no value and Continue held, and never prints a number for an answer', async () => {
    let got: FatigueResult | null = null;
    const host = await render(createElement(FatigueScale, { prompt: 'How are your eyes?', physical: MEASURED, onComplete: (r) => { got = r; } }));
    for (const k of ITEMS) {
      const t = host.querySelector(`[data-testid="vas-${k}"]`)!;
      expect(t, k).not.toBeNull();
      expect(t.getAttribute('aria-valuetext')).toBe('not set');
      expect(host.querySelector(`[data-testid="vas-${k}-marker"]`), k).toBeNull();
    }
    expect(continueButton(host).disabled).toBe(true);
    expect(host.textContent).toMatch(/0 of 5 marked/);
    // Words at the ends, not numbers.
    expect(host.textContent).toMatch(/None/);
    expect(host.textContent).toMatch(/Severe/);
    expect(host.textContent).not.toMatch(/\/ 10|0 = none/);

    // A tap places the answer where it lands; a drag moves it; a later tap re-places it.
    const first = host.querySelector('[data-testid="vas-eye_strain"]')!;
    await pointer(first, 'pointerdown', 0.62);
    expect(first.getAttribute('data-value')).toBe('62');
    await pointer(first, 'pointermove', 0.41);
    await pointer(first, 'pointerup', 0.41);
    expect(first.getAttribute('data-value')).toBe('41');
    await pointer(first, 'pointermove', 0.9);   // not dragging any more: no change
    expect(first.getAttribute('data-value')).toBe('41');
    expect(host.querySelector('[data-testid="vas-eye_strain-marker"]')).not.toBeNull();
    // The answer is a mark on the line, never a figure on the screen.
    expect(host.textContent).not.toMatch(/\b41\b|4\.1/);
    expect(continueButton(host).disabled).toBe(true);

    const fractions = [0, 0.073, 1, 0.5];
    for (const [i, k] of ITEMS.slice(1).entries()) {
      const t = host.querySelector(`[data-testid="vas-${k}"]`)!;
      await pointer(t, 'pointerdown', fractions[i]);
      await pointer(t, 'pointerup', fractions[i]);
    }
    expect(continueButton(host).disabled).toBe(false);
    await act(async () => { continueButton(host).click(); });

    expect(got).not.toBeNull();
    const r = got as unknown as FatigueResult;
    // The old 0-10 scale, in tenths: whole millimetres divided by ten. 0 is a real answer here.
    expect(r.items).toEqual({ eye_strain: 4.1, dryness: 0, blur: 0.7, burning: 10, headache: 5 });
    expect(r.mean).toBeCloseTo((4.1 + 0 + 0.7 + 10 + 5) / 5, 10);
    expect(Object.values(r.touched).every(Boolean)).toBe(true);
    expect(r.sliderVersion).toBe('vas-v2');
    expect(r.lineMm).toBe(100);
    expect(r.lineSource).toBe('measured');
  });

  it('does not answer twice', async () => {
    let n = 0;
    const host = await render(createElement(FatigueScale, { prompt: 'p', physical: MEASURED, onComplete: () => { n += 1; } }));
    for (const k of ITEMS) await pointer(host.querySelector(`[data-testid="vas-${k}"]`)!, 'pointerdown', 0.3);
    await act(async () => { continueButton(host).click(); continueButton(host).click(); });
    expect(n).toBe(1);
  });
});

describe('the display-perception rating as two visual analogue lines', () => {
  it('stores comfort and clarity as whole millimetres, 0-100, with the format and the length', async () => {
    let got: PerceptionResult | null = null;
    const host = await render(createElement(DisplayPerceptionRating, {
      background: '#000000', text: '#C9A400', physical: { screen_resolution: '1152x720' }, onComplete: (r) => { got = r; },
    }));
    expect(host.querySelector('[data-testid="vas-comfort-marker"]')).toBeNull();
    expect(continueButton(host).disabled).toBe(true);
    expect(host.textContent).toMatch(/Very uncomfortable[\s\S]*Very comfortable[\s\S]*Very unclear[\s\S]*Very clear/);
    await pointer(host.querySelector('[data-testid="vas-comfort"]')!, 'pointerdown', 0.255);
    expect(continueButton(host).disabled).toBe(true);
    await pointer(host.querySelector('[data-testid="vas-clarity"]')!, 'pointerdown', 0.999);
    expect(host.textContent).not.toMatch(/\b26\b|\b100\b/);
    await act(async () => { continueButton(host).click(); });
    const r = got as unknown as PerceptionResult;
    expect([r.comfort, r.clarity]).toEqual([26, 100]);
    expect([r.comfortTouched, r.clarityTouched]).toEqual([true, true]);
    expect(r.sliderVersion).toBe('vas-v2');
    expect(r.lineSource).toBe('assumed_study_tablet_panel');
    // 500 CSS px on screen at the panel's 0.2055 mm per px.
    expect(r.lineMm).toBeCloseTo(500 * (STUDY_TABLET_PANEL_LONG_MM / 1152), 1);
  });
});

describe('the analysis templates model one rating format at a time', () => {
  const R = readFileSync(resolve(__dirname, '..', 'src/analysis/analysis_template.R'), 'utf8');
  const PY = readFileSync(resolve(__dirname, '..', 'src/analysis/analysis_template.py'), 'utf8');

  it('name the same two formats as the app', () => {
    expect(/^SLIDER_VERSION {4}<- "([^"]+)"/m.exec(R)?.[1]).toBe(SLIDER_VERSION);
    expect(/^SLIDER_VERSION_V1 <- "([^"]+)"/m.exec(R)?.[1]).toBe(SLIDER_VERSION_V1);
    expect(/^SLIDER_VERSION = "([^"]+)"/m.exec(PY)?.[1]).toBe(SLIDER_VERSION);
    expect(/^SLIDER_VERSION_V1 = "([^"]+)"/m.exec(PY)?.[1]).toBe(SLIDER_VERSION_V1);
  });

  it('select the format before fitting fatigue (both) and comfort and clarity (R), and round the items half up for the cumulative-link model', () => {
    expect(R).toMatch(/fat <- rating_format\(fat, "fatigue"\)/);
    expect(R).toMatch(/perception <- rating_format\(keep_rows\(perception\), "comfort and clarity"\)/);
    expect(PY).toMatch(/fat = rating_format\(fat, "fatigue"\)/);
    // Half up (floor(x + 0.5)), as ANALYSIS_PLAN §4c states, not R's round() (half to even).
    expect(R).toMatch(/mutate\(rating = floor\(rating \+ 0\.5\)\)/);
  });
});
