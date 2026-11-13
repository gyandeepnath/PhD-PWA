/**
 * WHEN THE REACTION TASK'S DOT REACHED THE SCREEN (Round 92, audit 86 P1; Round 93, review REVA-1).
 *
 * The onset of each dot is the zero of its reaction time: response_time_ms is the touch's own hardware
 * timestamp minus it, and the 150 ms anticipation cutoff and the 600 ms lapse threshold are judged on that
 * difference. It is the begin time of the first frame that begins AFTER the frame that painted the dot has
 * finished its rendering on the main thread — the first vsync at which that painted frame can go to the
 * screen. Normally that is the very next frame: a frame's rendering takes a few milliseconds and the next
 * one begins about a refresh interval later. Three things were wrong with how it was taken before Round 92,
 * and a fourth with the rule Round 92 put in their place.
 *
 * THE CLOCK WAS READ AFTER THE FACE TRACKER'S WORK. The stamp was `performance.now()` read inside the
 * second animation-frame callback after the dot was rendered. With the camera on, both face trackers do
 * their work synchronously on the main thread inside the video-frame callback (tracking/framePump.ts), and
 * the browser runs video-frame callbacks in the same rendering step as, and BEFORE, the animation-frame
 * callbacks. So whenever a camera frame was processed in the stamping frame, the clock was read only after
 * the tracker had finished with it, and the reaction time came out short by that much. The audit measured
 * the stamp 95-140 ms after the start of its frame in headless Chromium (the tracker took about 110 ms a
 * frame there) against 0.5-1 ms with the camera off; on the Xiaomi Pad 6 the size is unmeasured, at most
 * one tracker call per affected trial. The direction was fixed (too short), it fell only on sittings with
 * the camera on, and it moved both absolute cutoffs. Now the stamp is the frame's own timestamp — the
 * argument the browser hands every animation-frame callback, the same for all of them in one frame, on the
 * same performance clock as the touch's timestamp — which is fixed when the frame begins, before any
 * callback runs, so no work done in the STAMPING frame can move it. With the camera off the two agree to
 * within about a millisecond (the callback's own delay after the frame began), which is all that changes
 * there.
 *
 * WHICH FRAME PAINTED THE DOT WAS ASSUMED, NOT SEEN. The old stamp counted two frames from the call that
 * rendered the dot, which is right only if the dot is in the document before the first of them — true
 * while React commits the render in the task straight after it was asked for, but nothing guaranteed it,
 * and a commit that slipped one frame (a busy main thread with the camera on is the likely cause) put the
 * stamp a frame before the dot was drawn. Now each frame looks: the first frame whose animation-frame
 * callbacks find the dot in the document is the frame that paints it (they run before that frame's style,
 * layout and paint; React never commits inside them).
 *
 * AND THE TRACKER NO LONGER WORKS DURING THE TRIALS. The tracker's work also ran in the frame that PAINTS
 * the dot (video-frame callbacks come before paint), delaying the paint itself while the frame's timestamp
 * stayed put, and in the frames that time the foreperiod. Measured with the frame stamp alone (headless
 * Chromium, tracker about 23-35 ms a frame), the onset fell up to 27 ms before the dot's paint had
 * finished. So the tracker also sits out the trials (useTracking holdFrames): nothing it computes during
 * the reaction task is kept (measurementSchedule.ts), the camera keeps running and its frames are still
 * counted, and the tracker gets them back when the last trial ends.
 *
 * A LONG PAINT FRAME (Round 93, review REVA-1; rt-t3). Round 92 took the onset as the begin time of the
 * frame after the paint frame, and said it could never come before the dot was painted. That holds only
 * while the paint frame finishes before the next frame's begin time. Any other main-thread work in the
 * paint frame — a garbage collection, a database write finishing, a long React render — delays the paint
 * itself, and when it runs past the next vsync, Chromium hands the next frame the latest vsync it missed
 * although the frame starts only once the paint is done: the stamp then fell BEFORE the dot could be on the
 * screen, and the reaction time came out long by up to about a frame. The review measured it on the app:
 * with 30 ms of extra work in the paint frame the stored onset was 14.2-14.6 ms before the paint had
 * finished (rule rt-t1's clock, read after the paint, would have landed about 0.1 ms after it). It needs
 * roughly 9-17 ms or more of extra work inside that one frame; it was not seen without injected work (36
 * trials at 4x and 6x CPU slowdown, camera off and on), and it has not been measured on the tablet. Now the
 * frame that finds the dot also posts a message: a message posted from an animation-frame callback is
 * handled only after that frame's rendering has finished (the browser renders a frame in one task, and the
 * message is a task of its own), so its arrival time is no earlier than the end of the paint's main-thread
 * work. The onset is the begin time of the first frame that begins no earlier than the arrival; the phase
 * flips in the same callback, as before. So the onset is never before the paint ended. If the message has
 * not arrived by the next frame, the stamp waits a frame; it never guesses.
 *
 * WHEN THE ONSET MOVES, AND BY HOW MUCH (Round 94, review REVA93-A1 and A2: the rule is rt-t3 as before;
 * its error bound was misstated). The onset is a later frame than the next one whenever the message
 * arrives after the next frame's begin time, for one of two reasons the data cannot tell apart: the paint
 * frame overran, or the paint finished in time and the message was HELD behind a task already queued ahead
 * of it (any task: a database callback, a timer, another message). onset_paint_overrun_ms is that message's
 * lateness past the next frame's begin time, whichever the reason; onset_moved_ms is how far the onset was
 * moved past that frame (rt-t2's onset), a whole number of frames. Where the paint overran, the onset is
 * right and rt-t2's was early by up to about a frame. Where the message was held, the onset is LATE, by the
 * overrun rounded up to whole frames — less than the overrun plus one frame, and with no bound of its own:
 * the review queued 25, 45 and 120 ms tasks ahead of the message (headless Chromium, 60 Hz) while the paint
 * had ended about 15 ms before the next frame, and the onset moved 1, 2 and 7 frames (overrun 9.5-9.7,
 * 29.6-29.8 and 105.0-105.1 ms) — and rt-t2's onset was right, so the reaction time is SHORT by
 * onset_moved_ms: enough to put a real hit under the 150 ms anticipation cutoff, and a touch made between
 * the two onsets counts as a false start. (At the tablet's 144 Hz a frame is about 7 ms.) So rt-t2 and
 * rt-t3 differ on every trial whose overrun is above 0, by onset_moved_ms, the one early or the other late
 * as the cause was, and that trial's reaction time lies between response_time_ms and response_time_ms +
 * onset_moved_ms. In every ordinary trial the next frame begins well after the paint ended
 * (e2e/rtOnsetTiming.spec.ts: about 11-16 ms after it, set by how long the paint frame took; its log prints
 * each trial) and the message has arrived by then, so the onset is the very frame rt-t2 took, and both
 * fields are 0.
 *
 * WHAT IS NOT CHANGED. The response is still the touch's own timestamp; the response window still closes
 * on it (lib/rtResponse.ts); touches are still taken as responses only from the stamping frame's callback
 * on, which is where the phase flips, as before — a touch before it is a false start, as a touch before
 * the dot always was. On an ordinary trial and where the paint overran, the dot cannot yet be on the screen
 * then; where the paint-end message was held, it could already have been (above), so a touch between the
 * two onsets is a false start although it came after the dot could first be seen.
 *
 * VERSIONED, because stored reaction times change meaning: rt_timing_version (02_conditions.csv,
 * analysis_long). 'rt-t1' rows with the camera on carry reaction times short by an unknown amount up to one
 * tracker call per trial, which cannot be recovered (the tracker's time per frame was not recorded);
 * 'rt-t1' rows with the camera off differ from 'rt-t2' by about a millisecond. 'rt-t2' rows are the onset
 * rt-t3 would have stamped wherever the paint-end message arrived before the next frame's begin time —
 * every ordinary trial; on a trial where the paint overran, the 'rt-t2' onset was early by up to about a
 * frame and the reaction time long by as much, and on one where the message would have been held, the
 * 'rt-t2' onset is the right one. Neither kind was marked (onset_paint_overrun_ms and onset_moved_ms are
 * blank on rt-t2 rows), and no paint overrun was seen in ordinary runs.
 */

