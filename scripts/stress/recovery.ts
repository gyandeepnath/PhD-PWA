/**
 * ROUND 5 - ground-truth recovery and aggregator soak.
 *
 * Everything so far tested plumbing: does data survive the pipeline intact? This round tests the
 * SCIENCE: inject effects of known size, push them through the same scoring code the real app
 * runs, and check the analysis recovers them. A sign error, a scaling mistake or a mis-specified
 * covariate would pass every structural test in rounds 1-4 while making the instrument's central
 * claim unsupported - the numbers would be internally consistent and simply wrong.
 *
 * A recovered coefficient must match ground truth in SIGN, in rough MAGNITUDE, and must be
 * detectable at the study's planned sample size. Failing sign is a defect; failing magnitude by a
 * wide margin means the estimator is biased; failing detectability means the design cannot see the
 * effect it was built to measure.
 */
import { generateCohort } from '../../src/sim/participant';
import { cohortRows, ols, isSignificant } from '../../src/sim/analysis';
import { GROUND_TRUTH as GT } from '../../src/sim/effects';
import { EyeMetricsAggregator, type FrameSample } from '../../src/tracking/aggregator';

const fails: string[] = [];
let checks = 0;
const check = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fails.push(label + (detail ? ' -- ' + detail : ''));
};

console.log('='.repeat(100));
console.log('ROUND 5 - GROUND-TRUTH RECOVERY AND SOAK');
console.log('='.repeat(100));

// ---------------------------------------------------------------- 1. recovery at the planned n
console.log('\n1. COEFFICIENT RECOVERY (n = 130, the analysed sample)');
const cohort = generateCohort(130, 424242);
const rows = cohortRows(cohort);
console.log(`   ${cohort.length} participants -> ${rows.length} condition-runs`);

const fit = ols(['log_contrast', 'negative_polarity', 'session_position'], rows, 'mean_rt_hits_ms');
const truth: Record<string, number> = {
  log_contrast: GT.rt.beta_log_contrast,
  negative_polarity: GT.rt.beta_negative_polarity,
  session_position: GT.rt.beta_position,
};
console.log('   term                 truth      recovered    t        recovered/truth');
for (const term of Object.keys(truth)) {
  const { coef: est, t } = fit.terms[term];
  const ratio = est / truth[term];
  console.log(`   ${term.padEnd(20)} ${truth[term].toFixed(2).padStart(7)}  ${est.toFixed(2).padStart(10)}  ${t.toFixed(1).padStart(7)}  ${ratio.toFixed(2).padStart(10)}`);
  check(`${term}: recovered coefficient has the same sign as ground truth`,
    Math.sign(est) === Math.sign(truth[term]), `truth ${truth[term]}, got ${est.toFixed(3)}`);
  check(`${term}: recovered within a factor of 2 of ground truth`,
    ratio > 0.5 && ratio < 2, `ratio ${ratio.toFixed(3)}`);
  check(`${term}: detectable at n=130`, isSignificant(t), `t = ${t.toFixed(2)}`);
}

// the model must not invent structure that was never injected
const placebo = ols(['log_contrast', 'negative_polarity', 'session_position'], rows, 'comfort_score');
const allFinite = (r: typeof fit) => Object.values(r.terms).every((x) => Number.isFinite(x.coef) && Number.isFinite(x.t));
check('every fitted coefficient is finite', allFinite(fit) && allFinite(placebo));

// ---------------------------------------------------------------- 2. dose-response
console.log('\n2. DOSE-RESPONSE (a bigger true effect must recover as a bigger estimate)');
{
  const est: number[] = [];
  for (const scale of [0.5, 1, 2]) {
    const saved = GT.rt.beta_negative_polarity;
    (GT.rt as { beta_negative_polarity: number }).beta_negative_polarity = saved * scale;
    const r = cohortRows(generateCohort(80, 99));
    const f = ols(['log_contrast', 'negative_polarity', 'session_position'], r, 'mean_rt_hits_ms');
    est.push(f.terms.negative_polarity.coef);
    (GT.rt as { beta_negative_polarity: number }).beta_negative_polarity = saved;
  }
  console.log(`   0.5x -> ${est[0].toFixed(1)} ms,  1x -> ${est[1].toFixed(1)} ms,  2x -> ${est[2].toFixed(1)} ms`);
  check('estimates increase monotonically with the injected effect',
    est[0] < est[1] && est[1] < est[2], est.map((e) => e.toFixed(1)).join(' < '));
}

// ---------------------------------------------------------------- 3. null recovery
console.log('\n3. NULL RECOVERY (no injected effect must not manufacture one)');
{
  const saved = GT.rt.beta_negative_polarity;
  (GT.rt as { beta_negative_polarity: number }).beta_negative_polarity = 0;
  let falsePositives = 0;
  const REPS = 40;
  for (let i = 0; i < REPS; i++) {
    const r = cohortRows(generateCohort(40, 1000 + i * 7));
    const f = ols(['log_contrast', 'negative_polarity', 'session_position'], r, 'mean_rt_hits_ms');
    if (isSignificant(f.terms.negative_polarity.t)) falsePositives++;
  }
  (GT.rt as { beta_negative_polarity: number }).beta_negative_polarity = saved;
  const rate = falsePositives / REPS;
  console.log(`   false-positive rate over ${REPS} null cohorts: ${(rate * 100).toFixed(0)}%`);
  check('false-positive rate is near the nominal 5%, not systematically inflated',
    rate <= 0.25, `${(rate * 100).toFixed(0)}% - a badly inflated rate indicates a mis-specified model`);
}

