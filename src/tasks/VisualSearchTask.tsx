/**
 * Visual search: tap every occurrence of the target word within the passage. Hard 40 s limit.
 * Uses refs for found/false-detection state so the timeout reads live values (the original had a
 * stale-closure bug capturing zeros at mount). Denominator is the AUTHORITATIVE occurrence count.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeSdt } from '@/lib/signalDetection';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import { TaskIntro } from './TaskIntro';
import type { Passage } from '@/experiment/passages';
import { STIMULUS_COLUMN_PX } from '@/lib/viewportScale';

export interface SearchResult {
  searchTimeMs: number;
  timeToFirstTargetMs: number | null;
  targetsFound: number;
  targetsMissed: number;
  falseDetections: number;
  accuracyRate: number;
  searchEfficiency: number;
  meanInterTargetIntervalMs: number | null;
  /**
   * Sensitivity over WORDS as trials: hits = targets found, false alarms = non-target words tapped,
   * with the remaining words as correct rejections.
   *
   * accuracy_rate and search_efficiency both ignore false detections entirely, so a participant who
   * drags a finger across the passage tapping every word finds all the targets in seconds and
   * scores a perfect accuracy_rate with a search_efficiency three times their own mean — their best
   * condition in the study — while false_detections sits at several hundred and no quality flag
   * fires. d-prime cannot be inflated that way: tapping everything raises the false-alarm rate as
   * fast as the hit rate.
   */
  dPrime: number | null;
  /** Non-target words available to be wrongly tapped: the correct-rejection pool. */
  distractorWords: number;
  terminationMode: 'time_limit' | 'voluntary_full' | 'voluntary_early';
}

interface Token {
  i: number;
  text: string;
  isWord: boolean;
  isTarget: boolean;
}

interface Props {
  passage: Passage;
  background: string;
  text: string;
  onComplete: (r: SearchResult) => void;
}

