/**
 * What would a shorter protocol cost?
 *
 * The candidate's target is 20 minutes per participant per sitting; the protocol as it stands runs
 * ~98. This script does not argue about whether 20 is reachable — it prices every way of getting
 * closer, so the choice is made against a table rather than an intuition.
 *
 * Two quantities are conserved and are the reason shortening is not free:
 *
 *   1. TOTAL CONDITION-RUNS.  n x runs-per-participant. Halving the conditions in a sitting does
 *      not halve the study; it doubles the number of sittings or the number of participants.
 *   2. BLINKS PER CONDITION.  The primary outcome is a binomial proportion, so its standard error
 *      is set by the blink COUNT. Cutting reading exposure cuts blinks one for one, and the
 *      polarity x colour interaction — already the binding constraint — carries that error in full
 *      because it contrasts single conditions rather than averaging five per side.
 *
 * Every duration comes from scripts/lib/timingModel.ts, which reads the real CONFIG.
 *
 *   npx tsx scripts/protocolFrontier.ts
 *   npx tsx scripts/protocolFrontier.ts --n 4000
 */
import { CONFIG } from '../src/experiment/config';
import { N_CONDITIONS } from '../src/experiment/conditions';
import { N_ILLUMINATION_BLOCKS } from '../src/experiment/illumination';
import {
  type SittingSpec, samplePerson, simulateSitting, reseed, clamp,
  seOfRatio, powerT, attenuatedDz, CONTRAST, SYNOPSIS, dPrimeSe,
} from './lib/timingModel';

const N = Number(process.argv[process.argv.indexOf('--n') + 1]) || 2000;

/**
 * Every participant accumulates one run of each condition under each illumination level.
 *
 * Derived rather than a literal `* 2`: with the dim level withdrawn there is ONE block, so a
 * participant contributes ten condition-runs, not twenty. Left as a literal this script printed
 * "20 condition-runs (10 conditions x 2 illumination levels)" and derived every visit count,
 * contact time and attrition figure in the frontier table from it.
 */
const RUNS_PER_PARTICIPANT = N_CONDITIONS * N_ILLUMINATION_BLOCKS;

/** Assumptions come from the shared SYNOPSIS block so this script cannot disagree with the other. */
const { SIGMA_TRUE, N_ANALYSED: N_PARTICIPANTS, TRUE_DZ_MAIN, TRUE_DZ_INTERACTION } = SYNOPSIS;

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1)];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Variant {
  label: string;
  note: string;
  spec: Partial<SittingSpec>;
  /** Conditions run per sitting; drives how many sittings a participant must attend. */
  perSitting: number;
  /** CONFIG overrides, for levers that live in the instrument rather than in the schedule. */
  cfg?: Partial<typeof CONFIG>;
}

function evaluate(v: Variant) {
  // The same deterministic participant stream for every variant, so differences are the design's.
  reseed();
  const totals: number[] = [];
  const blinks: number[] = [];
  for (let k = 0; k < N; k++) {
    const p = samplePerson();
    const r = simulateSitting(p, (k % N_CONDITIONS) + 1, k % 2, { ...CONFIG, ...v.cfg }, {
      illumination: 'dim', first: k % 2 === 0, dimReadingPenalty: 0,
      conditionsThisSitting: v.perSitting,
      ...v.spec,
    });
    totals.push(r.total / 60);
    blinks.push(r.blinksPerCondition);
  }
  const sittings = Math.ceil(RUNS_PER_PARTICIPANT / v.perSitting);
  const b = mean(blinks);
  return {
    v,
    medianSitting: pct(totals, 0.5),
    p95Sitting: pct(totals, 0.95),
    sittings,
    totalContact: pct(totals, 0.5) * sittings,
    blinks: b,
    se: seOfRatio(b),
    powerMain: powerT(N_PARTICIPANTS, attenuatedDz(TRUE_DZ_MAIN, SIGMA_TRUE, CONTRAST.main(seOfRatio(b), N_CONDITIONS))),
    powerInter: powerT(N_PARTICIPANTS, attenuatedDz(TRUE_DZ_INTERACTION, SIGMA_TRUE, CONTRAST.interaction(seOfRatio(b)))),
    dSe: dPrimeSe(v.cfg?.RT_TRIALS_PER_CONDITION ?? CONFIG.RT_TRIALS_PER_CONDITION, CONFIG.RT_GO_RATE),
  };
}

