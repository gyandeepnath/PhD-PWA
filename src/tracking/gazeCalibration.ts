/**
 * Per-participant gaze calibration.
 *
 * The original build's "calibration" stored hardcoded zeros and never fitted anything, so gaze-zone
 * data was uncalibrated. Here we present 9 on-screen targets, sample the iris offset (h, v) while
 * the participant fixates each, and fit:
 *   - a neutral bias (h0, v0): the median offset at the centre target (corrects head/camera offset)
 *   - per-axis thresholds: the midpoint between the centred centre-fixation spread and the
 *     edge-fixation offset, so centre fixations classify as "centre" and edge fixations don't.
 * Falls back to defaults and reports `valid:false` when the fit is degenerate (too few samples or
 * edges not separable from centre) — gaze metrics then carry gaze_calibrated:false honestly.
 */
import { DEFAULT_GAZE_THRESHOLD } from './gaze';

/** Dwell per gaze target. Long enough to fixate and settle, short enough that nine are tolerable. */
export const GAZE_DWELL_MS = 800;

/**
 * Floor applied to a FITTED gaze threshold.
 *
 * This was a bare 0.06 written twice, and it is the one clamp in the tracking code that can pin a
 * real measurement without leaving a mark. The fitted threshold is the midpoint between the centre
 * spread and the edge offset, so the floor binds whenever those sum to less than about 0.12 — a
 * participant with limited gaze excursion, or a camera far enough away that the iris offsets are
 * small. That is not a degenerate fit: the validity test only asks that the edges separate from the
 * centre by 1.5x, which such a participant can satisfy comfortably.
 *
 * When it binds, every classification uses a threshold wider than the one their eyes earned, so more
 * samples fall in the centre zone and gaze_deviation_ratio is biased DOWNWARD. One-directional, and
 * on a participant characteristic rather than at random — so if it binds more often in one condition
 * it is confounded with the independent variable.
 *
 * The floor stays: a threshold at or near zero would classify ordinary measurement noise as a gaze
 * excursion. What changes is that the override is now RECORDED rather than silent, which is the
 * pattern viewportScale.ts already sets for its own minimum.
 */
export const MIN_FITTED_GAZE_THRESHOLD = 0.06;

/** The frame rate the protocol assumes, used only when the measured rate is unavailable. */
const NOMINAL_FPS = 30;

/**
 * How many USABLE samples a target must contribute before it counts as covered.
 *
 * This was written as `a.length > 0` — a methods decision spelled as an expression, where nobody
 * reviewing the protocol would ever find it. It is named here so that it can be read, argued with
 * and changed in one place.
 *
 * WHAT THE CURRENT VALUE MEANS. At 1, a target whose 800 ms dwell yielded a single solved frame
 * counts the same as one that yielded all of them. At ~30 fps that dwell should produce roughly 24
 * samples, so such a target had an almost entirely unsolved dwell, and its contribution to the
 * fitted threshold is one noisy point standing in for a distribution. Six targets in that state
 * still satisfy the two-thirds coverage rule and the sitting is exported `gaze_calibration_valid`.
 *
 * The original audit finding asked for 5. Raising it is a one-line change here, and it is NOT made
 * unilaterally: the bar decides how many sittings are declared valid, and therefore the analysable
 * n for every gaze measure. That is the investigator's call, not a tidy-up.
 *
 * Gaze is a secondary measure — the primary outcome is the incomplete-blink ratio, whose baseline
 * is fitted in measureEarBaseline and does not depend on this — so the exposure is bounded.
 */
export const MIN_SAMPLES_PER_TARGET = 1;

/** 9 calibration targets at normalised screen positions (col,row in {0,0.5,1}). */
export const GAZE_TARGETS: { id: string; x: number; y: number }[] = [
  { id: 'tl', x: 0.1, y: 0.1 }, { id: 'tc', x: 0.5, y: 0.1 }, { id: 'tr', x: 0.9, y: 0.1 },
  { id: 'ml', x: 0.1, y: 0.5 }, { id: 'cc', x: 0.5, y: 0.5 }, { id: 'mr', x: 0.9, y: 0.5 },
  { id: 'bl', x: 0.1, y: 0.9 }, { id: 'bc', x: 0.5, y: 0.9 }, { id: 'br', x: 0.9, y: 0.9 },
];

export interface GazeSample { h: number; v: number }

