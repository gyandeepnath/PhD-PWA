/**
 * An untouched NASA-TLX scale is drawn at 3:1 or more against its page (audit 86 UI-10).
 *
 * The thumb is hidden until the scale is touched (theme.css .vl-untouched: no default position to anchor
 * on), so the empty track is the only thing that says where to tap. It was the ink at 13% alpha: 1.3:1
 * on the cream, a pale hairline. WCAG 1.4.11 asks 3:1 for the visible boundary of a control. Also read
 * from the stylesheet: the scale is a 44 px target with its track drawn in the middle, not a 6 px strip.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wcagContrastRatio, hexToRgb } from '@/lib/contrast';
import { tlxTrackEmpty, TLX_TRACK_PX, TLX_TARGET_PX } from '@/scales/NasaTlx';

/** `#rrggbbaa` composited over an opaque ground. */
function over(rgba: string, ground: string): string {
  const a = parseInt(rgba.slice(7, 9), 16) / 255;
  const f = hexToRgb(rgba.slice(0, 7));
  const g = hexToRgb(ground);
  const mix = (x: number, y: number) => Math.round(x * a + y * (1 - a)).toString(16).padStart(2, '0');
  return `#${mix(f.r, g.r)}${mix(f.g, g.g)}${mix(f.b, g.b)}`;
}

describe('the NASA-TLX empty track', () => {
  it('is at least 3:1 against the page, with the instrument\'s own ink and ground', () => {
    const track = over(tlxTrackEmpty('#1a1a2e'), '#F8F7F5');
    expect(wcagContrastRatio(track, '#F8F7F5')).toBeGreaterThanOrEqual(3);
  });

  it('was 1.3:1 at the old 13% alpha (the reason for the change)', () => {
    expect(wcagContrastRatio(over('#1a1a2e22', '#F8F7F5'), '#F8F7F5')).toBeLessThan(1.4);
  });

  it('is a 44 px target with an 8 px track drawn in its middle', () => {
    expect(TLX_TARGET_PX).toBe(44);
    expect(TLX_TRACK_PX).toBe(8);
    const css = readFileSync(resolve(__dirname, '..', 'src/styles/theme.css'), 'utf8');
    expect(css).toMatch(/input\[type='range'\]\.vl-tall\s*\{[^}]*height:\s*44px/);
  });
});
