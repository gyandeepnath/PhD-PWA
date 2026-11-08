/**
 * ONE way of counting blinks, for the three places that show or keep a count.
 *
 * WHY THIS MODULE EXISTS (Round 80, investigator instruction 5). The investigator found the live graph,
 * the live blink count and the recorded data "inconsistent". They were computed in three places:
 *
 *   - the RECORD (07, 07b): `classifyBlinks` over the reading window's samples, against the calibrated
 *     baseline, with the cuts at EAR_TIERS x baseline;
 *   - the LIVE COUNT (researcher panel): the same `classifyBlinks` over the samples so far — but it also
 *     counted the blink still in progress at the latest frame, whose depth, and so whose complete or
 *     incomplete tier, is not known until the eye reopens. The "incomplete" figure could therefore tick
 *     up and back down within a second, and the count never matched the 07b row it would become;
 *   - the LIVE GRAPH (the card's last ten seconds, camera setup): the cut lines were drawn from
 *     EAR_TIERS directly, and no blink was marked at all, so nothing showed which dips the classifier had
 *     counted and which it had not.
 *
 * Now all three go through this module: `blinkCuts` gives the two cut lines (the graph draws them, the
 * classifier applies them, and 07 records them as ear_threshold_used and ear_complete_threshold), and
 * `countBlinks` gives the events and the counts, from `classifyBlinks` on the samples given, against the
 * baseline given. The one difference between live and final is stated, not accidental:
 *
 *   - 'final' counts every blink classifyBlinks returns, including one the window ended in the middle of
 *     (ended_by 'window_end').
 *   - 'live' leaves out the blink still in progress at the latest sample, and reports it as `inProgress`.
 *     It is counted as soon as the eye reopens — with its final depth and tier.
 *
 * Both classify by blink-r2 (blink.ts BLINK_RULE_VERSION; Round 91): a blink whose start or end is not in
 * the samples — under way at the first sample or after a sampling gap, or, in 'final', at the last — is
 * counted in `blinks` and `cut` and in neither `incomplete` nor `complete`. Under blink-r1 such a blink was
 * classified on the part in view, so a complete blink cut by the reading window's edge counted as
 * incomplete in the primary outcome (audit 86 CAM-8).
 *
 * So the live count after the last frame of a window equals the recorded count, except for a blink the
 * window ended inside, which the record counts (as cut) and the live readout had not yet.
 * tests/blinkCount.test.ts pins each of these.
 */
import { classifyBlinks, isCutBlink, EAR_TIERS, type BlinkEventDetail, type EarSample } from './blink';

/** The two cut lines, as EAR values, for an open-eye baseline. Null without a usable baseline. */
export interface BlinkCuts {
  /** A blink registers below this: EAR_TIERS.partial (0.75) x baseline. 07 ear_threshold_used. */
  registration: number;
  /** A blink is complete below this: EAR_TIERS.full (0.60) x baseline. 07 ear_complete_threshold. */
  complete: number;
}

export function blinkCuts(baseline: number | null | undefined): BlinkCuts | null {
  if (baseline == null || !Number.isFinite(baseline) || baseline <= 0) return null;
  return { registration: baseline * EAR_TIERS.partial, complete: baseline * EAR_TIERS.full };
}

export interface BlinkCount {
  /** The blinks counted, in order. */
  events: BlinkEventDetail[];
  /** All blinks counted (registered); null without a baseline (not counted is not zero). */
  blinks: number | null;
  /** Of those, incomplete — the primary outcome's numerator. Cut blinks are not in it. */
  incomplete: number | null;
  /** Of those, complete ('full' and 'micro'). Cut blinks are not in it. */
  complete: number | null;
  /** Of those, cut: start or end not observed, so not classified (blink-r2). blinks = incomplete + complete + cut. */
  cut: number | null;
  /** 'live' only: the latest sample is inside a blink that has not yet ended, and is not counted. */
  inProgress: boolean;
}

