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
 * The file's own comments already said the right thing one level down — "one ingest per result →
 * EAR is sampled at the real FaceMesh throughput", and a note about a previous build that "ran a
 * free-running 60 fps sampler over stale landmarks, duplicating samples and overstating
 * effective_fps". That fix was applied to the ingest and not to the send, so the same defect
 * survived one layer up, underneath a comment saying it had been dealt with.
 *
 * TWO MECHANISMS. `requestVideoFrameCallback` is the API for exactly this question and fires once
 * per presented frame; it is what Chrome on the study tablets supports. Where it is missing the
 * fallback is rAF plus a `currentTime` comparison — the element's playback position only advances
 * when a new frame is presented, so an unchanged value means the frame has already been sent.
 * The fallback is strictly worse (it still wakes at refresh rate, it just does not SEND), which is
 * why it is the fallback.
 */

/** The slice of HTMLVideoElement the pump needs. Narrow, so a test can supply a plain object. */
export interface PumpVideo {
  currentTime: number;
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export interface PumpHost {
  requestAnimationFrame: (cb: () => void) => number;
  cancelAnimationFrame: (handle: number) => void;
}

export interface FramePump {
  /** Which mechanism is driving it. Recorded in tests; useful when a device behaves oddly. */
  readonly mode: 'video-frame-callback' | 'animation-frame';
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
  onFrame: () => Promise<void>,
  opts: { everyN?: number; host?: PumpHost } = {},
): FramePump {
  const everyN = Math.max(1, Math.floor(opts.everyN ?? 1));
  const host = opts.host ?? (typeof window !== 'undefined' ? window : undefined);
  let stopped = false;
  let counter = 0;
  let handle: number | null = null;

  /** Guard against re-entry: a send that outlasts the next callback must not start a second one. */
  let busy = false;

  const deliver = async (): Promise<void> => {
    if (stopped || busy) return;
    counter += 1;
    if (counter % everyN !== 0) return;
    busy = true;
    try {
      await onFrame();
    } catch {
      /* a transient frame error must not kill the pump — the next frame is 33 ms away */
    } finally {
      busy = false;
    }
  };

  if (typeof video.requestVideoFrameCallback === 'function') {
    const tick = () => {
      if (stopped) return;
      handle = video.requestVideoFrameCallback!(tick);
      void deliver();
    };
    handle = video.requestVideoFrameCallback(tick);
    return {
      mode: 'video-frame-callback',
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
    void deliver();
  };
  handle = host!.requestAnimationFrame(loop);
  return {
    mode: 'animation-frame',
    stop: () => {
      stopped = true;
      if (handle != null) host!.cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
