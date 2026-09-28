/**
 * The one operator navigation control: Back to home, Back to sessions, Exit — resume later, Cancel.
 *
 * WHY ONE COMPONENT. There were four, in four places and three styles: "← Home" at the TOP RIGHT of the
 * session manager in Roboto 16; "← Sessions" at the top left of the dashboard in Roboto 16 with one
 * border; a second "← Sessions" at the top left of the end-of-sitting dashboard in DM Mono 14 with
 * another; and "Pause" in DM Mono 12, which the tablet draws at about 10 px, on a 50 x 24 px tap
 * target. An operator standing beside a participant had to look for the way out on every screen.
 *
 * THE RULE. Always fixed at the top left, 12 px in. Text at 17 design px in Roboto (15 CSS px on a
 * Xiaomi Pad 6). The tap target is 44 CSS px high on the DEVICE, whatever the display scale is — see
 * --vl-nav-chip-h in theme.css. The label states the action ("Back to sessions", "Exit — resume
 * later"), never just a place name, because what the tap does differs by screen.
 *
 * NOT ON A CONDITION SCREEN. Inside the condition-run the Pause chip is drawn in the screen's own ink
 * at its original size (Experiment.tsx), because anything larger or differently coloured there changes
 * the stimulus. This component is for operator and setup screens, the break and the closing
 * questionnaires, where the cream ground is the same in every condition.
 *
 * Screens whose content could reach the top-left corner reserve the chip's band with `.nav-band`.
 */
import type { ReactNode } from 'react';
import { UI_TEXT } from '@/lib/uiPalette';

export function NavChip({ label, onClick, testId, disabled = false }: {
  /** What the tap does, stated as an action. */
  label: ReactNode;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId ?? 'nav-chip'}
      onClick={onClick}
      disabled={disabled}
      className="font-sans"
      style={{
        position: 'fixed', top: 12, left: 12, zIndex: 45,
        minHeight: 'var(--vl-nav-chip-h)', minWidth: 'var(--vl-nav-chip-h)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '0 18px', borderRadius: 12,
        fontSize: 17, fontWeight: 500, lineHeight: 1.2,
        border: '1px solid #bdb8ae', background: '#ffffff', color: UI_TEXT.ink,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}
