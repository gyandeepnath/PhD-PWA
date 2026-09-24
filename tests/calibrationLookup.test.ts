import { describe, it, expect } from 'vitest';
import { latestCalibration, calibrationForRow } from '@/storage/calibrationLookup';

const cal = (id: string, at?: number) => ({ calibration_id: id, calibrated_at: at });

describe('latestCalibration', () => {
  it('is the last by time', () => {
    expect(latestCalibration([cal('b', 5), cal('a', 9), cal('c', 1)])?.calibration_id).toBe('a');
  });
  it('is the last WRITTEN among records with no time — the same answer for both exports', () => {
    // The two exports used to break this tie in opposite directions.
    expect(latestCalibration([cal('first'), cal('second')])?.calibration_id).toBe('second');
  });
});

describe('calibrationForRow', () => {
  const cals = [cal('early', 100), cal('late', 500)];
  it('follows the id when the row has one', () => {
    expect(calibrationForRow(cals, { calibration_id: 'early' }, 900)?.calibration_id).toBe('early');
  });
  it('an explicit null means no calibration was in force', () => {
    expect(calibrationForRow(cals, { calibration_id: null }, 900)).toBeUndefined();
  });
  it('an id that is not in the bundle resolves to nothing, not to another record', () => {
    expect(calibrationForRow(cals, { calibration_id: 'missing' }, 900)).toBeUndefined();
  });
  it('a legacy row takes the last calibration at or before its start', () => {
    expect(calibrationForRow(cals, {}, 300)?.calibration_id).toBe('early');
    expect(calibrationForRow(cals, {}, 500)?.calibration_id).toBe('late');
  });
  it('a legacy row with a single calibration takes it', () => {
    expect(calibrationForRow([cal('only')], {}, null)?.calibration_id).toBe('only');
  });
  it('declines to guess when several calibrations carry no time', () => {
    expect(calibrationForRow([cal('x'), cal('y')], {}, 300)).toBeUndefined();
  });
  it('no eye row, no calibration', () => {
    expect(calibrationForRow(cals, undefined, 300)).toBeUndefined();
  });
});

describe('the integrity audit catches a row pointing at a calibration that is not there', () => {
  it('flags it, and does not flag a well-formed bundle', async () => {
    const { auditBundle } = await import('@/storage/integrity');
    const { buildFixtureBundle } = await import('@/sim/bundleFixture');
    const b = buildFixtureBundle();
    expect(auditBundle(b).findings.map((f) => f.check)).not.toContain('calibration_reference');
    const broken = { ...b, eyeMetrics: b.eyeMetrics.map((e, i) => (i === 0 ? { ...e, calibration_id: 'nope' } : e)) };
    expect(auditBundle(broken).findings.map((f) => f.check)).toContain('calibration_reference');
  });
});
