import { describe, it, expect } from 'vitest';
import {
  williamsFirstRow,
  williamsSquare,
  conditionOrderFor,
  passageForCondition,
  PASSAGE_ROTATION_PERIOD,
  sessionPlan,
  blockPlan,
} from '@/experiment/counterbalance';
import { N_CONDITIONS } from '@/experiment/conditions';
import { N_PASSAGES } from '@/experiment/passages';
import {
  illuminationOrderFor, illuminationForBlock, crossoverOrderFor,
  N_ILLUMINATION_BLOCKS, ILLUMINATION_LEVELS, specFor,
} from '@/experiment/illumination';

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

describe('illumination: the protocol this build actually runs', () => {
  /*
   * The study runs at a SINGLE ambient level. The camera is the reason: computed from this build's
   * own condition table, a positive-polarity screen casts ~14.6 lux on the participant's face and a
   * negative-polarity one ~0.49 lux, so against a 10 lux room the face illumination differs by 2.35x
   * BETWEEN THE TWO LEVELS OF THE PRIMARY INDEPENDENT VARIABLE. At 300 lux that ratio is 1.05.
   * See the note on ILLUMINATION_LEVELS in src/experiment/illumination.ts.
   */
  it('runs one level, so every participant does one sitting', () => {
    expect(N_ILLUMINATION_BLOCKS).toBe(1);
    for (let e = 1; e <= 40; e++) {
      expect(illuminationOrderFor(e)).toEqual(['moderate']);
      expect(illuminationForBlock(e, 0)).toBe('moderate');
    }
  });

  it('targets the level at which the polarity confound collapses', () => {
    // 300 lux is the bottom of the ISO 9241-referenced 300-500 lux range for screen work, and the
    // level at which the room dominates the face illumination rather than the stimulus.
    const spec = specFor('moderate')!;
    expect(spec.target).toBe(300);
    expect(spec.min).toBe(250);
    expect(spec.max).toBe(350);
  });

  it('still resolves a withdrawn level, so archived sittings stay readable', () => {
    // 'dim' is disabled, not deleted. A session recorded under it must not become unreadable.
    expect(specFor('dim')).not.toBeNull();
    expect(ILLUMINATION_LEVELS).not.toContain('dim');
  });
});

describe('the crossover rule is dormant, not lost', () => {
  /*
   * These test crossoverOrderFor DIRECTLY rather than through illuminationOrderFor, which now
   * short-circuits. A switched-off mechanism whose tests were deleted with its caller is not
   * recoverable, only present — so the balance properties stay proven while the rule is unreached,
   * and restoring ILLUMINATION_LEVELS restores something known to work.
   */
  it('gives every participant both levels, exactly once each', () => {
    for (let e = 1; e <= 40; e++) {
      const order = crossoverOrderFor(e);
      expect(order).toHaveLength(2);
      expect(new Set(order).size).toBe(2);
    }
  });

  it('counterbalances which level comes first, 50/50 across a block of participants', () => {
    const firsts = Array.from({ length: N }, (_, i) => crossoverOrderFor(i + 1)[0]);
    expect(firsts.filter((f) => f === 'dim').length).toBe(N / 2);
  });

  it('is orthogonal to the Williams row — every row appears with both orders across 2N', () => {
    const seen = new Map<number, Set<string>>();
    for (let e = 1; e <= 2 * N; e++) {
      const row = (e - 1) % N;
      if (!seen.has(row)) seen.set(row, new Set());
      seen.get(row)!.add(crossoverOrderFor(e)[0]);
    }
    for (const orders of seen.values()) expect(orders.size).toBe(2);
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

describe('passage is decoupled from SERIAL POSITION, not only from condition', () => {
  /*
   * The existing test above checks passage x condition, which always held. Nothing checked
   * passage x position, and that is where the design was broken.
   *
   * The passage offset used to be `(enrolment - 1) mod N_CONDITIONS` — the same quantity as the
   * Williams row. Both rotations advanced together, and because the row is recoverable from
   * (condition, position) in a Latin square, passage became a deterministic function of them.
   * Enumerated over 200 participants x 2 blocks: every one of the 100 (condition, position) cells
   * held exactly ONE passage, and each position could only ever draw from five of the ten, split
   * by parity.
   *
   * It mattered because session_position is the exported covariate for time-on-task. A position
   * effect estimated on a fixed half of the corpus carries a permanent corpus property — search
   * target counts, reading difficulty — that recruitment cannot average away.
   */
  const enumerate = (nParticipants: number) => {
    const byPosition = new Map<number, Set<number>>();
    const byCell = new Map<string, Set<number>>();
    const positionPassageCount = new Map<string, number>();
    for (let e = 1; e <= nParticipants; e++) {
      for (const block of [0, 1]) {
        for (const step of blockPlan(e, block)) {
          const pos = step.position;
          (byPosition.get(pos) ?? byPosition.set(pos, new Set()).get(pos)!).add(step.passageIndex);
          const cell = `${step.conditionIndex}|${pos}`;
          (byCell.get(cell) ?? byCell.set(cell, new Set()).get(cell)!).add(step.passageIndex);
          const key = `${pos}|${step.passageIndex}`;
          positionPassageCount.set(key, (positionPassageCount.get(key) ?? 0) + 1);
        }
      }
    }
    return { byPosition, byCell, positionPassageCount };
  };

  it('every passage can appear at every serial position', () => {
    const { byPosition } = enumerate(200);
    for (const [pos, seen] of byPosition) {
      expect(seen.size, `position ${pos} can only ever show ${seen.size} of ${N_PASSAGES} passages`)
        .toBe(N_PASSAGES);
    }
  });

  it('passage is NOT a deterministic function of (condition, position)', () => {
    // The single sharpest statement of the bug: when every cell holds one passage, passage carries
    // no information beyond condition and position, and is perfectly aliased with their interaction.
    const { byCell } = enumerate(200);
    const singletons = [...byCell.entries()].filter(([, s]) => s.size === 1).map(([k]) => k);
    expect(singletons, `these (condition|position) cells are locked to one passage: ${singletons.slice(0, 8).join(', ')}`)
      .toEqual([]);
  });

  it('is uniform across positions at the planned enrolment', () => {
    // Complete coverage is not enough; it must also be balanced, or position still carries a
    // corpus-difficulty gradient.
    const { positionPassageCount } = enumerate(130);
    const counts = [...positionPassageCount.values()];
    expect(counts.length).toBe(10 * N_PASSAGES);
    expect(Math.max(...counts) - Math.min(...counts),
      'position x passage counts are not uniform at n=130').toBe(0);
  });

  it('still gives each participant all N passages exactly once per sitting', () => {
    // The property the original test guarded must survive the fix.
    for (let e = 1; e <= 60; e++) {
      for (const block of [0, 1]) {
        const passages = blockPlan(e, block).map((s) => s.passageIndex).sort((a, b) => a - b);
        expect(passages).toEqual(Array.from({ length: N_PASSAGES }, (_, i) => i));
      }
    }
  });

  it('uses a rotation period coprime to the condition count', () => {
    // If these ever share a factor the aliasing returns silently.
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    expect(gcd(PASSAGE_ROTATION_PERIOD, N)).toBe(1);
  });
});
