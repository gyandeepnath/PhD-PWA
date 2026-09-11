/**
 * The calibration routine as data: which windows are opened, in what order, and for how long.
 *
 * WHY THIS IS A MODULE AND NOT A LOOP INSIDE THE SCREEN.
 *
 * The open-eye EAR baseline and the nine-point gaze fit were collected from the SAME frames. One
 * window was opened at the start of the routine and everything the camera solved for the next eight
 * seconds went into both pools. That is not a shared window, it is a confounded one: the nine
 * targets deliberately move the eye through three vertical postures, a third of the routine is
 * spent on the top row, and up-gaze lifts the upper lid and widens the palpebral fissure. The
 * baseline is the 90th percentile of the pool — the statistic that selects the widest frames in it —
 * so it settled on the up-gaze tail rather than on the participant's straight-ahead open eye.
 *
 * Both blink thresholds are fractions of that number (EAR_TIERS: 0.75 for onset, 0.60 for a
 * complete closure), so an inflated baseline inflates both. A blink whose minimum does not reach lid
 * apposition — an INCOMPLETE blink, the thing this study counts — passes below an inflated 0.60
 * threshold and is recorded as complete. The bias runs in one direction, it falls on the primary
 * outcome, and it runs AGAINST the study's own hypothesis, which makes it the kind of error that is
 * never noticed because the result merely looks null.
 *
 * The fix is posture, not arithmetic: measure the open eye where the outcome is measured, at centre
 * fixation, in its own window, before the eye is asked to move. Expressing the routine as a list of
 * steps is what lets that ordering be asserted rather than hoped for — the screen iterates this
 * array, so a test that reads it is reading what the participant will actually be taken through.
 */
import { CONFIG } from '@/experiment/config';
import { GAZE_TARGETS } from './gazeCalibration';

/** Centre fixation, straight ahead, blinking normally. The only window the EAR baseline is fitted from. */
export interface EarBaselineStep {
  kind: 'ear_baseline';
  ms: number;
}

/** One of the nine gaze targets. Contributes iris offset only; contributes NO EAR sample. */
export interface GazeTargetStep {
  kind: 'gaze_target';
  id: string;
  x: number;
  y: number;
  ms: number;
}

export type CalibrationStep = EarBaselineStep | GazeTargetStep;

/** Dwell per gaze target. Long enough to fixate and settle, short enough that nine of them are tolerable. */
export const GAZE_DWELL_MS = 800;

export function calibrationSequence(): CalibrationStep[] {
  return [
    { kind: 'ear_baseline', ms: CONFIG.EAR_BASELINE_MS },
    ...GAZE_TARGETS.map((t) => ({ kind: 'gaze_target' as const, id: t.id, x: t.x, y: t.y, ms: GAZE_DWELL_MS })),
  ];
}
