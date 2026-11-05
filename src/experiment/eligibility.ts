/**
 * Who is excluded from the confirmatory analysis, and why — assembled by two stages that must not
 * overwrite each other.
 *
 * THE DEFECT THIS EXISTS FOR. `eligible` and `exclusion_reason` are written from two places. The
 * colour-vision stage was careful: it read the prior reasons, stripped only its own, added its
 * verdict, and set `eligible: p.eligible && !failsColourVision` — sticky, conjunctive, merged. The
 * participant-profile stage was not. It computed a fresh `reasons` array from this sitting's
 * answers and wrote `eligible: reasons.length === 0` and `exclusion_reason: reasons.join('; ')`
 * over whatever was there.
 *
 * The record is created once and SHARED across a participant's sittings, and the profile stage runs
 * again at the start of each. So for a participant excluded at sitting 1 by the Ishihara screen —
 * which the profile stage does not know about, because it asks only about self-report and formal
 * plates — sitting 2's profile stage produced an empty reasons array, set `eligible = true` and
 * `exclusion_reason = null`, and erased the exclusion.
 *
 * In the ordinary flow the colour-vision stage runs a few screens later and restores it, because
 * `cvd_status` is preserved separately. The window is what matters: a sitting abandoned between the
 * two stages — which is exactly what a participant withdrawing during setup produces — leaves the
 * record saying `eligible = TRUE` with no reason, permanently. The codebook instructs the analyst
 * to drop rows where eligible is false, so an excluded participant silently re-enters the
 * confirmatory analysis of a text-colour factor they cannot perceive normally.
 *
 * The fix is to give each stage a defined set of reasons it OWNS, and to have every writer replace
 * only its own. Then neither stage can erase the other's verdict, and eligibility is a property of
 * everything known about the participant rather than of whichever screen ran last.
 */

/**
 * Which writer is authoritative for a reason. Each owns a disjoint set; see OWNED_BY.
 *
 * `formal_plates` is not a stage: it is the operator's formal colour-vision result, which is asked
 * on the profile form AND on the notice after the app's own colour screen does not pass (audit 86
 * UI-7). Two screens record one answer, so the answer has its own owner and one rule
 * (recordFormalPlates below): if it belonged to the profile, the notice could not write it without
 * also stripping the profile's age and contact-lens reasons.
 */
export type ExclusionSource = 'profile' | 'colour_vision' | 'formal_plates';

/**
 * The reasons each stage may assert, as the patterns that recognise them in a stored record.
 *
 * Stored reasons are a joined string with no tags on them, so re-writing has to identify a stage's
 * own reasons by what they say. Keeping the patterns beside the strings that produce them is what
 * stops the two drifting — a reason a stage can emit but not recognise would be duplicated on every
 * re-run, and one it recognises but cannot emit would be silently dropped.
 *
 * Colour vision belongs to the colour-vision stage, which runs after the profile stage and holds
 * the sticky `cvd_status`. The profile stage records the self-report into that status and says
 * nothing about it here, so the two cannot disagree.
 *
 * RECOGNISED BUT NO LONGER EMITTED: /colour-vision screening/. The app's own digital colour-vision screen used
 * to assert 'failed the colour-vision screening' as an exclusion, contradicting its own module
 * header, the exported codebook and the operator manual, all three of which say that screen is a
 * flag and that the operator's FORMAL plates are the criterion. It no longer asserts it.
 *
 * The pattern stays. A stage's own reasons are identified by what they say, so keeping it is what
 * lets the colour-vision stage RETIRE a stale exclusion written by an earlier build: the next
 * administration strips it and the participant is eligible again, which is the corrected verdict.
 * Dropping the pattern instead would leave that reason permanently attached to a record, asserted
 * by nothing and removable by nothing. The information itself is not lost — `cvd_status` still
 * reads `screen_failed`, and the screen counts are still exported beside it.
 */
const OWNED_BY: Record<ExclusionSource, RegExp[]> = {
  profile: [/inclusion range/i, /contact-lens/i],
  colour_vision: [/colour-vision screening/i, /self-reported colour-vision/i],
  formal_plates: [/formal plates/i],
};

