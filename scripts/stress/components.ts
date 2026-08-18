/**
 * ROUND 6 - the modules rounds 1-5 did not reach, plus a seed sweep.
 *
 * Round 1 fuzzed the analysis path. This round covers what was left: screening, gaze calibration,
 * head pose, lighting, the CVS-Q scorer, timing helpers and the engagement/QC layer. Same standard
 * as before - a function fails if it throws on plausible input, returns a non-finite number, or
 * returns a score outside its own documented range.
 *
 * The seed sweep at the end re-runs the property checks under many independent random streams. A
 * property that holds for one seed and not another is not a property, and catching that requires
 * varying the stream rather than the input.
 */
import * as ISH from '../../src/screening/ishihara';
import * as GC from '../../src/tracking/gazeCalibration';
import * as HP from '../../src/tracking/headPose';
import * as GZ from '../../src/tracking/gaze';
import * as LT from '../../src/tracking/lighting';
import * as CV from '../../src/scales/cvsq';
import * as TM from '../../src/lib/timing';
import { conditionEngagement, baselineFatigueMean, buildConditionSummaries, ENGAGEMENT } from '../../src/dashboard/aggregate';
import { buildFixtureBundle } from '../../src/sim/bundleFixture';
import { buildExportFiles } from '../../src/storage/export';
import { auditBundle } from '../../src/storage/integrity';

const fails: string[] = [];
let checks = 0;
const check = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fails.push(label + (detail ? ' -- ' + detail : ''));
};
const okValue = (v: unknown) =>
  typeof v !== 'number' || Number.isFinite(v);

function probeAll(name: string, out: unknown) {
  if (out !== null && typeof out === 'object') {
    for (const [k, v] of Object.entries(out as Record<string, unknown>)) {
      check(name + '.' + k + ' is finite or non-numeric', okValue(v), k + ' = ' + String(v));
    }
  } else {
    check(name + ' is finite or non-numeric', okValue(out), String(out));
  }
}

const NUMS = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1e308, -1e308, 255, 256, -255, 0.1 + 0.2];
const pt = (x: number, y: number) => ({ x, y });

console.log('='.repeat(100));
console.log('ROUND 6 - REMAINING MODULES AND SEED SWEEP');
console.log('='.repeat(100));

// ---------------------------------------------------------------- screening
console.log('');
console.log('1. ISHIHARA SCREENING');
for (const d of ['0', '5', '8', '', 'x', '88', ' ']) {
  for (const n of [0, 0.5, 1, -1, NaN, Infinity]) {
    try { ISH.isFigurePixel(d, n, n); checks++; }
    catch (e) { check('isFigurePixel(' + JSON.stringify(d) + ', ' + n + ')', false, (e as Error).message.slice(0, 60)); }
  }
}
{
  const plates = (ISH as unknown as { PLATES?: { id: number; digit?: string }[] }).PLATES ?? [];
  const answerSets: Record<number, string>[] = [
    {},
    Object.fromEntries(plates.map((p) => [p.id, 'x'])),
    Object.fromEntries(plates.map((p) => [p.id, p.digit ?? '8'])),
    { 999: '8' },
  ];
  for (const answers of answerSets) {
    try {
      const r = ISH.scoreIshihara(plates as never, answers);
      probeAll('scoreIshihara', r);
      const c = (r as unknown as { correct: number }).correct;
      check('ishihara correct count within 0..plates', c >= 0 && c <= plates.length, c + '/' + plates.length);
    } catch (e) { check('scoreIshihara does not throw', false, (e as Error).message.slice(0, 80)); }
  }
}

// ---------------------------------------------------------------- CVS-Q
console.log('2. CVS-Q SCORER');
for (const f of NUMS) {
  for (const i of NUMS) {
    const v = CV.cvsqItemScore(f, i);
    check('cvsqItemScore(' + f + ', ' + i + ') is 0, 1 or 2', [0, 1, 2].includes(v), String(v));
  }
}
const cvsqCases: [number[], number[]][] = [
  [[], []],
  [Array(16).fill(0), Array(16).fill(0)],
  [Array(16).fill(2), Array(16).fill(2)],
  [Array(16).fill(NaN), Array(16).fill(NaN)],
  [Array(16).fill(-5), Array(16).fill(99)],
  [Array(100).fill(1), Array(3).fill(1)],
];
for (const [freq, int] of cvsqCases) {
  const r = CV.scoreCvsq(freq, int);
  probeAll('scoreCvsq', r);
  const total = (r as unknown as { total: number }).total;
  check('scoreCvsq total within 0..32 (n=' + freq.length + ')', total >= 0 && total <= 32, String(total));
}

