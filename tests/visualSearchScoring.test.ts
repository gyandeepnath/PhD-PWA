/**
 * The visual-search signal-detection model must count words, in both of its halves.
 *
 * The passage is tokenised with a CAPTURING split — `split(/(\s+)/)` — because rendering needs the
 * whitespace runs back to preserve the passage's spacing. That makes the token array about twice as
 * long as the passage is in words. `tokens.length` was then used as the word count in two places:
 * the correct-rejection pool behind search_d_prime, and the exported `distractor_words`, which the
 * codebook describes as "non-target words in the passage".
 *
 * And false alarms were counted as TAP EVENTS while hits were counted as words, so a participant
 * who double-tapped a wrong word accrued two false alarms for one word — in the limit, more false
 * alarms than there are words to make them from.
 *
 * Neither error cancels within a participant: d′ is computed from the false-alarm RATE, so
 * doubling its denominator shrinks that rate by a factor that depends on the false-alarm count,
 * which is itself a dependent measure varying with the display condition under test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PASSAGES } from '@/experiment/passages';
import { computeSdt } from '@/lib/signalDetection';

/** The task's own tokenisation, so this test moves if the task's does. */
const tokensOf = (pages: string[]) => pages.join('\n\n').split(/(\s+)/);
const wordsOf = (pages: string[]) => tokensOf(pages).filter((t) => t.trim().length > 0).length;

describe('the corpus really is double-counted by the token array', () => {
  it('every passage has about twice as many tokens as tappable words', () => {
    for (const p of PASSAGES) {
      const tokens = tokensOf(p.pages).length;
      expect(tokens / wordsOf(p.pages), p.searchTarget).toBeGreaterThan(1.9);
    }
  });

  it('the tappable pool is the task’s own definition, and is within 1% of the declared wordCount', () => {
    /*
     * They are not identical, and the difference is correct rather than a discrepancy to erase.
     * passages.countWords counts tokens containing at least one LETTER; the task treats any
     * non-whitespace token as tappable, so a standalone punctuation mark or a bare numeral is a
     * trial the participant can commit a false alarm on. The correct-rejection pool has to be what
     * can actually be tapped, or the signal-detection model is counting a different set of trials
     * from the one the participant faced.
     */
    for (const p of PASSAGES) {
      const tappable = wordsOf(p.pages);
      expect(tappable).toBeGreaterThanOrEqual(p.wordCount);
      expect((tappable - p.wordCount) / p.wordCount, p.searchTarget).toBeLessThan(0.01);
    }
  });
});

describe('the task counts words', () => {
  const src = readFileSync('src/tasks/VisualSearchTask.tsx', 'utf8');

  it('derives a word count instead of using the token array length', () => {
    expect(src).toMatch(/const wordCount = useMemo\(\(\) => tokens\.filter\(\(t\) => t\.isWord\)\.length/);
    const finish = src.slice(src.indexOf('const finish ='), src.indexOf('};', src.indexOf('const finish =')));
    expect(finish).toMatch(/wordCount - totalTargets/);
    expect(finish, 'tokens.length is still standing in for a word count').not.toMatch(/tokens\.length/);
  });

  it('counts a falsely-tapped WORD once, however many times it is tapped', () => {
    // A Set of token indices: the same thing hits are counted with.
    expect(src).toMatch(/falseDet = useRef<Set<number>>\(new Set\(\)\)/);
    expect(src).toMatch(/falseDet\.current\.add\(tok\.i\)/);
    expect(src).toMatch(/falseDetections: falseDet\.current\.size/);
  });
});

describe('what the inflated pool did to d-prime', () => {
  /** Passage 0's real numbers: 601 words, 12 targets. */
  const words = 601;
  const targets = 12;

  const dPrimeWithPool = (pool: number, falseAlarms: number) => computeSdt({
    hits: 10,
    misses: targets - 10,
    falseAlarms,
    correctRejections: Math.max(0, pool - targets - falseAlarms),
  }).d_prime!;

  it('overstated sensitivity, and by more the more errors the participant made', () => {
    const truePool = words;
    const inflatedPool = tokensOf(PASSAGES[0].pages).length;

    const gapAtFew = dPrimeWithPool(inflatedPool, 5) - dPrimeWithPool(truePool, 5);
    const gapAtMany = dPrimeWithPool(inflatedPool, 20) - dPrimeWithPool(truePool, 20);

    expect(gapAtFew).toBeGreaterThan(0);
    expect(gapAtMany).toBeGreaterThan(0);
    // The distortion is not a constant offset, so it does not subtract out of a within-subject
    // contrast between two display conditions.
    expect(gapAtMany).not.toBeCloseTo(gapAtFew, 2);
  });
});
