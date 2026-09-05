/**
 * NASA Task Load Index (Hart & Staveland, 1988) — subjective workload across six dimensions.
 *
 * Synopsis Table 3.5 lists NASA-TLX as a dependent variable, administered ONCE PER SESSION at
 * close, as a session-level index of cumulative workload. It is deliberately not administered
 * after every condition: ten administrations per participant would add substantial burden to
 * an already long protocol, and the pilot feasibility gate caps median session length at 120 min.
 *
 * The cost of that choice is stated in §4.3: workload inference is limited to the ILLUMINATION
 * contrast (the session-level factor), because polarity and colour vary within a session and a
 * single end-of-session rating cannot be attributed to any one of them.
 *
 * SCORING. This implements RAW TLX (also called RTLX): the unweighted mean of the six subscales.
 * The original instrument adds a 15-pair weighting procedure in which the participant chooses the
 * more important of every pair of dimensions. Raw TLX is used here because the weighting doubles
 * administration time for no reliable gain — the two versions correlate very highly and raw TLX
 * is at least as sensitive in most comparisons — and because the weights are not comparable
 * across participants, which matters for a between-participant moderator analysis.
 *
 * Each subscale is rated 0-100 on a 21-point scale (steps of 5), as in the original.
 */

export interface TlxDimension {
  key: TlxKey;
  label: string;
  /** Anchor labels for the low and high ends of the scale. */
  low: string;
  high: string;
  question: string;
  /**
   * True when a HIGH rating means a LOW workload contribution, so the raw response must be
   * reversed before averaging.
   *
   * No dimension is currently reversed, and Performance — the usual candidate — must not be.
   * It is anchored "Perfect" (low) to "Failure" (high), so a higher mark already means worse
   * performance and therefore MORE load: it is aligned with the other five as presented, and
   * reversing it flips a correctly-aligned subscale. The field is kept because an implementation
   * that anchored Performance the other way round (Failure low, Perfect high) would need it.
   */
  reversed: boolean;
}

export type TlxKey =
  | 'mental_demand'
  | 'physical_demand'
  | 'temporal_demand'
  | 'performance'
  | 'effort'
  | 'frustration';

export const TLX_DIMENSIONS: TlxDimension[] = [
  {
    key: 'mental_demand',
    label: 'Mental demand',
    low: 'Very low',
    high: 'Very high',
    question: 'How mentally demanding was the reading and the tasks?',
    reversed: false,
  },
  {
    key: 'physical_demand',
    label: 'Physical demand',
    low: 'Very low',
    high: 'Very high',
    question: 'How physically demanding was it — holding position, tapping, eye movement?',
    reversed: false,
  },
  {
    key: 'temporal_demand',
    label: 'Temporal demand',
    low: 'Very low',
    high: 'Very high',
    question: 'How hurried or rushed was the pace of the session?',
    reversed: false,
  },
  {
    key: 'performance',
    label: 'Performance',
    low: 'Perfect',
    high: 'Failure',
    /**
     * The original wording. The previous phrasing — "How successful were you in doing what you were
     * asked to do?" — reads so that MORE is better, while the anchors put better at the left. A
     * participant answering the question rather than reading the anchors marked in the opposite
     * direction from one who read them, which is a between-participant sign flip on a single item.
     */
    question: 'How successful were you in accomplishing what you were asked to do? How satisfied were you with your performance?',
    /**
     * NOT reversed. This subscale runs Perfect(0) to Failure(100), so the mark as given is already
     * in the load direction, and Raw TLX is the unweighted mean of the six ratings AS MARKED.
     *
     * It used to be true, and the effect was a sign flip on one of six subscales. A participant
     * who marked 10 — near "Perfect" — contributed 90, near-maximal load: precisely the outcome
     * the comment on tlxContribution() said reversal existed to prevent. Worse than an offset:
     * if a condition genuinely degraded performance, marks moved toward Failure, the contribution
     * moved DOWN, and raw_tlx moved down with it — masking the very effect the instrument is here
     * to detect.
     */
    reversed: false,
  },
  {
    key: 'effort',
    label: 'Effort',
    low: 'Very low',
    high: 'Very high',
    question: 'How hard did you have to work to reach your level of performance?',
    reversed: false,
  },
  {
    key: 'frustration',
    label: 'Frustration',
    low: 'Very low',
    high: 'Very high',
    question: 'How insecure, discouraged, irritated, stressed or annoyed were you?',
    reversed: false,
  },
];

/** Scale bounds and granularity, matching the original 21-point (0-100 by 5s) presentation. */
export const TLX_MIN = 0;
export const TLX_MAX = 100;
export const TLX_STEP = 5;

export type TlxRatings = Record<TlxKey, number>;

/**
 * The load contribution of one subscale: the rating as marked, unless the dimension declares that
 * its high end means LOW load. With the anchors used here, none does — see the `reversed` note on
 * the Performance dimension.
 */
export function tlxContribution(dim: TlxDimension, rating: number): number {
  // Clamp into the scale. The slider cannot produce an out-of-range value, but a stored record
  // can be corrupted or imported, and an unclamped NaN or Infinity here propagates into raw_tlx -
  // a single bad subscale would silently take the whole workload index with it.
  const r = Number.isFinite(rating) ? Math.min(TLX_MAX, Math.max(TLX_MIN, rating)) : TLX_MIN;
  return dim.reversed ? TLX_MAX - r : r;
}

export interface TlxScore {
  /** Raw TLX: unweighted mean of the six load-aligned subscales, 0-100. */
  raw_tlx: number;
  /** Per-dimension responses exactly as given, before reversal. */
  ratings: TlxRatings;
  /** Per-dimension load contributions after reversing Performance. */
  contributions: TlxRatings;
}

export function scoreTlx(ratings: TlxRatings): TlxScore {
  const contributions = {} as TlxRatings;
  for (const d of TLX_DIMENSIONS) {
    contributions[d.key] = tlxContribution(d, ratings[d.key]);
  }
  const vals = TLX_DIMENSIONS.map((d) => contributions[d.key]);
  return {
    raw_tlx: vals.reduce((s, v) => s + v, 0) / vals.length,
    ratings,
    contributions,
  };
}

/** Midpoint default; the UI tracks which sliders were actually touched (see `touched`). */
export function defaultTlxRatings(): TlxRatings {
  const r = {} as TlxRatings;
  for (const d of TLX_DIMENSIONS) r[d.key] = 50;
  return r;
}
