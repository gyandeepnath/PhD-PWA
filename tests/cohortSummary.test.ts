/**
 * The cohort view answers a question the per-sitting dashboard cannot.
 *
 * "Did this sitting work" and "is the study working" fail in different ways. A single sitting can
 * look perfect while a condition is quietly broken in all of them — a colour that never yields usable
 * blink data, a position that is always thin, an exclusion rule firing far more than expected. Those
 * are visible only across participants, and noticing them at analysis is noticing them too late.
 *
 * These tests pin the arithmetic, because a summary that is subtly wrong is worse than none: it would
 * be believed.
 */
import { describe, it, expect } from 'vitest';
import { cohortSummary } from '@/dashboard/aggregate';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { N_CONDITIONS } from '@/experiment/conditions';

/** n independent participants, built from the fixture with distinct ids and condition ids. */
function cohort(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const base = buildFixtureBundle();
    const pid = `P${String(i + 1).padStart(3, '0')}`;
    const esc = (v: string) => JSON.stringify(v).slice(1, -1);
    let json = JSON.stringify(base)
      .split(esc(base.session.participant_id)).join(pid)
      .split(esc(base.session.session_id)).join(`S${String(i + 1).padStart(3, '0')}`);
    for (const c of base.conditions) json = json.split(esc(c.condition_id)).join(`${pid}-${c.condition_id}`);
    const b = JSON.parse(json);
    b.session.enrolment_number = i + 1;
    return b;
  });
}

const summarise = (n: number) => {
  const ds = buildAnalysisDataset(cohort(n));
  return cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
};

describe('the cohort summary pools every participant', () => {
  it('counts one row per participant per condition', () => {
    const s = summarise(6);
    expect(s.participants).toBe(6);
    expect(s.rows).toBe(6 * N_CONDITIONS);
    expect(s.conditions).toHaveLength(N_CONDITIONS);
  });

  it('gives every condition the same n when every participant completed', () => {
    // This is the number the researcher scans for. A condition falling behind the others is the
    // earliest visible sign that something about it is failing.
    const s = summarise(6);
    expect(s.minConditionN).toBe(6);
    expect(s.maxConditionN).toBe(6);
    for (const c of s.conditions) expect(c.n).toBe(6);
  });

  it('reports the blink total behind each mean, not only the row count', () => {
    // The incomplete-blink ratio's precision rests on how many blinks were counted, not on how many
    // rows exist. Ten rows of four blinks each is not ten measurements.
    const s = summarise(4);
    for (const c of s.conditions) {
      expect(c.n_with_outcome).toBeGreaterThan(0);
      expect(c.blinks_total).toBeGreaterThan(c.n_with_outcome);
    }
  });

  it('keeps the mean inside the unit interval, or null when nothing supports one', () => {
    for (const c of summarise(3).conditions) {
      if (c.mean_ibr === null) { expect(c.n_with_outcome).toBe(0); continue; }
      expect(c.mean_ibr).toBeGreaterThanOrEqual(0);
      expect(c.mean_ibr).toBeLessThanOrEqual(1);
    }
  });

  it('tallies where each condition sat in the running order', () => {
    // Williams counterbalancing should spread each condition across positions. A real run drifts,
    // and a condition stuck late in every sitting carries fatigue that position_c cannot separate.
    const s = summarise(5);
    for (const c of s.conditions) {
      const spread = s.positionBalance[c.condition_label];
      expect(spread).toBeDefined();
      expect(spread).toHaveLength(N_CONDITIONS);
      expect(spread.reduce((a, b) => a + b, 0)).toBe(5);
    }
  });

  it('carries the join check through rather than re-deciding it', () => {
    const s = summarise(4);
    expect(s.analysable_participants).toBeLessThanOrEqual(s.participants);
    expect(Array.isArray(s.issues)).toBe(true);
  });

  it('survives an empty device without inventing numbers', () => {
    const ds = buildAnalysisDataset([]);
    const s = cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
    expect(s.rows).toBe(0);
    expect(s.conditions).toEqual([]);
    expect(s.minConditionN).toBe(0);
    expect(s.exclusions).toEqual([]);
  });

  it('does not treat a missing frame-rate flag as an inadequate one', () => {
    // Blank means the camera never ran, which is neither adequate nor inadequate. Counting it as
    // inadequate would invent a camera problem in every sitting that refused the camera.
    const s = summarise(3);
    for (const c of s.conditions) expect(c.n_fps_inadequate).toBe(0);
  });
});

