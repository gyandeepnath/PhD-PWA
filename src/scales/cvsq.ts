/**
 * Computer Vision Syndrome Questionnaire (CVS-Q; Seguí et al., 2015) — a validated 16-item
 * instrument (ICC 0.80, sens/spec > 70%). Administered at baseline and session end.
 *
 * Scoring: each item's severity = Frequency × Intensity, where
 *   Frequency: never = 0, occasionally = 1, often/always = 2
 *   Intensity: moderate = 1, intense = 2  (0 when frequency is 0)
 * Severity (0,1,2,4) is recoded to a 0-2 item score (0→0, 1-2→1, 4→2) and summed across 16 items
 * (range 0-32). A total ≥ 6 classifies the respondent as symptomatic for CVS — see CVSQ_CUTOFF for
 * why six and not the seven used by the Portuguese version.
 */
export const CVSQ_ITEMS = [
  'Burning',
  'Itching',
  'Feeling of a foreign body',
  'Tearing',
  'Excessive blinking',
  'Eye redness',
  'Eye pain',
  'Heavy eyelids',
  'Dryness',
  'Blurred vision',
  'Double vision',
  'Difficulty focusing for near vision',
  'Increased sensitivity to light',
  'Coloured halos around objects',
  'Feeling that sight is worsening',
  'Headache',
] as const;

/**
 * Total at or above which the respondent is classified as having CVS.
 *
 * SIX, AND NOT SEVEN — and the difference is one participant's classification at a time.
 *
 * ≥7 is the cut-off of the PORTUGUESE cross-cultural version (Cantó-Sancho et al., 2024). This
 * study administers the ORIGINAL 16-item CVS-Q, and its cut-off is ≥6. The project's own citation
 * ledger had recorded ≥7 as "the cut-off used by this project's instrument", which is the kind of
 * error that gets acted on: changing this constant to 7 would silently reclassify every participant
 * scoring exactly 6, at baseline and at session end, in both directions of the change score.
 *
 * The instrument's own authors settle it. Seguí-Crespo — Seguí (2015) under her other name form —
 * co-authored the CVS-Q teen adaptation, which says of the 14-item teen version and the 16-item
 * original: "the cut-off point being the same, although this differs for other linguistic versions
 * that are also derived from the original." The teen cut-off is ≥6.
 *
 * See docs/CITATION_VERIFICATION.md entries 24 and 24b, including what is and is not verified: the
 * Seguí (2015) full text could not be read from the build environment, so ≥6 rests on that
 * same-authors statement rather than on the primary. Confirm it once against the paper.
 */
export const CVSQ_CUTOFF = 6;

/** Recode a single item's frequency (0-2) and intensity (0-2) to its 0-2 item score. */
export function cvsqItemScore(frequency: number, intensity: number): number {
  const severity = frequency * intensity;
  if (severity === 0) return 0;
  if (severity >= 4) return 2;
  return 1;
}

export interface CvsqScore {
  total: number;
  symptomatic: boolean;
  itemScores: number[];
}

/** Total CVS-Q score from per-item frequency and intensity arrays (length 16). */
export function scoreCvsq(frequency: number[], intensity: number[]): CvsqScore {
  const itemScores = CVSQ_ITEMS.map((_, i) => cvsqItemScore(frequency[i] ?? 0, intensity[i] ?? 0));
  const total = itemScores.reduce((s, x) => s + x, 0);
  return { total, symptomatic: total >= CVSQ_CUTOFF, itemScores };
}
