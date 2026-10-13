/**
 * "Is the blink data reliable?" — the dashboard's plain-language verdict per condition, rule rel-r1
 * (Round 82): good, usable or not usable, read off the analysis's own checks, with notes beside it.
 */
import { describe, it, expect } from 'vitest';
import { buildConditionSummaries, cameraVerdict } from '@/dashboard/aggregate';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { EyeMetricsRecord } from '@/storage/types';

const fixtureEye = (): EyeMetricsRecord => buildFixtureBundle().eyeMetrics.find((e) => e.camera_active)!;
const fine = {
  facePresence: 0.97, fps: 30, lighting: 'good' as const, blinks: 60, minutes: 5,
  consistent: true, median: 30, offAxis: 0.04, readingMs: null as number | null,
};

describe('camera verdict (rule rel-r1)', () => {
  it('says Good, with the count and rate, when every check holds', () => {
    const eye = { ...fixtureEye(), camera_blocked_ms: 0, open_ear_measured: null };
    const v = cameraVerdict(eye, { ...fine, readingMs: eye.observed_duration_ms });
    expect(v.level).toBe('good');
    expect(v.reliability).toBe('good');
    expect(v.headline).toBe('Good: 60 blinks in 5.0 min (12.0 a minute), every check passed');
    expect(v.problems).toEqual([]);
    expect(v.notes).toEqual([]);
  });

  it('names why there is no data when the camera was off: not usable', () => {
    const lost = cameraVerdict({ ...fixtureEye(), camera_active: false, camera_inactive_reason: 'lost' }, fine);
    expect(lost.reliability).toBe('not_usable');
    expect(lost.headline).toBe('Not usable: camera stopped during the reading');
    expect(lost.notes).toEqual([]);
    expect(cameraVerdict(undefined, fine).level).toBe('bad');
    expect(cameraVerdict(undefined, fine).headline).toBe('Not usable: no eye record for this condition');
  });

  it('says why blinks are missing: no open-eye baseline is not usable', () => {
    const v = cameraVerdict({ ...fixtureEye(), ear_baseline: null }, { ...fine, blinks: null });
    expect(v.reliability).toBe('not_usable');
    expect(v.headline).toBe('Not usable: no open-eye baseline, so no blinks were counted');
    expect(cameraVerdict(fixtureEye(), { ...fine, blinks: 0 }).headline).toBe('Not usable: no blinks were counted');
  });

  it('judges the frame rate by gate fps-g2: tier A good, B usable, C not usable, and a jump from the usual is usable', () => {
    const eye = { ...fixtureEye(), camera_blocked_ms: 0, open_ear_measured: null };
    expect(cameraVerdict(eye, { ...fine, fps: 24, median: 24 }).reliability).toBe('good');
    expect(cameraVerdict(eye, { ...fine, fps: 20, median: 20 }).reliability).toBe('good');
    const b = cameraVerdict(eye, { ...fine, fps: 19.9, median: 19.9 });
    expect(b.reliability).toBe('usable');
    expect(b.problems).toEqual(['eye sampling rate reduced (19.9 a second; 20 is adequate)']);
    const low = cameraVerdict(eye, { ...fine, fps: 12, median: 12 });
    expect(low.reliability).toBe('not_usable');
    expect(low.problems).toEqual(['eye sampling rate too slow (12.0 a second; 15 needed)']);
    expect(low.checks.find((c) => c.key === 'rate')!.gate).toBe('fps-g2 tier (plan §5.2)');
    const unknown = cameraVerdict(eye, { ...fine, fps: null, consistent: null });
    expect(unknown.reliability).toBe('usable');
    expect(unknown.problems).toEqual(['eye sampling rate not measurable']);
    const off = cameraVerdict(eye, { ...fine, fps: 24, consistent: false, median: 28.5 });
    expect(off.reliability).toBe('usable');
    expect(off.problems).toEqual(['eye sampling rate 24.0, more than 2 from the usual 28.5']);
  });

  it('flags the §5.3-5.4 checks the R template applies, at its thresholds, as usable, never as not usable', () => {
    // A face in view 85% of the time used to read "Not trustworthy" here; the analysis keeps the row and
    // leaves it out of the quality-clean re-fit only. So does a head turned away and a short exposure.
    const eye = { ...fixtureEye(), camera_blocked_ms: 0, open_ear_measured: null, observed_duration_ms: 150_000 };
    const v = cameraVerdict(eye, { ...fine, facePresence: 0.85, offAxis: 0.27, readingMs: 180_000 });
    expect(v.reliability).toBe('usable');
    expect(v.problems).toEqual([
      'face in view 85% (90% needed)',
      'head turned away 27% of the time (20% at most)',
      'the camera saw 83% of the reading (90% needed)',
    ]);
    expect(v.headline).toBe('Usable: face in view 85% (90% needed) (+2 more)');
    // At the threshold exactly, the R template does not flag (strict inequalities).
    const edge = cameraVerdict({ ...eye, observed_duration_ms: 162_000 }, { ...fine, facePresence: 0.9, offAxis: 0.2, readingMs: 180_000 });
    expect(edge.reliability).toBe('good');
  });

  it('keeps few blinks, a covered camera, a narrower eye and the light as notes: they never change the verdict', () => {
    const base = fixtureEye();
    const eye = { ...base, ear_baseline: 0.3, open_ear_measured: 0.24, camera_blocked_ms: 40_000 };
    const v = cameraVerdict(eye, { ...fine, blinks: 8, lighting: 'low', readingMs: null });
    expect(v.reliability).toBe('good');
    expect(v.notes.map((n) => n.key)).toEqual(['few_blinks', 'covered', 'narrower_eye', 'lighting']);
    expect(v.notes[0].text).toMatch(/^Only 8 blinks/);
    expect(v.notes[1].text).toMatch(/covered or dark for 40 s/);
    expect(v.notes[2].text).toMatch(/20% narrower/);
  });

  it('is attached to every condition summary', () => {
    for (const s of buildConditionSummaries(buildFixtureBundle())) {
      expect(['good', 'usable', 'not_usable']).toContain(s.camera_verdict.reliability);
      expect(s.camera_verdict.headline.length).toBeGreaterThan(10);
      expect(s.camera_verdict.checks.map((c) => c.key)).toEqual(['camera', 'blinks', 'rate', 'consistency', 'face', 'head', 'exposure']);
    }
  });
});
