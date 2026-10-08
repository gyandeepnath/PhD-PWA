/**
 * The frame-rate simulation (Round 79): `npm run sim:fps` (optionally `-- <runs per cell>`; default 150).
 *
 * Runs the shipped blink classifier on simulated blinks of known depth (src/sim/fpsGate.ts) and prints
 * the tables summarised in docs/FPS_GATE_SIMULATION.md, then applies the three decision rules that set
 * gate fps-g2 (R2 §A3, round 78, written before this script):
 *
 *   C1 (floor)       the lowest frame rate at which detection is >= 0.98 in every decision scenario is
 *                    "adequate"; the lowest at which it is >= 0.95 is "reduced";
 *   C2 (accuracy)    at that floor, agreement with the true class (kappa) is no more than 0.05 below
 *                    its value at 30 fps, in every decision scenario;
 *   C3 (consistency) the largest whole number of fps by which a participant's conditions may differ
 *                    while the worst-case shift of the ratio stays within 25% of the planned 3-point
 *                    effect (0.75 points): band = floor(0.75 / worst slope in points per fps, 20-30 fps).
 *
 * THE DECISION SCENARIOS are the four R2 fixed before this simulation existed: the low-light case the
 * gate is for (each frame exposed for the whole frame interval), the smooth (raised-cosine) lid at 2%,
 * 3% and 4% per-frame landmark noise, and the V-shaped (linear) lid — a lid that reverses at full speed,
 * the shape least favourable to sampling — at 3%. The other 14 scenarios of the grid (instantaneous and
 * 30-ms exposures; the V-shape at 2% and 4%) are a robustness check: the same rules are applied to all
 * 18 and printed beside, and docs/FPS_GATE_SIMULATION.md says what differs and why.
 *
 * It then compares the lowest-frame rule with the fitted minimum (src/tracking/blinkFit.ts). MODEL, not
 * evidence: every input that is not Nakamura et al. (2008)'s mean phase durations is an assumption,
 * listed in src/sim/fpsGate.ts. Deterministic: the same seed and the same code give the same numbers.
 */
import {
  runScenario, ratio, kappa, misclassified, pairedDiff, flipRate, slope, exposureOf, detectionByDepth,
  type Cell, type Plan, type Scenario, type ScenarioResult, type Shape,
} from '../src/sim/fpsGate';

const RUNS = Number(process.argv[2] ?? 150);
const SEED = 20261008;
const PLANNED_EFFECT_PP = 3;
const pp = (x: number) => (x * 100).toFixed(2);
const f3 = (x: number) => x.toFixed(3);
const signed = (x: number, d = 3) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;

const FPS = [15, 18, 20, 22, 24, 25, 26, 30, 60];
const SLOPE_FPS = [20, 22, 24, 25, 26, 30];
const SHAPES: Shape[] = ['cosine', 'linear'];
const EXPOSURES: Array<{ name: string; e: number | 'frame' }> = [
  { name: 'whole frame', e: 'frame' }, { name: 'instant', e: 0 }, { name: '30 ms fixed', e: 30 },
];
const SIGMAS = [0.02, 0.03, 0.04];
/** R2's scenarios (see the header). */
const isDecision = (shape: Shape, exposure: string, sigma: number) =>
  exposure === 'whole frame' && (shape === 'cosine' || sigma === 0.03);

const t0 = Date.now();
let seedN = 0;
const nextSeed = () => SEED + 1000 * ++seedN;

console.log('# Frame-rate simulation output');
console.log(`\nRuns per cell ${RUNS}; base seed ${SEED}; each run a 180-s reading window (about 27 blinks).\n`);

