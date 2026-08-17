import { describe, it, expect } from 'vitest';
import {
  williamsFirstRow,
  williamsSquare,
  conditionOrderFor,
  passageForCondition,
  sessionPlan,
  blockPlan,
} from '@/experiment/counterbalance';
import { N_CONDITIONS } from '@/experiment/conditions';
import { N_PASSAGES } from '@/experiment/passages';
import { illuminationOrderFor, illuminationForBlock, N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';

const N = N_CONDITIONS;

describe('Williams balanced Latin square', () => {
  it('first row matches the original build ([0,1,7,2,6,3,5,4])', () => {
    expect(williamsFirstRow(8)).toEqual([0, 1, 7, 2, 6, 3, 5, 4]);
    expect(williamsFirstRow(10)).toEqual([0, 1, 9, 2, 8, 3, 7, 4, 6, 5]);
  });

  it('every row is a permutation of 0..N-1 (Latin property, rows)', () => {
    for (const row of williamsSquare(N)) {
      expect([...row].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i));
    }
  });

  it('every column is a permutation of 0..N-1 (Latin property, columns)', () => {
    const sq = williamsSquare(N);
    for (let col = 0; col < N; col++) {
      const column = sq.map((row) => row[col]).sort((a, b) => a - b);
      expect(column).toEqual(Array.from({ length: N }, (_, i) => i));
    }
  });

  it('each condition appears in each serial position equally over a block of N', () => {
    // counts[condition][position]
    const counts = Array.from({ length: N }, () => Array(N).fill(0));
    for (let p = 1; p <= N; p++) {
      conditionOrderFor(p).forEach((cond, pos) => {
        counts[cond][pos]++;
      });
    }
    for (const cond of counts) for (const cell of cond) expect(cell).toBe(1);
  });

  it('first-order carryover is balanced (each condition follows each other equally)', () => {
    // follows[a][b] = # times b immediately follows a, over a full block of N participants.
    const follows = Array.from({ length: N }, () => Array(N).fill(0));
    for (let p = 1; p <= N; p++) {
      const order = conditionOrderFor(p);
      for (let i = 0; i < order.length - 1; i++) follows[order[i]][order[i + 1]]++;
    }
    // In a balanced Williams square each ordered pair (a->b, a!=b) occurs exactly once.
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        if (a === b) expect(follows[a][b]).toBe(0);
        else expect(follows[a][b]).toBe(1);
      }
    }
  });

  it('cycles every N participants', () => {
    expect(conditionOrderFor(1)).toEqual(conditionOrderFor(1 + N));
    expect(conditionOrderFor(3)).toEqual(conditionOrderFor(3 + 2 * N));
  });
});

describe('passage decoupling from condition', () => {
  it('each participant sees all N passages exactly once', () => {
    for (let p = 1; p <= 20; p++) {
      const passages = Array.from({ length: N }, (_, c) => passageForCondition(c, p));
      expect([...passages].sort((a, b) => a - b)).toEqual(Array.from({ length: N }, (_, i) => i));
    }
  });

  it('over a block of N participants, every condition is paired with every passage once', () => {
    const pair = Array.from({ length: N }, () => Array(N).fill(0));
    for (let p = 1; p <= N; p++) {
      for (let c = 0; c < N; c++) pair[c][passageForCondition(c, p)]++;
    }
    for (const cond of pair) for (const cell of cond) expect(cell).toBe(1);
  });

  it('is NOT the old yoked mapping (passage !== conditionIndex for all participants)', () => {
    // The original confound: passage index always equalled condition index.
    let everDiffers = false;
    for (let p = 1; p <= N; p++) {
      for (let c = 0; c < N; c++) {
        if (passageForCondition(c, p) !== c) everDiffers = true;
      }
    }
    expect(everDiffers).toBe(true);
  });
});

