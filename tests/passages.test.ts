import { describe, it, expect } from 'vitest';
import {
  PASSAGES, N_PASSAGES, QUESTIONS_PER_PASSAGE, countWords, countTargetOccurrences,
  selectSearchExcerpt, SEARCH_EXCERPT_MAX_WORDS,
} from '@/experiment/passages';
import { fnv1a } from '@/storage/export';
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

  it('derives searchTargetCount from the EXCERPT, with the visual-search task tokenisation', () => {
    for (const p of PASSAGES) {
      expect(p.searchTargetCount).toBe(countTargetOccurrences([p.searchExcerpt], p.searchTarget));
      expect(p.passageTargetCount).toBe(countTargetOccurrences(p.pages, p.searchTarget));
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

  it('carries the target counts the investigator accepted for the one-screen excerpt', () => {
    /*
     * An INVESTIGATOR DECISION, pinned so it cannot drift. The search task shows one screen at the
     * reading font size (it used to need 2.5 screens of scrolling with no cue). An equal count in
     * every passage was checked and is not available from these texts — the most any one-screen
     * window holds of ANY content word is 4-5 in the sparse passages — so each passage shows the
     * stretch where its own target is densest, and the counts differ, as they already did (8-14).
     * The floor is 4, not the old 6: accuracy then moves in 25% steps in the sparsest passages,
     * the stated cost of the design chosen over "exactly 4 everywhere" and over a paginated passage.
     */
    expect(PASSAGES.map((p) => p.searchTargetCount)).toEqual([11, 7, 6, 7, 11, 5, 5, 8, 4, 4]);
    const n = PASSAGES.map((p) => p.searchTargetCount);
    expect(Math.min(...n)).toBeGreaterThanOrEqual(4);
  });

  it('shows a genuine, sentence-aligned, one-screen stretch of the passage — the densest one', () => {
    const norm = (t: string) => t.split(/\s+/).filter(Boolean).join(' ');
    for (const p of PASSAGES) {
      // Contiguous: the excerpt's words appear, in order, unbroken, in the passage.
      expect(norm(p.pages.join(' ')), `passage ${p.id}`).toContain(norm(p.searchExcerpt));
      // Whole sentences: it ends at a sentence end and starts with a capital.
      expect(p.searchExcerpt.trim(), `passage ${p.id}`).toMatch(/[.!?]["')]?$/);
      expect(p.searchExcerpt.trim(), `passage ${p.id}`).toMatch(/^["'(]?[A-Z]/);
      expect(countWords([p.searchExcerpt]), `passage ${p.id}`).toBeLessThanOrEqual(SEARCH_EXCERPT_MAX_WORDS);
      // Densest: no other window within the budget holds more of the target.
      for (const cap of [SEARCH_EXCERPT_MAX_WORDS - 20, SEARCH_EXCERPT_MAX_WORDS]) {
        const alt = selectSearchExcerpt(p.pages, p.searchTarget, cap);
        expect(countTargetOccurrences([alt], p.searchTarget)).toBeLessThanOrEqual(p.searchTargetCount);
      }
    }
  });

  it('pins the exact search stimulus, so a change to the selection rule cannot pass silently', () => {
    // A different excerpt is a different stimulus. If this fails because the rule was changed on
    // purpose, update the fingerprints AND record the change as a protocol amendment.
    expect(PASSAGES.map((p) => fnv1a(p.searchExcerpt))).toEqual([
      '0fc1d5e6', 'b9fd9347', 'ee82232f', '681870d6', '23a41595',
      '38e5849d', '4ffd36ad', '0d2ab3a7', '74aa496a', '959659f0',
    ]);
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

  it('gives every passage THREE pages and three well-formed 4-option items', () => {
    // Three, by investigator decision ("max three flippable pages"). It was four, of very unequal
    // length: page 1 of one passage filled 40% of the screen and page 4 of the same passage 98%.
    for (const p of PASSAGES) {
      expect(p.pages).toHaveLength(3);
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

  it('re-paginated the passages WITHOUT changing a single word', () => {
    /*
     * The pages were re-split from four to three. The words are the validated reading material —
     * length- and difficulty-matched, with comprehension items written against them — so the one
     * thing the re-split must not do is alter them. These fingerprints were taken of each passage's
     * whitespace-normalised word sequence BEFORE the re-split; they must still match after it.
     */
    const seq = (pages: string[]) => pages.join(' ').split(/\s+/).filter(Boolean).join(' ');
    expect(PASSAGES.map((p) => fnv1a(seq(p.pages)))).toEqual([
      'e29cbe63', 'a17ea6c3', '65d440ab', 'f470c17d', '04fd9ad2',
      '7071daf1', 'd5e0c8ff', '2b9e31f9', '7bf7df44', '405e3390',
    ]);
  });

  it('balances the three pages, and breaks them only at sentence ends', () => {
    // Near-equal pages are what make the per-page 20 s unlock mean the same thing on every page.
    for (const p of PASSAGES) {
      const words = p.pages.map((pg) => countWords([pg]));
      const third = p.wordCount / 3;
      for (const w of words) expect(Math.abs(w - third) / third, `passage ${p.id}: ${words}`).toBeLessThan(0.1);
      for (const pg of p.pages) expect(pg.trim(), `passage ${p.id}`).toMatch(/[.!?]["')]?$/);
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
