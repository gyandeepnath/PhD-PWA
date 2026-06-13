import { describe, it, expect } from 'vitest';
import { PASSAGES, N_PASSAGES } from '@/experiment/passages';

/** Tokenisation rule from the original build: strip non-letters, lowercase, exact match. */
function countOccurrences(text: string, target: string): number {
  return text
    .split(/(\s+)/)
    .filter((tok) => tok.trim().length > 0)
    .map((tok) => tok.replace(/[^a-zA-Z]/g, '').toLowerCase())
    .filter((w) => w === target.toLowerCase()).length;
}

describe('passages content integrity', () => {
  it('has exactly 8 passages', () => {
    expect(N_PASSAGES).toBe(8);
  });

  for (const p of PASSAGES) {
    describe(`P${p.id} — ${p.title}`, () => {
      it('has a title and 2 pages of non-empty text', () => {
        expect(p.title.length).toBeGreaterThan(0);
        expect(p.pages.length).toBe(2);
        for (const pg of p.pages) expect(pg.trim().length).toBeGreaterThan(50);
      });

      it('has a 4-option MCQ with a valid correct index', () => {
        expect(p.question.options.length).toBe(4);
        expect(p.question.correctIndex).toBeGreaterThanOrEqual(0);
        expect(p.question.correctIndex).toBeLessThan(4);
        expect(p.question.text.length).toBeGreaterThan(0);
      });

      it('search target appears exactly searchTargetCount times in the passage', () => {
        const fullText = p.pages.join(' ');
        expect(countOccurrences(fullText, p.searchTarget)).toBe(p.searchTargetCount);
      });
    });
  }

  it('all passages have unique titles', () => {
    expect(new Set(PASSAGES.map((p) => p.title)).size).toBe(N_PASSAGES);
  });
});
