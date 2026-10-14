/**
 * The camera self-test under simulation (Round 79; Round 82): how often does a participant who blinks at
 * every flash pass the check, under the old rules (st-r1, st-r2) and the shipped one (st-r3), at the
 * frame rates a tablet camera delivers — and how often does one who IGNORES the flashes and blinks only
 * spontaneously pass it? MODEL, not evidence. scripts/selfTestSim.ts runs the grid and prints the table in
 * docs/FPS_GATE_SIMULATION.md; tests/selfTestSim.test.ts pins a small fixed-seed run.
 *
 * THE SHIPPED PATH, END TO END. Each simulated frame goes through the shipped EyeMetricsAggregator
 * (ingest, coverage, blinkEvents), the blinks are classified by the shipped classifyBlinks against a
 * baseline from the shipped fitEarBaseline, and the attempt is scored by the shipped scoreSelfTest — the
 * same calls useTracking.endSelfTest and CameraSelfTest.tsx make. st-r2 is the shipped scorer with its
 * rule argument ('st-r2': a flash takes a blink up to 1.2 s either side). st-r1, which the code no longer
 * has, is applied to the same attempt from what it judged: st-r2's hits (the matching was the same),
 * the same face share, and `fps` (the whole window's face-solved rate) at least 25.
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
 *  - optionally (Round 82) spontaneous blinks at `spontaneousPerMin`, unrelated to the flashes: a
 *    renewal process whose mean interval is 60 000 / rate ms, each blink at least 300 ms after the end of
 *    the one before (ASSUMED refractory gap), begun before the check so the rate is steady from its
 *    start; depth and phases as in the frame-rate simulation (70% complete, 30% incomplete — the ASSUMED
 *    mix of src/sim/fpsGate.ts). A spontaneous blink that would overlap a cued one is left out. The rates
 *    run (10-26 a minute) are ASSUMPTIONS: the one verified figure is a mean of 11.6 a minute (SD 7.84)
 *    while reading on a computer (Portello et al. 2013, ledger #2), and the check is not reading;
 *  - the baseline: a 6-s open-eye window at the same sampling, as at calibration.
 *
 * Common random numbers: within a scenario every cell sees the same blinks, latencies and face-loss
 * times, so differences between frame rates are paired. Seeded (mulberry32), so every number reproduces.
 */
import { EyeMetricsAggregator } from '@/tracking/aggregator';
import { fitEarBaseline } from '@/tracking/blink';
import { SELF_TEST, SELF_TEST_RULE_R2, minHits, scoreSelfTest, type SelfTestVerdict } from '@/tracking/selfTest';
import { frameTimes, frameValue, exposureOf, DOWN_MEAN_MS, UP_MEAN_MS, DOWN_SD_MS, UP_SD_MS, P_INCOMPLETE, type Blink, type Plan, type Shape } from './fpsGate';
import { makeRng, gaussian, exponential } from './rng';

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
/** ASSUMED shortest gap between the end of one spontaneous blink and the start of the next, ms. */
export const SPONTANEOUS_GAP_MS = 300;

export interface SelfTestScenario {
  name: string;
  shape: Shape;
  /** Per-frame landmark noise, fraction of the open eye. */
  sigma: number;
  /** One stretch without a face, ms; 0 for none. */
  faceLossMs: number;
  /** False: the participant does not answer the flashes (no cued blinks). */
  blinks: boolean;
  /** Spontaneous blinks a minute, unrelated to the flashes (Round 82); 0 or absent for none. */
  spontaneousPerMin?: number;
  runs: number;
  seed: number;
}

export interface SelfTestCell { label: string; plan: Plan }

export interface SelfTestCellResult {
  runs: number;
  /** Share of attempts passing under st-r1, st-r2 and the shipped st-r3. */
  passR1: number;
  passR2: number;
  passR3: number;
  /** The shipped rule's (st-r3's) verdicts, as shares. */
  verdict: Record<SelfTestVerdict, number>;
  /** Mean flashes matched (of 5) under st-r3, and the share of attempts with at least 4. */
  meanHits: number;
  hitsOk: number;
  /** Mean blinks the classifier found per attempt, counted or not. */
  meanBlinks: number;
  /** Mean of the two rates over the attempts: st-r1's (whole window) and st-r2's (while the face was seen). */
  meanFps: number;
  meanSamplingFps: number;
  meanFace: number;
}

interface Attempt { blinks: Blink[]; cues: number[]; lossAt: number | null }

const phases = (rng: () => number) => ({
  down: Math.min(200, Math.max(50, gaussian(rng, DOWN_MEAN_MS, DOWN_SD_MS))),
  up: Math.min(400, Math.max(110, gaussian(rng, UP_MEAN_MS, UP_SD_MS))),
});

