/**
 * Harsh multi-stress runner: `npm run stress`.
 *
 * Runs several independent stress regimes against the pure pipeline and reports a consolidated
 * pass/fail. Unlike the unit suite (which injects clean values), this hammers the real code paths
 * with adversarial and large-scale inputs:
 *   1. Large-cohort simulation (N participants) — assert no NaN/Infinity/out-of-range in any field.
 *   2. Heavy adversarial fuzz soak (degenerate sensor/trial/export inputs incl. CSV torture).
 *   3. Head-pose pitch dynamic-range sweep — must vary monotonically, frontal ≈ 0 (anti-regression
 *      for the "pitch pinned at a constant" bug).
 *   4. Incomplete-blink reachability sweep — the classifier must emit the incomplete tier.
 *
 * Exits non-zero on any failure.
 */
import { runFuzz } from './fuzz';
import { generateCohort } from './participant';
import { estimateHeadPose } from '@/tracking/headPose';
import { classifyBlinks, summariseBlinks, type EarSample, type Point } from '@/tracking/blink';
import { N_CONDITIONS } from '@/experiment/conditions';

declare const process: { argv: string[]; exit: (code: number) => void };

const cohortN = Number(process.argv[2] ?? 3000);
const fuzzIters = Number(process.argv[3] ?? 100000);

let failed = 0;
const t0 = Date.now();
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failed++;
};

console.log('='.repeat(72));
console.log(`VisuLab harsh stress run — cohort N=${cohortN}, fuzz ${fuzzIters} iters`);
console.log('='.repeat(72));

// 1) Large cohort — every numeric field finite and in range.
{
  const cohort = generateCohort(cohortN, 20260625);
  let rows = 0, bad = 0;
  const ranges: Record<string, [number, number]> = {
    search_accuracy: [0, 1], fatigue_mean: [0, 10], comfort_score: [0, 100], clarity_score: [0, 100], d_prime_se: [0, Infinity],
  };
  for (const p of cohort) for (const r of p.rows) {
    rows++;
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number' && !Number.isFinite(v)) { bad++; if (bad <= 5) console.log(`   non-finite ${k}=${v}`); }
      const rg = ranges[k];
      if (rg && typeof v === 'number' && (v < rg[0] - 1e-9 || v > rg[1] + 1e-9)) { bad++; if (bad <= 5) console.log(`   out-of-range ${k}=${v}`); }
    }
  }
  ok(`cohort invariants (${rows} condition-rows)`, bad === 0 && rows === cohortN * N_CONDITIONS, `${bad} violations`);
}

// 2) Heavy fuzz soak.
{
  const f1 = runFuzz(fuzzIters, 1);
  const f2 = runFuzz(Math.floor(fuzzIters / 2), 98765);
  ok(`adversarial fuzz soak (${fuzzIters + Math.floor(fuzzIters / 2)} iters, 2 seeds)`, f1.length === 0 && f2.length === 0, `${f1.length + f2.length} failures`);
  if (f1.length) console.log('   ', f1.slice(0, 5).map((x) => `[${x.check}] ${x.detail}`).join(' | '));
}

// 3) Head-pose pitch dynamic range.
{
  const face = (noseY: number): Point[] => {
    const lm: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[133] = { x: 0.45, y: 0.40 }; lm[362] = { x: 0.55, y: 0.40 }; lm[152] = { x: 0.50, y: 0.90 };
    lm[234] = { x: 0.30, y: 0.50 }; lm[454] = { x: 0.70, y: 0.50 }; lm[1] = { x: 0.50, y: noseY };
    return lm;
  };
  const ys = Array.from({ length: 21 }, (_, i) => 0.45 + i * 0.02);
  const pitches = ys.map((y) => estimateHeadPose(face(y)).pitch);
  let monotonic = true;
  for (let i = 1; i < pitches.length; i++) if (pitches[i] >= pitches[i - 1]) monotonic = false;
  const range = Math.max(...pitches) - Math.min(...pitches);
  const frontal = Math.abs(estimateHeadPose(face(0.625)).pitch);
  ok('head-pitch varies monotonically over a wide range', monotonic && range > 30, `range=${range.toFixed(1)}°`);
  ok('head-pitch ≈ 0° at frontal posture', frontal < 3, `frontal=${frontal.toFixed(2)}°`);
}

// 4) Incomplete-blink reachability.
{
  const baseline = 0.3;
  const samples: EarSample[] = [];
  let t = 0;
  const push = (ear: number, n: number) => { for (let i = 0; i < n; i++) { samples.push({ t_ms: t, ear }); t += 33; } };
  for (let i = 0; i < 20; i++) { push(0.30, 18); push(0.05, 6); push(0.30, 18); push(0.20, 6); }
  const sum = summariseBlinks(classifyBlinks(samples, baseline), samples[samples.length - 1].t_ms);
  ok('incomplete-blink tier is reachable from the classifier', sum.blink_count_incomplete > 0 && sum.incomplete_blink_ratio > 0,
    `incomplete=${sum.blink_count_incomplete}, ratio=${sum.incomplete_blink_ratio.toFixed(3)}`);
}

console.log('='.repeat(72));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (failed === 0) console.log(`ALL STRESS REGIMES PASSED in ${secs}s.`);
else { console.log(`${failed} STRESS REGIME(S) FAILED in ${secs}s.`); process.exit(1); }