const VARIANTS: Variant[] = [
  { label: 'as shipped', perSitting: 10, note: '10 conditions, full passages, CVS-Q twice', spec: {} },
  { label: 'CVS-Q once per participant', perSitting: 10, note: 'demote to a screening covariate', spec: { cvsq: 'none' } },
  { label: 'CVS-Q end of sitting only', perSitting: 10, note: 'drop the within-sitting baseline', spec: { cvsq: 'end-only' } },
  { label: '5 cond/sitting', perSitting: 5, note: 'balanced incomplete block', spec: {} },
  { label: '5 cond + CVS-Q once', perSitting: 5, note: '', spec: { cvsq: 'none' } },
  { label: '4 cond/sitting', perSitting: 4, note: 'CVS-Q dropped', spec: { cvsq: 'none' } },
  { label: '2 cond/sitting', perSitting: 2, note: 'CVS-Q dropped', spec: { cvsq: 'none' } },
  { label: '5 cond, 60% passage', perSitting: 5, note: '~350 words per condition', spec: { cvsq: 'none', readingFraction: 0.6 } },
  { label: '4 cond, 60% passage', perSitting: 4, note: '', spec: { cvsq: 'none', readingFraction: 0.6 } },
  { label: '4 cond, 40% passage', perSitting: 4, note: '~234 words per condition', spec: { cvsq: 'none', readingFraction: 0.4 } },
  { label: '2 cond, 40% passage', perSitting: 2, note: 'closest approach to 20 min', spec: { cvsq: 'none', readingFraction: 0.4 } },

  // ---- levers that live in CONFIG rather than in the schedule -------------------------------
  // Adaptation on a polarity switch, 120s -> 90s. Fairchild & Reniff (1995) put chromatic
  // adaptation ~90% complete at ~60s and Belgers et al. (2025) found 60-100s suitable for
  // repeated measures; nothing retrieved requires 120s, and no study measures adaptation to a
  // POLARITY switch as such, so 120s rests on analogy rather than citation.
  { label: 'adaptation switch 120->90s', perSitting: 10, note: '5 switches x 30s saved', spec: {}, cfg: { ADAPTATION_SWITCH_POLARITY_MS: 90000 } },
  { label: 'adaptation switch 120->60s', perSitting: 10, note: 'at the Fairchild criterion', spec: {}, cfg: { ADAPTATION_SWITCH_POLARITY_MS: 60000 } },
  // Go/no-go block, 32 -> 16 trials. Miller (2023) finds RT power is usually maximised by more
  // participants with fewer trials each. This costs d-prime precision per condition; it is listed
  // to price the minutes, not to recommend it.
  { label: 'RT block 32 -> 16 trials', perSitting: 10, note: 'halves the RT cost', spec: {}, cfg: { RT_TRIALS_PER_CONDITION: 16 } },
  { label: '90s switch + CVS-Q once', perSitting: 10, note: 'NO d-prime cost — the free package', spec: { cvsq: 'none' }, cfg: { ADAPTATION_SWITCH_POLARITY_MS: 90000 } },
  { label: '60s switch + CVS-Q once', perSitting: 10, note: 'NO d-prime cost, at the Fairchild criterion', spec: { cvsq: 'none' }, cfg: { ADAPTATION_SWITCH_POLARITY_MS: 60000 } },
  { label: 'all three CONFIG cuts', perSitting: 10, note: '90s switch + 16 RT + CVS-Q once', spec: { cvsq: 'none' }, cfg: { ADAPTATION_SWITCH_POLARITY_MS: 90000, RT_TRIALS_PER_CONDITION: 16 } },
  { label: 'CONFIG cuts + 5 cond/sitting', perSitting: 5, note: 'best sitting length with full reading', spec: { cvsq: 'none' }, cfg: { ADAPTATION_SWITCH_POLARITY_MS: 90000, RT_TRIALS_PER_CONDITION: 16 } },
];

