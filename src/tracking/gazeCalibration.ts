/**
 * The per-participant gaze check (rule gaze-r2, Round 80), and the on-screen test it makes possible.
 *
 * HISTORY. The original build's "calibration" stored hardcoded zeros and never fitted anything. Its
 * replacement (gaze-r1, to Round 79) presented nine targets, sampled the iris offset at each, and
 * fitted a neutral bias and two thresholds for a 3x3 grid of gaze zones. That fit is gone; records it
 * wrote keep its fields (CalibrationRecord), and the export marks the zone columns it fed as
 * deprecated (07 gaze_deviation_ratio, zone_center_ratio, zone_transition_count). Why it went, and
 * what replaced it, is below.
 */

/** How much evidence a calibration's gaze part rests on (01 gaze_trust). 'thin' is gaze-r1 only. */
export type GazeTrust = 'good' | 'thin' | 'unusable';

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const meanAbs = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length : 0);

/*
 * ---------------------------------------------------------------------------------------------------
 * THE GAZE CHECK, RULE gaze-r2 (Round 80).
 *
 * WHY THE NINE POINTS WENT. Gaze is a quality check in this study, never an outcome (the synopsis lists
 * no gaze outcome; round 74 research report R1, D8). The nine-point fit asked more of a tablet's front
 * camera than it can give:
 *   - at 55 cm the iris moves only about 2.4 camera pixels between the 10% and 90% targets
 *     horizontally and about 1.5 vertically, the size of the tracker's own jitter (round 78 research
 *     report R2, C1: a model from the geometry and a ~200-px face, not measured on the tablet); and the
 *     vertical offset is measured from the midpoint of the two lid margins (gaze.ts, landmarks 159/145),
 *     which move with the eye, so it is smaller still;
 *   - the fit needed BOTH axes to separate, so the vertical axis failed it in good light;
 *   - each target had 800 ms, scored against an assumed 30 fps, with no retry of a single target.
 *
 * WHAT IS LEFT, AND WHAT IT CAN SAY. One question: is the participant looking at the tablet? Three dots
 * across a mid-height reading line (its two ends and its middle; calibrationSequence.ts GAZE_DOTS) give
 * this person's horizontal iris offset at the ends of a line of text. A frame is ON SCREEN when the eye
 * is open (estimateGaze resolves an offset), the head is not turned away (the existing off-axis rule,
 * headPose.ts), and the horizontal offset lies within the dots' range widened by GAZE_RANGE_MARGIN.
 * Nothing finer is claimed: the signal is a few pixels (above), and a head turned one way with the eyes
 * turned further the same way can pass both tests, so the index can only under-count looking away.
 * ---------------------------------------------------------------------------------------------------
 */

/** The rule the gaze check ran under. 'gaze-r1' is the nine-point fit (records before Round 80). */
export const GAZE_RULE = 'gaze-r2' as const;
export const GAZE_RULE_BEFORE = 'gaze-r1' as const;

/** The three dots of the gaze check, by where they sit on the reading line. */
export type GazeDotId = 'centre' | 'left' | 'right';

/**
 * How far past the dots' range a frame still counts as on screen, as a share of half the range.
 *
 * Derived from the geometry, then rounded. The dots sit at the ends of the 1040-px reading column, 520
 * root px either side of centre; the screen's edge is 576 px out. On the study tablet a root px is
 * 0.2055 mm (lib/rtLocations.ts), so at the protocol's 55 cm the dots are 11.0 degrees out and the edge
 * 12.1 degrees. R2 (C3) proposed the screen's half-extent plus 3 degrees, 15.1. Iris offset grows about
 * as the sine of the eye's turn, and sin 15.1 / sin 11.0 = 1.37, so the range is widened by 0.37 of its
 * half each side. At 50 and 60 cm the same rule gives 0.34 and 0.40. A judgement on R2's proposal,
 * versioned with the rule; the 3 degrees also absorbs the landmarks' frame-to-frame jitter.
 */
export const GAZE_RANGE_MARGIN = 0.37;

/** The left and right edges, centre-relative or not, of the horizontal iris offsets that count as on screen. */
export interface GazeRange { lo: number; hi: number }