/**
 * The rule in force: 'rt-t3' (Round 93), the onset is the begin time of the first frame that begins no
 * earlier than the end of the rendering of the frame that painted the dot.
 */
export const RT_TIMING_VERSION = 'rt-t3';
/** Round 92's rule: the begin time of the frame after the one that painted the dot, however long that ran. */
export const RT_TIMING_VERSION_T2 = 'rt-t2';
/** Rows recorded before the stamp existed: the clock read in the second frame callback after rendering. */
export const RT_TIMING_VERSION_V1 = 'rt-t1';

/** The slice of `window` this needs, so a test can drive the frames and the clock itself. */
export interface FrameHost {
  requestAnimationFrame: (cb: (frameTime: number) => void) => number;
  /**
   * Queue `cb` as a task of its own, now. Called from an animation-frame callback, it runs no earlier than
   * the end of that frame's rendering (style, layout, paint), since the browser renders a frame in one
   * task — and later, by as long as they take, if other tasks were queued before it.
   */
  postTask: (cb: () => void) => void;
  /** The performance clock: the one frame timestamps and touch timestamps are on. */
  now: () => number;
}

/** One channel for the page, made on first use: posting on it is the whole cost inside the paint frame. */
let taskChannel: { port: MessagePort; queue: Array<() => void> } | null = null;

