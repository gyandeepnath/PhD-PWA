/**
 * High-precision timing helpers.
 *
 * `setTimeout` on Android WebView is throttled and fires 4-15 ms late — a 3% error on a 500 ms
 * fixation. We busy-wait via requestAnimationFrame instead (max error ~one frame, ~16.7 ms) for
 * all timing-critical task phases. Mirrors the original build's timing.ts policy.
 */

/** Resolve after `ms`, measured with performance.now() and rAF (falls back to setTimeout in tests). */
export function rafDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      setTimeout(resolve, ms);
      return;
    }
    const start = performance.now();
    const tick = () => {
      if (performance.now() - start >= ms) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Inclusive random integer in [min, max]. */
export function randInt(rng: () => number, min: number, max: number): number {
  // An rng that returns exactly 1 (or anything outside [0,1)) pushed the result one past `max`.
  // Callers use this for fixation, delay and inter-trial durations and for stimulus placement, so
  // an out-of-range value is a silent protocol deviation rather than a crash. Non-finite bounds
  // used to yield NaN, which then became a NaN timeout.
  const lo = Number.isFinite(min) ? Math.floor(min) : 0;
  const hi = Number.isFinite(max) ? Math.floor(max) : lo;
  if (hi < lo) return lo;
  const r = rng();
  const u = Number.isFinite(r) ? Math.min(0.9999999999, Math.max(0, r)) : 0;
  return lo + Math.floor(u * (hi - lo + 1));
}

/** Elapsed ms since a performance.now() timestamp. */
export function elapsed(since: number): number {
  return performance.now() - since;
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
