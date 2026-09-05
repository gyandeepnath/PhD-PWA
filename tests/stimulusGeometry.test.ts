/**
 * The stimulus must differ between devices by uniform magnification and nothing else.
 *
 * That is what `stimulus_scale` claims. `01_session_info.csv` describes it as the visual-angle
 * factor, and the analysis codebook goes further: "Constant within a device; include it only if more
 * than one device was used." Both statements are only true if the layout is a SIMILARITY transform
 * of the design canvas — same shape, one scalar.
 *
 * It was not. `#root` is sized `calc(100% / var(--vl-scale))` in both axes while the scale is
 * `min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT)`, so one axis binds and the other over-fills: the root
 * box takes the DEVICE's aspect ratio, never the canvas's 1194/834 = 1.4317. Anything sized as a
 * percentage of the root then reflows by device at an unchanged `--vl-scale` and an unchanged glyph
 * size — invisible in the one covariate an analyst is told to use for exactly this.
 *
 * The reading passage was a percentage column. The reaction-time target was a percentage position
 * with a constant diameter. Both are now fixed in root pixels, and these tests hold them there.
 */
import { describe, it, expect } from 'vitest';
import {
  computeScale, STIMULUS_COLUMN_PX, STIMULUS_BOX, DESIGN_WIDTH, DESIGN_HEIGHT,
} from '@/lib/viewportScale';
import { CONFIG } from '@/experiment/config';

/** Tablets the study can plausibly run on, plus the design canvas and a large display. */
const DEVICES: [string, number, number][] = [
  ['design canvas', DESIGN_WIDTH, DESIGN_HEIGHT],
  ['Xiaomi Pad 6, bar hidden', 1152, 720],
  ['Xiaomi Pad 6, bar showing', 1152, 650],
  ['iPad 9.7', 1024, 768],
  ['Galaxy Tab', 1280, 800],
  ['1366x768 laptop', 1366, 768],
  ['2560x1600 display', 2560, 1600],
];

/** The root box in ROOT pixels: what `calc(100% / var(--vl-scale))` produces. */
const rootBox = (w: number, h: number) => {
  const s = computeScale(w, h);
  return { s, w: w / s, h: h / s };
};

describe('the root box is device-shaped — the fact everything here exists for', () => {
  it('does not preserve the design aspect ratio, on any real device but the canvas itself', () => {
    // Stated as a test rather than a comment because every fix below is only necessary while this
    // is true. If the root layout is ever changed to letterbox instead, this test fails and the
    // fixed-width columns can be reconsidered.
    const designAR = DESIGN_WIDTH / DESIGN_HEIGHT;
    const off = DEVICES
      .filter(([name]) => name !== 'design canvas')
      .map(([name, w, h]) => [name, rootBox(w, h)] as const)
      .filter(([, b]) => Math.abs(b.w / b.h - designAR) > 0.01);
    expect(off.length).toBeGreaterThan(0);
  });

  it('is never narrower or shorter than the design canvas on a device above the minimum', () => {
    // The fixed-width column and the target box both assume they fit. They do, because the scale is
    // the MINIMUM of the two ratios: w/s >= DESIGN_WIDTH and h/s >= DESIGN_HEIGHT follow directly.
    for (const [name, w, h] of DEVICES) {
      const b = rootBox(w, h);
      expect(b.w, `${name} root box is narrower than the canvas`).toBeGreaterThanOrEqual(DESIGN_WIDTH - 1e-6);
      expect(b.h, `${name} root box is shorter than the canvas`).toBeGreaterThanOrEqual(DESIGN_HEIGHT - 1e-6);
    }
  });
});

describe('reading line length is the same on every device', () => {
  it('is a constant number of root pixels, so characters per line do not vary', () => {
    /*
     * Before: the column was `padding: 56px 10% 3%` on a full-width root, i.e. 0.8 x rootWidth.
     * Measured against the design canvas's 955 px that gave +12.2% characters per line at 1152x720,
     * +27.0% at 1152x650, and +114% at 2560x1600 — where stimulus_scale reads 1.00, the same as the
     * design canvas. Line length is a first-order determinant of reading rate and regression
     * frequency, and both are dependent variables here.
     */
    for (const [name, w, h] of DEVICES) {
      const b = rootBox(w, h);
      const oldColumn = b.w * (1 - (2 * CONFIG.READING_MARGIN_PERCENT) / 100);
      const newColumn = Math.min(STIMULUS_COLUMN_PX, b.w);   // maxWidth: 100%
      expect(newColumn, `${name}`).toBe(STIMULUS_COLUMN_PX);
      // Sanity: the old behaviour really did vary, or this test proves nothing.
      if (name !== 'design canvas') expect(oldColumn).toBeGreaterThan(STIMULUS_COLUMN_PX);
    }
  });

  it('matches what the design canvas always produced, so nothing shifted for the reference device', () => {
    // 1194 x 0.8 = 955.2. Changing the reference would silently re-baseline the whole study.
    expect(STIMULUS_COLUMN_PX).toBe(Math.round(DESIGN_WIDTH * (1 - (2 * CONFIG.READING_MARGIN_PERCENT) / 100)));
  });

  it('scales with --vl-scale and only with it, which is what stimulus_scale records', () => {
    // The column in CSS pixels is the covariate's whole story now: one scalar per device.
    const cssWidth = (w: number, h: number) => STIMULUS_COLUMN_PX * computeScale(w, h);
    for (const [name, w, h] of DEVICES) {
      expect(cssWidth(w, h) / computeScale(w, h), name).toBeCloseTo(STIMULUS_COLUMN_PX, 6);
    }
  });
});

describe('the reaction-time target sits in a device-independent field', () => {
  const { RT_DOT_PX } = CONFIG;
  // The sampling window the task uses: x in 25..75, y in 28..72 percent.
  const MAX_X_PCT = 25;
  const MAX_Y_PCT = 22;

  const ratio = (boxW: number, boxH: number) => {
    const ex = (MAX_X_PCT / 100) * boxW;
    const ey = (MAX_Y_PCT / 100) * boxH;
    return RT_DOT_PX / Math.hypot(ex, ey);
  };

  it('keeps the size-to-eccentricity ratio identical across devices', () => {
    // Against the root box this ran 0.148 / 0.136 / 0.123 / 0.071 across the devices below. RT and
    // detection sensitivity are both monotone in eccentricity, so the spread entered the data as
    // device-driven variance in a dependent variable with no column identifying it.
    const fixed = ratio(STIMULUS_BOX.width, STIMULUS_BOX.height);
    for (const [name, w, h] of DEVICES) {
      const b = rootBox(w, h);
      const box = { w: Math.min(STIMULUS_BOX.width, b.w), h: Math.min(STIMULUS_BOX.height, b.h) };
      expect(ratio(box.w, box.h), name).toBeCloseTo(fixed, 9);
    }
  });

  it('really did vary against the root box, or the fix is solving nothing', () => {
    const seen = new Set(DEVICES.map(([, w, h]) => {
      const b = rootBox(w, h);
      return ratio(b.w, b.h).toFixed(4);
    }));
    expect(seen.size, 'the ratio was already constant, so this fix is unnecessary').toBeGreaterThan(1);
  });

  it('is the design canvas, so the reference device is unchanged', () => {
    expect(STIMULUS_BOX.width).toBe(DESIGN_WIDTH);
    expect(STIMULUS_BOX.height).toBe(DESIGN_HEIGHT);
  });
});