console.log('='.repeat(112));
console.log('PROTOCOL FRONTIER — what each way of shortening a sitting costs');
console.log('='.repeat(112));
console.log(`  ${N} simulated participants per variant, identical participant stream across variants.`);
console.log(`  Power assumes n=${N_PARTICIPANTS}, true d_z=${TRUE_DZ_MAIN}, between-participant SD of the difference score=${SIGMA_TRUE}.`);
console.log(`  Every participant must accumulate ${RUNS_PER_PARTICIPANT} condition-runs (${N_CONDITIONS} conditions x ${N_ILLUMINATION_BLOCKS} illumination level${N_ILLUMINATION_BLOCKS === 1 ? "" : "s"}).`);
console.log('  "contact" is median sitting length x sittings: the participant\'s total time in the lab.\n');

console.log("  The power columns are the PRIMARY outcome only — the incomplete-blink ratio. They are");
console.log("  blind to what a shorter go/no-go block costs, so d' SE is reported alongside them: it is");
console.log("  the per-participant, per-condition standard error of d-prime at a hit rate of .95 and a");
console.log("  false-alarm rate of .10. A variant that leaves the power columns untouched but raises");
console.log("  d' SE is NOT free — it has moved the cost onto a secondary outcome.\n");
const hdr = [
  'variant'.padEnd(28), 'cond'.padStart(5), 'sitting'.padStart(9), 'p95'.padStart(7),
  'visits'.padStart(7), 'contact'.padStart(9), 'blinks'.padStart(7), 'SE'.padStart(7),
  'pwr main'.padStart(9), 'pwr int'.padStart(8), "d' SE".padStart(7),
].join(' ');
console.log('  ' + hdr);
console.log('  ' + '-'.repeat(hdr.length));

const results = VARIANTS.map(evaluate);
for (const r of results) {
  console.log('  ' + [
    r.v.label.padEnd(28),
    String(r.v.perSitting).padStart(5),
    `${r.medianSitting.toFixed(1)}m`.padStart(9),
    `${r.p95Sitting.toFixed(0)}m`.padStart(7),
    String(r.sittings).padStart(7),
    `${r.totalContact.toFixed(0)}m`.padStart(9),
    r.blinks.toFixed(0).padStart(7),
    r.se.toFixed(3).padStart(7),
    `${(r.powerMain * 100).toFixed(0)}%`.padStart(9),
    `${(r.powerInter * 100).toFixed(0)}%`.padStart(8),
    r.dSe.toFixed(3).padStart(7),
  ].join(' ') + (r.v.note ? `   ${r.v.note}` : ''));
}

// ------------------------------------------------------------------ the fixed overhead wall
console.log('\n' + '='.repeat(112));
console.log('THE FIXED-OVERHEAD WALL — why 20 minutes is not a matter of trimming');
console.log('='.repeat(112));
{
  // Overhead = a sitting with ZERO conditions. Everything left is setup, baselines and close.
  const overheadOf = (spec: Partial<SittingSpec>, first: boolean) => {
    reseed();
    const t: number[] = [];
    for (let k = 0; k < N; k++) {
      const r = simulateSitting(samplePerson(), (k % N_CONDITIONS) + 1, k % 2, undefined, {
        illumination: 'dim', first, dimReadingPenalty: 0, conditionsThisSitting: 0, ...spec,
      });
      t.push(r.total / 60);
    }
    return mean(t);
  };
  const rows: Array<[string, number, number]> = [
    ['as shipped', overheadOf({}, true), overheadOf({}, false)],
    ['CVS-Q end only', overheadOf({ cvsq: 'end-only' }, true), overheadOf({ cvsq: 'end-only' }, false)],
    ['CVS-Q once per participant', overheadOf({ cvsq: 'none' }, true), overheadOf({ cvsq: 'none' }, false)],
  ];
  console.log('  Minutes a sitting costs BEFORE the first condition runs:\n');
  console.log('    ' + 'overhead variant'.padEnd(30) + 'first visit'.padStart(13) + 'repeat visit'.padStart(14));
  for (const [k, a, b] of rows) {
    console.log('    ' + k.padEnd(30) + `${a.toFixed(1)} min`.padStart(13) + `${b.toFixed(1)} min`.padStart(14));
  }
  const shipped = results[0];
  const perCond = (shipped.medianSitting - rows[0][1]) / 10;
  console.log(`\n  Marginal cost of one further condition: ${perCond.toFixed(2)} min.`);
  console.log('  So a sitting costs   T(k) = overhead + ' + perCond.toFixed(2) + ' x k.');
  for (const [k, , repeat] of rows) {
    const kMax = Math.floor((20 - repeat) / perCond);
    console.log(`    with "${k}" overhead (${repeat.toFixed(1)} min on a repeat visit), a 20-minute sitting affords ${kMax < 0 ? 'NO' : kMax} condition${kMax === 1 ? '' : 's'}.`);
  }
  console.log('\n  Read that last block carefully: the overhead alone is the binding constraint, not the');
  console.log('  conditions. Reaching 20 minutes requires cutting what happens AROUND the conditions');
  console.log('  first, and only then how many of them there are.');
}

