/**
 * The All Participants tab's outcomes (dashboard/aggregate.ts cohortOutcomes, Rounds 98 and 99):
 * averages by condition across participants, the positive-minus-negative difference, and its trend as
 * participants completed. Checked against the pooled file read independently here, on a simulated
 * cohort written through the app's own export, with what a real study produces and the figures must
 * survive: a withdrawn participant, a paused one, two runs whose frame rate fell into tier C, and a
 * sitting split in two whose second half ran with the camera off, so that one participant has eye data
 * in one polarity only (Williams row 7 runs a polarity per half).
 */
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { simulateCohort } from '@/sim/analysisCohort';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { disabledEyeMetrics } from '@/tracking/aggregator';
import {
  cohortOutcomes, cohortSummary, inConfirmatorySet, inEyeModels, meanCI, tQuantile975, fixedNoNegZero, COHORT_OUTCOMES,
} from '@/dashboard/aggregate';
import { niceScale, countTicks, trendAxis } from '@/dashboard/charts';

const WITHDRAWN = 2;
const PAUSED = 5;
/** Enrolment 8, Williams row 7: N3 N4 N2 N5 N1 | P1 P5 P2 P4 P3. Split, the camera off in the second sitting. */
const SPLIT = 7;
/** Two runs in frame-rate tier C. */
const TIER_C = 8;

const bundles = simulateCohort({
  n: 10, seed: 4242, polarityEffectOnIncomplete: 0.4, withdrawn: [WITHDRAWN], pausedLast: [PAUSED], split: [SPLIT],
});
const pid = (i: number) => `P${String(i + 1).padStart(3, '0')}`;
const second = bundles.find((b) => b.session.participant_id === pid(SPLIT) && b.session.session_index === 2)!;
second.eyeMetrics = second.eyeMetrics.map((e) => disabledEyeMetrics(e.condition_id, e.session_id, 'not_running'));
second.ocularEvents = [];
const slow = bundles.find((b) => b.session.participant_id === pid(TIER_C))!;
for (const e of slow.eyeMetrics.slice(0, 2)) e.ear_sample_count = Math.round((10 * e.observed_duration_ms!) / 1000) + 1;

const ds = buildAnalysisDataset(bundles);
// Completion order deliberately not code order: P010 first, then P009, ... The split participant's
// first sitting ends before everyone's and their second in the middle, so they completed third: by the
// last of their sittings, and in a place the eye trend must skip (Round 100).
const first = bundles.find((b) => b.session.participant_id === pid(SPLIT) && b.session.session_index !== 2)!;
const sittingEnd = new Map(bundles.map((b, i) => [b.session.session_id,
  b === second ? 993_500 : b === first ? 900_000 : 1_000_000 - i * 1000]));
const view = cohortOutcomes(ds.files, sittingEnd);

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
const all = readLong();
const rows = all.filter((r) => inConfirmatorySet(r));
/** The eye-model rows, written out again here rather than calling inEyeModels. */
const eyeRow = (r: Record<string, string>) => r.camera_active === 'true' && Number(r.n_blinks_total) > 0 && r.fps_tier !== 'C';
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One value per participant and condition, as the tab defines it, computed here independently. */
function cellsOf(key: string): Map<string, Map<string, number>> {
  const o = COHORT_OUTCOMES.find((x) => x.key === key)!;
  const acc = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    if (o.ocular && !eyeRow(r)) continue;
    const v = o.value(r);
    if (v == null) continue;
    const m = acc.get(r.participant_id) ?? new Map<string, number[]>();
    acc.set(r.participant_id, m);
    m.set(r.condition_label, [...(m.get(r.condition_label) ?? []), v]);
  }
  return new Map([...acc].map(([p, m]) => [p, new Map([...m].map(([c, xs]) => [c, mean(xs)]))]));
}
const colourOf = new Map(rows.map((r) => [r.condition_label, { polarity: r.polarity, colour: r.text_colour }]));

