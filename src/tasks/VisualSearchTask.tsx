/**
 * Visual search: tap every occurrence of the target word within the passage. Hard 40 s limit.
 * Uses refs for found/false-detection state so the timeout reads live values (the original had a
 * stale-closure bug capturing zeros at mount). Denominator is the AUTHORITATIVE occurrence count.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import { TaskIntro } from './TaskIntro';
import type { Passage } from '@/experiment/passages';

export interface SearchResult {
  searchTimeMs: number;
  timeToFirstTargetMs: number | null;
  targetsFound: number;
  targetsMissed: number;
  falseDetections: number;
  accuracyRate: number;
  searchEfficiency: number;
  meanInterTargetIntervalMs: number | null;
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

  const [started, setStarted] = useState(false);
  const [foundIdx, setFoundIdx] = useState<Set<number>>(new Set());
  const start = useRef(now());
  const clickTimes = useRef<number[]>([]);
  const falseDet = useRef(0);
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
      falseDetections: falseDet.current,
      accuracyRate: totalTargets > 0 ? found / totalTargets : 0,
      searchEfficiency: elapsed > 0 ? found / (elapsed / 60000) : 0,
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
      falseDet.current += 1;
    }
  };

  return (
    <div className="min-h-screen w-full animate-fade-in" style={{ background, color: text, padding: '4% 8%', display: 'flex', flexDirection: 'column' }}>
      <p style={{ fontFamily: '"DM Mono", monospace', fontSize: 15 }}>
        <strong>Find and tap every occurrence of:</strong>{' '}
        <span style={{ padding: '2px 10px', borderRadius: 4, border: `1.5px solid ${text}80`, fontWeight: 700 }}>
          {passage.searchTarget}
        </span>{' '}
        <span style={{ opacity: 0.6 }}>({foundIdx.size}/{totalTargets})</span>
      </p>
      <div className="scrollable" style={{ flex: 1, marginTop: 16, fontSize: 19, lineHeight: 1.9, fontFamily: STIMULUS_FONT_STACK, whiteSpace: 'pre-wrap' }}>
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
  );
}