export interface GazeCalibration {
  h0: number;
  v0: number;
  hThreshold: number;
  vThreshold: number;
  valid: boolean;
  /**
   * Usable samples per target, keyed by target id, for every one of the nine — including the ones
   * that produced nothing.
   *
   * This is the evidence behind the verdict, and without it `valid` was an assertion nobody could
   * check. Two very different runs reduced to the same `true`: nine targets with two dozen samples
   * each, and six targets with a single frame each. The operator saw no difference and the export
   * recorded none, so a calibration that had barely happened was indistinguishable from a good one.
   *
   * Keeping the counts also makes the acceptance bar a decision that can be revisited. The bar is
   * applied live, so without these numbers a stricter threshold could never be applied to data
   * already collected.
   */
  samplesPerTarget: Record<string, number>;
  /**
   * TRUE when MIN_FITTED_GAZE_THRESHOLD raised either axis above what the fit produced.
   *
   * Without this the override is invisible: the exported threshold reads like a measurement of this
   * participant when it is partly a floor, and the resulting bias in gaze_deviation_ratio runs one
   * way. An analyst can now exclude or model these sittings; before, they could not find them.
   */
  thresholdFloored: boolean;
  /**
   * How many targets contributed at least one USABLE sample — the same count the validity test
   * below is decided on. It is returned rather than recomputed by the caller because it was
   * recomputed by the caller, with a different filter, and the two answers disagreed: the exported
   * QC column counted raw samples while validity counted finite ones, so a target whose every frame
   * was a degenerate landmark solve (faceEar returns NaN) was reported as detected and excluded
   * from the fit at the same time. One definition, owned here.
   */
  targetsWithSamples: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const meanAbs = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length : 0);

/**
 * Fit calibration from collected samples keyed by target id. Each target should have >=1 sample.
 */
export function fitGazeCalibration(raw: Record<string, GazeSample[]>): GazeCalibration {
  // Drop non-finite samples defensively (a dropped frame / bad landmark must not poison the fit).
  const samplesByTarget: Record<string, GazeSample[]> = {};
  for (const [id, arr] of Object.entries(raw)) {
    samplesByTarget[id] = (arr ?? []).filter((s) => Number.isFinite(s.h) && Number.isFinite(s.v));
  }
  const center = samplesByTarget['cc'] ?? [];
  const h0 = median(center.map((s) => s.h));
  const v0 = median(center.map((s) => s.v));

  // Centred offsets at horizontal edges (left/right) and vertical edges (top/bottom).
  const hEdgeIds = ['ml', 'mr', 'tl', 'tr', 'bl', 'br'];
  const vEdgeIds = ['tc', 'bc', 'tl', 'tr', 'bl', 'br'];
  const hEdges = hEdgeIds.flatMap((id) => (samplesByTarget[id] ?? []).map((s) => s.h - h0));
  const vEdges = vEdgeIds.flatMap((id) => (samplesByTarget[id] ?? []).map((s) => s.v - v0));
  const centerSpreadH = meanAbs(center.map((s) => s.h - h0));
  const centerSpreadV = meanAbs(center.map((s) => s.v - v0));
  const edgeH = meanAbs(hEdges);
  const edgeV = meanAbs(vEdges);

  // Threshold = midpoint between centre spread and edge offset (clamped to a sane floor).
  const safe = (x: number) => (Number.isFinite(x) ? x : 0);
  const hFitted = (safe(centerSpreadH) + safe(edgeH)) / 2;
  const vFitted = (safe(centerSpreadV) + safe(edgeV)) / 2;
  const hThreshold = Math.max(MIN_FITTED_GAZE_THRESHOLD, hFitted);
  const vThreshold = Math.max(MIN_FITTED_GAZE_THRESHOLD, vFitted);
  // Recorded before the valid/invalid branch below, because the question this answers is whether the
  // FIT was floored, not which value ended up being returned.
  const thresholdFloored = hFitted < MIN_FITTED_GAZE_THRESHOLD || vFitted < MIN_FITTED_GAZE_THRESHOLD;

  /**
   * Validity is judged on COVERAGE and on both axes, not on a bare sample count.
   *
   * The old test was `totalSamples >= GAZE_TARGETS.length`, i.e. nine samples across all nine
   * targets combined. Two targets producing five samples each satisfied it while seven targets
   * contributed nothing — a fit through two points reported as a nine-point calibration. And
   * `separable` accepted either axis alone, so a run that separated horizontally but not vertically
   * left the vertical threshold at its unfitted floor (DEFAULT_GAZE_THRESHOLD) while
   * gaze_calibrated was exported as TRUE. Every vertical gaze zone in that sitting was then a
   * guess presented as a measurement.
   *
   * Both axes must now separate, and at least two thirds of the targets must have produced
   * samples, with the centre among them.
   *
   * How many samples make a target "covered" is MIN_SAMPLES_PER_TARGET, named above rather than
   * left as a bare `> 0` in this expression.
   */
  const covered = (a: GazeSample[]) => a.length >= MIN_SAMPLES_PER_TARGET;
  const targetsWithSamples = Object.values(samplesByTarget).filter(covered).length;
  // Every target appears, including those that produced nothing: a missing key and a zero are the
  // same fact, and only one of them survives being read by someone else later.
  const samplesPerTarget: Record<string, number> = {};
  for (const t of GAZE_TARGETS) samplesPerTarget[t.id] = (samplesByTarget[t.id] ?? []).length;
  const MIN_TARGETS = Math.ceil(GAZE_TARGETS.length * (2 / 3));
  const separableH = edgeH > centerSpreadH * 1.5;
  const separableV = edgeV > centerSpreadV * 1.5;
  const valid = targetsWithSamples >= MIN_TARGETS
    && covered(center)
    && separableH
    && separableV;

  return {
    h0, v0,
    hThreshold: valid ? hThreshold : DEFAULT_GAZE_THRESHOLD,
    vThreshold: valid ? vThreshold : DEFAULT_GAZE_THRESHOLD,
    valid,
    targetsWithSamples,
    samplesPerTarget,
    // Only meaningful for a fit that was used. An invalid fit returns DEFAULT_GAZE_THRESHOLD on both
    // axes, so nothing was floored — saying otherwise would invent an override that never happened.
    thresholdFloored: valid ? thresholdFloored : false,
  };
}