describe('the t quantile and the interval', () => {
  it('matches R qt(0.975, df) at and between the tabled points', () => {
    expect(tQuantile975(1)).toBeCloseTo(12.7062, 4);
    expect(tQuantile975(9)).toBeCloseTo(2.2622, 4);
    expect(tQuantile975(30)).toBeCloseTo(2.0423, 4);
    // Between tabled points (R: qt(0.975, 50) = 2.0086, qt(0.975, 200) = 1.9719): to 3 decimals.
    expect(tQuantile975(50)).toBeCloseTo(2.0086, 3);
    expect(tQuantile975(200)).toBeCloseTo(1.9719, 3);
  });
  it('is mean ± t(n-1)·sd/√n, as R t.test gives it, and gives no interval for fewer than two values', () => {
    // R: t.test(c(1, 3))$conf.int = -10.70620 14.70620
    const m = meanCI([1, 3]);
    expect(m.mean).toBe(2);
    expect(m.lcl).toBeCloseTo(-10.7062, 4);
    expect(m.ucl).toBeCloseTo(14.7062, 4);
    expect(meanCI([3])).toEqual({ n: 1, mean: 3, lcl: null, ucl: null });
    expect(meanCI([])).toEqual({ n: 0, mean: null, lcl: null, ucl: null });
  });
});

describe('the rows the eye-data models read', () => {
  it('needs the camera on, a blink counted and a frame rate not in tier C', () => {
    const base = { camera_active: 'true', n_blinks_total: '20', fps_tier: 'A' };
    expect(inEyeModels(base)).toBe(true);
    expect(inEyeModels({ ...base, fps_tier: 'B' })).toBe(true);
    expect(inEyeModels({ ...base, fps_tier: 'C' })).toBe(false);
    expect(inEyeModels({ ...base, n_blinks_total: '0' })).toBe(false);
    expect(inEyeModels({ ...base, n_blinks_total: '' })).toBe(false);
    expect(inEyeModels({ ...base, camera_active: 'false' })).toBe(false);
  });

  it('the simulated cohort carries what the filter must remove: tier-C runs with values, and a camera-off half', () => {
    const tierC = rows.filter((r) => r.participant_id === pid(TIER_C) && r.fps_tier === 'C');
    expect(tierC.length).toBe(2);
    expect(tierC.every((r) => r.camera_active === 'true' && r.incomplete_blink_ratio !== '' && r.ocular_reliability === 'not_usable')).toBe(true);
    const off = rows.filter((r) => r.participant_id === pid(SPLIT) && r.camera_active === 'false');
    expect(off.length).toBe(5);
    expect(new Set(off.map((r) => r.polarity))).toEqual(new Set(['positive']));
  });

  it('the existing table holds "with outcome" against the camera-on analysable rows, not every pooled row', () => {
    const head = 'participant_id,condition_label,polarity,text_colour,analysable,withdrawn,e2e_timing,protocol_pass,condition_complete,camera_active,fps_tier,n_incomplete,n_blinks_total,incomplete_blink_ratio,session_position';
    const csv = [head,
      'A,P1,positive,achromatic,true,false,false,0,true,true,A,4,20,0.2,0',
      // No camera: analysable, not an eye row, not camera-on.
      'B,P1,positive,achromatic,true,false,false,0,true,false,,,,,1',
      // Withdrawn and not analysable: in n only.
      'C,P1,positive,achromatic,false,true,false,0,true,true,A,4,20,0.2,2',
      // Camera on, tier C: camera-on, not an eye row.
      'D,P1,positive,achromatic,true,false,false,0,true,true,C,4,20,0.2,3',
    ].join('\n');
    const s = cohortSummary([{ filename: 'analysis_long.csv', content: csv }],
      { total_participants: 4, analysable_participants: 3, issues: [] }, 10);
    const c = s.conditions[0];
    expect([c.n, c.n_analysable, c.n_camera_on, c.n_with_outcome]).toEqual([4, 3, 2, 1]);
  });

  it('the existing primary-outcome table reads the same rows (tier C out of its mean and pooled ratio)', () => {
    const csv = [
      'participant_id,condition_label,polarity,text_colour,analysable,withdrawn,e2e_timing,protocol_pass,condition_complete,camera_active,fps_tier,n_incomplete,n_blinks_total,incomplete_blink_ratio,session_position',
      'A,P1,positive,achromatic,true,false,false,0,true,true,A,4,20,0.2,0',
      'B,P1,positive,achromatic,true,false,false,0,true,true,C,12,20,0.6,1',
    ].join('\n');
    const s = cohortSummary([{ filename: 'analysis_long.csv', content: csv }],
      { total_participants: 2, analysable_participants: 2, issues: [] }, 10);
    expect(s.conditions[0].n_with_outcome).toBe(1);
    expect(s.conditions[0].mean_ibr).toBeCloseTo(0.2, 9);
    expect(s.conditions[0].pooled_ibr).toBeCloseTo(0.2, 9);
  });
});

