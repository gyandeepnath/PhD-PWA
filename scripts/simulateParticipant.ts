/**
 * Protocol timing simulation for the target population.
 *
 * Question: how long does one sitting actually take for a university student aged 20-24, and does
 * the median fit the 120-minute feasibility gate (§3.6)?
 *
 * Every duration the app controls is read from the REAL CONFIG, so this cannot drift from what the
 * instrument does. Everything the PARTICIPANT controls is drawn from a distribution with a stated
 * basis:
 *
 *  - Reading rate. Brysbaert's (2019) meta-analysis of 190 studies gives ~238 wpm for silent
 *    non-fiction reading by adults. Our passages are dense expository prose (Flesch 9-29) read in
 *    the knowledge that a comprehension question follows, which slows readers, so the mean is set
 *    below that meta-analytic figure and the spread is wide.
 *  - Blink rate during reading. Reading suppresses spontaneous blinking on any medium; reported
 *    reading rates cluster around 11-15/min against a ~17/min conversational baseline.
 *  - Incomplete-blink proportion. Portello & Rosenfield (2013) report a mean of 16.1% over 15
 *    minutes of reading, range 0.9-56.5%.
 *  - Questionnaire and slider times are per-item estimates for a motivated young-adult sample.
 *
 * Individual differences are carried by two participant-level traits, each applied as a multiplier
 * so that a slow, careful participant is slow across the whole protocol rather than independently
 * slow at each step — which is what makes the upper tail of the session-length distribution real
 * rather than an artefact of averaging independent draws.
 *
 *   npx tsx scripts/simulateParticipant.ts
 *   npx tsx scripts/simulateParticipant.ts --n 5000
 */
import { CONFIG, TASKS_PER_CONDITION } from '../src/experiment/config';
import { N_CONDITIONS } from '../src/experiment/conditions';
import { PASSAGES } from '../src/experiment/passages';
import {
  type Breakdown, type Person, type Provenance, type SittingSpec,
  PROVENANCE, provenanceOf, clamp, gauss, rtBlockSeconds, samplePerson, simulateSitting, reseed, S,
  seOfRatio, powerT, attenuatedDz, CONTRAST, SYNOPSIS,
} from './lib/timingModel';

const N = Number(process.argv[process.argv.indexOf('--n') + 1]) || 2000;

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, c) => a - c);
  return s[clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1)];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function run(
  cfg: typeof CONFIG,
  label: string,
  spec: SittingSpec = { illumination: 'dim', first: true, dimReadingPenalty: 0 },
) {
  const totals: number[] = [];
  const switches: number[] = [];
  const blinks: number[] = [];
  const agg: Breakdown = {};
  for (let k = 0; k < N; k++) {
    const p = samplePerson();
    const r = simulateSitting(p, (k % N_CONDITIONS) + 1, k % 2, cfg, spec);
    totals.push(r.total / 60);
    switches.push(r.polaritySwitches);
    blinks.push(r.blinksPerCondition);
    for (const [key, v] of Object.entries(r.breakdown)) agg[key] = (agg[key] ?? 0) + v / N / 60;
  }
  return { label, totals, switches, blinks, agg };
}

console.log('='.repeat(96));
console.log(`PROTOCOL TIMING SIMULATION — ${N} simulated participants, university students aged 20-24`);
console.log('='.repeat(96));
console.log(`Conditions per sitting     ${N_CONDITIONS}`);
console.log(`Measured sub-stages each   ${TASKS_PER_CONDITION}`);
console.log(`Adaptation                 ${CONFIG.ADAPTATION_SAME_POLARITY_MS / S}s same polarity, ${CONFIG.ADAPTATION_SWITCH_POLARITY_MS / S}s on a switch`);
console.log(`Reading floor              ${CONFIG.READING_PAGE_MIN_MS / S}s per page`);
console.log(`RT block                   ${CONFIG.RT_TRIALS_PER_CONDITION} trials -> ${rtBlockSeconds(CONFIG.RT_TRIALS_PER_CONDITION).toFixed(0)}s`);
console.log(`Visual-search limit        ${CONFIG.VS_TIME_LIMIT_MS / S}s`);

const base = run(CONFIG, 'as shipped');

