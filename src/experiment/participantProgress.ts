/**
 * What a participant's history means for the sitting about to start.
 *
 * This arithmetic was written out twice — once in `resolveAssignment`, which tells the console what
 * to display, and once in `beginSession`, which builds the actual plan — and the two had to agree
 * for the console to be describing the session it was about to create. They agreed on the wrong
 * thing.
 *
 * THE DEFECT. Both computed the illumination block as
 * `min(floor(completed / N_CONDITIONS), N_ILLUMINATION_BLOCKS - 1)` and then used it for everything
 * that depends on "how many times has this participant been through the protocol". Under the
 * current single-level design that clamp pins the value at 0 forever. So for a participant who had
 * already completed all ten conditions:
 *
 *   offset = completed % 10 = 0  →  a fresh plan of all ten conditions
 *   block  = min(1, 0)      = 0  →  passage_repeat_number = 1 on every row
 *
 * The app started the entire protocol again, in silence, and the second ten rows were labelled
 * indistinguishably from the first ten. In the export that participant appears as twenty
 * independent condition-runs, each asserting a first reading of its passage, while in fact the
 * second ten are second-exposure reading speed, second-exposure comprehension and a visual search
 * whose target locations are already known. Nothing anywhere said so.
 *
 * THE FIX is to keep the two numbers apart. The PASS count answers "how many complete times has
 * this participant done this" and is never clamped. The illumination BLOCK is a design assignment
 * and is clamped to the levels the design has. One place, so they cannot drift again.
 */
import { N_CONDITIONS } from './conditions';
import { N_ILLUMINATION_BLOCKS } from './illumination';

export interface ParticipantProgress {
  /** Complete passes through the ten conditions already finished. NOT clamped. 0 = first pass. */
  passes: number;
  /** Illumination assignment index, clamped to the levels this design has. */
  block: number;
  /** Serial position within the current pass to resume at: 0 = start of a pass. */
  offset: number;
}

export function participantProgress(conditionsCompleted: number): ParticipantProgress {
  const done = Number.isFinite(conditionsCompleted) ? Math.max(0, Math.floor(conditionsCompleted)) : 0;
  const passes = Math.floor(done / N_CONDITIONS);
  return {
    passes,
    block: Math.min(passes, N_ILLUMINATION_BLOCKS - 1),
    offset: done % N_CONDITIONS,
  };
}

/**
 * How many times the participant has read this passage under the planned protocol, counting now.
 *
 * Derived from the pass, not the illumination block: see above. `protocol_pass` is absent on
 * sittings recorded before it was captured, and for those the block is what the number was derived
 * from, so it stays the fallback.
 */
export function passageRepeatNumber(
  session: { protocol_pass?: number; illumination_block?: number },
): number {
  return (session.protocol_pass ?? session.illumination_block ?? 0) + 1;
}

/** Minimum length of the written reason required before a completed participant may be re-run. */
export const REPEAT_NOTE_MIN_CHARS = 3;

/**
 * May a sitting start for a participant with this history?
 *
 * A participant who has completed the protocol is not refused outright — a sitting voided by a
 * camera failure is a real reason to run one again — but the reason is required in writing, and it
 * is stored on the session record. This is the same shape as the out-of-range lux acknowledgement:
 * the alternative to recording the decision is not preventing it, it is losing it.
 */
export function repeatRunAcknowledged(priorPasses: number, note: string): boolean {
  if (priorPasses < 1) return true;
  return note.trim().length >= REPEAT_NOTE_MIN_CHARS;
}
