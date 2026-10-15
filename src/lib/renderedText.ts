/**
 * The reading text as the screen actually drew it (Round 84, typography ty-v2; lib/fonts.ts).
 *
 * Every physical figure for the passage — its x-height in arcmin, its line length — is computed from the
 * DECLARED size: 22 design px at line height 1.4, times the display scale. That is right only if the
 * browser drew the text at that size. Chrome on Android can enlarge text on its own (text autosizing, now
 * switched off in theme.css) and honours a system-wide text-size setting in ways a page cannot see from
 * its own stylesheet. So page 1 of every condition measures the distance from one line of the passage to
 * the next, in CSS px, as laid out. With a unitless line height that distance is font size x 1.4 whatever
 * face is drawn, so it measures the SIZE, not the typeface (stimulus_font_ok checks the typeface).
 */
import { CONFIG } from '@/experiment/config';

/** How far the measured line pitch may stray from the declared one before the integrity audit says so. */
export const READING_LINE_TOLERANCE = 0.02;

/** The line pitch the protocol declares, in CSS px, at display scale `scale`. */
export function expectedLinePx(scale: number): number {
  return CONFIG.READING_FONT_SIZE_PX * CONFIG.READING_LINE_HEIGHT * scale;
}

/**
 * The distance between successive lines of the first paragraph in `block` that runs to two lines or
 * more, in CSS px (the on-screen box, display scale included), to 0.01 px; null if none does or the
 * browser gives no line boxes. First to last line over the number of gaps, so a fraction of a pixel of
 * rounding in one line's position does not decide it.
 */
export function renderedLinePitch(block: Element | null): number | null {
  if (!block || typeof document === 'undefined') return null;
  for (const p of Array.from(block.querySelectorAll('p'))) {
    const node = p.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    // One top per line: a line can come back as several fragments, all at the same height.
    const tops: number[] = [];
    for (const t of Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0).map((r) => r.top).sort((a, b) => a - b)) {
      if (!tops.length || t - tops[tops.length - 1] > 1) tops.push(t);
    }
    if (tops.length >= 2) return Math.round(((tops[tops.length - 1] - tops[0]) / (tops.length - 1)) * 100) / 100;
  }
  return null;
}

/** Whether a measured pitch departs from the declared one by more than the tolerance; null if either is unknown. */
export function linePitchOff(rendered: number | null | undefined, scale: number | null | undefined): boolean | null {
  if (!(typeof rendered === 'number' && rendered > 0 && typeof scale === 'number' && scale > 0)) return null;
  return Math.abs(rendered / expectedLinePx(scale) - 1) > READING_LINE_TOLERANCE;
}
