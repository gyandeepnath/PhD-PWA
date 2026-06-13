/**
 * Deterministic, seedable PRNG and the sampling distributions used by the simulation harness.
 * Determinism (mulberry32) makes simulated datasets reproducible from a seed — essential for
 * regression tests and for the randomisation_seed provenance story.
 */

export type Rng = () => number;

/** mulberry32 — fast, well-distributed 32-bit PRNG seeded from an integer. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller, scaled to (mean, sd). */
export function gaussian(rng: Rng, mean = 0, sd = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + sd * z;
}

/** Exponential with mean `tau`. */
export function exponential(rng: Rng, tau: number): number {
  return -tau * Math.log(1 - rng());
}

/**
 * Ex-Gaussian RT (ms): Gaussian(mu, sigma) + Exponential(tau). The canonical RT model —
 * a near-normal body with a positive right tail. Floored at 150 ms (anticipations excluded).
 */
export function exGaussian(rng: Rng, mu: number, sigma: number, tau: number): number {
  return Math.max(150, gaussian(rng, mu, sigma) + exponential(rng, tau));
}

export function bernoulli(rng: Rng, p: number): boolean {
  return rng() < Math.min(1, Math.max(0, p));
}

/** Logistic function — maps a linear predictor to a probability. */
export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Sample event onset times (ms) from a homogeneous Poisson process of `ratePerMin` over `durationMs`. */
export function poissonEventTimes(rng: Rng, ratePerMin: number, durationMs: number): number[] {
  const times: number[] = [];
  const meanIntervalMs = 60000 / Math.max(0.01, ratePerMin);
  let t = exponential(rng, meanIntervalMs);
  while (t < durationMs) {
    times.push(t);
    t += exponential(rng, meanIntervalMs);
  }
  return times;
}
