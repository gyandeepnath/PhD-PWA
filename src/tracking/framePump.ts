/**
 * Deliver each CAMERA frame to the tracker exactly once.
 *
 * THE DEFECT THIS EXISTS FOR. The pump was `requestAnimationFrame`, and rAF fires at the DISPLAY's
 * refresh rate, which has nothing to do with the camera's. It sent whatever the `<video>` element
 * happened to be holding at that instant, with no check that the element was holding anything new.
 * A 30 fps camera on a 60 Hz panel therefore had every frame sent twice, and a 120 Hz tablet four
 * times.
 *
 * MediaPipe answers each send, so each duplicate produced its own result, its own EAR sample and
 * its own timestamp. The series then looked twice as fast as the eye was actually observed. That
 * matters because `effective_fps` is computed from those timestamps and gates the study's primary
 * outcome: FPS_RATIO_THRESHOLD is 30 because classifying a blink as complete or incomplete depends
 * on catching the frame at its minimum aperture, and a blink lasts 100-150 ms. A tablet genuinely
 * delivering 15 fps — one or two frames per blink, far too few — would report 30 and pass the gate,
 * and `fps_adequate_for_ratio` would certify an incomplete-blink ratio computed from blinks that
 * were barely sampled at all. The duplicate frames carry no extra information, so the gate would
 * have been passing on evidence that did not exist.
 *
 * TWO MECHANISMS. `requestVideoFrameCallback` is the API for exactly this question and fires once
 * per presented frame; it is what Chrome on the study tablets supports. Where it is missing the
 * fallback is rAF plus a `currentTime` comparison — the element's playback position only advances
 * when a new frame is presented, so an unchanged value means the frame has already been sent.
 * The fallback is strictly worse (it still wakes at refresh rate, it just does not SEND), which is
 * why it is the fallback.
 *
 * WHAT THE PUMP NOW ALSO REPORTS (round 75). Every callback hands over the frame's metadata:
 * `presentedFrames`, the browser's own count of frames presented, which keeps counting while the main
 * thread is busy and so says how many frames the CAMERA delivered whether or not the tracker saw them;
 * and `captureTime`, when the camera took the frame. `onPresented` fires for every frame, busy or not,
 * so the delivered count is complete; `onFrame` fires only for frames that are sent.
 *
 * A NOTE ON "BUSY". A frame that arrives while a send is still in flight is not sent — it is counted
 * (`busySkips`), never queued, never sent twice. An earlier analysis (round 74, R1 D2) predicted that
 * this throws away half the frames whenever a send outlasts one frame interval. Measured in headless
 * Chromium (round 75) it does not happen: both trackers do their work synchronously on the main
 * thread, so no callback can run while a frame is being processed and `busySkips` stayed 0; the
 * frames that arrive meanwhile are presented, counted in `presentedFrames`, and the next callback
 * after the work carries the NEWEST frame. Throughput is then 1 / (time per frame), not a quantised
 * fraction of the camera rate. The count is kept so a device that behaves differently shows it.
 */

/** What the browser reports about a presented frame (VideoFrameCallbackMetadata, the parts used). */
export interface FrameMeta {
  /** When the callback ran (performance.now() clock). */
  now: number;
  /** The browser's running count of presented frames; absent under the rAF fallback. */
  presentedFrames?: number;
  /** When the camera captured the frame (performance.now() clock), where the browser provides it. */
  captureTime?: number;
}

