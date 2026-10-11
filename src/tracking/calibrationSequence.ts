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
import { GAZE_TARGETS, GAZE_DWELL_MS, type GazeDotId } from './gazeCalibration';
import { MIN_EAR_BASELINE_SAMPLES } from './blink';
import { STIMULUS_COLUMN_PX } from '@/lib/viewportScale';

/**
 * THE BASELINE WINDOW, RULE cal-r2 (Round 80, investigator instruction 2: "the calibration [...] could
 * not be done properly even with proper lighting").
 *
 *   cal-r1 (to Round 79): a FIXED six-second window on the routine's dark ground (#0a0a12), whatever
 *          the camera delivered in it. A window in which the face was found for a second or two failed
 *          with "N usable frames" and nothing else: no sign while it ran that the eyes were being
 *          measured, and no reason the operator could act on.
 *   cal-r2: on the GREY FIELD (CONFIG.ADAPTATION_COLOR, #808080) in its black ink, under the exposure
 *          fixed on that same field at camera setup (exp-r1). It runs AT LEAST CONFIG.EAR_BASELINE_MS,
 *          then on until MIN_EAR_BASELINE_SAMPLES usable frames have been taken, and stops at
 *          CONFIG.EAR_BASELINE_MAX_MS whatever it has. While it runs it says whether the eyes are found
 *          and whether they are being measured steadily (eyeState below); a window that ends short says
 *          why (baselineFailure). The floor of usable frames is unchanged: nothing here makes a baseline
 *          easier to accept.
 *
 * WHY THE GROUND CHANGED, AND WHY IT IS VERSIONED. Every blink cut is a fraction of this baseline. The
 * dark ground was the one screen of the sitting that lit the face least, so it was taken under face
 * light no reading condition has, and it was the slowest state for an automatically exposed camera
 * (R2 report, Round 78). The grey field is the one luminance every condition starts from (the
 * adaptation field before each), and camera setup fixes the exposure on it. The ground can move the
 * open eye a little (light changes the palpebral aperture), so a cal-r2 baseline is NOT assumed equal
 * to a cal-r1 one: each calibration record carries its rule (CalibrationRecord.calibration_rule), and
 * the export says which (01 calibration_rule_version).
 */
export const CALIBRATION_RULE = 'cal-r2' as const;
/** The rule of a calibration record written before the rule was recorded (a fixed 6-s window on #0a0a12). */
export const CALIBRATION_RULE_BEFORE = 'cal-r1' as const;
/** The ground the calibration steps run on: the grey field, in its own ink. */
export const CALIBRATION_GROUND = CONFIG.ADAPTATION_COLOR;
export const CALIBRATION_INK = CONFIG.ADAPTATION_INK;

/**
 * The share of the camera's delivered frames that must yield a usable eye for a calibration step to
 * count as "steady" — the same half the gaze check asks of each dot. Half is a judgement, chosen to be
 * lenient: at 24 frames a second it is 12 usable frames a second, and the baseline's own floor
 * (MIN_EAR_BASELINE_SAMPLES) is what decides whether the baseline is kept.
 */
export const CALIBRATION_MIN_SHARE = 0.5;
/** Rate assumed when the camera's delivered rate is not known yet. 30 over-asks on a slower camera, the safe side. */
export const NOMINAL_DELIVERED_FPS = 30;
/** "Eyes found" means a usable eye in this many ms just past. */
export const EYES_FOUND_WITHIN_MS = 500;
/** "Steady" is judged over this many ms just past. */
export const STEADY_WINDOW_MS = 1000;

/** Centre fixation, straight ahead, blinking normally. The only window the EAR baseline is fitted from. */
export interface EarBaselineStep {
  kind: 'ear_baseline';
  /** The least time the window runs (CONFIG.EAR_BASELINE_MS). */
  ms: number;
  /** The most: it stops here with whatever it has (CONFIG.EAR_BASELINE_MAX_MS). */
  maxMs: number;
  /** Usable frames it runs on for, past `ms` (MIN_EAR_BASELINE_SAMPLES, the fit's own floor). */
  minSamples: number;
}

/** True when the window may close: past its least time with enough usable frames, or at its most. */
export function baselineWindowDone(elapsedMs: number, usable: number, step: Pick<EarBaselineStep, 'ms' | 'maxMs' | 'minSamples'>): boolean {
  return (elapsedMs >= step.ms && usable >= step.minSamples) || elapsedMs >= step.maxMs;
}

/** What the camera saw in the window: every processed frame, those with a face, those with a usable eye. */
export interface BaselineCounts { frames: number; faceFrames: number; usable: number }

/**
 * Why a window ended without a baseline, in the order the operator should check things.
 *
 *   no_frames         the tracker produced nothing in the window: the camera or the tracker stalled.
 *   no_face           a face in under half the frames: seating, framing, the participant out of view.
 *   eyes_not_measured a face in most frames but a usable eye in under half of them: glare on spectacles
 *                     or the lid margin, a lamp behind the tablet, eyes half-closed.
 *   too_few_frames    face and eyes measured, but the camera delivered too few frames in the window.
 *
 * The halves only sort the failure into a sentence; whether a baseline is kept is decided by
 * MIN_EAR_BASELINE_SAMPLES alone.
 */
