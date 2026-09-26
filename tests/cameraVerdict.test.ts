/**
 * "Is the camera working?" — the dashboard's plain-language verdict per condition.
 */
import { describe, it, expect } from 'vitest';
import { buildConditionSummaries, cameraVerdict } from '@/dashboard/aggregate';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { EyeMetricsRecord } from '@/storage/types';

const fixtureEye = (): EyeMetricsRecord => buildFixtureBundle().eyeMetrics.find((e) => e.camera_active)!;
const fine = { facePresence: 0.97, fps: 30, lighting: 'good' as const, blinks: 60, minutes: 5 };

describe('camera verdict', () => {
  it('says the camera worked, with the count and rate, when every check holds', () => {
    const eye = { ...fixtureEye(), camera_blocked_ms: 0, open_ear_measured: null };
    const v = cameraVerdict(eye, fine);
    expect(v.level).toBe('good');
    expect(v.headline).toBe('Working: 60 blinks in 5.0 min (12.0 per min)');
    expect(v.problems).toEqual([]);
  });

  it('names why there is no data when the camera was off', () => {
    expect(cameraVerdict({ ...fixtureEye(), camera_active: false, camera_inactive_reason: 'lost' }, fine).headline).toMatch(/stopped/);
    expect(cameraVerdict(undefined, fine).level).toBe('bad');
  });

  it('flags a covered camera, a missing face, a low frame rate and too few blinks — worst first', () => {
    const eye = { ...fixtureEye(), camera_blocked_ms: 40000, open_ear_measured: null };
    const v = cameraVerdict(eye, { ...fine, facePresence: 0.85, fps: 27, blinks: 8 });
    expect(v.level).toBe('bad');
    expect(v.problems[0]).toMatch(/covered or dark for 40 s/);
    expect(v.problems.join(' ')).toMatch(/85% of the time/);
    expect(v.problems.join(' ')).toMatch(/27 frames per second/);
    expect(v.problems.join(' ')).toMatch(/Only 8 blinks/);
    expect(v.headline).toMatch(/^Not trustworthy/);
  });

  it('warns when the open eye has narrowed well below its calibrated size', () => {
    const base = fixtureEye();
    const eye = { ...base, ear_baseline: 0.3, open_ear_measured: 0.24, camera_blocked_ms: 0 };
    const v = cameraVerdict(eye, fine);
    expect(v.level).toBe('warn');
    expect(v.problems[0]).toMatch(/20% narrower/);
  });

  it('is attached to every condition summary', () => {
    for (const s of buildConditionSummaries(buildFixtureBundle())) {
      expect(['good', 'warn', 'bad']).toContain(s.camera_verdict.level);
      expect(s.camera_verdict.headline.length).toBeGreaterThan(10);
    }
  });
});