// ---- A. The gate grid: lowest-frame rule only ------------------------------------------------------
interface GridRow { shape: Shape; exposure: string; sigma: number; decision: boolean; res: ScenarioResult }
const grid: GridRow[] = [];
for (const shape of SHAPES) for (const ex of EXPOSURES) for (const sigma of SIGMAS) {
  const cells: Cell[] = FPS.map((fps) => ({ label: String(fps), plan: { kind: 'regular', fps, exposureMs: ex.e } as Plan }));
  const sc: Scenario = { name: `${shape}, exposure ${ex.name}, noise ${Math.round(sigma * 100)}%`, shape, sigma, runs: RUNS, seed: nextSeed() };
  grid.push({ shape, exposure: ex.name, sigma, decision: isDecision(shape, ex.name, sigma), res: runScenario(sc, cells) });
}
const decisionSet = grid.filter((g) => g.decision);

const det = (r: ScenarioResult, f: number) => r.cells[String(f)].detection;
const kap = (r: ScenarioResult, f: number) => kappa(r.cells[String(f)].cls, r.truth);
const dRef = (r: ScenarioResult, f: number) => pairedDiff(r.cells[String(f)].cls, r.cells['60'].cls);
const minMax = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];

function summaryTable(rows: GridRow[]) {
  console.log('| fps | detection (lowest) | kappa vs truth | kappa minus kappa at 30 (lowest) | ratio shift vs 60 fps, points | paired SE, points | misclassified within 0.05 of the cut | misclassified further away |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const f of FPS) {
    const d = rows.map((g) => det(g.res, f));
    const k = rows.map((g) => kap(g.res, f));
    const dk = rows.map((g) => kap(g.res, f) - kap(g.res, 30));
    const dr = rows.map((g) => dRef(g.res, f));
    const near = rows.map((g) => flipRate(g.res.cells[String(f)].cls, g.res.truth, g.res.depth, true));
    const far = rows.map((g) => flipRate(g.res.cells[String(f)].cls, g.res.truth, g.res.depth, false));
    const [k0, k1] = minMax(k), [r0, r1] = minMax(dr.map((x) => x.diff)), [s0, s1] = minMax(dr.map((x) => x.se));
    const [n0, n1] = minMax(near), [fa0, fa1] = minMax(far);
    console.log(`| ${f} | ${f3(Math.min(...d))} | ${f3(k0)}–${f3(k1)} | ${f === 30 ? '—' : signed(Math.min(...dk))} | ${f === 60 ? '—' : `${pp(r0)} to ${pp(r1)}`} | ${f === 60 ? '—' : `${pp(s0)}–${pp(s1)}`} | ${pp(n0)}–${pp(n1)}% | ${pp(fa0)}–${pp(fa1)}% |`);
  }
}

console.log('## A. The gate grid — the shipped lowest-frame rule (blink-r1)\n');
console.log(`${grid.length} scenarios: lid profile {cosine, linear} x exposure {whole frame interval, instant, 30 ms fixed} x per-frame noise {2%, 3%, 4%}.\n`);
console.log(`### A1. The ${decisionSet.length} decision scenarios (R2): ranges over them\n`);
summaryTable(decisionSet);
console.log(`\n### A2. All ${grid.length} scenarios: ranges over them\n`);
summaryTable(grid);

console.log('\n### A3. Each scenario at 15, 20, 24 and 30 fps: detection / kappa (D = decision scenario)\n');
console.log('| scenario | 15 | 20 | 24 | 30 | 60 |');
console.log('|---|---|---|---|---|---|');
for (const g of grid) {
  console.log(`| ${g.decision ? 'D ' : ''}${g.res.name} | ${[15, 20, 24, 30, 60].map((f) => `${f3(det(g.res, f))} / ${f3(kap(g.res, f))}`).join(' | ')} |`);
}

// Slopes, 20-30 fps.
const slopes = grid.map((g) => ({ g, s: slope(SLOPE_FPS, SLOPE_FPS.map((f) => 100 * dRef(g.res, f).diff)) }));
console.log('\n### A4. Ratio shift per fps between 20 and 30 fps\n');
console.log('Least-squares slope of the shift vs 60 fps over 20, 22, 24, 25, 26 and 30 fps; negative = the ratio falls as the rate rises.\n');
console.log('| scenario | slope, points per fps |');
console.log('|---|---|');
for (const { g, s } of slopes) console.log(`| ${g.decision ? 'D ' : ''}${g.res.name} | ${s.toFixed(3)} |`);