/**
 * The blinks in `samples`, against `baseline`, by blink-r2 (cut blinks counted, not classified).
 *
 * `mode` 'final' is the record's count; 'live' is the same less a blink not yet ended (see the header).
 */
export function countBlinks(samples: ReadonlyArray<EarSample>, baseline: number | null | undefined, mode: 'final' | 'live'): BlinkCount {
  if (blinkCuts(baseline) == null) return { events: [], blinks: null, incomplete: null, complete: null, cut: null, inProgress: false };
  const all = classifyBlinks(samples as EarSample[], baseline as number);
  const last = all[all.length - 1];
  const inProgress = mode === 'live' && last != null && last.ended_by === 'window_end';
  const events = inProgress ? all.slice(0, -1) : all;
  const classified = events.filter((e) => !isCutBlink(e));
  const incomplete = classified.filter((e) => e.tier === 'incomplete').length;
  return { events, blinks: events.length, incomplete, complete: classified.length - incomplete, cut: events.length - classified.length, inProgress };
}

/**
 * The live trace as the samples `countBlinks` reads: frames with a face and a finite EAR. A frame without
 * a face is a gap, exactly as the aggregator's series has no sample for it.
 */
export function traceSamples(trace: ReadonlyArray<readonly [number, number | null]>): EarSample[] {
  const out: EarSample[] = [];
  for (const [t_ms, ear] of trace) if (ear != null && Number.isFinite(ear) && Number.isFinite(t_ms)) out.push({ t_ms, ear });
  return out;
}

/** A counted blink as the live graph marks it: where its deepest frame was, and its tier. */
export interface TraceBlinkMark {
  /** Time of the deepest frame, on the same clock as the trace it was found in. */
  at: number;
  ear: number;
  complete: boolean;
}

/**
 * How much more trace is kept than the graph draws, ms (Round 82). The graph shows the last
 * CONFIG.EAR_TRACE_MS; the blinks are classified over this much more, so a blink the graph's left edge
 * cuts through is classified whole — with its true deepest frame — and not as the shallower remainder
 * that is left in view. A second is about three times a spontaneous blink (Nakamura et al. 2008: about
 * 100 ms down and 220 ms up, 320 ms in all; ledger #62). A closure longer than the lead is not marked
 * rather than marked wrongly (below).
 */
export const TRACE_LEAD_MS = 1000;

/**
 * The marks for the blinks `countBlinks` finds in a trace, live mode (a blink in progress is not marked),
 * that the graph draws: those whose deepest frame is at or after `drawnFromMs` (the graph's left edge,
 * on the trace's clock; everything when omitted).
 *
 * THE LEFT EDGE (Round 82). The trace is trimmed from the left as time passes, and a blink already under
 * way at its first sample would be classified on what is left of it — reopened there, with the depth of
 * its visible remainder — so a complete blink could be marked incomplete for a moment, against the
 * count and the record. So the classification runs over TRACE_LEAD_MS more than is drawn, and a blink in
 * progress at the very first sample kept (its start, and so its depth, is not in the trace) is not
 * marked at all: an unmarked dip, never a wrong mark. From Round 91 the same holds for a blink the trace
 * resumes inside after a gap: the count's own rule (blink-r2) leaves every such blink unclassified.
 */
export function traceBlinkMarks(
  trace: ReadonlyArray<readonly [number, number | null]>,
  baseline: number | null | undefined,
  drawnFromMs: number = -Infinity,
): TraceBlinkMark[] {
  // A cut blink — the one under way at the first sample kept, or after a gap in the trace — is not
  // marked: its tier is not known, as the count does not classify it (blink-r2).
  return countBlinks(traceSamples(trace), baseline, 'live').events
    .filter((e) => !isCutBlink(e) && e.min_at_ms >= drawnFromMs)
    .map((e) => ({ at: e.min_at_ms, ear: e.min_ear, complete: e.tier !== 'incomplete' }));
}
