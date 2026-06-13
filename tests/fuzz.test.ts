import { describe, it, expect } from 'vitest';
import { runFuzz } from '@/sim/fuzz';

describe('fuzz / edge-case stress', () => {
  it('survives 20k degenerate iterations with no invariant violations (seed 1)', () => {
    const failures = runFuzz(20_000, 1);
    if (failures.length) console.error('FUZZ FAILURES:', failures.slice(0, 10));
    expect(failures).toHaveLength(0);
  });

  it('is clean across several seeds', () => {
    for (const seed of [7, 42, 1234]) {
      expect(runFuzz(5_000, seed)).toHaveLength(0);
    }
  });
});
