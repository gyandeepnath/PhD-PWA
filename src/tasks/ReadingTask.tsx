/**
 * Reading task. Flow: an instruction intro → the passage (paginated). Each page enforces a short
 * minimum dwell so the participant actually reads, but the control is now explicit: a clear banner
 * + a progress bar + a button that visibly counts down and then turns active ("I've finished
 * reading"). Self-paced beyond the minimum; total reading_time_ms is recorded. Themed to the
 * condition's colours.
 */
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import { TaskIntro } from './TaskIntro';
import type { Passage } from '@/experiment/passages';

interface Props {
  passage: Passage;
  background: string;
  text: string;
  onComplete: (readingTimeMs: number) => void;
}

export function ReadingTask({ passage, background, text, onComplete }: Props) {
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(Math.ceil(CONFIG.READING_PAGE_MIN_MS / 1000));
  const taskStart = useRef(now());
  const pageStart = useRef(now());
  const totalPages = passage.pages.length;
  const isLast = page === totalPages - 1;

  useEffect(() => {
    if (!started) return;
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
  }, [page, started]);

  if (!started) {
    return (
      <TaskIntro
        eyebrow="Task 1 of 4 · Reading"
        title="Read the passage"
        lines={[
          'Read the passage carefully at your normal pace.',
          'A one-question comprehension check follows.',
          totalPages > 1 ? `There are ${totalPages} short pages.` : '',
          'Tap “Begin reading” when you are ready.',
        ].filter(Boolean)}
        buttonLabel="Begin reading →"
        background={background}
        text={text}
        onBegin={() => {
          taskStart.current = now();
          setStarted(true);
        }}
      />
    );
  }

  const next = () => {
    if (!unlocked) return;
    if (isLast) onComplete(now() - taskStart.current);
    else setPage((p) => p + 1);
  };

  const minSecs = Math.ceil(CONFIG.READING_PAGE_MIN_MS / 1000);
  const countdownPct = Math.min(100, ((minSecs - secsLeft) / minSecs) * 100);

  return (
    <div
      className="min-h-screen w-full animate-fade-in"
      style={{ background, color: text, padding: `56px ${CONFIG.READING_MARGIN_PERCENT}% 3%`, display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'Roboto', fontSize: 13, textTransform: 'uppercase', opacity: 0.5 }}>{passage.title}</span>
        <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, opacity: 0.6 }}>
          Page {page + 1} of {totalPages}
        </span>
      </div>
      <div style={{ height: 4, background: text + '20', margin: '8px 0', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${((page + 1) / totalPages) * 100}%`, background: text + '60', borderRadius: 2 }} />
      </div>

      <p
        className="scrollable"
        style={{ flex: 1, minHeight: 0, fontSize: CONFIG.READING_FONT_SIZE_PX, lineHeight: CONFIG.READING_LINE_HEIGHT, fontFamily: 'Roboto', whiteSpace: 'pre-wrap' }}
      >
        {passage.pages[page]}
      </p>

      {/* Always-visible footer so the control is never off-screen. */}
      <div style={{ flexShrink: 0, paddingTop: 12, borderTop: `1px solid ${text}20` }}>
        {!unlocked ? (
          <div>
            <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 14, opacity: 0.8, marginBottom: 6 }}>
              Please keep reading — you can continue in {secsLeft}s
            </div>
            <div style={{ height: 6, background: text + '20', borderRadius: 3 }}>
              <div style={{ height: '100%', width: `${countdownPct}%`, background: text + '70', borderRadius: 3, transition: 'width 0.2s linear' }} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={next}
              style={{ background: text, color: background, border: 'none', borderRadius: 12, padding: '16px 32px', fontFamily: '"DM Mono", monospace', fontSize: 16, cursor: 'pointer' }}
            >
              {isLast ? "I've finished reading →" : 'Next page →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
