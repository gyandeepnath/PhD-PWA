/**
 * Eye-Aspect-Ratio (Soukupová & Čech, 2016) and the adaptive blink classifier.
 *
 * The original build classified full/partial/micro/incomplete blinks against an adaptive baseline
 * (90th percentile of calibration EARs). At the camera's ~15 fps effective rate (every 2nd frame),
 * the micro (<40 ms) and partial (40-79 ms) tiers are sub-Nyquist — we keep them as diagnostics
 * but expose `fpsAdequateForTiers` (>=25 fps) so analysis can gate them. Full-blink rate and the
 * incomplete-blink ratio remain the defensible primary metrics.
 */

export interface Point {
  x: number;
  y: number;
}

/** FaceMesh landmark indices for EAR (p1..p6 order). */
export const LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144];
export const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380];

export const EAR_TIERS = { full: 0.6, partial: 0.75, micro: 0.88 } as const;
export const FPS_TIER_THRESHOLD = 25;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** EAR for one eye from 6 points in [p1,p2,p3,p4,p5,p6] order. */
export function eyeAspectRatio(p: Point[]): number {
  const [p1, p2, p3, p4, p5, p6] = p;
  const denom = 2 * dist(p1, p4) + 1e-6;
  return (dist(p2, p6) + dist(p3, p5)) / denom;
}

/** Mean EAR across both eyes given the full landmark array. */
export function faceEar(landmarks: Point[]): number {
  const left = eyeAspectRatio(LEFT_EYE_EAR.map((i) => landmarks[i]));
  const right = eyeAspectRatio(RIGHT_EYE_EAR.map((i) => landmarks[i]));
  return (left + right) / 2;
}

/** Baseline open-eye EAR = 90th percentile of calibration samples (robust to blinks in the set). */
export function baselineEar(samples: number[]): number {
  if (samples.length === 0) return 0.3;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(0.9 * (sorted.length - 1));
  return sorted[idx];
}

export type BlinkTier = 'full' | 'partial' | 'micro' | 'incomplete';

export interface BlinkEvent {
  onset_ms: number;
  duration_ms: number;
  min_ear: number;
  tier: BlinkTier;
}

export interface EarSample {
  t_ms: number;
  ear: number;
}

/**
 * Classify blinks from a time-stamped EAR sequence against an adaptive baseline.
 * A blink starts when EAR drops below the partial threshold and ends when it recovers above it;
 * the tier is assigned from the minimum EAR ratio and the duration.
 */
export function classifyBlinks(samples: EarSample[], baseline: number): BlinkEvent[] {
  if (baseline <= 0) return [];
  const fullT = baseline * EAR_TIERS.full;
  const partialT = baseline * EAR_TIERS.partial;
  const microT = baseline * EAR_TIERS.micro;

  const events: BlinkEvent[] = [];
  let inBlink = false;
  let onset = 0;
  let minEar = Infinity;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!inBlink && s.ear < partialT) {
      inBlink = true;
      onset = s.t_ms;
      minEar = s.ear;
    } else if (inBlink) {
      minEar = Math.min(minEar, s.ear);
      if (s.ear >= partialT || i === samples.length - 1) {
        const duration = s.t_ms - onset;
        const ratio = minEar / baseline;
        let tier: BlinkTier;
        if (ratio < EAR_TIERS.full) tier = duration < 40 ? 'micro' : 'full';
        else if (ratio < EAR_TIERS.partial) tier = duration < 80 ? 'micro' : 'partial';
        else tier = 'incomplete';
        // Touch thresholds so they're referenced (full/micro thresholds aid readability/debug).
        void fullT;
        void microT;
        events.push({ onset_ms: onset, duration_ms: duration, min_ear: minEar, tier });
        inBlink = false;
        minEar = Infinity;
      }
    }
  }
  return events;
}

export function blinkRatePerMinute(count: number, durationMs: number): number {
  return durationMs > 0 ? (count / durationMs) * 60000 : 0;
}

export interface BlinkSummary {
  blink_rate: number;
  blink_rate_full: number;
  blink_rate_micro: number;
  blink_count_full: number;
  blink_count_partial: number;
  blink_count_micro: number;
  blink_count_incomplete: number;
  /** complete blinks / (complete + incomplete). */
  incomplete_blink_ratio: number;
  blink_duration_mean_ms: number | null;
}

export function summariseBlinks(events: BlinkEvent[], durationMs: number): BlinkSummary {
  const by = (t: BlinkTier) => events.filter((e) => e.tier === t).length;
  const full = by('full');
  const partial = by('partial');
  const micro = by('micro');
  const incomplete = by('incomplete');
  const complete = full + partial + micro;
  const durations = events.map((e) => e.duration_ms);
  return {
    blink_rate: blinkRatePerMinute(events.length, durationMs),
    blink_rate_full: blinkRatePerMinute(full, durationMs),
    blink_rate_micro: blinkRatePerMinute(micro, durationMs),
    blink_count_full: full,
    blink_count_partial: partial,
    blink_count_micro: micro,
    blink_count_incomplete: incomplete,
    incomplete_blink_ratio: complete + incomplete > 0 ? incomplete / (complete + incomplete) : 0,
    blink_duration_mean_ms:
      durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
  };
}

/** Effective sampling rate from processed-frame timestamps (ms). */
export function effectiveFps(frameTimestampsMs: number[]): number | null {
  if (frameTimestampsMs.length < 2) return null;
  const span = frameTimestampsMs[frameTimestampsMs.length - 1] - frameTimestampsMs[0];
  if (span <= 0) return null;
  return ((frameTimestampsMs.length - 1) / span) * 1000;
}

export function fpsAdequateForTiers(fps: number | null): boolean {
  return fps != null && fps >= FPS_TIER_THRESHOLD;
}