export function VisualSearchTask({ passage, background, text, onComplete }: Props) {
  const target = passage.searchTarget.toLowerCase();
  const totalTargets = passage.searchTargetCount;

  const tokens = useMemo<Token[]>(() => {
    const raw = passage.pages.join('\n\n').split(/(\s+)/);
    return raw.map((t, i) => {
      const isWord = t.trim().length > 0;
      const stripped = t.replace(/[^a-zA-Z]/g, '').toLowerCase();
      return { i, text: t, isWord, isTarget: isWord && stripped === target };
    });
  }, [passage, target]);

  /**
   * WORDS, not tokens. The split above is CAPTURING — `split(/(\s+)/)` — because rendering needs the
   * whitespace runs back to preserve the passage's spacing. That makes `tokens` about twice as long
   * as the passage is in words, one separator between every pair.
   *
   * `tokens.length` was then used as the word count in two places: the correct-rejection pool
   * behind search_d_prime, and the exported `distractor_words`. Measured on the shipped corpus,
   * passage 0 has 601 words and 1,201 tokens, so `distractor_words` exported 1,189 against a true
   * 589 — every passage roughly doubled, while the codebook calls the column "non-target words in
   * the passage".
   *
   * It does not cancel in a within-subject contrast. d′ is computed from the false-alarm RATE, and
   * doubling its denominator shrinks that rate by a factor that depends on the false-alarm count —
   * itself a dependent measure that varies with the display condition under test. So the inflation
   * is larger for the conditions in which participants tap more wrongly, which is the effect the
   * search task exists to detect.
   */
  const wordCount = useMemo(() => tokens.filter((t) => t.isWord).length, [tokens]);

  const [started, setStarted] = useState(false);
  const [foundIdx, setFoundIdx] = useState<Set<number>>(new Set());
  const start = useRef(now());
  const clickTimes = useRef<number[]>([]);
  /**
   * Non-target WORDS tapped, not taps on them.
   *
   * This was a counter incremented on every tap, while a re-tap on an already-found target returned
   * early — so the two halves of the same signal-detection model counted different things: hits
   * were words, false alarms were tap events. A participant who double-tapped a wrong word accrued
   * two false alarms for one word, and in the limit the false-alarm count could exceed the pool it
   * is a proportion of. `export.ts` describes the measure as "non-target words tapped are false
   * alarms, the rest are correct rejections", which is what a set of token indices gives.
   */
  const falseDet = useRef<Set<number>>(new Set());
  const foundRef = useRef<Set<number>>(new Set());
  const done = useRef(false);

  const finish = (mode: SearchResult['terminationMode']) => {
    if (done.current) return;
    done.current = true;
    const elapsed = now() - start.current;
    const found = foundRef.current.size;
    const times = clickTimes.current;
    const intervals = times.slice(1).map((t, k) => t - times[k]);
    onComplete({
      searchTimeMs: elapsed,
      timeToFirstTargetMs: times.length ? times[0] - start.current : null,
      targetsFound: found,
      targetsMissed: Math.max(0, totalTargets - found),
      falseDetections: falseDet.current.size,
      accuracyRate: totalTargets > 0 ? found / totalTargets : 0,
      searchEfficiency: elapsed > 0 ? found / (elapsed / 60000) : 0,
      // Words as trials. Uses the same signal-detection machinery as the reaction-time block, so a
      // tap-everything strategy cannot produce a good score.
      dPrime: computeSdt({
        hits: found,
        misses: Math.max(0, totalTargets - found),
        falseAlarms: falseDet.current.size,
        correctRejections: Math.max(0, wordCount - totalTargets - falseDet.current.size),
      }).d_prime,
      distractorWords: Math.max(0, wordCount - totalTargets),
      meanInterTargetIntervalMs: intervals.length
        ? intervals.reduce((s, v) => s + v, 0) / intervals.length
        : null,
      terminationMode: mode,
    });
  };

  useEffect(() => {
    if (!started) return;
    start.current = now();
    const id = setTimeout(() => finish('time_limit'), CONFIG.VS_TIME_LIMIT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  if (!started) {
    return (
      <TaskIntro
        eyebrow="Task 3 of 4 · Visual search"
        title="Find the target word"
        lines={[
          `Find and tap every occurrence of the word “${passage.searchTarget}” in the text.`,
          'Be as fast and accurate as you can. Tapping a wrong word counts against you.',
          `You have ${Math.round(CONFIG.VS_TIME_LIMIT_MS / 1000)} seconds; tap “Done searching” when finished.`,
          'Tap “Begin search” when you are ready.',
        ]}
        buttonLabel="Begin search →"
        background={background}
        text={text}
        onBegin={() => setStarted(true)}
      />
    );
  }

  const tap = (tok: Token) => {
    if (done.current || !tok.isWord) return;
    if (tok.isTarget) {
      if (foundRef.current.has(tok.i)) return;
      foundRef.current.add(tok.i);
      clickTimes.current.push(now());
      setFoundIdx(new Set(foundRef.current));
      if (foundRef.current.size >= totalTargets) finish('voluntary_full');
    } else {
      falseDet.current.add(tok.i);
    }
  };

  return (
    /*
      height: '100%' — matching ReadingTask, which has it — is what bounds this flex column.
      With only min-h-screen the column is unbounded, so the flex:1 passage div grows to its full
      content height instead of scrolling, and everything below it is pushed outside #root, which
      is overflow:hidden with touch-action:none on the body. The end-of-block button then sits
      beyond the bottom edge with no way to reach it, so the block can only ever end on the 40 s
      cap and termination_mode can never be voluntary_early.
    */
    /* Fixed-width centred column, for the reason given in ReadingTask: a percentage column reflows
       with the device's aspect ratio, and this passage is the same stimulus material read under the
       same conditions. See STIMULUS_COLUMN_PX. */
    <div className="screen w-full animate-fade-in" style={{ background, color: text, display: 'flex', justifyContent: 'center' }}>
    <div style={{ width: STIMULUS_COLUMN_PX, maxWidth: '100%', padding: '4% 0', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <p style={{ fontFamily: '"DM Mono", monospace', fontSize: 15 }}>
        <strong>Find and tap every occurrence of:</strong>{' '}
        <span style={{ padding: '2px 10px', borderRadius: 4, border: `1.5px solid ${text}80`, fontWeight: 700 }}>
          {passage.searchTarget}
        </span>{' '}
        <span style={{ opacity: 0.6 }}>({foundIdx.size}/{totalTargets})</span>
      </p>
      <div className="scrollable" style={{ flex: 1, minHeight: 0, marginTop: 16, fontSize: 19, lineHeight: 1.9, fontFamily: STIMULUS_FONT_STACK, whiteSpace: 'pre-wrap' }}>
        {tokens.map((tok) =>
          tok.isWord ? (
            <span
              key={tok.i}
              onClick={() => tap(tok)}
              style={{
                cursor: 'pointer',
                /* The condition's own ink, not a fixed green. #22c97a measured 2.16:1 against the
                   light backgrounds and 9.70:1 against the dark ones — 4.5x more visible in one
                   polarity — and 1.48:1 against the green ink, invisible in exactly the condition
                   it was marking. This marker is the participant's only record of which occurrences
                   they have already tapped, and a re-tap is silently ignored, so a lost marker costs
                   search time without leaving any trace: a display-legibility artefact recorded as a
                   search-performance deficit, aligned with polarity across all five colours. */
                backgroundColor: foundIdx.has(tok.i) ? text + '30' : 'transparent',
                borderBottom: foundIdx.has(tok.i) ? `2px solid ${text}` : '2px solid transparent',
                transition: 'background-color 0.1s, border-color 0.1s',
              }}
            >
              {tok.text}
            </span>
          ) : (
            <span key={tok.i}>{tok.text}</span>
          ),
        )}
      </div>
      <button
        onClick={() => finish(foundIdx.size >= totalTargets ? 'voluntary_full' : 'voluntary_early')}
        className="mt-4 self-end rounded-xl px-8 py-3 font-lab text-sm transition active:scale-95"
        style={{ background: text, color: background, border: 'none' }}
      >
        Done searching →
      </button>
    </div>
    </div>
  );
}
