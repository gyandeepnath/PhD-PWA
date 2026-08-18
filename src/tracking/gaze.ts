/**
 * Gaze-zone estimation from iris landmarks.
 *
 * IMPORTANT: gaze is only meaningful with genuine per-participant calibration. The original
 * 9-point "calibration" stored hardcoded zeros and never fitted thresholds, so its gaze-zone data
 * was uncalibrated noise. Here, thresholds are explicit inputs: when a real calibration produced
 * them, `calibrated` is true; otherwise we fall back to defaults and downstream metrics must be
 * caveated (gaze_calibrated=false).
 */
import type { Point } from './blink';

export const IRIS = { left: 468, right: 473 };
/** Eye bounding-box corner landmarks (outer/inner) for normalising iris offset. */
export const EYE_BOX = {
  leftOuter: 33,
  leftInner: 133,
  rightInner: 362,
  rightOuter: 263,
  topL: 159,
  botL: 145,
  topR: 386,
  botR: 374,
};

export const DEFAULT_GAZE_THRESHOLD = 0.18;

export type GazeZone =
  | 'tl' | 'tc' | 'tr'
  | 'ml' | 'cc' | 'mr'
  | 'bl' | 'bc' | 'br';

const ZONE_GRID: GazeZone[][] = [
  ['tl', 'tc', 'tr'],
  ['ml', 'cc', 'mr'],
  ['bl', 'bc', 'br'],
];

export interface GazeResult {
  h: number; // normalised horizontal offset, -1..1
  v: number; // normalised vertical offset, -1..1
  zone: GazeZone;
  isCenter: boolean;
}

/** Normalised iris offset within the eye box, averaged across both eyes.
 *  `h0`/`v0` are the fitted neutral bias from calibration (default 0 = uncalibrated). */
export function estimateGaze(
  lm: Point[],
  hThreshold = DEFAULT_GAZE_THRESHOLD,
  vThreshold = DEFAULT_GAZE_THRESHOLD,
  h0 = 0,
  v0 = 0,
): GazeResult {
  const irisL = lm[IRIS.left];
  const irisR = lm[IRIS.right];
  const lIn = lm[EYE_BOX.leftInner];
  const lOut = lm[EYE_BOX.leftOuter];
  const rIn = lm[EYE_BOX.rightInner];
  const rOut = lm[EYE_BOX.rightOuter];

  // A partially-solved frame gives a short landmark array. Dereferencing threw inside the frame
  // loop and stopped tracking for the remainder of the condition; an unresolved gaze is reported
  // as off-centre-unknown instead, which the aggregator already treats as "not measured".
  if (!irisL || !irisR || !lIn || !lOut || !rIn || !rOut) {
    return { zone: 'cc', isCenter: false, h: NaN, v: NaN };
  }

  const leftBoxW = lIn.x - lOut.x + 1e-6;
  const rightBoxW = lm[EYE_BOX.rightOuter].x - lm[EYE_BOX.rightInner].x + 1e-6;
  const hL = ((irisL.x - lm[EYE_BOX.leftOuter].x) / leftBoxW - 0.5) * 2;
  const hR = ((irisR.x - lm[EYE_BOX.rightInner].x) / rightBoxW - 0.5) * 2;
  const h = (hL + hR) / 2;

  const leftBoxH = lm[EYE_BOX.botL].y - lm[EYE_BOX.topL].y + 1e-6;
  const rightBoxH = lm[EYE_BOX.botR].y - lm[EYE_BOX.topR].y + 1e-6;
  const vL = ((irisL.y - lm[EYE_BOX.topL].y) / leftBoxH - 0.5) * 2;
  const vR = ((irisR.y - lm[EYE_BOX.topR].y) / rightBoxH - 0.5) * 2;
  const v = (vL + vR) / 2;

  // Subtract the fitted neutral bias before thresholding.
  const hc = h - h0;
  const vc = v - v0;
  const col = hc < -hThreshold ? 0 : hc > hThreshold ? 2 : 1;
  const row = vc < -vThreshold ? 0 : vc > vThreshold ? 2 : 1;
  const zone = ZONE_GRID[row][col];

  return { h, v, zone, isCenter: zone === 'cc' };
}
