import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A tap-to-open "i" beside an operator field: one short, plain-language note on what the field is
 * and what the app does with it.
 *
 * Tap, not hover. The console runs on a tablet, where a `title` tooltip never appears. The button is
 * a 32 px target (the visible circle is smaller) and closes on a second tap, a tap anywhere else,
 * or Escape.
 *
 * Operator and setup screens only. Nothing here may be placed on a condition screen: a popover is a
 * patch of a different luminance, and the questionnaires inside the loop are part of the measure.
 *
 * Safe inside a <label>: clicks on the button and on the note are cancelled before they reach the
 * label, so opening a note never ticks the checkbox or focuses the input it sits beside.
 */
export function InfoTip({ label, children, tone = 'light', align = 'left' }: {
  /** What the note is about; read out as "About <label>". */
  label: string;
  children: ReactNode;
  /** 'dark' for the dark calibration / camera screens. */
  tone?: 'light' | 'dark';
  /** Which edge of the button the note lines up with — 'right' near the right edge of a column. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  /** Open upward: set when the note, opened downward, would run past the bottom of the screen. */
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Measured before paint, so a note near the bottom edge never flashes open below it first.
  useLayoutEffect(() => {
    if (!open) { setUp(false); return; }
    const btn = wrap.current?.getBoundingClientRect();
    const h = note.current?.getBoundingClientRect().height ?? 0;
    if (btn && btn.bottom + 8 + h > window.innerHeight && btn.top - 8 - h >= 0) setUp(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const ring = tone === 'dark' ? '#dbe6f7' : '#1f5fbf';
  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        data-testid="info-tip"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => { stop(e); setOpen((o) => !o); }}
        style={{
          width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', padding: 0, margin: '-6px 0', cursor: 'pointer',
          flex: '0 0 auto',
        }}
      >
        <span aria-hidden style={{
          width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${ring}`,
          background: open ? ring : 'transparent', color: open ? (tone === 'dark' ? '#1a1a2e' : '#fff') : ring,
          fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700, fontSize: 14, lineHeight: '19px',
          textAlign: 'center',
        }}>
          i
        </span>
      </button>
      {open && (
        <span
          ref={note}
          id={id}
          role="note"
          data-testid="info-tip-note"
          onClick={stop}
          style={{
            position: 'absolute', ...(up ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
            left: align === 'left' ? -4 : undefined, right: align === 'right' ? -4 : undefined,
            zIndex: 40, width: 320, padding: '12px 14px', borderRadius: 10,
            background: tone === 'dark' ? '#ffffff' : '#1a1a2e', color: tone === 'dark' ? '#1a1a2e' : '#ffffff',
            fontFamily: 'Roboto, ui-sans-serif, system-ui, sans-serif', fontSize: 15, lineHeight: 1.5,
            fontWeight: 400, textAlign: 'left', textTransform: 'none', letterSpacing: 'normal',
            boxShadow: '0 6px 20px rgba(0,0,0,0.22)', cursor: 'auto', whiteSpace: 'normal',
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}