// Where detection falls short: by the blink's true depth, in the scenario with the lowest detection at 20 fps.
const worstDet = grid.reduce((a, b) => (det(b.res, 20) < det(a.res, 20) ? b : a));
console.log(`\n### A5. Which blinks are missed — by true depth, in the scenario with the lowest detection at 20 fps (${worstDet.res.name})\n`);
const BANDS: Array<[number, number]> = [[0, 0.6], [0.6, 0.7], [0.7, 0.72], [0.72, 0.74], [0.74, 0.75]];
console.log(`| fps | all | ${BANDS.map(([a, b]) => `depth ${a.toFixed(2)}–${b.toFixed(2)}`).join(' | ')} |`);
console.log(`|---|---|${BANDS.map(() => '---').join('|')}|`);
for (const f of [15, 20, 24, 30, 60]) {
  const by = detectionByDepth(worstDet.res, String(f), BANDS);
  console.log(`| ${f} | ${f3(det(worstDet.res, f))} | ${by.map((x) => `${f3(x.detection)} (n ${x.n})`).join(' | ')} |`);
}

// ---- Decision rules -----------------------------------------------------------------------------------
function decide(rows: GridRow[]) {
  const lowestWhere = (ok: (f: number) => boolean) => {
    let floor: number | null = null;
    for (const f of [...FPS].sort((a, b) => b - a)) { if (ok(f)) floor = f; else break; }
    return floor;
  };
  const adequate = lowestWhere((f) => rows.every((g) => det(g.res, f) >= 0.98));
  const reduced = lowestWhere((f) => rows.every((g) => det(g.res, f) >= 0.95));
  const kappaGap = adequate == null ? null : Math.min(...rows.map((g) => kap(g.res, adequate) - kap(g.res, 30)));
  const c2 = kappaGap != null && kappaGap >= -0.05;
  const sl = slopes.filter((x) => rows.includes(x.g));
  const worst = sl.reduce((a, b) => (Math.abs(b.s) > Math.abs(a.s) ? b : a));
  const band = Math.max(1, Math.floor((0.25 * PLANNED_EFFECT_PP) / Math.abs(worst.s)));
  return { adequate, reduced, kappaGap, c2, worst, band };
}
const D = decide(decisionSet);
const ALL = decide(grid);
const line = (x: ReturnType<typeof decide>, rows: GridRow[]) => [
  `- **C1** detection >= 0.98 in every scenario down to **${x.adequate} fps** (adequate); >= 0.95 down to **${x.reduced} fps** (reduced; ${x.reduced === Math.min(...FPS) ? 'the lowest rate simulated' : 'below it detection falls under 0.95'}). Lowest detection at 20 fps: ${f3(Math.min(...rows.map((g) => det(g.res, 20))))}.`,
  `- **C2** at ${x.adequate} fps kappa is at most ${x.kappaGap == null ? '—' : f3(-x.kappaGap)} below its 30-fps value in every scenario: **${x.c2 ? 'yes' : 'NO'}** (limit 0.05). At 20 fps: ${f3(-Math.min(...rows.map((g) => kap(g.res, 20) - kap(g.res, 30))))}.`,
  `- **C3** worst slope ${Math.abs(x.worst.s).toFixed(3)} points per fps (${x.worst.g.res.name}); 25% of the planned ${PLANNED_EFFECT_PP}-point effect is ${(0.25 * PLANNED_EFFECT_PP).toFixed(2)} points; band = floor(${(0.25 * PLANNED_EFFECT_PP).toFixed(2)} / ${Math.abs(x.worst.s).toFixed(3)}) = **${x.band} fps** (worst-case shift over the band ${(x.band * Math.abs(x.worst.s)).toFixed(2)} points).`,
].join('\n');
console.log('\n## Decision rules\n');
console.log(`### On the ${decisionSet.length} decision scenarios\n`);
console.log(line(D, decisionSet));
console.log(`\nGATE fps-g2: adequate >= ${D.adequate}; reduced ${D.reduced} to < ${D.adequate}; exploratory < ${D.reduced}; consistent within ${D.band} fps of the participant's median.`);
console.log(`\n### The same rules on all ${grid.length} scenarios (robustness)\n`);
console.log(line(ALL, grid));

