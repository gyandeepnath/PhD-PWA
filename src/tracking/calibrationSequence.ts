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
import { GAZE_TARGETS, GAZE_DWELL_MS } from './gazeCalibration';

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

/*
 * GAZE_DWELL_MS lives in gazeCalibration.ts and is re-exported here, where it used to be defined.
 *
 * It moved because gazeQuality() needs it — the expected sample count for a target is its dwell
 * times the achieved frame rate — and importing it from here created a cycle: this module already
 * imports GAZE_TARGETS from there. Both uses sit inside function bodies so the cycle happened to
 * work, which is exactly the kind of thing that stops working after a bundler reorders modules.
 * The dwell is a property of the gaze calibration, so it belongs with it.
 */
export { GAZE_DWELL_MS } from './gazeCalibration';

/**
 * Pause after a step appears, before sampling starts, so the participant is looking at the thing
 * being measured rather than at where it used to be.
 *
 * Named rather than inline because the feasibility model has to be able to add it up. See
 * `calibrationMachineMs()`.
 */
export const STEP_SETTLE_MS = 250;

/**
 * How long the routine occupies the tablet, excluding anything the participant or operator does.
 *
 * The feasibility model used to carry calibration as a hardcoded 150-second guess, under a file
 * header claiming "every app-controlled duration is read from the real CONFIG". That was true of
 * everything except this, and it stopped being harmless when a six-second open-eye baseline window
 * was added to the routine: the protocol got longer and the model that decides whether the protocol
 * fits its feasibility gate did not know. Deriving it here means the model follows the routine
 * automatically, and a future change to either constant cannot silently desynchronise them.
 */
export function calibrationMachineMs(): number {
  return calibrationSequence().reduce((total, step) => total + STEP_SETTLE_MS + step.ms, 0);
}

export function calibrationSequence(): CalibrationStep[] {
  return [
    { kind: 'ear_baseline', ms: CONFIG.EAR_BASELINE_MS },
    ...GAZE_TARGETS.map((t) => ({ kind: 'gaze_target' as const, id: t.id, x: t.x, y: t.y, ms: GAZE_DWELL_MS })),
  ];
}