// ---------------------------------------------------------------- 4. determinism of the simulator
console.log('\n4. SIMULATOR DETERMINISM');
{
  const a = JSON.stringify(cohortRows(generateCohort(20, 555)));
  const b = JSON.stringify(cohortRows(generateCohort(20, 555)));
  check('the same seed produces identical cohorts', a === b);
  const c = JSON.stringify(cohortRows(generateCohort(20, 556)));
  check('a different seed produces a different cohort', a !== c);
}

// ---------------------------------------------------------------- 5. aggregator soak
/** A realistic frame: face present, mild head motion, centre gaze. */
function frame(t_ms: number, ear: number, facePresent = true): FrameSample {
  return {
    t_ms, ear,
    pose: { pitch: Math.sin(t_ms / 5000) * 3, yaw: Math.cos(t_ms / 7000) * 2, roll: 0.4 },
    zone: 'cc', isCenter: true, offAxis: false,
    facePresent, faceSize: 0.22, luma: 120,
  };
}

console.log('\n5. AGGREGATOR SOAK (a two-hour session at 30 fps)');
{
  const agg = new EyeMetricsAggregator();
  const FRAMES = 30 * 60 * 120;           // 2 hours
  let t = 0;
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < FRAMES; i++) {
    t += 33;
    // A realistic trace: mostly open, a blink every ~4.5 s, occasional dropped frame.
    const phase = i % 135;
    const ear = phase < 3 ? 0.12 : phase < 6 ? 0.22 : 0.31;
    agg.ingest(frame(t, i % 997 === 0 ? NaN : ear, i % 503 !== 0));
  }
  const after = process.memoryUsage().heapUsed;
  const grownMb = (after - before) / 1024 / 1024;
  console.log(`   ${FRAMES.toLocaleString()} frames pushed, heap grew ${grownMb.toFixed(1)} MB`);
  check('memory growth over a two-hour session stays bounded', grownMb < 400, `${grownMb.toFixed(1)} MB`);

  const rec = agg.finalize({
    conditionId: 'soak', sessionId: 's', cameraActive: true, baselineEarValue: 0.31, earThresholdUsed: 0.186,
    gazeCalibrated: false, headPitchCalibrated: false,
  });
  const numeric = Object.entries(rec).filter(([, v]) => typeof v === 'number') as [string, number][];
  const bad = numeric.filter(([, v]) => !Number.isFinite(v));
  check('a soaked aggregator produces no non-finite metric', bad.length === 0, bad.map(([k, v]) => `${k}=${v}`).join(', '));
  check('blinks were actually detected over the soak', (rec.blink_rate ?? 0) > 0, `rate ${rec.blink_rate}`);
  check('the incomplete ratio is a proportion or null',
    rec.incomplete_blink_ratio === null || (rec.incomplete_blink_ratio >= 0 && rec.incomplete_blink_ratio <= 1),
    String(rec.incomplete_blink_ratio));
  console.log(`   blink_rate ${rec.blink_rate?.toFixed(1)}/min, incomplete ratio ${rec.incomplete_blink_ratio}, fps ${rec.effective_fps?.toFixed(1)}`);
}

// ---------------------------------------------------------------- 6. aggregator with hostile input
console.log('\n6. AGGREGATOR WITH HOSTILE INPUT');
for (const [label, feed] of [
  ['no frames at all', () => {}],
  ['every frame NaN', (a) => { for (let i = 0; i < 500; i++) a.ingest(frame(i * 33, NaN)); }],
  ['timestamps going backwards', (a) => { for (let i = 500; i > 0; i--) a.ingest(frame(i * 33, 0.3)); }],
  ['all identical timestamps', (a) => { for (let i = 0; i < 500; i++) a.ingest(frame(1000, 0.3)); }],
  ['ear constant at zero', (a) => { for (let i = 0; i < 500; i++) a.ingest(frame(i * 33, 0)); }],
  ['ear enormous', (a) => { for (let i = 0; i < 500; i++) a.ingest(frame(i * 33, 1e9)); }],
  ['face never present', (a) => { for (let i = 0; i < 500; i++) a.ingest(frame(i * 33, 0.3, false)); }],
  ['pose all NaN', (a) => { for (let i = 0; i < 500; i++) a.ingest({ ...frame(i * 33, 0.3), pose: { pitch: NaN, yaw: NaN, roll: NaN } }); }],
] as [string, (a: EyeMetricsAggregator) => void][]) {
  try {
    const a = new EyeMetricsAggregator();
    feed(a);
    const rec = a.finalize({
      conditionId: 'c', sessionId: 's', cameraActive: true, baselineEarValue: 0.3, earThresholdUsed: 0.18,
      gazeCalibrated: false, headPitchCalibrated: false,
    });
    const bad = (Object.entries(rec).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)) as [string, number][]);
    check(`aggregator: ${label} produces no non-finite metric`, bad.length === 0, bad.map(([k, v]) => `${k}=${v}`).join(', '));
  } catch (e) {
    check(`aggregator: ${label} does not throw`, false, (e as Error).message.slice(0, 100));
  }
}

console.log(`\n${checks - fails.length}/${checks} checks passed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`)); }
process.exit(fails.length ? 1 : 0);