/** Spontaneous blinks over the check (see the header): mean interval 60 000 / rate, a refractory gap. */
function spontaneousBlinks(perMin: number, rng: () => number): Blink[] {
  const out: Blink[] = [];
  const mean = 60_000 / perMin;
  let t = -mean * rng() - 2000;
  while (t < CHECK_MS) {
    const incomplete = rng() < P_INCOMPLETE;
    const b = { t0: t, depth: incomplete ? 0.60 + rng() * 0.15 : 0.10 + rng() * 0.50, ...phases(rng) };
    if (t > -1000) out.push(b);
    // The next onset: the mean interval in all, of which the blink and the gap after it are the fixed part.
    const fixed = b.down + b.up + SPONTANEOUS_GAP_MS;
    t += fixed + exponential(rng, Math.max(1, mean - fixed));
  }
  return out;
}

function drawAttempt(sc: SelfTestScenario, rng: () => number): Attempt {
  const cues = Array.from({ length: SELF_TEST.CUES }, (_, k) => SELF_TEST.FIRST_CUE_MS + k * SELF_TEST.CUE_EVERY_MS);
  const cued: Blink[] = sc.blinks
    ? cues.map((c) => ({
      t0: c + LATENCY_MS[0] + rng() * (LATENCY_MS[1] - LATENCY_MS[0]),
      depth: DELIBERATE_DEPTH[0] + rng() * (DELIBERATE_DEPTH[1] - DELIBERATE_DEPTH[0]),
      ...phases(rng),
    }))
    : [];
  const spont = sc.spontaneousPerMin ? spontaneousBlinks(sc.spontaneousPerMin, rng) : [];
  // One lid: a spontaneous blink that would overlap a cued one (with the gap either side) is left out.
  const clear = (s: Blink) => cued.every((b) => s.t0 + s.down + s.up + SPONTANEOUS_GAP_MS <= b.t0 || b.t0 + b.down + b.up + SPONTANEOUS_GAP_MS <= s.t0);
  const blinks = [...cued, ...spont.filter(clear)].sort((a, b) => a.t0 - b.t0);
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
    let p1 = 0, p2 = 0, p3 = 0, hits = 0, hitsOk = 0, fpsSum = 0, sfSum = 0, faceSum = 0, nFps = 0, nSf = 0, found = 0;
    const verdict: Record<SelfTestVerdict, number> = { working: 0, reduced: 0, failed: 0 };
    for (const a of attempts) {
      const cal = frameTimes(cell.plan, 6000, rng);
      const B = fitEarBaseline(cal.map(() => OPEN_EAR * (1 + sc.sigma * gaussian(rng)))).baseline;
      const agg = new EyeMetricsAggregator();
      for (const t of frameTimes(cell.plan, CHECK_MS, rng)) {
        const face = a.lossAt == null || t < a.lossAt || t >= a.lossAt + sc.faceLossMs;
        const ear = OPEN_EAR * frameValue(t, E, a.blinks, sc.shape) * (1 + sc.sigma * gaussian(rng));
        agg.ingest({ t_ms: t, ear, earLeft: ear, earRight: ear, pose, offAxis: false, facePresent: face, faceSize: 0.2, luma: null });
      }
      const cov = agg.coverage();
      const onsets = agg.blinkEvents(B).map((e) => e.onset_ms);
      found += onsets.length;
      // The shipped rule (st-r3), and st-r2 re-scored by the same function with its rule argument.
      const r = scoreSelfTest(a.cues, onsets, cov);
      const r2 = scoreSelfTest(a.cues, onsets, cov, SELF_TEST_RULE_R2);
      const r1 = r2.detected >= minHits(a.cues.length) && cov.facePresence != null && cov.facePresence >= SELF_TEST.MIN_FACE && cov.fps != null && cov.fps >= ST_R1_MIN_FPS;
      if (r1) p1++;
      if (r2.pass) p2++;
      if (r.pass) p3++;
      verdict[r.verdict ?? 'failed']++;
      hits += r.detected;
      if (r.detected >= minHits(a.cues.length)) hitsOk++;
      if (cov.fps != null) { fpsSum += cov.fps; nFps++; }
      if (cov.samplingFps != null) { sfSum += cov.samplingFps; nSf++; }
      faceSum += cov.facePresence ?? 0;
    }
    const n = attempts.length;
    out[cell.label] = {
      runs: n, passR1: p1 / n, passR2: p2 / n, passR3: p3 / n,
      verdict: { working: verdict.working / n, reduced: verdict.reduced / n, failed: verdict.failed / n },
      meanHits: hits / n, hitsOk: hitsOk / n, meanBlinks: found / n,
      meanFps: nFps ? fpsSum / nFps : NaN, meanSamplingFps: nSf ? sfSum / nSf : NaN, meanFace: faceSum / n,
    };
  }
  return out;
}
