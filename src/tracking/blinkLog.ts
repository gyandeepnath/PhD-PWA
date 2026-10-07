/**
 * Every blink of a reading window, and the eye-openness trace it was found in (Round 78).
 *
 * WHY. Until now only per-condition totals were kept: 07_eye_metrics.csv says a condition had 41
 * blinks of which 9 were incomplete, and nothing says which 41. That is enough for the main analysis
 * and not enough to check it. The validation sub-study compares the classifier with a human coder
 * BLINK BY BLINK (detection F1, complete/incomplete kappa), and a reviewer who asks "what if the
 * completeness cut were 0.55?" needs the depth of every blink — neither is possible from a total.
 *
 * WHAT IS KEPT, per reading window:
 *  - each blink: onset, end, deepest point, length in frames and ms, depth (absolute and as a fraction
 *    of the baseline), tier, the frame rate around it, the page on screen, and the rule version;
 *  - each processed frame: its capture time, whether a face was found, and each eye's EAR.
 *
 * WHAT IT IS NOT. Nothing here changes how a blink is counted. The events are the SAME array the
 * eye-metrics row's counts come from (aggregator.finalizeWithEvents), and the integrity audit checks
 * the two agree. The main analysis and both templates read only 07_eye_metrics.csv; these records
 * export as two separate files (07b, 07c) that the analysis never needs.
 *
 * STORED COMPACTLY. One text column per channel, one value per frame, rounded to what the camera can
 * resolve: time to 0.01 ms, EAR to 6 decimals (landmark noise is in the second or third). A
 * ten-condition sitting is about 1.5 MB (docs/ANALYSIS_PLAN.md §5.7 gives the measured figure).
 */
import type { BlinkEventDetail, EarSample } from './blink';
import { BLINK_RULE_VERSION } from './blink';
import type { EarTraceColumns, OcularEventsRecord, StoredBlinkEvent } from '@/storage/types';

/** How far either side of a blink's deepest sample its local frame rate is measured. */
export const LOCAL_FPS_HALF_WINDOW_MS = 1000;

/** The trace as the aggregator collects it: one entry per processed frame, in capture order. */
export interface TraceBuffer {
  t: number[];
  face: boolean[];
  left: (number | null)[];
  right: (number | null)[];
}

export function emptyTrace(): TraceBuffer {
  return { t: [], face: [], left: [], right: [] };
}

/** A number as text at `dp` decimals, trailing zeros dropped; '' for anything not finite. */
function fmt(x: number | null | undefined, dp: number): string {
  if (x == null || !Number.isFinite(x)) return '';
  const v = Number(x.toFixed(dp));
  return String(Object.is(v, -0) ? 0 : v);
}

const round = (x: number, dp: number) => Number(x.toFixed(dp));

/**
 * Face-solved frames per second within LOCAL_FPS_HALF_WINDOW_MS either side of `at`.
 *
 * A blink's depth is only as good as the sampling around its minimum: at 15 fps the deepest frame is
 * likelier to be missed than at 30. The condition's effective_fps is an average over three minutes,
 * and a stretch of slow frames can sit inside a condition whose average looks fine, so each blink
 * carries its own. Null when fewer than two samples fall in the window.
 */
export function localFps(series: EarSample[], at: number): number | null {
  let first: number | null = null;
  let last: number | null = null;
  let n = 0;
  for (const s of series) {
    if (s.t_ms < at - LOCAL_FPS_HALF_WINDOW_MS) continue;
    if (s.t_ms > at + LOCAL_FPS_HALF_WINDOW_MS) break;
    if (first == null) first = s.t_ms;
    last = s.t_ms;
    n++;
  }
  if (n < 2 || first == null || last == null || last <= first) return null;
  return ((n - 1) / (last - first)) * 1000;
}

/**
 * The page on screen at time `t` (absolute), from page marks [time, page]. The first mark covers
 * anything before it: the window opens on page 1, and a frame captured a few ms before the tap that
 * opened it is still page 1. Null when no page was ever marked.
 */
export function pageAt(marks: Array<[number, number]>, t: number): number | null {
  if (marks.length === 0) return null;
  let page = marks[0][1];
  for (const [mt, p] of marks) {
    if (mt <= t) page = p;
    else break;
  }
  return page;
}

