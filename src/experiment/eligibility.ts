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

/** Which stage is authoritative for a reason. Each owns a disjoint set; see OWNED_BY. */
export type ExclusionSource = 'profile' | 'colour_vision';

/**
 * The reasons each stage may assert, as the patterns that recognise them in a stored record.
 *
 * Stored reasons are a joined string with no tags on them, so re-writing has to identify a stage's
 * own reasons by what they say. Keeping the patterns beside the strings that produce them is what
 * stops the two drifting — a reason a stage can emit but not recognise would be duplicated on every
 * re-run, and one it recognises but cannot emit would be silently dropped.
 *
 * Colour vision — BOTH the screen result and the self-report — belongs to the colour-vision stage,
 * which runs after the profile stage and holds the sticky `cvd_status`. The profile stage records
 * the self-report into that status and says nothing about it here, so the two cannot disagree.
 */
const OWNED_BY: Record<ExclusionSource, RegExp[]> = {
  profile: [/inclusion range/i, /contact-lens/i, /formal plates/i],
  colour_vision: [/colour-vision screening/i, /self-reported colour-vision/i],
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
