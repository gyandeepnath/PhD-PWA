/**
 * The camera self-test under simulation (Round 79): how often does a participant who blinks at every
 * flash pass the check, under the old rule (st-r1) and the new one (st-r2), at the frame rates a tablet
 * camera delivers? MODEL, not evidence. scripts/selfTestSim.ts runs the grid and prints the table in
 * docs/FPS_GATE_SIMULATION.md; tests/selfTestSim.test.ts pins a small fixed-seed run.
 *
 * THE SHIPPED PATH, END TO END. Each simulated frame goes through the shipped EyeMetricsAggregator
 * (ingest, coverage, blinkEvents), the blinks are classified by the shipped classifyBlinks against a
 * baseline from the shipped fitEarBaseline, and the attempt is scored by the shipped scoreSelfTest — the
 * same calls useTracking.endSelfTest and CameraSelfTest.tsx make. st-r1, which the code no longer has,
 * is applied to the same attempt from what it judged: the same hits (the matching is unchanged), the
 * same face share, and `fps` (the whole window's face-solved rate) at least 25.
 *
 * WHAT IS SIMULATED (one "attempt" = the 19-s check):
 *  - five flashes at 2.5 s and every 3 s after (SELF_TEST), the check ending 1.5 s after the last;
 *  - a blink after each flash, beginning U(250, 900) ms after it (ASSUMED: no verified source gives the
 *    latency of a blink to a visual cue; anything under the 1.2-s window counts the same);
 *  - each blink deliberate and complete: true lowest openness U(0.05, 0.40) of the open eye (ASSUMED),
 *    with the same two-phase lid movement as the frame-rate simulation — down N(100, 25) ms, up
 *    N(220, 50) ms, means from Nakamura et al. 2008 (ledger #62), spreads assumed (src/sim/fpsGate.ts).
 *    Voluntary blinks are usually taken to be slower than spontaneous ones; no verified figure was
 *    found, so the spontaneous durations are used — the shorter blink, the harder case for a slow camera;
 *  - the camera exactly as in src/sim/fpsGate.ts: a regular rate with 1.5 ms jitter (or a 30-fps camera
 *    whose tracker keeps a share of the frames), each frame the lid averaged over the whole frame
 *    interval (the low-light case), plus independent landmark noise of 2-4% of the open eye per frame;
 *  - optionally the face lost for one stretch of `faceLossMs`, placed at random (it may cover a blink,
 *    which the classifier then drops, as it would on the tablet);
 *  - the baseline: a 6-s open-eye window at the same sampling, as at calibration.
 *
 * Common random numbers: within a scenario every cell sees the same blinks, latencies and face-loss
 * times, so differences between frame rates are paired. Seeded (mulberry32), so every number reproduces.
 */
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import { fitEarBaseline } from '@/tracking/blink';
import { SELF_TEST, scoreSelfTest, type SelfTestVerdict } from '@/tracking/selfTest';
import { frameTimes, frameValue, exposureOf, DOWN_MEAN_MS, UP_MEAN_MS, DOWN_SD_MS, UP_SD_MS, type Blink, type Plan, type Shape } from './fpsGate';
import { makeRng, gaussian } from './rng';

/** The open eye's EAR; only ratios matter. */
const OPEN_EAR = 0.3;
/** ASSUMED latency of a blink to its flash, ms (uniform). */
export const LATENCY_MS: [number, number] = [250, 900];
/** ASSUMED depth of a deliberate blink, fraction of the open eye (uniform). */
export const DELIBERATE_DEPTH: [number, number] = [0.05, 0.40];
/** The check's length, as CameraSelfTest.tsx runs it: the first flash, five, then 1.5 s for the last. */
export const CHECK_MS = SELF_TEST.FIRST_CUE_MS + SELF_TEST.CUES * SELF_TEST.CUE_EVERY_MS + 1500;
/** st-r1's frame-rate floor (effective_fps over the whole window), for the comparison. */
export const ST_R1_MIN_FPS = 25;

export interface SelfTestScenario {
  name: string;
  shape: Shape;
  /** Per-frame landmark noise, fraction of the open eye. */
  sigma: number;
  /** One stretch without a face, ms; 0 for none. */
  faceLossMs: number;
  /** False: the participant does not blink at all (the eyes stay open) — how often noise alone passes. */
  blinks: boolean;
  runs: number;
  seed: number;
}

export interface SelfTestCell { label: string; plan: Plan }

