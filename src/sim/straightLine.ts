/**
 * The straight-lining simulation behind rule str-r2 (Round 85; src/dashboard/straightLine.ts,
 * scripts/straightLineSim.ts, ANALYSIS_PLAN.md §4c).
 *
 * MODEL, NOT EVIDENCE. It asks how often each candidate rule flags three kinds of respondent on the
 * 100 mm line, with every assumption below; none of it was measured on the Xiaomi Pad 6 or on people.
 *
 *   careless  One aim point per rating, uniform over 5-95 mm (inside the end zones), and five taps
 *             straight down the screen, each landing at the aim plus a normal horizontal error of SD
 *             `scatterMm`. How far a fingertip strays between five taps on this tablet is NOT MEASURED,
 *             so the scatter is a range (0.5-4 mm).
 *   honest    A level uniform over `level` mm (default 10-90), and five items at the level plus a normal
 *             item-to-item difference of SD `itemSpreadMm`: the five symptoms really differ by that much.
 *             How much they differ in this sample is NOT KNOWN before data, so it is a range (3-20 mm).
 *   end       An honest "none on every item": five taps aimed at the left end stop, each with a normal
 *             error of SD `scatterMm`. A tap past the end reads 0, as on the screen (the target reaches
 *             past each end).
 *
 * Every mark is recorded as the line records it: whole millimetres, 0-100 (vasMm). The old whole-number
 * rule is also applied to the honest rater's feelings at whole points (rounded half up), which is what
 * the number slider would have recorded for the same feelings: the comparison the criterion in
 * straightLine.ts is about. Deterministic: the same seed gives the same numbers.
 */
import { makeRng, gaussian, type Rng } from './rng';
import { vasMm, VAS_LINE_MM } from '@/scales/vas';
import { sliderStraightLined, vasStraightLined, STRAIGHT_LINE } from '@/dashboard/straightLine';

export type Respondent =
  | { kind: 'careless'; scatterMm: number }
  | { kind: 'honest'; itemSpreadMm: number; level?: [number, number] }
  | { kind: 'end'; scatterMm: number };

/** The spreads (mm) str-r2 was chosen among. */
export const CANDIDATE_SPREADS_MM = [2, 3, 4, 5, 6, 8, 10] as const;

export interface StraightLineResult {
  /** Round 84's rule: each mark rounded half up to a whole point, then five identical, not 0 or 10. */
  round84: number;
  /** The old whole-number rule on the same feelings, rounded half up to whole points (honest only). */
  oldWhole: number;
  /** str-r2 as shipped. */
  strR2: number;
  /** str-r2's spread test at each candidate spread, the end exemption unchanged. */
  spread: Record<number, number>;
  /** str-r2's spread, but exempting the ends only when EVERY mark is inside an end zone. */
  everyMarkEnd: number;
}

const FIVE = 5;
const record = (mm: number) => vasMm(mm / VAS_LINE_MM);
const wholePoint = (mm: number) => Math.floor(mm / 10 + 0.5);

/** The five latent positions (mm, before the line records them) for one respondent. */
function latent(rng: Rng, r: Respondent): number[] {
  if (r.kind === 'careless') {
    const aim = 5 + 90 * rng();
    return Array.from({ length: FIVE }, () => aim + gaussian(rng, 0, r.scatterMm));
  }
  if (r.kind === 'end') return Array.from({ length: FIVE }, () => gaussian(rng, 0, r.scatterMm));
  const [lo, hi] = r.level ?? [10, 90];
  const level = lo + (hi - lo) * rng();
  return Array.from({ length: FIVE }, () => level + gaussian(rng, 0, r.itemSpreadMm));
}

function everyMarkEndRule(mm: number[], spreadMm: number): boolean {
  const lo = Math.min(...mm);
  const hi = Math.max(...mm);
  if (hi - lo > spreadMm) return false;
  return !(hi < STRAIGHT_LINE.VAS_END_ZONE_MM) && !(lo > VAS_LINE_MM - STRAIGHT_LINE.VAS_END_ZONE_MM);
}

/** The share of `runs` respondents each rule flags. */
export function runStraightLine(r: Respondent, runs: number, seed: number): StraightLineResult {
  const rng = makeRng(seed);
  let round84 = 0, oldWhole = 0, strR2 = 0, everyMarkEnd = 0;
  const spread: Record<number, number> = Object.fromEntries(CANDIDATE_SPREADS_MM.map((k) => [k, 0]));
  for (let i = 0; i < runs; i++) {
    const x = latent(rng, r);
    const mm = x.map(record);
    if (sliderStraightLined(mm.map(wholePoint))) round84++;
    if (sliderStraightLined(x.map((v) => wholePoint(Math.min(VAS_LINE_MM, Math.max(0, v)))))) oldWhole++;
    if (vasStraightLined(mm)) strR2++;
    if (everyMarkEndRule(mm, STRAIGHT_LINE.VAS_SPREAD_MM)) everyMarkEnd++;
    for (const k of CANDIDATE_SPREADS_MM) if (vasStraightLined(mm, k)) spread[k]++;
  }
  const share = (n: number) => n / runs;
  return {
    round84: share(round84), oldWhole: share(oldWhole), strR2: share(strR2), everyMarkEnd: share(everyMarkEnd),
    spread: Object.fromEntries(Object.entries(spread).map(([k, n]) => [k, share(n)])),
  };
}
