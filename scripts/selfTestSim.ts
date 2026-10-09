/**
 * The camera self-test simulation (Round 79): `npm run sim:selftest` (optionally `-- <runs per cell>`;
 * default 1000).
 *
 * Runs simulated attempts of the flashing-dot check through the shipped aggregator, classifier and
 * scorer (src/sim/selfTestSim.ts) and prints, per frame rate, how often a participant who blinks at
 * every flash passes under the old rule (st-r1: face-solved rate over the whole window at least 25) and
 * the new one (st-r2: the frame-rate gate fps-g2's rate, a pass from 15, "working" from 20). Also: the
 * face lost for a second, a tracker dropping frames from a 30-fps camera, and a participant who does
 * not blink at all (how often noise alone passes). MODEL, not evidence; every assumption is listed in
 * src/sim/selfTestSim.ts. Deterministic: the same seed and code give the same numbers.
 */
import { runSelfTestScenario, CHECK_MS, LATENCY_MS, DELIBERATE_DEPTH, type SelfTestCell, type SelfTestScenario } from '../src/sim/selfTestSim';
import type { Shape } from '../src/sim/fpsGate';

const RUNS = Number(process.argv[2] ?? 1000);
const SEED = 20261009;
const FPS = [12, 15, 18, 20, 22, 24, 25, 30];
const SHAPES: Shape[] = ['cosine', 'linear'];
const SIGMAS = [0.02, 0.03, 0.04];
const p = (x: number) => x.toFixed(3);

const cells: SelfTestCell[] = [
  ...FPS.map((f) => ({ label: `${f} fps`, plan: { kind: 'regular' as const, fps: f, exposureMs: 'frame' as const } })),
  { label: '30 cam, keeps 80%', plan: { kind: 'drop' as const, cameraFps: 30, keep: 0.8, exposureMs: 'frame' as const } },
];

const t0 = Date.now();
let seedN = 0;
const nextSeed = () => SEED + 1000 * ++seedN;

console.log('# Camera self-test simulation output');
console.log(`\nRuns per cell ${RUNS}; base seed ${SEED}; each attempt the ${CHECK_MS / 1000}-s check, five flashes; `
  + `blink latency U(${LATENCY_MS.join(', ')}) ms; deliberate blink depth U(${DELIBERATE_DEPTH.join(', ')}) of the open eye; `
  + 'each frame exposed for the whole frame interval.\n');

const table = (title: string, sc: SelfTestScenario) => {
  const res = runSelfTestScenario(sc, cells);
  console.log(`\n## ${title}\n`);
  console.log('| Sampling | pass st-r1 | pass st-r2 | working | reduced | failed | ≥ 4 of 5 seen | mean seen | fps (whole window) | fps (face seen) | face share |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) {
    const r = res[c.label];
    console.log(`| ${c.label} | ${p(r.passR1)} | ${p(r.passR2)} | ${p(r.verdict.working)} | ${p(r.verdict.reduced)} | ${p(r.verdict.failed)} | ${p(r.hitsOk)} | ${r.meanHits.toFixed(2)} | ${r.meanFps.toFixed(1)} | ${Number.isFinite(r.meanSamplingFps) ? r.meanSamplingFps.toFixed(1) : '—'} | ${p(r.meanFace)} |`);
  }
  return res;
};

// A. A participant who blinks at every flash, face in view throughout.
for (const shape of SHAPES) for (const sigma of SIGMAS) {
  table(`A. Blinks at every flash, face in view throughout — ${shape} lid, noise ${sigma * 100}%`, {
    name: `A-${shape}-${sigma}`, shape, sigma, faceLossMs: 0, blinks: true, runs: RUNS, seed: nextSeed(),
  });
}
// B. The same, with the face lost for one second (about 5% of the check).
table('B. Blinks at every flash, face lost for 1 s at a random moment — cosine lid, noise 3%', {
  name: 'B', shape: 'cosine', sigma: 0.03, faceLossMs: 1000, blinks: true, runs: RUNS, seed: nextSeed(),
});
// C. A participant who does not blink: how often noise alone passes.
table('C. No blinks at all (eyes open throughout) — linear lid, noise 4%', {
  name: 'C', shape: 'linear', sigma: 0.04, faceLossMs: 0, blinks: false, runs: RUNS, seed: nextSeed(),
});

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
