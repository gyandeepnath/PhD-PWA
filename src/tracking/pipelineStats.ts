/**
 * What the camera-to-tracker pipeline actually did — the numbers that say WHY a frame rate is low.
 *
 * WHY THIS EXISTS. The investigator's tablet failed the camera self-test "every time" on frame rate,
 * and the only number anywhere in the app was the face-solved rate: frames in which a face was found,
 * per second. A low value there has at least three causes that need opposite remedies, and the app
 * could not tell them apart:
 *
 *   - the CAMERA delivers few frames (dim light lengthens exposure and most front cameras then drop
 *     their frame rate; another app holds the camera; the mode Chrome chose is slow) — fix the light;
 *   - the TRACKER cannot keep up (each frame takes longer than the camera's frame interval, so the
 *     frames that arrive meanwhile are never looked at) — close other apps, charge the tablet, choose
 *     a faster tracker;
 *   - the tracker keeps up but does not FIND THE FACE — seating, framing, glare.
 *
 * The self-test's advice was always "close other apps and check the light", whichever it was. This
 * meter counts each stage separately so the self-test, the camera-setup screen and the researcher
 * panel can say which one is the limit, and the export can carry it per condition.
 *
 * DEFINITIONS (every rate is per second of the stretch it describes):
 *
 *   delivered — frames the camera handed to the page. Counted from requestVideoFrameCallback's
 *               `presentedFrames`, which the browser increments for every frame it presents whether or
 *               not the page's main thread was free to be told about it. Where the metadata is missing
 *               each callback counts one, which UNDER-counts when the main thread is busy: that is
 *               recorded (`deliveredSource`) rather than hidden.
 *   processed — frames the tracker ran on, with or without a face in them.
 *   face      — processed frames in which a face was found. This is what `effective_fps` gates on.
 *   skipped   — delivered minus processed: frames that arrived while the tracker was still working on
 *               an earlier one and were never looked at. A large share means the tracker is the limit.
 *   process ms — wall time of one tracker call, median and 95th percentile.
 *
 * Pure (no DOM), so every number here is unit-tested.
 */

/** A summary of one stretch: the live trailing window, a condition, or the self-test. */
export interface PipelineSummary {
  /** Frames delivered by the camera per second; null with fewer than two delivery events. */
  cameraFps: number | null;
  /** Frames the tracker processed per second (with or without a face). */
  trackerFps: number | null;
  /** Processed frames with a face, per second. */
  faceFps: number | null;
  framesDelivered: number;
  framesProcessed: number;
  framesWithFace: number;
  /** Delivered frames the tracker never saw. Never negative. */
  framesSkipped: number;
  /** Median and 95th-percentile wall time of one tracker call, ms. */
  processMsP50: number | null;
  processMsP95: number | null;
  /** How `framesDelivered` was counted: the browser's own frame counter, or one per callback. */
  deliveredSource: 'presented-frames' | 'callbacks' | null;
}

interface Delivery { t: number; n: number; counter: boolean }
interface Processing { t: number; ms: number; face: boolean }

