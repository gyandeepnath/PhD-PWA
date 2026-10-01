/**
 * Where the go/no-go dot appears: eight fixed places, used equally often in every block.
 *
 * WHAT IT REPLACED. The dot used to land at a uniformly random point in x 25-75%, y 28-72% of the
 * design canvas — the central fifth of the screen. Two things were wrong with that, and neither was
 * visible in the data:
 *
 *  - ECCENTRICITY WAS RANDOM NOISE IN A DEPENDENT VARIABLE. Reaction time rises with the target's
 *    distance from fixation (Wall et al. 2002, perimetry, 10-50 deg; Carrasco et al. 1995, for search),
 *    and a block of 20 uniform-random go positions has a mean eccentricity that wanders from block to
 *    block: simulated on the re-based canvas, the SD of a block's mean was about 0.37 deg. That
 *    wander lands on the condition means, and 08_reaction_trials.csv had no column in which to see
 *    it, so it could not be modelled away afterwards.
 *  - COLOUR AND ECCENTRICITY INTERACT, AND THE INTERACTION WAS HIDDEN. Red-green cone opponency
 *    falls off steeply away from the fovea while blue-yellow falls off about as gently as luminance
 *    does (Mullen & Kingdom 2002). The go/no-go decision here is a colour decision, so the colour
 *    conditions do not lose discriminability equally with distance. With random positions that is
 *    unmodellable noise; with balanced, recorded rings it is an estimable ring x colour term.
 *
 * THE LAYOUT. Two rings around the fixation cross at the screen centre — 4 deg and 8 deg at the
 * nominal 55 cm — times the four diagonals (45, 135, 225, 315 deg), so eight locations. The ring
 * values are a JUDGEMENT, not a published optimum: 8 deg is about as far out as a diagonal can go on
 * the tablet's 720 px height and leave the dot clear of the edge, and 4 deg is half of it. The
 * diagonals keep both rings off the horizontal and vertical meridians and clear of the corner chrome.
 * The dot keeps its constant 52 px (1.11 deg) at both radii, deliberately: scaling it with
 * eccentricity would cancel the very effect the rings are there to expose.
 *
 * THE BALANCE, per 32-trial block (20 go, 12 no-go): every location 4 times; go 10 per ring and 5
 * per quadrant, no-go 6 per ring and 3 per quadrant (the tables below); the pattern mirrored on
 * alternate blocks, so over any two consecutive blocks every location carries 5 go and 3 no-go —
 * the block's own 62.5% go rate. Each no-go colour appears 3 times, split 2/1 across the rings, the
 * split alternating between blocks. A condition's block parity is its serial position, which the
 * Williams rows balance across participants, so neither the mirror nor the colour split follows a
 * condition.
 *
 * THE ORDER. Go/no-go order is still planRuns's (no run longer than RT_MAX_RUN); locations are then
 * assigned so that no two consecutive trials share one. A target at the location of a preceding
 * non-informative flash draws a slower response at intervals of 0.2-1.5 s (Berlucchi et al. 1989),
 * which is the scale of this task's inter-trial gap — a repeat would add a sequence effect to RT.
 *
 * SOURCES: docs/CITATION_VERIFICATION.md items 53 (Carrasco et al. 1995), 54 (Wall et al. 2002), 55
 * (Mullen & Kingdom 2002) and 56 (Berlucchi et al. 1989) — each checked against its abstract only, and
 * each with the caveat recorded there on how far it transfers to this task.
 */
import { balancedDistractors, planRuns } from './foreperiod';

/**
 * Millimetres per CSS pixel on the study tablet at display scale 1 — a Xiaomi Pad 6, 2880x1800 at
 * 309 ppi and a device pixel ratio of 2.5 (manufacturer's specification, not measured here: a ruler
 * check that 1152 CSS px spans about 236.7 mm is still advised). One ROOT px is this times the
 * display scale (`stimulus_scale`).
 */
export const STUDY_TABLET_MM_PER_CSS_PX = 0.2055;

/** The nominal viewing distance every visual angle in this codebase is quoted at (protocol: 50-60 cm). */
export const NOMINAL_VIEWING_DISTANCE_MM = 550;

/** The two rings, in degrees of visual angle at the nominal distance. A judgement; see the header. */
export const RT_RING_ECCENTRICITY_DEG = { inner: 4, outer: 8 } as const;

export type RtRing = keyof typeof RT_RING_ECCENTRICITY_DEG;

