/**
 * The go/no-go dot appears at eight fixed places, used equally often in every block.
 *
 * The decision (research round 62, section 3.3): 2 rings (4 and 8 deg at 55 cm) x the 4 diagonals,
 * every location 4 times per 32-trial block, go and no-go spread over rings and quadrants by fixed
 * tables, the pattern mirrored on alternate blocks, each no-go colour split 2/1 across the rings with
 * the split alternating, the go/no-go order still planRuns's, and no location on two consecutive
 * trials. Everything below is a property of the planner the task calls; the browser checks of where
 * the dots land on the real screen are in e2e/stimulusGeometry.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RT_LOCATIONS, RT_BLOCK_GO, RT_BLOCK_NOGO, RT_BALANCED_GO, RT_BALANCED_NOGO, RT_RING_ECCENTRICITY_DEG,
  STUDY_TABLET_MM_PER_LAYOUT_PX, NOMINAL_VIEWING_DISTANCE_MM, ringRadiusPx, nominalEccentricityDeg, planRtBlock,
  type RtBlockPlan, type RtRing,
} from '@/lib/rtLocations';
import { longestRun } from '@/lib/foreperiod';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '@/lib/viewportScale';
import { CONFIG } from '@/experiment/config';
import { CONDITIONS, rtStimulusColours } from '@/experiment/conditions';

/** A deterministic uniform stream, so these tests never flake on an unlucky draw. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const N = CONFIG.RT_TRIALS_PER_CONDITION;
const N_GO = Math.round(N * CONFIG.RT_GO_RATE);
const N_NOGO = N - N_GO;
const { target: TARGET, distractors: PALETTE } = rtStimulusColours(CONDITIONS[1]);

const block = (blockIndex: number, rand: () => number, over: Partial<Parameters<typeof planRtBlock>[0]> = {}) =>
  planRtBlock({
    nGo: N_GO, nNoGo: N_NOGO, maxRun: CONFIG.RT_MAX_RUN, target: TARGET, distractors: PALETTE,
    blockIndex, practice: false, rand, ...over,
  });

/** Count of trials per [ring][quadrant 1..4] matching a filter. */
function table(p: RtBlockPlan, keep: (signal: boolean) => boolean): Record<RtRing, number[]> {
  const out: Record<RtRing, number[]> = { inner: [0, 0, 0, 0], outer: [0, 0, 0, 0] };
  for (const t of p.trials) if (keep(t.signal)) out[t.location.ring][t.location.quadrant - 1]++;
  return out;
}

const DOT = CONFIG.RT_DOT_PX;

