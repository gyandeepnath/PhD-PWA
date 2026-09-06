/** TEMPORARY PROBE — deleted before delivery. Confirms the audit findings against current code. */
import { describe, it, expect } from 'vitest';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import type { SessionBundle } from '@/storage/gather';

function sitting(pid: string, sid: string, opts: {
  positions?: number[];
  start?: number;
  withEye?: boolean;
  prov?: Record<string, unknown>;
} = {}): SessionBundle {
  const positions = opts.positions ?? Array.from({ length: 10 }, (_, i) => i);
  return {
    session: {
      session_id: sid,
      participant_id: pid,
      enrolment_number: 1,
      session_index: 1,
      session_start_time: opts.start ?? 1000,
      session_end_time: (opts.start ?? 1000) + 1,
      status: 'complete',
      ambient_illumination_level: 'moderate',
      illumination_block: 0,
      illumination_order_first: 'moderate',
      conditions_per_session: positions.length,
      condition_offset: positions[0] ?? 0,
      e2e_timing: false,
      ambient_lux: 300,
      provenance: opts.prov ?? {
        app_version: '2.1.0', git_hash: 'aaaa111', build_time: 'x',
        condition_def_hash: 'hash-A', schema_version: 7,
      },
    },
    participant: { participant_id: pid, enrolment_number: 1, age: 22 },
    conditions: positions.map((p) => ({
      condition_id: `${sid}-c${p}`,
      condition_label: `C${p}`,
      session_position: p,
      polarity: p < 5 ? 'positive' : 'negative',
      color_name: `col${p % 5}`,
      passage_id: p % 10,
      wcag_contrast_ratio: 10,
      below_wcag_aa: false,
      adaptation_ms_before: 60000,
      passage_repeat_number: 1,
      reading_time_ms: 180000,
    })),
    fatigue: [], cvsq: [], tlx: [], media: [], comprehension: [], visualSearch: [],
    perception: [], eyeMetrics: [], reactionTrials: [], rtSummaries: [], calibration: [],
  } as unknown as SessionBundle;
}

function parse(content: string): Record<string, string>[] {
  const lines = content.split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells: string[] = []; let f = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { cells.push(f); f = ''; }
      else f += c;
    }
    cells.push(f);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

describe('probe', () => {
  it('F1: what files does buildAnalysisDataset emit?', () => {
    const ds = buildAnalysisDataset([sitting('P01', 's1')]);
    console.log('FILES:', ds.files.map((f) => f.filename));
    const longFile = ds.files.find((f) => f.filename === 'analysis_long.csv')!;
    console.log('HEADERS:', longFile.content.split('\n')[0]);
  });

  it('F1: two builds pool with nothing to tell them apart', () => {
    const ds = buildAnalysisDataset([
      sitting('P01', 's1'),
      sitting('P02', 's2', { start: 2000, prov: { app_version: '3.0.0', git_hash: 'bbbb222', build_time: 'y', condition_def_hash: 'hash-B', schema_version: 9 } }),
    ]);
    const txt = ds.files.map((f) => f.content).join('\n');
    console.log('mentions hash-A?', txt.includes('hash-A'), 'hash-B?', txt.includes('hash-B'), '3.0.0?', txt.includes('3.0.0'));
  });

  it('F2: a gap in session_position yields the SAME null as the first condition', () => {
    // positions 0,1,2, 4,5 (3 missing)
    const ds = buildAnalysisDataset([sitting('P01', 's1', { positions: [0, 1, 2, 4, 5] })]);
    const rows = parse(ds.files.find((f) => f.filename === 'analysis_long.csv')!.content);
    console.log('F2 rows:', rows.map((r) => `${r.session_position}:ps=${JSON.stringify(r.polarity_switched)} pred=${JSON.stringify(r.predecessor_condition_label)}`));
    const issues = parse(ds.files.find((f) => f.filename === 'analysis_join_issues.csv')!.content);
    console.log('F2 issues:', issues.map((i) => i.code));
  });

  it('F2: split sitting starting at position 5', () => {
    const ds = buildAnalysisDataset([sitting('P01', 's1', { positions: [5, 6, 7, 8, 9] })]);
    const rows = parse(ds.files.find((f) => f.filename === 'analysis_long.csv')!.content);
    console.log('F2b rows:', rows.map((r) => `${r.session_position}:ps=${JSON.stringify(r.polarity_switched)}`));
  });

  it('F3: camera_active / qc_overall / fps_adequate with NO eye record', () => {
    const ds = buildAnalysisDataset([sitting('P01', 's1')]);
    const rows = parse(ds.files.find((f) => f.filename === 'analysis_long.csv')!.content);
    console.log('F3:', rows.slice(0, 2).map((r) => ({
      camera_active: r.camera_active, qc_overall: r.qc_overall,
      fps_adequate_for_ratio: r.fps_adequate_for_ratio, gaze_calibrated: r.gaze_calibrated,
      effective_fps: r.effective_fps,
    })));
  });

  it('F4: session with no participant id', () => {
    const ds = buildAnalysisDataset([sitting('', 'sess-verify-0001'), sitting('', 'sess-verify-0002', { start: 2000 })]);
    const rows = parse(ds.files.find((f) => f.filename === 'analysis_long.csv')!.content);
    console.log('F4 pids:', [...new Set(rows.map((r) => JSON.stringify(r.participant_id)))]);
    console.log('F4 row_id sample:', rows[0].row_id);
    console.log('F4 join report:', ds.files.find((f) => f.filename === 'analysis_join_report.csv')!.content);
    console.log('F4 summary:', ds.integrity.analysable_participants, '/', ds.integrity.total_participants, 'rows', ds.rowCount);
  });

  expect(true).toBe(true);
});