/**
 * The four diagonals, measured counter-clockwise from the participant's right with screen-up at 90:
 * quadrant 1 is up-right, 2 up-left, 3 down-left, 4 down-right.
 */
export const RT_DIAGONALS_DEG = [45, 135, 225, 315] as const;

/** A ring radius in root px: the eccentricity at the nominal distance, at display scale 1. */
export function ringRadiusPx(eccentricityDeg: number): number {
  const mm = Math.tan((eccentricityDeg * Math.PI) / 180) * NOMINAL_VIEWING_DISTANCE_MM;
  return Math.round(mm / STUDY_TABLET_MM_PER_CSS_PX);
}

/**
 * Visual angle from fixation of a point `px` root px away, at the nominal distance and the display
 * scale the screen was drawn at. Exact (arctangent), not the small-angle approximation.
 */
export function eccentricityDeg(px: number, scale: number): number {
  const mm = px * scale * STUDY_TABLET_MM_PER_CSS_PX;
  return (Math.atan(mm / NOMINAL_VIEWING_DISTANCE_MM) * 180) / Math.PI;
}

export interface RtLocation {
  /** 1-4 the inner ring in quadrants 1-4, 5-8 the outer ring in quadrants 1-4. */
  id: number;
  ring: RtRing;
  /** 1 up-right, 2 up-left, 3 down-left, 4 down-right. */
  quadrant: 1 | 2 | 3 | 4;
  angleDeg: (typeof RT_DIAGONALS_DEG)[number];
  /** Offset of the dot's centre from the fixation cross, in root px; + is right. */
  dx: number;
  /** Offset of the dot's centre from the fixation cross, in root px; + is DOWN (screen convention). */
  dy: number;
  /** Distance from the fixation cross in root px: the hypotenuse of the rounded offsets, as drawn. */
  eccPx: number;
}

/**
 * The eight locations. The offsets are whole root px, so the recorded dx/dy are exactly what was
 * drawn: 4 deg is 187 px and 8 deg 376 px, which on a diagonal is 132 and 266 px each way, putting
 * the outer dots' centres at (310, 94) to (842, 626) on the 1152x720 tablet — their edges 68 px from
 * the top and bottom of the screen.
 */
export const RT_LOCATIONS: readonly RtLocation[] = (['inner', 'outer'] as const).flatMap((ring, r) =>
  RT_DIAGONALS_DEG.map((angleDeg, q) => {
    const radius = ringRadiusPx(RT_RING_ECCENTRICITY_DEG[ring]);
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.round(radius * Math.cos(rad));
    const dy = -Math.round(radius * Math.sin(rad));
    return { id: r * 4 + q + 1, ring, quadrant: (q + 1) as RtLocation['quadrant'], angleDeg, dx, dy, eccPx: Math.hypot(dx, dy) };
  }));

const locationAt = (ring: RtRing, quadrant: number): RtLocation =>
  RT_LOCATIONS[(ring === 'inner' ? 0 : 4) + quadrant - 1];

/**
 * Trials per location in a block, indexed [quadrant 1..4], on an UNMIRRORED block.
 *
 * Go: 10 per ring and 5 per quadrant, so a ring's 10 split 3/2 by quadrant and the other ring takes
 * the complement. No-go: 6 per ring and 3 per quadrant, complementing the go counts so that every
 * location has exactly 4 trials. Mirroring (alternate blocks) reflects left-right, which turns
 * 3,2,3,2 into 2,3,2,3: over two blocks each location carries 5 go and 3 no-go.
 */
export const RT_BLOCK_GO: Readonly<Record<RtRing, readonly number[]>> = { inner: [3, 2, 3, 2], outer: [2, 3, 2, 3] };
export const RT_BLOCK_NOGO: Readonly<Record<RtRing, readonly number[]>> = { inner: [1, 2, 1, 2], outer: [2, 1, 2, 1] };

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/** The go and no-go counts the balanced tables are written for: 20 and 12, the protocol block. */
export const RT_BALANCED_GO = sum(RT_BLOCK_GO.inner) + sum(RT_BLOCK_GO.outer);
export const RT_BALANCED_NOGO = sum(RT_BLOCK_NOGO.inner) + sum(RT_BLOCK_NOGO.outer);
/** The four no-go colours of a polarity, which is what the 2/1 ring split is written for. */
const BALANCED_PALETTE = 4;

/** Left-right reflection of a quadrant: 1 <-> 2, 3 <-> 4. */
const mirrorQuadrant = (q: number) => [2, 1, 4, 3][q - 1];

