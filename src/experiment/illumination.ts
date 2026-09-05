/**
 * Ambient illumination.
 *
 * SUPERSEDED BELOW — read the note on ILLUMINATION_LEVELS before this paragraph. The study now runs
 * a SINGLE level at 300 lux; the two-level description that follows is the design as originally
 * approved, kept because the spec table and the crossover rule are retained for archived data.
 *
 * Synopsis §3.4. Exactly TWO levels, not a free researcher choice and not a graded series:
 *
 *   dim       ≈10 lux  (accept 5-15)    night-time and low-light domestic use
 *   moderate ≈150 lux  (accept 130-170) general indoor domestic lighting  [RETARGETED to 300 lux,
 *                                                                            band 250-350; see below]
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
    target: 300,
    min: 250,
    max: 350,
    label: 'Standard indoor (≈300 lux)',
    description: 'Typical indoor task lighting for screen work. Steady artificial light, daylight excluded.',
  },
};

/**
 * THE LEVELS THIS BUILD ACTUALLY RUNS.
 *
 * The study now runs at a SINGLE ambient level. The `dim` spec above is deliberately kept in the
 * table rather than deleted, for two reasons: any session already recorded under it still resolves
 * through `specFor()` instead of becoming unreadable, and restoring the crossover is a one-line
 * change to this array rather than a re-derivation of the design.
 *
 * WHY THE DIM LEVEL WAS WITHDRAWN — the measurement, not the science.
 *
 * The ocular outcomes are derived from the tablet's front camera, and in a dark room the SCREEN is
 * the dominant thing lighting the participant's face. Computed from this build's own locked
 * condition table (backgrounds #FFFFFF and #000000, panel at the protocol's 50-60 cm): a
 * positive-polarity condition casts about 14.6 lux on the face and a negative-polarity one about
 * 0.49 lux — a factor of thirty from the stimulus alone. Against a 10 lux room that leaves the face
 * at 24.6 vs 10.5 lux, a ratio of 2.35; against a 300 lux room it is 314.6 vs 300.5, a ratio of
 * 1.05. (Robust to the assumptions: 2.25-2.43 across ink coverage 5-12% and panel contrast
 * 800-2000:1.)
 *
 * So at 10 lux, how well the camera can see the face is confounded with POLARITY — the primary
 * independent variable. That is not a noise problem, it is a validity problem, and it points the
 * wrong way: undersampling biases the measured minimum EAR upward and therefore INFLATES the
 * incomplete-blink ratio (see src/tracking/blink.ts). Simulated against this build's own classifier
 * thresholds, a positive-polarity block at 30 fps against a negative-polarity block at 15 fps
 * produces a spurious polarity difference of +0.028 in the primary outcome with no real effect
 * present at all — in the same direction the hypothesis predicts.
 *
 * WHY ONE LEVEL IS DEFENSIBLE — the literature.
 *
 * Buchner & Baumgartner (2007), Ergonomics 50(7):1036-63, doi:10.1080/00140130701306413, is titled
 * "Text-background polarity affects performance irrespective of ambient illumination and colour
 * contrast" and reports the positive-polarity advantage as "independent of ambient lighting
 * (darkness vs. typical office illumination)". The performance side of this design therefore loses
 * nothing by being measured at one level.
 *
 * What DOES appear to depend on ambient level is the ocular-surface and blink side — Lin et al.
 * (2025), doi:10.1016/j.clae.2025.102515, found the largest tear-film effects in a dark room with a
 * bright screen, and Fan et al. (2024), doi:10.3390/s24113516, report an ambient x text-colour
 * interaction on visual fatigue under negative polarity. Those are precisely the outcomes this
 * instrument cannot measure trustworthily in a dark room. The level being withdrawn is the level at
 * which the camera would have produced its least reliable data on exactly the outcomes that needed
 * it.
 *
 * WHAT IS GIVEN UP, stated plainly so it reaches the write-up: the polarity x illumination
 * interaction is no longer estimable, and Sethi & Ziat (2023), doi:10.1080/00140139.2022.2160879,
 * found higher cognitive load under negative polarity for YOUNGER adults specifically in a DIM
 * environment — i.e. in the condition being removed. This design cannot speak to that.
 *
 * WHY 300 LUX. ISO 9241-referenced guidance for screen work puts the ambient range at 300-500 lux,
 * below the 500-750 lux for paper tasks, because a display is self-luminous and the screen-to-
 * surround luminance ratio has to be controlled. 300 is the bottom of that range: bright enough
 * that the room dominates the face illumination (collapsing the polarity confound to 1.05) and low
 * enough that the display is not washed out. The accepted band is 250-350 lux; a sitting outside it
 * is flagged as a protocol deviation exactly as before.
 */
export const ILLUMINATION_LEVELS: IlluminationLevel[] = ['moderate'];

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
 * participants. Balance therefore completes at n = 20.
 *
 * 20 does NOT divide the target of 130 — 130/20 is 6.5 — and an earlier version of this note
 * claimed it did. At n = 130 the last block of twenty is half-filled, so each Williams row ends up
 * with a 7/6 rather than an even split of the two illumination orders. That residual imbalance is
 * small and is absorbed by carrying illumination order as a covariate, which the analysis templates
 * already do; but it is an imbalance, and stating otherwise would have put a false claim of exact
 * balance into the thesis. Recruiting 140 rather than 130 for analysis would close it exactly.
 */
export function illuminationOrderFor(enrolmentNumber: number): IlluminationLevel[] {
  // Single-level protocol: there is no order to counterbalance. The crossover rule is not deleted,
  // only unreached — restoring the crossover is a change to ILLUMINATION_LEVELS and nothing else.
  if (ILLUMINATION_LEVELS.length < 2) return [...ILLUMINATION_LEVELS];
  return crossoverOrderFor(enrolmentNumber);
}

/**
 * The two-level counterbalancing rule, kept as its own function so that it stays under test while
 * it is dormant.
 *
 * A switched-off mechanism whose tests were deleted along with its caller is not recoverable — it
 * is merely present. `tests/counterbalance.test.ts` exercises this directly, so the balance
 * properties documented above are still proven, and flipping ILLUMINATION_LEVELS back restores a
 * rule that is known to work rather than one that has been unverified for however long.
 */
export function crossoverOrderFor(enrolmentNumber: number): IlluminationLevel[] {
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
