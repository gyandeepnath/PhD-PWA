/**
 * The VisuLab wordmark: an eye-and-lens mark beside the name, drawn inline so it needs no asset and
 * works offline from the first launch. Operator screens only (landing page, session manager).
 *
 * Deliberately plain and in the console's own ink — no institutional mark, no colour that could be
 * mistaken for one of the display conditions.
 */
export function VisuLabLogo({ size = 40, ink = '#1a1a2e', withText = true }: {
  /** Height of the mark in design px; the text scales with it. */
  size?: number;
  ink?: string;
  withText?: boolean;
}) {
  return (
    <span
      data-testid="visulab-logo"
      role="img"
      aria-label="VisuLab"
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, color: ink }}
    >
      <svg width={size * 1.5} height={size} viewBox="0 0 48 32" aria-hidden focusable="false">
        {/* Eye outline */}
        <path d="M2 16 C 10 3, 38 3, 46 16 C 38 29, 10 29, 2 16 Z" fill="none" stroke={ink} strokeWidth={2.4} strokeLinejoin="round" />
        {/* Iris as a lens ring, pupil, and a small highlight */}
        <circle cx={24} cy={16} r={8} fill="none" stroke={ink} strokeWidth={2.4} />
        <circle cx={24} cy={16} r={3.6} fill={ink} />
        <circle cx={25.4} cy={14.6} r={1.2} fill="#ffffff" />
      </svg>
      {withText && (
        <span aria-hidden style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", serif', fontSize: size * 0.7, lineHeight: 1, letterSpacing: '0.01em' }}>
          Visu<span style={{ fontWeight: 700 }}>Lab</span>
        </span>
      )}
    </span>
  );
}