export type BaselineFailure = 'no_frames' | 'no_face' | 'eyes_not_measured' | 'too_few_frames';

export function baselineFailure(c: BaselineCounts, minSamples = MIN_EAR_BASELINE_SAMPLES): BaselineFailure | null {
  if (c.usable >= minSamples) return null;
  if (c.frames === 0) return 'no_frames';
  if (c.faceFrames < 0.5 * c.frames) return 'no_face';
  if (c.usable < 0.5 * c.faceFrames) return 'eyes_not_measured';
  return 'too_few_frames';
}

/** The live state of a calibration step, as the screen shows it: eyes found, steady, done. */
export type EyeState = 'searching' | 'face_only' | 'found';

/**
 * From the capture times of the frames just past: is there a face, is there a usable eye, and are the
 * eyes being measured in at least CALIBRATION_MIN_SHARE of the frames the camera delivers?
 */
export function eyeState(p: {
  now: number;
  faceTimes: number[];
  usableTimes: number[];
  deliveredFps: number | null;
}): { eyes: EyeState; steady: boolean } {
  const recent = (ts: number[], ms: number) => ts.filter((t) => p.now - t <= ms && t <= p.now).length;
  const eyes: EyeState = recent(p.usableTimes, EYES_FOUND_WITHIN_MS) > 0 ? 'found'
    : recent(p.faceTimes, EYES_FOUND_WITHIN_MS) > 0 ? 'face_only' : 'searching';
  const fps = p.deliveredFps != null && Number.isFinite(p.deliveredFps) && p.deliveredFps > 0 ? p.deliveredFps : NOMINAL_DELIVERED_FPS;
  const steady = eyes === 'found'
    && recent(p.usableTimes, STEADY_WINDOW_MS) >= CALIBRATION_MIN_SHARE * fps * (STEADY_WINDOW_MS / 1000);
  return { eyes, steady };
}

/*
 * THE GAZE CHECK'S DOTS (rule gaze-r2, gazeCalibration.ts). Three dots on a mid-height reading line:
 * its middle and its two ends, half the reading column (STIMULUS_COLUMN_PX) either side of centre, in
 * root px, so they sit where a line of text begins and ends on any screen the canvas is fitted to.
 * Centre first: the participant is already looking there after the baseline.
 *
 * Each dot is shown for GAZE_DOT_SETTLE_MS before it is sampled (the eye arrives and settles; those
 * frames are not kept), then sampled for GAZE_DOT_SAMPLE_MS. A dot needs gazeDotNeeded() open-eye
 * frames: CALIBRATION_MIN_SHARE of what the camera delivered in that second, MEASURED at the time, not
 * an assumed 30. Short of it the dot is shown again (up to GAZE_DOT_ATTEMPTS in all), and only that dot.
 * R2 (C3) proposed these timings; the nine-point routine gave each target 800 ms after a 250 ms settle.
 */
export const GAZE_DOTS: Array<{ id: GazeDotId; dx: number }> = [
  { id: 'centre', dx: 0 },
  { id: 'left', dx: -STIMULUS_COLUMN_PX / 2 },
  { id: 'right', dx: STIMULUS_COLUMN_PX / 2 },
];
export const GAZE_DOT_SETTLE_MS = 500;
export const GAZE_DOT_SAMPLE_MS = 1000;
export const GAZE_DOT_ATTEMPTS = 3;

/** Open-eye frames a dot needs, from the camera's delivered rate (NOMINAL_DELIVERED_FPS when not known). */
export function gazeDotNeeded(deliveredFps: number | null | undefined): number {
  const fps = deliveredFps != null && Number.isFinite(deliveredFps) && deliveredFps > 0 ? deliveredFps : NOMINAL_DELIVERED_FPS;
  return Math.max(1, Math.ceil(CALIBRATION_MIN_SHARE * fps * (GAZE_DOT_SAMPLE_MS / 1000)));
}

/** What the baseline window reports while it runs, a few times a second. */
export interface BaselineProgress {
  elapsedMs: number;
  usable: number;
  /** Usable frames the window runs on for (step.minSamples). */
  needed: number;
  minMs: number;
  maxMs: number;
  eyes: EyeState;
  steady: boolean;
}

/** What the baseline window established, and the evidence behind it. */
export interface BaselineResult extends BaselineCounts {
  baseline: number | null;
  /** How long the window actually ran. */
  ms: number;
  reason: BaselineFailure | null;
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
    { kind: 'ear_baseline', ms: CONFIG.EAR_BASELINE_MS, maxMs: CONFIG.EAR_BASELINE_MAX_MS, minSamples: MIN_EAR_BASELINE_SAMPLES },
    ...GAZE_TARGETS.map((t) => ({ kind: 'gaze_target' as const, id: t.id, x: t.x, y: t.y, ms: GAZE_DWELL_MS })),
  ];
}
