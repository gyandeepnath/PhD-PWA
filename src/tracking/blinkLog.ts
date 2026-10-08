/**
 * Every blink of a reading window, and the eye-openness trace it was found in (Round 78).
 *
 * WHY. Until now only per-condition totals were kept: 07_eye_metrics.csv says a condition had 41
 * blinks of which 9 were incomplete, and nothing says which 41. That is enough for the main analysis
 * and not enough to check it. The validation sub-study compares the classifier with a human coder
 * BLINK BY BLINK (detection F1, complete/incomplete kappa), and a reviewer who asks "what if the
 * completeness cut were 0.55?" needs the depth of every blink — neither is possible from a total.
 *
 * WHAT IS KEPT, per reading window (and for the camera self-test's cued blinks, the closed-eye
 * reference — see OcularEventsRecord):
 *  - each blink: onset, end, deepest point, length in frames and ms, depth (absolute, as a fraction
 *    of the baseline, and against the open eye just before it), each eye's own depth, the worst
 *    sampling gap across it, the head pose at its deepest frame, tier, the frame rate around it, the
 *    page on screen, and the rule version (R2 §G lists why each is there);
 *  - each processed frame: its capture time, whether a face was found, and each eye's EAR.
 *
 * WHAT IT IS NOT. Nothing here changes how a blink is counted. The events are the SAME array the
 * eye-metrics row's counts come from (aggregator.finalizeWithEvents), and the integrity audit checks
 * the two agree. The main analysis and both templates read only 07_eye_metrics.csv; these records
 * export as two separate files (07b, 07c) that the analysis never needs.
 *
 * STORED COMPACTLY. One text column per channel, one value per frame, rounded to what the camera can
 * resolve: time to 0.01 ms, EAR to 6 decimals (landmark noise is in the second or third). A
 * ten-condition sitting is about 1.5 MB (docs/ANALYSIS_PLAN.md §5 item 6 gives the measured figure).
 */
import type { BlinkEventDetail, EarSample } from './blink';
import { BLINK_RULE_VERSION, EAR_TIERS } from './blink';
import { fitBlinkMinimum, FIT_RULE_VERSION, type BlinkFit } from './blinkFit';
import type { EarTraceColumns, OcularEventsRecord, StoredBlinkEvent } from '@/storage/types';

/** How far either side of a blink's deepest sample its local frame rate is measured. */
export const LOCAL_FPS_HALF_WINDOW_MS = 1000;

/**
 * The open eye just before a blink: the median of the open frames (at or above the registration cut)
 * in the OPEN_PRE_WINDOW_MS before onset, given at least OPEN_PRE_MIN_FRAMES of them.
 *
 * WHY. Every depth in this study is a fraction of ONE baseline, fitted at calibration while the
 * participant looked at the centre of the screen. The open-eye EAR moves with gaze (looking down a page
 * lowers the upper lid) and with fatigue, so the same blink reads deeper against the calibration
 * baseline at the foot of a page than at its head (R1 §3.1a). Depth against the eye's own open level
 * a moment earlier separates the two. One second is short enough to sit at the same place on the page,
 * long enough to hold several frames at 15 fps; five frames is the open level the R2 simulation's
 * template fit used. It is a validation number: nothing is classified on it.
 */
export const OPEN_PRE_WINDOW_MS = 1000;
export const OPEN_PRE_MIN_FRAMES = 5;

/**
 * One face-solved sample as the aggregator keeps it: the classifier's (t_ms, ear), plus each eye and
 * the head pose of the same frame, which only the stored blink record reads.
 */
export interface DetailSample extends EarSample {
  left: number | null;
  right: number | null;
  pitch: number | null;
  yaw: number | null;
}

/**
 * The key a stored blink record is filed under: the condition_id for a reading window (so a redo of the
 * condition replaces it, as it replaces the eye-metrics row), and 'selftest:' + session_id for the
 * camera self-test (so a retried test replaces the earlier attempt, as the session's selftest_* do).
 */
export function ocularRecordId(window: 'reading' | 'selftest', id: string): string {
  return window === 'reading' ? id : `selftest:${id}`;
}

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

