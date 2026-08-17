import { describe, it, expect } from 'vitest';
import { PASSAGES, N_PASSAGES, countWords, countTargetOccurrences } from '@/experiment/passages';
import { N_CONDITIONS } from '@/experiment/conditions';

describe('passage set', () => {
  it('supplies exactly one passage per condition, so the passage x condition square is complete', () => {
    expect(N_PASSAGES).toBe(N_CONDITIONS);
  });

  it('has contiguous ids matching array order', () => {
    PASSAGES.forEach((p, i) => expect(p.id).toBe(i));
  });

  it('derives wordCount from the text rather than declaring it', () => {
    // The original bundle DECLARED word counts that overstated the real text by 11-32%,
    // which silently inflated reading_speed_wpm (a secondary outcome) and pushed the
    // skim-detection floor out of calibration. Deriving them makes drift impossible.
    for (const p of PASSAGES) expect(p.wordCount).toBe(countWords(p.pages));
  });

  it('derives searchTargetCount with the visual-search task tokenisation', () => {
    for (const p of PASSAGES) {
      expect(p.searchTargetCount).toBe(countTargetOccurrences(p.pages, p.searchTarget));
      expect(p.searchTargetCount).toBeGreaterThan(0);
    }
  });

  it('matches passages for length — no passage is an outlier', () => {
    const w = PASSAGES.map((p) => p.wordCount);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(200);
    expect(Math.max(...w)).toBeLessThanOrEqual(280);
  });

  it('matches passages for readability — all within one Flesch band', () => {
    const syll = (w: string) =>
      Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]{1,2}/g) || []).length);
    const fre = PASSAGES.map((p) => {
      const t = p.pages.join(' ');
      const words = t.split(/\s+/).filter(Boolean);
      const sents = t.split(/[.!?]+/).filter((x) => x.trim()).length;
      return 206.835 - 1.015 * (words.length / sents)
        - 84.6 * (words.reduce((a, x) => a + syll(x), 0) / words.length);
    });
    // Genre and difficulty are held constant so passage difficulty stays orthogonal to
    // display condition (the rotation in counterbalance.ts handles assignment).
    for (const f of fre) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(35);
    }
  });

  it('gives every passage two pages and a well-formed 4-option question', () => {
    for (const p of PASSAGES) {
      expect(p.pages).toHaveLength(2);
      expect(p.question.options).toHaveLength(4);
      expect(p.question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(p.question.correctIndex).toBeLessThan(4);
      expect(new Set(p.question.options).size).toBe(4);
    }
  });

  it('spreads the correct answer across option positions (no positional response bias)', () => {
    const counts = [0, 0, 0, 0];
    for (const p of PASSAGES) counts[p.question.correctIndex]++;
    // No single position may carry more than half the answers.
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.ceil(N_PASSAGES / 2));
  });

  it('uses a distinct search target per passage', () => {
    const t = PASSAGES.map((p) => p.searchTarget.toLowerCase());
    expect(new Set(t).size).toBe(t.length);
  });
});