console.log('\n' + '-'.repeat(96));
console.log('WHERE THE TIME GOES (mean minutes per sitting, descending)');
console.log('-'.repeat(96));
const rows = Object.entries(base.agg).sort((a, b) => b[1] - a[1]);
const totalMean = mean(base.totals);
for (const [k, v] of rows) {
  const bar = '#'.repeat(Math.round(v * 2));
  console.log(`  ${k.padEnd(34)} ${v.toFixed(1).padStart(6)} min  ${((v / totalMean) * 100).toFixed(1).padStart(5)}%  ${bar}`);
}
console.log(`  ${'TOTAL'.padEnd(34)} ${totalMean.toFixed(1).padStart(6)} min`);

console.log('\n' + '-'.repeat(96));
console.log('SESSION LENGTH DISTRIBUTION');
console.log('-'.repeat(96));
for (const q of [0.05, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
  const v = pct(base.totals, q);
  console.log(`  p${String(Math.round(q * 100)).padStart(2)}  ${v.toFixed(1).padStart(6)} min${q === 0.5 ? '   <- median, the feasibility gate applies here' : ''}`);
}
const over = base.totals.filter((t) => t > 120).length;
console.log(`\n  FEASIBILITY GATE (median <= 120 min): median ${pct(base.totals, 0.5).toFixed(1)} min -> ${pct(base.totals, 0.5) <= 120 ? 'PASS' : 'FAIL'}`);
console.log(`  Participants exceeding 120 min: ${over} / ${N} (${((over / N) * 100).toFixed(1)}%)`);

console.log('\n' + '='.repeat(96));
console.log('IS THIS TOTAL AN OVER-ESTIMATE? — the same minutes split by where the number comes from');
console.log('='.repeat(96));
console.log('  Only the third tier is a guess. The first is what the code enforces; the second is');
console.log('  the corpus word count divided by a reading rate.\n');
{
  const tiers: Record<Provenance, number> = { enforced: 0, corpus: 0, estimated: 0 };
  for (const [k, v] of Object.entries(base.agg)) tiers[provenanceOf(k)] += v;
  const label: Record<Provenance, string> = {
    enforced: 'ENFORCED by CONFIG (cannot be argued down)',
    corpus: 'CORPUS arithmetic (word count / reading rate)',
    estimated: 'ESTIMATED by me (the only tier with guess error)',
  };
  for (const t of ['enforced', 'corpus', 'estimated'] as Provenance[]) {
    const v = tiers[t];
    console.log(`  ${label[t].padEnd(48)} ${v.toFixed(1).padStart(6)} min  ${((v / totalMean) * 100).toFixed(0).padStart(3)}%`);
    for (const [k, x] of Object.entries(base.agg).filter(([k]) => provenanceOf(k) === t).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${k.padEnd(42)} ${x.toFixed(1).padStart(6)} min`);
    }
  }
  console.log(`\n  ${'TOTAL'.padEnd(48)} ${totalMean.toFixed(1).padStart(6)} min`);

  console.log('\n  If every one of MY estimates is wrong in the optimistic direction:');
  for (const cut of [0, 0.2, 0.3, 0.5, 0.7, 1.0]) {
    const t = tiers.enforced + tiers.corpus + tiers.estimated * (1 - cut);
    const tag = cut === 0 ? '  <- as modelled' : cut === 1 ? '  <- estimates set to ZERO: the arithmetic floor' : '';
    console.log(`    estimates ${(cut * 100).toFixed(0).padStart(3)}% too high -> ${t.toFixed(1).padStart(6)} min${tag}`);
  }
  const fastRead = (PASSAGES.reduce((a, x) => a + x.wordCount, 0) / 300) ;
  console.log(`\n  Hardest possible floor: enforced ${tiers.enforced.toFixed(1)} min + all ${PASSAGES.reduce((a, x) => a + x.wordCount, 0)} corpus words`);
  console.log(`  read at a brisk 300 wpm (${fastRead.toFixed(1)} min) + zero deliberation = ${(tiers.enforced + fastRead).toFixed(1)} min.`);
  console.log('  That floor is a property of the design, not of how fast the participant is.');
}

console.log('\n' + '='.repeat(96));
console.log('THE FOUR CELLS — illumination x sitting order (they are orthogonal by design)');
console.log('='.repeat(96));
console.log('  Illumination order is counterbalanced against sitting order, so "the dim sitting" is');
console.log('  the FIRST visit for half the sample and the SECOND for the other half. The two factors');
console.log('  act on different things: illumination on reading rate, sitting order on setup burden.');
console.log('  The second sitting skips PARTICIPANT_PROFILE and COLOR_VISION because their predicates');
console.log('  read participant-scoped fields; consent and both baselines repeat because theirs are');
console.log('  session-scoped.\n');
for (const pen of [0, 0.05, 0.10]) {
  console.log(`  -- assuming dim slows reading by ${(pen * 100).toFixed(0)}% ` + '-'.repeat(58));
  const cells: Array<[string, number]> = [];
  for (const illum of ['dim', 'bright'] as const) {
    for (const first of [true, false]) {
      const r = run(CONFIG, '', { illumination: illum, first, dimReadingPenalty: pen });
      const m = mean(r.totals);
      cells.push([`${illum.padEnd(6)} / ${first ? '1st visit' : '2nd visit'}`, m]);
      console.log(`     ${illum.padEnd(6)} ${first ? '1st visit' : '2nd visit'}   mean ${m.toFixed(1).padStart(6)} min   median ${pct(r.totals, 0.5).toFixed(1).padStart(6)} min   p95 ${pct(r.totals, 0.95).toFixed(1).padStart(6)} min`);
    }
  }
  // A participant runs exactly one 1st visit and one 2nd visit, one dim and one bright.
  const dim1 = cells.find(([k]) => k.startsWith('dim') && k.includes('1st'))![1];
  const dim2 = cells.find(([k]) => k.startsWith('dim') && k.includes('2nd'))![1];
  const br1 = cells.find(([k]) => k.startsWith('bright') && k.includes('1st'))![1];
  const br2 = cells.find(([k]) => k.startsWith('bright') && k.includes('2nd'))![1];
  console.log(`     total contact per participant: dim-first ${(dim1 + br2).toFixed(1)} min, bright-first ${(br1 + dim2).toFixed(1)} min`);
}

console.log('\n' + '-'.repeat(96));
console.log('POLARITY SWITCHES — the hidden cost of the Williams order');
console.log('-'.repeat(96));
console.log(`  switches per sitting: mean ${mean(base.switches).toFixed(1)} of ${N_CONDITIONS - 1} transitions`);
const adaptMin = base.agg['adaptation'] ?? 0;
console.log(`  adaptation total    : ${adaptMin.toFixed(1)} min (${((adaptMin / totalMean) * 100).toFixed(1)}% of the sitting)`);
const allSame = ((N_CONDITIONS - 1) * CONFIG.ADAPTATION_SAME_POLARITY_MS) / S / 60;
console.log(`  if no switches      : ${allSame.toFixed(1)} min -> switching costs ${(adaptMin - allSame).toFixed(1)} min per sitting`);

console.log('\n' + '-'.repeat(96));
console.log('MEASUREMENT PRECISION OF THE PRIMARY OUTCOME');
console.log('-'.repeat(96));
const mb = mean(base.blinks);
console.log(`  blinks captured per condition (mean): ${mb.toFixed(0)}`);
console.log(`  reading exposure per condition      : ${(base.agg['reading'] / N_CONDITIONS * 60).toFixed(0)}s`);
for (const p of [0.16]) {
  const se = Math.sqrt((p * (1 - p)) / mb);
  console.log(`  incomplete-blink ratio at p=${p}: SE = ${se.toFixed(3)}  (95% CI width +/-${(1.96 * se).toFixed(3)})`);
  console.log(`  -> a condition-level ratio of ${p} is measured to about +/-${(1.96 * se * 100).toFixed(0)} percentage points`);
}
console.log(`  For SE <= 0.05 you need ~${Math.ceil((0.16 * 0.84) / 0.05 ** 2)} blinks -> ~${(Math.ceil((0.16 * 0.84) / 0.05 ** 2) / 13 * 60).toFixed(0)}s of reading at 13 blinks/min`);

export { simulateSitting, samplePerson, rtBlockSeconds, run };

// ================================================================================================
// MEASUREMENT ERROR -> POWER ATTENUATION
//
// The synopsis power analysis assumes a participant-level effect size d_z. But d_z is computed on
// OBSERVED difference scores, and an observed score carries binomial measurement error from the
// finite number of blinks captured in each condition. That error inflates the denominator of d_z,
// so the effect the study can actually detect is smaller than the effect it was powered for.
//
//   observed d_z = true d_z * sqrt( sigma_true^2 / (sigma_true^2 + sigma_measurement^2) )
//
// Two contrasts matter, and they carry very different measurement error:
//   - the polarity MAIN effect averages 5 conditions per side, so error shrinks by sqrt(5)
//   - the polarity x colour INTERACTION contrasts single conditions, so it carries the full error
// ================================================================================================

console.log('\n' + '='.repeat(96));
console.log('POWER UNDER MEASUREMENT ERROR — what the shipped exposure actually buys');
console.log('='.repeat(96));
/**
 * Derived from the simulation, never hard-coded.
 *
 * Both tables below used to be anchored on a literal 73, the exposure the corpus delivered before
 * it was rebuilt. After the rebuild the base simulation read the real passages (~178 s) while the
 * tables still called 73 s "as shipped" and added their increments on top of a base that already
 * contained 178 s — so the row labelled "as shipped" described a build that no longer existed, and
 * every raised-exposure row double-counted. Figures from this script have reached the synopsis
 * before; a stale constant here becomes a false claim in a thesis.
 */
const SHIPPED_SEC = Math.round((base.agg['reading'] / N_CONDITIONS) * 60);
const { SIGMA_TRUE, N_ANALYSED, TRUE_DZ_MAIN, TRUE_DZ_INTERACTION } = SYNOPSIS;
console.log(`Assumes a between-participant SD of the true difference score of ${SIGMA_TRUE}, n = ${N_ANALYSED}.`);
console.log('');
console.log('  reading    blinks   SE per      MAIN EFFECT (5v5)          INTERACTION (1v1)');
console.log('  exposure   /cond    condition   d_z obs   power           d_z obs   power');
console.log('  ' + '-'.repeat(88));
const EXPOSURES = [...new Set([73, 120, SHIPPED_SEC, 240, 300])].sort((a, b) => a - b);
for (const sec of EXPOSURES) {
  const blinks = (sec / 60) * 13;
  const se = seOfRatio(blinks);
  const seMain = CONTRAST.main(se, N_CONDITIONS);
  const seInter = CONTRAST.interaction(se);
  const dzMain = attenuatedDz(TRUE_DZ_MAIN, SIGMA_TRUE, seMain);
  const dzInter = attenuatedDz(TRUE_DZ_INTERACTION, SIGMA_TRUE, seInter);
  const flag = sec === SHIPPED_SEC ? '  <- as shipped' : sec === 73 ? '  <- the corpus before it was rebuilt' : '';
  console.log(`  ${String(sec).padStart(4)}s     ${blinks.toFixed(0).padStart(5)}    ${se.toFixed(3)}       ` +
    `${dzMain.toFixed(3)}   ${(powerT(N_ANALYSED, dzMain) * 100).toFixed(0).padStart(3)}%            ` +
    `${dzInter.toFixed(3)}   ${(powerT(N_ANALYSED, dzInter) * 100).toFixed(0).padStart(3)}%${flag}`);
}
console.log('');
console.log(`  Target from the synopsis: ${(SYNOPSIS.TARGET_POWER_MAIN * 100).toFixed(0)}% for the main effect, ${(SYNOPSIS.TARGET_POWER_INTERACTION * 100).toFixed(0)}% for the interaction at n=${N_ANALYSED}.`);
console.log('  The interaction is the binding constraint AND the contrast most exposed to this error.');

console.log('\n' + '='.repeat(96));
console.log('SESSION LENGTH IF READING EXPOSURE IS RAISED');
console.log('='.repeat(96));
for (const sec of EXPOSURES) {
  const extra = (sec - SHIPPED_SEC) * N_CONDITIONS / 60;
  const med = pct(base.totals, 0.5) + extra;
  const p95 = pct(base.totals, 0.95) + extra;
  console.log(`  ${String(sec).padStart(4)}s/condition -> median ${med.toFixed(0).padStart(3)} min, p95 ${p95.toFixed(0).padStart(3)} min  ` +
    `${med <= 120 ? 'gate PASS' : 'gate FAIL'}${p95 > 120 ? '  (tail exceeds 120)' : ''}` +
    `${sec === SHIPPED_SEC ? '  <- as shipped' : ''}`);
}
