/**
 * The straight-lining simulation (Round 85): `npm run sim:straightline` (optionally `-- <runs per row>`;
 * default 200000).
 *
 * Prints, for a careless participant tapping one spot, an honest rater, an honest "none" and an honest
 * rater with mild symptoms, how often each candidate rule flags them on the 100 mm line: Round 84's
 * whole-point rule, the shipped str-r2 (five marks within 5 mm, the ends exempt by the marks' average),
 * str-r2's spread at other widths, and for the honest rater the old whole-number rule on the same
 * feelings. MODEL, not evidence; every assumption is listed in src/sim/straightLine.ts. Deterministic.
 */
import { runStraightLine, CANDIDATE_SPREADS_MM, type Respondent, type StraightLineResult } from '../src/sim/straightLine';
import { STRAIGHT_LINE } from '../src/dashboard/straightLine';

const RUNS = Number(process.argv[2] ?? 200000);
const SEED = 20261016;
let seedN = 0;
const nextSeed = () => SEED + 1000 * ++seedN;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

function table(title: string, rows: { label: string; r: Respondent }[], withOld: boolean, withEnd: boolean) {
  console.log(`\n## ${title}\n`);
  const head = ['Respondent', ...(withOld ? ['old rule, same feelings'] : []), 'Round 84 (whole points)', `str-r2 (${STRAIGHT_LINE.VAS_SPREAD_MM} mm)`,
    ...(withEnd ? ['every mark at the end'] : []), ...CANDIDATE_SPREADS_MM.map((k) => `≤ ${k} mm`)];
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const { label, r } of rows) {
    const x: StraightLineResult = runStraightLine(r, RUNS, nextSeed());
    const cells = [label, ...(withOld ? [pct(x.oldWhole)] : []), pct(x.round84), pct(x.strR2),
      ...(withEnd ? [pct(x.everyMarkEnd)] : []), ...CANDIDATE_SPREADS_MM.map((k) => pct(x.spread[k]))];
    console.log(`| ${cells.join(' | ')} |`);
  }
}

console.log('# Straight-lining simulation output');
console.log(`\n${RUNS} respondents per row; base seed ${SEED}. Marks recorded as whole millimetres of the 100 mm line. `
  + `The "≤ k mm" columns are str-r2's spread test at that width with its end exemption (the five marks' average within `
  + `${STRAIGHT_LINE.VAS_END_ZONE_MM} mm of an end).`);

table('A. Careless: one spot (uniform 5-95 mm), five taps straight down, horizontal scatter of SD', [0.5, 1, 2, 3, 4].map((s) => ({
  label: `${s} mm`, r: { kind: 'careless', scatterMm: s } as Respondent,
})), false, false);

table('B. Honest: a level (uniform 10-90 mm), the five symptoms differing by SD', [3, 5, 7.5, 10, 15, 20].map((s) => ({
  label: `${s} mm`, r: { kind: 'honest', itemSpreadMm: s } as Respondent,
})), true, false);

table('C. Honest "none on every item": five taps at the left end stop, scatter of SD', [1, 2, 3, 4].map((s) => ({
  label: `${s} mm`, r: { kind: 'end', scatterMm: s } as Respondent,
})), false, true);

table('D. Honest, mild symptoms: a level uniform 5-20 mm, the five differing by SD', [3, 5, 10].map((s) => ({
  label: `${s} mm`, r: { kind: 'honest', itemSpreadMm: s, level: [5, 20] } as Respondent,
})), true, false);