export interface EligibilityVerdict {
  eligible: boolean;
  /** Every reason known, from every stage, joined. Null only when there are none. */
  exclusion_reason: string | null;
}

/** Split a stored reason string back into its parts. Tolerant of the empty and the absent. */
export function splitExclusionReasons(stored: string | null | undefined): string[] {
  return (stored ?? '').split(';').map((r) => r.trim()).filter(Boolean);
}

/**
 * Replace one stage's reasons on a participant record, leaving every other stage's untouched.
 *
 * `fresh` is what this stage concludes NOW, which may be nothing — a participant who reported a
 * colour-vision deficiency at sitting 1 and corrects that at sitting 2 has the reason removed, and
 * should. What must not happen is a stage removing a reason it did not put there.
 */
export function mergeExclusionReasons(
  stored: string | null | undefined,
  source: ExclusionSource,
  fresh: string[],
): EligibilityVerdict {
  const mine = OWNED_BY[source];
  const others = splitExclusionReasons(stored).filter((r) => !mine.some((p) => p.test(r)));
  // Deduplicate: a reason another stage happens to word identically must not appear twice.
  const all = [...others];
  for (const r of fresh) if (!all.includes(r)) all.push(r);
  return { eligible: all.length === 0, exclusion_reason: all.length ? all.join('; ') : null };
}

/** The operator's formal colour-vision plate result (Ishihara or Farnsworth), `cvd_clinical`. */
export type FormalPlates = 'normal' | 'deficient' | 'not_done';

/** The reason a 'deficient' formal result is recorded under. Owned by `formal_plates`. */
export const FORMAL_PLATES_REASON = 'colour-vision deficiency on formal plates';

/**
 * Record a formal plate result: the value to store and the verdict it implies. One rule for every
 * screen that asks for it — the profile form, and the notice shown when the app's own colour screen
 * does not pass.
 *
 * THE DEFECT THIS EXISTS FOR (audit 86 UI-7). The notice told the operator to administer the formal
 * plates "now, while the participant is here, and record the result on the profile form" — but the
 * profile comes BEFORE the colour screen and nothing returns to it in that sitting (its only way
 * back, from pre-flight, closes once the plates have run). So the formal result could not be
 * entered: a participant whose plates showed a deficiency kept the 'not done' typed at the profile
 * and stayed eligible=TRUE in the confirmatory sample of a text-colour factor. The notice now asks
 * for the result itself, and both screens record it through this function.
 *
 * `stored` is the result as it stood before this sitting's answer — the row before this sitting's
 * profile, when that is known — so a later answer in the same sitting REPLACES an earlier one, as a
 * correction on the profile does, while results from earlier sittings keep their stickiness:
 *
 *   - a 'deficient' result stands at every later sitting (a later 'normal' does not cancel it);
 *   - 'not_done' never overwrites a real result: it says nothing was measured this time.
 *
 * The exclusion reason follows the STORED result, not this answer. It followed the answer, so a
 * participant 'deficient' at sitting 1 and 'normal' at sitting 2 was stored cvd_clinical='deficient'
 * with eligible=TRUE — a row that contradicts the codebook's own rule ("a 'deficient' result sets
 * eligible=false"). `reasons` is the record's reason string as it now stands; every other writer's
 * reasons are kept (mergeExclusionReasons).
 */
export function recordFormalPlates(
  stored: FormalPlates | null | undefined,
  answer: FormalPlates,
  reasons: string | null | undefined,
): EligibilityVerdict & { cvd_clinical: FormalPlates } {
  const cvd_clinical: FormalPlates = stored === 'deficient' ? 'deficient'
    : answer !== 'not_done' ? answer
      : (stored ?? 'not_done');
  const verdict = mergeExclusionReasons(reasons, 'formal_plates', cvd_clinical === 'deficient' ? [FORMAL_PLATES_REASON] : []);
  return { cvd_clinical, ...verdict };
}
