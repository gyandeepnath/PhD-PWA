/**
 * The display scale is frozen for one display's stimulus, not for the whole condition loop (Round 87,
 * audit 86 F5).
 *
 * The freeze used to cover every loop stage, the grey field between displays included, and a freeze
 * cannot lapse into another: a 0.6 s turn to portrait during display 1 drew the whole of display 2 at
 * 62% of its size, with nothing on display 2's row to say it had inherited the shrink. The end-to-end
 * reproduction is e2e/scaleFreeze.spec.ts; this holds the rule and the column that records it.
 */
import { describe, it, expect } from 'vitest';
import { scaleFrozenOn, SCALE_FREEZE_VERSION, SCALE_FREEZE_VERSION_V1 } from '@/experiment/scaleFreeze';
import { LOOP_ORDER, SETUP_ORDER } from '@/experiment/stateMachine';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { splitCsvRow } from './helpers/csv';

describe('when the scale is frozen', () => {
  it('the grey field between displays is re-fitted, so a shrink cannot outlive its display', () => {
    expect(scaleFrozenOn('ADAPTATION', false)).toBe(false);
  });

  it('the reading screen is re-fitted while its instruction card is up, and frozen once the passage is', () => {
    expect(scaleFrozenOn('READING_TASK', false)).toBe(false);
    expect(scaleFrozenOn('READING_TASK', true)).toBe(true);
  });

  it('every task after the passage stays frozen: the questions are set at the passage\'s size', () => {
    for (const stage of LOOP_ORDER.filter((s) => s !== 'READING_TASK' && s !== 'ADAPTATION')) {
      expect(scaleFrozenOn(stage, false), stage).toBe(true);
    }
  });

  it('calibration is frozen (its targets are placed on the scaled canvas); setup, the break and the close are not', () => {
    expect(scaleFrozenOn('CALIBRATION', false)).toBe(true);
    for (const stage of [...SETUP_ORDER.filter((s) => s !== 'CALIBRATION'), 'BREAK_SCREEN', 'CVSQ_END', 'NASA_TLX', 'SESSION_COMPLETE', 'EXPORT_DASHBOARD'] as const) {
      expect(scaleFrozenOn(stage, false), stage).toBe(false);
    }
  });
});

describe('the record: scale_freeze_version', () => {
  it(`is exported in 02_conditions.csv, ${SCALE_FREEZE_VERSION_V1} where a row has none`, () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => (i === 0
      ? { ...c, scale_freeze_version: SCALE_FREEZE_VERSION } : { ...c, scale_freeze_version: undefined }));
    const file = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!;
    const [head, ...rows] = file.content.trim().split('\n').map(splitCsvRow);
    const col = head.indexOf('scale_freeze_version');
    expect(col).toBeGreaterThan(-1);
    expect(rows[0][col]).toBe(SCALE_FREEZE_VERSION);
    expect(rows.slice(1).every((r) => r[col] === SCALE_FREEZE_VERSION_V1)).toBe(true);
  });
});
