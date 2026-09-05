/**
 * Experiment timing & task configuration.
 *
 * Values are the bundle's authoritative numbers where known, with the audit refinements applied
 * (longer adaptation on polarity switch; neutral RT background; reading as a per-page minimum
 * floor rather than a hard cutoff). All are centralised here so a protocol change is one edit.
 */
const BASE_CONFIG = {
  /**
   * Inclusion age band, from the protocol. Named here rather than written inline so the profile
   * form's gate, the eligibility computation and the exported codebook cannot drift apart — which
   * they had: the code accepted 18 to 80 while the synopsis and the codebook both said 18 to 35.
   */
  MIN_AGE: 18,
  MAX_AGE: 35,

  // Reading: per-page minimum dwell (rAF-gated). The Next button unlocks after this; the
  // participant may take longer (self-paced). reading_time_ms is recorded.
  READING_PAGE_MIN_MS: 20000,
  READING_FONT_SIZE_PX: 22,
  READING_LINE_HEIGHT: 1.6,
  READING_MARGIN_PERCENT: 10,

  // Comprehension: post-answer feedback dwell.
  /**
   * Post-answer dwell. ZERO: the comprehension screen must not tell the participant whether they
   * were right.
   *
   * It used to hold for a second while outlining the correct option green and the chosen one red.
   * That is performance feedback, delivered 30 times, once per condition, across the whole protocol, and the
   * protocol forbids it in five separate places — the synopsis rests the whole no-differential-
   * effort argument on its absence, and the operator manual forbids the OPERATOR from saying
   * exactly what the screen was showing. It also biased effort in a way correlated with earlier
   * luck rather than with the display, and the marker colours were hard-coded, so they were 4.5x
   * more visible in negative polarity and near-invisible against the red and green inks.
   *
   * Kept as a named constant at 0 rather than deleted so the intent is explicit and a future edit
   * cannot reintroduce it by accident.
   */
  COMPREHENSION_FEEDBACK_MS: 0,

  // Visual search: hard time limit.
  VS_TIME_LIMIT_MS: 40000,

  // Reaction time — pure colour go/no-go (one dot at a random location; respond only to the target
  // colour), run under the active display condition. Tuned for fatigue/attention-stability goals.
  RT_TRIALS_PER_CONDITION: 32,
  /** Proportion of go (target-colour) trials. 0.625 → 20 go / 12 no-go per condition. */
  RT_GO_RATE: 0.625,
  /** Unscored practice trials shown once, before the first condition's scored block. */
  RT_PRACTICE_TRIALS: 6,
  /** Max time to respond; the trial ends the instant a response is made (only no-go trials wait it out). */
  RT_RESPONSE_WINDOW_MS: 1000,
  /**
   * Fixation is now a FIXED duration and the anticipation-resistant randomness lives entirely in
   * the delay below. Splitting the foreperiod across two uniform draws was what made it
   * anticipatable: see src/lib/foreperiod.ts.
   */
  RT_FIXATION_MIN_MS: 400,
  RT_FIXATION_MAX_MS: 400,
  /**
   * Foreperiod delay, drawn from a truncated exponential rather than a uniform, so its hazard is
   * flat and waiting tells the participant nothing about when the dot will arrive. On the previous
   * uniform 400-900 ms the chance of onset within the next 100 ms rose from 5% to 100% across the
   * range; RT then depended on trial timing, in a study that attributes RT to the display.
   *
   * The mean total foreperiod is preserved at about 1.02 s, so block duration is unchanged.
   */
  RT_DELAY_MIN_MS: 300,
  RT_DELAY_MAX_MS: 1600,
  RT_DELAY_MEAN_MS: 650,
  /**
   * Longest permitted run of consecutive go or no-go trials. A run of six or seven gos primes a
   * response hard enough that the next no-go draws a false alarm which says more about the run than
   * about the display.
   */
  RT_MAX_RUN: 3,
  RT_ITI_MIN_MS: 300,
  RT_ITI_MAX_MS: 500,
  RT_DOT_PX: 52,
  /** Responses faster than this (ms) are anticipations — excluded from RT means, counted separately. */
  RT_MIN_VALID_RT_MS: 150,
  /** Valid hits slower than this (ms) count as attention lapses (PVT-style). */
  RT_LAPSE_THRESHOLD_MS: 600,
  /**
   * Go-target: ACHROMATIC, defined relative to the active background — black on light fields,
   * white on dark ones (synopsis §3.6). Target contrast is therefore maximal (21:1) and
   * IDENTICAL in both polarities, so target salience does not vary with display condition and
   * no target hue coincides with the text-colour manipulation.
   *
   * This replaced a fixed green target, which was justified as "the only colour not used by any
   * display condition" — a justification that expired the moment green was added as a fifth text
   * colour. Leaving it would have made the go-target collide with conditions P5/N5, confounding
   * go-signal detectability with the colour factor.
   *
   * The discrimination becomes achromatic-against-chromatic rather than hue-against-hue. That is
   * an easier discrimination, but it preserves the two fatigue-sensitive indices the task exists
   * to measure: reaction-time variability and lapse rate.
   */
  RT_TARGET_LIGHT_BG: '#000000',
  RT_TARGET_DARK_BG: '#FFFFFF',
  /**
   * Distractors: LUMINANCE-MATCHED, for the same reason the target is background-relative.
   *
   * The target was contrast-matched and the distractors were not, which fixed the wrong half of the
   * problem: what the participant actually performs is a DISCRIMINATION, and its difficulty is set
   * by the distractor-to-target separation, not by the target alone. With the old set — the four
   * chromatic text colours — that separation was, measured against the achromatic target:
   *
   *     on white (target black)   red 3.66  blue 3.14  yellow 8.79  green 6.57   mean 5.54
   *     on black (target white)   red 5.74  blue 6.70  yellow 2.39  green 3.19   mean 4.50
   *
   * The ordering is exactly reversed between polarities and the mean separation is ~23% larger in
   * positive polarity — so no-go discriminability was a function of the study's primary factor. On
   * a black field the yellow distractor sat 2.39:1 from the white target, which is a hue judgement
   * on a small peripheral dot. (An earlier version rested this on the 10 lux condition; that level
   * has been withdrawn, and the rank-reversal arithmetic above holds at any illuminance.) That
   * inflates false alarms in negative polarity, lowers
   * d-prime there, and — because false_alarm_rate and error_rate drive the disengagement flag —
   * ALSO gets negative-polarity conditions preferentially dropped by the quality filter. A
   * manufactured polarity effect plus differential attrition on the same factor.
   *
   * conditions.ts already sets out the arithmetic that makes this unavoidable for any fixed set:
   * contrast against white is 1.05/(L+0.05) while contrast against black is (L+0.05)/0.05, so the
   * rank correlation between the two polarities is exactly -1 for ANY palette.
   *
   * The escape is a palette whose members sit at the luminance where BOTH expressions give the
   * same value. At relative luminance 0.178 every hue separates ~4.55:1 from black and ~4.6:1 from
   * white, so one set serves both polarities and every hue is equally discriminable from the
   * target. These are those colours, keeping the original red/blue/yellow/green hue directions.
   */
  RT_DISTRACTOR_COLORS: ['#E42222', '#2869FF', '#8D7300', '#008742'],

  // Adaptation: longer than the original 20 s; doubled on a polarity switch.
  ADAPTATION_SAME_POLARITY_MS: 60000,
  ADAPTATION_SWITCH_POLARITY_MS: 120000,
  ADAPTATION_COLOR: '#808080',

  // Boredom mitigation: a self-paced rest break is offered after every N completed conditions
  // (but never after the last condition of the sitting). Keeps participants fresh without giving
  // any performance feedback that could differentially change effort across conditions.
  BREAK_EVERY_N_CONDITIONS: 2,
  /**
   * Conditions per sitting within ONE illumination block: 10 = the whole block in one sitting,
   * 5 = split into two shorter sittings. The pilot feasibility gate (§3.6) decides which: if the
   * median session runs over 120 min, or withdrawals exceed 1 in 10, or face-presence drops below
   * 0.90 in more than 10% of runs, the ten conditions are split into two sittings of five.
   *
   * THE SPLIT PRESERVES SERIAL-POSITION BALANCE BUT NOT CARRYOVER BALANCE. An earlier version of
   * this comment claimed it preserved "the counterbalancing scheme", and that was false in a
   * specific and consequential way.
   *
   * A split sitting runs positions 0-4, then positions 5-9 days later, so the 4->5 adjacency never
   * occurs in time. In the Williams square that boundary pair always has condition indices
   * differing by 5 — and c and c+5 are the SAME COLOUR IN OPPOSITE POLARITY by construction
   * (0..4 = P1..P5, 5..9 = N1..N5). Enumerated over 130 participants x 2 blocks: a single sitting
   * observes all 90 ordered pairs 26 times each; a 5/5 split observes 80 of them 26 times and the
   * other ten exactly ZERO times — P1->N1, N1->P1, P2->N2, ... P5->N5, N5->P5. Not degraded,
   * eliminated, for every participant in the cohort.
   *
   * Those ten are precisely the transitions the Williams square is justified by: the polarity
   * switch at MATCHED HUE, the only adjacency that isolates the light-adaptation transient from a
   * hue change. Under the split protocol the first-order carryover term cannot be estimated for
   * them at all.
   *
   * The gap is now explicit in the data rather than silent: `predecessor_condition_label` is empty
   * at a sitting boundary, so the structural missingness is visible to the analyst instead of
   * being inferred from `conditions_per_session`.
   *
   * A FIX EXISTS AND IS NOT APPLIED. Rotating the split point by enrolment (4/6, 5/5, 6/4 as
   * (enrolment-1) mod 3) restores all 90 pairs at counts 16-26. It is not applied because it makes
   * sitting length vary per participant, which changes the resume path and the operator's
   * expectations — a protocol decision, not an implementation detail. Take it before the split
   * protocol is ever switched on.
   */
  CONDITIONS_PER_SESSION_DEFAULT: 10,

  /**
   * Length of one retained reading-video segment for the manual blink-annotation sub-study.
   *
   * The synopsis specifies two 3-minute segments per participant in the validation subsample. That
   * used to be one per ILLUMINATION LEVEL, which meant one segment per session; with a single level
   * and a single sitting, sampling that way would have HALVED the annotated volume to about 60
   * minutes and 600-750 blink events, and the kappa >= 0.60 acceptability criterion is set against
   * the larger figure. The two segments are therefore now one per POLARITY, taken within the one
   * sitting: the total is preserved, and the classifier is validated across the factor that most
   * changes what the camera sees. Synopsis section 3.5.
   */
  ANNOTATION_SEGMENT_MS: 180000,

  // Camera.
  CAMERA_WIDTH: 1280,
  CAMERA_HEIGHT: 720,
  /**
   * Frame rate REQUESTED from the camera. Deliberately above FPS_RATIO_THRESHOLD (30), the rate the
   * primary outcome needs: an achieved rate always sits a little below the requested one, so asking
   * for exactly 30 would leave every condition in the study below the gate and the gate carrying no
   * information. Devices that cannot deliver 60 fall back to whatever they can, which is recorded
   * per condition as effective_fps.
   */
  CAMERA_FPS: 60,
  // Process every camera frame: blinks last 100-400 ms, so ~30 fps is the literature minimum for
  // valid blink detection (sub-Nyquist below ~25 fps). Raise to 2 only if a slow tablet can't keep
  // up — effective_fps records the true achieved rate and gates the duration-based tiers.
  PROCESS_EVERY_N_FRAMES: 1,
};

