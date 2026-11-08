/**
 * A camera check that was not run because calibration fitted no baseline is said so, in the export and on
 * the dashboard (audit 86 CAM-2).
 *
 * The check counts blinks, and without an open-eye baseline it counts none. After "Continue without blink
 * measures" it used to run anyway, fail on "0 of 5 blinks" and blame the lighting, and 01 recorded a failed
 * check of a camera that may have been fine. Now it is not run (Experiment.tsx), the sitting records why
 * (SessionRecord.camera_selftest_skipped), 01 exports it, and the dashboard says "not run".
 * e2e/cameraCheckNeedsBaseline.spec.ts drives the screens.
 */
import { describe, it, expect } from 'vitest';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { sittingChecks } from '@/dashboard/sittingChecks';
import { splitCsvRow } from './helpers/csv';

const s01 = (b: ReturnType<typeof buildFixtureBundle>) => {
  const lines = buildExportFiles(b).find((f) => f.filename === '01_session_info.csv')!.content.replace(/^\uFEFF/, '').trim().split('\n');
  const head = splitCsvRow(lines[0]);
  const row = splitCsvRow(lines[1]);
  return Object.fromEntries(head.map((h, i) => [h, row[i]]));
};

describe('the camera check not run for want of a baseline', () => {
  it('01 selftest_not_run_reason says no_baseline, and is blank when the check ran or the sitting predates it', () => {
    const b = buildFixtureBundle();
    expect(s01(b).selftest_not_run_reason).toBe('');
    b.session.camera_selftest = null;
    b.session.camera_selftest_skipped = { reason: 'no_baseline', at: 1 };
    expect(s01(b)).toMatchObject({ selftest_not_run_reason: 'no_baseline', selftest_verdict: '', selftest_pass: '' });
    b.session.camera_selftest_skipped = null;
    expect(s01(b).selftest_not_run_reason).toBe('');
  });

  it('is in the codebook with its one level', () => {
    const entry = CODEBOOK.find((c) => c.file === '01_session_info.csv' && c.column === 'selftest_not_run_reason');
    expect(entry).toMatchObject({ type: 'factor(1)' });
    expect(entry!.description).toContain('no_baseline');
  });

  it('the dashboard says the check was not run and why, not that it failed', () => {
    const b = buildFixtureBundle();
    b.session.camera_selftest = null;
    b.session.camera_selftest_skipped = { reason: 'no_baseline', at: 1 };
    const c = sittingChecks(b).find((x) => x.key === 'camera_check')!;
    expect(c).toMatchObject({ status: 'none', value: 'not run: no eye baseline' });
    expect(c.detail).toMatch(/says nothing about the camera/);
  });
});
