/**
 * What a blank d-prime means, said where the analyst reads it (audit 86 D14).
 *
 * computeSdt leaves d-prime blank for two reasons: a trial pool was empty, or the participant
 * responded to no trial or to every trial (no variation, so the value would be made of the extreme-rate
 * correction alone). The codebooks named only the first, or only "not completed": a FINISHED search in
 * which no word was tapped, or a finished reaction block with no dot tapped, read as an unfinished run.
 * The reasons are now one constant beside the function, and every entry that describes an empty
 * d-prime cell quotes all of them.
 */
import { describe, it, expect } from 'vitest';
import { computeSdt, sdtUnestimableReason, SDT_UNESTIMABLE, type SdtUnestimableReason } from '@/lib/signalDetection';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';
import { CODEBOOK } from '@/storage/export';

describe('d-prime is blank exactly for the documented reasons (audit 86 D14)', () => {
  it('over every block of up to four trials per cell, blank iff a pool is empty or responding did not vary', () => {
    let seen: Record<SdtUnestimableReason, number> = { empty_pool: 0, no_variation: 0 };
    for (let hits = 0; hits <= 4; hits++) for (let misses = 0; misses <= 4; misses++)
      for (let falseAlarms = 0; falseAlarms <= 4; falseAlarms++) for (let correctRejections = 0; correctRejections <= 4; correctRejections++) {
        const input = { hits, misses, falseAlarms, correctRejections };
        const r = computeSdt(input);
        const emptyPool = hits + misses === 0 || falseAlarms + correctRejections === 0;
        const noVariation = !emptyPool && (hits + falseAlarms === 0 || misses + correctRejections === 0);
        expect(r.estimable, JSON.stringify(input)).toBe(!emptyPool && !noVariation);
        expect(r.d_prime == null).toBe(!r.estimable);
        expect(r.criterion == null).toBe(!r.estimable);
        const reason = sdtUnestimableReason(input);
        expect(reason).toBe(emptyPool ? 'empty_pool' : noVariation ? 'no_variation' : null);
        if (reason) seen = { ...seen, [reason]: seen[reason] + 1 };
      }
    // Both reasons occur, so the loop tested each.
    expect(seen.empty_pool).toBeGreaterThan(0);
    expect(seen.no_variation).toBeGreaterThan(0);
  });

  it('the audit\'s case: a finished search with no word tapped has both pools and no d-prime, for no_variation', () => {
    // ~6 targets, ~180 other words, nothing tapped.
    expect(sdtUnestimableReason({ hits: 0, misses: 6, falseAlarms: 0, correctRejections: 180 })).toBe('no_variation');
    // A finished reaction block with no dot tapped: 20 go misses, 12 no-go correct rejections.
    expect(sdtUnestimableReason({ hits: 0, misses: 20, falseAlarms: 0, correctRejections: 12 })).toBe('no_variation');
  });

  it('every entry describing an empty d-prime cell names every reason', () => {
    const texts: [string, string][] = [
      ['analysis_long search_d_prime (missing)', ANALYSIS_CODEBOOK.find((c) => c.column === 'search_d_prime')!.missing],
      ['analysis_long d_prime (missing)', ANALYSIS_CODEBOOK.find((c) => c.column === 'd_prime')!.missing],
      ['analysis_long criterion (missing)', ANALYSIS_CODEBOOK.find((c) => c.column === 'criterion')!.missing],
      ['09 d_prime_estimable', CODEBOOK.find((r) => r.file === '09_rt_summary.csv' && r.column === 'd_prime_estimable')!.description],
    ];
    for (const [where, text] of texts) {
      for (const reason of Object.values(SDT_UNESTIMABLE)) expect(text, where).toContain(reason);
    }
  });
});
