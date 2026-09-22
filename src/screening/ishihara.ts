/**
 * Digital pseudoisochromatic colour-vision SCREEN — a screening aid, NOT a clinical test.
 *
 * A digit is rendered as a mosaic of dots whose figure and background palettes differ in hue at
 * closely matched luminance, so an observer who cannot use the chromatic difference has little
 * left to read the digit by.
 *
 * WHAT THIS IS NOT. It is not the Ishihara test. It is six home-made plates with no published
 * operating characteristics: the sensitivity and specificity of the "allow one slip" rule are
 * unknown, and while the palettes are intended to lie on a red-green (protan/deutan) confusion
 * line, that has been asserted here rather than verified colorimetrically. The exported columns and
 * this module were previously named "ishihara", which asserted a validated plate test to anyone
 * reading the data; they are now named for what they are. Formal Ishihara or Farnsworth plates,
 * administered by the operator, remain the basis for exclusion — see `cvd_clinical` on the
 * participant record.
 *
 * TWO CUES THIS SET HAS TO AVOID.
 *
 * 1. RESIDUAL LUMINANCE. Matching mean luminance is not enough if the figure is consistently the
 *    darker region: an observer with no chromatic discrimination can still learn "the digit is the
 *    darker patch" and apply it to every plate. Measured across the original five test plates the
 *    figure was darker on all five (contrast ratios 1.03-1.10, small but unanimous in direction).
 *    The polarity is now balanced within the set and varies between administrations, so a constant
 *    direction cannot be learned. `luminancePolarityBalance()` is what the test asserts against.
 *
 *    AND THE LUMINANCE THAT MATTERS IS NOT THE TRICHROMAT'S. This was the defect that produced the
 *    present design. sRGB relative luminance, 0.2126R + 0.7152G + 0.0722B, is by definition the
 *    NORMAL observer's luminous efficiency, and the palettes were matched on it. But they differ
 *    almost purely along red-green, the axis on which a dichromat's luminance function departs most
 *    from that formula — so they were iso-luminant for the observer the screen is not looking for
 *    and, measured with the Viénot 1999 transform in `dichromat.ts`, plainly NOT for a protanope:
 *    contrast ratio 1.20-1.29 with the dot ranges barely overlapping, the same way round on all
 *    five plates. A protanope could read the digit off that boundary and score full marks.
 *
 *    The fix is not a better compromise colour. Each plate now sits exactly on ONE deficiency's
 *    confusion axis, so for that observer the two palettes are the SAME colour — nothing to see, by
 *    construction rather than by tuning — and the dot lightnesses of the two regions are drawn from
 *    the same 1.8x spread, which is the noise defence a real pseudoisochromatic plate relies on.
 *    Three plates per axis; see SCREEN_TEST_PLATES for why one plate cannot serve both.
 *
 * 2. MEMORY. The plate set, the digits and the order were fixed constants, and the screen runs in
 *    BOTH sittings. A participant who failed at sitting 1 could "pass" at sitting 2 by recalling
 *    six digits, so the retest measured recall rather than colour vision. Digits, order and
 *    polarity are now drawn from a per-administration seed.
 */
import type { DichromatKind } from './dichromat';

/** 5x7 dot-matrix glyphs for digits 0-9 (rows top→bottom, '1' = lit). */
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;

/**
 * Is the normalised point (nx, ny in 0..1 over the glyph bounding box) part of the digit?
 * Used by the renderer to colour each dot as figure vs background.
 */
export function isFigurePixel(digit: string, nx: number, ny: number): boolean {
  // A non-finite coordinate indexed the glyph grid with NaN and threw. Rendering is driven by a
  // loop that can produce a degenerate coordinate at the canvas edge, and a throw there blanks the
  // whole plate rather than one pixel.
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
  const rows = FONT[digit];
  if (!rows) return false;
  const gx = Math.floor(nx * GLYPH_W);
  const gy = Math.floor(ny * GLYPH_H);
  if (gx < 0 || gx >= GLYPH_W || gy < 0 || gy >= GLYPH_H) return false;
  return rows[gy][gx] === '1';
}

/**
 * Which observer a plate is built to be INVISIBLE to.
 *
 * This used to be the single value 'protan-deutan', which described an intention rather than a
 * property: the palettes lay somewhere in the red-green region and were matched on the normal
 * observer's luminance, so no plate was actually a confusion pair for anybody in particular. Each
 * plate now sits exactly on ONE deficiency's confusion axis, computed from the Viénot 1999
 * transform in `dichromat.ts`, so its two palettes project to the same colour for that observer —
 * same hue, same brightness, no edge of any kind. A protanope sees a blank disc on a 'protan'
 * plate and can read a 'deutan' one; a deuteranope, the reverse. That is deliberate, and it is what
 * makes the score interpretable: each type reliably misses the three plates aimed at them.
 */
