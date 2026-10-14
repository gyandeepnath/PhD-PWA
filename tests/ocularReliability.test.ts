/**
 * Rule rel-r1 (Round 83): the dashboard's and the export's reliability verdict, read off the analysis's
 * own checks. Pinned here: the thresholds against analysis_template.R, the mapping to the three words,
 * the codes the export writes, and the version string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ocularReliability, reliabilityHeadline, reliabilityReason, RELIABILITY_GATES, RELIABILITY_RULE_VERSION, RELIABILITY_WORD,
  type ReliabilityInput,
} from '@/tracking/ocularReliability';
import { ENGAGEMENT } from '@/dashboard/aggregate';
import { FPS_GATE } from '@/tracking/frameRateGate';

const ok: ReliabilityInput = {
  hasEyeRecord: true, cameraActive: true, blinkTotal: 40, hasBaseline: true,
  fps: 24.3, fpsConsistent: true, fpsMedian: 24.1,
  facePresence: 0.97, offAxis: 0.04, observedMs: 175_000, readingMs: 178_000,
};

describe('the thresholds are the R template\'s, read out of the file', () => {
  const r = readFileSync('src/analysis/analysis_template.R', 'utf8');
  const constant = (name: string) => {
    const m = new RegExp(`^${name}\\s*<-\\s*([0-9.]+)`, 'm').exec(r);
    expect(m, name).not.toBeNull();
    return Number(m![1]);
  };
  it('face in view, head turned away and the observed share', () => {
    expect(RELIABILITY_GATES.FACE_IN_VIEW_MIN).toBe(constant('QC_FACE_PRESENCE_MIN'));
    expect(RELIABILITY_GATES.HEAD_TURNED_AWAY_MAX).toBe(constant('QC_OFF_AXIS_MAX'));
    expect(RELIABILITY_GATES.EXPOSURE_MIN_FRAC).toBe(constant('QC_EXPOSURE_MIN_FRAC'));
    // The protocol's pilot gate, as the dashboard's engagement scorer states it.
    expect(RELIABILITY_GATES.FACE_IN_VIEW_MIN).toBe(ENGAGEMENT.FACE_PRESENCE_PILOT_GATE);
  });
  it('the R template applies them with the same strict inequalities, and filters the same three exclusions', () => {
    expect(r).toMatch(/face_presence_ratio < QC_FACE_PRESENCE_MIN/);
    expect(r).toMatch(/off_axis_ratio > QC_OFF_AXIS_MAX/);
    expect(r).toMatch(/observed_frac < QC_EXPOSURE_MIN_FRAC/);
    expect(r).toMatch(/filter\(camera_active == 1\)/);
    expect(r).toMatch(/filter\(!is\.na\(blink_total\), blink_total > 0\)/);
    expect(r).toMatch(/filter\(!\(fps_tier %in% "C"\)\)/);
  });
});

describe('the verdict', () => {
  it('is good when every check holds, with no codes', () => {
    const v = ocularReliability(ok);
    expect(v.reliability).toBe('good');
    expect(v.codes).toBe('');
    expect(v.rule_version).toBe(RELIABILITY_RULE_VERSION);
    expect(RELIABILITY_RULE_VERSION).toBe('rel-r1');
    expect(v.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('is NOT USABLE exactly where the R template leaves the row out of the eye-data models', () => {
    expect(ocularReliability({ ...ok, cameraActive: false }).codes).toBe('camera_off');
    expect(ocularReliability({ ...ok, hasEyeRecord: false }).reliability).toBe('not_usable');
    expect(ocularReliability({ ...ok, hasEyeRecord: false }).codes).toBe('no_eye_record');
    expect(ocularReliability({ ...ok, blinkTotal: null, hasBaseline: false }).codes).toBe('blinks_not_counted');
    expect(ocularReliability({ ...ok, blinkTotal: 0 }).codes).toBe('zero_blinks');
    const c = ocularReliability({ ...ok, fps: FPS_GATE.REDUCED - 0.01 });
    expect(c.reliability).toBe('not_usable');
    expect(c.codes).toBe('fps_tier_C');
  });

  it('is USABLE where the row is modelled but a pre-registered re-fit leaves it out', () => {
    const cases: Array<[Partial<ReliabilityInput>, string]> = [
      [{ fps: FPS_GATE.ADEQUATE - 0.01 }, 'fps_tier_B'],
      [{ fpsConsistent: false }, 'fps_off_usual'],
      [{ facePresence: 0.89 }, 'face_in_view'],
      [{ offAxis: 0.21 }, 'head_turned_away'],
      [{ observedMs: 0.89 * 178_000 }, 'exposure_short'],
      [{ fps: null, fpsConsistent: null }, 'fps_unknown'],
    ];
    for (const [patch, code] of cases) {
      const v = ocularReliability({ ...ok, ...patch });
      expect(v.reliability, code).toBe('usable');
      expect(v.codes, code).toBe(code);
    }
  });

  it('does not flag at the thresholds exactly (R\'s inequalities are strict)', () => {
    const v = ocularReliability({ ...ok, fps: FPS_GATE.ADEQUATE, facePresence: 0.9, offAxis: 0.2, observedMs: 0.9 * 178_000 });
    expect(v.reliability).toBe('good');
  });

  it('judges nothing it has no value for, as R\'s is.finite guards do', () => {
    const v = ocularReliability({ ...ok, facePresence: null, offAxis: null, observedMs: null, fpsConsistent: null });
    expect(v.reliability).toBe('good');
    expect(v.checks.filter((c) => c.status === 'not_judged').map((c) => c.key)).toEqual(['consistency', 'face', 'head', 'exposure']);
    // With the camera off, nothing after the camera is judged.
    const off = ocularReliability({ ...ok, cameraActive: false });
    expect(off.checks.slice(1).every((c) => c.status === 'not_judged')).toBe(true);
  });

  it('lists fails before flags, in check order', () => {
    const v = ocularReliability({ ...ok, fps: 12, fpsConsistent: false, facePresence: 0.5, blinkTotal: 0 });
    expect(v.codes).toBe('zero_blinks;fps_tier_C;fps_off_usual;face_in_view');
    expect(reliabilityHeadline(v, 'x')).toBe('Not usable: no blinks were counted (+3 more)');
    // The dashboard prints the reason under the verdict's own word, so the reason does not repeat it.
    expect(reliabilityReason(v)).toBe('no blinks were counted (+3 more)');
    expect(reliabilityReason(ocularReliability(ok))).toBeNull();
    expect(reliabilityHeadline(ocularReliability(ok), '38 blinks in 2.9 min')).toBe('Good: 38 blinks in 2.9 min, every check passed');
  });

  it('names each gate and what the analysis does, so a reader can find the rule', () => {
    const v = ocularReliability({ ...ok, fps: 18, facePresence: 0.8 });
    const rate = v.checks.find((c) => c.key === 'rate')!;
    expect(rate.gate).toBe('fps-g2 tier (plan §5.2)');
    expect(rate.consequence).toBe('Kept; left out of the tier-A-only re-check.');
    expect(v.checks.find((c) => c.key === 'face')!.gate).toBe('face in view (plan §5.3)');
    expect(RELIABILITY_WORD).toEqual({ good: 'Good', usable: 'Usable', not_usable: 'Not usable' });
  });
});
