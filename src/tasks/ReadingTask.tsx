/**
 * Reading task. Flow: an instruction intro → the passage (paginated). Each page enforces a short
 * minimum dwell so the participant actually reads, but the control is now explicit: a clear banner
 * + a progress bar + a button that visibly counts down and then turns active ("I've finished
 * reading"). Self-paced beyond the minimum; total reading_time_ms is recorded. Themed to the
 * condition's colours.
 */
import { useEffect, useRef, useState } from 'react';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import { trackHiddenTime, type HiddenTimeTracker } from '@/lib/hiddenTime';
import { TaskIntro } from './TaskIntro';
import type { Passage } from '@/experiment/passages';
import { STIMULUS_COLUMN_PX } from '@/lib/viewportScale';

export interface ReadingResult {
  /** Wall-clock reading time MINUS any time the app spent hidden. The exposure. */
  readingTimeMs: number;
  /** Unadjusted span, kept so the adjustment is auditable rather than silent. */
  wallClockMs: number;
  /** Time the app was backgrounded or the screen off during the passage. */
  hiddenMs: number;
  /** Dwell on each page, in order. Lets a skim be located rather than only suspected. */
  pageDwellsMs: number[];
}

interface Props {
  passage: Passage;
  background: string;
  text: string;
  onComplete: (r: ReadingResult) => void;
  /** Fired when the participant starts reading — the true opening of the measurement window. */
  onBegin?: () => void;
}

export function ReadingTask({ passage, background, text, onComplete, onBegin }: Props) {
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [secsLeft, setSecsLeft] = useState(Math.ceil(CONFIG.READING_PAGE_MIN_MS / 1000));
  const taskStart = useRef(now());
  const pageStart = useRef(now());
  /**
   * Per-page dwell, and time the app spent hidden.
   *
   * reading_time_ms was a single wall-clock span with nothing subtracted and nothing decomposed.
   * The clock ran while the tablet was backgrounded or dimmed, so a notification dealt with during
   * page 3 inflated the whole exposure — and because that span is also the reading-speed
   * denominator, it silently halved the reported reading speed with no way to locate the gap
   * afterwards.
   *
   * The per-page array also makes the skim rule work. The dwell gate guarantees at least
   * 4 x 20 s = 80 s, while the corpus skim floor is 85.7-90.2 s, so the old whole-passage flag
   * could only fire inside a 5.6-10.2 s band: a participant who waited out each countdown and then
   * paused a couple of seconds more was never flagged, and a genuinely fast reader was.
   */
  const pageDwells = useRef<number[]>([]);
  /**
   * Hidden time for this exposure. Shared implementation, because this file's own copy seeded its
   * "hidden since" to null rather than to the CURRENT visibility state — so a page that began while
   * the tablet was already backgrounded had its whole absence dropped, and reading_hidden_ms
   * understated the interruption it exists to report. See lib/hiddenTime.ts.
   */
  const hidden = useRef<HiddenTimeTracker | null>(null);
  const totalPages = passage.pages.length;
  const isLast = page === totalPages - 1;

  useEffect(() => {
    /*
     * Started WHEN READING STARTS, not when the component mounts — the two windows have to be the
     * same one or the subtraction is meaningless.
     *
     * This ran on mount, while the self-paced instruction card was still up, whereas taskStart is
     * set when the participant taps "Begin reading". So `away` covered the intro AND the reading
     * while `wall` covered only the reading, and the intro card is precisely the moment a
     * participant puts the tablet down. A 96-second absence on the instruction card followed by a
     * normal 178-second read exported reading_time_ms = 82,200 against a wall clock of 178,400: a
     * reading speed of 439 wpm for someone who read at 202.
     *
     * The row was then internally consistent and unfalsifiable — the codebook says reading_time_ms
     * "is this minus reading_hidden_ms", and it was. Worse, the aggregator's skim rule would have
     * flagged the condition and docked its quality score, so the pre-registered filter would
     * preferentially drop exactly the conditions this defect corrupted. And if the absence exceeded
     * the read, the Math.max(0, ...) clamp below exported a reading_time_ms of 0 — a fabricated
     * zero for an exposure that happened.
     *
     * The dwell countdown is unaffected either way: it uses performance.now() deltas.
     */
    if (!started) return undefined;
    const t = trackHiddenTime();
    hidden.current = t;
    return () => { t.stop(); };
  }, [started]);

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
          'Three comprehension questions follow.',
          totalPages > 1 ? `There are ${totalPages} short pages.` : '',
          'Tap “Begin reading” when you are ready.',
        ].filter(Boolean)}
        buttonLabel="Begin reading →"
        background={background}
        text={text}
        onBegin={() => {
          taskStart.current = now();
          onBegin?.();
          setStarted(true);
        }}
      />
    );
  }

  const next = () => {
    if (!unlocked) return;
    pageDwells.current.push(Math.round(now() - pageStart.current));
    if (isLast) {
      // read() includes an interval still open, so a participant who returns to the app and
      // immediately taps Next does not carry that gap into the exposure.
      const away = hidden.current?.read().hiddenMs ?? 0;
      const wall = now() - taskStart.current;
      onComplete({
        readingTimeMs: Math.max(0, Math.round(wall - away)),
        wallClockMs: Math.round(wall),
        hiddenMs: away,
        pageDwellsMs: [...pageDwells.current],
      });
    } else setPage((p) => p + 1);
  };

  const minSecs = Math.ceil(CONFIG.READING_PAGE_MIN_MS / 1000);
  const countdownPct = Math.min(100, ((minSecs - secsLeft) / minSecs) * 100);

  return (
    /*
     * The column is a FIXED width in root pixels, centred, rather than a percentage of the root.
     *
     * The root box takes the device's aspect ratio, not the design canvas's, so a percentage column
     * gave 12% more characters per line on a Xiaomi Pad 6 than on the design canvas and 114% more on
     * a large display — at the same --vl-scale and the same glyph size, so stimulus_scale reported
     * no difference. Line length drives reading rate and regression frequency, both of which are
     * dependent variables here. See STIMULUS_COLUMN_PX.
     *
     * The condition background fills the whole screen, so the space either side of the column is the
     * stimulus field itself and nothing about this is visible to a participant.
     */
    <div
      className="screen w-full animate-fade-in"
      style={{ background, color: text, display: 'flex', justifyContent: 'center' }}
    >
    <div
      style={{ width: STIMULUS_COLUMN_PX, maxWidth: '100%', padding: '56px 0 3%', display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: STIMULUS_FONT_STACK, fontSize: 13, textTransform: 'uppercase', opacity: 0.5 }}>{passage.title}</span>
        <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, opacity: 0.6 }}>
          Page {page + 1} of {totalPages}
        </span>
      </div>
      <div style={{ height: 4, background: text + '20', margin: '8px 0', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${((page + 1) / totalPages) * 100}%`, background: text + '60', borderRadius: 2 }} />
      </div>

      <p
        className="scrollable"
        style={{ flex: 1, minHeight: 0, fontSize: CONFIG.READING_FONT_SIZE_PX, lineHeight: CONFIG.READING_LINE_HEIGHT, fontFamily: STIMULUS_FONT_STACK, whiteSpace: 'pre-wrap' }}
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
    </div>
  );
}