describe('the eight locations', () => {
  it('are 2 rings x the 4 diagonals, numbered 1-4 inner and 5-8 outer, quadrant 1 up-right', () => {
    expect(RT_LOCATIONS).toHaveLength(8);
    expect(RT_LOCATIONS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(RT_LOCATIONS.map((l) => l.ring)).toEqual(['inner', 'inner', 'inner', 'inner', 'outer', 'outer', 'outer', 'outer']);
    expect(RT_LOCATIONS.map((l) => l.angleDeg)).toEqual([45, 135, 225, 315, 45, 135, 225, 315]);
    // Screen convention: + right, + DOWN. Quadrant 1 (45 deg) is up and to the right.
    expect(RT_LOCATIONS.map((l) => [Math.sign(l.dx), Math.sign(l.dy)])).toEqual([
      [1, -1], [-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1],
    ]);
  });

  it('derive their radii from the stated constants: 4 deg = 187 px, 8 deg = 376 px at 55 cm', () => {
    // The study tablet's panel (236.7 mm) over the canvas's 1152 design px: per LAYOUT px, which holds
    // at any pixel ratio once the canvas fills the screen (Round 74), not per CSS px.
    expect(STUDY_TABLET_MM_PER_LAYOUT_PX).toBeCloseTo(0.2055, 4);
    expect(NOMINAL_VIEWING_DISTANCE_MM).toBe(550);
    expect(RT_RING_ECCENTRICITY_DEG).toEqual({ inner: 4, outer: 8 });
    expect(ringRadiusPx(4)).toBe(187);
    expect(ringRadiusPx(8)).toBe(376);
  });

  it('sit at the research centres on the 1152x720 tablet, in whole root px', () => {
    const centres = RT_LOCATIONS.map((l) => [DESIGN_WIDTH / 2 + l.dx, DESIGN_HEIGHT / 2 + l.dy]);
    expect(centres).toEqual([
      [708, 228], [444, 228], [444, 492], [708, 492],
      [842, 94], [310, 94], [310, 626], [842, 626],
    ]);
    for (const l of RT_LOCATIONS) {
      expect(Number.isInteger(l.dx) && Number.isInteger(l.dy)).toBe(true);
      expect(l.eccPx).toBeCloseTo(Math.hypot(l.dx, l.dy), 9);
    }
  });

  it('are DESIGNED at 4 and 8 deg on the study tablet\'s full screen (rounding costs at most 0.01 deg)', () => {
    // What a sitting showed is computed in the export from its calibration and scale; see
    // tests/physicalCalibration.test.ts.
    for (const l of RT_LOCATIONS) {
      expect(Math.abs(nominalEccentricityDeg(l.eccPx) - RT_RING_ECCENTRICITY_DEG[l.ring])).toBeLessThan(0.011);
    }
    expect(nominalEccentricityDeg(0)).toBe(0);
  });

  it('keep every dot edge at least 60 px inside the 1152x720 screen', () => {
    for (const l of RT_LOCATIONS) {
      const cx = DESIGN_WIDTH / 2 + l.dx;
      const cy = DESIGN_HEIGHT / 2 + l.dy;
      const margin = Math.min(cx - DOT / 2, DESIGN_WIDTH - cx - DOT / 2, cy - DOT / 2, DESIGN_HEIGHT - cy - DOT / 2);
      expect(margin, `location ${l.id}`).toBeGreaterThanOrEqual(60);
    }
  });

  it('keep the dot one constant size: the outer ring is meant to be harder', () => {
    expect(CONFIG.RT_DOT_PX).toBe(52);
  });
});

describe('a protocol block is balanced over rings, quadrants and locations', () => {
  it('is the 20 go / 12 no-go block the tables are written for, with four no-go colours in every condition', () => {
    expect([N_GO, N_NOGO]).toEqual([RT_BALANCED_GO, RT_BALANCED_NOGO]);
    expect([RT_BALANCED_GO, RT_BALANCED_NOGO]).toEqual([20, 12]);
    for (const c of CONDITIONS) expect(rtStimulusColours(c).distractors, c.label).toHaveLength(4);
    for (const c of CONDITIONS) {
      const { target, distractors } = rtStimulusColours(c);
      expect(block(0, lcg(1), { target, distractors }).layout, c.label).toBe('balanced');
    }
  });

  it('uses every location exactly 4 times', () => {
    const p = block(0, lcg(3));
    for (const l of RT_LOCATIONS) expect(p.trials.filter((t) => t.location.id === l.id), `location ${l.id}`).toHaveLength(4);
  });

  it('gives go 10 per ring and 5 per quadrant, split 3/2 alternating by quadrant', () => {
    const go = table(block(0, lcg(5)), (s) => s);
    expect(go).toEqual({ inner: [3, 2, 3, 2], outer: [2, 3, 2, 3] });
    expect(go).toEqual(RT_BLOCK_GO);
  });

  it('gives no-go 6 per ring and 3 per quadrant, the complement of go', () => {
    const noGo = table(block(0, lcg(7)), (s) => !s);
    expect(noGo).toEqual({ inner: [1, 2, 1, 2], outer: [2, 1, 2, 1] });
    expect(noGo).toEqual(RT_BLOCK_NOGO);
  });

  it('mirrors the pattern on alternate blocks, so two blocks give every location 5 go and 3 no-go', () => {
    const odd = block(1, lcg(9));
    expect(table(odd, (s) => s)).toEqual({ inner: [2, 3, 2, 3], outer: [3, 2, 3, 2] });
    expect(table(odd, (s) => !s)).toEqual({ inner: [2, 1, 2, 1], outer: [1, 2, 1, 2] });
    const even = block(2, lcg(9));
    expect(table(even, (s) => s)).toEqual(RT_BLOCK_GO);
    const pair = [...block(4, lcg(11)).trials, ...block(5, lcg(12)).trials];
    for (const l of RT_LOCATIONS) {
      const here = pair.filter((t) => t.location.id === l.id);
      expect([here.filter((t) => t.signal).length, here.filter((t) => !t.signal).length], `location ${l.id}`).toEqual([5, 3]);
    }
  });

  it('shows each no-go colour 3 times, split 2/1 across the rings, the split alternating between blocks', () => {
    const split = (p: RtBlockPlan) => PALETTE.map((c) => {
      const mine = p.trials.filter((t) => !t.signal && t.color === c);
      return [mine.filter((t) => t.location.ring === 'inner').length, mine.filter((t) => t.location.ring === 'outer').length];
    });
    expect(split(block(0, lcg(13)))).toEqual([[2, 1], [2, 1], [1, 2], [1, 2]]);
    expect(split(block(1, lcg(13)))).toEqual([[1, 2], [1, 2], [2, 1], [2, 1]]);
  });

  it('draws the go dot in the target colour and every no-go dot from the palette', () => {
    const p = block(0, lcg(15));
    for (const t of p.trials) {
      if (t.signal) expect(t.color).toBe(TARGET);
      else expect(PALETTE).toContain(t.color);
    }
  });
});

describe('the order', () => {
  it('never puts two consecutive trials at the same location, and keeps the run cap', () => {
    const p = block(0, lcg(17));
    for (let i = 1; i < p.trials.length; i++) {
      expect(p.trials[i].location.id, `trials ${i} and ${i + 1}`).not.toBe(p.trials[i - 1].location.id);
    }
    expect(longestRun(p.trials.map((t) => t.signal))).toBeLessThanOrEqual(CONFIG.RT_MAX_RUN);
    expect(p.capRespected && p.noConsecutiveRepeat).toBe(true);
  });

  it('holds every property on every block, over many seeds and both parities', () => {
    // The property test: the search never gives up, and nothing above was a lucky seed.
    const r = lcg(2026);
    const orders = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const p = block(i, r);
      expect(p.layout).toBe('balanced');
      expect(p.noConsecutiveRepeat, `block ${i}`).toBe(true);
      expect(p.capRespected, `block ${i}`).toBe(true);
      expect(p.trials).toHaveLength(N);
      const ids = p.trials.map((t) => t.location.id);
      for (let k = 1; k < ids.length; k++) if (ids[k] === ids[k - 1]) throw new Error(`block ${i}: repeat at trial ${k + 1}`);
      for (const l of RT_LOCATIONS) if (ids.filter((x) => x === l.id).length !== 4) throw new Error(`block ${i}: location ${l.id}`);
      const mirrored = i % 2 === 1;
      const go = table(p, (s) => s);
      expect(go).toEqual(mirrored ? { inner: [2, 3, 2, 3], outer: [3, 2, 3, 2] } : RT_BLOCK_GO);
      const colours = PALETTE.map((c) => p.trials.filter((t) => !t.signal && t.color === c && t.location.ring === 'inner').length);
      expect(colours).toEqual(mirrored ? [1, 1, 2, 2] : [2, 2, 1, 1]);
      expect(longestRun(p.trials.map((t) => t.signal))).toBeLessThanOrEqual(CONFIG.RT_MAX_RUN);
      orders.add(ids.join(','));
    }
    // Balanced is not the same as fixed: a participant must not be able to learn the sequence.
    expect(orders.size).toBeGreaterThan(2990);
  });

  it('does not make the next location predictable from the current one', () => {
    // Every other location follows a given one; the repeat ban is the only constraint.
    const r = lcg(31);
    const follows = new Map<number, Set<number>>();
    for (let i = 0; i < 400; i++) {
      const ids = block(i, r).trials.map((t) => t.location.id);
      for (let k = 1; k < ids.length; k++) {
        if (!follows.has(ids[k - 1])) follows.set(ids[k - 1], new Set());
        follows.get(ids[k - 1])!.add(ids[k]);
      }
    }
    for (const l of RT_LOCATIONS) expect(follows.get(l.id)!.size, `after location ${l.id}`).toBe(7);
  });
});

