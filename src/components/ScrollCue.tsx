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
export function ScrollCue() {
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
    return () => {
      window.clearTimeout(late);
      box.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);
  return (
    <div ref={ref} aria-hidden="true" style={{ position: 'sticky', bottom: 0, height: 0, pointerEvents: 'none', zIndex: 5 }}>
      {more && (
        <div
          data-testid="scroll-cue"
          className="font-lab text-xs"
          style={{
            position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
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
