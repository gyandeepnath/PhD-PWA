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

/**
 * The typography the stimulus screens are drawn with, as recorded on every condition
 * (`typography_version`, 02_conditions.csv). Rows from before Round 84 carry none and are 'ty-v1'.
 *
 * WHAT ty-v2 IS, AND WHAT IT LEAVES ALONE. The reading text is set exactly as before — Roboto 400 at
 * 22 px, line height 1.4, justified, no hyphenation, paragraphs 0.7 em apart, in the 1040 px column
 * (experiment/config.ts) — because every one of those decides how the corpus breaks into its three
 * pages, and all ten conditions share them. Measured in headless Chromium at 1152x720, every reading page,
 * question and search excerpt of two displays is pixel-identical under ty-v1 and ty-v2. What changed:
 *   - the few BOLD words on condition screens (the reaction task's colour name, the search target) are
 *     the font's own bold: the vendored Roboto had no 700 face, and Chromium drew them as the 500 face
 *     smeared wider (synthetic bold), which it no longer may (theme.css font-synthesis-weight: none);
 *   - the browser's text autosizing is switched off (text-size-adjust: 100%), and kerning and common
 *     ligatures are written out at their defaults, so neither a browser update nor Chrome's heuristics
 *     can resize or re-space the passage unseen;
 *   - the rendered line height of page 1 is MEASURED on every condition (reading_line_px_rendered), so
 *     a system text-size setting that got through anyway is in the data instead of assumed away.
 *
 * NOT TUNED, AND WHY. Letter spacing stays the font's own: reading speed rose with letter spacing only
 * up to about the standard spacing and not beyond it, in central and peripheral vision (Chung 2002,
 * Invest Ophthalmol Vis Sci 43(4):1270; six observers, RSVP, Courier; abstract, ledger 68). Word spacing
 * is not tuned either: letter and word spacing interact in how a line is read (Slattery & Rayner 2013,
 * Atten Percept Psychophys 75(6):1275; abstract, ledger 69), so changing one alone is not neutral.
 * Justification widens the spaces between words and leaves the letters alone (measured in Chromium: a
 * word's width is the same justified and ragged), the same way in every condition. No verified evidence
 * for or against justified text was found; it is the investigator's uniform decision. Hyphenation is
 * off: `hyphens: manual` breaks only at soft hyphens, and the corpus has none (tests/typography.test.ts),
 * so no word is ever split across lines.
 */
export const TYPOGRAPHY_VERSION = 'ty-v2';
/** Rows recorded before Round 84 (no 700 face, synthetic bold, no pinned rendering settings). */
export const TYPOGRAPHY_VERSION_V1 = 'ty-v1';
