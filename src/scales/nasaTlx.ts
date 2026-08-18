/**
 * NASA Task Load Index (Hart & Staveland, 1988) — subjective workload across six dimensions.
 *
 * Synopsis Table 3.5 lists NASA-TLX as a dependent variable, administered ONCE PER SESSION at
 * close, as a session-level index of cumulative workload. It is deliberately not administered
 * after every condition: twenty administrations per participant would add substantial burden to
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
   * reversed before averaging. Performance is the only such dimension: the original anchors it
   * "Perfect" to "Failure", i.e. good performance sits at the low-numbered end.
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
    question: 'How successful were you in doing what you were asked to do?',
    reversed: true,
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
 * Reverse the Performance subscale so every dimension points the same way (higher = more load).
 * Reporting a raw Performance rating alongside the others, as some implementations do, makes the
 * overall index incoherent: a participant who performed perfectly would look maximally loaded.
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
