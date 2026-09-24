/**
 * The background of a rating slider's track on a CONDITION screen.
 *
 * The empty track was the ink at 13-19% alpha. Translucency multiplies the condition's own contrast,
 * so in P4 (yellow on white, 2.39:1) the empty track was about 1.1:1 — a line the participant could
 * barely see and had to tap to answer. It is now drawn in FULL ink as a dashed line: visible at
 * exactly the condition's own contrast, and dashed so "not set" still reads as not set. Once the
 * participant has answered, the chosen part is solid ink and the rest stays dashed.
 */
export function ratingTrack(ink: string, touched: boolean, pct: number): string {
  const dashed = `repeating-linear-gradient(to right, ${ink} 0 10px, transparent 10px 16px)`;
  if (!touched) return dashed;
  return `linear-gradient(to right, ${ink} ${pct}%, transparent ${pct}%), ${dashed}`;
}