describe('sessionPlan', () => {
  it('produces N steps with valid, unique conditions and unique passages', () => {
    const plan = sessionPlan(5);
    expect(plan).toHaveLength(N);
    expect(plan.map((s) => s.position)).toEqual(Array.from({ length: N }, (_, i) => i));
    expect([...new Set(plan.map((s) => s.conditionIndex))].length).toBe(N);
    expect([...new Set(plan.map((s) => s.passageIndex))].length).toBe(N);
  });
});

describe('illumination as the session-level (whole-plot) factor', () => {
  it('gives every participant both levels, exactly once each', () => {
    for (let e = 1; e <= 40; e++) {
      const order = illuminationOrderFor(e);
      expect(order).toHaveLength(N_ILLUMINATION_BLOCKS);
      expect(new Set(order).size).toBe(N_ILLUMINATION_BLOCKS);
    }
  });

  it('counterbalances which level comes first, 50/50 across a block of participants', () => {
    const firsts = Array.from({ length: N }, (_, i) => illuminationOrderFor(i + 1)[0]);
    const dimFirst = firsts.filter((f) => f === 'dim').length;
    expect(dimFirst).toBe(N / 2);
  });

  it('is orthogonal to the Williams row — every row appears with both orders across 2N', () => {
    const seen = new Map<number, Set<string>>();
    for (let e = 1; e <= 2 * N; e++) {
      const row = (e - 1) % N;
      if (!seen.has(row)) seen.set(row, new Set());
      seen.get(row)!.add(illuminationOrderFor(e)[0]);
    }
    for (const orders of seen.values()) expect(orders.size).toBe(N_ILLUMINATION_BLOCKS);
  });

  it('resolves a level per block consistently with the order', () => {
    for (let e = 1; e <= 20; e++) {
      const order = illuminationOrderFor(e);
      for (let b = 0; b < N_ILLUMINATION_BLOCKS; b++) {
        expect(illuminationForBlock(e, b)).toBe(order[b]);
      }
    }
  });
});

describe('blockPlan — the second session is not a replay of the first', () => {
  it('covers all N conditions in every block', () => {
    for (let e = 1; e <= 12; e++) {
      for (let b = 0; b < N_ILLUMINATION_BLOCKS; b++) {
        const idx = blockPlan(e, b).map((s) => s.conditionIndex).sort((x, y) => x - y);
        expect(idx).toEqual(Array.from({ length: N }, (_, i) => i));
      }
    }
  });

  it('presents the conditions in a DIFFERENT serial order in the second block', () => {
    // Without this, serial position would be perfectly correlated with condition within a
    // participant across both sessions, and a position effect would masquerade as a condition
    // effect in the same direction twice.
    for (let e = 1; e <= 12; e++) {
      const a = blockPlan(e, 0).map((s) => s.conditionIndex);
      const b = blockPlan(e, 1).map((s) => s.conditionIndex);
      expect(a).not.toEqual(b);
    }
  });

  it('keeps complete balance across a block of N participants in EACH illumination block', () => {
    for (let blk = 0; blk < N_ILLUMINATION_BLOCKS; blk++) {
      const counts = Array.from({ length: N }, () => Array.from({ length: N }, () => 0));
      for (let e = 1; e <= N; e++) {
        blockPlan(e, blk).forEach((s, pos) => { counts[s.conditionIndex][pos]++; });
      }
      for (const row of counts) for (const c of row) expect(c).toBe(1);
    }
  });

  it('never repeats a passage for the same participant across their two sessions', () => {
    for (let e = 1; e <= 12; e++) {
      const p0 = blockPlan(e, 0).map((s) => s.passageIndex);
      const p1 = blockPlan(e, 1).map((s) => s.passageIndex);
      expect(new Set(p0).size).toBe(N_PASSAGES);
      expect(new Set(p1).size).toBe(N_PASSAGES);
      // Each block uses every passage once, so a participant reads all N twice — but a given
      // CONDITION is never paired with the same passage in both blocks.
      const pairRepeat = blockPlan(e, 0).some((s, i) =>
        s.conditionIndex === blockPlan(e, 1)[i]?.conditionIndex && s.passageIndex === blockPlan(e, 1)[i]?.passageIndex);
      expect(pairRepeat).toBe(false);
    }
  });
});
