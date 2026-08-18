/**
 * ROUND 3 - state machine, counterbalancing and storage-concurrency stress.
 *
 * Rounds 1 and 2 attacked data. This round attacks CONTROL FLOW: the stage machine driving a
 * session, the counterbalancing that must stay balanced across a whole cohort, and the storage
 * layer under concurrent and interrupted writes. These are where a real study loses data - a
 * tablet backgrounded mid-condition, a double-tap creating two sessions, a resume rebuilding the
 * wrong plan.
 */
import { initialState, nextState, progressPercent, shouldBreakAfter, TOTAL_TRACKED_STEPS } from '../../src/experiment/stateMachine';
import { conditionOrderFor, blockPlan, passageForCondition } from '../../src/experiment/counterbalance';
import { illuminationOrderFor, illuminationForBlock, N_ILLUMINATION_BLOCKS } from '../../src/experiment/illumination';
import { N_CONDITIONS } from '../../src/experiment/conditions';
import { N_PASSAGES } from '../../src/experiment/passages';
import { put, get, getAll, nextEnrolmentNumber, peekNextEnrolmentNumber, _resetForTests } from '../../src/storage/db';
import type { Stage } from '../../src/storage/types';

const fails: string[] = [];
let checks = 0;
const check = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fails.push(label + (detail ? ' -- ' + detail : ''));
};

console.log('='.repeat(100));
console.log('ROUND 3 - STATE MACHINE, COUNTERBALANCING AND STORAGE');
console.log('='.repeat(100));

// ---------------------------------------------------------------- 1. stage machine termination
console.log('\n1. STAGE MACHINE');
for (const n of [1, 2, 3, 5, 9, 10, 0, -1, 1.5, NaN]) {
  let s = initialState();
  const seen: string[] = [];
  let guard = 0;
  let terminated = false;
  while (guard++ < 5000) {
    seen.push(s.stage);
    if (s.stage === 'EXPORT_DASHBOARD') { terminated = true; break; }
    const next = nextState(s, n as number);
    // A machine that returns its own state forever is a hang, not a loop we can detect by count.
    if (next.stage === s.stage && next.stepIndex === s.stepIndex) {
      check(`nConditions=${n} does not self-loop at ${s.stage}`, false, 'state repeated identically');
      break;
    }
    s = next;
  }
  check(`nConditions=${n} terminates`, terminated, `visited ${seen.length} stages`);
  const readings = seen.filter((x) => x === 'READING_TASK').length;
  const expected = Number.isFinite(n as number) && (n as number) >= 1 ? Math.floor(n as number) : null;
  if (expected != null) {
    check(`nConditions=${n} runs exactly ${expected} reading task(s)`, readings === expected, `got ${readings}`);
  }
}

// progress must be monotone and bounded for every path
for (const n of [1, 5, 10]) {
  let s = initialState();
  let prev = -1;
  let guard = 0;
  let ok = true;
  while (guard++ < 5000 && s.stage !== 'EXPORT_DASHBOARD') {
    const p = progressPercent(s, n);
    if (!Number.isFinite(p) || p < 0 || p > 100 || p < prev) { ok = false; break; }
    prev = p;
    s = nextState(s, n);
  }
  check(`progress monotone and within 0-100 for n=${n}`, ok);
}
check('TOTAL_TRACKED_STEPS is a positive integer', Number.isInteger(TOTAL_TRACKED_STEPS) && TOTAL_TRACKED_STEPS > 0);

// a break is never offered after the final condition of a sitting
for (let n = 1; n <= 20; n++) {
  check(`no break after the last of ${n}`, shouldBreakAfter(n, n) === false);
}

// unknown stages must not crash the machine
for (const bogus of ['', 'NOPE', '__proto__', 'READING_TASK ']) {
  try {
    nextState({ stage: bogus as Stage, stepIndex: 0 }, N_CONDITIONS);
    checks++;
  } catch (e) {
    check(`unknown stage ${JSON.stringify(bogus)} does not throw`, false, (e as Error).message.slice(0, 80));
  }
}

// ---------------------------------------------------------------- 2. cohort-wide balance
console.log('2. COUNTERBALANCING ACROSS A FULL COHORT');
const COHORT = 130;   // the study's analysed sample
for (let block = 0; block < N_ILLUMINATION_BLOCKS; block++) {
  const posCount = Array.from({ length: N_CONDITIONS }, () => Array.from({ length: N_CONDITIONS }, () => 0));
  for (let e = 1; e <= COHORT; e++) {
    const plan = blockPlan(e, block);
    check(`enrol ${e} block ${block} has ${N_CONDITIONS} steps`, plan.length === N_CONDITIONS);
    const ids = new Set(plan.map((p) => p.conditionIndex));
    check(`enrol ${e} block ${block} covers every condition once`, ids.size === N_CONDITIONS);
    const ps = new Set(plan.map((p) => p.passageIndex));
    check(`enrol ${e} block ${block} covers every passage once`, ps.size === N_PASSAGES);
    plan.forEach((p, pos) => { posCount[p.conditionIndex][pos]++; });
  }
  // Over 130 participants each condition should appear at each position 13 times.
  const expect = COHORT / N_CONDITIONS;
  let balanced = true;
  for (const row of posCount) for (const c of row) if (c !== expect) balanced = false;
  check(`block ${block}: every condition appears at every position exactly ${expect}x over ${COHORT}`, balanced);
}