export type ConfusionAxis = DichromatKind | 'control';

export interface Plate {
  id: number;
  digit: string;
  axis: ConfusionAxis;
  /** Figure dot colours (the digit). */
  figureColors: string[];
  /** Background dot colours. */
  backgroundColors: string[];
}

/**
 * One plate's two dot palettes, and the observer it is built to defeat.
 *
 * HOW THESE WERE CONSTRUCTED, and why they are not hand-picked colours.
 *
 * For a chosen deficiency, `dichromat.ts` gives a direction in linear RGB that the Viénot 1999
 * transform annihilates — a confusion axis. Take any base colour and step the same distance along
 * that axis in each direction: the two results are a METAMER PAIR for that observer. They project
 * to one colour, so there is no hue difference and no brightness difference to fall back on. Then
 * both palettes are scaled by the SAME five lightness factors, spanning about 1.35x from darkest to
 * lightest. Scaling is linear, so the pair stays a metamer pair at every step, and the figure
 * region and the background region present the same distribution of lightnesses — which is the
 * defence a real pseudoisochromatic plate relies on, and the one the previous palettes lacked.
 *
 * WHY 1.35x AND NOT MORE. A first version used 1.8x, on the reasoning that more lightness noise
 * means a better-hidden boundary. Rendered and measured in CIELAB, that cost the trichromat far
 * more than it bought: the chromatic signal carrying the digit fell to a mean dC of 37.7 against a
 * within-plate L* spread of 20, where the previous palettes had dC 41.8 against a spread of 11.
 * Roughly half the signal-to-noise, and the digits stopped being comfortably legible — which would
 * have produced FALSE screen failures in normal trichromats, the very over-exclusion this screen
 * was recently stopped from causing. The noise was also nearly redundant: once a plate is an exact
 * metamer for its target observer there is no edge for them at any spread, so the spread only ever
 * mattered against the other dichromat, who is meant to read the plate anyway. It is now matched to
 * the old set's L* spread and the chromatic signal is back above it.
 *
 * `redder` is the +axis end and `greener` the -axis end. Which one becomes the FIGURE is chosen per
 * administration; see the polarity note in `buildScreeningPlates`.
 *
 * MEASURED PROPERTIES OF THIS SET (`tests/screening.test.ts` asserts every one of them):
 *
 *   for the observer each plate targets   contrast ratio 1.001-1.007, dot ranges 97-100% overlapped
 *   for a normal trichromat               contrast ratio 1.065-1.118, dot ranges 62-80% overlapped
 *   for the OTHER dichromat               contrast ratio 1.187-1.204, dot ranges 35-40% overlapped
 *
 * and, in CIELAB, the chromatic difference that actually carries the digit for a trichromat:
 *
 *   figure vs background, chromatic dC   40.9-45.2   (previous palettes: 39.7-44.3)
 *   lightness spread within a plate, L*  11-12       (previous palettes: 10-12)
 *
 * The third row is not a defect. A protanope is supposed to be able to read the deutan plates: they
 * fail via the three protan plates, and a score of 3 of 6 is well under the pass mark. Driving that
 * row to 1.00 as well is not merely hard, it is IMPOSSIBLE — see the note on SCREEN_TEST_PLATES.
 *
 * The previous palettes, measured the same way: 1.20-1.29 for a protanope with only ~20% of the dot
 * range overlapping, on all five plates, with the greener palette lighter every time — while
 * carrying no more chromatic signal for the trichromat than this set does.
 */
interface PalettePair {
  axis: DichromatKind;
  redder: string[];
  greener: string[];
}

const CONFUSION_PAIRS: PalettePair[] = [
  {
    axis: 'protan',
    redder: ['#baa766', '#c1ad6a', '#c7b36d', '#ceb971', '#d5bf75'],
    greener: ['#5db166', '#60b76a', '#64bd6e', '#67c472', '#6bca76'],
  },
  {
    axis: 'protan',
    redder: ['#bca977', '#c3af7b', '#cab57f', '#d1bb84', '#d7c189'],
    greener: ['#5fb277', '#62b97c', '#66bf80', '#69c585', '#6dcc89'],
  },
  {
    axis: 'protan',
    redder: ['#b1a161', '#b8a765', '#beac68', '#c4b26c', '#cbb870'],
    greener: ['#55aa62', '#59b065', '#5cb669', '#5fbc6d', '#63c270'],
  },
  {
    axis: 'deutan',
    redder: ['#b6a071', '#bca675', '#c3ab79', '#cab27d', '#d0b782'],
    greener: ['#66ba6d', '#6ac171', '#6ec775', '#72ce7a', '#76d47e'],
  },
  {
    axis: 'deutan',
    redder: ['#b39b8a', '#b9a08f', '#bfa694', '#c6ac99', '#cdb19e'],
    greener: ['#60b587', '#64bc8c', '#67c291', '#6bc996', '#6fcf9b'],
  },
  {
    axis: 'deutan',
    redder: ['#c19f6d', '#c8a571', '#cfab75', '#d6b179', '#ddb77d'],
    greener: ['#78ba69', '#7cc16d', '#80c771', '#85ce75', '#89d579'],
  },
];

