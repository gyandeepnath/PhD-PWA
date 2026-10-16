/**
 * The straight-lining check on the five fatigue items: a careless-responding signal, one of the
 * engagement signals in aggregate.ts (`careless_straight_lined` in 12_quality_flags.csv).
 *
 * TWO RULES, ONE PER RATING FORMAT, and every row says which judged it (`straight_line_rule`):
 *
 * str-r1, on the number sliders (`sl-v1`, before Round 84): all five items the SAME WHOLE NUMBER, and
 *   that number neither 0 nor 10. Unchanged since before Round 84.
 *
 * str-r2, on the 100 mm lines (`vas-v2`, from Round 85): all five marks WITHIN 5 mm of each other
 *   (largest minus smallest, in the whole millimetres stored), unless their average lies in the first or
 *   the last 5 mm of the line.
 *
 * WHY NOT ONE RULE. Round 84 judged the lines at whole points (each item rounded to 0-10, then compared),
 * and said that asked "the same question" of both formats. It did not: whether five marks were flagged
 * then depended on where they fell against the x.5 boundaries, not on how close together they were.
 * Five marks within 1 mm of each other (3.4, 3.5, 3.4, 3.5, 3.4) were not flagged; five 9 mm apart
 * (2.5 ... 3.4) were. The lines have no steps to be "the same" on, so str-r2 asks how far apart the
 * marks are.
 *
 * WHERE 5 mm COMES FROM: a simulation, not a source and not the device (src/sim/straightLine.ts,
 * `npm run sim:straightline`, base seed 20261016, 200,000 respondents a row; the table is in
 * ANALYSIS_PLAN.md §4c). Criterion, fixed before choosing: the LARGEST spread at which an honest rater —
 * five symptoms rated a little differently around one level — is flagged no more often than the old
 * whole-number rule flagged the same feelings, at every item-to-item spread simulated (SD 3 to 20 mm).
 * That is 5 mm: 6 mm already flags honest raters more often at SD 3 mm (46% against 32%) and 5 mm (11%
 * against 10%). At 5 mm a careless participant who taps one spot straight down the screen is flagged in
 * 99.6% of cases if each tap lands within a scatter of SD 1 mm (Round 84's rule: 77%), and 70% at SD
 * 2 mm (53%); at 3-4 mm the two rules are alike (30% and 13%, against 32% and 18%). How far a fingertip
 * strays between five taps on this tablet is NOT MEASURED.
 *
 * THE ENDS STAY EXEMPT, for the reason the rule always had: "none" on every item is the expected honest
 * answer of a healthy participant early in a sitting, and flagging it would penalise the least
 * symptomatic participants at the earliest conditions — and the sensitivity analysis drops flagged rows,
 * so it would bias the time-on-task and condition effects upward. Five "severe" late in a sitting is the
 * same in the other direction. On the line, "none" is a tap at the left end stop: some taps land just
 * past it (read as 0), some a few millimetres in. Judging the ends by the AVERAGE of the five keeps such
 * an answer exempt (the simulation: at most 0.05% flagged with a tap scatter up to SD 4 mm), where
 * requiring every mark inside the first 5 mm flagged it in up to 15% of cases. 5 mm is the span the old
 * scale's 0 and its 10 each covered (half a point).
 *
 * WHAT A FLAG COSTS. ENGAGEMENT_PENALTY.STRAIGHT_LINED (0.1) on the 1.0 quality score: on its own it
 * leaves a condition "good" (ENGAGEMENT.QUALITY_GOOD 0.8), so a straight-lining flag alone never removes
 * a condition from the pre-registered sensitivity refit.
 */
import type { FatigueRecord } from '@/storage/types';
import { rowSliderVersion, SLIDER_VERSION_V1 } from '@/scales/vas';

/** The rule judging `sl-v1` rows: five identical whole numbers, not 0 and not 10. */
export const STRAIGHT_LINE_RULE_V1 = 'str-r1';
/** The rule judging `vas-v2` rows (Round 85): five marks within 5 mm, their average not at an end. */
export const STRAIGHT_LINE_RULE_V2 = 'str-r2';

export const STRAIGHT_LINE = {
  /** str-r2: the largest spread (max - min, whole mm of the 100 mm line) still read as straight-lined. */
  VAS_SPREAD_MM: 5,
  /** str-r2: five marks whose average is within this many mm of either end are exempt. */
  VAS_END_ZONE_MM: 5,
} as const;

/** Endpoints of the 0-10 per-item fatigue scale. */
const FATIGUE_MIN = 0;
const FATIGUE_MAX = 10;

/** The five items of a fatigue row, in their stored 0-10 units. */
function items(fat: FatigueRecord): number[] {
  return [fat.eye_strain, fat.dryness, fat.blur, fat.burning, fat.headache];
}

/** Which rule judges this row: str-r1 on the number sliders, str-r2 on the 100 mm lines. */
export function straightLineRule(fat: FatigueRecord): string {
  return rowSliderVersion(fat) === SLIDER_VERSION_V1 ? STRAIGHT_LINE_RULE_V1 : STRAIGHT_LINE_RULE_V2;
}

/**
 * str-r2 on five marks in whole millimetres of the 100 mm line (0-100). Exported for the simulation,
 * which runs this very function.
 */
export function vasStraightLined(mm: number[], spreadMm: number = STRAIGHT_LINE.VAS_SPREAD_MM): boolean {
  const lo = Math.min(...mm);
  const hi = Math.max(...mm);
  if (hi - lo > spreadMm) return false;
  const mean = mm.reduce((a, x) => a + x, 0) / mm.length;
  return mean >= STRAIGHT_LINE.VAS_END_ZONE_MM && mean <= 100 - STRAIGHT_LINE.VAS_END_ZONE_MM;
}

/** str-r1 on five whole numbers 0-10. */
export function sliderStraightLined(v: number[]): boolean {
  return v.every((x) => x === v[0]) && v[0] !== FATIGUE_MIN && v[0] !== FATIGUE_MAX;
}

/** True when the row's five fatigue items are straight-lined by the rule for its format. */
export function isStraightLined(fat?: FatigueRecord): boolean {
  if (!fat || !fat.all_touched) return false;
  if (straightLineRule(fat) === STRAIGHT_LINE_RULE_V1) return sliderStraightLined(items(fat));
  // vas-v2 items are whole millimetres / 10; back to whole millimetres, as the line recorded them.
  return vasStraightLined(items(fat).map((x) => Math.round(x * 10)));
}
