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

export interface HeadPose {
  pitch: number;
  yaw: number;
  roll: number;
}

/** Estimate pitch/yaw/roll (degrees) from the landmark array. */
export function estimateHeadPose(lm: Point[]): HeadPose {
  const nose = lm[HEAD_LANDMARKS.noseTip];
  const chin = lm[HEAD_LANDMARKS.chin];
  const leftEar = lm[HEAD_LANDMARKS.leftEar];
  const rightEar = lm[HEAD_LANDMARKS.rightEar];
  const leftEye = lm[HEAD_LANDMARKS.leftEyeCorner];
  const rightEye = lm[HEAD_LANDMARKS.rightEyeCorner];

  const earMidX = (leftEar.x + rightEar.x) / 2;
  const earSpan = Math.abs(rightEar.x - leftEar.x) + 1e-6;
  const yaw = ((nose.x - earMidX) / earSpan) * 90;

  const faceMidY = (nose.y + chin.y) / 2;
  const faceHeight = Math.abs(chin.y - nose.y) + 1e-6;
  const pitch = -((nose.y - faceMidY) / faceHeight) * 45;

  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);

  return { pitch, yaw, roll };
}

export function isOffAxis(pose: HeadPose): boolean {
  return Math.abs(pose.pitch) > OFF_AXIS_PITCH_DEG || Math.abs(pose.yaw) > OFF_AXIS_YAW_DEG;
}
