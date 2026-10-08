/**
 * A blink's deepest point estimated BETWEEN frames — the "fitted minimum" (Round 79, rule 'fit-r1').
 *
 * THE PROBLEM. The primary rule (blink-r1, tracking/blink.ts) calls a blink complete when its LOWEST
 * SAMPLED frame is below 0.60 x the open-eye baseline. A camera samples a blink every 33-50 ms, and the
 * lid's true deepest point usually falls between two frames, so the lowest frame sits at or above it:
 * the slower the camera, the more blinks read shallower than they were, and the higher the
 * incomplete-blink ratio comes out. That is a shift in the ratio's LEVEL with frame rate
 * (docs/FPS_GATE_SIMULATION.md), not noise. How big: for a blink of mean shape at 24 fps, the lowest
 * frame can overstate the openness at the deepest point by up to about 0.05 x (1 - depth) — so only
 * blinks within about 0.02-0.03 of the 0.60 cut can change class, and the shift in the ratio comes from
 * those (tests/blinkFit.test.ts works the numbers).
 *
 * WHAT THIS DOES. It fits a smooth blink shape to the frames around the lowest one and reads the depth
 * off the fitted curve instead of off the lowest frame. The shape is a two-phase raised cosine — the lid
 * closes over a down-phase and reopens over a longer up-phase (means about 100 and 220 ms at 1 kHz,
 * Nakamura et al. 2008, docs/CITATION_VERIFICATION.md #62) — and each frame is modelled as the shape
 * AVERAGED over that frame's exposure, because a camera integrates the lid's movement over the time its
 * sensor is open. The average is computed exactly (the raised cosine has a closed-form integral). Where in
 * its exposure a frame's time stamp falls does not matter: the time of the deepest point is a free
 * parameter and absorbs any constant offset; only the exposure's LENGTH enters.
 *
 * Fitted: the time of the deepest point and the down- and up-phase durations — a coarse grid, then a
 * pattern search (coordinate steps, halved until the time step is under 0.1 ms), so the durations are
 * continuous, not snapped to the grid — and the depth (closed-form least squares at every step). The open
 * level is the eye's open level just before the blink (blinkLog.ts open_pre), so the depth is the lid's
 * own excursion.
 *
 * WHY NOT A GRID ALONE. The first draft searched the durations on a 20/40-ms grid only, which does not
 * contain the mean blink (100/220 ms). On noise-free blinks of exactly the template's shape it then
 * missed the true depth by up to 0.01 of the open level, in a direction that changed with where the
 * frames fell — the same size as the frame-rate error it exists to remove. With the refinement it
 * recovers such blinks to within 0.001 (tests/blinkFit.test.ts).
 *
 * WHAT IT IS FOR, AND NOT. A pre-registered SENSITIVITY analysis only (docs/ANALYSIS_PLAN.md §5): the
 * primary outcome stays the lowest-frame rule, unchanged. The simulation shows why
 * (docs/FPS_GATE_SIMULATION.md): the fit removes most of the frame-rate dependence of the ratio's level
 * when the exposure time is KNOWN (the exposure fixed at camera setup supplies it), and less when it is
 * not; with landmark noise it classifies individual blinks no better than the lowest frame. No published
 * validation of sub-frame blink-minimum estimation was found (R2, PubMed search); its support is the
 * simulation alone, to be checked on real traces in the validation sub-study.
 *
 * Pure. Used by scripts/fpsGateSim.ts (the simulation) and by blinkLog.ts for the per-blink and
 * per-condition sensitivity columns.
 */
import type { EarSample } from './blink';

/** Any change to the template, the search, the window or the exposure model must change this string. */
export const FIT_RULE_VERSION = 'fit-r1';

/** Frames used: this many before the lowest frame and FIT_AFTER after it. */
export const FIT_BEFORE = 4;
export const FIT_AFTER = 6;
/** Fewer frames than this in the window and no fit is made. */
export const FIT_MIN_FRAMES = 5;
/** A gap longer than this inside the window means the blink was not seen continuously: no fit. */
export const FIT_MAX_GAP_MS = 250;
/**
 * The coarse grid the phase durations start from, ms, and the bounds the refinement stays within. The
 * bounds are wide on purpose (a fit pinned at a bound says the shape did not fit, and the rmse shows it);
 * they are not tuned to the simulation's distributions.
 */
export const FIT_DOWN_GRID_MS = [40, 60, 80, 100, 120, 140, 160, 180, 200] as const;
export const FIT_UP_GRID_MS = [100, 140, 180, 220, 260, 300, 340, 380, 420] as const;
export const FIT_DOWN_BOUNDS_MS = [30, 250] as const;
export const FIT_UP_BOUNDS_MS = [60, 500] as const;
/** Coarse step for the time of the deepest point, ms; the refinement then goes below 0.1 ms. */
export const FIT_TMIN_STEP_MS = 5;

/** Closure of the template at `x` ms after the lid starts to close: 0 open, 1 at the deepest point. */
export function templateClosure(x: number, downMs: number, upMs: number): number {
  if (x <= 0 || x >= downMs + upMs) return 0;
  if (x < downMs) return 0.5 * (1 - Math.cos((Math.PI * x) / downMs));
  return 0.5 * (1 + Math.cos((Math.PI * (x - downMs)) / upMs));
}

/** The template's closure integrated from the start of the blink to `x` ms, in ms (closed form). */
export function templateIntegral(x: number, downMs: number, upMs: number): number {
  if (x <= 0) return 0;
  if (x < downMs) return 0.5 * (x - (downMs / Math.PI) * Math.sin((Math.PI * x) / downMs));
  if (x < downMs + upMs) {
    const u = x - downMs;
    return 0.5 * downMs + 0.5 * (u + (upMs / Math.PI) * Math.sin((Math.PI * u) / upMs));
  }
  return 0.5 * (downMs + upMs);
}

