/**
 * Eye-Aspect-Ratio (Soukupová & Čech, 2016) and the adaptive blink classifier, plus the
 * literature-validated ocular-fatigue metrics.
 *
 * Two distinct fatigue constructs are measured, with different validated markers:
 *  • Visual / ocular fatigue (CVS — this study's construct): reduced blink RATE and a raised
 *    INCOMPLETE-BLINK ratio are the validated markers (Portello & Rosenfield, Optom Vis Sci 2013).
 *    These are the PRIMARY metrics here, read together with the within-task first/second-half bins.
 *  • Drowsiness / sleepiness (a confound over a 60-90 min session): PERCLOS (proportion of time the
 *    eyes are ≥70/80% closed) is the most validated real-time measure (Dinges & Grace, FHWA 1998;
 *    best PVT-lapse predictor). PERCLOS + long-closure events are reported as covariates.
 *
 * PERCLOS, blink rate, incomplete-blink ratio and inter-blink interval are PROPORTION/COUNT
 * measures, so they are robust to the webcam's frame rate. Blink DURATION and the micro/partial
 * tiers depend on event timing and are sub-Nyquist below ~25 fps — kept as diagnostics, gated by
 * `fpsAdequateForTiers`. Sampling now runs at one EAR sample per FaceMesh result (~30 fps target).
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

// --- PERCLOS + closure dynamics (frame-rate-robust ocular-fatigue / drowsiness metrics) ----------

/** Openness thresholds: eyes ≥80% closed (P80, the most validated) and ≥70% closed (P70). */
export const PERCLOS_P80_OPENNESS = 0.2;
export const PERCLOS_P70_OPENNESS = 0.3;
/** A sustained closure longer than this is a long-closure / micro-sleep proxy (drowsiness). */
export const LONG_CLOSURE_MS = 500;

export interface ClosureMetrics {
  /** Proportion of measured time the eyes are ≥80% closed (PERCLOS P80). Null if not estimable. */
  perclos_p80: number | null;
  perclos_p70: number | null;
  long_closure_count: number;
  long_closure_total_ms: number;
  /** Estimated fully-closed EAR used to normalise openness (median blink-min, or low percentile). */
  ear_closed_estimate: number | null;
}

function percentileSorted(sortedAsc: number[], p: number): number {
  const idx = Math.floor(p * (sortedAsc.length - 1));
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, idx))];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * PERCLOS and long-closure metrics from the EAR series. Eye "openness" is self-normalised between
 * the open baseline (per-participant) and an estimated closed EAR (median of detected blink minima,
 * or a low percentile when no blinks were detected). Proportion-based → robust to frame rate.
 */
export function computeClosureMetrics(
  samples: EarSample[],
  baseline: number,
  events: BlinkEvent[],
): ClosureMetrics {
  const present = samples.filter((s) => Number.isFinite(s.ear) && s.ear > 0);
  if (present.length < 2 || baseline <= 0) {
    return { perclos_p80: null, perclos_p70: null, long_closure_count: 0, long_closure_total_ms: 0, ear_closed_estimate: null };
  }
  const earsAsc = present.map((s) => s.ear).sort((a, b) => a - b);
  const earClosed = events.length > 0 ? median(events.map((e) => e.min_ear)) : percentileSorted(earsAsc, 0.02);
  const earOpen = Math.max(baseline, earClosed + 1e-3);
  // If the EAR never dropped meaningfully below the open baseline, no closures occurred — the eyes
  // were effectively open throughout (avoids a degenerate openness scale collapsing to "all closed").
  if (earOpen - earClosed < baseline * 0.15) {
    return { perclos_p80: 0, perclos_p70: 0, long_closure_count: 0, long_closure_total_ms: 0, ear_closed_estimate: earClosed };
  }
  const openness = (ear: number) => Math.max(0, Math.min(1, (ear - earClosed) / (earOpen - earClosed)));

  let p80 = 0;
  let p70 = 0;
  for (const s of present) {
    const o = openness(s.ear);
    if (o <= PERCLOS_P80_OPENNESS) p80++;
    if (o <= PERCLOS_P70_OPENNESS) p70++;
  }

  // Long closures: maximal runs of consecutive ≥80%-closed samples spanning > LONG_CLOSURE_MS.
  let longCount = 0;
  let longTotal = 0;
  let runStart: number | null = null;
  for (let i = 0; i < present.length; i++) {
    const closed = openness(present[i].ear) <= PERCLOS_P80_OPENNESS;
    if (closed && runStart == null) runStart = present[i].t_ms;
    const runEnds = runStart != null && (!closed || i === present.length - 1);
    if (runEnds) {
      const dur = present[i].t_ms - (runStart as number);
      if (dur > LONG_CLOSURE_MS) {
        longCount++;
        longTotal += dur;
      }
      runStart = null;
    }
  }

  return {
    perclos_p80: p80 / present.length,
    perclos_p70: p70 / present.length,
    long_closure_count: longCount,
    long_closure_total_ms: longTotal,
    ear_closed_estimate: earClosed,
  };
}

/** Mean and CV of the interval between successive blink onsets (sec). Null with < 2 blinks. */
export function interBlinkInterval(events: BlinkEvent[]): {
  mean_inter_blink_interval_ms: number | null;
  inter_blink_interval_cv: number | null;
} {
  if (events.length < 2) return { mean_inter_blink_interval_ms: null, inter_blink_interval_cv: null };
  const onsets = events.map((e) => e.onset_ms).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < onsets.length; i++) gaps.push(onsets[i] - onsets[i - 1]);
  const m = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - m) ** 2, 0) / gaps.length);
  return { mean_inter_blink_interval_ms: m, inter_blink_interval_cv: m > 0 ? sd / m : null };
}
