/**
 * The words and the button that frame every screen inside a display — one eyebrow, one within-task
 * counter, one primary button — so that what surrounds the stimulus is the same on every screen and
 * in every condition, differing only by the condition's own ink and ground.
 *
 * WHY. Inside a condition the frame was rolled per screen (screen audit F9, F13, F17): eyebrows at
 * 12 px DM Mono (10.3 px on the tablet at the old scale), "Page 1 of 3" at 12 px, a passage title at
 * 13, rating labels at 11-14, the reaction counter at 12 px and HALF opacity, a page bar at 60% alpha;
 * five primary-button styles in three positions (centred, bottom right, left under the content), in
 * DM Mono at 14 and 16 px and at different heights. All of it is drawn in the condition's ink, so
 * text set small or translucent was hardest to read in exactly the low-contrast conditions —
 * instruction legibility varying with the factor under test.
 *
 * THE RULES.
 *   - Text a participant has to read on a condition screen is at least LOOP_TEXT_MIN_PX (16) design
 *     px — 16 CSS px in the installed app on the study tablet, 14.4 with Chrome's address bar — in
 *     Roboto, the stimulus face, in FULL ink: no opacity and no alpha anywhere it carries meaning.
 *     Hierarchy is by size, weight and case. Decoration that nobody reads (a rule, the empty slider
 *     track) may stay translucent.
 *   - One eyebrow: uppercase, 16 px, weight 500. Its text comes from experiment/taskSteps.tsx.
 *   - One counter for "Page 1 of 3", "Question 1 of 3", "4 of 11 found": 16 px, weight 500, at the
 *     right-hand end of the task's own header row.
 *   - One primary button: 56 px tall (the reading footer's row, which must not change height — see
 *     stimulusPage.ts), Roboto 17 px, filled in ink with the ground as its text; not yet available,
 *     an outline DASHED in full ink rather than a faded label. One position rule: at the right-hand
 *     edge of the screen's content — in the footer row on the reading and search pages, directly
 *     under the content on the questions and the ratings — and centred on the task intro cards, where
 *     everything is centred.
 *   - NOT the grey field. Its Continue stays the field's own black outline (setupStages.tsx,
 *     AdaptationScreen): that screen is the adaptation stimulus, its mean luminance is the point of
 *     it, and the shared button's filled ink would put a black patch on it. It is the same in every
 *     condition, so it confounds nothing.
 * tests/loopText.test.ts reads the condition-screen sources for these rules; e2e/loopChrome.spec.ts
 * measures them as rendered, on every screen of a display, at the tablet's viewports.
 */
import type { CSSProperties, ReactNode } from 'react';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { STIMULUS_FOOTER_ROW_PX } from './stimulusPage';

/** The least size, in design px, for any text a participant must read on a condition screen. */
export const LOOP_TEXT_MIN_PX = 16;

/** The eyebrow: which step this is, and on intro cards and ratings which display. */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p
      data-testid="loop-eyebrow"
      style={{
        fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX, fontWeight: 500,
        textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0, ...style,
      }}
    >
      {children}
    </p>
  );
}

/** A within-task counter: "Page 1 of 3", "Question 2 of 3", "4 of 11 found". */
export function Counter({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId ?? 'loop-counter'}
      style={{
        fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX, fontWeight: 500,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: '0 0 auto',
      }}
    >
      {children}
    </span>
  );
}

/** The one primary button inside a display. */
export function PrimaryButton({ ink, ground, enabled = true, onClick, children, testId }: {
  ink: string;
  ground: string;
  /** Not yet available: drawn as a dashed outline, and disabled. */
  enabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      // How e2e/loopChrome.spec.ts finds every primary button in a display, whatever its test id.
      data-loop-primary=""
      disabled={!enabled}
      onClick={onClick}
      style={{
        height: STIMULUS_FOOTER_ROW_PX, boxSizing: 'border-box', padding: '0 32px', borderRadius: 12,
        fontFamily: STIMULUS_FONT_STACK, fontSize: 17, fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap',
        flex: '0 0 auto',
        background: enabled ? ink : 'transparent',
        color: enabled ? ground : ink,
        border: `2px ${enabled ? 'solid' : 'dashed'} ${ink}`,
        cursor: enabled ? 'pointer' : 'not-allowed',
      }}
    >
      {children}
    </button>
  );
}

/**
 * The row the primary button sits in under the content of the questions and the ratings: the button
 * at the right-hand edge, and a one-line status ("Set all sliders to continue.") at the left.
 */
export function ActionRow({ status, children, style }: { status?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 20, ...style }}>
      {status != null && (
        <p data-testid="loop-status" style={{ flex: '1 1 auto', margin: 0, fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX }}>
          {status}
        </p>
      )}
      {children}
    </div>
  );
}
