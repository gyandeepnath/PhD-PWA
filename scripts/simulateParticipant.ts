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
import { CONDITIONS, N_CONDITIONS } from '../src/experiment/conditions';
import { PASSAGES, QUESTIONS_PER_PASSAGE } from '../src/experiment/passages';
import { blockPlan } from '../src/experiment/counterbalance';

const N = Number(process.argv[process.argv.indexOf('--n') + 1]) || 2000;

// ---------------------------------------------------------------- rng
let seed = 20260817;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function gauss(mean: number, sd: number): number {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const S = 1000;

// ---------------------------------------------------------------- population model
interface Person {
  /** Words per minute on dense expository prose, read for comprehension. */
  wpm: number;
  /** Deliberation multiplier: scales every self-paced rating/questionnaire step. */
  care: number;
  /** Break-taking multiplier. */
  restiness: number;
  /** Blinks per minute while reading. */
  blinkRate: number;
  /** Baseline proportion of blinks that fail to close fully. */
  incompleteP: number;
}
function samplePerson(): Person {
  return {
    wpm: clamp(gauss(215, 45), 90, 400),
    care: clamp(gauss(1.0, 0.28), 0.5, 2.4),
    restiness: clamp(gauss(1.0, 0.5), 0.2, 3.5),
    blinkRate: clamp(gauss(13, 4), 4, 28),
    incompleteP: clamp(gauss(0.16, 0.11), 0.01, 0.6),
  };
}

// ---------------------------------------------------------------- per-step models (seconds)
/** Mean seconds the RT block takes, from the real trial-structure constants. */
function rtBlockSeconds(nTrials: number, meanRtMs = 360): number {
  const fix = (CONFIG.RT_FIXATION_MIN_MS + CONFIG.RT_FIXATION_MAX_MS) / 2;
  const del = (CONFIG.RT_DELAY_MIN_MS + CONFIG.RT_DELAY_MAX_MS) / 2;
  const iti = (CONFIG.RT_ITI_MIN_MS + CONFIG.RT_ITI_MAX_MS) / 2;
  const nGo = Math.round(nTrials * CONFIG.RT_GO_RATE);
  const nNo = nTrials - nGo;
  // A go trial ends on response; a no-go trial waits the whole response window out.
  const go = fix + del + meanRtMs + iti;
  const no = fix + del + CONFIG.RT_RESPONSE_WINDOW_MS + iti;
  return (nGo * go + nNo * no) / S;
}

interface Breakdown { [k: string]: number }

function simulateSitting(p: Person, enrolment: number, block: number, cfg = CONFIG) {
  const plan = blockPlan(enrolment, block);
  const b: Breakdown = {};
  const add = (k: string, v: number) => { b[k] = (b[k] ?? 0) + v; };

  // ---- setup chain (10 stages before the first condition)
  add('session_init (researcher)', gauss(110, 30) / 1);
  add('consent', gauss(170, 50) * p.care);
  add('participant_profile', gauss(115, 30) * p.care);
  add('preflight_checklist', gauss(55, 15));
  add('colour_vision (5 plates)', gauss(80, 20) * p.care);
  add('camera_setup', gauss(90, 30));
  add('calibration (9-pt + EAR + pitch)', gauss(150, 40));
  // CVS-Q: 16 items, each a frequency choice plus a conditional intensity choice.
  add('cvsq_baseline (16 items)', 16 * gauss(13, 3) * p.care / 1);
  add('baseline_fatigue (5 sliders)', 5 * gauss(3.4, 1) * p.care);
  add('instructions', gauss(55, 18) * p.care);

  // ---- per-condition loop
  let polaritySwitches = 0;
  let totalBlinks = 0;
  for (let i = 0; i < plan.length; i++) {
    const cond = CONDITIONS[plan[i].conditionIndex];
    const prev = i > 0 ? CONDITIONS[plan[i - 1].conditionIndex] : null;
    const switched = prev != null && prev.polarity !== cond.polarity;
    if (switched) polaritySwitches++;

    // Adaptation: none before the first condition; doubled on a polarity switch.
    if (i > 0) {
      add('adaptation', (switched ? cfg.ADAPTATION_SWITCH_POLARITY_MS : cfg.ADAPTATION_SAME_POLARITY_MS) / S);
    }

    // Reading: self-paced above a per-page floor.
    const words = PASSAGES[plan[i].passageIndex].wordCount;
    const pages = PASSAGES[plan[i].passageIndex].pages.length;
    // Low-contrast conditions slow reading a little; this is the effect under study, so keep it modest.
    const contrastPenalty = cond.below_wcag_aa ? 1.08 : 1.0;
    const natural = (words / p.wpm) * 60 * contrastPenalty * gauss(1, 0.08);
    const floor = (pages * cfg.READING_PAGE_MIN_MS) / S;
    const readSec = Math.max(floor, natural);
    add('reading', readSec);
    totalBlinks += (readSec / 60) * p.blinkRate;

    // One entry per comprehension ITEM. Each is a separate screen with its own read-and-answer
    // and its own feedback dwell, so the cost scales with the item count. Charging one item here
    // while the instrument administers three understated every published feasibility figure.
    add(`comprehension (${QUESTIONS_PER_PASSAGE} items)`,
      QUESTIONS_PER_PASSAGE * ((gauss(14, 5) * p.care) + cfg.COMPREHENSION_FEEDBACK_MS / S));
    add('display_perception (2 sliders)', 2 * gauss(4.2, 1.2) * p.care);
    add('fatigue_vas (5 sliders)', 5 * gauss(3.2, 0.9) * p.care);

    // Visual search: bounded by the hard limit; careful searchers use more of the window.
    add('visual_search', Math.min(cfg.VS_TIME_LIMIT_MS / S, gauss(30, 8) * p.care));

    // RT: an instruction screen each time, plus the block itself, plus one practice block overall.
    add('rt_instructions', gauss(9, 3) * p.care);
    add('rt_block', rtBlockSeconds(cfg.RT_TRIALS_PER_CONDITION));
    if (i === 0 && cfg.RT_PRACTICE_TRIALS > 0) {
      add('rt_practice (once)', rtBlockSeconds(cfg.RT_PRACTICE_TRIALS) + cfg.RT_PRACTICE_TRIALS * 1.2);
    }

    // Self-paced break after every N conditions, never after the last of the sitting.
    const done = i + 1;
    if (cfg.BREAK_EVERY_N_CONDITIONS > 0 && done % cfg.BREAK_EVERY_N_CONDITIONS === 0 && done < plan.length) {
      add('breaks', clamp(gauss(45, 25) * p.restiness, 8, 300));
    }
  }

  // ---- close
  add('cvsq_end (16 items)', 16 * gauss(11, 3) * p.care);
  add('nasa_tlx (6 sliders)', 6 * gauss(6.5, 2) * p.care + gauss(20, 6) * p.care);
  add('session_complete', gauss(35, 12));

  const total = Object.values(b).reduce((s, v) => s + v, 0);
  return { breakdown: b, total, polaritySwitches, blinksPerCondition: totalBlinks / plan.length };
}

// ---------------------------------------------------------------- run
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, c) => a - c);
  return s[clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1)];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function run(cfg: typeof CONFIG, label: string) {
  const totals: number[] = [];
  const switches: number[] = [];
  const blinks: number[] = [];
  const agg: Breakdown = {};
  for (let k = 0; k < N; k++) {
    const p = samplePerson();
    const r = simulateSitting(p, (k % N_CONDITIONS) + 1, k % 2, cfg);
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
function seOfRatio(blinks: number, p = 0.16): number {
  return Math.sqrt((p * (1 - p)) / blinks);
}
/** Power of a two-sided one-sample t-test at alpha=.05, via a normal approximation to the t. */
function powerT(n: number, dz: number): number {
  if (dz <= 0) return 0.05;
  const ncp = dz * Math.sqrt(n);
  const crit = 1.96 + 1.5 / n; // small-sample nudge toward the t critical value
  const z = ncp - crit;
  // standard normal CDF
  const cdf = (x: number) => 0.5 * (1 + Math.sign(x) * Math.sqrt(1 - Math.exp((-2 / Math.PI) * x * x)));
  return cdf(z);
}

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
const SIGMA_TRUE = 0.10;   // between-participant SD of the true within-participant difference
const N_ANALYSED = 130;
console.log(`Assumes a between-participant SD of the true difference score of ${SIGMA_TRUE}, n = ${N_ANALYSED}.`);
console.log('');
console.log('  reading    blinks   SE per      MAIN EFFECT (5v5)          INTERACTION (1v1)');
console.log('  exposure   /cond    condition   d_z obs   power           d_z obs   power');
console.log('  ' + '-'.repeat(88));
const EXPOSURES = [...new Set([73, 120, SHIPPED_SEC, 240, 300])].sort((a, b) => a - b);
for (const sec of EXPOSURES) {
  const blinks = (sec / 60) * 13;
  const se = seOfRatio(blinks);
  // main effect: mean of 5 conditions each side, difference of two means
  const seMain = se / Math.sqrt(5) * Math.SQRT2;
  // interaction: a difference of differences over 4 single conditions
  const seInter = se * 2;
  const att = (sm: number) => Math.sqrt(SIGMA_TRUE ** 2 / (SIGMA_TRUE ** 2 + sm ** 2));
  const dzMain = 0.30 * att(seMain);
  const dzInter = 0.25 * att(seInter);
  const flag = sec === SHIPPED_SEC ? '  <- as shipped' : sec === 73 ? '  <- the corpus before it was rebuilt' : '';
  console.log(`  ${String(sec).padStart(4)}s     ${blinks.toFixed(0).padStart(5)}    ${se.toFixed(3)}       ` +
    `${dzMain.toFixed(3)}   ${(powerT(N_ANALYSED, dzMain) * 100).toFixed(0).padStart(3)}%            ` +
    `${dzInter.toFixed(3)}   ${(powerT(N_ANALYSED, dzInter) * 100).toFixed(0).padStart(3)}%${flag}`);
}
console.log('');
console.log('  Target from the synopsis: 92% for the main effect, 81% for the interaction at n=130.');
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
