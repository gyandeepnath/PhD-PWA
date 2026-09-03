/**
 * A foreperiod the participant cannot anticipate, and a trial order without long runs.
 *
 * THE FOREPERIOD PROBLEM. The interval between the fixation cross and the dot was drawn from two
 * uniform distributions, giving a total of 700-1400 ms. A bounded distribution has a RISING hazard
 * function: the longer the participant has waited without a stimulus, the more certain it is that
 * one is imminent. Measured on the shipped distribution, the chance of the dot appearing in the
 * next 100 ms given it had not yet appeared went 5% at 700 ms, 25% at 900 ms, 50% at 1100 ms, and
 * 100% by 1300 ms. The participant does not need to reason about any of that to exploit it — the
 * timing is learned implicitly within a few trials, readiness is timed to match, and reaction time
 * falls as the foreperiod lengthens.
 *
 * That is the classic variable-foreperiod effect, and it matters here for a specific reason: this
 * study attributes RT differences to display polarity and text colour. Anything that makes RT
 * depend on trial timing instead adds variance to exactly the measure the hypothesis rests on, and
 * a participant who becomes better at anticipating over a 90-minute sitting adds variance that is
 * correlated with time-on-task.
 *
 * THE FIX. A truncated exponential has a constant hazard over its support: having waited tells the
 * participant nothing about how much longer they will wait. This is the standard remedy, sometimes
 * called a "non-aging" foreperiod. Truncation reintroduces a little rise at the very top of the
 * range, which is why the range is wide relative to the mean — the mass near the ceiling is small.
 *
 * THE RUN PROBLEM. Trials were an unconstrained shuffle of exactly 20 go and 12 no-go. Two
 * consequences. Long runs occur by chance, and a run of six or seven go trials primes a response
 * strongly enough that the next no-go draws a false alarm that says more about the run than about
 * the display. And because the counts are fixed, the tail of the block is partly determined: once
 * the twelfth no-go has been seen, every remaining trial is a go.
 */

/**
 * Draw from a truncated exponential on `[min, max]` with the given mean.
 *
 * `rand` is injected so the draw is testable and so a seeded stream can be used where
 * reproducibility matters.
 */
export function nonAgingDelay(min: number, max: number, mean: number, rand: () => number = Math.random): number {
  if (!(max > min)) return min;
  // The exponential's own mean, before truncation shifts it. Clamped away from the degenerate ends.
  const scale = Math.max(1, mean - min);
  const range = max - min;
  // Inverse-transform sampling on the exponential, conditioned on landing inside the range.
  const u = Math.min(0.999999, Math.max(1e-9, rand()));
  const cap = 1 - Math.exp(-range / scale);
  const x = -scale * Math.log(1 - u * cap);
  return Math.min(max, min + x);
}

/**
 * Empirical hazard of a sample, for testing: the probability the event lands in the next `width`
 * given it has not landed yet. Constant hazard is the property that makes a foreperiod non-aging.
 */
export function hazardProfile(samples: number[], from: number, to: number, width: number): number[] {
  const out: number[] = [];
  for (let t = from; t + width <= to; t += width) {
    const atRisk = samples.filter((s) => s >= t).length;
    if (atRisk === 0) { out.push(NaN); continue; }
    const inNext = samples.filter((s) => s >= t && s < t + width).length;
    out.push(inNext / atRisk);
  }
  return out;
}

/**
 * Shuffle go/no-go trials with no run longer than `maxRun` of the same kind.
 *
 * Rejection-free: it places trials one at a time, choosing from whichever kinds are still available
 * and would not extend a run past the cap. When only the capped kind remains — which the fixed
 * counts make possible near the end — the cap is relaxed rather than looping forever, and the
 * caller is told, because silently returning a sequence that violates its own constraint is worse
 * than a longer run.
 */
export function planRuns(
  nGo: number,
  nNoGo: number,
  maxRun: number,
  rand: () => number = Math.random,
): { order: boolean[]; capRespected: boolean } {
  const order: boolean[] = [];
  let go = nGo;
  let noGo = nNoGo;
  let run = 0;
  let last: boolean | null = null;
  let capRespected = true;

  /**
   * Can the remaining trials still be arranged within the cap?
   *
   * With `sep` trials of the other kind acting as separators, the capped kind fits in `sep + 1`
   * runs of at most `maxRun` — less whatever the run in progress has already consumed. Checking
   * this BEFORE each placement is the difference between a cap that holds and one that is merely
   * hoped for: a greedy weighted pick exhausts the scarcer kind early and leaves a long tail of the
   * other, which is exactly the deterministic ending the cap exists to prevent.
   */
  const arrangeable = (g: number, n: number, r: number, l: boolean | null): boolean => {
    const capacityFor = (count: number, sep: number, sameAsLast: boolean) => {
      const headroom = sameAsLast ? maxRun - r : maxRun;
      return count <= headroom + sep * maxRun;
    };
    return capacityFor(g, n, l === true) && capacityFor(n, g, l === false);
  };

  while (go > 0 || noGo > 0) {
    const options: boolean[] = [];
    if (go > 0 && !(last === true && run >= maxRun) && arrangeable(go - 1, noGo, last === true ? run + 1 : 1, true)) {
      options.push(true);
    }
    if (noGo > 0 && !(last === false && run >= maxRun) && arrangeable(go, noGo - 1, last === false ? run + 1 : 1, false)) {
      options.push(false);
    }

    let pick: boolean;
    if (options.length === 0) {
      // No legal placement remains. Finish rather than loop, and say so: a sequence that silently
      // breaks its own constraint is worse than one that reports having had to.
      pick = go > 0;
      capRespected = false;
    } else if (options.length === 1) {
      pick = options[0];
    } else {
      // Both legal: weight by what remains so the kinds stay interleaved.
      pick = rand() < go / (go + noGo);
    }

    order.push(pick);
    if (pick) go--; else noGo--;
    run = last === pick ? run + 1 : 1;
    last = pick;
  }

  return { order, capRespected };
}

/** Longest run of identical values, for testing and for the trial-order quality flag. */
export function longestRun(order: boolean[]): number {
  let best = 0;
  let run = 0;
  let last: boolean | null = null;
  for (const v of order) {
    run = v === last ? run + 1 : 1;
    last = v;
    if (run > best) best = run;
  }
  return best;
}