describe('cohort outcomes', () => {
  it('reads the confirmatory set only: the withdrawn and the paused participant are out', () => {
    expect(view.participants).not.toContain(pid(WITHDRAWN));
    expect(view.participants).not.toContain(pid(PAUSED));
    expect(view.participants).toContain(pid(SPLIT));
    expect(view.participants.length).toBe(new Set(rows.map((r) => r.participant_id)).size);
    expect(view.participants.length).toBe(8);
  });

  it('orders participants by when the last of their analysed sittings ended', () => {
    const lastEnd = new Map<string, number>();
    for (const r of rows) lastEnd.set(r.participant_id, Math.max(lastEnd.get(r.participant_id) ?? -Infinity, sittingEnd.get(r.session_id)!));
    expect(view.participants).toEqual([...lastEnd.keys()].sort((a, b) => lastEnd.get(a)! - lastEnd.get(b)!));
    // Third, by their second sitting; by their first they would be first.
    expect(view.participants.indexOf(pid(SPLIT))).toBe(2);
  });

  it('a sitting outside the analysis set does not move a participant', () => {
    // A's analysed sitting ended at 100; a later sitting of A (not analysable) at 500; B's at 300.
    const head = 'participant_id,session_id,condition_label,polarity,text_colour,analysable,withdrawn,e2e_timing,protocol_pass,condition_complete,camera_active,fps_tier,n_blinks_total,rt_mean_hits_ms';
    const lines = [head,
      'A,sA1,P1,positive,achromatic,true,false,false,0,true,true,A,20,400',
      'A,sA1,N1,negative,achromatic,true,false,false,0,true,true,A,20,410',
      'A,sA2,P1,positive,achromatic,false,false,false,0,true,true,A,20,390',
      'B,sB,P1,positive,achromatic,true,false,false,0,true,true,A,20,420',
      'B,sB,N1,negative,achromatic,true,false,false,0,true,true,A,20,430',
    ];
    const v = cohortOutcomes([{ filename: 'analysis_long.csv', content: lines.join('\n') }],
      new Map([['sA1', 100], ['sA2', 500], ['sB', 300]]));
    expect(v.participants).toEqual(['A', 'B']);
  });

  it('each condition: one value per participant, averaged across participants, for all seven outcomes', () => {
    expect(view.byCondition.length).toBe(10);
    for (const o of COHORT_OUTCOMES) {
      const cells = cellsOf(o.key);
      for (const c of view.byCondition) {
        const values = view.participants.map((p) => cells.get(p)?.get(c.condition_label)).filter((x): x is number => x != null);
        const ref = meanCI(values);
        const got = c.cells[o.key];
        expect(got.n, `${o.key} ${c.condition_label}`).toBe(ref.n);
        if (ref.mean == null) { expect(got.mean).toBeNull(); continue; }
        expect(got.mean!).toBeCloseTo(ref.mean, 9);
        if (ref.lcl != null) expect(got.lcl!).toBeCloseTo(ref.lcl, 9);
      }
    }
  });

  it('the eye outcomes lose the tier-C runs and the camera-off half; the others keep them', () => {
    const total = (key: string) => view.byCondition.reduce((n, c) => n + c.cells[key].n, 0);
    // 8 participants x 10 conditions, less two tier-C runs and five camera-off runs.
    expect(total('rt_mean_hits_ms')).toBe(80);
    expect(total('incomplete_blink_ratio')).toBe(80 - 2 - 5);
    expect(total('blink_rate_per_min')).toBe(80 - 2 - 5);
  });

  it('positive minus negative: colour-paired, the three columns over the same participants', () => {
    for (const o of COHORT_OUTCOMES) {
      const cells = cellsOf(o.key);
      const pos: number[] = []; const neg: number[] = []; const diffs: number[] = [];
      for (const p of view.participants) {
        const byColour = new Map<string, { positive?: number; negative?: number }>();
        for (const [cond, v] of cells.get(p) ?? []) {
          const { polarity, colour } = colourOf.get(cond)!;
          byColour.set(colour, { ...byColour.get(colour), [polarity]: v });
        }
        const pairs = [...byColour.values()].filter((x) => x.positive != null && x.negative != null);
        if (!pairs.length) continue;
        pos.push(mean(pairs.map((x) => x.positive!))); neg.push(mean(pairs.map((x) => x.negative!)));
        diffs.push(pos[pos.length - 1] - neg[neg.length - 1]);
      }
      const row = view.polarity[o.key];
      expect(row.difference.n, o.key).toBe(diffs.length);
      expect(row.positive.n).toBe(diffs.length);
      expect(row.negative.n).toBe(diffs.length);
      expect(row.difference.mean!).toBeCloseTo(meanCI(diffs).mean!, 9);
      expect(row.difference.lcl!).toBeCloseTo(meanCI(diffs).lcl!, 9);
      expect(row.positive.mean! - row.negative.mean!).toBeCloseTo(row.difference.mean!, 9);
    }
    // The participant whose eye data covers one polarity only is out of the eye rows, in the others.
    expect(view.polarity.incomplete_blink_ratio.difference.n).toBe(7);
    expect(view.polarity.rt_mean_hits_ms.difference.n).toBe(8);
  });

  it('a missing run does not put the colour effect into the difference', () => {
    // Every colour has its own level and polarity changes nothing; participant C lost N2-N5.
    const head = 'participant_id,session_id,condition_label,polarity,text_colour,analysable,withdrawn,e2e_timing,protocol_pass,condition_complete,camera_active,fps_tier,n_blinks_total,incomplete_blink_ratio';
    const lines = [head];
    for (const p of ['A', 'B', 'C']) {
      for (let k = 1; k <= 5; k++) {
        for (const [pol, tag] of [['positive', 'P'], ['negative', 'N']] as const) {
          if (p === 'C' && pol === 'negative' && k > 1) continue;
          lines.push(`${p},s${p},${tag}${k},${pol},colour${k},true,false,false,0,true,true,A,20,${(0.1 + 0.05 * k).toFixed(2)}`);
        }
      }
    }
    const v = cohortOutcomes([{ filename: 'analysis_long.csv', content: lines.join('\n') }], new Map());
    expect(v.polarity.incomplete_blink_ratio.difference.n).toBe(3);
    expect(v.polarity.incomplete_blink_ratio.difference.mean!).toBeCloseTo(0, 12);
  });

  it('the trend: a point at each completion with the outcome, on one axis shared by every outcome', () => {
    for (const o of COHORT_OUTCOMES) {
      const t = view.trend[o.key];
      expect(t.length).toBe(view.polarity[o.key].difference.n);
      t.forEach((x, i) => {
        expect(x.k).toBe(view.participants.indexOf(x.participant) + 1);
        expect(x.n).toBe(i + 1);
      });
      expect(t[t.length - 1].mean!).toBeCloseTo(view.polarity[o.key].difference.mean!, 9);
      expect(t[0].lcl).toBeNull();
    }
    // The split participant completed third and has no colour measured in both polarities in the eye
    // data: the eye charts skip the third place, and every later point keeps its own place.
    expect(view.trend.rt_mean_hits_ms.map((x) => x.k)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(view.trend.incomplete_blink_ratio.map((x) => x.k)).toEqual([1, 2, 4, 5, 6, 7, 8]);
    expect(view.trend.incomplete_blink_ratio.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('what the tab prints', () => {
  it('a value that rounds to zero has no minus sign', () => {
    expect(fixedNoNegZero(-0.358, 0)).toBe('0');
    expect(fixedNoNegZero(-0.0004, 3)).toBe('0.000');
    expect(fixedNoNegZero(-0.6, 0)).toBe('-1');
    expect(fixedNoNegZero(-12.34, 1)).toBe('-12.3');
    expect(fixedNoNegZero(0.25, 2)).toBe('0.25');
  });

  it('the trend axis: zero on it with two points, and the first intervals clipped only once later points rest on three', () => {
    // Two participants whose differences are 0.50 and 0.52: the interval excludes zero.
    const two = [{ n: 1, mean: 0.5, lcl: null, ucl: null }, { n: 2, mean: 0.51, lcl: 0.383, ucl: 0.637 }];
    expect(trendAxis(two).scale.ticks).toContain(0);
    expect(trendAxis(two).scale.domain[1]).toBeGreaterThanOrEqual(0.637);
    expect(trendAxis(two).clipped).toBe(false);
    const four = [...two, { n: 3, mean: 0.5, lcl: 0.47, ucl: 0.53 }, { n: 4, mean: 0.5, lcl: 0.48, ucl: 0.52 }];
    expect(trendAxis(four).clipped).toBe(true);
    expect(trendAxis(four).scale.ticks).toContain(0);
    expect(trendAxis(four).scale.domain[1]).toBeLessThan(0.637);
  });

  it('the trend axis always holds zero, has a width, and steps evenly', () => {
    const check = (values: number[]) => {
      const s = niceScale(values);
      const v = values.filter((x) => Number.isFinite(x));
      // Within a billionth of a step: niceScale ignores a binary rounding error at the edge.
      const tol = 1e-9 * (s.ticks[1] - s.ticks[0]);
      expect(s.domain[0]).toBeLessThanOrEqual(Math.min(0, ...v) + tol);
      expect(s.domain[1]).toBeGreaterThanOrEqual(Math.max(0, ...v) - tol);
      expect(s.domain[1]).toBeGreaterThan(s.domain[0]);
      expect(s.ticks).toContain(0);
      expect(s.ticks.length).toBeLessThanOrEqual(7);
      const steps = s.ticks.slice(1).map((x, i) => x - s.ticks[i]);
      for (const d of steps) expect(d).toBeCloseTo(steps[0], 9);
      return s;
    };
    check([0, 0, 0]);
    check([0.51, 0.383, 0.637]);
    check([-0.08, -0.2, -0.01]);
    check([-1e6, 3e6]);
    check([0.02, -0.36, 0.4]);
    expect(check([0.1, 0.2, 0.30000000000000004]).ticks).toEqual([0, 0.1, 0.2, 0.3]);
    // The participants axis: whole numbers from 1, every one up to ten, then a round step.
    expect(countTicks(1)).toEqual([1, 2]);
    expect(countTicks(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(countTicks(130)).toEqual([1, 20, 40, 60, 80, 100, 120]);
    expect(countTicks(145)).toEqual([1, 20, 40, 60, 80, 100, 120, 140]);
    // A NaN is ignored, not carried into the axis.
    expect(check([Number.NaN, 0.05]).ticks.every((x) => Number.isFinite(x))).toBe(true);
  });
});