/** Why a gaze check gave no range. */
export type GazeCheckFailure = 'too_few_samples' | 'not_separable';

export interface GazeCheckFit {
  valid: boolean;
  reason: GazeCheckFailure | null;
  /** Dots that ended with fewer usable samples than they needed, after their retries. */
  shortDots: GazeDotId[];
  /** Median horizontal iris offset at each dot; null for a dot with no usable sample. */
  hLeft: number | null;
  hCentre: number | null;
  hRight: number | null;
  /** Mean absolute deviation of the centre dot's samples about their median: the noise the ends must clear. */
  centreSpread: number | null;
  /** The on-screen range, widened by GAZE_RANGE_MARGIN; null unless valid. */
  range: GazeRange | null;
  samplesPerDot: Record<GazeDotId, number>;
}

/** The ends must sit this many centre spreads from the centre: the nine-point fit's own separability test. */
export const GAZE_SEPARATION_SPREADS = 1.5;

/**
 * Fit the gaze check from the horizontal iris offsets each dot collected (open-eye frames only: a closed
 * or partly solved eye gives NaN and is dropped). `needed` is each dot's share of the frames the camera
 * delivered (calibrationSequence.ts gazeDotNeeded); a dot short of it, after its retries, fails the check.
 */
export function fitGazeCheck(raw: Partial<Record<GazeDotId, number[]>>, needed: Partial<Record<GazeDotId, number>>): GazeCheckFit {
  const ids: GazeDotId[] = ['centre', 'left', 'right'];
  const h = {} as Record<GazeDotId, number[]>;
  for (const id of ids) h[id] = (raw[id] ?? []).filter((x) => Number.isFinite(x));
  const samplesPerDot = { centre: h.centre.length, left: h.left.length, right: h.right.length };
  const med = (xs: number[]) => (xs.length ? median(xs) : null);
  const hCentre = med(h.centre);
  const hLeft = med(h.left);
  const hRight = med(h.right);
  const centreSpread = hCentre == null ? null : meanAbs(h.centre.map((x) => x - hCentre));
  const shortDots = ids.filter((id) => h[id].length === 0 || h[id].length < (needed[id] ?? 1));
  const base = { shortDots, hLeft, hCentre, hRight, centreSpread, samplesPerDot };
  if (shortDots.length > 0 || hCentre == null || hLeft == null || hRight == null || centreSpread == null) {
    return { ...base, valid: false, reason: 'too_few_samples', range: null };
  }
  const dL = hLeft - hCentre;
  const dR = hRight - hCentre;
  // The two ends on opposite sides of the centre, each clear of the centre's own scatter. Which side is
  // which depends on the camera's orientation, so neither sign is assumed.
  const separable = Math.sign(dL) !== 0 && Math.sign(dL) === -Math.sign(dR)
    && Math.abs(dL) > GAZE_SEPARATION_SPREADS * centreSpread
    && Math.abs(dR) > GAZE_SEPARATION_SPREADS * centreSpread;
  if (!separable) return { ...base, valid: false, reason: 'not_separable', range: null };
  const lo = Math.min(hLeft, hRight);
  const hi = Math.max(hLeft, hRight);
  const pad = GAZE_RANGE_MARGIN * ((hi - lo) / 2);
  return { ...base, valid: true, reason: null, range: { lo: lo - pad, hi: hi + pad } };
}

/**
 * One frame: on screen, off screen, or not measurable.
 *
 * Null when there is no range (no passed gaze check) or the eye gave no offset (closed, or a partial
 * solve) — so a blink is never counted as looking away, which the nine-point zones did (R1, D7).
 */
export function onScreenFrame(h: number, offAxis: boolean, range: GazeRange | null): boolean | null {
  if (!range || !Number.isFinite(h)) return null;
  if (offAxis) return false;
  return h >= range.lo && h <= range.hi;
}

/** gaze_trust under gaze-r2: a passed check is 'good'; there is no 'thin' (a short dot is retried instead). */
export function gazeCheckTrust(fit: GazeCheckFit): GazeTrust {
  return fit.valid ? 'good' : 'unusable';
}
