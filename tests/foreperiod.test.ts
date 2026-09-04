/**
 * The reaction task must not be anticipatable, and its trial order must not prime responses.
 *
 * Both faults were reported from a real session as "the reaction task seems slightly predictable".
 * Both were real, and both were measurable rather than matters of taste.
 */
import { describe, it, expect } from 'vitest';
import { nonAgingDelay, hazardProfile, planRuns, longestRun } from '@/lib/foreperiod';
import { CONFIG } from '@/experiment/config';

/** A deterministic uniform stream, so these tests never flake on an unlucky draw. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const sample = (n: number, min: number, max: number, mean: number, seed = 12345) => {
  const r = lcg(seed);
  return Array.from({ length: n }, () => nonAgingDelay(min, max, mean, r));
};

describe('the foreperiod is non-aging', () => {
  const MIN = 300, MAX = 1600, MEAN = 650;

  it('stays inside its range', () => {
    const xs = sample(20000, MIN, MAX, MEAN);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(MIN);
    expect(Math.max(...xs)).toBeLessThanOrEqual(MAX);
  });

  it('has a roughly constant hazard, which is the whole point', () => {
    // The old uniform 400-900 went from 5% to 100% across its range: having waited told the
    // participant the dot was imminent, so they timed their readiness and RT fell with foreperiod.
    const xs = sample(200000, MIN, MAX, MEAN);
    const h = hazardProfile(xs, MIN, MIN + 900, 150).filter((x) => Number.isFinite(x));
    expect(h.length).toBeGreaterThan(3);
    const lo = Math.min(...h);
    const hi = Math.max(...h);
    // Truncation puts a little rise at the very top; a factor of two across the body is flat
    // compared with the twentyfold climb it replaces.
    expect(hi / lo).toBeLessThan(2);
  });

  it('is dramatically flatter than the uniform it replaced', () => {
    const r = lcg(7);
    const uniform = Array.from({ length: 200000 }, () =>
      300 + r() * 200 + 400 + r() * 500);
    const uh = hazardProfile(uniform, 700, 1400, 150).filter((x) => Number.isFinite(x) && x > 0);
    const newer = sample(200000, MIN, MAX, MEAN).map((d) => d + 400);
    const nh = hazardProfile(newer, 700, 1600, 150).filter((x) => Number.isFinite(x) && x > 0);
    const spread = (h: number[]) => Math.max(...h) / Math.min(...h);
    expect(spread(nh)).toBeLessThan(spread(uh) / 3);
  });

  it('delivers the mean it is asked for, across several targets', () => {
    /*
     * The parameter is called `mean`, and it used to be used as the untruncated exponential scale —
     * so truncation pulled the realised mean below it, by more the larger the request. Measured on
     * the shipped bounds: asking for 650 gave 618, asking for 900 gave 732. A parameter that does
     * not deliver what its name promises is a quiet lie in a timing-critical path, and it also made
     * the protocol timing model overstate every RT block by 300 ms a trial.
     */
    for (const target of [400, 650, 900]) {
      const xs = sample(120000, MIN, MAX, target, 4242);
      const realised = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(Math.abs(realised - target), `asked for ${target}, got ${realised.toFixed(1)}`)
        .toBeLessThan(target * 0.02);
    }
  });

  it('never returns a non-finite delay, which would wait forever', () => {
    // The value goes straight to rafDelay(), where NaN does not throw — it hangs. The RT block has
    // no Pause control while trials run, so that strands a participant on a blank screen.
    for (const [min, max, mean] of [[NaN, 1600, 650], [300, NaN, 650], [300, 1600, NaN], [NaN, NaN, NaN]]) {
      expect(Number.isFinite(nonAgingDelay(min, max, mean)),
        `nonAgingDelay(${min}, ${max}, ${mean}) was not finite`).toBe(true);
    }
  });

  it('preserves the mean foreperiod, so block duration is unchanged', () => {
    const xs = sample(200000, MIN, MAX, MEAN);
    const meanTotal = 400 + xs.reduce((a, b) => a + b, 0) / xs.length;
    // The old design averaged 400 + 650 = 1050 ms. Session length must not move because of this.
    expect(Math.abs(meanTotal - 1050)).toBeLessThan(60);
  });

  it('reports the floor rather than a fabricated draw for a degenerate range', () => {
    expect(nonAgingDelay(500, 500, 500)).toBe(500);
    expect(nonAgingDelay(500, 400, 450)).toBe(500);
  });
});

describe('trial order carries no long runs', () => {
  const N = CONFIG.RT_TRIALS_PER_CONDITION;
  const nGo = Math.round(N * CONFIG.RT_GO_RATE);
  const nNoGo = N - nGo;

  it('respects the cap on every block, with no relaxation needed', () => {
    const r = lcg(99);
    let worst = 0;
    let relaxed = 0;
    for (let i = 0; i < 5000; i++) {
      const plan = planRuns(nGo, nNoGo, CONFIG.RT_MAX_RUN, r);
      worst = Math.max(worst, longestRun(plan.order));
      if (!plan.capRespected) relaxed++;
    }
    expect(worst).toBeLessThanOrEqual(CONFIG.RT_MAX_RUN);
    expect(relaxed, 'the cap had to be relaxed, so the constraint is not actually achievable')
      .toBe(0);
  });

  it('keeps the exact go and no-go counts, so d-prime is computed on the intended denominators', () => {
    const r = lcg(5);
    for (let i = 0; i < 500; i++) {
      const { order } = planRuns(nGo, nNoGo, CONFIG.RT_MAX_RUN, r);
      expect(order.length).toBe(N);
      expect(order.filter(Boolean).length).toBe(nGo);
    }
  });

  it('does not leave a deterministic tail', () => {
    // With an unconstrained shuffle the last no-go could arrive early, after which every remaining
    // trial was a go. Check the final quarter still contains both kinds most of the time.
    const r = lcg(31);
    let mixedTails = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i++) {
      const { order } = planRuns(nGo, nNoGo, CONFIG.RT_MAX_RUN, r);
      const tail = order.slice(Math.floor(N * 0.75));
      if (tail.some(Boolean) && tail.some((x) => !x)) mixedTails++;
    }
    expect(mixedTails / runs).toBeGreaterThan(0.95);
  });

  it('is not the same sequence every block', () => {
    const r = lcg(77);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(planRuns(nGo, nNoGo, CONFIG.RT_MAX_RUN, r).order.map((b) => (b ? '1' : '0')).join(''));
    }
    expect(seen.size).toBeGreaterThan(190);
  });
});
