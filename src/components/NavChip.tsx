/**
 * The one operator navigation control: Back to home, Back to sessions, Exit — resume later, Cancel.
 *
 * WHY ONE COMPONENT. There were four, in four places and three styles: "← Home" at the TOP RIGHT of the
 * session manager in Roboto 16; "← Sessions" at the top left of the dashboard in Roboto 16 with one
 * border; a second "← Sessions" at the top left of the end-of-sitting dashboard in DM Mono 14 with
 * another; and "Pause" in DM Mono 12, which the tablet draws at about 10 px, on a 50 x 24 px tap
 * target. An operator standing beside a participant had to look for the way out on every screen.
 *
 * THE RULE. Always fixed at the top left, 12 px in (1 and 4 px in on a condition screen; below).
 * Text at 17 design px in Roboto. The tap target is 44 CSS px high on the DEVICE, whatever the display
 * scale is — see --vl-nav-chip-h in theme.css. The label states the action ("Back to sessions", "Exit
 * — resume later"), never just a place name, because what the tap does differs by screen.
 *
 * ON A CONDITION SCREEN — `ink` — the same chip is drawn in the screen's own ink on no ground at all
 * (no fill, no shadow: nothing inside the condition-run may add a colour or a luminance the condition
 * does not already have), and placed so it never touches the stimulus. It was a 50 x 24 px target in
 * 12 px DM Mono, 10.3 px on the tablet at the old scale (screen audit F12); it is now the same 17 px
 * label and 44 CSS px target as everywhere else, in the top-left corner OUTSIDE the stimulus column:
 *   - the TARGET sits 1 px from the top, so at scale 1 — and at any scale above it, where the chip
 *     is 44 design px (theme.css, Round 74) — it ends at 45, above the 46 px at which every
 *     condition screen's column content starts (STIMULUS_PAGE_PAD_TOP_PX). Its right end, about
 *     85 px, is past the column's left edge (56) on a 16:10 screen the canvas fills, so it has to be above the
 *     column, not beside it. On a viewport shorter than 16:10 — a tab with its address bar showing,
 *     1152x650 at scale 0.90 — the root is 1280 wide, the column starts at 120, and the chip is beside it;
 *   - the visible OUTLINE is a 34 px box centred in that target (FACE_PX). Drawn the full 44 px it
 *     touched the top edge of the screen and sat 1 px above the passage title and the word-search
 *     target, which read as the chip resting on the stimulus page's header. The part of the target
 *     outside the outline is empty corner — nothing under it can be tapped — so the finger still gets
 *     44 CSS px, and the eye gets 6 px of ground on either side;
 *   - well clear of the reaction task's planned dot positions: the nearest, (310, 94) on the
 *     1152 x 720 canvas and 52 px across, is about 230 px from the chip's nearest corner, over 200 px
 *     from its edge, against the 118 px every chrome zone is to keep. (Pause is hidden while the dots
 *     run in any case.)
 * e2e/loopChrome.spec.ts measures these at the tablet's viewports.
 *
 * Screens whose content could reach the top-left corner reserve the chip's band with `.nav-band`;
 * condition screens reserve it with their own top padding.
 */
import type { ReactNode } from 'react';
import { UI_TEXT } from '@/lib/uiPalette';

/** Height of the in-loop chip's visible outline, in design px; the target round it is 44 CSS px. */
export const FACE_PX = 34;

export function NavChip({ label, onClick, testId, disabled = false, ink = null, ariaLabel }: {
  /** What the tap does, stated as an action. */
  label: ReactNode;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
  /** On a condition screen (or the grey field): that screen's ink and ground. */
  ink?: { ink: string; ground: string } | null;
  ariaLabel?: string;
}) {
  if (ink) {
    return (
      <button
        type="button"
        data-testid={testId ?? 'nav-chip'}
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        className="font-sans"
        // The target: 44 CSS px high at any scale, no paint of its own.
        style={{
          position: 'fixed', zIndex: 45, top: 1, left: 4, height: 'var(--vl-nav-chip-h)',
          minWidth: 'var(--vl-nav-chip-h)', display: 'inline-flex', alignItems: 'center', padding: 0,
          border: 'none', background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {/* The face: the outline the eye sees, centred in the target. */}
        <span
          data-testid={`${testId ?? 'nav-chip'}-face`}
          style={{
            display: 'inline-flex', alignItems: 'center', height: FACE_PX, boxSizing: 'border-box',
            padding: '0 16px', borderRadius: 10, whiteSpace: 'nowrap',
            fontSize: 17, fontWeight: 500, lineHeight: 1.2,
            border: `1px solid ${ink.ink}`, background: 'transparent', color: ink.ink,
          }}
        >
          {label}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId ?? 'nav-chip'}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      className="font-sans"
      style={{
        position: 'fixed', top: 12, left: 12, zIndex: 45,
        minHeight: 'var(--vl-nav-chip-h)', minWidth: 'var(--vl-nav-chip-h)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '0 18px', borderRadius: 12,
        fontSize: 17, fontWeight: 500, lineHeight: 1.2, whiteSpace: 'nowrap',
        border: '1px solid #bdb8ae', background: '#ffffff', color: UI_TEXT.ink,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}
