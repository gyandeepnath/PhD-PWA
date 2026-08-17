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

/**
 * First row of a balanced Latin square for even n (0-indexed):
 * 0, 1, n-1, 2, n-2, 3, n-3, ...
 */
export function williamsFirstRow(n: number): number[] {
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
 * Passage index assigned to a given condition for a given participant.
 * Rotating offset decouples passage content from display condition.
 */
export function passageForCondition(conditionIndex: number, enrolmentNumber: number): number {
  const n = Number.isFinite(enrolmentNumber) ? Math.floor(enrolmentNumber) : 1;
  const c = Number.isFinite(conditionIndex) ? Math.floor(conditionIndex) : 0;
  const offset = (((n - 1) % N_CONDITIONS) + N_CONDITIONS) % N_CONDITIONS;
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
 * Passage assignment advances with the block too, so no participant reads the same passage twice.
 */
export function blockPlan(enrolmentNumber: number, block: number): PlannedStep[] {
  const n = Number.isFinite(enrolmentNumber) ? Math.floor(enrolmentNumber) : 1;
  const b = Number.isFinite(block) ? Math.floor(block) : 0;
  return sessionPlan(n + b);
}