// ---- B. The fitted minimum against the lowest frame ----------------------------------------------------
console.log('\n## B. The fitted minimum (fit-r1) against the lowest frame (blink-r1)\n');
console.log('Noise 3%. The fit assumes the exposure the frames really had (as under the fixed camera exposure). "Bias" is the incomplete share among detected blinks minus the true share. Misclassified: share of detected blinks given the wrong class.\n');
console.log('| profile | exposure | fps | true share | bias, lowest frame | bias, fitted | shift vs 60, lowest frame | shift vs 60, fitted | misclassified, lowest frame | misclassified, fitted | kappa, lowest frame | kappa, fitted | blinks not fitted |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const FIT_FPS = [20, 24, 30, 60];
for (const shape of SHAPES) for (const ex of EXPOSURES.filter((e) => e.e !== 0)) {
  const cells: Cell[] = FIT_FPS.map((fps) => ({ label: String(fps), plan: { kind: 'regular', fps, exposureMs: ex.e } as Plan, fit: 'true' }));
  const r = runScenario({ name: `${shape}/${ex.name}`, shape, sigma: 0.03, runs: RUNS, seed: nextSeed() }, cells);
  const tr = ratio(r.truth);
  for (const f of FIT_FPS) {
    const c = r.cells[String(f)];
    const ref = r.cells['60'];
    const dRaw = pairedDiff(c.cls, ref.cls), dFit = pairedDiff(c.clsFit!, ref.clsFit!);
    console.log(`| ${shape} | ${ex.name} | ${f} | ${tr.toFixed(3)} | ${pp(ratio(c.cls) - tr)} | ${pp(ratio(c.clsFit!) - tr)} | ${f === 60 ? '—' : `${pp(dRaw.diff)} ± ${pp(dRaw.se)}`} | ${f === 60 ? '—' : `${pp(dFit.diff)} ± ${pp(dFit.se)}`} | ${pp(misclassified(c.cls, r.truth))}% | ${pp(misclassified(c.clsFit!, r.truth))}% | ${f3(kappa(c.cls, r.truth))} | ${f3(kappa(c.clsFit!, r.truth))} | ${c.fitFailed} |`);
  }
}

// ---- C. Polarity-linked auto-exposure, and a wrong exposure assumption ------------------------------
console.log('\n## C. A frame rate that follows polarity (auto-exposure), and the fixed exposure\n');
console.log('Same participant, same blinks. White page: 30 fps, 15 ms exposure. Black page: 25 fps, 40 ms (the 50-Hz anti-banding step; a mechanism, not a measurement). Fixed: 30 fps, 30 ms on both. Shift is against the white page, in points. "Exposure assumed = frame interval" is what the fit does when the exposure is not known.\n');
console.log('| profile, noise | setting | shift, lowest frame | shift, fitted (true exposure) | shift, fitted (exposure assumed = frame interval) |');
console.log('|---|---|---|---|---|');
for (const [shape, sigma] of [['cosine', 0.03], ['linear', 0.03], ['cosine', 0.04]] as Array<[Shape, number]>) {
  const white: Plan = { kind: 'regular', fps: 30, exposureMs: 15 };
  const black: Plan = { kind: 'regular', fps: 25, exposureMs: 40 };
  const locked: Plan = { kind: 'regular', fps: 30, exposureMs: 30 };
  const cells: Cell[] = [
    { label: 'white', plan: white, fit: 'true' }, { label: 'white-frame', plan: white, fit: 'frame' },
    { label: 'black', plan: black, fit: 'true' }, { label: 'black-frame', plan: black, fit: 'frame' },
    { label: 'locked', plan: locked, fit: 'true' }, { label: 'locked-frame', plan: locked, fit: 'frame' },
  ];
  const r = runScenario({ name: `${shape} ${sigma}`, shape, sigma, runs: RUNS, seed: nextSeed() }, cells);
  for (const s of ['black', 'locked']) {
    const raw = pairedDiff(r.cells[s].cls, r.cells.white.cls);
    const fit = pairedDiff(r.cells[s].clsFit!, r.cells.white.clsFit!);
    const fitF = pairedDiff(r.cells[`${s}-frame`].clsFit!, r.cells['white-frame'].clsFit!);
    console.log(`| ${shape}, ${Math.round(sigma * 100)}% | ${s === 'black' ? 'black page under auto (25 fps, 40 ms)' : 'fixed exposure on both (30 fps, 30 ms)'} | ${pp(raw.diff)} ± ${pp(raw.se)} | ${pp(fit.diff)} ± ${pp(fit.se)} | ${pp(fitF.diff)} ± ${pp(fitF.se)} |`);
  }
}

// ---- D. Same mean rate, two causes -----------------------------------------------------------------------
console.log('\n## D. The same average rate from two causes\n');
console.log('| setting | detection | shift vs 30 fps, points | kappa |');
console.log('|---|---|---|---|');
{
  const cells: Cell[] = [
    { label: '30 fps, 10 ms', plan: { kind: 'regular', fps: 30, exposureMs: 10 } },
    { label: '24 fps regular, 10 ms', plan: { kind: 'regular', fps: 24, exposureMs: 10 } },
    { label: '30-fps camera, tracker keeps 80%, 10 ms', plan: { kind: 'drop', cameraFps: 30, keep: 0.8, exposureMs: 10 } },
    { label: '25 fps regular, 40 ms', plan: { kind: 'regular', fps: 25, exposureMs: 40 } },
  ];
  const r = runScenario({ name: 'cosine 3%', shape: 'cosine', sigma: 0.03, runs: RUNS, seed: nextSeed() }, cells);
  for (const c of cells) {
    const d = pairedDiff(r.cells[c.label].cls, r.cells['30 fps, 10 ms'].cls);
    console.log(`| ${c.label} (exposure ${exposureOf(c.plan).toFixed(0)} ms) | ${f3(r.cells[c.label].detection)} | ${pp(d.diff)} ± ${pp(d.se)} | ${f3(kappa(r.cells[c.label].cls, r.truth))} |`);
  }
}

// ---- E. Landmark noise moves the ratio too --------------------------------------------------------------
console.log('\n## E. Reading-window noise against a calibration at 3% (24 fps, whole-frame exposure)\n');
console.log('| reading noise | incomplete share | shift vs 3%, points |');
console.log('|---|---|---|');
{
  const res: Record<string, Int8Array> = {};
  for (const sigma of [0.02, 0.03, 0.04]) {
    // The same blinks (same seed) at three noise levels; the calibration window stays at 3%.
    const r = runScenario({ name: `noise ${sigma}`, shape: 'cosine', sigma, calSigma: 0.03, runs: RUNS, seed: SEED + 777 },
      [{ label: '24', plan: { kind: 'regular', fps: 24, exposureMs: 'frame' } }]);
    res[String(sigma)] = r.cells['24'].cls;
  }
  for (const sigma of ['0.02', '0.03', '0.04']) {
    const d = pairedDiff(res[sigma], res['0.03']);
    console.log(`| ${Math.round(Number(sigma) * 100)}% | ${ratio(res[sigma]).toFixed(3)} | ${sigma === '0.03' ? '—' : `${pp(d.diff)} ± ${pp(d.se)}`} |`);
  }
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
