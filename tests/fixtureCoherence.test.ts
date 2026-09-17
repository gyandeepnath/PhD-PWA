/**
 * THE GOLDEN FIXTURE MUST NOT CONTRADICT ITSELF.
 *
 * Every export test, both analysis-template gates and most of the stress suite run against
 * `buildFixtureBundle()`. It is the closest thing this project has to a known-good participant, and
 * until now nothing checked that its derived fields agreed with the fields they are derived from.
 * They did not. Among the ones found:
 *
 *   - `incomplete_blink_ratio` ran 0.050-0.329 while the counts it is the ratio OF were constant at
 *     8/40 = 0.2, so the exported row disagreed with itself and both templates — which build the
 *     primary response from the counts — fitted a constant.
 *   - `fatigue_mean` ran 1.00-4.33 while its five item columns were constant at an item mean of 1.6,
 *     and condition 1 reported fatigue FALLING while every item was at or above baseline.
 *   - CVS-Q `total_score` said 3 and 11 where the real scorer gives 0 and 16, on the key secondary.
 *   - `ear_sample_count` implied 87 fps beside an `effective_fps` of 29.4 in the same record.
 *
 * None of these could be caught by a test that only checks a value round-trips through the export,
 * because the value round-trips perfectly. They are caught by RE-DERIVING each one from its own
 * components and requiring agreement.
 */
import { describe, it, expect } from 'vitest';
import { buildFixtureBundle, readingMs, ibrFor, fatigueMean, fatigueBaselineMean } from '@/sim/bundleFixture';
import { scoreCvsq } from '@/scales/cvsq';
import { PASSAGES } from '@/experiment/passages';
import { ENGAGEMENT } from '@/dashboard/aggregate';

const bundle = buildFixtureBundle();

describe('the primary outcome agrees with its own numerator and denominator', () => {
  it('has a ratio equal to incomplete / total blinks, in every condition', () => {
    bundle.eyeMetrics.forEach((m, i) => {
      const total = m.blink_count_full! + m.blink_count_micro! + m.blink_count_incomplete!;
      expect(total).toBeGreaterThan(0);
      expect(m.incomplete_blink_ratio).toBeCloseTo(m.blink_count_incomplete! / total, 4);
      expect(m.incomplete_blink_ratio).toBe(ibrFor(i));
    });
  });

  it('varies the denominator, which is the whole reason the outcome is binomial', () => {
    // A proportion from 35 blinks is not the same measurement as one from 62. A constant denominator
    // cannot exercise the weighting the binomial model exists to apply.
    const totals = bundle.eyeMetrics.map((m) => m.blink_count_full! + m.blink_count_micro! + m.blink_count_incomplete!);
    expect(new Set(totals).size).toBe(totals.length);
  });

  it('varies the ratio, so a model fitted on it has something to estimate', () => {
    const ratios = bundle.eyeMetrics.map((m) => m.incomplete_blink_ratio);
    expect(new Set(ratios).size).toBeGreaterThan(5);
  });

  it('has a blink rate equal to the counts over the observed exposure', () => {
    bundle.eyeMetrics.forEach((m) => {
      const total = m.blink_count_full! + m.blink_count_micro! + m.blink_count_incomplete!;
      expect(m.blink_rate).toBeCloseTo(total / (m.observed_duration_ms! / 60000), 1);
    });
  });

  it('reports a blink rate in the physiological range', () => {
    // Not a style point: a fixture at 39/min was a symptom of the reading exposure being wrong.
    for (const m of bundle.eyeMetrics) {
      expect(m.blink_rate!).toBeGreaterThan(5);
      expect(m.blink_rate!).toBeLessThan(35);
    }
  });

  it('takes EAR samples at a rate consistent with its own effective_fps', () => {
    for (const m of bundle.eyeMetrics) {
      const implied = m.ear_sample_count! / (m.observed_duration_ms! / 1000);
      expect(implied).toBeCloseTo(m.effective_fps!, 0);
    }
  });
});

describe('subjective fatigue agrees with the items it is the mean of', () => {
  const itemsOf = (f: Record<string, number>) => [f.eye_strain, f.dryness, f.blur, f.burning, f.headache];

  it('has fatigue_mean equal to the mean of the five items, on every row', () => {
    for (const f of bundle.fatigue as unknown as Record<string, number>[]) {
      const items = itemsOf(f);
      expect(items.every((v) => Number.isFinite(v))).toBe(true);
      expect(f.fatigue_mean).toBeCloseTo(items.reduce((a, b) => a + b, 0) / items.length, 2);
    }
  });

  it('never reports fatigue falling while every item is at or above baseline', () => {
    // The exact contradiction that was there: fatigue_delta -0.20 with all items >= baseline.
    const post = (bundle.fatigue as unknown as Record<string, number>[]).filter((f) => f.stage as unknown === 'post_condition');
    for (const f of post) expect(f.fatigue_mean - fatigueBaselineMean()).toBeGreaterThanOrEqual(0);
  });

  it('rises over time on task, which is the effect the design is built to detect', () => {
    const means = bundle.fatigue
      .filter((f) => f.stage === 'post_condition')
      .map((f) => f.fatigue_mean);
    expect(means[means.length - 1]).toBeGreaterThan(means[0]);
    expect(means[9]).toBe(fatigueMean(9));
  });
});

describe('the CVS-Q total agrees with the real scorer', () => {
  it('scores every row with scoreCvsq rather than a hand-picked total', () => {
    for (const c of bundle.cvsq) {
      const scored = scoreCvsq(c.frequency, c.intensity);
      expect(c.total_score).toBe(scored.total);
      expect(c.symptomatic).toBe(scored.symptomatic);
    }
  });

  it('moves the key secondary between baseline and session end', () => {
    const base = bundle.cvsq.find((c) => c.stage === 'baseline')!;
    const end = bundle.cvsq.find((c) => c.stage === 'session_end')!;
    expect(end.total_score).toBeGreaterThan(base.total_score);
  });
});

describe('the reading exposure is one a participant could actually have produced', () => {
  it('reads below the speed the app itself calls skimming', () => {
    /*
     * The fixture was 480-560 wpm against a 400 wpm skim ceiling, so the bundle whose comment calls
     * it "a normal first pass through the protocol" was a participant the app flagged as skimming
     * all ten passages — and every export and aggregate test ran down the penalised branch with
     * nothing asserting it either way.
     */
    bundle.conditions.forEach((c, i) => {
      const words = PASSAGES[c.passage_id!].wordCount;
      const wpm = words / (readingMs(i) / 60000);
      expect(wpm).toBeLessThan(ENGAGEMENT.SKIM_WPM_CEILING);
      expect(wpm).toBeGreaterThan(80); // and not so slow as to be its own anomaly
    });
  });

  it('never claims the camera observed more of the exposure than the exposure lasted', () => {
    bundle.eyeMetrics.forEach((m, i) => {
      expect(m.observed_duration_ms!).toBeLessThanOrEqual(readingMs(i));
    });
  });
});