/**
 * Fraction of a target's dwell that must actually have been solved before the target counts as
 * WELL covered, as opposed to merely counted.
 *
 * Derived, not chosen: the expected number of samples is the dwell duration times the frame rate
 * the camera actually achieved, so this is "at least half the dwell produced a usable landmark
 * solve" rather than a magic sample count that silently means something different on a slower
 * tablet. Half is deliberately lenient — it is the bar for a WARNING, not for rejection.
 */
export const GAZE_WELL_COVERED_FRACTION = 0.5;

export type GazeTrust = 'good' | 'thin' | 'unusable';

export interface GazeQuality {
  /** The verdict an operator is shown, and an analyst can filter on. */
  trust: GazeTrust;
  /** Targets meeting MIN_SAMPLES_PER_TARGET — the acceptance bar. */
  covered: number;
  /** Targets that solved at least GAZE_WELL_COVERED_FRACTION of their dwell. */
  wellCovered: number;
  /** Samples the median covered target contributed. */
  medianSamples: number;
  /** What a fully solved dwell would have produced at the observed frame rate. */
  expectedSamples: number;
  total: number;
}

/**
 * Grade a calibration on the evidence behind it, not only on whether it cleared the bar.
 *
 * WHY THIS EXISTS. `valid` is a single boolean over a deliberately lenient bar: a target counts as
 * covered at MIN_SAMPLES_PER_TARGET samples, and two thirds of the targets must be covered. A run
 * where six of nine targets each produced ONE solved frame therefore satisfies it. The operator was
 * shown nothing at all in that case — the failure screen fires only when the fit is invalid — so a
 * calibration that had barely happened looked exactly like a good one, and the sitting exported as
 * `gaze_calibration_valid`. That is the difference between a calibration and a gesture.
 *
 * `trust` is reported, and the caller decides what to do with it. A `thin` verdict is not a failure:
 * the gaze mapping did fit, and the thresholds it produced may be perfectly serviceable. It means
 * the fit rests on little evidence and somebody should know that before the participant reads for an
 * hour and a half.
 */
export function gazeQuality(cal: GazeCalibration, effectiveFps?: number): GazeQuality {
  const counts = GAZE_TARGETS.map((t) => cal.samplesPerTarget[t.id] ?? 0);
  const covered = counts.filter((n) => n >= MIN_SAMPLES_PER_TARGET).length;

  /*
   * The reference rate, and an honest note about it: no measured frame rate exists at calibration
   * time. effective_fps is computed per CONDITION, from the reading exposure, which has not happened
   * yet. So the expectation is normally the protocol's nominal 30 fps, and a genuinely slower tablet
   * will therefore look thinner than it is.
   *
   * That is the safe direction to be wrong in — it over-warns rather than under-warns — and it is
   * why the raw per-target counts are reported alongside the verdict instead of only the grade. An
   * operator looking at "9 of 9 targets, median 11 of 24 expected" can see a slow camera for what it
   * is; a bare "thin" would leave them guessing.
   */
  const fps = Number.isFinite(effectiveFps) && (effectiveFps as number) > 0 ? (effectiveFps as number) : NOMINAL_FPS;
  const expectedSamples = Math.max(1, Math.round((GAZE_DWELL_MS / 1000) * fps));
  const wellCoveredBar = Math.max(MIN_SAMPLES_PER_TARGET, Math.ceil(expectedSamples * GAZE_WELL_COVERED_FRACTION));
  const wellCovered = counts.filter((n) => n >= wellCoveredBar).length;

  const coveredCounts = counts.filter((n) => n >= MIN_SAMPLES_PER_TARGET).sort((a, b) => a - b);
  const medianSamples = coveredCounts.length === 0
    ? 0
    : coveredCounts.length % 2 === 1
      ? coveredCounts[(coveredCounts.length - 1) / 2]
      : (coveredCounts[coveredCounts.length / 2 - 1] + coveredCounts[coveredCounts.length / 2]) / 2;

  const trust: GazeTrust = !cal.valid
    ? 'unusable'
    // Two thirds of the targets must be WELL covered, mirroring the coverage rule the validity test
    // applies — the same shape of requirement, held to evidence rather than to presence.
    : wellCovered >= Math.ceil(GAZE_TARGETS.length * (2 / 3))
      ? 'good'
      : 'thin';

  return { trust, covered, wellCovered, medianSamples, expectedSamples, total: GAZE_TARGETS.length };
}

/*
 * ---------------------------------------------------------------------------------------------------
 * THE GAZE CHECK, RULE gaze-r2 (Round 80). Replaces the nine-point fit above in the routine.
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
