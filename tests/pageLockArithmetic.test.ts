/**
 * The codebook's page-lock arithmetic is the corpus's (Round 92, audit 86 P7).
 *
 * reading_min_page_dwell_ms's entry said "the four unlocks guarantee 80 s against a skim floor of 86-90 s"
 * for many rounds after passages became three pages (Round 63): the least a passage can take is 60 s,
 * so the band the whole-passage skim rule misses is 26-30 s, not 6-10 s. The sentence is now built from
 * the corpus and CONFIG.
 */
import { describe, it, expect } from 'vitest';
import { PASSAGES } from '@/experiment/passages';
import { CONFIG } from '@/experiment/config';
import { ENGAGEMENT, pageLockArithmetic } from '@/dashboard/aggregate';
import { CODEBOOK } from '@/storage/export';

describe('what the page locks guarantee', () => {
  it('is pages x the unlock, against word count at the skim ceiling, passage by passage', () => {
    const a = pageLockArithmetic();
    expect(a.pages).toEqual(PASSAGES.map((p) => p.pages.length));
    expect(a.guaranteedS).toEqual(PASSAGES.map((p) => (p.pages.length * CONFIG.READING_PAGE_MIN_MS) / 1000));
    PASSAGES.forEach((p, i) => expect(a.skimFloorS[i]).toBeCloseTo((p.wordCount * 60) / ENGAGEMENT.SKIM_WPM_CEILING, 9));
  });

  it('the codebook says three pages and 60 s for the shipped corpus, never four and 80 s', () => {
    const d = CODEBOOK.find((r) => r.file === '02_conditions.csv' && r.column === 'reading_min_page_dwell_ms')!.description;
    const a = pageLockArithmetic();
    expect(new Set(a.pages)).toEqual(new Set([3]));
    expect(d).toContain(`the 3 pages' unlocks (${CONFIG.READING_PAGE_MIN_MS / 1000} s each) guarantee 60 s`);
    expect(d).toContain(`${Math.min(...a.skimFloorS).toFixed(1)}-${Math.max(...a.skimFloorS).toFixed(1)} s`);
    expect(d).not.toMatch(/four unlocks|80 s/);
  });
});