/** Nearest-rank quantile of an unsorted array; null when empty. */
export function quantile(xs: number[], p: number): number | null {
  const v = xs.filter(Number.isFinite);
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

/**
 * Rate of events over the span from the first to the last, counting the events AFTER the first.
 *
 * The first event opens the span; counting it as well would overstate a short window by one frame
 * (two frames 33 ms apart are one interval, i.e. 30 fps, not 60). Same convention as effectiveFps.
 */
function spanRate(events: Array<{ t: number; n: number }>): number | null {
  if (events.length < 2) return null;
  const span = events[events.length - 1].t - events[0].t;
  if (!(span > 0)) return null;
  let n = 0;
  for (let i = 1; i < events.length; i++) n += events[i].n;
  return (n / span) * 1000;
}

function summarise(deliveries: Delivery[], processing: Processing[]): PipelineSummary {
  const delivered = deliveries.reduce((a, d) => a + d.n, 0);
  const processed = processing.length;
  const withFace = processing.reduce((a, p) => a + (p.face ? 1 : 0), 0);
  const ms = processing.map((p) => p.ms);
  const faces = processing.filter((p) => p.face).map((p) => ({ t: p.t, n: 1 }));
  return {
    cameraFps: spanRate(deliveries),
    trackerFps: spanRate(processing.map((p) => ({ t: p.t, n: 1 }))),
    faceFps: spanRate(faces),
    framesDelivered: delivered,
    framesProcessed: processed,
    framesWithFace: withFace,
    framesSkipped: Math.max(0, delivered - processed),
    processMsP50: quantile(ms, 0.5),
    processMsP95: quantile(ms, 0.95),
    deliveredSource: deliveries.length === 0 ? null
      : deliveries.every((d) => d.counter) ? 'presented-frames' : 'callbacks',
  };
}

/** A stretch being measured (a condition, the self-test). Closed by reading it. */
export interface MeterWindow {
  /** The summary so far; the window stays open. */
  read: () => PipelineSummary;
  /** The summary, and stop accumulating. */
  close: () => PipelineSummary;
}

export class PipelineMeter {
  private lastCounter: number | null = null;
  private recentDeliveries: Delivery[] = [];
  private recentProcessing: Processing[] = [];
  private windows = new Set<{ d: Delivery[]; p: Processing[] }>();

  /** `liveWindowMs`: how far back the live readout looks. */
  constructor(private readonly liveWindowMs = 2000) {}

  /**
   * A frame was presented. `presentedFrames` is the browser's running count when it is known: the
   * difference from the last call is how many frames arrived since, including any the main thread was
   * too busy to be told about. Without it, one call counts one frame.
   */
  delivered(t: number, presentedFrames?: number | null): void {
    let n = 1;
    let counter = false;
    if (presentedFrames != null && Number.isFinite(presentedFrames)) {
      counter = true;
      if (this.lastCounter != null) {
        const d = presentedFrames - this.lastCounter;
        // A counter that goes backwards (a new stream on the same element) restarts the count.
        n = d >= 1 ? d : 1;
      }
      this.lastCounter = presentedFrames;
    }
    const ev: Delivery = { t, n, counter };
    this.recentDeliveries.push(ev);
    this.trim(t);
    for (const w of this.windows) w.d.push(ev);
  }

  /** The tracker finished one frame, taking `ms`, and found a face or not. */
  processed(t: number, ms: number, face: boolean): void {
    const ev: Processing = { t, ms, face };
    this.recentProcessing.push(ev);
    this.trim(t);
    for (const w of this.windows) w.p.push(ev);
  }

  /** The live trailing window, ending at the most recent event. */
  live(): PipelineSummary {
    return summarise(this.recentDeliveries, this.recentProcessing);
  }

  /** Start measuring a stretch. Every event from now until `close()` counts toward it. */
  open(): MeterWindow {
    const w = { d: [] as Delivery[], p: [] as Processing[] };
    this.windows.add(w);
    return {
      read: () => summarise(w.d, w.p),
      close: () => { this.windows.delete(w); return summarise(w.d, w.p); },
    };
  }

  /** Forget the counter (a new stream, or a new tracker) without closing open windows. */
  resetCounter(): void {
    this.lastCounter = null;
    this.recentDeliveries = [];
    this.recentProcessing = [];
  }

  private trim(t: number): void {
    const from = t - this.liveWindowMs;
    while (this.recentDeliveries.length && this.recentDeliveries[0].t < from) this.recentDeliveries.shift();
    while (this.recentProcessing.length && this.recentProcessing[0].t < from) this.recentProcessing.shift();
  }
}

/**
 * What limited the face-solved frame rate, in one word, judged against `floor` (the rate wanted).
 *
 *   'camera'  — the camera itself delivered fewer than `floor` frames per second;
 *   'tracker' — the camera delivered enough, but the tracker processed fewer than `floor`;
 *   'face'    — the tracker processed enough frames but found the face in fewer than `floor`;
 *   'undetermined' — the rate is low, but the browser gave no frame counter, so a low delivered count
 *               may only mean the main thread was too busy to be told about frames: camera and
 *               tracker cannot be told apart, and saying either would be a guess;
 *   null      — the face-solved rate met the floor, or there is not enough to judge.
 *
 * Checked in that order, because each stage can only pass on what the one before it delivered: a
 * camera giving 12 fps makes the tracker's 12 fps a symptom, not a cause.
 */
export type PipelineLimit = 'camera' | 'tracker' | 'face' | 'undetermined' | null;

export function pipelineLimit(
  s: Pick<PipelineSummary, 'cameraFps' | 'trackerFps' | 'faceFps' | 'deliveredSource'>,
  floor: number,
): PipelineLimit {
  if (s.faceFps != null && s.faceFps >= floor) return null;
  if (s.trackerFps == null && s.cameraFps == null) return null;
  if (s.cameraFps != null && s.cameraFps < floor) {
    // Counted one per callback, a busy main thread looks exactly like a slow camera.
    return s.deliveredSource === 'presented-frames' ? 'camera' : 'undetermined';
  }
  // Frames arrived and the tracker produced (almost) nothing from them: it is the limit.
  if (s.trackerFps == null || s.trackerFps < floor) return 'tracker';
  return 'face';
}