/**
 * The template's closure as a camera frame stamped at `t` sees it: its average over the exposure
 * [t - exposure, t]. Exported so the simulation's camera and the fit cannot model exposure differently.
 */
export function frameClosure(t: number, startMs: number, downMs: number, upMs: number, exposureMs: number): number {
  if (!(exposureMs > 0)) return templateClosure(t - startMs, downMs, upMs);
  return (templateIntegral(t - startMs, downMs, upMs) - templateIntegral(t - exposureMs - startMs, downMs, upMs)) / exposureMs;
}

export interface BlinkFit {
  /** The fitted deepest EAR. */
  min_ear: number;
  /** Root-mean-square difference between the fitted curve and the frames, in EAR units. */
  rmse: number;
  /** Frames the fit used. */
  frames: number;
  /** The exposure the fit assumed, ms. */
  exposure_ms: number;
  /** The fitted down- and up-phase durations, ms (diagnostic: a value at a bound means a poor fit). */
  down_ms: number;
  up_ms: number;
}

/**
 * Fit the blink whose lowest frame is `samples[iMin]`. `open` is the eye's open level just before it;
 * `exposureMs` the camera exposure assumed (0 = an instantaneous frame). Null when the window has too
 * few frames, spans a gap, or the inputs are unusable — reported as missing, never guessed.
 */
export function fitBlinkMinimum(samples: EarSample[], iMin: number, open: number, exposureMs: number): BlinkFit | null {
  if (!(open > 0) || !Number.isFinite(open) || iMin < 0 || iMin >= samples.length) return null;
  if (!Number.isFinite(samples[iMin].t_ms) || !Number.isFinite(samples[iMin].ear)) return null;
  const lo = Math.max(0, iMin - FIT_BEFORE);
  const hi = Math.min(samples.length - 1, iMin + FIT_AFTER);
  const w = samples.slice(lo, hi + 1).filter((s) => Number.isFinite(s.t_ms) && Number.isFinite(s.ear));
  if (w.length < FIT_MIN_FRAMES) return null;
  for (let i = 1; i < w.length; i++) if (w[i].t_ms - w[i - 1].t_ms > FIT_MAX_GAP_MS) return null;
  const E = Number.isFinite(exposureMs) ? Math.max(0, exposureMs) : 0;
  const tLow = samples[iMin].t_ms;
  const dt = (w[w.length - 1].t_ms - w[0].t_ms) / Math.max(1, w.length - 1);
  const n = w.length;
  const g = new Float64Array(n);

  // Model: ear = open x (1 - a x closure); for given (tm, down, up), a (the depth, 0..1) has a closed-form
  // least-squares value. Returns the sum of squared residuals and that a.
  const evaluate = (tm: number, down: number, up: number): { sse: number; a: number } => {
    const start = tm - down;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      g[i] = frameClosure(w[i].t_ms, start, down, up, E);
      num += (open - w[i].ear) * g[i];
      den += open * g[i] * g[i];
    }
    if (!(den > 0)) return { sse: Infinity, a: 0 };
    const a = Math.min(1, Math.max(0, num / den));
    let sse = 0;
    for (let i = 0; i < n; i++) { const r = open * (1 - a * g[i]) - w[i].ear; sse += r * r; }
    return { sse, a };
  };

  // The deepest point lies within a frame or so of the lowest frame's exposure: search from 1.5 frames
  // before the start of that exposure to 1.5 frames after its stamp.
  const tFrom = tLow - E - 1.5 * dt, tTo = tLow + 1.5 * dt;
  let best = { sse: Infinity, a: 0, tm: tLow, down: 100, up: 220 };
  for (const down of FIT_DOWN_GRID_MS) {
    for (const up of FIT_UP_GRID_MS) {
      for (let tm = tFrom; tm <= tTo; tm += FIT_TMIN_STEP_MS) {
        const r = evaluate(tm, down, up);
        if (r.sse < best.sse) best = { ...r, tm, down, up };
      }
    }
  }
  if (!Number.isFinite(best.sse)) return null;

  // Pattern search from the best grid point: try a step either way on each parameter, keep any
  // improvement, halve the steps when none helps.
  const clamp = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));
  let step = { tm: FIT_TMIN_STEP_MS / 2, down: 10, up: 20 };
  for (let iter = 0; iter < 400 && step.tm >= 0.1; iter++) {
    let improved = false;
    const tries: Array<[number, number, number]> = [
      [best.tm + step.tm, best.down, best.up], [best.tm - step.tm, best.down, best.up],
      [best.tm, clamp(best.down + step.down, FIT_DOWN_BOUNDS_MS), best.up], [best.tm, clamp(best.down - step.down, FIT_DOWN_BOUNDS_MS), best.up],
      [best.tm, best.down, clamp(best.up + step.up, FIT_UP_BOUNDS_MS)], [best.tm, best.down, clamp(best.up - step.up, FIT_UP_BOUNDS_MS)],
    ];
    for (const [tm, down, up] of tries) {
      if (tm < tFrom || tm > tTo) continue;
      const r = evaluate(tm, down, up);
      if (r.sse < best.sse) { best = { ...r, tm, down, up }; improved = true; }
    }
    if (!improved) step = { tm: step.tm / 2, down: step.down / 2, up: step.up / 2 };
  }
  return {
    min_ear: open * (1 - best.a), rmse: Math.sqrt(best.sse / n), frames: n, exposure_ms: E,
    down_ms: best.down, up_ms: best.up,
  };
}
