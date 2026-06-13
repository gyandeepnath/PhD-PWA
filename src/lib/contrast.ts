/**
 * Photometric contrast utilities.
 *
 * The original study locks 8 background/text colour pairs and treats them as a
 * 2 (polarity) x 4 (colour) design. A literature audit (WCAG 2.0 SC 1.4.3; coloured-text
 * legibility studies) showed the conditions differ wildly in luminance contrast — e.g.
 * yellow-on-white (C4) is only ~2.4:1, below the WCAG AA 4.5:1 floor, while black-on-white
 * is 21:1. Performance/fatigue differences are therefore partly a contrast effect, not a
 * pure colour effect. We never change the locked hex values; instead we COMPUTE contrast
 * per condition and carry it as a covariate in analysis and the export codebook.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse a #rrggbb hex string to 0-255 RGB. */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** sRGB channel (0-255) -> linear-light component, per WCAG 2.x. */
function linearize(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(color: RGB | string): number {
  const { r, g, b } = typeof color === 'string' ? hexToRgb(color) : color;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two colours: (L_light + 0.05) / (L_dark + 0.05), range 1..21. */
export function wcagContrastRatio(a: RGB | string, b: RGB | string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Michelson contrast (L_max - L_min) / (L_max + L_min), range 0..1. */
export function michelsonContrast(a: RGB | string, b: RGB | string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lmax = Math.max(la, lb);
  const lmin = Math.min(la, lb);
  if (lmax + lmin === 0) return 0;
  return (lmax - lmin) / (lmax + lmin);
}

export type WcagLevel = 'AAA' | 'AA' | 'AA Large' | 'Fail';

/** WCAG compliance band for normal-sized body text. */
export function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}