// ---------------------------------------------------------------- head pose / gaze / lighting
console.log('3. HEAD POSE, GAZE, LIGHTING');
const landmarkSets = [
  () => [] as { x: number; y: number }[],
  () => Array.from({ length: 500 }, () => pt(0, 0)),
  () => Array.from({ length: 500 }, () => pt(NaN, NaN)),
  () => Array.from({ length: 500 }, (_, i) => pt(i / 500, i / 500)),
  () => Array.from({ length: 500 }, () => pt(1e9, -1e9)),
];
for (const build of landmarkSets) {
  const lm = build();
  // Resolvable means the face has real EXTENT, not merely that landmarks exist: a set of
  // identical points has finite coordinates but no geometry to measure an angle from.
  const resolvable = lm.length >= 500 && Number.isFinite(lm[0]?.x)
    && Math.abs((lm[400]?.x ?? 0) - (lm[0]?.x ?? 0)) > 1e-3;
  try { probeAll('noseVerticalFraction', HP.noseVerticalFraction(lm)); }
  catch (e) { check('noseVerticalFraction does not throw', false, (e as Error).message.slice(0, 60)); }
  for (const base of [null, 0.5, NaN, 0, 1e9]) {
    try {
      const pose = HP.estimateHeadPose(lm, base);
      // Contract: an unresolvable frame reports ALL THREE components as non-finite together, so
      // the aggregator drops a coherent "no pose this frame" rather than a partial mixture that
      // would silently bias the pose summary toward whichever axis happened to survive.
      const finite = [pose.pitch, pose.yaw, pose.roll].map((v) => Number.isFinite(v));
      check('estimateHeadPose resolves all three axes or none',
        finite.every((x) => x === finite[0]), JSON.stringify(pose));
      if (resolvable) {
        check('estimateHeadPose resolves a complete landmark set', finite.every(Boolean), JSON.stringify(pose));
      }
    } catch (e) { check('estimateHeadPose(base=' + base + ') does not throw', false, (e as Error).message.slice(0, 60)); }
  }
  try {
    const g = GZ.estimateGaze(lm, null);
    const finite = [g.h, g.v].map((v) => Number.isFinite(v));
    check('estimateGaze resolves both axes or neither', finite[0] === finite[1], JSON.stringify(g));
  } catch (e) { check('estimateGaze does not throw', false, (e as Error).message.slice(0, 60)); }
}
for (const n of NUMS) {
  const luma = LT.pixelLuma(n, n, n);
  check('pixelLuma is finite when its input is', Number.isFinite(luma) || !Number.isFinite(n), String(luma));
  try { LT.classifyLighting(n); checks++; }
  catch (e) { check('classifyLighting(' + n + ')', false, (e as Error).message.slice(0, 60)); }
}
for (const len of [0, 4, 400, 4001]) {
  const v = LT.meanLumaFromRGBA(new Uint8ClampedArray(len));
  check('meanLumaFromRGBA(len=' + len + ') is finite', Number.isFinite(v), String(v));
}

// ---------------------------------------------------------------- gaze calibration
console.log('4. GAZE CALIBRATION');
const zones = ['tl', 'tc', 'tr', 'ml', 'cc', 'mr', 'bl', 'bc', 'br'];
const calCases: Record<string, { h: number; v: number }[]>[] = [
  {},
  { tl: [] },
  { tl: [{ h: NaN, v: NaN }], cc: [{ h: 0, v: 0 }] },
  { cc: Array.from({ length: 50 }, () => ({ h: 0, v: 0 })) },
  Object.fromEntries(zones.map((k, i) => [k, Array.from({ length: 20 }, () => ({ h: (i % 3) - 1, v: Math.floor(i / 3) - 1 }))])),
  { cc: [{ h: 1e9, v: -1e9 }] },
];
for (const raw of calCases) {
  try { probeAll('fitGazeCalibration', GC.fitGazeCalibration(raw as never)); }
  catch (e) { check('fitGazeCalibration does not throw', false, (e as Error).message.slice(0, 80)); }
}