export interface RtTrialPlan {
  signal: boolean;
  color: string;
  location: RtLocation;
}

/**
 * Which layout a block got.
 *
 *  - 'balanced': the protocol block — the tables above, mirrored on odd blocks.
 *  - 'practice': the six practice trials — three per ring, six different locations, every quadrant.
 *  - 'cycled': any other size (the end-to-end harness's 4-trial blocks and single practice trial):
 *    trial k in quadrant k mod 4, rings alternating, the starting ring swapped on odd blocks so two
 *    consecutive blocks visit all eight locations. Deterministic, which is what a test harness wants.
 */
export type RtLayout = 'balanced' | 'practice' | 'cycled';

export interface RtBlockPlan {
  trials: RtTrialPlan[];
  layout: RtLayout;
  /** planRuns's flag, passed through: false if the go/no-go run cap had to be broken. */
  capRespected: boolean;
  /** False if no order without a same-location repeat could be found. Unreachable for shipped counts. */
  noConsecutiveRepeat: boolean;
}

export interface RtBlockOptions {
  nGo: number;
  nNoGo: number;
  maxRun: number;
  /** The go-target colour. */
  target: string;
  /** The no-go colours, in a fixed order (rtStimulusColours keeps the condition table's order). */
  distractors: readonly string[];
  /**
   * The block's serial position in the participant's plan, 0-based — the condition's global
   * session_position, not its index within a sitting, so a split sitting continues the alternation.
   * Odd blocks are mirrored.
   */
  blockIndex: number;
  /** The unscored practice block rather than a scored one. */
  practice: boolean;
  rand?: () => number;
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** One block: go/no-go order, the no-go colours, and a location for every trial. */
export function planRtBlock(opts: RtBlockOptions): RtBlockPlan {
  const { nGo, nNoGo, maxRun, target, distractors, practice } = opts;
  const rand = opts.rand ?? Math.random;
  const mirrored = Math.abs(Math.floor(opts.blockIndex)) % 2 === 1;
  const { order, capRespected } = planRuns(nGo, nNoGo, maxRun, rand);
  const n = order.length;

  if (!practice && nGo === RT_BALANCED_GO && nNoGo === RT_BALANCED_NOGO && distractors.length === BALANCED_PALETTE) {
    const placed = placeBalanced(order, target, distractors, mirrored, rand);
    if (placed) return { trials: placed, layout: 'balanced', capRespected, noConsecutiveRepeat: true };
    // Unreachable for the shipped counts (tests/rtLocations.test.ts, many seeds). Kept the balance
    // and broke the repeat rule rather than the other way round, and said so.
    return {
      trials: placeBalancedIgnoringRepeats(order, target, distractors, mirrored, rand),
      layout: 'balanced', capRespected, noConsecutiveRepeat: false,
    };
  }

  const colours = balancedDistractors(nNoGo, distractors, rand);
  let c = 0;
  const withColour = (signal: boolean, location: RtLocation): RtTrialPlan =>
    ({ signal, color: signal ? target : colours[c++], location });

  if (practice && n >= 2 && n <= 8 && n % 2 === 0) {
    /*
     * Half per ring, every location different. The quadrants are a random permutation p; the inner
     * ring takes p[0..h), the outer ring continues cyclically from p[h], so with h = 3 all four
     * quadrants appear. Distinct locations make a same-location repeat impossible.
     */
    const h = n / 2;
    const p = shuffle([1, 2, 3, 4], rand);
    const locs = [
      ...Array.from({ length: h }, (_, j) => locationAt('inner', p[j])),
      ...Array.from({ length: h }, (_, j) => locationAt('outer', p[(h + j) % 4])),
    ];
    shuffle(locs, rand);
    return { trials: order.map((s, k) => withColour(s, locs[k])), layout: 'practice', capRespected, noConsecutiveRepeat: true };
  }

  // Cycled: consecutive trials are always in different quadrants, so never at the same location.
  const trials = order.map((s, k) => {
    const inner = (k % 2 === 0) !== mirrored;
    return withColour(s, locationAt(inner ? 'inner' : 'outer', (k % 4) + 1));
  });
  return { trials, layout: 'cycled', capRespected, noConsecutiveRepeat: true };
}

/** Per-location counts of a balanced block, mirrored or not. */
export function balancedCounts(mirrored: boolean): { go: Map<number, number>; noGo: Map<number, number> } {
  const go = new Map<number, number>();
  const noGo = new Map<number, number>();
  for (const loc of RT_LOCATIONS) {
    const q = mirrored ? mirrorQuadrant(loc.quadrant) : loc.quadrant;
    go.set(loc.id, RT_BLOCK_GO[loc.ring][q - 1]);
    noGo.set(loc.id, RT_BLOCK_NOGO[loc.ring][q - 1]);
  }
  return { go, noGo };
}

/**
 * The no-go items of a balanced block: (location, colour) pairs.
 *
 * Each of the four colours appears 3 times; the first two of the palette go 2 inner / 1 outer and
 * the last two 1 inner / 2 outer, swapped on mirrored blocks — 6 per ring either way. Within a ring
 * the colours are paired with that ring's no-go slots at random.
 */
function noGoItems(distractors: readonly string[], mirrored: boolean, rand: () => number): { loc: number; color: string }[] {
  const { noGo } = balancedCounts(mirrored);
  const per = RT_BALANCED_NOGO / distractors.length;   // 3
  const out: { loc: number; color: string }[] = [];
  for (const ring of ['inner', 'outer'] as const) {
    const slots = RT_LOCATIONS.filter((l) => l.ring === ring).flatMap((l) => Array<number>(noGo.get(l.id)!).fill(l.id));
    const colours = distractors.flatMap((color, i) => {
      const favoursInner = (i < distractors.length / 2) !== mirrored;
      const inner = favoursInner ? Math.ceil(per / 2) : Math.floor(per / 2);
      return Array<string>(ring === 'inner' ? inner : per - inner).fill(color);
    });
    shuffle(colours, rand);
    slots.forEach((loc, k) => out.push({ loc, color: colours[k] }));
  }
  return out;
}

/**
 * Give every trial of `order` a location (and every no-go a colour) from the balanced pool, with no
 * location on two consecutive trials. Randomised depth-first search: at each trial, try the distinct
 * items still available in random order, skipping the previous trial's location. A restart budget
 * keeps a pathological draw from searching long; null if every attempt ran out.
 */
function placeBalanced(
  order: boolean[], target: string, distractors: readonly string[], mirrored: boolean, rand: () => number,
): RtTrialPlan[] | null {
  // Items are keyed "location|colour"; a go item's colour is the target.
  const key = (loc: number, color: string) => `${loc}|${color}`;
  const locOf = (k: string) => Number(k.slice(0, k.indexOf('|')));
  const colourOf = (k: string) => k.slice(k.indexOf('|') + 1);

  for (let attempt = 0; attempt < 50; attempt++) {
    const goLeft = new Map<string, number>();
    for (const [loc, k] of balancedCounts(mirrored).go) goLeft.set(key(loc, target), k);
    const noGoLeft = new Map<string, number>();
    for (const it of noGoItems(distractors, mirrored, rand)) {
      const k = key(it.loc, it.color);
      noGoLeft.set(k, (noGoLeft.get(k) ?? 0) + 1);
    }
    const chosen: string[] = [];
    let budget = 20000;

    const step = (i: number, prev: number): boolean => {
      if (i === order.length) return true;
      if (--budget < 0) return false;
      const pool = order[i] ? goLeft : noGoLeft;
      for (const k of shuffle([...pool.keys()].filter((x) => pool.get(x)! > 0 && locOf(x) !== prev), rand)) {
        pool.set(k, pool.get(k)! - 1);
        chosen.push(k);
        if (step(i + 1, locOf(k))) return true;
        chosen.pop();
        pool.set(k, pool.get(k)! + 1);
        if (budget < 0) return false;
      }
      return false;
    };

    if (step(0, -1)) {
      return order.map((signal, i) => ({ signal, color: colourOf(chosen[i]), location: RT_LOCATIONS[locOf(chosen[i]) - 1] }));
    }
  }
  return null;
}

/** The balanced pool in random order, without the repeat rule. Only reached if placeBalanced gave up. */
function placeBalancedIgnoringRepeats(
  order: boolean[], target: string, distractors: readonly string[], mirrored: boolean, rand: () => number,
): RtTrialPlan[] {
  const { go } = balancedCounts(mirrored);
  const goLocs = shuffle([...go].flatMap(([loc, k]) => Array<number>(k).fill(loc)), rand);
  const noGo = shuffle(noGoItems(distractors, mirrored, rand), rand);
  let g = 0;
  let ng = 0;
  return order.map((signal) => {
    if (signal) return { signal, color: target, location: RT_LOCATIONS[goLocs[g++] - 1] };
    const it = noGo[ng++];
    return { signal, color: it.color, location: RT_LOCATIONS[it.loc - 1] };
  });
}
