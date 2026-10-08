/**
 * Which stage holds the frame rate down, read from the gaps between stored frames (Round 79).
 *
 * The investigator measured at most 23-25 frames a second. Two causes give that same average and need
 * opposite fixes:
 *
 *   - the CAMERA runs at about 25 because its exposure is long (auto-exposure lengthens frames in dim
 *     light, and avoids exposures that would show the room lights' flicker — on 50 Hz mains the step
 *     after 30 ms is 40 ms, which is 25 fps). Then almost every gap between frames is about 40 ms, and
 *     the rate can follow the screen's brightness, i.e. polarity. Fix: the exposure (cameraExposure.ts).
 *   - the camera runs at 30 but the TRACKER cannot keep up and skips frames. Then the gaps are a mix of
 *     about 33 and about 67 ms. The rate does not follow polarity. Fix: the processor (charger, cooling,
 *     other apps, the tracker choice).
 *
 * The 50 Hz step is a mechanism consistent with the report, not a measurement (ledger #61); this is
 * how the tablet's own data say which it is. Used by scripts/frameIntervals.ts on an export's
 * 07c_ear_trace.csv. Pure.
 */

/** Gap bins, ms: under 36 (about 30 fps), 36-45 (about 25), 45-55 (about 20), 55-75 (one frame skipped at 30), over 75. */
export const INTERVAL_BINS = [
  { label: '<36', lo: 0, hi: 36 },
  { label: '36-45', lo: 36, hi: 45 },
  { label: '45-55', lo: 45, hi: 55 },
  { label: '55-75', lo: 55, hi: 75 },
  { label: '>75', lo: 75, hi: Infinity },
] as const;

export type IntervalVerdict = 'camera-30' | 'camera-25' | 'tracker-skips' | 'mixed' | 'too-few';

export interface IntervalSummary {
  /** Gaps counted: consecutive processed frames that both had a face. */
  n: number;
  /** Share of gaps in each bin, in INTERVAL_BINS order. */
  shares: number[];
  medianMs: number | null;
  verdict: IntervalVerdict;
}

/** Fewer gaps than this and no verdict is given. */
export const MIN_INTERVALS = 50;

/**
 * Gaps between consecutive processed frames in which a face was found, binned. A pair with a frame
 * without a face is skipped: a lost face is not a camera or tracker interval.
 */
export function summariseIntervals(frames: Array<{ t_ms: number | null; face: boolean }>): IntervalSummary {
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (!a.face || !b.face || a.t_ms == null || b.t_ms == null) continue;
    const d = b.t_ms - a.t_ms;
    if (Number.isFinite(d) && d > 0) gaps.push(d);
  }
  const shares = INTERVAL_BINS.map((bin) => (gaps.length ? gaps.filter((g) => g >= bin.lo && g < bin.hi).length / gaps.length : 0));
  const sorted = [...gaps].sort((x, y) => x - y);
  const medianMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return { n: gaps.length, shares, medianMs, verdict: verdictOf(gaps.length, shares) };
}

function verdictOf(n: number, s: number[]): IntervalVerdict {
  if (n < MIN_INTERVALS) return 'too-few';
  const [under36, at40, , skipped] = s;
  if (at40 >= 0.5) return 'camera-25';
  if (under36 >= 0.5 && skipped < 0.15) return 'camera-30';
  if (under36 + skipped >= 0.6 && skipped >= 0.15) return 'tracker-skips';
  return 'mixed';
}

/** The verdict in words, for the investigator. */
export const VERDICT_TEXT: Record<IntervalVerdict, string> = {
  'camera-30': 'about 30 frames a second, evenly spaced',
  'camera-25': 'the camera itself runs at about 25 (frames about 40 ms apart): exposure-limited',
  'tracker-skips': 'the camera runs at about 30 and the tracker skips frames (gaps of about 33 and 67 ms)',
  mixed: 'no single pattern',
  'too-few': 'too few frames with a face to say',
};
