/**
 * Reading task. Each page enforces a minimum dwell (rAF-gated floor), after which the Next button
 * unlocks and the participant proceeds at their own pace. Total reading_time_ms is recorded so
 * comprehension is interpretable (the original 20 s was a per-page floor, not a hard cutoff).
 * Styled entirely in the active condition's colours.
 */
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import type { Passage } from '@/experiment/passages';

interface Props {
  passage: Passage;
  background: string;
  text: string;
  onComplete: (readingTimeMs: number) => void;
}

export function ReadingTask({ passage, background, text, onComplete }: Props) {
  const [page, setPage] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(Math.ceil(CONFIG.READING_PAGE_MIN_MS / 1000));
  const taskStart = useRef(now());
  const pageStart = useRef(now());
  const isLast = page === passage.pages.length - 1;

  useEffect(() => {
    setUnlocked(false);
    pageStart.current = now();
    let raf = 0;
    const tick = () => {
      const el = now() - pageStart.current;
      if (el >= CONFIG.READING_PAGE_MIN_MS) {
        setUnlocked(true);
        setSecsLeft(0);
      } else {
        setSecsLeft(Math.ceil((CONFIG.READING_PAGE_MIN_MS - el) / 1000));
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [page]);

  const next = () => {
    if (!unlocked) return;
    if (isLast) onComplete(now() - taskStart.current);
    else setPage((p) => p + 1);
  };

  return (
    <div
      className="min-h-screen w-full animate-fade-in"
      style={{
        background,
        color: text,
        padding: `4% ${CONFIG.READING_MARGIN_PERCENT}%`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ fontFamily: 'Roboto', fontSize: 13, textTransform: 'uppercase', opacity: 0.5 }}>
        {passage.title}
      </div>
      <div style={{ height: 4, background: text + '20', margin: '10px 0', borderRadius: 2 }}>
        <div
          style={{
            height: '100%',
            width: `${((page + 1) / passage.pages.length) * 100}%`,
            background: text + '60',
            borderRadius: 2,
          }}
        />
      </div>
      <p
        className="scrollable"
        style={{
          flex: 1,
          fontSize: CONFIG.READING_FONT_SIZE_PX,
          lineHeight: CONFIG.READING_LINE_HEIGHT,
          fontFamily: 'Roboto',
          whiteSpace: 'pre-wrap',
        }}
      >
        {passage.pages[page]}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
        {!unlocked && (
          <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, opacity: 0.7 }}>
            {`0:${String(secsLeft).padStart(2, '0')}`}
          </span>
        )}
        <button
          onClick={next}
          disabled={!unlocked}
          style={{
            background: unlocked ? text : text + '40',
            color: background,
            border: 'none',
            borderRadius: 12,
            padding: '14px 28px',
            fontFamily: '"DM Mono", monospace',
            fontSize: 14,
            cursor: unlocked ? 'pointer' : 'not-allowed',
          }}
        >
          {isLast ? 'Finished reading →' : 'Next page →'}
        </button>
      </div>
    </div>
  );
}
