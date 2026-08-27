import { describe, it, expect } from 'vitest';
import { PASSAGES, N_PASSAGES, QUESTIONS_PER_PASSAGE, countWords, countTargetOccurrences } from '@/experiment/passages';
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

  it('is long enough to buy the three-minute reading exposure the primary outcome needs', () => {
    // The incomplete-blink ratio is a binomial proportion, so its precision is set by how many
    // blinks the reading window captures. At the original ~240 words the exposure measured 73 s,
    // about 16 blinks, and the polarity x colour interaction had 27% power. Guarding the length
    // here is the cheapest way to stop an innocuous-looking edit from silently undoing that.
    const w = PASSAGES.map((p) => p.wordCount);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(540);
    expect(Math.max(...w)).toBeLessThanOrEqual(660);
  });

  it('matches passages for length — no passage is an outlier', () => {
    const w = PASSAGES.map((p) => p.wordCount);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    // Passage is rotated against condition, so an outlier would inject variance the rotation
    // spreads across conditions rather than removing.
    expect((Math.max(...w) - Math.min(...w)) / mean).toBeLessThan(0.18);
  });

  it('carries enough search targets for the fixed-time search task to be scorable', () => {
    // accuracy_rate = found / searchTargetCount. With only 2 targets, as one passage previously
    // had, that ratio moves in steps of 50% and is not comparable with a passage carrying 13.
    const n = PASSAGES.map((p) => p.searchTargetCount);
    expect(Math.min(...n)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...n)).toBeLessThanOrEqual(18);
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

  it('gives every passage four pages and three well-formed 4-option items', () => {
    for (const p of PASSAGES) {
      expect(p.pages).toHaveLength(4);
      expect(p.questions).toHaveLength(QUESTIONS_PER_PASSAGE);
      for (const q of p.questions) {
        expect(q.options).toHaveLength(4);
        expect(q.correctIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctIndex).toBeLessThan(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('probes gist, inference and detail once each, as the synopsis specifies', () => {
    for (const p of PASSAGES) {
      expect([...p.questions.map((q) => q.kind)].sort()).toEqual(['detail', 'gist', 'inference']);
    }
  });

  it('spreads the correct answer across option positions (no positional response bias)', () => {
    const counts = [0, 0, 0, 0];
    for (const p of PASSAGES) for (const q of p.questions) counts[q.correctIndex]++;
    // A participant who always picks one letter must not beat chance by much.
    const total = counts.reduce((a, b) => a + b, 0);
    expect(Math.max(...counts) / total).toBeLessThanOrEqual(0.4);
  });

  it('uses a distinct search target per passage', () => {
    const t = PASSAGES.map((p) => p.searchTarget.toLowerCase());
    expect(new Set(t).size).toBe(t.length);
  });
});
