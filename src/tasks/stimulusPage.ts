/**
 * The geometry shared by the two screens that show passage text — the reading pages and the
 * visual-search excerpt — and the comprehension item that follows them.
 *
 * One module, because these numbers are only meaningful together. The text box a page has to fit is
 * the screen height minus this padding, the header and this footer, and the research pass that
 * chose the reading typography (Round 63: 22 px, line height 1.4, a 1040 px column, the existing
 * three pages) measured every page against exactly that box — 556 px on the 1152x720 study tablet.
 * Change one of these and the pages have to be re-measured (tests/passages.test.ts and the
 * stimulus-fit end-to-end guard do that).
 */

/**
 * Top and bottom padding of a passage page, in root px. Fixed pixels, never a percentage: a
 * percentage padding is a percentage of the containing block's WIDTH, so it would make the text box
 * shorter on a wider device at the same glyph size.
 *
 * The top clears the in-loop Pause chip at the far left: in the 1040 px column the page starts 56 px
 * from the left edge, under the chip's right end, so the header row has to start below it. Since
 * Round 65 the chip is a 44 CSS px target sitting at top 1, ending at 45 (the in-loop variant in
 * components/NavChip.tsx). The bottom is correspondingly smaller, which keeps the text box at the 556 px the
 * typography was measured against (36 + 20 before).
 */
export const STIMULUS_PAGE_PAD_TOP_PX = 46;
export const STIMULUS_PAGE_PAD_BOTTOM_PX = 10;

/**
 * Height of the footer row that holds the page's button, in root px — the SAME in every state.
 *
 * The reading footer used to be a short countdown line with a 6 px bar until the 20 s floor expired,
 * then a 56 px button. The page is vertically centred, so the text re-centred and jumped up about
 * 10 px on every page — thirty times a sitting, each one timed to the dwell floor and inside the
 * blink-measurement window (screen audit F3). Both states now occupy this row, so the text box, and
 * the passage in it, never move.
 */
export const STIMULUS_FOOTER_ROW_PX = 56;

/** Space above the footer row, and its rule. Counted in the text box, like everything above. */
export const STIMULUS_FOOTER_GAP_PX = 12;

/**
 * Height of the header above the text, in root px — FIXED, at exactly what it measured when the
 * Round 63 typography was fitted, so that restyling what is in it can never move the text box.
 *
 * The headers used to be as tall as whatever they held. On the reading page that was the passage
 * title (13 px), "Page 1 of 3" (12 px DM Mono) and a 4 px page bar with 8 px above and below it:
 * 39.5 px, putting the text box at 85.5-641 on the 1152x720 tablet. Raising the header's words to the
 * condition-screen floor (16 px, full ink; screen audit F9) and dropping the translucent page bar
 * would otherwise have shifted and resized the box the thirty pages were measured to fit. On the
 * search page the row held "Find and tap every:" and the found count (15 px DM Mono) over a rule 10 px
 * below: 33.5 px.
 */
export const STIMULUS_READING_HEADER_PX = 39.5;
export const STIMULUS_SEARCH_HEADER_PX = 33.5;