describe('an unfinished condition does not enter the cohort outcome or the balance check', () => {
  it('counts a paused run but keeps it out of the mean and the position balance', () => {
    // This tab pools every sitting as it is saved, and exists to show whether conditions behave as
    // expected. A sitting paused mid-condition used to put its partial condition into both.
    const bundles = cohort(3);
    const pausedLabel = bundles[0].conditions[4].condition_label;
    bundles[0].conditions[4] = { ...bundles[0].conditions[4], completed_at: null };
    const ds = buildAnalysisDataset(bundles);
    const s = cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
    const row = s.conditions.find((c) => c.condition_label === pausedLabel)!;
    expect(row.n).toBe(3);
    expect(row.n_unfinished).toBe(1);
    // Only the two finished runs of that condition can carry the outcome.
    expect(row.n_with_outcome).toBeLessThanOrEqual(2);
    const balance = s.positionBalance[pausedLabel].reduce((a, b) => a + b, 0);
    expect(balance).toBe(2);
    expect(s.exclusions.some((e) => /condition_incomplete/.test(e.reason))).toBe(true);
  });
});

describe('the cohort tab counts the rows the analysis templates model, and says which mean it shows', () => {
  it('reports the confirmatory and sensitivity sets the templates apply', () => {
    // One participant paused a run (incomplete: out of the confirmatory set, its nine finished runs
    // in the sensitivity set), one sitting ran under the test harness (out of both).
    const bundles = cohort(4);
    bundles[1].conditions[3] = { ...bundles[1].conditions[3], completed_at: null };
    bundles[2].session.e2e_timing = true;
    const ds = buildAnalysisDataset(bundles);
    const s = cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
    expect(s.confirmatory).toEqual({ rows: 2 * N_CONDITIONS, participants: 2 });
    expect(s.sensitivity).toEqual({ rows: 3 * N_CONDITIONS - 1, participants: 3 });
    expect(s.conditions.reduce((n, c) => n + c.n_analysable, 0)).toBe(2 * N_CONDITIONS);
  });

  it('keeps a lone repeat-pass sitting out, which the join check alone would admit', () => {
    // A repeat pass whose first pass is no longer on the device has one sitting and ten runs, so the
    // join check calls it analysable. Its reading, comprehension and search are second-exposure values.
    const bundles = cohort(3);
    bundles[0].session.protocol_pass = 1;
    const ds = buildAnalysisDataset(bundles);
    expect(ds.integrity.analysable_participants).toBe(3);
    const s = cohortSummary(ds.files, ds.integrity, N_CONDITIONS);
    expect(s.confirmatory.participants).toBe(2);
    expect(s.sensitivity.participants).toBe(2);
  });

  it('shows the pooled ratio the binomial model weights by beside the mean of per-run ratios', () => {
    const csv = [
      'participant_id,condition_label,polarity,text_colour,analysable,withdrawn,e2e_timing,protocol_pass,condition_complete,exclusion_reason,n_incomplete,n_blinks_total,incomplete_blink_ratio,session_position',
      // 1 of 10 and 30 of 60: per-run ratios 0.1 and 0.5 (mean 0.3); pooled 31/70.
      'A,P1,positive,achromatic,true,false,false,0,true,,1,10,0.1,0',
      'B,P1,positive,achromatic,true,false,false,0,true,,30,60,0.5,1',
    ].join('\n');
    const s = cohortSummary([{ filename: 'analysis_long.csv', content: csv }],
      { total_participants: 2, analysable_participants: 2, issues: [] }, N_CONDITIONS);
    expect(s.conditions[0].mean_ibr).toBeCloseTo(0.3);
    expect(s.conditions[0].pooled_ibr).toBeCloseTo(31 / 70);
    expect(s.conditions[0].incomplete_total).toBe(31);
  });
});
