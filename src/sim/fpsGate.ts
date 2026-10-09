/**
 * The frame-rate simulation behind gate fps-g2 and the fitted-minimum sensitivity (Round 79). MODEL,
 * not evidence: what the SHIPPED classifier does with blinks whose true depth is known, sampled the way
 * a tablet camera samples them. scripts/fpsGateSim.ts runs the full grid and prints the tables in
 * docs/FPS_GATE_SIMULATION.md; tests/fpsGateSim.test.ts pins a small fixed-seed run.
 *
 * WHAT IS SIMULATED (one "run" = one 180-s reading window):
 *  - blinks about every 2.5-9.5 s (about 10 a minute), never overlapping;
 *  - each blink a two-phase lid movement: down-phase N(100, 25) ms, up-phase N(220, 50) ms (the MEANS
 *    are Nakamura et al. 2008's 1-kHz measurements, ledger #62; the SDs are ASSUMED — no verified source
 *    gave them), with a raised-cosine or a linear profile (the true profile is unknown: both are run);
 *  - depth: 70% complete, true lowest openness U(0.10, 0.60); 30% incomplete, U(0.60, 0.75) — an
 *    ASSUMED mix; the truth is "incomplete" when the true lowest openness is at least 0.60;
 *  - the camera: frames at a regular rate with 1.5 ms timing jitter (or a 30-fps camera whose tracker
 *    keeps a random share of frames), each frame the lid AVERAGED over its exposure (instantaneous, the
 *    whole frame interval, or a fixed 30 ms; the average is exact, from the profile's closed-form
 *    integral, not a few sub-samples), plus independent per-frame landmark noise of 2-4% of the
 *    open level (ASSUMED; Round 75 measured 1.6-2.3% frame-to-frame EAR jitter on one still portrait);
 *  - calibration: a 6-s open-eye window at the same sampling, fitted with the shipped fitEarBaseline;
 *  - classification: the shipped classifyBlinks (rule blink-r1) and, where asked, the fitted minimum
 *    (blinkFit.ts, rule fit-r1) classified against the same baseline and the same 0.60 cut.
 *
 * Common random numbers: within a scenario the same blinks are resampled at every setting, so
 * differences between settings are paired. Seeded (mulberry32), so every number is reproducible.
 */
import { classifyBlinks, fitEarBaseline, EAR_TIERS, type EarSample } from '@/tracking/blink';
import { fitBlinkMinimum } from '@/tracking/blinkFit';
import { OPEN_PRE_WINDOW_MS, OPEN_PRE_MIN_FRAMES } from '@/tracking/blinkLog';
import { makeRng, gaussian, type Rng } from './rng';

export type Shape = 'cosine' | 'linear';

/** Mean phase durations, ms: Nakamura et al. (2008), 1 kHz camera, English abstract (ledger #62). */
export const DOWN_MEAN_MS = 100;
export const UP_MEAN_MS = 220;
/** ASSUMED spreads of the phase durations. */
export const DOWN_SD_MS = 25;
export const UP_SD_MS = 50;
/** ASSUMED depth mix. */
export const P_INCOMPLETE = 0.3;
/** Frame-time jitter, ms SD (ASSUMED). */
export const JITTER_MS = 1.5;
/** One run: a 180-s reading window, the shipped exposure's order of magnitude. */
export const RUN_MS = 180_000;
/** The open eye's EAR in the simulation; only ratios matter. */
const OPEN_EAR = 0.3;

/** One simulated blink: start (ms), true lowest openness (1 open), down- and up-phase durations (ms). */
export interface Blink { t0: number; depth: number; down: number; up: number }

/** How the camera samples: a regular rate, or a 30-fps camera of which the tracker keeps a share. */
export type Plan =
  | { kind: 'regular'; fps: number; exposureMs: number | 'frame' }
  | { kind: 'drop'; cameraFps: number; keep: number; exposureMs: number | 'frame' };

