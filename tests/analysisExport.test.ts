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
import { fnv1a } from '@/storage/export';
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

/** The build stamp every real SessionRecord carries; `provenance` is not optional on the type. */
const BUILD_A = {
  app_version: '2.1.0', git_hash: 'aaaa111', build_time: '2026-01-01T00:00:00Z',
  condition_def_hash: 'cond-hash-A', schema_version: 7,
};

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
  /** Positions this sitting actually recorded a row for. Defaults to a contiguous run. */
  positions?: number[];
  /** The build that collected it. */
  provenance?: Record<string, unknown>;
  /** Eye-metrics rows to attach, by position. Absent means the condition has NO eye record. */
  eyeAt?: Record<number, Record<string, unknown>>;
}

/** A bundle carrying only what buildLongRows and checkJoin read. */
function sitting(pid: string, s: SittingSpec): SessionBundle {
  const cps = s.conditionsPerSession ?? N_CONDITIONS;
  const offset = s.offset ?? 0;
  const positions = s.positions ?? Array.from({ length: cps }, (_, i) => offset + i);
  const conditions = positions.map((p) => ({
    condition_id: `${s.sid}-c${p}`,
    condition_label: `C${p}`,
    session_position: p,
    polarity: p < 5 ? 'positive' : 'negative',
    color_name: `col${p % 5}`,
    passage_id: p % N_CONDITIONS,
    wcag_contrast_ratio: 10,
    below_wcag_aa: false,
    adaptation_ms_before: 60000,
    passage_repeat_number: 1,
    reading_time_ms: 180000,
  }));
  const eyeMetrics = Object.entries(s.eyeAt ?? {}).map(([p, rec]) => ({
    condition_id: `${s.sid}-c${p}`, session_id: s.sid, ...rec,
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
      provenance: s.provenance ?? BUILD_A,
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
    eyeMetrics, reactionTrials: [], rtSummaries: [], calibration: [],
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
  it('does not mark a split-protocol participant unanalysable', () => {
    // A fixed sitting count condemned every split participant wholesale. The expectation is read
    // from conditions_per_session instead: under the single-level protocol a split runs the ten
    // conditions as two sittings of five, and that participant is complete.
    const split = [
      sitting('P05', { sid: 'a', start: 1, illumination: 'moderate', block: 0, conditionsPerSession: 5, offset: 0 }),
      sitting('P05', { sid: 'b', start: 2, illumination: 'moderate', block: 0, conditionsPerSession: 5, offset: 5 }),
    ];
    const { ds } = long(split);
    expect(ds.integrity.participants[0].excluded_by).not.toContain('too_many_sittings');
    expect(ds.integrity.participants[0].condition_runs).toBe(N_CONDITIONS);
  });

  it('accepts the whole ten conditions in ONE sitting, which is now the standard protocol', () => {
    const { ds } = long([
      sitting('P06', { sid: 'only', start: 1, illumination: 'moderate', block: 0 }),
    ]);
    expect(ds.integrity.participants[0].excluded_by).toEqual([]);
    expect(ds.integrity.participants[0].condition_runs).toBe(N_CONDITIONS);
  });

  it('FLAGS a participant carrying the withdrawn two-level crossover, rather than pooling them', () => {
    /*
     * Any sitting collected before the dim level was withdrawn has twenty condition-runs across two
     * illumination blocks. That participant did not run this protocol, and pooling them into a
     * single-level dataset would average two illumination cells into one and call the result a
     * constant-illumination measurement. It must surface, and it does.
     */
    const legacy = [
      sitting('P07', { sid: 'x', start: 1, illumination: 'dim', block: 0 }),
      sitting('P07', { sid: 'y', start: 2, illumination: 'moderate', block: 1 }),
    ];
    const { ds } = long(legacy);
    expect(ds.integrity.participants[0].excluded_by.length).toBeGreaterThan(0);
  });
});

describe('an empty polarity_switched is not silently reused for two different absences', () => {
  /*
   * The codebook gives an empty polarity_switched exactly one meaning: 'first condition of the
   * sitting'. A hole in the middle of a sitting produces the same empty cell on the row that
   * follows it, so a row halfway through a sitting reads as the sitting's opening condition — and
   * this is the covariate for the doubled grey-field adaptation and the polarity after-effect.
   */
  const gapped = () => [
    // Positions 0,1,2, then a hole at 3, then 4,5. The row at 4 has no predecessor in the data.
    sitting('P20', {
      sid: 'gap', start: 1, illumination: 'moderate', block: 0,
      conditionsPerSession: 10, positions: [0, 1, 2, 4, 5],
    }),
  ];

  it('still refuses to compare across the hole', () => {
    // Reaching back to position 2 would be worse than empty: the participant saw whatever ran at
    // position 3, so position 2's polarity is not what this row switched from.
    const { rows } = long(gapped());
    const after = rows.find((r) => r.session_position === '4')!;
    expect(after.polarity_switched).toBe('');
    expect(after.predecessor_condition_label).toBe('');
    // The rows either side of the hole, where a predecessor really is present, still compute.
    expect(rows.find((r) => r.session_position === '2')!.polarity_switched).toBe('false');
    expect(rows.find((r) => r.session_position === '5')!.polarity_switched).toBe('true');
  });

  it('reports the hole, naming the sitting, so the empty cell is not read as a sitting boundary', () => {
    const ds = buildAnalysisDataset(gapped());
    const gap = ds.integrity.issues.find((i) => i.code === 'condition_position_gap');
    expect(gap, 'a hole in a sitting is exported with nothing anywhere saying so').toBeTruthy();
    expect(gap!.session_id).toBe('gap');
    expect(gap!.detail).toContain('3');
    expect(gap!.detail).toContain('polarity_switched');
  });

  it('does NOT fire on a sitting that simply starts partway through the protocol', () => {
    // A split sitting's first row is at position 5 and its predecessor ran days earlier. That row
    // IS the first condition of its sitting, which is what the codebook's empty cell means, so
    // flagging it would cry wolf on the normal case.
    const ds = buildAnalysisDataset([
      sitting('P21', { sid: 'a', start: 1, illumination: 'moderate', block: 0, conditionsPerSession: 5, offset: 0 }),
      sitting('P21', { sid: 'b', start: 2, illumination: 'moderate', block: 0, conditionsPerSession: 5, offset: 5 }),
    ]);
    expect(ds.integrity.issues.map((i) => i.code)).not.toContain('condition_position_gap');
  });
});

describe('the pooled dataset says what produced it', () => {
  /*
   * The four CSVs went out with no build, no commit, no hash of the condition table and no
   * checksum, while the docstring above buildAnalysisDataset claimed a dataset "can never be
   * produced whose provenance is unstated". Nothing in the file said which version of the
   * instrument measured any row, and a re-export could not be shown to be the same dataset the
   * thesis reported.
   */
  const manifestOf = (bundles: SessionBundle[]) => {
    const ds = buildAnalysisDataset(bundles);
    const f = ds.files.find((x) => x.filename === 'analysis_manifest.json');
    expect(f, 'the pooled dataset ships no manifest').toBeTruthy();
    return { manifest: JSON.parse(f!.content), ds };
  };

  it('emits a manifest naming the build that collected every sitting', () => {
    const { manifest } = manifestOf(standard('P01'));
    expect(manifest.builds).toHaveLength(1);
    expect(manifest.builds[0]).toMatchObject({
      app_version: '2.1.0', git_hash: 'aaaa111', condition_def_hash: 'cond-hash-A', schema_version: 7,
    });
    expect(manifest.builds[0].session_ids.sort()).toEqual(['P01-a', 'P01-b']);
    expect(manifest.exported_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('checksums every data file, so a re-export can be shown to be the same bytes', () => {
    const { manifest, ds } = manifestOf(standard('P01'));
    const listed = new Map(manifest.files.map((f: { filename: string }) => [f.filename, f]));
    // The manifest cannot checksum itself; everything else must be covered.
    for (const f of ds.files.filter((x) => x.filename !== 'analysis_manifest.json')) {
      const entry = listed.get(f.filename) as { bytes: number; checksum_fnv1a: string } | undefined;
      expect(entry, `${f.filename} is not listed in the manifest`).toBeTruthy();
      expect(entry!.bytes).toBe(f.content.length);
      expect(entry!.checksum_fnv1a).toBe(fnv1a(f.content));
    }
    expect(listed.has('analysis_long.csv')).toBe(true);
  });

  it('changes the long file\'s checksum when a single cell changes', () => {
    // A checksum that did not move with the data would certify nothing at all.
    const a = manifestOf(standard('P01')).manifest;
    const altered = standard('P01');
    (altered[0].conditions[0] as unknown as Record<string, unknown>).reading_time_ms = 999999;
    const b = manifestOf(altered).manifest;
    const sumFor = (m: { files: { filename: string; checksum_fnv1a: string }[] }) =>
      m.files.find((f) => f.filename === 'analysis_long.csv')!.checksum_fnv1a;
    expect(sumFor(b)).not.toBe(sumFor(a));
  });

  it('names BOTH builds, with their sittings, when the dataset pools across a rebuild', () => {
    // Two years of collection spans builds. Nothing in analysis_long.csv separates them, so the
    // manifest has to, and the join check has to say so out loud.
    const { manifest, ds } = manifestOf([
      ...standard('P01'),
      sitting('P02', {
        sid: 'newer', start: 3000, illumination: 'moderate', block: 0,
        provenance: { app_version: '3.0.0', git_hash: 'bbbb222', build_time: 'x', condition_def_hash: 'cond-hash-B', schema_version: 9 },
      }),
    ]);
    expect(manifest.builds).toHaveLength(2);
    const newer = manifest.builds.find((b: { git_hash: string }) => b.git_hash === 'bbbb222');
    expect(newer.condition_def_hash).toBe('cond-hash-B');
    expect(newer.session_ids).toEqual(['newer']);
    expect(ds.integrity.issues.map((i) => i.code)).toContain('mixed_build_provenance');
  });

  it('counts a non-finite cell that reached the CSV boundary and was blanked', () => {
    // escapeCsv() blanks a NaN rather than writing the literal, because R reads "NaN" as NA. The
    // count is the only trace that leaves, and the pooled file used to carry no count at all.
    const b = standard('P02');
    (b[0].conditions[0] as unknown as Record<string, unknown>).adaptation_ms_before = NaN;
    const { manifest } = manifestOf(b);
    expect(manifest.non_finite_cells).toBeGreaterThan(0);
  });

  it('reports the join verdict, and a count of ZERO for a clean export after a dirty one', () => {
    // The counter is module-global and shared with the per-session export. Deliberately dirtied
    // first: without a reset at the top of this build, the clean dataset would inherit the previous
    // export's total and report non-finite cells it never wrote.
    const dirty = standard('P03');
    (dirty[0].conditions[0] as unknown as Record<string, unknown>).adaptation_ms_before = NaN;
    expect(manifestOf(dirty).manifest.non_finite_cells).toBeGreaterThan(0);

    const { manifest } = manifestOf(standard('P01'));
    expect(manifest.non_finite_cells).toBe(0);
    expect(manifest.dataset).toMatchObject({ sessions: 2, rows: 2 * N_CONDITIONS, participants_total: 1 });
  });
});

describe('a condition with no eye record says so, rather than asserting the camera was off', () => {
  /*
   * The condition summary substitutes for a missing eye record — camera_active defaults to false
   * and every quality flag is forced to 'warn' — which is right for the dashboard and wrong for the
   * dataset. The codebook declares 'no eye record' as the missing-value meaning of both columns,
   * a state the writer could not produce.
   */
  const ACTIVE_EYE = {
    camera_active: true, blink_count_incomplete: 2, blink_count_full: 20, blink_count_micro: 1,
    effective_fps: 30, face_presence_ratio: 0.95, off_axis_ratio: 0.05, lighting_quality: 'good',
    fps_adequate_for_ratio: true, gaze_calibrated: true,
  };
  const DISABLED_EYE = {
    camera_active: false, effective_fps: null, face_presence_ratio: null,
    fps_adequate_for_ratio: false, gaze_calibrated: false,
  };

  const rowsWithEye = (eyeAt: Record<number, Record<string, unknown>>) => long([
    sitting('P10', { sid: 'e', start: 1, illumination: 'moderate', block: 0, eyeAt }),
  ]).rows;

  it('leaves camera_active and qc_overall EMPTY when no eye record exists', () => {
    const rows = rowsWithEye({ 0: ACTIVE_EYE });
    const noRecord = rows.filter((r) => r.session_position !== '0');
    expect(noRecord).toHaveLength(N_CONDITIONS - 1);
    expect(noRecord.every((r) => r.camera_active === '')).toBe(true);
    expect(noRecord.every((r) => r.qc_overall === '')).toBe(true);
  });

  it('still writes false / warn when the record EXISTS and says tracking did not run', () => {
    // The two states must stay distinguishable: 'the camera was declined or failed' is a
    // measurement about a condition that ran, and it is not the same as having no record at all.
    const rows = rowsWithEye({ 3: DISABLED_EYE });
    const declined = rows.find((r) => r.session_position === '3')!;
    expect(declined.camera_active).toBe('false');
    expect(declined.qc_overall).toBe('warn');
  });

  it('reports good quality where the camera did run, so the gate is not just blanking the column', () => {
    const rows = rowsWithEye({ 0: ACTIVE_EYE });
    const measured = rows.find((r) => r.session_position === '0')!;
    expect(measured.camera_active).toBe('true');
    expect(measured.qc_overall).toBe('good');
    expect(measured.n_blinks_total).toBe('23');
  });
});

describe('a session with no participant id gets a grouping level of its own', () => {
  /*
   * Such a session produced an issue and then vanished from the participant map, so its rows went
   * into analysis_long.csv with participant_id EMPTY and it appeared in no row of the join report.
   * Two of them shared that empty key, and a mixed model grouping on participant_id would have
   * treated two different people as one person.
   */
  const orphans = () => [
    sitting('', { sid: 'orphan-1', start: 1, illumination: 'moderate', block: 0 }),
    sitting('', { sid: 'orphan-2', start: 2, illumination: 'moderate', block: 0 }),
  ];

  it('never writes an empty grouping key, and never merges two of them', () => {
    const { rows } = long(orphans());
    expect(rows).toHaveLength(2 * N_CONDITIONS);
    expect(rows.some((r) => r.participant_id === '')).toBe(false);
    expect(new Set(rows.map((r) => r.participant_id))).toEqual(
      new Set(['unresolved:orphan-1', 'unresolved:orphan-2']),
    );
    // row_id led with the empty key too: '|sess|cond'.
    expect(rows.every((r) => r.row_id.startsWith('unresolved:orphan-'))).toBe(true);
    expect(new Set(rows.map((r) => r.row_id)).size).toBe(rows.length);
  });

  it('appears in the join report, flagged, instead of being absent from it', () => {
    const ds = buildAnalysisDataset(orphans());
    const report = parse(ds.files.find((f) => f.filename === 'analysis_join_report.csv')!.content);
    expect(report.map((r) => r.participant_id).sort())
      .toEqual(['unresolved:orphan-1', 'unresolved:orphan-2']);
    expect(report.every((r) => r.analysable === 'false')).toBe(true);
    expect(report.every((r) => r.excluded_by.includes('session_without_participant'))).toBe(true);
    // The dashboard reported "0/0 participants analysable" — the dataset's own contents understated.
    expect(ds.integrity.total_participants).toBe(2);
  });

  it('carries the real reason onto the row, not the exporter\'s generic fallback', () => {
    const { rows } = long(orphans());
    expect(rows.every((r) => r.analysable === 'false')).toBe(true);
    expect(rows.every((r) => r.exclusion_reason.includes('session_without_participant'))).toBe(true);
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