/** First index whose sample is at or after `t` (the series is in capture order). */
function lowerBound(series: EarSample[], t: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t_ms < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const finiteOrNull = (x: number | null | undefined): number | null => (x != null && Number.isFinite(x) ? x : null);

/**
 * What the stored record adds to a classified blink (R2 §G), measured on the series it was found in.
 *
 * The frames of a blink are those from its onset sample up to the last one below the registration cut:
 * the sample before its offset when the eye reopened, the offset sample itself when the window ended
 * first (BlinkEventDetail.ended_by). Each field is null, never a guess, when its frames are not there.
 */
export function blinkDetail(series: DetailSample[], e: BlinkEventDetail, baseline: number | null): {
  min_ear_left: number | null;
  min_ear_right: number | null;
  open_pre: number | null;
  max_gap_ms: number | null;
  pitch_at_min: number | null;
  yaw_at_min: number | null;
} {
  const none = { min_ear_left: null, min_ear_right: null, open_pre: null, max_gap_ms: null, pitch_at_min: null, yaw_at_min: null };
  const i0 = lowerBound(series, e.onset_ms);
  const i1 = lowerBound(series, e.offset_ms);
  if (series[i0]?.t_ms !== e.onset_ms || series[i1]?.t_ms !== e.offset_ms) return none;
  const last = e.ended_by === 'reopened' ? i1 - 1 : i1;

  let minL: number | null = null;
  let minR: number | null = null;
  for (let k = i0; k <= last; k++) {
    const { left, right } = series[k];
    if (left != null && (minL == null || left < minL)) minL = left;
    if (right != null && (minR == null || right < minR)) minR = right;
  }

  // From the sample before onset (when there is one) to the offset sample: the descent, the minimum and
  // the reopening are each sampled only as finely as the widest interval among these.
  // Interval k is series[k-1] -> series[k]; starting at i0 takes in the step from the sample before
  // onset, and a blink at the very first sample simply has no such step.
  let gap: number | null = null;
  for (let k = Math.max(1, i0); k <= i1; k++) {
    const d = series[k].t_ms - series[k - 1].t_ms;
    if (gap == null || d > gap) gap = d;
  }

  let openPre: number | null = null;
  if (baseline != null && Number.isFinite(baseline) && baseline > 0) {
    const cut = baseline * EAR_TIERS.partial;
    const open: number[] = [];
    for (let k = lowerBound(series, e.onset_ms - OPEN_PRE_WINDOW_MS); k < i0; k++) {
      if (series[k].ear >= cut) open.push(series[k].ear);
    }
    if (open.length >= OPEN_PRE_MIN_FRAMES) openPre = medianOf(open);
  }

  const atMin = series[lowerBound(series, e.min_at_ms)];
  const onMin = atMin && atMin.t_ms === e.min_at_ms ? atMin : null;
  const r = (x: number | null | undefined, dp: number) => { const v = finiteOrNull(x); return v == null ? null : round(v, dp); };
  return {
    min_ear_left: r(minL, 6),
    min_ear_right: r(minR, 6),
    open_pre: r(openPre, 6),
    max_gap_ms: r(gap, 2),
    pitch_at_min: r(onMin?.pitch, 1),
    yaw_at_min: r(onMin?.yaw, 1),
  };
}

/**
 * The fitted minimum (blinkFit.ts, rule fit-r1) of each blink, in the order of `events`: the lid's
 * deepest point estimated between frames, from the frames around the lowest one and the open eye just
 * before it (open_pre). Null for a blink that cannot be fitted (no open_pre, too few frames, a gap).
 *
 * A SENSITIVITY measure only (docs/ANALYSIS_PLAN.md §5): nothing is classified on it. `exposureMs` is the
 * camera exposure the fit assumes — the fixed exposure when camera setup set one, otherwise the frame
 * interval (see fitExposure).
 */
export function fitBlinks(series: DetailSample[], events: BlinkEventDetail[], baseline: number | null, exposureMs: number): Array<BlinkFit | null> {
  return events.map((e) => {
    const i = lowerBound(series, e.min_at_ms);
    if (series[i]?.t_ms !== e.min_at_ms) return null;
    const open = blinkDetail(series, e, baseline).open_pre;
    return open == null ? null : fitBlinkMinimum(series, i, open, exposureMs);
  });
}

/**
 * The exposure the fitted minimum assumes, ms, and whether it is known. Known when camera setup fixed the
 * exposure and the camera reported it (exposure_time_100us, in 100 µs units). Otherwise the frame interval
 * at the observed rate: the exposure-limited case, which is when the camera runs slowest and the fit
 * matters most. An assumed exposure can over- or under-correct (docs/FPS_GATE_SIMULATION.md §C), so the
 * analysis plan reads the fitted counts of the two kinds apart.
 */
export function fitExposure(lockedExposure100us: number | null | undefined, samplingFps: number | null): { ms: number; known: boolean } {
  if (lockedExposure100us != null && Number.isFinite(lockedExposure100us) && lockedExposure100us > 0) {
    // Never longer than a frame: a camera cannot expose a frame for longer than the interval it delivers it in.
    const ms = lockedExposure100us / 10;
    return { ms: samplingFps != null && samplingFps > 0 ? Math.min(ms, 1000 / samplingFps) : ms, known: true };
  }
  return { ms: samplingFps != null && samplingFps > 0 ? 1000 / samplingFps : 0, known: false };
}

/**
 * Incomplete blinks by the fitted minimum: a blink counts as incomplete when its fitted depth is at or
 * above the completeness cut (0.60 x baseline), and a blink that could not be fitted keeps the class the
 * primary rule gave it — so the count covers the same blinks as blink_count_incomplete and only the
 * fitted ones can move. `notFitted` says how many kept their primary class.
 */
export function fittedIncompleteCount(events: BlinkEventDetail[], fits: Array<BlinkFit | null>, baseline: number | null): { incomplete: number | null; notFitted: number } {
  if (baseline == null || !Number.isFinite(baseline) || baseline <= 0) return { incomplete: null, notFitted: events.length };
  let incomplete = 0;
  let notFitted = 0;
  events.forEach((e, k) => {
    const f = fits[k];
    if (f) { if (f.min_ear / baseline >= EAR_TIERS.full) incomplete++; }
    else { notFitted++; if (e.tier === 'incomplete') incomplete++; }
  });
  return { incomplete, notFitted };
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
 * `events` must be the array the eye-metrics row was summarised from (for the self-test, the array it
 * was scored from); `series` is the face-solved series they were found in, for the local frame rate
 * and the per-blink detail.
 */
export function buildOcularEventsRecord(args: {
  /** Which window: a condition's reading window (the default) or the camera self-test. */
  window?: 'reading' | 'selftest';
  /** The condition, for a reading window; ignored for the self-test, which belongs to none. */
  conditionId: string | null;
  sessionId: string;
  baseline: number | null;
  events: BlinkEventDetail[];
  series: DetailSample[];
  trace: TraceBuffer;
  pageMarks: Array<[number, number]>;
  /** The self-test's cue times (performance.now()). */
  cues?: number[];
  /** The fitted minimum of each blink (fitBlinks), in the order of `events`, and the exposure it assumed; absent: not fitted. */
  fits?: Array<BlinkFit | null>;
  fitExposure?: { ms: number; known: boolean };
}): OcularEventsRecord {
  const { trace, pageMarks, series, baseline } = args;
  const window = args.window ?? 'reading';
  if (window === 'reading' && !args.conditionId) throw new Error('a reading-window blink record needs its condition_id');
  const t0 = trace.t.length ? trace.t[0] : pageMarks.length ? pageMarks[0][0] : null;
  const rel = (t: number) => (t0 == null ? t : round(t - t0, 2));
  const events: StoredBlinkEvent[] = args.events.map((e, k) => {
    const d = blinkDetail(series, e, baseline);
    const fit = args.fits?.[k] ?? null;
    // An event exists only when a baseline did (classifyBlinks returns none without one).
    const ratio = baseline != null && baseline > 0 ? e.min_ear / baseline : null;
    const f = localFps(series, e.min_at_ms);
    return {
      onset_ms: rel(e.onset_ms),
      offset_ms: rel(e.offset_ms),
      min_at_ms: rel(e.min_at_ms),
      duration_ms: round(e.duration_ms, 2),
      frames_below: e.frames_below,
      ended_by: e.ended_by,
      min_ear_raw: e.min_ear,
      min_ratio_raw: ratio,
      min_ear_left: d.min_ear_left,
      min_ear_right: d.min_ear_right,
      open_pre: d.open_pre,
      min_ratio_local_raw: d.open_pre != null && d.open_pre > 0 ? e.min_ear / d.open_pre : null,
      max_gap_ms: d.max_gap_ms,
      pitch_at_min: d.pitch_at_min,
      yaw_at_min: d.yaw_at_min,
      tier: e.tier,
      local_fps: f == null ? null : round(f, 2),
      page: pageAt(pageMarks, e.onset_ms),
      ...(args.fits ? { min_ratio_fit: fit && baseline != null && baseline > 0 ? fit.min_ear / baseline : null } : {}),
    };
  });
  const record: OcularEventsRecord = {
    record_id: window === 'reading' ? ocularRecordId('reading', args.conditionId as string) : ocularRecordId('selftest', args.sessionId),
    condition_id: window === 'reading' ? args.conditionId : null,
    session_id: args.sessionId,
    window,
    rule_version: BLINK_RULE_VERSION,
    ear_baseline: baseline,
    start_capture_ms: t0,
    pages: pageMarks.map(([t, p]) => [rel(t), p] as [number, number]),
    events,
    trace: encodeTrace(trace, t0),
  };
  if (window === 'selftest') record.cues = (args.cues ?? []).map(rel);
  if (args.fits && args.fitExposure) {
    record.fit_rule_version = FIT_RULE_VERSION;
    record.fit_exposure_ms = round(args.fitExposure.ms, 2);
    record.fit_exposure_known = args.fitExposure.known;
  }
  return record;
}

/**
 * Signed time from the nearest cue to a self-test blink's onset (ms; negative = before the cue). The
 * self-test counts a blink for a cue when this is within SELF_TEST.WINDOW_MS (selfTest.ts); kept as a
 * number so a reader can see how promptly the blink followed. Null without cues.
 */
export function cueLag(cues: number[] | undefined, onsetMs: number): number | null {
  if (!cues || cues.length === 0) return null;
  let best: number | null = null;
  for (const c of cues) {
    const d = onsetMs - c;
    if (best == null || Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

/** Blink counts by tier, in the shape of the eye-metrics row's three count columns. */
export function tierCounts(events: { tier: string }[]): { full: number; micro: number; incomplete: number } {
  return {
    full: events.filter((e) => e.tier === 'full').length,
    micro: events.filter((e) => e.tier === 'micro').length,
    incomplete: events.filter((e) => e.tier === 'incomplete').length,
  };
}
