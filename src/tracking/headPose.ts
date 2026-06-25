/**
 * Head-pose estimation from FaceMesh landmarks.
 *
 * Webcam head-pose error is ~5-9°, so the original off-axis thresholds (pitch>12°, yaw>8°) fired
 * on measurement noise. We raise them to >2× the typical error (pitch≥20°, yaw≥15°) and recommend
 * reporting the continuous means rather than the dichotomised off-axis flag.
 */
import type { Point } from './blink';

export const HEAD_LANDMARKS = {
  noseTip: 1,
  chin: 152,
  leftEar: 234,
  rightEar: 454,
  leftEyeCorner: 133,
  rightEyeCorner: 362,
};

export const OFF_AXIS_PITCH_DEG = 20;
export const OFF_AXIS_YAW_DEG = 15;

/**
 * Population-default frontal nose fraction, used as the pitch zero ONLY when no per-person baseline
 * has been calibrated. Individual face geometry varies (nose length, chin position), so this default
 * carries an inter-individual bias; the calibration routine captures each participant's own frontal
 * fraction (see `noseVerticalFraction`) and passes it in, making 0° that participant's true frontal.
 */
export const NOSE_FRONTAL_FRAC = 0.45;
/**
 * Degrees per unit change in the nose fraction. Anchored to the off-axis threshold: a deviation of
 * ~0.20 of the eye-line→chin span corresponds to ~20° of head pitch (OFF_AXIS_PITCH_DEG). This is a
 * monocular proxy slope — without depth/ground-truth it is approximate; the per-person ZERO is what
 * is calibrated. Report the continuous mean, not the dichotomised off-axis flag.
 */
export const PITCH_SCALE_DEG = 100;

export interface HeadPose {
  pitch: number;
  yaw: number;
  roll: number;
}

/**
 * Nose-tip vertical position as a fraction of the eye-line→chin span. ~0.45 frontal; rises (toward
 * the eye-line) when the head pitches down. This is the raw quantity the pitch proxy is built on,
 * and the value the calibration routine samples (head frontal, eyes-only movement) to fix the
 * per-participant pitch zero. Returns null if the landmarks are degenerate (zero span).
 */
export function noseVerticalFraction(lm: Point[]): number | null {
  const nose = lm[HEAD_LANDMARKS.noseTip];
  const chin = lm[HEAD_LANDMARKS.chin];
  const leftEye = lm[HEAD_LANDMARKS.leftEyeCorner];
  const rightEye = lm[HEAD_LANDMARKS.rightEyeCorner];
  if (!nose || !chin || !leftEye || !rightEye) return null;
  const eyeLineY = (leftEye.y + rightEye.y) / 2;
  const eyeToChin = chin.y - eyeLineY;
  if (!Number.isFinite(eyeToChin) || Math.abs(eyeToChin) < 1e-6) return null;
  const frac = (nose.y - eyeLineY) / eyeToChin;
  return Number.isFinite(frac) ? frac : null;
}

/**
 * Estimate pitch/yaw/roll (degrees) from the landmark array.
 *
 * `pitchBaselineFrac` is the participant's calibrated frontal nose fraction (from `noseVerticalFraction`
 * during calibration). When supplied, pitch is measured relative to THIS person's frontal posture
 * (0° = their natural straight-ahead), removing the dominant inter-individual geometry bias. When
 * omitted, the population default (NOSE_FRONTAL_FRAC) is used — an uncalibrated proxy.
 */
export function estimateHeadPose(lm: Point[], pitchBaselineFrac?: number | null): HeadPose {
  const nose = lm[HEAD_LANDMARKS.noseTip];
  const leftEar = lm[HEAD_LANDMARKS.leftEar];
  const rightEar = lm[HEAD_LANDMARKS.rightEar];
  const leftEye = lm[HEAD_LANDMARKS.leftEyeCorner];
  const rightEye = lm[HEAD_LANDMARKS.rightEyeCorner];

  const earMidX = (leftEar.x + rightEar.x) / 2;
  const earSpan = Math.abs(rightEar.x - leftEar.x) + 1e-6;
  const yaw = ((nose.x - earMidX) / earSpan) * 90;

  // Pitch proxy: the nose tip's vertical position between the eye-line (top) and chin (bottom),
  // using three INDEPENDENT references (eyes, chin, nose) so it varies with head pitch. (The
  // previous `(nose.y + chin.y)/2` reference was a function of the nose itself, making the ratio
  // algebraically constant — pitch was pinned at +22.5° every frame.) Pitching down raises the
  // nose toward the eye-line (fraction ↓ → positive pitch). The zero is the participant's own
  // calibrated frontal fraction when available, else the population default.
  const noseFrac = noseVerticalFraction(lm) ?? NOSE_FRONTAL_FRAC;
  const zero = pitchBaselineFrac != null && Number.isFinite(pitchBaselineFrac) ? pitchBaselineFrac : NOSE_FRONTAL_FRAC;
  const pitch = (zero - noseFrac) * PITCH_SCALE_DEG;

  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);

  return { pitch, yaw, roll };
}

export function isOffAxis(pose: HeadPose): boolean {
  return Math.abs(pose.pitch) > OFF_AXIS_PITCH_DEG || Math.abs(pose.yaw) > OFF_AXIS_YAW_DEG;
}