const CONTROL_FIGURE = ['#3a3a3a', '#2e2e2e', '#444'];
const CONTROL_BACKGROUND = ['#cfcfcf', '#dcdcdc', '#c4c4c4'];

/** Digits available to the generator. '1' is excluded: its glyph is thin and easy to guess. */
const DIGIT_POOL = ['2', '3', '4', '5', '6', '7', '8', '9'];

/** Deterministic 32-bit PRNG, so a given seed always yields the same plate set. */
function rng(seed: number): () => number {
  let s = (Math.floor(seed) || 1) >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Confusion plates in one administration. The greyscale control is presented as well, but it is a
 * validity check rather than a test item and is excluded from both the numerator and the
 * denominator — so a participant sees seven plates and `cvd_screen_total` reads 6.
 *
 * SIX, RAISED FROM FIVE, AND THE REASON IS ARITHMETIC RATHER THAN TASTE.
 *
 * Each plate now sits on exactly one deficiency's confusion axis, because no colour pair can sit on
 * both. The three luminance functionals involved — the normal observer's, and the two simulated
 * ones — span a space of rank TWO, not three: the differences (L_protan - L_normal) and
 * (L_deutan - L_normal) are both multiples of (R - G), in the fixed ratio -1.8823. So any pair that
 * differs in the red-green direction at all, which every red-green screening pair must, separates in
 * at least one of the two dichromat spaces. `tests/screening.test.ts` asserts that ratio directly,
 * so the claim is checked rather than asserted.
 *
 * Splitting the plates by axis means a dichromat sees nothing on the plates aimed at them and can
 * read the rest. The set therefore has to give each axis enough plates that guessing cannot carry
 * someone through. With five plates split 3/2, whoever got two could reach the pass mark by
 * guessing one of them — about a one-in-five chance at ten buttons. With three plates per axis they
 * would have to guess two of three, which is under three percent. Six plates, evenly split, is the
 * smallest set that closes that gap for BOTH deficiencies at once.
 */
export const SCREEN_TEST_PLATES = 6;

/**
 * Wrong answers tolerated on the confusion plates before the screen is called `screen_failed`.
 *
 * ONE, and there is nothing published behind that. The pass mark is 5 of 6, chosen so a single
 * mis-tap on a 52 px button does not overturn an administration, and its sensitivity and
 * specificity are unknown — which is exactly why this screen is a covariate and a flag rather than
 * a criterion for exclusion. Named here so the exported codebook can state the rule it is applying
 * instead of leaving an analyst to find it in the source at the right commit.
 */
export const SCREEN_ALLOWED_SLIPS = 1;

/**
 * Build one administration's plate set: a greyscale control plate everyone should pass, then six
 * confusion plates — three on the protan axis, three on the deutan — whose digits, order and
 * luminance polarity all derive from `seed`.
 *
 * POLARITY IS BALANCED, NOT MERELY RANDOMISED. Matching mean luminance is not enough if the figure
 * is consistently the darker region: an observer with no chromatic discrimination can still learn
 * "the digit is the darker patch" and apply it to every plate. So exactly half of the six carry the
 * figure in the lighter palette, whatever the seed, and a constant direction scores 3 of 6 — under
 * the pass mark.
 *
 * Getting to exactly half takes one step of arithmetic, because the two axes point opposite ways.
 * On a protan plate the `redder` palette is the LIGHTER one to a normal observer (stepping along
 * the protan confusion axis raises relative luminance); on a deutan plate it is the DARKER one. So
 * picking `redder` as the figure on k of the three protan plates and on k of the three deutan
 * plates gives k + (3 - k) = 3 figure-lighter plates for any k. Two is used, so that the choice
 * still varies with the seed within each axis. `luminancePolarityBalance` measures the result
 * rather than trusting this reasoning, and the test asserts the measurement.
 */
export function buildScreeningPlates(seed: number): Plate[] {
  const next = rng(seed + 1);
  const digits = shuffle(DIGIT_POOL, next);

  // Shuffle WITHIN each axis, then interleave, so every administration presents three of each and
  // the axes are not all clumped at one end of the sequence.
  const byAxis = (a: DichromatKind) => shuffle(CONFUSION_PAIRS.filter((p) => p.axis === a), next);
  const protan = byAxis('protan');
  const deutan = byAxis('deutan');
  const perAxis = SCREEN_TEST_PLATES / 2;
  /*
   * Checked, not assumed. An edit that retypes one plate's axis leaves the set 4/2, and the
   * interleave below would then index past the end of the shorter list and build a plate from
   * `undefined` — a crash at module load, which is a poor way to learn that the instrument is
   * unbalanced. Named here so the failure says what is wrong with the SET.
   */
  if (protan.length !== perAxis || deutan.length !== perAxis) {
    throw new Error(
      `The confusion plates must be split evenly between the two red-green axes: expected `
      + `${perAxis} protan and ${perAxis} deutan, found ${protan.length} and ${deutan.length}. `
      + 'An axis with fewer plates is one a dichromat of that type can guess their way past.',
    );
  }
  const pairs = shuffle(
    Array.from({ length: perAxis }, (_, i) => [protan[i], deutan[i]]).flat(),
    next,
  );

  // Two of the three plates on EACH axis put the `redder` palette in the figure; see the note above
  // for why that is what balances the set.
  const redderFigure = new Set<PalettePair>([
    ...shuffle(protan, next).slice(0, 2),
    ...shuffle(deutan, next).slice(0, 2),
  ]);

  const plates: Plate[] = [
    {
      id: 1,
      digit: digits[SCREEN_TEST_PLATES],
      axis: 'control',
      figureColors: CONTROL_FIGURE,
      backgroundColors: CONTROL_BACKGROUND,
    },
  ];
  for (let i = 0; i < SCREEN_TEST_PLATES; i++) {
    const pair = pairs[i];
    const figureIsRedder = redderFigure.has(pair);
    plates.push({
      id: i + 2,
      digit: digits[i],
      axis: pair.axis,
      figureColors: figureIsRedder ? pair.redder : pair.greener,
      backgroundColors: figureIsRedder ? pair.greener : pair.redder,
    });
  }
  return plates;
}

/**
 * How many of a set's confusion plates carry the figure in the lighter palette.
 *
 * Exposed so the test can assert the balance directly rather than re-deriving luminance from hex.
 *
 * "Lighter" here is sRGB relative luminance — the normal trichromat's. See mitigation 1 in the
 * module header for why that is the right measure for the property this function is asserting (a
 * learnable constant direction) and the wrong one for the property it must not be read as asserting
 * (that a dichromat cannot see an edge).
 */
export function luminancePolarityBalance(plates: Plate[]): { figureLighter: number; total: number } {
  const rel = (hex: string) => {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const chan = (o: number) => {
      const c = parseInt(full.slice(o, o + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
  };
  const meanLum = (cs: string[]) => cs.reduce((s, c) => s + rel(c), 0) / cs.length;
  const test = plates.filter((p) => p.axis !== 'control');
  return {
    figureLighter: test.filter((p) => meanLum(p.figureColors) > meanLum(p.backgroundColors)).length,
    total: test.length,
  };
}

/**
 * The default set, used where no per-administration seed is available (tests, the fixture).
 * A real session passes its own seed, so no two administrations show the same plates in the same
 * order.
 */
export const PLATES: Plate[] = buildScreeningPlates(0);

export interface IshiharaResponse {
  plateId: number;
  digit: string;
  answer: string;
  correct: boolean;
}

export interface IshiharaResult {
  responses: IshiharaResponse[];
  correct: number;
  total: number;
  /** Test plates only (excludes control). */
  testCorrect: number;
  testTotal: number;
  /** Screening outcome. */
  status: 'normal' | 'screen_failed' | 'inconclusive';
}

/** Score answers against the plate set. */
export function scoreIshihara(plates: Plate[], answers: Record<number, string>): IshiharaResult {
  const responses: IshiharaResponse[] = plates.map((p) => {
    const answer = (answers[p.id] ?? '').trim();
    return { plateId: p.id, digit: p.digit, answer, correct: answer === p.digit };
  });
  const correct = responses.filter((r) => r.correct).length;
  const test = responses.filter((_, i) => plates[i].axis !== 'control');
  const testCorrect = test.filter((r) => r.correct).length;
  const control = responses.filter((_, i) => plates[i].axis === 'control');
  const controlOk = control.every((r) => r.correct);

  let status: IshiharaResult['status'];
  /*
   * A set with no confusion plates measured nothing, so it is inconclusive — not a pass.
   *
   * Without this the rule `testCorrect >= test.length - SCREEN_ALLOWED_SLIPS` reads `0 >= -1` and
   * returns 'normal': scoreIshihara([], {}) was a clean bill of colour vision. Unreachable from the
   * app, which always builds a full set, but the stress harness calls this with `PLATES ?? []` and
   * the allowance is absolute rather than proportional, so a one-plate set passed at zero correct
   * too. A scoring function that certifies an empty administration is the "green while measuring
   * nothing" shape this audit keeps finding.
   */
  if (test.length === 0) status = 'inconclusive';
  else if (!controlOk) status = 'inconclusive'; // failed the control plate → invalid attempt
  else status = testCorrect >= test.length - SCREEN_ALLOWED_SLIPS ? 'normal' : 'screen_failed';

  return { responses, correct, total: plates.length, testCorrect, testTotal: test.length, status };
}

/**
 * Fold a screening outcome into the participant's stored colour-vision status.
 *
 * Pure, and separated from the stage handler, because the ordering here is the whole substance:
 *
 *  - A FAILURE is sticky. The plate set is identical and deterministically seeded between the two
 *    sittings, so a participant who failed at sitting 1 may well "pass" at sitting 2 from memory.
 *  - An INVALID attempt (the greyscale control plate missed) is recorded as such. It used to fall
 *    through to the participant's existing status, which for someone who self-reported no
 *    deficiency is 'normal' — so mis-tapping the control while scoring 3 of 5 test plates left them
 *    normal and eligible, where the same 3 of 5 with the control correct would have been excluded.
 *  - A SELF-REPORTED deficiency is not overturned by this screen. The module header above calls it
 *    a screening aid and names formal Ishihara/Farnsworth plates as the standard for exclusion.
 *
 * 'screen_inconclusive' is deliberately neither a pass nor an exclusion: nothing was measured, so
 * there is no basis to exclude, but the analyst must be able to see that the screen produced no
 * result rather than read an absent one as a pass.
 */
export type StoredCvdStatus =
  | 'normal' | 'self_reported_deficient' | 'screen_failed' | 'screen_inconclusive' | 'unknown';

export function resolveCvdStatus(
  prior: StoredCvdStatus,
  result: IshiharaResult['status'],
): StoredCvdStatus {
  if (prior === 'screen_failed' || result === 'screen_failed') return 'screen_failed';
  if (prior === 'self_reported_deficient') return 'self_reported_deficient';
  if (result === 'normal') return 'normal';
  return 'screen_inconclusive';
}

/**
 * Whether the counts to store alongside `resolveCvdStatus(prior, result)` are an EARLIER
 * administration's rather than this one's.
 *
 * `cvd_status` is sticky, so the status stored after an administration is not always the one that
 * administration produced. The counts have to follow the status — a `screen_failed` verdict sitting
 * beside a passing administration's 5-of-5 is a contradiction an analyst resolves the wrong way, by
 * trusting the numbers over the flag.
 *
 * This is the predicate, and it is a function rather than an expression at the call site because
 * the version written inline was wrong for a case nothing tested. It read
 * `status === prior && status !== result`, comparing a StoredCvdStatus against an
 * IshiharaResult['status'] — two different enumerations. For a participant who self-reported a
 * deficiency at the profile stage, `status` and `prior` are both 'self_reported_deficient' and
 * `result` is whatever the plates gave, so the predicate was TRUE and this administration's counts
 * were discarded in favour of the prior's, which on a first sitting is null.
 *
 * Three things followed from that. The codebook says a null count means "it was not run", which was
 * then false for those rows — the screen HAD run and been scored. The operator manual instructs the
 * operator to compare the self-report against the app's screen and record both if they disagree,
 * which that row can no longer support. And `cvd_screen_total != null` is what the setup state
 * machine uses to decide the colour-vision stage is satisfied, so the stage was re-presented on
 * every resume of that participant's session.
 *
 * Only ONE status is genuinely inherited from an earlier ADMINISTRATION: `screen_failed` carried
 * forward over a later pass. `self_reported_deficient` does not come from an administration at all —
 * it comes from the profile question — so it inherits nothing, and the screen that just ran is the
 * only thing the counts could describe.
 */
export function countsComeFromPriorAdministration(
  stored: StoredCvdStatus,
  result: IshiharaResult['status'],
): boolean {
  return stored === 'screen_failed' && result !== 'screen_failed';
}
