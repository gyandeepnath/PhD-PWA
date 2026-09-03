/**
 * The design canvas must fit the device, or controls become unreachable.
 *
 * theme.css scales #root by --vl-scale, and #root is overflow:hidden while body is
 * touch-action:none — both deliberate, so a stimulus screen cannot be scrolled mid-exposure. The
 * consequence is that anything past the viewport is not merely off-screen, it cannot be reached by
 * any gesture. --vl-scale was never computed by anything, so every device rendered at the design
 * size and a shorter tablet lost its Continue buttons outright.
 *
 * The Xiaomi Pad 6 case below is the device that found this.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeScale, isBelowMinimum, foldViewportFloor, resetViewportFloor,
  DESIGN_WIDTH, DESIGN_HEIGHT, MIN_SCALE,
} from '@/lib/viewportScale';

describe('computeScale', () => {
  it('is 1 on the design canvas itself', () => {
    expect(computeScale(DESIGN_WIDTH, DESIGN_HEIGHT)).toBe(1);
  });

  it('never magnifies on a larger screen, so the stimulus matches across devices', () => {
    // Visual angle is a controlled variable. Scaling UP on a big screen would silently present a
    // different stimulus than the design canvas does.
    expect(computeScale(2560, 1600)).toBe(1);
    expect(computeScale(1920, 1080)).toBe(1);
  });

  it('shrinks to fit a Xiaomi Pad 6 in landscape — the device that lost its Continue button', () => {
    // ~1152x720 CSS px, and nearer 650 tall with the address bar showing.
    const withBar = computeScale(1152, 650);
    const withoutBar = computeScale(1152, 720);
    expect(withBar).toBeLessThan(1);
    expect(withoutBar).toBeLessThan(1);
    // Height is the binding constraint on this device, not width.
    expect(withBar).toBeLessThanOrEqual(650 / DESIGN_HEIGHT + 1e-9);
    expect(withoutBar).toBeLessThanOrEqual(720 / DESIGN_HEIGHT + 1e-9);
  });

  it('always fits: the scaled canvas never exceeds the viewport in either axis', () => {
    const viewports = [
      [1152, 650], [1152, 720], [1080, 810], [1194, 834], [1280, 800],
      [1024, 768], [800, 600], [1366, 768], [2560, 1600],
    ];
    for (const [w, h] of viewports) {
      const s = computeScale(w, h);
      // The canvas is DESIGN x DESIGN laid out, then multiplied by s. Both axes must land inside
      // the viewport, or content is clipped into the unreachable region again.
      if (s > MIN_SCALE) {
        expect(DESIGN_WIDTH * s).toBeLessThanOrEqual(w + 1e-6);
        expect(DESIGN_HEIGHT * s).toBeLessThanOrEqual(h + 1e-6);
      }
    }
  });

  it('absorbs a pixel or two of viewport jitter', () => {
    // Quantisation handles jitter only. The address bar is handled by the running floor below —
    // a 70px swing crosses any step boundary, so quantising alone would NOT have been enough.
    expect(computeScale(1152, 700)).toBe(computeScale(1152, 700.4));
  });

  it('is monotonic in viewport height', () => {
    let prev = 0;
    for (const h of [600, 650, 700, 750, 800, 834, 900]) {
      const s = computeScale(1194, h);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('never goes below the floor, because past it the stimulus is no longer fair', () => {
    expect(computeScale(320, 200)).toBe(MIN_SCALE);
    expect(computeScale(1, 1)).toBe(MIN_SCALE);
  });

  it('reports absence rather than inventing a scale from a nonsense viewport', () => {
    // A zero or non-finite measurement carries no information about the device; returning a
    // plausible-looking fraction would be a fabricated value.
    expect(computeScale(0, 0)).toBe(1);
    expect(computeScale(NaN, 800)).toBe(1);
    expect(computeScale(1194, Infinity)).toBe(1);
    expect(computeScale(-100, 800)).toBe(1);
  });
});

describe('isBelowMinimum', () => {
  it('is false for real tablets, including the one that failed', () => {
    expect(isBelowMinimum(1152, 650)).toBe(false);
    expect(isBelowMinimum(1080, 810)).toBe(false);
    expect(isBelowMinimum(1194, 834)).toBe(false);
  });

  it('is true when even the floor cannot fit, so the operator is told instead of hunting a button', () => {
    expect(isBelowMinimum(400, 300)).toBe(true);
  });
});


describe('foldViewportFloor — stability across an address-bar cycle', () => {
  beforeEach(() => resetViewportFloor());

  it('does not rescale the stimulus when the address bar hides mid-reading', () => {
    // The real sequence on a Xiaomi Pad 6: the page loads with the bar showing (650), the
    // participant starts reading, the bar slides away (720). Sizing for the moment would enlarge
    // the text under them. Sizing for the smallest seen does not.
    const withBar = foldViewportFloor(1152, 650);
    const barHidden = foldViewportFloor(1152, 720);
    expect(computeScale(barHidden.w, barHidden.h)).toBe(computeScale(withBar.w, withBar.h));
  });

  it('never oscillates: repeated address-bar cycles converge to one scale', () => {
    const scales = [650, 720, 650, 720, 700, 720].map((h) => {
      const f = foldViewportFloor(1152, h);
      return computeScale(f.w, f.h);
    });
    expect(new Set(scales).size).toBe(1);
  });

  it('is monotonically non-increasing within an orientation', () => {
    let prev = Infinity;
    for (const h of [720, 700, 650, 700, 720, 600]) {
      const f = foldViewportFloor(1152, h);
      const s = computeScale(f.w, f.h);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it('still shrinks when the viewport genuinely gets smaller than anything seen', () => {
    // Not shrinking here would push content back into the region no gesture can reach — the exact
    // failure this whole file exists to prevent.
    const a = foldViewportFloor(1152, 720);
    const b = foldViewportFloor(1152, 560);
    expect(computeScale(b.w, b.h)).toBeLessThan(computeScale(a.w, a.h));
  });

  it('starts over on an orientation change rather than inheriting the other shape', () => {
    foldViewportFloor(1152, 650);          // landscape
    const portrait = foldViewportFloor(720, 1152);
    // The landscape height of 650 must not constrain the portrait layout.
    expect(portrait).toEqual({ w: 720, h: 1152 });
  });

  it('ignores a nonsense measurement instead of poisoning the floor with it', () => {
    const good = foldViewportFloor(1152, 720);
    expect(foldViewportFloor(0, 0)).toEqual(good);
    expect(foldViewportFloor(NaN, 700)).toEqual(good);
  });
});
