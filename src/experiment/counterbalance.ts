/**
 * Counterbalancing.
 *
 * Condition order: a balanced (Williams) Latin square for even N — the same construction the
 * original build used (first row [0,1,7,2,6,3,5,4] for N=8). Each condition appears in each
 * serial position equally across a block of 8 participants, and each condition precedes/follows
 * every other equally often (controls first-order carryover).
 *
 * Participant -> row mapping uses a SEQUENTIAL enrolment index (1-based), not a hash of an
 * arbitrary ID. Hashing arbitrary alphanumeric IDs (as the late builds did) breaks balance
 * because collisions/gaps make rows unevenly used. The enrolment index must be assigned at
 * session creation by counting existing participants.
 *
 * Passage assignment: the original build yoked passage to condition (passage = conditionIndex),
 * so passage difficulty was perfectly confounded with display condition. We instead rotate
 * passages across participants: passage(condition, participant) = (conditionIndex + offset) mod N.
 * Over each block of 8 participants every condition is paired with every passage exactly once,
 * so passage content is orthogonal to condition (a Latin square on condition x participant).
 */
import { N_CONDITIONS } from './conditions';

/** Largest square this module will build. Far above any real design; guards Array construction. */
const MAX_SQUARE_N = 1000;

/**
 * First row of a balanced Latin square for even n (0-indexed):
 * 0, 1, n-1, 2, n-2, 3, n-3, ...
 */
export function williamsFirstRow(n: number): number[] {
  // A non-integer or non-finite n reached Array construction and threw "Invalid array length".
  // The production caller passes N_CONDITIONS, but the fuzz harness and any future caller must
  // get a defined answer rather than an exception from deep inside the counterbalancer.
  // Upper bound as well as lower: 1e21 is finite and >= 1, and Array construction throws
  // "Invalid array length" for it. No design will ever have more conditions than this.
  if (!Number.isFinite(n) || n < 1 || n > MAX_SQUARE_N) return [];
  n = Math.floor(n);
  const row: number[] = [];
  for (let j = 0; j < n; j++) {
    if (j === 0) row.push(0);
    else if (j % 2 === 1) row.push((j + 1) / 2);
    else row.push(n - j / 2);
  }
  return row;
}

/** Full balanced Latin square: row i is the first row with +i (mod n) applied to each value. */
export function williamsSquare(n: number): number[][] {
  if (!Number.isFinite(n) || n < 1 || n > MAX_SQUARE_N) return [];
  n = Math.floor(n);
  const first = williamsFirstRow(n);
  return Array.from({ length: n }, (_, i) => first.map((v) => (v + i) % n));
}

/** Cached square for the experiment's N. */
const SQUARE = williamsSquare(N_CONDITIONS);

/**
 * Ordered condition indices (0-based into CONDITIONS) for a 1-based enrolment number.
 * Cycles every N participants.
 */
export function conditionOrderFor(enrolmentNumber: number): number[] {
  // Floor + safe-modulo so non-integer/negative/NaN enrolment numbers can never index out of range.
  const n = Number.isFinite(enrolmentNumber) ? Math.floor(enrolmentNumber) : 1;
  const row = (((n - 1) % N_CONDITIONS) + N_CONDITIONS) % N_CONDITIONS;
  return [...SQUARE[row]];
}

/**
 * The period of the passage rotation. Coprime to N_CONDITIONS, and that is the entire point.
 *
 * The offset used to be `(enrolment - 1) mod N_CONDITIONS` — the SAME quantity as the Williams row.
 * Both rotations therefore advanced together, and because the row is recoverable from
 * (condition, position) in a Latin square, passage became a deterministic function of them:
 * enumerated over 200 participants x 2 blocks, every one of the 100 (condition, position) cells
 * contained exactly ONE passage, and each serial position could only ever draw from five of the ten
 * passages, split by parity. No sample size fixes that — it is structural.
 *
 * It mattered because `session_position` is exported as the covariate that absorbs time-on-task.
 * Estimating a position effect on a fixed half of the corpus means that coefficient carries a
 * permanent corpus property (search-target counts, reading difficulty) that recruitment cannot
 * average away.
 *
 * Rotating on a period coprime to the condition count breaks the link: within a
 * (condition, position) cell the Williams row is fixed, but `(enrolment - 1) mod 13` still cycles
 * through every value as enrolment advances in steps of ten. Verified by enumeration in
 * tests/counterbalance.test.ts: all ten passages reachable at every position, ten distinct passages
 * per (condition, position) cell, and exact uniformity at multiples of the joint period.
 *
 * 13 rather than 11 or 9 because it is the smallest choice giving a perfectly uniform
 * position x passage count at the planned enrolment, not merely a complete one.
 */
