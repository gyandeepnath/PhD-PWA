/**
 * The three checks run once per sitting before the readings — the open-eye baseline, the camera check
 * and the gaze check — as the dashboard's Data Quality tab states them above the condition rows.
 *
 * WHY (Round 83). Testing 2.3.1, the investigator found the calibration and the flashing-dot camera
 * check hard to complete, and the dashboard said nothing about either: whether the baseline every blink
 * line rests on was measured, or whether the camera check passed, could be read only in
 * 01_session_info.csv. Each check is reported here under its own rule and in its own screen's words,
 * read from the same fields and the same calibration record as that file (the LAST calibration, as
 * 01 describes it), so the page and the export cannot disagree. Nothing is judged anew: a status is
 * the verdict the check itself gave when it ran.
 *
 * What each one means for the blink data:
 *   Open-eye baseline (cal-r*)  no baseline, no blink counted: the readings it governed are not usable.
 *   Camera check (st-r*)        a QC record that the camera saw this person's deliberate blinks; no
 *                               analysis rule uses it (ANALYSIS_PLAN §5 item 2).
 *   Gaze check (gaze-r*)        for the on-screen ratio only; no hypothesis and no rule uses gaze
 *                               (§5 item 7), so a gaze check that did not pass is "not measured", not
 *                               a fault.
 */
import type { SessionBundle } from '@/storage/gather';
import { latestCalibration } from '@/storage/calibrationLookup';
import { CALIBRATION_RULE_BEFORE, type BaselineFailure } from '@/tracking/calibrationSequence';
import { GAZE_RULE_BEFORE } from '@/tracking/gazeCalibration';
import { SELF_TEST_RULE_V1 } from '@/tracking/selfTest';
import { fpsText } from '@/tracking/frameRateGate';
import { MEASURE } from '@/tracking/measurementSchedule';

export interface SittingCheck {
  key: 'baseline' | 'camera_check' | 'gaze_check';
  /** The measure's one screen name (MEASURE). */
  label: string;
  /** good: passed. warn: passed, flagged (a reduced camera check). bad: did not pass. none: not run or not measured. */
  status: 'good' | 'warn' | 'bad' | 'none';
  /** A few words: the check's own verdict. */
  value: string;
  /** The rule it ran under, e.g. "cal-r2"; null when it did not run. */
  rule: string | null;
  /** The numbers behind it, for Details. */
  detail: string;
}

/** Why the baseline window gave no baseline, in the calibration screen's order (calibrationSequence.ts). */
const BASELINE_WHY: Record<BaselineFailure, string> = {
  no_frames: 'no camera frames',
  no_face: 'face not found',
  eyes_not_measured: 'eyes not measured',
  too_few_frames: 'too few frames',
};
const GAZE_WHY: Record<string, string> = {
  too_few_samples: 'a dot had too few frames',
  not_separable: 'the dots did not separate',
  not_run: 'not run',
};

export function sittingChecks(bundle: SessionBundle): SittingCheck[] {
  const cal = latestCalibration(bundle.calibration);
  const runs = bundle.calibration.length;
  const ofRuns = runs > 1 ? ` The latest of ${runs} calibrations (calibration_runs).` : '';
  const checks: SittingCheck[] = [];

  // The open-eye baseline: every blink threshold is a fraction of it.
  if (!cal) {
    checks.push({ key: 'baseline', label: MEASURE.openEyeBaseline.name, status: 'none', value: 'not run', rule: null, detail: 'No calibration record for this sitting.' });
  } else {
    const rule = cal.calibration_rule ?? CALIBRATION_RULE_BEFORE;
    const frames = cal.ear_samples_usable != null ? `${cal.ear_samples_usable} usable frames` : null;
    const secs = cal.ear_baseline_ms != null ? `in ${(cal.ear_baseline_ms / 1000).toFixed(1)} s` : null;
    const tries = cal.ear_baseline_attempts != null && cal.ear_baseline_attempts > 1 ? `${cal.ear_baseline_attempts} tries` : null;
    const evidence = [frames && secs ? `${frames} ${secs}` : frames ?? secs, tries].filter(Boolean).join(', ');
    checks.push(cal.ear_baseline != null
      ? { key: 'baseline', label: MEASURE.openEyeBaseline.name, status: 'good', value: 'measured', rule,
        detail: `Baseline ${cal.ear_baseline.toFixed(3)}${evidence ? ` from ${evidence}` : ''}.${ofRuns}` }
      : { key: 'baseline', label: MEASURE.openEyeBaseline.name, status: 'bad',
        value: `not measured${cal.ear_baseline_reason ? `: ${BASELINE_WHY[cal.ear_baseline_reason]}` : ''}`, rule,
        detail: `No baseline${evidence ? ` (${evidence})` : ''}, so no blink is counted in the readings it governed.${ofRuns}` });
  }

  // The camera check: its own verdict, as its screen showed it.
  const st = bundle.session.camera_selftest;
  if (!st) {
    checks.push({ key: 'camera_check', label: MEASURE.cameraCheck.name, status: 'none', value: 'not run', rule: null, detail: 'No camera check recorded (camera not used, or a sitting from before the check).' });
  } else {
    const rule = st.rule ?? SELF_TEST_RULE_V1;
    // st-r1 sittings have no verdict: pass is theirs (01 selftest_pass).
    const verdict = st.verdict ?? (st.pass ? 'working' : 'failed');
    const seen = `${st.detected} of ${st.cued} flashes`;
    const rate = st.samplingFps != null ? `eye sampled ${fpsText(st.samplingFps)} a second` : st.fps != null ? `${fpsText(st.fps)} face frames a second` : null;
    const face = st.facePresence != null ? `face in view ${Math.round(st.facePresence * 100)}%` : null;
    const attempts = st.attempt != null && st.attempt > 1 ? `attempt ${st.attempt}` : null;
    checks.push({
      key: 'camera_check', label: MEASURE.cameraCheck.name,
      status: verdict === 'working' ? 'good' : verdict === 'reduced' ? 'warn' : 'bad',
      value: `${verdict === 'failed' ? 'did not pass' : verdict}, ${seen}`, rule,
      detail: [seen, rate, face, `${st.extra} extra blink${st.extra === 1 ? '' : 's'}`, attempts].filter(Boolean).join(' · ')
        + (verdict === 'failed' ? '. The operator continued anyway: read the blink data of this sitting with caution.' : '.'),
    });
  }

  // The gaze check: for the on-screen ratio only.
  if (!cal) {
    checks.push({ key: 'gaze_check', label: MEASURE.gazeCheck.name, status: 'none', value: 'not run', rule: null, detail: 'No calibration record for this sitting.' });
  } else {
    const rule = cal.gaze_rule ?? GAZE_RULE_BEFORE;
    const why = cal.gaze_check?.reason ? GAZE_WHY[cal.gaze_check.reason] ?? cal.gaze_check.reason : null;
    checks.push(cal.is_real_calibration
      ? { key: 'gaze_check', label: MEASURE.gazeCheck.name, status: 'good', value: 'passed', rule,
        detail: `${cal.targets_detected} of ${cal.targets_total} dots; the on-screen ratio is computed.${ofRuns}` }
      : { key: 'gaze_check', label: MEASURE.gazeCheck.name, status: 'none', value: `not passed${why ? `: ${why}` : ''}`, rule,
        detail: `${cal.targets_detected} of ${cal.targets_total} dots. No on-screen ratio; nothing else depends on it.${ofRuns}` });
  }
  return checks;
}
