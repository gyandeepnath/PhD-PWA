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
 * simulation, so 2 fps bounds a frame-rate-driven difference between one person's TIER-A conditions at
 * about 0.6 points — a fifth of the planned 3-point effect. The comparison the study makes is within
 * each participant, so this is the part of the gate that protects it most. THE BOUND IS FOR TIER A
 * ONLY (Round 82): across tier B (15 to 20 fps) the ratio moves faster — 0.38 to 0.66 points per fps in
 * the decision scenarios (docs/FPS_GATE_SIMULATION.md, A4b) — so there 2 fps can move it 0.75 to 1.3
 * points, a quarter to over two-fifths of the effect. The band was set from the 20-30 slope (rule C3)
 * and is not changed; what covers tier B is the pre-registered tier-A-only refit.
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

/** Any change to the quantity, the tiers or the band must change this string (FPS_GATE_DEFINITIONS). */
export const FPS_GATE_VERSION = 'fps-g2';
/** The gate before Round 79, as fps_gate_version names it on rows judged under it. */
export const FPS_GATE_V1 = 'g1-25/30';

export interface FpsGateNumbers {
  /** Tier A at or above this many face-solved samples per second of observed time. */
  readonly ADEQUATE: number;
  /** Tier B from this up to ADEQUATE; tier C below. */
  readonly REDUCED: number;
  /** A condition more than this many fps from the participant's median is not consistent. */
  readonly CONSISTENCY_BAND: number;
}

/**
 * What each gate version stands for (Round 82). A released version's numbers never change: rows carry
 * the version (fps_gate_version), so a different floor or band under the same name would make old and
 * new rows indistinguishable. tests/frameRateGate.test.ts holds 'fps-g2' to these numbers.
 *
 * TO ADOPT A DIFFERENT GATE — for example the stricter reading of docs/FPS_GATE_SIMULATION.md, tier A
 * from 22 — change all of these together, never one alone:
 *   1. add an entry here under a new name (e.g. 'fps-g2-22': { ADEQUATE: 22, REDUCED: 15,
 *      CONSISTENCY_BAND: 2 }) and set FPS_GATE_VERSION to it — FPS_GATE follows;
 *   2. FPS_GATE_VERSION and FPS_GATE_ADEQUATE (and the others that change) in both analysis templates,
 *      src/analysis/analysis_template.R and .py — tests/frameRateGate.test.ts fails until they match;
 *   3. docs/ANALYSIS_PLAN.md §5 item 2: the new numbers, the date, and why;
 *   4. the test's expectations for the new version.
 * Tiers are recomputed from columns every 07 row stores, so this can be done after collection and both
 * gates reported.
 */
export const FPS_GATE_DEFINITIONS: Readonly<Record<string, FpsGateNumbers>> = {
  'fps-g2': { ADEQUATE: 20, REDUCED: 15, CONSISTENCY_BAND: 2 },
};

/** The gate in force: the numbers FPS_GATE_VERSION stands for. */
export const FPS_GATE: FpsGateNumbers = FPS_GATE_DEFINITIONS[FPS_GATE_VERSION];

export type FpsTier = 'A' | 'B' | 'C';

/** The tier in one word, for screens and the dashboard. */
export const FPS_TIER_WORD: Record<FpsTier, string> = { A: 'Adequate', B: 'Reduced', C: 'Too slow' };

/**
 * To 0.01, half up, written as floor(x * 100 + 0.5) / 100 so that R and Python, whose round() goes to
 * the even neighbour at a tie, compute the same digits as here (the templates use the same expression).
 * The tier is read off this rounded value, so a rate stored as 20.00 is tier A wherever it is re-read.
 */
const round2 = (x: number) => Math.floor(x * 100 + 0.5) / 100;

/**
 * Face-solved samples per second of observed time, to 0.01 fps. Null when fewer than two samples or
 * under a second observed (no rate can be stated: blink.ts MIN_RATE_WINDOW_MS). Computed from the two
 * stored columns exactly as the templates compute it — the same operations in the same order — so the
 * app and the analysis agree to the digit.
 *
 * One known approximation, stated rather than hidden: observed time leaves out each dropout (a gap
 * longer than the classifier's gap threshold), while the sample count still counts the frame after it,
 * so each dropout adds one sample too many. Twenty dropouts in a 3-minute window at 24 fps overstate the
 * rate by about 0.1 fps. The number of dropouts is not stored per row, and the formula must be computable
 * from what is.
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

/**
 * `x` written with the fewest decimals, from `fromDigits` up to two, that keep it on its own side of every
 * floor in `floors`; a value that two decimals would still round up onto a floor (14.996) is cut, not
 * rounded (14.99). One rule for both formatters below.
 */
function keepingSide(x: number, floors: readonly number[], fromDigits: number): string {
  const side = (v: number) => floors.map((f) => (v >= f ? 1 : 0)).join('');
  for (let d = fromDigits; d <= 2; d++) {
    const s = x.toFixed(d);
    if (side(Number(s)) === side(x)) return s;
  }
  return (Math.floor(x * 100) / 100).toFixed(2);
}

