import { describe, it, expect } from 'vitest';
import {
  williamsFirstRow,
  williamsSquare,
  conditionOrderFor,
  passageForCondition,
  sessionPlan,
} from '@/experiment/counterbalance';

const N = 8;

describe('Williams balanced Latin square', () => {
  it('first row matches the original build ([0,1,7,2,6,3,5,4])', () => {
    expect(williamsFirstRow(8)).toEqual([0, 1, 7, 2, 6, 3, 5, 4]);
  });

  it('every row is a permutation of 0..N-1 (Latin property, rows)', () => {
    for (const row of williamsSquare(N)) {
      expect([...row].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('every column is a permutation of 0..N-1 (Latin property, columns)', () => {
    const sq = williamsSquare(N);
    for (let col = 0; col < N; col++) {
      const column = sq.map((row) => row[col]).sort((a, b) => a - b);
      expect(column).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('each condition appears in each serial position equally over a block of 8', () => {
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
    // follows[a][b] = # times b immediately follows a, over a full block of 8 participants.
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
  it('each participant sees all 8 passages exactly once', () => {
    for (let p = 1; p <= 20; p++) {
      const passages = Array.from({ length: N }, (_, c) => passageForCondition(c, p));
      expect([...passages].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('over a block of 8 participants, every condition is paired with every passage once', () => {
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
  it('produces 8 steps with valid, unique conditions and unique passages', () => {
    const plan = sessionPlan(5);
    expect(plan).toHaveLength(N);
    expect(plan.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...new Set(plan.map((s) => s.conditionIndex))].length).toBe(N);
    expect([...new Set(plan.map((s) => s.passageIndex))].length).toBe(N);
  });
});
