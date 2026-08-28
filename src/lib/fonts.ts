/**
 * The stimulus typeface, as an experimental control.
 *
 * The reading passage is the measurement window, and the face it is set in changes letter shape,
 * stroke weight and x-height — all of which bear on reading speed, and on how a text colour reads
 * against its background. So the typeface is part of the display condition, not decoration.
 *
 * It used to be loaded from Google Fonts with `font-family: 'Roboto'` and no fallback. Every
 * session is run in aeroplane mode, so on a device that had not already cached the file the
 * passage was rendered in whatever the platform's default happened to be — a serif on one tablet,
 * a different sans on another — silently, and with nothing in the export saying so. The faces are
 * now vendored into `public/fonts/` (see `scripts/vendor-fonts.mjs`) and served from the app's own
 * origin, so an offline tablet renders exactly what a networked one does.
 *
 * The explicit stack is the second half of the guard: if the vendored file somehow fails to load,
 * the fallback is a stated, documented sans rather than an unknown platform default.
 */
export const STIMULUS_FONT_FAMILY = 'Roboto';
export const STIMULUS_FONT_STACK =
  "'Roboto', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, system-ui, sans-serif";

/**
 * Whether the vendored stimulus face is actually available for rendering.
 *
 * Returns null — not false — where the browser gives no answer (`document.fonts` absent, as in a
 * test environment): the check reports absence rather than asserting a failure it did not observe.
 */
export async function stimulusFontLoaded(): Promise<boolean | null> {
  const fonts = (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
  if (!fonts || typeof fonts.check !== 'function') return null;
  try {
    // Weight 400 at the reading size is the face the passage is actually set in.
    if (typeof fonts.load === 'function') await fonts.load(`400 16px ${STIMULUS_FONT_FAMILY}`);
    return fonts.check(`400 16px ${STIMULUS_FONT_FAMILY}`);
  } catch {
    return null;
  }
}
