/**
 * Face-region lighting quality from mean luminance (ITU-R BT.601).
 * Used as a QC signal — webcam blink/EAR detection degrades under poor lighting, and the
 * experiment deliberately varies ambient lux, so per-condition lighting quality matters.
 */
export type LightingQuality = 'low' | 'good' | 'overexposed';

/** Relative luminance of one 0-255 RGB pixel (BT.601). */
export function pixelLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Classify mean luminance (0-255) of the face ROI. */
export function classifyLighting(meanLuma: number): LightingQuality {
  if (meanLuma < 55) return 'low';
  if (meanLuma > 210) return 'overexposed';
  return 'good';
}

/** Mean luminance over RGBA pixel data (e.g. a downsampled face ROI canvas). */
export function meanLumaFromRGBA(data: Uint8ClampedArray): number {
  // Iterate over COMPLETE pixels only. A buffer whose length is not a multiple of 4 - a truncated
  // canvas readback - left the final iteration reading undefined channels, and the whole mean came
  // back NaN, which then classified the room's lighting as neither low nor good.
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    sum += pixelLuma(data[i], data[i + 1], data[i + 2]);
  }
  return sum / pixels;
}
