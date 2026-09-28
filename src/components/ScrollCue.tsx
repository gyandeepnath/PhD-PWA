import { useEffect, useRef, useState } from 'react';

/**
 * "More below" — for a setup form taller than the screen.
 *
 * The setup screens scroll (they have to; see the note on `shell` in setupStages.tsx), but nothing
 * said so: the participant profile runs well past the bottom edge at 1280x800 with no visible edge,
 * no scrollbar on a tablet, and its Continue button out of sight. This sits at the bottom of its
 * scroll container and shows only while there is more content below. Operator- and participant-facing
 * setup screens only; never on a stimulus screen, which must not scroll.
 */
export function ScrollCue({ gutter = false }: {
  /**
   * Sit in the right-hand margin instead of bottom-centre. For a screen whose text runs in a centred
   * column (consent): centred, the pill covered a line of the text under it at any scroll position.
   * A number is how far past the right edge of the content it sits (48 by default), for a list that
   * reserves a gutter of that width — the CVS-Q, where centred it covered the last row's answers.
   */
  gutter?: boolean | number;
} = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let el: HTMLElement | null = ref.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (!el) return;
    const box = el;
    const check = () => setMore(box.scrollHeight - box.scrollTop - box.clientHeight > 12);
    check();
    const late = window.setTimeout(check, 300);     // after fonts and late layout settle
    box.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    /*
     * CONTENT THAT GROWS AFTER MOUNT. The cue was re-checked only on scroll and resize, so a form that
     * grew under the operator's hand — the session form, when "split" or an out-of-range lux opens
     * two more fields — ran past the bottom with no cue, which is the one case it exists for; and a
     * dashboard tab switched after mount kept the previous tab's answer. The scroll box's children
     * are watched for size changes, and the box for children added or removed.
     */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    const watchChildren = () => { ro?.disconnect(); Array.from(box.children).forEach((c) => ro?.observe(c)); ro?.observe(box); };
    watchChildren();
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { watchChildren(); check(); }) : null;
    mo?.observe(box, { childList: true });
    return () => {
      window.clearTimeout(late);
      box.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);
  return (
    <div ref={ref} aria-hidden="true" style={{ position: 'sticky', bottom: 0, height: 0, pointerEvents: 'none', zIndex: 5 }}>
      {more && (
        <div
          data-testid="scroll-cue"
          className="font-sans text-sm"
          style={{
            position: 'absolute', bottom: 10,
            ...(gutter ? { right: -(typeof gutter === 'number' ? gutter : 48) } : { left: '50%', transform: 'translateX(-50%)' }),
            padding: '6px 14px', borderRadius: 999, background: '#1a1a2e', color: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
          }}
        >
          More below ↓
        </div>
      )}
    </div>
  );
}
