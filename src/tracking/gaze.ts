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

  /**
   * Vertical gaze is scaled by eye WIDTH, and a blink yields no gaze sample at all.
   *
   * It used to be scaled by the eyelid APERTURE (botL.y - topL.y). The aperture collapses toward
   * zero during a blink, so the division blew up and the iris appeared hugely displaced: every
   * blink was scored as a vertical gaze excursion. That inflated zone_transition_count and
   * gaze_deviation_ratio, and — worse — it coupled them to blink behaviour, which is the primary
   * outcome. A participant who blinked more looked, in the data, like a participant whose gaze
   * wandered more.
   *
   * Eye width does not change when the lid closes, so it is a stable scale for both axes. And a
   * frame in which the lid is mostly shut carries no usable information about gaze direction
   * regardless of scaling, so it is reported unresolved — which the aggregator already treats as
   * "not measured" rather than as a centred gaze.
   *
   * Calibration consumes the same function, so the fitted thresholds are in these same units.
   */
  const leftAperture = lm[EYE_BOX.botL].y - lm[EYE_BOX.topL].y;
  const rightAperture = lm[EYE_BOX.botR].y - lm[EYE_BOX.topR].y;
  const leftWidth = Math.abs(leftBoxW);
  const rightWidth = Math.abs(rightBoxW);

  // Aperture-to-width ratio of a normally open eye is roughly 0.25-0.45; below this the lid is
  // far enough down that the iris centre is unreliable.
  const MIN_APERTURE_RATIO = 0.12;
  const openEnough = leftAperture / (leftWidth + 1e-6) > MIN_APERTURE_RATIO
    && rightAperture / (rightWidth + 1e-6) > MIN_APERTURE_RATIO;
  if (!openEnough) {
    return { zone: 'cc', isCenter: false, h: NaN, v: NaN };
  }

  const leftCentreY = (lm[EYE_BOX.topL].y + lm[EYE_BOX.botL].y) / 2;
  const rightCentreY = (lm[EYE_BOX.topR].y + lm[EYE_BOX.botR].y) / 2;
  const vL = ((irisL.y - leftCentreY) / (leftWidth + 1e-6)) * 2;
  const vR = ((irisR.y - rightCentreY) / (rightWidth + 1e-6)) * 2;
  const v = (vL + vR) / 2;

  // Subtract the fitted neutral bias before thresholding.
  const hc = h - h0;
  const vc = v - v0;
  const col = hc < -hThreshold ? 0 : hc > hThreshold ? 2 : 1;
  const row = vc < -vThreshold ? 0 : vc > vThreshold ? 2 : 1;
  const zone = ZONE_GRID[row][col];

  return { h, v, zone, isCenter: zone === 'cc' };
}
