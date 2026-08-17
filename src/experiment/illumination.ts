/**
 * Ambient illumination — the session-level (whole-plot) factor of the split-plot design.
 *
 * Synopsis §3.4. Exactly TWO levels, not a free researcher choice and not a graded series:
 *
 *   dim       ≈10 lux  (accept 5-15)    night-time and low-light domestic use
 *   moderate ≈150 lux  (accept 130-170) general indoor domestic lighting
 *
 * Why these numbers:
 *  - They sit either side of the range at which negative-polarity penalties have been reported
 *    to emerge, so the design straddles the effect rather than sampling one side of it.
 *  - They differ by roughly one log unit, so a pupillary difference is physiologically plausible
 *    rather than nominal.
 *  - The moderate level is deliberately BELOW the 300-500 lux the Indian interior-illumination
 *    code (IS 3646) specifies for offices and classrooms: the study is about domestic reading.
 *  - Two levels rather than a graded series is what makes crossing illumination with all ten
 *    display conditions feasible inside one protocol.
 *
 * Display white luminance is held constant across both levels, so the display-to-ambient
 * luminance ratio — the quantity the pupil account actually implicates — differs by design
 * between sessions. Correlated colour temperature and lamp type are held constant, so
 * illuminance is the only photometric property of the room that varies.
 *
 * ORDER IS COUNTERBALANCED, not chosen. Half the participants receive dim first, half moderate
 * first, assigned by enrolment number orthogonally to the Williams condition row (§3.8). Left to
 * the researcher, order would drift with whatever the room happened to be set to that day, and
 * illumination would become confounded with date, season and time of day.
 */

import { N_CONDITIONS } from './conditions';

export type IlluminationLevel = 'dim' | 'moderate';

/**
 * Length of the Williams condition-order cycle. Illumination order must be orthogonal to it, so
 * the counterbalancing rule below is written in terms of this rather than a literal 10.
 */
const WILLIAMS_CYCLE = N_CONDITIONS;

export interface IlluminationSpec {
  level: IlluminationLevel;
  /** Target illuminance at the eye, lux. */
  target: number;
  /** Accepted range; a session outside it is flagged as a protocol deviation. */
  min: number;
  max: number;
  label: string;
  description: string;
}

export const ILLUMINATION: Record<IlluminationLevel, IlluminationSpec> = {
  dim: {
    level: 'dim',
    target: 10,
    min: 5,
    max: 15,
    label: 'Dim (≈10 lux)',
    description: 'Night-time / low-light domestic use. Exclude daylight; single low lamp.',
  },
  moderate: {
    level: 'moderate',
    target: 150,
    min: 130,
    max: 170,
    label: 'Moderate (≈150 lux)',
    description: 'General indoor domestic lighting. Below office/classroom levels (IS 3646).',
  },
};

export const ILLUMINATION_LEVELS: IlluminationLevel[] = ['dim', 'moderate'];

/** Number of illumination blocks each participant completes (the whole-plot factor levels). */
export const N_ILLUMINATION_BLOCKS = ILLUMINATION_LEVELS.length;

/**
 * Counterbalanced illumination order for a 1-based enrolment number.
 *
 * The obvious rule — odd enrolment gets dim first, even gets moderate first — is WRONG here, and
 * subtly so. The Williams condition row is (enrolment - 1) mod N_CONDITIONS, and N_CONDITIONS is
 * 10, an even number. A parity rule cycles every 2, and 2 divides 10, so row would determine
 * order completely: row 0 would always be dim-first, row 1 always moderate-first, and illumination
 * order would be perfectly confounded with the condition order rather than orthogonal to it.
 *
 * Instead the order alternates with parity AND flips once per completed block of N participants:
 *
 *   dimFirst = ((enrolment - 1) mod 2 + floor((enrolment - 1) / N)) is even
 *
 * That gives a 5/5 split within every block of ten (so order is not confounded with recruitment
 * date either) while making each Williams row appear with BOTH orders exactly once across twenty
 * participants. Balance therefore completes at n = 20, which divides the target of 130 evenly.
 */
export function illuminationOrderFor(enrolmentNumber: number): IlluminationLevel[] {
  const n = Number.isFinite(enrolmentNumber) ? Math.floor(enrolmentNumber) : 1;
  const i = Math.max(0, n - 1);
  const dimFirst = ((i % 2) + Math.floor(i / WILLIAMS_CYCLE)) % 2 === 0;
  return dimFirst ? ['dim', 'moderate'] : ['moderate', 'dim'];
}

/** The illumination level this participant must be run under for a 0-based block index. */
export function illuminationForBlock(enrolmentNumber: number, block: number): IlluminationLevel {
  const order = illuminationOrderFor(enrolmentNumber);
  const b = Number.isFinite(block) ? Math.floor(block) : 0;
  return order[((b % order.length) + order.length) % order.length];
}

/**
 * Spec for a level, or null when the value is not one this build recognises.
 *
 * Sessions recorded before the two-level factor existed carry 'low' / 'high', and a hand-edited
 * or imported record can carry anything at all. Every consumer here must therefore tolerate an
 * unknown level rather than indexing straight into the table — a crash in the export path would
 * make an entire dataset unreadable because of one bad field.
 */
export function specFor(level: string | null | undefined): IlluminationSpec | null {
  return level != null && Object.prototype.hasOwnProperty.call(ILLUMINATION, level)
    ? ILLUMINATION[level as IlluminationLevel]
    : null;
}

/** True when a measured illuminance falls inside the accepted range for the level. */
export function luxInRange(level: IlluminationLevel | string, lux: number): boolean {
  const spec = specFor(level);
  return spec != null && Number.isFinite(lux) && lux >= spec.min && lux <= spec.max;
}

/**
 * Illuminance is logged at three points per session (start, middle, end) rather than once, because
 * the disagreement in the literature over whether illumination interacts with polarity points to a
 * threshold-like relationship — which makes it something to MEASURE rather than assert. Drift
 * between the three readings is itself reportable.
 */
export type LuxCheckpoint = 'start' | 'middle' | 'end';
export const LUX_CHECKPOINTS: LuxCheckpoint[] = ['start', 'middle', 'end'];

/** Summary of the three readings: mean, max absolute deviation from target, and in-range flag. */
export function summariseLux(
  level: IlluminationLevel | string | null | undefined,
  readings: { checkpoint: LuxCheckpoint; lux: number }[] | null | undefined,
): { mean: number | null; max_deviation: number | null; all_in_range: boolean; n: number } {
  const vals = (readings ?? []).map((r) => r?.lux).filter((v): v is number => Number.isFinite(v));
  if (vals.length === 0) return { mean: null, max_deviation: null, all_in_range: false, n: 0 };
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const spec = specFor(level);
  // Readings still summarise to a mean without a known level; deviation and the in-range flag
  // are meaningless without a target, so they report null/false rather than a fabricated number.
  if (!spec) return { mean, max_deviation: null, all_in_range: false, n: vals.length };
  return {
    mean,
    max_deviation: Math.max(...vals.map((v) => Math.abs(v - spec.target))),
    all_in_range: vals.every((v) => v >= spec.min && v <= spec.max),
    n: vals.length,
  };
}
