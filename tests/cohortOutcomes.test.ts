/**
 * The All Participants tab's outcomes (dashboard/aggregate.ts cohortOutcomes, Round 98): averages by
 * condition across participants, the positive-minus-negative difference, and its trend as participants
 * completed. Checked against the pooled file read independently here, on a simulated cohort written
 * through the app's own export, with a withdrawn participant and a paused run that must not count.
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { simulateCohort } from '@/sim/analysisCohort';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { cohortOutcomes, inConfirmatorySet, meanCI, tQuantile975, COHORT_OUTCOMES } from '@/dashboard/aggregate';

const bundles = simulateCohort({ n: 10, seed: 4242, polarityEffectOnIncomplete: 0.4, withdrawn: [2], pausedLast: [5] });
const ds = buildAnalysisDataset(bundles);
// Completion order deliberately not code order: P010 first, then P009, ...
const completedAt = new Map(bundles.map((b, i) => [b.session.participant_id, 1_000_000 - i * 1000]));
const view = cohortOutcomes(ds.files, completedAt);

function readLong(): Record<string, string>[] {
  const text = ds.files.find((f) => f.filename === 'analysis_long.csv')!.content;
  const lines = text.trim().split('\n');
  const split = (l: string) => {
    const out: string[] = []; let cur = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}
const rows = readLong().filter((r) => inConfirmatorySet(r) && r.condition_complete !== 'false');

describe('the t quantile', () => {
  it('matches R qt(0.975, df) at and between the tabled points', () => {
    expect(tQuantile975(1)).toBeCloseTo(12.7062, 4);
    expect(tQuantile975(9)).toBeCloseTo(2.2622, 4);
    expect(tQuantile975(30)).toBeCloseTo(2.0423, 4);
    // Between tabled points (R: qt(0.975, 50) = 2.0086, qt(0.975, 200) = 1.9719): to 3 decimals.
    expect(tQuantile975(50)).toBeCloseTo(2.0086, 3);
    expect(tQuantile975(200)).toBeCloseTo(1.9719, 3);
  });
  it('gives no interval for fewer than two values', () => {
    expect(meanCI([3])).toEqual({ n: 1, mean: 3, lcl: null, ucl: null });
    expect(meanCI([])).toEqual({ n: 0, mean: null, lcl: null, ucl: null });
  });
});

describe('cohort outcomes', () => {
  it('reads the confirmatory set only: the withdrawn participant is out', () => {
    const withdrawn = bundles[2].session.participant_id;
    expect(view.participants).not.toContain(withdrawn);
    expect(view.participants.length).toBe(new Set(rows.map((r) => r.participant_id)).size);
  });

  it('orders participants by when they completed', () => {
    const expected = [...new Set(rows.map((r) => r.participant_id))]
      .sort((a, b) => (completedAt.get(a)! - completedAt.get(b)!));
    expect(view.participants).toEqual(expected);
  });

  it('averages one value per participant in each condition', () => {
    const o = COHORT_OUTCOMES.find((x) => x.key === 'rt_mean_hits_ms')!;
    for (const c of view.byCondition) {
      const perP = new Map<string, number[]>();
      for (const r of rows.filter((x) => x.condition_label === c.condition_label)) {
        const v = o.value(r);
        if (v != null) perP.set(r.participant_id, [...(perP.get(r.participant_id) ?? []), v]);
      }
      const values = [...perP.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
      const ref = meanCI(values);
      expect(c.cells.rt_mean_hits_ms.n).toBe(ref.n);
      expect(c.cells.rt_mean_hits_ms.mean).toBeCloseTo(ref.mean!, 9);
      expect(c.cells.rt_mean_hits_ms.lcl).toBeCloseTo(ref.lcl!, 9);
    }
  });

  it('leaves the eye outcomes of runs whose blink data is not usable out', () => {
    const ok = rows.filter((r) => r.ocular_reliability !== 'not_usable' && r.camera_active === 'true' && r.incomplete_blink_ratio !== '');
    const total = view.byCondition.reduce((n, c) => n + c.cells.incomplete_blink_ratio.n, 0);
    expect(total).toBe(new Set(ok.map((r) => `${r.participant_id}|${r.condition_label}`)).size);
  });

  it('the polarity difference is each participant\'s positive mean minus negative mean, averaged', () => {
    const key = 'incomplete_blink_ratio';
    const diffs: number[] = [];
    for (const p of view.participants) {
      const side = (pol: string) => {
        const byCond = new Map<string, number[]>();
        for (const r of rows.filter((x) => x.participant_id === p && x.polarity === pol
          && x.ocular_reliability !== 'not_usable' && x.camera_active === 'true' && x.incomplete_blink_ratio !== '')) {
          byCond.set(r.condition_label, [...(byCond.get(r.condition_label) ?? []), Number(r.incomplete_blink_ratio)]);
        }
        const cells = [...byCond.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
        return cells.length ? cells.reduce((a, b) => a + b, 0) / cells.length : null;
      };
      const a = side('positive'); const b = side('negative');
      if (a != null && b != null) diffs.push(a - b);
    }
    const ref = meanCI(diffs);
    expect(view.polarity[key].difference.n).toBe(ref.n);
    expect(view.polarity[key].difference.mean).toBeCloseTo(ref.mean!, 9);
  });

  it('the trend ends at the overall difference and grows one participant at a time', () => {
    for (const o of COHORT_OUTCOMES) {
      const t = view.trend[o.key];
      if (!t.length) continue;
      expect(t.map((x) => x.k)).toEqual(t.map((_, i) => i + 1));
      expect(t[t.length - 1].mean).toBeCloseTo(view.polarity[o.key].difference.mean!, 9);
      expect(t[0].lcl).toBeNull();
      // In completion order.
      const order = t.map((x) => view.participants.indexOf(x.participant));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });
});
