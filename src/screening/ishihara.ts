/**
 * Digital Ishihara-style colour-vision SCREENING (not a clinical diagnosis).
 *
 * A digit is rendered as a mosaic of dots whose figure/background colours sit on the red-green
 * confusion axis at similar luminance, so red-green CVD observers struggle to read it. This is a
 * screening aid to flag participants for the colour conditions; formal Ishihara/Farnsworth plates
 * remain the gold standard for exclusion. The score and classification are stored as covariates.
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

/** Default screening set: 5 red-green confusion plates + 1 control everyone should pass. */
export const PLATES: Plate[] = [
  { id: 1, digit: '8', axis: 'control', figureColors: ['#3a3a3a', '#2e2e2e', '#444'], backgroundColors: ['#cfcfcf', '#dcdcdc', '#c4c4c4'] },
  { id: 2, digit: '5', axis: 'protan-deutan', figureColors: ['#d98a6a', '#e0996f', '#cf7e5e'], backgroundColors: ['#9aa86a', '#8fa15c', '#aeb57a'] },
  { id: 3, digit: '2', axis: 'protan-deutan', figureColors: ['#c97f5c', '#d98a66', '#bf7450'], backgroundColors: ['#8ca15f', '#9caf6c', '#7d9455'] },
  { id: 4, digit: '7', axis: 'protan-deutan', figureColors: ['#cf8a72', '#dd987f', '#c47e66'], backgroundColors: ['#9aa56a', '#88a05c', '#a7b178'] },
  { id: 5, digit: '6', axis: 'protan-deutan', figureColors: ['#d28a64', '#e0966f', '#c67d58'], backgroundColors: ['#93a463', '#86a058', '#a3b074'] },
  { id: 6, digit: '3', axis: 'protan-deutan', figureColors: ['#cd8568', '#db9276', '#c17a5d'], backgroundColors: ['#8fa260', '#9bae6b', '#7e9555'] },
];

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