/**
 * True when running under the E2E harness (?e2e=1) — collapses long waits for fast tests.
 *
 * Exported, because a run with collapsed timing must be identifiable in the DATA. Every duration in
 * the protocol — the reading floor, the adaptation field, the search limit, the RT block — is
 * replaced with a token value, and nothing on screen, in the session record or in the export said
 * so. A tablet left on a bookmarked ?e2e URL would have produced a full, plausible, exportable
 * session whose every timing constant was wrong, and it would have pooled with real data.
 */
export function isE2ETimingActive(): boolean {
  return isE2E();
}

function isE2E(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');
  } catch {
    return false;
  }
}

/** Shortened timings/trial counts for E2E. Identical structure to BASE_CONFIG. */
const E2E_OVERRIDES: Partial<typeof BASE_CONFIG> = {
  READING_PAGE_MIN_MS: 150,
  COMPREHENSION_FEEDBACK_MS: 120,
  VS_TIME_LIMIT_MS: 5000,
  RT_TRIALS_PER_CONDITION: 4,
  RT_PRACTICE_TRIALS: 1,
  RT_RESPONSE_WINDOW_MS: 120,
  RT_FIXATION_MIN_MS: 30,
  RT_FIXATION_MAX_MS: 30,
  RT_DELAY_MIN_MS: 20,
  RT_DELAY_MAX_MS: 60,
  RT_DELAY_MEAN_MS: 30,
  RT_ITI_MIN_MS: 20,
  RT_ITI_MAX_MS: 30,
  ADAPTATION_SAME_POLARITY_MS: 200,
  ADAPTATION_SWITCH_POLARITY_MS: 300,
  ANNOTATION_SEGMENT_MS: 400,
};

export const CONFIG = isE2E() ? { ...BASE_CONFIG, ...E2E_OVERRIDES } : BASE_CONFIG;

/** Number of measured sub-stages per condition (excludes ADAPTATION). */
export const TASKS_PER_CONDITION = 6;
