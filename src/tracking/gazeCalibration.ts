/**
 * Per-participant gaze calibration.
 *
 * The original build's "calibration" stored hardcoded zeros and never fitted anything, so gaze-zone
 * data was uncalibrated. Here we present 9 on-screen targets, sample the iris offset (h, v) while
 * the participant fixates each, and fit:
 *   - a neutral bias (h0, v0): the median offset at the centre target (corrects head/camera offset)
 *   - per-axis thresholds: the midpoint between the centred centre-fixation spread and the
 *     edge-fixation offset, so centre fixations classify as "centre" and edge fixations don't.
 * Falls back to defaults and reports `valid:false` when the fit is degenerate (too few samples or
 * edges not separable from centre) — gaze metrics then carry gaze_calibrated:false honestly.
 */
import { DEFAULT_GAZE_THRESHOLD } from './gaze';

/** 9 calibration targets at normalised screen positions (col,row in {0,0.5,1}). */
export const GAZE_TARGETS: { id: string; x: number; y: number }[] = [
  { id: 'tl', x: 0.1, y: 0.1 }, { id: 'tc', x: 0.5, y: 0.1 }, { id: 'tr', x: 0.9, y: 0.1 },
  { id: 'ml', x: 0.1, y: 0.5 }, { id: 'cc', x: 0.5, y: 0.5 }, { id: 'mr', x: 0.9, y: 0.5 },
  { id: 'bl', x: 0.1, y: 0.9 }, { id: 'bc', x: 0.5, y: 0.9 }, { id: 'br', x: 0.9, y: 0.9 },
];

export interface GazeSample { h: number; v: number }

export interface GazeCalibration {
  h0: number;
  v0: number;
  hThreshold: number;
  vThreshold: number;
  valid: boolean;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const meanAbs = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length : 0);

/**
 * Fit calibration from collected samples keyed by target id. Each target should have >=1 sample.
 */
export function fitGazeCalibration(raw: Record<string, GazeSample[]>): GazeCalibration {
  // Drop non-finite samples defensively (a dropped frame / bad landmark must not poison the fit).
  const samplesByTarget: Record<string, GazeSample[]> = {};
  for (const [id, arr] of Object.entries(raw)) {
    samplesByTarget[id] = (arr ?? []).filter((s) => Number.isFinite(s.h) && Number.isFinite(s.v));
  }
  const center = samplesByTarget['cc'] ?? [];
  const h0 = median(center.map((s) => s.h));
  const v0 = median(center.map((s) => s.v));

  // Centred offsets at horizontal edges (left/right) and vertical edges (top/bottom).
  const hEdgeIds = ['ml', 'mr', 'tl', 'tr', 'bl', 'br'];
  const vEdgeIds = ['tc', 'bc', 'tl', 'tr', 'bl', 'br'];
  const hEdges = hEdgeIds.flatMap((id) => (samplesByTarget[id] ?? []).map((s) => s.h - h0));
  const vEdges = vEdgeIds.flatMap((id) => (samplesByTarget[id] ?? []).map((s) => s.v - v0));
  const centerSpreadH = meanAbs(center.map((s) => s.h - h0));
  const centerSpreadV = meanAbs(center.map((s) => s.v - v0));
  const edgeH = meanAbs(hEdges);
  const edgeV = meanAbs(vEdges);

  // Threshold = midpoint between centre spread and edge offset (clamped to a sane floor).
  const safe = (x: number) => (Number.isFinite(x) ? x : 0);
  const hThreshold = Math.max(0.06, (safe(centerSpreadH) + safe(edgeH)) / 2);
  const vThreshold = Math.max(0.06, (safe(centerSpreadV) + safe(edgeV)) / 2);

  /**
   * Validity is judged on COVERAGE and on both axes, not on a bare sample count.
   *
   * The old test was `totalSamples >= GAZE_TARGETS.length`, i.e. nine samples across all nine
   * targets combined. Two targets producing five samples each satisfied it while seven targets
   * contributed nothing — a fit through two points reported as a nine-point calibration. And
   * `separable` accepted either axis alone, so a run that separated horizontally but not vertically
   * left the vertical threshold at its unfitted floor (DEFAULT_GAZE_THRESHOLD) while
   * gaze_calibrated was exported as TRUE. Every vertical gaze zone in that sitting was then a
   * guess presented as a measurement.
   *
   * Both axes must now separate, and at least two thirds of the targets must have produced
   * samples, with the centre among them.
   */
  const targetsWithSamples = Object.values(samplesByTarget).filter((a) => a.length > 0).length;
  const MIN_TARGETS = Math.ceil(GAZE_TARGETS.length * (2 / 3));
  const separableH = edgeH > centerSpreadH * 1.5;
  const separableV = edgeV > centerSpreadV * 1.5;
  const valid = targetsWithSamples >= MIN_TARGETS
    && center.length > 0
    && separableH
    && separableV;

  return {
    h0, v0,
    hThreshold: valid ? hThreshold : DEFAULT_GAZE_THRESHOLD,
    vThreshold: valid ? vThreshold : DEFAULT_GAZE_THRESHOLD,
    valid,
  };
}