/** The trace as stored: comma-separated columns, one value per frame. */
export function encodeTrace(buf: TraceBuffer, t0: number | null): EarTraceColumns {
  const n = buf.t.length;
  return {
    frames: n,
    t: buf.t.map((t) => fmt(t0 == null ? null : t - t0, 2)).join(','),
    face: buf.face.map((f) => (f ? '1' : '0')).join(''),
    left: buf.left.map((v) => fmt(v, 6)).join(','),
    right: buf.right.map((v) => fmt(v, 6)).join(','),
  };
}

export interface TraceRow {
  /** 1-based frame number within the window. */
  frame: number;
  t_ms: number | null;
  face: boolean;
  left: number | null;
  right: number | null;
  /** Mean of both eyes, the value the classifier compares with its cuts; null unless both eyes measured. */
  ear: number | null;
}

/**
 * Decode a stored trace. A column shorter than `frames` — a damaged or hand-edited record — yields
 * nulls for the missing frames rather than shifting values onto the wrong frame.
 */
export function decodeTrace(c: EarTraceColumns): TraceRow[] {
  const n = c.frames;
  if (!(n > 0)) return [];
  const nums = (s: string) => s.split(',').map((x) => (x === '' ? null : Number(x)));
  const t = nums(c.t);
  const l = nums(c.left);
  const r = nums(c.right);
  const rows: TraceRow[] = [];
  for (let i = 0; i < n; i++) {
    const left = l[i] ?? null;
    const right = r[i] ?? null;
    rows.push({
      frame: i + 1,
      t_ms: t[i] ?? null,
      face: c.face[i] === '1',
      left, right,
      ear: left != null && right != null && Number.isFinite(left) && Number.isFinite(right) ? (left + right) / 2 : null,
    });
  }
  return rows;
}

/**
 * Build the stored record from what the aggregator held when the window closed.
 *
 * `events` must be the array the eye-metrics row was summarised from; `series` is the face-solved EAR
 * series they were found in (for the local frame rate).
 */
export function buildOcularEventsRecord(args: {
  conditionId: string;
  sessionId: string;
  baseline: number | null;
  events: BlinkEventDetail[];
  series: EarSample[];
  trace: TraceBuffer;
  pageMarks: Array<[number, number]>;
}): OcularEventsRecord {
  const { trace, pageMarks, series, baseline } = args;
  const t0 = trace.t.length ? trace.t[0] : pageMarks.length ? pageMarks[0][0] : null;
  const rel = (t: number) => (t0 == null ? t : round(t - t0, 2));
  const events: StoredBlinkEvent[] = args.events.map((e) => ({
    onset_ms: rel(e.onset_ms),
    offset_ms: rel(e.offset_ms),
    min_at_ms: rel(e.min_at_ms),
    duration_ms: round(e.duration_ms, 2),
    frames_below: e.frames_below,
    ended_by: e.ended_by,
    min_ear: e.min_ear,
    // An event exists only when a baseline did (classifyBlinks returns none without one).
    min_ear_ratio: baseline != null && baseline > 0 ? e.min_ear / baseline : null,
    tier: e.tier,
    local_fps: (() => { const f = localFps(series, e.min_at_ms); return f == null ? null : round(f, 2); })(),
    page: pageAt(pageMarks, e.onset_ms),
  }));
  return {
    condition_id: args.conditionId,
    session_id: args.sessionId,
    window: 'reading',
    rule_version: BLINK_RULE_VERSION,
    ear_baseline: baseline,
    start_capture_ms: t0,
    pages: pageMarks.map(([t, p]) => [rel(t), p] as [number, number]),
    events,
    trace: encodeTrace(trace, t0),
  };
}

/** Blink counts by tier, in the shape of the eye-metrics row's three count columns. */
export function tierCounts(events: { tier: string }[]): { full: number; micro: number; incomplete: number } {
  return {
    full: events.filter((e) => e.tier === 'full').length,
    micro: events.filter((e) => e.tier === 'micro').length,
    incomplete: events.filter((e) => e.tier === 'incomplete').length,
  };
}