/** The slice of HTMLVideoElement the pump needs. Narrow, so a test can supply a plain object. */
export interface PumpVideo {
  currentTime: number;
  requestVideoFrameCallback?: (cb: (now: number, meta?: { presentedFrames?: number; captureTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface PumpHost {
  requestAnimationFrame: (cb: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
}

export interface FramePump {
  /** Which mechanism is driving it. Recorded in tests; useful when a device behaves oddly. */
  readonly mode: 'video-frame-callback' | 'animation-frame';
  /** Frames that arrived while a send was still in flight, and so were not sent. */
  readonly busySkips: number;
  stop: () => void;
}

/**
 * Start delivering frames. `onFrame` is awaited, so the pump self-paces to what the tracker can
 * actually keep up with rather than queueing sends behind a busy solver.
 *
 * `everyN` drops frames deliberately (CONFIG.PROCESS_EVERY_N_FRAMES) and now counts CAMERA frames,
 * which is what the constant always meant: under rAF it counted display refreshes, so "process
 * every 2nd frame" on a 60 Hz panel with a 30 fps camera processed every camera frame.
 */
export function startFramePump(
  video: PumpVideo,
  onFrame: (meta: FrameMeta) => Promise<void> | void,
  opts: {
    everyN?: number;
    host?: PumpHost;
    /** Called for EVERY presented frame, before the busy check: the delivered count. */
    onPresented?: (meta: FrameMeta) => void;
    /** The clock for the rAF fallback's metadata. */
    clock?: () => number;
  } = {},
): FramePump {
  const everyN = Math.max(1, Math.floor(opts.everyN ?? 1));
  const host = opts.host ?? (typeof window !== 'undefined' ? window : undefined);
  const clock = opts.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let stopped = false;
  let counter = 0;
  let handle: number | null = null;
  let busySkips = 0;

  /** Guard against re-entry: a send that outlasts the next callback must not start a second one. */
  let busy = false;

  const deliver = async (meta: FrameMeta): Promise<void> => {
    if (stopped) return;
    try { opts.onPresented?.(meta); } catch { /* a counter must never stop the pump */ }
    if (busy) { busySkips += 1; return; }
    counter += 1;
    if (counter % everyN !== 0) return;
    busy = true;
    try {
      await onFrame(meta);
    } catch {
      /* a transient frame error must not kill the pump — the next frame is 33 ms away */
    } finally {
      busy = false;
    }
  };

  if (typeof video.requestVideoFrameCallback === 'function') {
    const tick = (now: number, md?: { presentedFrames?: number; captureTime?: number }) => {
      if (stopped) return;
      handle = video.requestVideoFrameCallback!(tick);
      void deliver({ now, presentedFrames: md?.presentedFrames, captureTime: md?.captureTime });
    };
    handle = video.requestVideoFrameCallback(tick);
    return {
      mode: 'video-frame-callback',
      get busySkips() { return busySkips; },
      stop: () => {
        stopped = true;
        if (handle != null) video.cancelVideoFrameCallback?.(handle);
        handle = null;
      },
    };
  }

  /*
   * Fallback. `currentTime` advances only when a new frame is presented, so an unchanged value
   * means this is the same frame as last time and sending it would duplicate a sample.
   *
   * Initialised to NaN rather than to the current position, because NaN !== NaN — so the very
   * first callback always delivers, instead of being skipped when playback has not yet started.
   */
  let lastSentTime = Number.NaN;
  const loop = () => {
    if (stopped) return;
    handle = host!.requestAnimationFrame(loop);
    const t = video.currentTime;
    if (t === lastSentTime) return;
    lastSentTime = t;
    void deliver({ now: clock() });
  };
  handle = host!.requestAnimationFrame(loop);
  return {
    mode: 'animation-frame',
    get busySkips() { return busySkips; },
    stop: () => {
      stopped = true;
      if (handle != null) host!.cancelAnimationFrame(handle);
      handle = null;
    },
  };
}

/**
 * The timestamp a frame's measurements belong to: when the camera captured it, where the browser says
 * so plausibly, otherwise when the frame was handed to the page.
 *
 * WHY. Every EAR sample was stamped with the time its RESULT arrived. That is capture time plus the
 * tracker's processing time, and processing time varies frame to frame (tens of milliseconds, more
 * when the tablet is busy), so it added jitter to every interval the blink measures are built from —
 * onsets, durations, inter-blink intervals — and lagged every sample behind the eye it describes.
 * `captureTime` is on the same performance.now() clock. It is accepted only when it lies within the
 * second before the callback (a browser bug that put it on another clock would otherwise move the
 * whole series); anything else falls back to the callback time, and the source is recorded.
 */
export function frameTimestamp(meta: FrameMeta): { t: number; source: 'capture' | 'callback' } {
  const c = meta.captureTime;
  if (typeof c === 'number' && Number.isFinite(c) && c <= meta.now + 50 && c >= meta.now - 1000) {
    return { t: c, source: 'capture' };
  }
  return { t: meta.now, source: 'callback' };
}