/**
 * A rate for the screen: one decimal, or the stored two when one decimal would round it onto a tier floor
 * it is below — 19.96 is tier B, and "20.0" would read as adequate (Round 83). Used wherever a rate is
 * shown beside its tier.
 */
export function fpsText(fps: number): string {
  if (!Number.isFinite(fps)) return fps.toFixed(1);
  return keepingSide(fps, [FPS_GATE.REDUCED, FPS_GATE.ADEQUATE], 1);
}

/**
 * A STAGE's rate — what the camera delivers, what the tracker processes — for a sentence that names that
 * stage as the reason the eye's rate missed a floor. A whole number, as those lines have always given it,
 * unless rounding would carry it onto a floor it is under: the gate's two (15, 20) and `floor`, the one
 * the screen judges against. Then one decimal, or two (Round 93, review R2): Math.round made a camera at
 * 14.7 "the CAMERA delivered only 15 frames per second" beside "below 15", and one at 19.8 "only 20
 * frames a second" as the reason for a reduced rate. '—' when there is no rate.
 */
export function stageFpsText(fps: number | null | undefined, floor?: number): string {
  if (fps == null || !Number.isFinite(fps)) return '—';
  return keepingSide(fps, floor == null ? [FPS_GATE.REDUCED, FPS_GATE.ADEQUATE] : [FPS_GATE.REDUCED, FPS_GATE.ADEQUATE, floor], 0);
}

/**
 * How far a rate is from the participant's usual one, for the consistency line of the Data Quality verdict
 * (Round 94, review B93-4). The two rates were written to one decimal each, so a flagged run could read
 * "20.0 against a usual 22.0, more than 2 from it" (20.00 against 22.04) and a passing run the same two
 * numbers (20.04 against 22.00). The distance itself is written instead, to two decimals, or three when two
 * would carry it onto the band from the side the verdict `off` puts it (the median of two-decimal rates has
 * at most three, so three decimals are exact); never past the band from the wrong side.
 */
export function fpsBandDistanceText(fps: number, participantMedian: number, off: boolean): string {
  const d = Math.abs(fps - participantMedian);
  const band = FPS_GATE.CONSISTENCY_BAND + 1e-9;
  for (let k = 2; k <= 3; k++) {
    const s = d.toFixed(k);
    if ((Number(s) > band) === off) return s;
  }
  return (off ? Math.ceil(d * 1000 - 1e-6) / 1000 : Math.floor(d * 1000 + 1e-6) / 1000).toFixed(3);
}

/** A stored rate or median at its own precision: two decimals, or three for the mean of two middle rates. */
export function fpsExactText(fps: number): string {
  return fps.toFixed(Math.abs(fps * 100 - Math.round(fps * 100)) < 1e-6 ? 2 : 3);
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

/** One condition-run under the gate. */
export interface FpsGateRow {
  /** sampling_fps_observed; null on a camera-off row or with too little observed. */
  fps: number | null;
  tier: FpsTier | null;
  /** The participant's median over the rows passed in that have a rate. */
  participantMedian: number | null;
  /** fps_consistent; null when this row has no rate. */
  consistent: boolean | null;
}

/**
 * The whole gate over ONE participant's condition-runs: each row's rate and tier, and its consistency
 * with that participant's median.
 *
 * WHICH ROWS MAKE THE MEDIAN: every camera-on condition-run of the participant that has a rate — all of
 * them, not only those that end up modelled. A row's flag is then a fixed property of the row, the same
 * in the confirmatory set, the sensitivity set and on the dashboard, and the median is the best estimate
 * of what this participant's camera typically delivered. Callers pass the participant's rows from every
 * sitting they hold: the analysis file and both templates pool all of a participant's sittings; the
 * dashboard's session view holds one sitting, which is the same thing unless the sitting was split.
 */
export function gateParticipant(rows: Array<{ cameraActive: boolean; sampleCount: number | null | undefined; observedMs: number | null | undefined }>): FpsGateRow[] {
  const fps = rows.map((r) => (r.cameraActive ? samplingFpsObserved(r.sampleCount, r.observedMs) : null));
  const med = medianFps(fps);
  return fps.map((f) => ({ fps: f, tier: fpsTier(f), participantMedian: med, consistent: fpsConsistent(f, med) }));
}

/**
 * The gate the app applied, live, when a row was recorded — what the self-test and the researcher panel
 * judged against: FPS_GATE_VERSION on rows written from Round 79, FPS_GATE_V1 on rows written before
 * (which carry no version). Null on a camera-off row, which no gate judged. The TIER columns are always
 * computed under fps-g2, from stored columns, whatever this says; this tells old rows from new.
 */
export function rowGateVersion(e: { camera_active: boolean; fps_gate_version?: string | null }): string | null {
  if (!e.camera_active) return null;
  return e.fps_gate_version || FPS_GATE_V1;
}
