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
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Elapsed ms since a performance.now() timestamp. */
export function elapsed(since: number): number {
  return performance.now() - since;
}

export function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