// ------------------------------------------------------------------ attrition
console.log('\n' + '='.repeat(112));
console.log('ATTRITION — the reason a shorter sitting can cost you MORE participants, not fewer');
console.log('='.repeat(112));
console.log('  A shorter sitting is bought with more visits, and every visit after the first is an');
console.log('  opportunity to not come back. If the per-return dropout probability is q, then a design');
console.log('  requiring v visits retains (1-q)^(v-1) of those who started.');
console.log('');
console.log('  q is NOT measured here — it is a parameter, swept across three values. Substitute a');
console.log('  real figure from your own pilot or from the literature before quoting any of this.');
console.log('');
{
  const Q = [0.05, 0.10, 0.15];
  const seen = new Set<number>();
  const byVisits = results.filter((r) => {
    if (seen.has(r.sittings)) return false;
    seen.add(r.sittings);
    return true;
  }).sort((a, b) => a.sittings - b.sittings);

  const head = '    ' + 'visits'.padStart(7) + 'sitting'.padStart(10) + 'contact'.padStart(9) +
    Q.map((q) => `retained @q=${(q * 100).toFixed(0)}%`.padStart(17)).join('');
  console.log(head);
  console.log('    ' + '-'.repeat(head.length - 4));
  for (const r of byVisits) {
    console.log('    ' + String(r.sittings).padStart(7) +
      `${r.medianSitting.toFixed(0)}m`.padStart(10) +
      `${r.totalContact.toFixed(0)}m`.padStart(9) +
      Q.map((q) => `${((1 - q) ** (r.sittings - 1) * 100).toFixed(0)}%`.padStart(17)).join(''));
  }
  console.log('');
  console.log(`    To ANALYSE n=${N_PARTICIPANTS} you must RECRUIT n / retention:`);
  console.log('    ' + 'visits'.padStart(7) + Q.map((q) => `recruit @q=${(q * 100).toFixed(0)}%`.padStart(17)).join(''));
  for (const r of byVisits) {
    console.log('    ' + String(r.sittings).padStart(7) +
      Q.map((q) => String(Math.ceil(N_PARTICIPANTS / (1 - q) ** (r.sittings - 1))).padStart(17)).join(''));
  }
}

// ------------------------------------------------------------------ the verdict
console.log('\n' + '='.repeat(112));
console.log('WHAT THE TABLE ACTUALLY SAYS');
console.log('='.repeat(112));
console.log(`  1. Cutting CONDITIONS PER SITTING costs no statistical power at all — every variant above`);
console.log(`     holds the same power, because total condition-runs are conserved at ${RUNS_PER_PARTICIPANT} per`);
console.log('     participant however they are packaged. What it costs is VISITS, and therefore total');
console.log('     contact time (which goes UP, because the fixed overhead is paid once per visit) and');
console.log('     retention (which goes DOWN, because every return is a chance to not return).');
console.log('');
console.log('  2. Cutting READING EXPOSURE is the only lever that reduces total contact time, and it is');
console.log('     the only one that costs power. It costs it unevenly: the polarity main effect barely');
console.log('     moves, while the polarity x colour interaction — the contrast the study is actually');
console.log('     about — falls fastest, because it contrasts single conditions instead of averaging.');
console.log('');
console.log('  3. The interaction is ALREADY below the synopsis target at full exposure. That is a');
console.log('     pre-existing problem this table did not create, and it is the reason exposure is the');
console.log('     most expensive thing in the protocol to cut.');
console.log('');
console.log('  4. A 20-minute sitting is not reachable by trimming: the fixed overhead alone exceeds it');
console.log('     on a first visit and nearly exhausts it on a repeat. It becomes reachable only by');
console.log('     moving the CVS-Q out of the sitting AND running 1-2 conditions per visit AND');
console.log('     truncating the passages — which together turn 2 visits of ~93 min into 10 visits of');
console.log('     ~22 min, with MORE total contact time and much worse retention.');