describe('practice and the end-to-end harness', () => {
  it('gives the six practice trials three per ring, six different locations, every quadrant', () => {
    const nGo = Math.round(CONFIG.RT_PRACTICE_TRIALS * CONFIG.RT_GO_RATE);
    const nNoGo = CONFIG.RT_PRACTICE_TRIALS - nGo;
    expect(CONFIG.RT_PRACTICE_TRIALS).toBe(6);
    const r = lcg(37);
    for (let i = 0; i < 500; i++) {
      const p = block(0, r, { nGo, nNoGo, practice: true });
      expect(p.layout).toBe('practice');
      expect(p.trials.filter((t) => t.location.ring === 'inner')).toHaveLength(3);
      expect(p.trials.filter((t) => t.location.ring === 'outer')).toHaveLength(3);
      expect(new Set(p.trials.map((t) => t.location.id)).size).toBe(6);
      expect(new Set(p.trials.map((t) => t.location.quadrant)).size).toBe(4);
      expect(p.trials.filter((t) => t.signal)).toHaveLength(nGo);
      for (const t of p.trials) expect(t.signal ? t.color === TARGET : PALETTE.includes(t.color)).toBe(true);
    }
  });

  it('cycles quadrants and alternates rings in the 4-trial e2e block, and two blocks visit all eight', () => {
    // ?e2e=1 runs 4 scored trials (3 go, 1 no-go) and 1 practice trial. config.ts E2E_OVERRIDES.
    const even = block(0, lcg(41), { nGo: 3, nNoGo: 1 });
    const odd = block(1, lcg(41), { nGo: 3, nNoGo: 1 });
    expect(even.layout).toBe('cycled');
    expect(even.trials.map((t) => t.location.id)).toEqual([1, 6, 3, 8]);
    expect(odd.trials.map((t) => t.location.id)).toEqual([5, 2, 7, 4]);
    expect(new Set([...even.trials, ...odd.trials].map((t) => t.location.id)).size).toBe(8);
    expect(even.trials.filter((t) => t.signal)).toHaveLength(3);
    const practice = block(0, lcg(43), { nGo: 1, nNoGo: 0, practice: true });
    expect(practice.layout).toBe('cycled');
    expect(practice.trials.map((t) => t.location.id)).toEqual([1]);
  });

  it('never repeats a location consecutively in a cycled block of any length', () => {
    for (let n = 1; n <= 24; n++) {
      const nGo = Math.round(n * CONFIG.RT_GO_RATE);
      const p = block(n, lcg(n), { nGo, nNoGo: n - nGo });
      for (let k = 1; k < p.trials.length; k++) expect(p.trials[k].location.id).not.toBe(p.trials[k - 1].location.id);
    }
  });
});

describe('the block index is the condition\'s global position', () => {
  it('is what Experiment hands the task, so a second sitting continues the alternation', () => {
    // A sitting-local index would restart the mirror and the colour split at 0 in a second sitting,
    // and the Williams balance of odd and even positions is over GLOBAL positions.
    const src = readFileSync(resolve(__dirname, '..', 'src/experiment/Experiment.tsx'), 'utf8');
    expect(src).toMatch(/<ReactionTimeTask[\s\S]*?blockIndex=\{step\?\.position \?\? machine\.stepIndex\}/);
  });
});