/**
 * The browser's: a MessageChannel for the task (not setTimeout, which a browser may clamp to a few
 * milliseconds and so report the paint as ending later than it did), performance.now() for the clock.
 */
export function browserFrameHost(): FrameHost {
  return {
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    postTask: (cb) => {
      if (!taskChannel) {
        const ch = new MessageChannel();
        const queue: Array<() => void> = [];
        ch.port1.onmessage = () => { queue.shift()?.(); };
        taskChannel = { port: ch.port2, queue };
      }
      taskChannel.queue.push(cb);
      taskChannel.port.postMessage(0);
    },
    now: () => performance.now(),
  };
}

/**
 * How many frames to look for the dot before giving up on seeing it drawn, and then how many to wait for
 * the end of its paint. Never reached in a run that works: React commits the dot within a frame or two,
 * and the paint's end is seen before the next frame. It exists so a dot that is never drawn (the task
 * unmounted under a pause or exit) cannot leave a loop polling forever; the onset is then the frame the
 * search stopped in, and the console says why.
 */
export const ONSET_SEARCH_MAX_FRAMES = 120;

/**
 * Wait for the frame that paints the stimulus, then call `onOnset` with the begin time of the first frame
 * that begins no earlier than the arrival of a message posted from that frame (no earlier than the end of
 * its rendering) — from inside that frame's callback, so whatever the caller flips there (the phase that
 * lets a touch count as a response) flips at the same instant as the stamp, as before — and with:
 *   - `paintOverrunMs`, how far that arrival was past the begin time of the frame after the paint frame:
 *     0 when it came before (every ordinary trial); above 0 when the paint overran OR the message was held
 *     behind a task queued ahead of it, which cannot be told apart; null if it never arrived (not met in
 *     any run);
 *   - `movedMs`, the onset minus the begin time of the frame after the paint frame (rt-t2's onset): 0 in
 *     an ordinary trial, else the whole frames the onset was moved (Round 94, review REVA93-A1).
 *
 * `isDrawn` answers "is the stimulus in the document now?"; it is asked in each frame's callback.
 */
export function stampOnsetAfterPaint(
  isDrawn: () => boolean,
  onOnset: (frameTime: number, paintOverrunMs: number | null, movedMs: number) => void,
  host: FrameHost = browserFrameHost(),
): Promise<number> {
  return new Promise((resolve) => {
    let looked = 0;
    let waited = 0;
    /** When the paint frame's rendering had finished: the arrival of the message posted from it. */
    let paintEnded: number | null = null;
    /** The begin time of the frame after the paint frame: rt-t2's onset, what an overrun and a move are measured from. */
    let nextBegin: number | null = null;
    const stamp = (frameTime: number) => {
      if (nextBegin == null) nextBegin = frameTime;
      // The dot cannot be on the screen before the frame that paints it has been rendered: a frame that
      // began before then (its vsync passed while the paint was still running) is not its onset.
      if ((paintEnded == null || frameTime < paintEnded) && waited < ONSET_SEARCH_MAX_FRAMES) {
        waited += 1;
        host.requestAnimationFrame(stamp);
        return;
      }
      if (paintEnded == null) {
        console.error('[visulab] reaction-time onset: the end of the dot\'s paint was not seen; the onset is the frame the wait stopped in.');
      }
      const overrun = paintEnded == null ? null : Math.round(Math.max(0, paintEnded - nextBegin) * 100) / 100;
      // rt-t2's onset was nextBegin: how far this one is past it (the two bracket a moved trial's onset).
      const moved = Math.round((frameTime - nextBegin) * 100) / 100;
      onOnset(frameTime, overrun, moved);
      resolve(frameTime);
    };
    const look = () => {
      looked += 1;
      if (!isDrawn() && looked < ONSET_SEARCH_MAX_FRAMES) {
        host.requestAnimationFrame(look);
        return;
      }
      if (looked >= ONSET_SEARCH_MAX_FRAMES && !isDrawn()) {
        console.error('[visulab] reaction-time onset: the dot was not found drawn; the onset is the frame the search stopped in.');
      }
      // This frame paints the stimulus. The message is handled once its rendering is done.
      host.postTask(() => { paintEnded = host.now(); });
      host.requestAnimationFrame(stamp);
    };
    host.requestAnimationFrame(look);
  });
}
