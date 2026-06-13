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
  let sum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum += pixelLuma(data[i], data[i + 1], data[i + 2]);
  }
  return n > 0 ? sum / n : 0;
}