// illumination order must split evenly and be orthogonal to the Williams row
let dimFirst = 0;
const rowOrders = new Map<number, Set<string>>();
for (let e = 1; e <= COHORT; e++) {
  const order = illuminationOrderFor(e);
  if (order[0] === 'dim') dimFirst++;
  const row = (e - 1) % N_CONDITIONS;
  if (!rowOrders.has(row)) rowOrders.set(row, new Set());
  rowOrders.get(row)!.add(order[0]);
  for (let b = 0; b < N_ILLUMINATION_BLOCKS; b++) {
    check(`enrol ${e} block ${b} level matches its order`, illuminationForBlock(e, b) === order[b]);
  }
}
check(`illumination order splits evenly over ${COHORT}`, Math.abs(dimFirst - COHORT / 2) <= 1, `dim-first = ${dimFirst}`);
let orthogonal = true;
for (const s of rowOrders.values()) if (s.size !== N_ILLUMINATION_BLOCKS) orthogonal = false;
check('every Williams row meets both illumination orders', orthogonal);

// a participant must never read the same passage under the same condition twice
for (let e = 1; e <= 40; e++) {
  const a = blockPlan(e, 0);
  const b = blockPlan(e, 1);
  let repeat = false;
  for (const s0 of a) {
    const s1 = b.find((x) => x.conditionIndex === s0.conditionIndex);
    if (s1 && s1.passageIndex === s0.passageIndex) repeat = true;
  }
  check(`enrol ${e}: no condition-passage pair repeats across blocks`, !repeat);
}

// passage index must always be in range, for any input
for (const e of [1, 130, 0, -5, 1e9, NaN, 1.7]) {
  for (const c of [0, 9, -1, 99, NaN]) {
    const p = passageForCondition(c, e as number);
    check(`passageForCondition(${c}, ${e}) in range`, Number.isInteger(p) && p >= 0 && p < N_PASSAGES, `got ${p}`);
  }
}

// ---------------------------------------------------------------- 3. storage under stress
console.log('3. STORAGE LAYER');
async function storage() {
  _resetForTests();

  // enrolment numbers must be dense and unique even when requested concurrently
  const concurrent = await Promise.all(Array.from({ length: 200 }, () => nextEnrolmentNumber()));
  const uniq = new Set(concurrent);
  check('200 concurrent enrolment allocations are unique', uniq.size === 200, `got ${uniq.size}`);
  check('enrolment sequence is dense 1..200', Math.min(...concurrent) === 1 && Math.max(...concurrent) === 200);

  // peek must never consume
  const before = await peekNextEnrolmentNumber();
  for (let i = 0; i < 50; i++) await peekNextEnrolmentNumber();
  const after = await peekNextEnrolmentNumber();
  check('peekNextEnrolmentNumber does not consume', before === after, `${before} -> ${after}`);
  const allocated = await nextEnrolmentNumber();
  check('peek predicts the next allocation', allocated === before, `peeked ${before}, allocated ${allocated}`);

  // repeated writes to the same key must not multiply rows
  _resetForTests();
  const rec = { calibration_id: 'c1', session_id: 's1', is_real_calibration: true, targets_detected: 9,
    targets_total: 9, ear_baseline: 0.3, gaze_h_threshold: null, gaze_v_threshold: null, pitch_baseline_frac: null };
  await Promise.all(Array.from({ length: 100 }, () => put('calibration_data', rec)));
  const all = await getAll('calibration_data');
  check('100 concurrent puts to one key leave exactly one row', all.length === 1, `got ${all.length}`);

  // a read of a missing key resolves to undefined rather than throwing
  const missing = await get('sessions', 'does-not-exist');
  check('missing key resolves to undefined', missing === undefined);
}

storage().then(() => {
  console.log(`\n${checks - fails.length}/${checks} checks passed`);
  if (fails.length) {
    console.log('\nFAILURES:');
    const seen = new Set<string>();
    for (const f of fails) {
      const key = f.split('--')[0].replace(/\d+/g, 'N');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log('  ' + f);
      if (seen.size > 25) { console.log(`  ... ${fails.length - 25} more`); break; }
    }
  }
  process.exit(fails.length ? 1 : 0);
});
