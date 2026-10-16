/**
 * The visual analogue scale (VAS) the fatigue and display-perception ratings are drawn as, from Round 84.
 *
 * WHAT IT REPLACES. Both ratings were native range sliders. The fatigue items were 0-10 in whole steps
 * with "x / 10" printed beside each while the participant answered — an eleven-point number scale, while
 * the synopsis and the codebook called it a visual-fatigue VAS. The comfort and clarity ratings were
 * 0-100 sliders, also with the number printed, and with the track filled up to the answer. Neither line
 * had a physical length: it was whatever the 720 px column left, about 134 mm on the study tablet.
 *
 * WHAT A VAS IS, AND WHY THIS ONE. A VAS shows an empty line with words at its two ends; the respondent
 * marks a point on it and the score is the distance from the left end. Web VAS approximate an interval
 * scale, where a categorical scale reaches only ordinal level (Reips & Funke 2008, Behav Res Methods
 * 40(3):699; abstract, ledger 66).
 *
 * WHAT THE CHANGE RESTS ON. The old fatigue sliders printed "x / 10" while the participant answered,
 * which made them a number scale, not the visual-fatigue VAS the synopsis describes; both old sliders
 * also filled the track up to the answer, and neither had a physical length. The lines show no number
 * and no fill, follow the VAS definition and the tap-and-adjust procedure of a validated digital VAS
 * (Delgado et al. 2018, below), and are one fixed physical length.
 *
 * WHAT IS NOT CLAIMED: that the line is more accurate than the old sliders. In an online study of 222
 * people placing given percentages on a line, a VAS (click to place, adjust as often as wanted) had lower
 * measurement error than sliders started at the left, middle or right, and less variability in that
 * error (Angelike & Reips 2026, Behav Res Methods 58(9); full text read, ledger 65) — but every slider
 * there was DRAG-ONLY (its click was disabled) with the thumb VISIBLE at its start, and the authors write
 * that a slider that also takes a click may outperform the VAS, which their study did not test. The old sliders
 * here took a tap and hid the thumb until the first touch (SLIDER_VERSION_V1), so that study does not
 * compare the line with the instrument it replaced. What is used from it: the paper reports, from earlier
 * work, that a slider initialised at a valid position cannot tell a non-response from a response there,
 * and that a starting position can anchor answers — which is why the line has no internal default at all.
 * So, here:
 *   - NO MARKER until the first touch, and no internal default: an unanswered line has no value at all,
 *     which is not 0 (`null` until touched);
 *   - TAP TO PLACE, then tap again or drag to adjust, as often as wanted before Continue — the procedure
 *     of the validated digital VAS in Delgado et al. 2018 (J Am Acad Orthop Surg Glob Res Rev 2(3):e088;
 *     full text, ledger 67), whose first tap was likewise not the final answer;
 *   - WORDS ONLY at the two ends, no numbers, no interior ticks and no fill: Delgado's lines carried only
 *     the two end phrases, and a number shown while answering is what made the fatigue items a number
 *     scale. The participant never sees a score (see also noParticipantFeedback.test.ts);
 *   - ONE LINE LENGTH, 100 mm on the glass, in every condition and at the baseline. The paper VAS is a
 *     10 cm line (Delgado et al. 2018), and with the ruler calibration (lib/physicalCalibration.ts) this
 *     screen can draw one. NOT EVIDENCE THAT 100 mm IS BEST ON A TABLET: Delgado's 9.6 cm phone line
 *     differed from paper by a small proportional bias (mean 1.9% of the scale), which the authors put down
 *     to a fingertip being coarser than a pen, while a 28.9 cm laptop line agreed with paper; no tablet was
 *     tested. A bias common to every condition does not move a within-participant contrast; whether the
 *     fingertip's coarseness adds noise on this tablet is NOT MEASURED. The length is the convention, kept
 *     fixed so every rating in the study is made on the same physical line;
 *   - a marker that STANDS ABOVE THE LINE, so the fingertip does not hide where it landed, and a touch
 *     target much taller than the line.
 *
 * WHAT IS STORED. The same scales as before, so nothing downstream changes unit: each fatigue item
 * 0-10 (now in tenths: whole millimetres of the 100 mm line divided by 10), and comfort and clarity 0-100
 * (whole millimetres). Paper VAS are read to the millimetre. Every row carries `slider_version`, so the
 * two formats are never pooled unknowingly, and the length the line was actually drawn at.
 */
import { sessionMmPerCssPx, type PhysicalSource, type SessionPhysical } from '@/lib/physicalCalibration';

/** The rating format in force: the 100 mm visual analogue line. */
export const SLIDER_VERSION = 'vas-v2';
/**
 * The format before Round 84, as `slider_version` names rows that carry none: the fatigue items an
 * eleven-step 0-10 slider showing its number, comfort and clarity a 0-100 slider showing its number with
 * a filled track. Both hid the thumb until the first touch.
 */
export const SLIDER_VERSION_V1 = 'sl-v1';

/** The line's physical length, in mm. */
export const VAS_LINE_MM = 100;

/** The format a stored rating row was made with. */
export function rowSliderVersion(row: { slider_version?: string | null }): string {
  return row.slider_version || SLIDER_VERSION_V1;
}

/** A tap's position along the line, as whole millimetres of a 100 mm line (0-100). */
export function vasMm(fraction: number): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.round(f * VAS_LINE_MM);
}

/**
 * How long to draw the line, in CSS px: 100 mm at this sitting's millimetres per CSS pixel — the ruler
 * measurement, or the same documented fallback every physical column uses, flagged by `source`.
 */
export function vasLineCssPx(physical: SessionPhysical, dpr?: number | null): { cssPx: number; source: PhysicalSource } {
  const { mm, source } = sessionMmPerCssPx(physical, dpr);
  return { cssPx: VAS_LINE_MM / mm, source };
}

/** The length a line WAS drawn at, in mm, from its on-screen width in CSS px. One decimal. */
export function drawnLineMm(renderedCssPx: number, physical: SessionPhysical, dpr?: number | null): number | null {
  if (!(Number.isFinite(renderedCssPx) && renderedCssPx > 0)) return null;
  const { mm } = sessionMmPerCssPx(physical, dpr);
  return Math.round(renderedCssPx * mm * 10) / 10;
}