export interface Cell {
  label: string;
  plan: Plan;
  /**
   * Run the fitted minimum too, assuming this exposure: 'true' (the exposure the frames really had —
   * known, as under the fixed exposure), 'frame' (the frame interval — what an unknown exposure
   * defaults to), or a number of ms. Omitted: no fit.
   */
  fit?: 'true' | 'frame' | number;
}

export interface Scenario {
  name: string;
  shape: Shape;
  /** Per-frame noise SD during reading, as a fraction of the open level. */
  sigma: number;
  /** Per-frame noise during the calibration window; defaults to sigma. */
  calSigma?: number;
  runs: number;
  seed: number;
}

export interface CellResult {
  /** Share of true blinks the classifier found. */
  detection: number;
  /** Per detected blink: 1 incomplete, 0 complete, -1 not detected — by the lowest frame (blink-r1). */
  cls: Int8Array;
  /** The same by the fitted minimum (fit-r1); a blink that could not be fitted keeps its lowest-frame class. Null without a fit. */
  clsFit: Int8Array | null;
  /** Blinks the fit could not be made for (they kept their lowest-frame class). */
  fitFailed: number;
}

export interface ScenarioResult {
  name: string;
  nBlinks: number;
  /** The true class of every blink (1 incomplete). */
  truth: Int8Array;
  /** The true lowest openness of every blink. */
  depth: Float64Array;
  cells: Record<string, CellResult>;
}

const intervalOf = (p: Plan) => 1000 / (p.kind === 'regular' ? p.fps : p.cameraFps);
/** The exposure a plan's frames have, ms: never longer than the frame interval. */
export function exposureOf(p: Plan): number {
  const dt = intervalOf(p);
  return p.exposureMs === 'frame' ? dt : Math.min(p.exposureMs, dt);
}

/**
 * The lid's closure integrated from the start of blink `b` to `x` ms after it (closed form, so a frame's
 * exposure average is exact). Written here, not taken from blinkFit.ts, so the simulated camera does not
 * share code with the estimator it is used to test.
 */
export function closureIntegral(x: number, b: Blink, shape: Shape): number {
  const { down: D, up: U } = b;
  if (x <= 0) return 0;
  if (x >= D + U) return 0.5 * (D + U);
  if (shape === 'cosine') {
    if (x < D) return 0.5 * (x - (D / Math.PI) * Math.sin((Math.PI * x) / D));
    const u = x - D;
    return 0.5 * D + 0.5 * (u + (U / Math.PI) * Math.sin((Math.PI * u) / U));
  }
  if (x < D) return (x * x) / (2 * D);
  const u = x - D;
  return 0.5 * D + u - (u * u) / (2 * U);
}

function closure(x: number, b: Blink, shape: Shape): number {
  if (x <= 0 || x >= b.down + b.up) return 0;
  if (x < b.down) return shape === 'cosine' ? 0.5 * (1 - Math.cos((Math.PI * x) / b.down)) : x / b.down;
  const u = (x - b.down) / b.up;
  return shape === 'cosine' ? 0.5 * (1 + Math.cos(Math.PI * u)) : 1 - u;
}

