/**
 * The frame-rate gate fps-g2 (Round 79): is this condition's blink measurement sampled finely enough?
 *
 * ONE DEFINITION, USED EVERYWHERE. The camera self-test, the researcher panel, the dashboard, the export
 * and both analysis templates apply the gate through this module (the templates carry a line-for-line
 * copy, pinned by tests/frameRateGate.test.ts), so a condition cannot be "adequate" on one screen and
 * "reduced" in the analysis.
 *
 * WHAT IS MEASURED: `sampling_fps_observed` — face-solved samples per second of OBSERVED time,
 * (ear_sample_count - 1) / observed_duration_ms x 1000. It is the rate at which the eye was sampled
 * while the face was seen. The old gate (g1) used effective_fps, which divides by the whole span, so a
 * condition at 25 fps with the face in view 90% of the time read 22.5 — face loss was charged twice,
 * here and in face_presence_ratio. Both inputs are stored in every 07 row, so rows recorded under g1
 * are re-tiered under g2 from what is already there, with no re-collection.
 *
 * THE TIERS (fixed by the simulation, docs/FPS_GATE_SIMULATION.md; scripts/fpsGateSim.ts):
 *   A  >= 20 fps  adequate.     At 20 fps the shipped classifier found >= 98% of blinks and classified
 *                               them within 0.05 kappa of its accuracy at 30 fps, in every decision
 *                               scenario.
 *   B  15 to < 20 reduced.      Kept and flagged; detection >= 95%. The confirmatory model keeps tier B
 *                               and a sensitivity refit drops it.
 *   C  < 15       too slow.     Out of the confirmatory model (in a sensitivity refit); not simulated
 *                               below 15 fps.
 * And CONSISTENCY: a condition whose rate is more than 2 fps from the participant's own median is
 * flagged. Between 20 and 30 fps the incomplete-blink ratio moved by at most 0.31 points per fps in the
 * simulation, so 2 fps bounds a frame-rate-driven difference between one person's conditions at about
 * 0.6 points — a fifth of the planned 3-point effect. The comparison the study makes is within each
 * participant, so this is the part of the gate that protects it most.
 *
 * THIS IS NOT THE OLD 30 LOWERED. The g1 gate's 30 rested on an external recommendation that was never
 * verified (blink.ts FPS_RATIO_THRESHOLD), and on the tablet it failed nearly every condition, so it
 * carried no information. g2's numbers come from a simulation of the shipped classifier, written into the
 * analysis plan before data collection, with every assumption listed. The g1 columns
 * (fps_adequate_for_ratio, fps_adequate_for_tiers) are still written, unchanged, so analyses run on them
 * reproduce.
 *
 * Pure.
 */
import { MIN_RATE_WINDOW_MS } from './blink';

/** Any change to the quantity, the tiers or the band must change this string. */
export const FPS_GATE_VERSION = 'fps-g2';
/** The gate before Round 79, as fps_gate_version names it on rows judged under it. */
export const FPS_GATE_V1 = 'g1-25/30';

export const FPS_GATE = {
  /** Tier A at or above this many face-solved samples per second of observed time. */
  ADEQUATE: 20,
  /** Tier B from this up to ADEQUATE; tier C below. */
  REDUCED: 15,
  /** A condition more than this many fps from the participant's median is not consistent. */
  CONSISTENCY_BAND: 2,
} as const;

export type FpsTier = 'A' | 'B' | 'C';

/** The tier in one word, for screens and the dashboard. */
export const FPS_TIER_WORD: Record<FpsTier, string> = { A: 'Adequate', B: 'Reduced', C: 'Too slow' };

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Face-solved samples per second of observed time, to 0.01 fps. Null when fewer than two samples or
 * under a second observed (no rate can be stated: blink.ts MIN_RATE_WINDOW_MS). Computed from the two
 * stored columns exactly as the templates compute it, so the app and the analysis agree to the digit.
 */
export function samplingFpsObserved(sampleCount: number | null | undefined, observedMs: number | null | undefined): number | null {
  if (sampleCount == null || !Number.isFinite(sampleCount) || sampleCount < 2) return null;
  if (observedMs == null || !Number.isFinite(observedMs) || observedMs < MIN_RATE_WINDOW_MS) return null;
  return round2(((sampleCount - 1) / observedMs) * 1000);
}

/** The tier of a rate; null when there is no rate (camera off, or too little observed). */
export function fpsTier(fps: number | null | undefined): FpsTier | null {
  if (fps == null || !Number.isFinite(fps)) return null;
  if (fps >= FPS_GATE.ADEQUATE) return 'A';
  if (fps >= FPS_GATE.REDUCED) return 'B';
  return 'C';
}

/** Median of the finite values; null when there are none. */
export function medianFps(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Within CONSISTENCY_BAND of the participant's median (over that participant's camera-on conditions)?
 * Null when either is unknown. A small tolerance absorbs the two-decimal rounding of the stored rate.
 */
export function fpsConsistent(fps: number | null | undefined, participantMedian: number | null | undefined): boolean | null {
  if (fps == null || participantMedian == null || !Number.isFinite(fps) || !Number.isFinite(participantMedian)) return null;
  return Math.abs(fps - participantMedian) <= FPS_GATE.CONSISTENCY_BAND + 1e-9;
}

/** One line for an operator: the rate, its tier in words, and the floor it is judged against. */
export function fpsTierSentence(fps: number | null | undefined): string {
  const t = fpsTier(fps);
  if (t == null || fps == null) return 'no frame rate yet';
  const r = Math.round(fps);
  if (t === 'A') return `${r} a second — adequate (${FPS_GATE.ADEQUATE} or more)`;
  if (t === 'B') return `${r} a second — reduced (${FPS_GATE.REDUCED} to ${FPS_GATE.ADEQUATE}): kept, flagged`;
  return `${r} a second — too slow (under ${FPS_GATE.REDUCED}): blink data from it are exploratory only`;
}