export interface SelfTestCellResult {
  runs: number;
  /** Share of attempts passing under st-r1 and under st-r2. */
  passR1: number;
  passR2: number;
  /** st-r2's verdicts, as shares. */
  verdict: Record<SelfTestVerdict, number>;
  /** Mean flashes matched (of 5), and the share of attempts with at least 4. */
  meanHits: number;
  hitsOk: number;
  /** Mean of the two rates over the attempts: st-r1's (whole window) and st-r2's (while the face was seen). */
  meanFps: number;
  meanSamplingFps: number;
  meanFace: number;
}

interface Attempt { blinks: Blink[]; cues: number[]; lossAt: number | null }

function drawAttempt(sc: SelfTestScenario, rng: () => number): Attempt {
  const cues = Array.from({ length: SELF_TEST.CUES }, (_, k) => SELF_TEST.FIRST_CUE_MS + k * SELF_TEST.CUE_EVERY_MS);
  const blinks: Blink[] = sc.blinks
    ? cues.map((c) => ({
      t0: c + LATENCY_MS[0] + rng() * (LATENCY_MS[1] - LATENCY_MS[0]),
      depth: DELIBERATE_DEPTH[0] + rng() * (DELIBERATE_DEPTH[1] - DELIBERATE_DEPTH[0]),
      down: Math.min(200, Math.max(50, gaussian(rng, DOWN_MEAN_MS, DOWN_SD_MS))),
      up: Math.min(400, Math.max(110, gaussian(rng, UP_MEAN_MS, UP_SD_MS))),
    }))
    : [];
  const lossAt = sc.faceLossMs > 0 ? rng() * (CHECK_MS - sc.faceLossMs) : null;
  return { blinks, cues, lossAt };
}

export function runSelfTestScenario(sc: SelfTestScenario, cells: SelfTestCell[]): Record<string, SelfTestCellResult> {
  const rng = makeRng(sc.seed);
  const attempts: Attempt[] = [];
  for (let r = 0; r < sc.runs; r++) attempts.push(drawAttempt(sc, rng));
  const out: Record<string, SelfTestCellResult> = {};
  const pose = { pitch: 0, yaw: 0, roll: 0 };
  for (const cell of cells) {
    const E = exposureOf(cell.plan);
    let p1 = 0, p2 = 0, hits = 0, hitsOk = 0, fpsSum = 0, sfSum = 0, faceSum = 0, nFps = 0, nSf = 0;
    const verdict: Record<SelfTestVerdict, number> = { working: 0, reduced: 0, failed: 0 };
    for (const a of attempts) {
      const cal = frameTimes(cell.plan, 6000, rng);
      const B = fitEarBaseline(cal.map(() => OPEN_EAR * (1 + sc.sigma * gaussian(rng)))).baseline;
      const agg = new EyeMetricsAggregator();
      for (const t of frameTimes(cell.plan, CHECK_MS, rng)) {
        const face = a.lossAt == null || t < a.lossAt || t >= a.lossAt + sc.faceLossMs;
        const ear = OPEN_EAR * frameValue(t, E, a.blinks, sc.shape) * (1 + sc.sigma * gaussian(rng));
        agg.ingest({ t_ms: t, ear, earLeft: ear, earRight: ear, pose, zone: 'cc', isCenter: true, offAxis: false, facePresent: face, faceSize: 0.2, luma: null });
      }
      const cov = agg.coverage();
      const r = scoreSelfTest(a.cues, agg.blinkEvents(B).map((e) => e.onset_ms), cov);
      const r1 = r.detected >= 4 && cov.facePresence != null && cov.facePresence >= SELF_TEST.MIN_FACE && cov.fps != null && cov.fps >= ST_R1_MIN_FPS;
      if (r1) p1++;
      if (r.pass) p2++;
      verdict[r.verdict ?? 'failed']++;
      hits += r.detected;
      if (r.detected >= 4) hitsOk++;
      if (cov.fps != null) { fpsSum += cov.fps; nFps++; }
      if (cov.samplingFps != null) { sfSum += cov.samplingFps; nSf++; }
      faceSum += cov.facePresence ?? 0;
    }
    const n = attempts.length;
    out[cell.label] = {
      runs: n, passR1: p1 / n, passR2: p2 / n,
      verdict: { working: verdict.working / n, reduced: verdict.reduced / n, failed: verdict.failed / n },
      meanHits: hits / n, hitsOk: hitsOk / n,
      meanFps: nFps ? fpsSum / nFps : NaN, meanSamplingFps: nSf ? sfSum / nSf : NaN, meanFace: faceSum / n,
    };
  }
  return out;
}