/** The last blink starting at or before `t` (blinks are sorted and at least 2.5 s apart), or null. */
function blinkAt(t: number, blinks: Blink[]): Blink | null {
  let lo = 0, hi = blinks.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (blinks[m].t0 <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k < 0 ? null : blinks[k];
}

/**
 * What a frame stamped `t` sees: the lid's openness (1 open) averaged over its exposure [t - E, t],
 * exactly. Blinks are at least 2.5 s apart and an exposure is under 70 ms, so one blink at most
 * overlaps a frame.
 */
export function frameValue(t: number, E: number, blinks: Blink[], shape: Shape): number {
  const b = blinkAt(t, blinks);
  if (!b) return 1;
  if (!(E > 0)) return 1 - (1 - b.depth) * closure(t - b.t0, b, shape);
  const mean = (closureIntegral(t - b.t0, b, shape) - closureIntegral(t - E - b.t0, b, shape)) / E;
  return 1 - (1 - b.depth) * mean;
}

/** Frame capture times over `dur` ms under plan `p`, with timing jitter (shared with the self-test simulation). */
export function frameTimes(p: Plan, dur: number, rng: Rng): number[] {
  const out: number[] = [];
  const dt = intervalOf(p);
  let t = rng() * dt;
  for (; t < dur; t += dt) {
    if (p.kind === 'drop' && rng() >= p.keep) continue;
    out.push(t + gaussian(rng, 0, JITTER_MS));
  }
  // Jitter can reorder two frames a fraction of a millisecond apart only at absurd rates; keep it sorted.
  return out.sort((a, b) => a - b);
}

function drawBlinks(rng: Rng): Blink[] {
  const out: Blink[] = [];
  let t = 1500;
  while (t < RUN_MS - 2000) {
    const incomplete = rng() < P_INCOMPLETE;
    const depth = incomplete ? 0.60 + rng() * 0.15 : 0.10 + rng() * 0.50;
    const down = Math.min(200, Math.max(50, gaussian(rng, DOWN_MEAN_MS, DOWN_SD_MS)));
    const up = Math.min(400, Math.max(110, gaussian(rng, UP_MEAN_MS, UP_SD_MS)));
    out.push({ t0: t, depth, down, up });
    t += 2500 + rng() * 7000;
  }
  return out;
}

/** The eye's open level before `onsetMs`, as blinkLog.ts open_pre: median of open frames in the second before. */
function openBefore(samples: EarSample[], onsetMs: number, baseline: number): number | null {
  const cut = baseline * EAR_TIERS.partial;
  const v = samples.filter((s) => s.t_ms < onsetMs && s.t_ms >= onsetMs - OPEN_PRE_WINDOW_MS && s.ear >= cut).map((s) => s.ear).sort((a, b) => a - b);
  return v.length >= OPEN_PRE_MIN_FRAMES ? v[Math.floor(v.length / 2)] : null;
}

export function runScenario(sc: Scenario, cells: Cell[]): ScenarioResult {
  const rng = makeRng(sc.seed);
  const runs: Blink[][] = [];
  for (let r = 0; r < sc.runs; r++) runs.push(drawBlinks(rng));
  const nBlinks = runs.reduce((s, b) => s + b.length, 0);
  const truth = new Int8Array(nBlinks);
  const depth = new Float64Array(nBlinks);
  { let k = 0; for (const bl of runs) for (const b of bl) { truth[k] = b.depth >= EAR_TIERS.full ? 1 : 0; depth[k] = b.depth; k++; } }
  const out: Record<string, CellResult> = {};
  for (const cell of cells) {
    const cls = new Int8Array(nBlinks).fill(-1);
    const clsFit = cell.fit != null ? new Int8Array(nBlinks).fill(-1) : null;
    let detected = 0, fitFailed = 0, k0 = 0;
    const E = exposureOf(cell.plan);
    const fitE = cell.fit === 'true' ? E : cell.fit === 'frame' ? intervalOf(cell.plan) : typeof cell.fit === 'number' ? cell.fit : 0;
    for (const bl of runs) {
      const calT = frameTimes(cell.plan, 6000, rng);
      const B = fitEarBaseline(calT.map(() => OPEN_EAR * (1 + (sc.calSigma ?? sc.sigma) * gaussian(rng)))).baseline;
      const ts = frameTimes(cell.plan, RUN_MS, rng);
      const samples: EarSample[] = ts.map((t) => ({ t_ms: t, ear: OPEN_EAR * frameValue(t, E, bl, sc.shape) * (1 + sc.sigma * gaussian(rng)) }));
      const events = B == null ? [] : classifyBlinks(samples, B);
      let e0 = 0;
      for (let j = 0; j < bl.length; j++) {
        const b = bl[j];
        // The first event whose onset falls between just before the blink and its end.
        while (e0 < events.length && events[e0].onset_ms < b.t0 - 60) e0++;
        const e = e0 < events.length && events[e0].onset_ms <= b.t0 + b.down + b.up ? events[e0] : null;
        if (!e || B == null) continue;
        detected++;
        const raw = e.tier === 'incomplete' ? 1 : 0;
        cls[k0 + j] = raw;
        if (clsFit) {
          const iMin = samples.findIndex((s) => s.t_ms === e.min_at_ms);
          const L = openBefore(samples, e.onset_ms, B);
          const f = L != null && iMin >= 0 ? fitBlinkMinimum(samples, iMin, L, fitE) : null;
          if (f) clsFit[k0 + j] = f.min_ear / B >= EAR_TIERS.full ? 1 : 0;
          else { clsFit[k0 + j] = raw; fitFailed++; }
        }
      }
      k0 += bl.length;
    }
    out[cell.label] = { detection: detected / nBlinks, cls, clsFit, fitFailed };
  }
  return { name: sc.name, nBlinks, truth, depth, cells: out };
}

// ---- statistics over a cell -------------------------------------------------------------------

/** Share incomplete among detected blinks. */
export function ratio(a: Int8Array): number {
  let n = 0, k = 0;
  for (const v of a) { if (v < 0) continue; n++; k += v; }
  return n ? k / n : NaN;
}

/** Cohen's kappa against the truth, over detected blinks. */
export function kappa(a: Int8Array, t: Int8Array): number {
  let n = 0, a1 = 0, t1 = 0, agree = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < 0) continue;
    n++; if (a[i] === 1) a1++; if (t[i] === 1) t1++; if (a[i] === t[i]) agree++;
  }
  const po = agree / n, pa = a1 / n, pt = t1 / n, pe = pa * pt + (1 - pa) * (1 - pt);
  return (po - pe) / (1 - pe);
}

