/**
 * A camera-off row says nothing was judged, in every file (audit 86 D13).
 *
 * disabledEyeMetrics stores FALSE in fps_adequate_for_tiers, fps_adequate_for_ratio,
 * head_pitch_calibrated and gaze_calibrated on a camera-off row, because the record type is boolean.
 * Round 54 blanked two of them in analysis_long.csv; 07_eye_metrics.csv kept FALSE — a frame rate
 * "measured and found wanting" beside its own blank fps_tier — and 12_quality_flags.csv wrote
 * insufficient_blinks FALSE ("enough blinks") for a condition with no blink count. Both writers now
 * take the judgements from one helper, cameraJudgements.
 */
import { describe, it, expect } from 'vitest';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, cameraJudgements } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { disabledEyeMetrics } from '@/tracking/aggregator';

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

const JUDGED = ['fps_adequate_for_tiers', 'fps_adequate_for_ratio', 'head_pitch_calibrated', 'gaze_calibrated'] as const;

describe('a camera-off condition is blank, not FALSE, wherever a camera judgement is written (audit 86 D13)', () => {
  const b = buildFixtureBundle();
  const off = b.conditions[0].condition_id;
  b.eyeMetrics = b.eyeMetrics.map((e) => e.condition_id === off ? disabledEyeMetrics(off, b.session.session_id, 'not_running') : e);
  const files = buildExportFiles(b);
  const get = (name: string) => parse(files.find((f) => f.filename === name)!.content);
  const long = parse(buildAnalysisDataset([b]).files.find((f) => f.filename === 'analysis_long.csv')!.content);

  it('07: the four judgements are blank on the camera-off row and kept on a camera row', () => {
    const rows = get('07_eye_metrics.csv');
    const offRow = rows.find((r) => r.condition_id === off)!;
    expect(offRow.camera_active).toBe('false');
    for (const c of JUDGED) expect(offRow[c], c).toBe('');
    expect(offRow.fps_tier).toBe('');
    const onRow = rows.find((r) => r.condition_id !== off)!;
    for (const c of JUDGED) expect(['true', 'false'], c).toContain(onRow[c]);
  });

  it('07 and analysis_long agree on the camera-off row', () => {
    const pos = Number(b.conditions[0].session_position);
    const longOff = long.find((r) => Number(r.session_position) === pos)!;
    expect(longOff.camera_active).toBe('false');
    const offRow = get('07_eye_metrics.csv').find((r) => r.condition_id === off)!;
    for (const c of ['fps_adequate_for_ratio', 'gaze_calibrated']) expect(offRow[c]).toBe(longOff[c]);
  });

  it('12: insufficient_blinks is blank where there is no blink count, and judged where there is one', () => {
    const rows = get('12_quality_flags.csv');
    const offRow = rows.find((r) => r.condition_id === off)!;
    expect(offRow.blink_count_total).toBe('');
    expect(offRow.insufficient_blinks).toBe('');
    const onRow = rows.find((r) => r.condition_id !== off)!;
    expect(onRow.blink_count_total).not.toBe('');
    expect(['true', 'false']).toContain(onRow.insufficient_blinks);
  });

  it('the helper: a camera row passes its stored values through; no row or a camera-off row gives nulls', () => {
    expect(cameraJudgements(undefined)).toEqual({ fps_adequate_for_tiers: null, fps_adequate_for_ratio: null, head_pitch_calibrated: null, gaze_calibrated: null });
    expect(cameraJudgements(disabledEyeMetrics('c', 's'))).toEqual({ fps_adequate_for_tiers: null, fps_adequate_for_ratio: null, head_pitch_calibrated: null, gaze_calibrated: null });
    const on = b.eyeMetrics.find((e) => e.condition_id !== off)!;
    expect(cameraJudgements(on)).toEqual({
      fps_adequate_for_tiers: on.fps_adequate_for_tiers, fps_adequate_for_ratio: on.fps_adequate_for_ratio,
      head_pitch_calibrated: on.head_pitch_calibrated, gaze_calibrated: on.gaze_calibrated,
    });
  });
});
