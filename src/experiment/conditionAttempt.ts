/**
 * attempt_number: which EXPOSURE of its passage a condition row describes (Round 87, audit 86 F12).
 *
 * A pause or a crash restarts the condition, and the row is rewritten in place under the same
 * condition_id. attempt_number is how that redo leaves a trace: above 1, the codebook tells the analyst,
 * the participant had already read this passage, found this search target and seen these questions, so
 * reading, comprehension and search on the row are second-exposure values — and the primary
 * sensitivity analysis leaves such rows out (ANALYSIS_PLAN §5, "without restarted runs").
 *
 * It used to count ENTRIES to the reading screen. The row is written when the reading stage mounts,
 * which is while its instruction card ("Read the passage … Begin reading") is still up and no word of
 * the passage has been shown. A pause there — or the camera-lost notice, whose recommended button is
 * the pause, or a reload — made the next run attempt 2: a clean first reading recorded as a second
 * one, flagged by the join report (condition_redone) and dropped by the sensitivity analysis. The
 * audit reproduced it with one pause on display 2's card.
 *
 * Now a run counts only once its passage has been SHOWN: "Begin reading" stamps passage_shown_at on
 * the row (Experiment.tsx), and the next run's number is the previous run's plus one only when the
 * previous run's passage was shown. Pausing on the card any number of times leaves the number where
 * it was; pausing anywhere after "Begin reading" — a reading page, the questions, the search, the
 * reaction block — still counts, as before.
 *
 * Versioned, because the same events give a different number: attempt_rule_version on the row,
 * 'at-v2' from this round. A row without it ('at-v1') was counted by the old rule, and whether its
 * earlier run reached the passage was not recorded, so it cannot be recounted; a run that follows an
 * at-v1 row counts that row as shown, which is what the old rule did — an unknown is never read as
 * "not shown", which would turn a second reading into a first.
 */
import type { ConditionRecord } from '@/storage/types';

/** The rule this build counts by: only runs whose passage was shown. */
export const ATTEMPT_RULE_VERSION = 'at-v2';
/** The rule before Round 87, for rows that carry no version: every entry to the reading screen. */
export const ATTEMPT_RULE_VERSION_V1 = 'at-v1';

type PriorRun = Pick<ConditionRecord, 'attempt_number' | 'attempt_rule_version' | 'passage_shown_at' | 'reading_time_ms' | 'completed_at'>;

/** Whether the run a stored row describes got as far as showing its passage. */
export function passageWasShown(prior: PriorRun): boolean {
  // Counted by the old rule, which did not record it: taken as shown (see above).
  if (prior.attempt_rule_version !== ATTEMPT_RULE_VERSION) return true;
  // The stamp, or anything only a shown passage can lead to — should the stamp's write ever have been
  // lost while a later write of the row was not.
  return prior.passage_shown_at != null || prior.reading_time_ms != null || prior.completed_at != null;
}

/**
 * The attempt_number of a run about to start, given the row an earlier run of this condition left (or
 * undefined for the first). Exactly the old count — the earlier number plus one — whenever the earlier
 * run's passage was shown; the earlier number itself when it was not.
 */
export function nextAttemptNumber(prior: PriorRun | undefined): number {
  if (!prior) return 1;
  // Rows from before attempt_number existed read as 0 here, as they always did: the redo is attempt 1.
  const before = prior.attempt_number ?? 0;
  return passageWasShown(prior) ? before + 1 : Math.max(1, before);
}
