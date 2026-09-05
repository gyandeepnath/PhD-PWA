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
 * 2. MEMORY. The plate set, the digits and the order were fixed constants, and the screen runs in
 *    BOTH sittings. A participant who failed at sitting 1 could "pass" at sitting 2 by recalling
 *    six digits, so the retest measured recall rather than colour vision. Digits, order and
 *    polarity are now drawn from a per-administration seed.
 */

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

export type ConfusionAxis = 'protan-deutan' | 'control';

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
 * A confusion-axis palette pair. Which member becomes the FIGURE is chosen per administration, so
 * that residual luminance does not point the same way on every plate.
 *
 * `warm` (salmon) is the darker member of each pair and `cool` (olive) the lighter, by 3-10% of
 * relative luminance. Putting the cool palette in the figure makes the digit the LIGHTER region.
 */
interface PalettePair {
  warm: string[];
  cool: string[];
}

const CONFUSION_PAIRS: PalettePair[] = [
  { warm: ['#d98a6a', '#e0996f', '#cf7e5e'], cool: ['#9aa86a', '#8fa15c', '#aeb57a'] },
  { warm: ['#c97f5c', '#d98a66', '#bf7450'], cool: ['#8ca15f', '#9caf6c', '#7d9455'] },
  { warm: ['#cf8a72', '#dd987f', '#c47e66'], cool: ['#9aa56a', '#88a05c', '#a7b178'] },
  { warm: ['#d28a64', '#e0966f', '#c67d58'], cool: ['#93a463', '#86a058', '#a3b074'] },
  { warm: ['#cd8568', '#db9276', '#c17a5d'], cool: ['#8fa260', '#9bae6b', '#7e9555'] },
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
 * Build one administration's plate set: a greyscale control plate everyone should pass, then five
 * confusion plates whose digits, order and luminance polarity all derive from `seed`.
 *
 * Polarity is BALANCED, not merely randomised: two or three of the five carry the figure in the
 * lighter palette whatever the seed, so no administration can present a set in which the digit is
 * always the darker region.
 */
export function buildScreeningPlates(seed: number): Plate[] {
  const next = rng(seed + 1);
  const digits = shuffle(DIGIT_POOL, next);
  const pairs = shuffle(CONFUSION_PAIRS, next);

  // Balanced polarity: exactly two of the five put the figure in the cool (lighter) palette, and
  // which two varies with the seed.
  const coolFigure = new Set(shuffle([0, 1, 2, 3, 4], next).slice(0, 2));

  const plates: Plate[] = [
    {
      id: 1,
      digit: digits[5],
      axis: 'control',
      figureColors: CONTROL_FIGURE,
      backgroundColors: CONTROL_BACKGROUND,
    },
  ];
  for (let i = 0; i < 5; i++) {
    const pair = pairs[i];
    const figureIsCool = coolFigure.has(i);
    plates.push({
      id: i + 2,
      digit: digits[i],
      axis: 'protan-deutan',
      figureColors: figureIsCool ? pair.cool : pair.warm,
      backgroundColors: figureIsCool ? pair.warm : pair.cool,
    });
  }
  return plates;
}

/**
 * How many of a set's confusion plates carry the figure in the lighter palette.
 *
 * Exposed so the test can assert the balance directly rather than re-deriving luminance from hex.
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
  if (!controlOk) status = 'inconclusive'; // failed the control plate → invalid attempt
  else status = testCorrect >= test.length - 1 ? 'normal' : 'screen_failed'; // allow one slip

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