// ---------------------------------------------------------------- timing
console.log('5. TIMING HELPERS');
for (const lo of [0, -5, NaN, 1e9]) {
  for (const hi of [0, 5, -5, NaN, 1e9]) {
    const v = TM.randInt(() => 0.5, lo, hi);
    check('randInt(' + lo + ', ' + hi + ') is an integer', Number.isInteger(v), String(v));
  }
}
for (const r of [() => 0, () => 0.999999, () => 1, () => -1, () => NaN]) {
  const v = TM.randInt(r, 1, 10);
  check('randInt stays within bounds for a hostile rng', Number.isInteger(v) && v >= 1 && v <= 10, String(v));
}
check('elapsed is non-negative for a past timestamp', TM.elapsed(TM.now() - 100) >= 0);

// ---------------------------------------------------------------- engagement / QC
console.log('6. ENGAGEMENT AND QC SCORING');
const engArgs: Parameters<typeof conditionEngagement>[0][] = [
  {},
  { reading_time_ms: 0, word_count: 0 },
  { reading_time_ms: NaN, word_count: NaN },
  { reading_time_ms: -1, word_count: -1 },
  { reading_time_ms: 1e12, word_count: 1 },
];
for (const args of engArgs) {
  try {
    const r = conditionEngagement(args);
    check('quality_score within 0..1', r.quality_score >= 0 && r.quality_score <= 1, String(r.quality_score));
    check('engagement flag is one of the three', ['good', 'warn', 'bad'].includes(r.engagement), r.engagement);
    check('reasons is an array', Array.isArray(r.reasons));
  } catch (e) { check('conditionEngagement does not throw', false, (e as Error).message.slice(0, 80)); }
}
check('MIN_BLINKS_FOR_RATIO is a positive integer',
  Number.isInteger(ENGAGEMENT.MIN_BLINKS_FOR_RATIO) && ENGAGEMENT.MIN_BLINKS_FOR_RATIO > 0);
{
  const b = buildFixtureBundle();
  b.fatigue = [];
  check('baselineFatigueMean is null when no baseline exists', baselineFatigueMean(b) === null);
  const sums = buildConditionSummaries(b);
  check('summaries survive a missing baseline', sums.length === b.conditions.length);
  for (const s of sums) probeAll('summary', s as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------- seed sweep
console.log('7. SEED SWEEP (40 independent random streams)');
{
  let seedFails = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let s = seed * 7919;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const shuffle = <T>(xs: T[]): T[] => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const b = buildFixtureBundle();
    let damaged = false;
    if (rnd() < 0.4) b.eyeMetrics = shuffle(b.eyeMetrics);
    if (rnd() < 0.4) b.conditions = shuffle(b.conditions);
    if (rnd() < 0.3) { b.perception.push({ ...b.perception[0] }); damaged = true; }
    if (rnd() < 0.3) { b.conditions[2] = { ...b.conditions[2], session_position: b.conditions[1].session_position }; damaged = true; }
    if (rnd() < 0.3) { b.cvsq = []; }

    let files;
    try { files = buildExportFiles(b); }
    catch (e) { seedFails++; check('seed ' + seed + ' exports without throwing', false, (e as Error).message.slice(0, 80)); continue; }

    const m = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    checks += 3;
    if (m.integrity.joins_sound !== !damaged) { seedFails++; fails.push('seed ' + seed + ': integrity verdict does not match the damage applied'); }
    if (m.non_finite_cells !== 0) { seedFails++; fails.push('seed ' + seed + ': non_finite_cells = ' + m.non_finite_cells); }
    const direct = auditBundle(b);
    if (direct.joins_sound !== m.integrity.joins_sound) { seedFails++; fails.push('seed ' + seed + ': audit and manifest disagree'); }
  }
  check('all 40 seeds behave identically under the same properties', seedFails === 0, seedFails + ' seed failures');
}

console.log('');
console.log((checks - fails.length) + '/' + checks + ' checks passed');
if (fails.length) {
  console.log('');
  console.log('FAILURES:');
  const seen = new Set<string>();
  for (const f of fails) {
    const k = f.split('--')[0].replace(/-?\d+(\.\d+)?/g, 'N');
    if (seen.has(k)) continue;
    seen.add(k);
    console.log('  ' + f);
    if (seen.size >= 20) break;
  }
}
process.exit(fails.length ? 1 : 0);
