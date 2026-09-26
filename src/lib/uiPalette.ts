/**
 * Text colours for the OPERATOR and setup screens — landing page, session manager, session init,
 * consent, pre-flight, break screen, dashboard. Never for a condition screen: those colours are the
 * manipulation and live in experiment/conditions.ts.
 *
 * Every entry is at least 4.5:1 (WCAG AA for body text) against every ground in UI_GROUNDS, and
 * tests/contrast.test.ts holds it there. The console used to set help text in #9a968e (2.8:1 on
 * cream), empty-list notes in #b8b4ac (2.0:1) and warnings in the bright status hues (#c98a22,
 * #22c97a, #e64c4c — 2.5 to 3.6:1): read at 86% scale on a tablet at arm's length, much of it was
 * not legible. The bright hues remain for fills — dots, bars, borders — where 3:1 is the bar and
 * nobody has to read them.
 */
export const UI_TEXT = {
  ink: '#1a1a2e',
  body: '#3a3a4a',
  /** Secondary and help text. */
  muted: '#4a4a60',
  green: '#1d7a4a',
  amber: '#8a5300',
  red: '#b3261e',
  blue: '#1f5fbf',
} as const;

/** The grounds operator text is set on: the page, cards, and the tinted notice boxes. */
export const UI_GROUNDS = {
  cream: '#F8F7F5',
  white: '#FFFFFF',
  panel: '#FBF9F5',
  info: '#EEF3FF',
  notice: '#FFF6E5',
  caution: '#FFF8EC',
  caution2: '#FDF6E8',
  alert: '#FDEEEE',
  alert2: '#FFF0F0',
} as const;

/** Grounds that carry white text: filled buttons. */
export const UI_FILLS_WITH_WHITE_TEXT = {
  ink: '#1a1a2e',
  blue: '#1f5fbf',
  green: '#1d7a4a',
  red: '#b3261e',
  amber: '#8a5300',
} as const;

/**
 * Text colours the console used to use that fail 4.5:1 on its grounds. Kept as a list so the test
 * can check none of them is set as a TEXT colour on an operator screen again.
 */
export const RETIRED_TEXT_COLOURS = [
  '#9a968e', '#b8b4ac', '#c98a22', '#22c97a', '#e64c4c', '#c9701e', '#cfcbc3', '#4f8ef7', '#f5a623',
] as const;