export const PASSAGE_ROTATION_PERIOD = 13;

/**
 * Passage index assigned to a given condition for a given participant.
 *
 * Decoupled from display condition AND from serial position; see PASSAGE_ROTATION_PERIOD.
 */
export function passageForCondition(conditionIndex: number, enrolmentNumber: number): number {
  const n = Number.isFinite(enrolmentNumber) ? Math.floor(enrolmentNumber) : 1;
  const c = Number.isFinite(conditionIndex) ? Math.floor(conditionIndex) : 0;
  const offset = (((n - 1) % PASSAGE_ROTATION_PERIOD) + PASSAGE_ROTATION_PERIOD) % PASSAGE_ROTATION_PERIOD;
  return (((c + offset) % N_CONDITIONS) + N_CONDITIONS) % N_CONDITIONS;
}

export interface PlannedStep {
  /** Serial position in the session, 0-based. */
  position: number;
  /** Index into CONDITIONS. */
  conditionIndex: number;
  /** Index into PASSAGES (decoupled from condition). */
  passageIndex: number;
}

/** Full ordered plan (condition + decoupled passage per serial position) for a participant. */
export function sessionPlan(enrolmentNumber: number): PlannedStep[] {
  return conditionOrderFor(enrolmentNumber).map((conditionIndex, position) => ({
    position,
    conditionIndex,
    passageIndex: passageForCondition(conditionIndex, enrolmentNumber),
  }));
}

/**
 * Plan for one ILLUMINATION BLOCK (0 = first session's level, 1 = second's).
 *
 * The block advances the Williams row by one, so a participant does NOT meet the ten conditions
 * in the same serial order in both sessions. Without this, serial position would be perfectly
 * correlated with condition WITHIN a participant across both sessions, and any position effect
 * would masquerade as a condition effect in exactly the same direction twice. Advancing the row
 * preserves complete balance across each block of ten participants (each row is still used once)
 * while decorrelating position from condition within a participant.
 *
 * Passage assignment advances with the block too, which decorrelates passage from CONDITION across
 * the two sittings.
 *
 * Under the SINGLE-level protocol there is nothing to prevent: ten passages cover ten
 * condition-runs, so each is read exactly once and the rotation only decides which condition it is
 * paired with. The paragraph below describes the two-block case, where every passage WAS re-read
 * and the practice effect mattered; it is kept because the rotation still has to be correct if the
 * second illumination level is restored.
 *
 * Under two blocks: the rotation does NOT prevent a re-read, and an earlier version of this note
 * wrongly claimed it did. Twenty condition-runs over ten passages means every passage is read
 * once per block. That matters:
 * illumination is perfectly confounded with session order within a participant, so the practice
 * effect from re-reading (faster reading, better comprehension, known target locations in the
 * search text) loads entirely onto the illumination main effect, which is the whole-plot factor.
 *
 * The exported `passage_repeat_number` on 02_conditions.csv makes the exposure explicit so it can
 * be modelled rather than silently absorbed. Removing the re-read altogether would need a second
 * set of ten length- and difficulty-matched passages.
 */
export function blockPlan(enrolmentNumber: number, block: number): PlannedStep[] {
  const n = Number.isFinite(enrolmentNumber) ? Math.floor(enrolmentNumber) : 1;
  const b = Number.isFinite(block) ? Math.floor(block) : 0;
  return sessionPlan(n + b);
}

/**
 * Whether this participant is in the pre-specified validation subsample that contributes video for
 * manual blink annotation (Objective 4).
 *
 * Derived from the enrolment number, deliberately, so membership is fixed before the participant
 * arrives and is not an operator's judgement call. Letting the operator decide would select the
 * subsample on whatever they noticed about the participant — a good tracking face, a cooperative
 * manner — which is exactly the sample the criterion-validity estimate must not be conditioned on.
 *
 * Modulus 7 over the 145 enrolments the protocol plans yields 21 participants, against the 20 the
 * synopsis specifies, and the selected enrolments fall on all ten Williams rows evenly, so the
 * subsample is balanced across condition orders rather than concentrated in a few.
 *
 * Membership only makes the video grant OFFERABLE. It is still refusable, and defaults to refused.
 */
export const ANNOTATION_SUBSAMPLE_MODULUS = 7;

export function isAnnotationSubsample(enrolmentNumber: number): boolean {
  if (!Number.isFinite(enrolmentNumber) || enrolmentNumber < 1) return false;
  return Math.floor(enrolmentNumber) % ANNOTATION_SUBSAMPLE_MODULUS === 1;
}
