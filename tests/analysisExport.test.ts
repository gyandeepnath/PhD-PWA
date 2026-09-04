/**
 * The pooled analysis dataset is the file the thesis statistics are run on, and until now nothing
 * tested it at all.
 *
 * Five defects were found by audit and confirmed by running the real exporter. Every one of them
 * produced a plausible-looking number rather than an obvious failure — a centred column that was
 * not centred, a position that ran to 39, a covariate with no within-participant variance. That is
 * the class of bug this file exists to catch, because none of it is visible in a plot.
 */
import { describe, it, expect } from 'vitest';
import { buildAnalysisDataset, ANALYSIS_LONG_COLUMNS } from '@/storage/analysisExport';
import type { SessionBundle } from '@/storage/gather';
import { N_CONDITIONS } from '@/experiment/conditions';

/** Parse a CSV the exporter produced back into records, so assertions read the shipped bytes. */
function parse(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

interface SittingSpec {
  sid: string;
  start: number;
  illumination: 'dim' | 'moderate';
  block: number;
  conditionsPerSession?: number;
  offset?: number;
  caffeine?: boolean;
  sleep?: number;
  cvsq?: number;
  e2e?: boolean;
  status?: 'in_progress' | 'complete';
}

/** A bundle carrying only what buildLongRows and checkJoin read. */
function sitting(pid: string, s: SittingSpec): SessionBundle {
  const cps = s.conditionsPerSession ?? N_CONDITIONS;
  const offset = s.offset ?? 0;
  const conditions = Array.from({ length: cps }, (_, i) => ({
    condition_id: `${s.sid}-c${i}`,
    condition_label: `C${offset + i}`,
    session_position: offset + i,
    polarity: (offset + i) < 5 ? 'positive' : 'negative',
    color_name: `col${(offset + i) % 5}`,
    passage_id: (offset + i) % N_CONDITIONS,
    wcag_contrast_ratio: 10,
    below_wcag_aa: false,
    adaptation_ms_before: 60000,
    passage_repeat_number: 1,
    reading_time_ms: 180000,
  }));
  return {
    session: {
      session_id: s.sid,
      participant_id: pid,
      enrolment_number: 1,
      session_index: s.block + 1,
      session_start_time: s.start,
      session_end_time: s.status === 'in_progress' ? null : s.start + 1,
      status: s.status ?? 'complete',
      ambient_illumination_level: s.illumination,
      illumination_block: s.block,
      illumination_order_first: 'dim',
      conditions_per_session: cps,
      condition_offset: offset,
      caffeine_today: s.caffeine,
      hours_since_sleep: s.sleep,
      e2e_timing: s.e2e ?? false,
      ambient_lux: 10,
    },
    participant: {
      participant_id: pid,
      enrolment_number: 1,
      age: 22,
      // Deliberately CONTRADICTS the per-sitting values, so reading the wrong one is detectable.
      caffeine_today: true,
      hours_since_sleep: 6,
    },
    conditions,
    fatigue: [],
    cvsq: s.cvsq == null ? [] : [{ stage: 'baseline', total_score: s.cvsq }],
    tlx: [], media: [], comprehension: [], visualSearch: [], perception: [],
    eyeMetrics: [], reactionTrials: [], rtSummaries: [], calibration: [],
  } as unknown as SessionBundle;
}

const standard = (pid: string) => [
  sitting(pid, { sid: `${pid}-a`, start: 1000, illumination: 'dim', block: 0, caffeine: false, sleep: 5, cvsq: 4 }),
  sitting(pid, { sid: `${pid}-b`, start: 2000, illumination: 'moderate', block: 1, caffeine: true, sleep: 8, cvsq: 7 }),
];

const long = (bundles: SessionBundle[]) => {
  const ds = buildAnalysisDataset(bundles);
  const file = ds.files.find((f) => f.filename === 'analysis_long.csv')!;
  return { rows: parse(file.content), ds };
};

describe('the dataset is well-formed', () => {
  it('writes one row per condition-run, with the declared columns in order', () => {
    const { rows, ds } = long(standard('P01'));
    expect(rows).toHaveLength(2 * N_CONDITIONS);
    expect(ds.rowCount).toBe(2 * N_CONDITIONS);
    expect(Object.keys(rows[0])).toEqual([...ANALYSIS_LONG_COLUMNS]);
  });

  it('gives every row a unique, order-independent key', () => {
    const { rows } = long(standard('P01'));
    expect(new Set(rows.map((r) => r.row_id)).size).toBe(rows.length);
  });
});

describe('position_c is actually centred', () => {
  it('has mean zero, because session_position is 0-based', () => {
    // It was centred on (N+1)/2 = 5.5 against a 0..9 range, leaving a mean of -1.0 — so the column
    // stayed correlated with the intercept, which is the one thing centring is for.
    const { rows } = long(standard('P01'));
    const vals = rows.map((r) => Number(r.position_c));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
    expect(Math.min(...vals)).toBe(-4.5);
    expect(Math.max(...vals)).toBe(4.5);
  });
});

describe('global_position comes from the recorded block', () => {
  it('runs 0..19 across the two sittings', () => {
    const { rows } = long(standard('P01'));
    const vals = rows.map((r) => Number(r.global_position)).sort((a, b) => a - b);
    expect(vals).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('is still 0..19 under the split protocol, which double-counted to 39', () => {
    // A split runs ONE illumination block as two sittings of five. session_position is already
    // block-global, so multiplying a separate sitting counter on top produced 0-4, 15-19, 20-24,
    // 35-39 — beyond the range the codebook declares, and wrong.
    const split = [
      sitting('P02', { sid: 's1', start: 1, illumination: 'dim', block: 0, conditionsPerSession: 5, offset: 0 }),
      sitting('P02', { sid: 's2', start: 2, illumination: 'dim', block: 0, conditionsPerSession: 5, offset: 5 }),
      sitting('P02', { sid: 's3', start: 3, illumination: 'moderate', block: 1, conditionsPerSession: 5, offset: 0 }),
      sitting('P02', { sid: 's4', start: 4, illumination: 'moderate', block: 1, conditionsPerSession: 5, offset: 5 }),
    ];
    const { rows } = long(split);
    const vals = rows.map((r) => Number(r.global_position)).sort((a, b) => a - b);
    expect(vals).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('never contradicts illumination_block in the same row', () => {
    // Sessions stored out of start-time order used to put block 0 beside global_position 10-19.
    const [a, b] = standard('P03');
    const { rows } = long([b, a]);
    for (const r of rows) {
      const block = Number(r.illumination_block);
      const gp = Number(r.global_position);
      expect(Math.floor(gp / N_CONDITIONS)).toBe(block);
    }
  });
});

describe('session-scoped covariates come from the session', () => {
  it('varies caffeine and sleep between a participant\'s two sittings', () => {
    // Read from the participant record they were constant — that copy is deliberately the FIRST
    // sitting's, sticky — so a within-participant covariate had zero within-participant variance
    // and dropped silently out of any within-subject term.
    const { rows } = long(standard('P01'));
    expect(new Set(rows.map((r) => r.caffeine_today))).toEqual(new Set(['false', 'true']));
    expect(new Set(rows.map((r) => r.hours_since_sleep))).toEqual(new Set(['5', '8']));
  });

  it('takes the CVS-Q baseline of the sitting the row belongs to', () => {
    const { rows } = long(standard('P01'));
    expect(new Set(rows.map((r) => r.cvsq_baseline_total))).toEqual(new Set(['4', '7']));
  });
});

describe('test-harness and unfinished sittings are identifiable', () => {
  it('flags an e2e session rather than pooling it invisibly', () => {
    const rows = long([
      ...standard('P01'),
      sitting('P99', { sid: 'e2e', start: 5, illumination: 'dim', block: 0, e2e: true }),
    ]).rows;
    const e2eRows = rows.filter((r) => r.session_id === 'e2e');
    expect(e2eRows).toHaveLength(N_CONDITIONS);
    // Present, not dropped — but filterable.
    expect(e2eRows.every((r) => r.e2e_timing === 'true')).toBe(true);
    expect(rows.filter((r) => r.session_id !== 'e2e').every((r) => r.e2e_timing === 'false')).toBe(true);
  });

  it('marks an unfinished sitting', () => {
    const rows = long([
      sitting('P04', { sid: 'x', start: 1, illumination: 'dim', block: 0, status: 'in_progress' }),
    ]).rows;
    expect(rows.every((r) => r.session_status === 'in_progress')).toBe(true);
  });
});

describe('the sitting expectation follows the protocol that was run', () => {
  it('does not mark every split-protocol participant unanalysable', () => {
    // A fixed expectation of two sittings condemned all four-sitting participants wholesale.
    const split = [
      sitting('P05', { sid: 'a', start: 1, illumination: 'dim', block: 0, conditionsPerSession: 5, offset: 0 }),
      sitting('P05', { sid: 'b', start: 2, illumination: 'dim', block: 0, conditionsPerSession: 5, offset: 5 }),
      sitting('P05', { sid: 'c', start: 3, illumination: 'moderate', block: 1, conditionsPerSession: 5, offset: 0 }),
      sitting('P05', { sid: 'd', start: 4, illumination: 'moderate', block: 1, conditionsPerSession: 5, offset: 5 }),
    ];
    const { ds } = long(split);
    expect(ds.integrity.participants[0].excluded_by).not.toContain('too_many_sittings');
    expect(ds.integrity.participants[0].condition_runs).toBe(20);
  });
});

describe('absence is reported, never invented', () => {
  it('leaves global_position empty when the block was not recorded', () => {
    const b = standard('P06')[0] as SessionBundle;
    // A session with no illumination_block: its sitting is genuinely unknown, and a confident 0-9
    // would assert it was the first.
    (b.session as unknown as Record<string, unknown>).illumination_block = null;
    const { rows } = long([b]);
    expect(rows.every((r) => r.global_position === '')).toBe(true);
  });
});