/** Share of detected blinks classified differently from the truth. */
export function misclassified(a: Int8Array, t: Int8Array): number {
  let n = 0, wrong = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] < 0) continue; n++; if (a[i] !== t[i]) wrong++; }
  return n ? wrong / n : NaN;
}

/** Paired difference in the incomplete share (a minus b) over blinks detected in both, with its SE. */
export function pairedDiff(a: Int8Array, b: Int8Array): { diff: number; se: number } {
  const d: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] >= 0 && b[i] >= 0) d.push(a[i] - b[i]);
  const m = d.reduce((s, x) => s + x, 0) / d.length;
  const v = d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, d.length - 1);
  return { diff: m, se: Math.sqrt(v / d.length) };
}

/** Share of blinks within (near) or beyond (far) 0.05 of the 0.60 cut that were classified wrongly. */
export function flipRate(a: Int8Array, t: Int8Array, depth: Float64Array, near: boolean): number {
  let n = 0, f = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < 0) continue;
    if ((Math.abs(depth[i] - EAR_TIERS.full) < 0.05) !== near) continue;
    n++; if (a[i] !== t[i]) f++;
  }
  return n ? f / n : NaN;
}

/** Detection by the blink's true depth: the share of blinks in each [from, to) band that were found. */
export function detectionByDepth(r: ScenarioResult, cell: string, bands: Array<[number, number]>): Array<{ detection: number; n: number }> {
  const c = r.cells[cell].cls;
  return bands.map(([a, b]) => {
    let n = 0, d = 0;
    for (let i = 0; i < c.length; i++) if (r.depth[i] >= a && r.depth[i] < b) { n++; if (c[i] >= 0) d++; }
    return { detection: n ? d / n : NaN, n };
  });
}

/** Least-squares slope of y on x. */
export function slope(x: number[], y: number[]): number {
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  return num / den;
}
