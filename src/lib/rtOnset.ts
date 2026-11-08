/**
 * WHEN THE REACTION TASK'S DOT REACHED THE SCREEN (Round 92, audit 86 P1).
 *
 * The onset of each dot is the zero of its reaction time: response_time_ms is the touch's own hardware
 * timestamp minus it, and the 150 ms anticipation cutoff and the 600 ms lapse threshold are judged on that
 * difference. It is taken once the dot has been painted, and it is the begin time of the first frame
 * after the frame that painted it — the vsync at which that painted frame goes to the screen. Two things
 * were wrong with how it was taken before, and a third with the frames around it.
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
 * callback runs, so no work done in that frame can move it. With the camera off the two agree to within
 * about a millisecond (the callback's own delay after the frame began), which is all that changes there.
 *
 * WHICH FRAME PAINTED THE DOT WAS ASSUMED, NOT SEEN. The old stamp counted two frames from the call that
 * rendered the dot, which is right only if the dot is in the document before the first of them — true
 * while React commits the render in the task straight after it was asked for, but nothing guaranteed it,
 * and a commit that slipped one frame (a busy main thread with the camera on is the likely cause) put the
 * stamp a frame before the dot was drawn. Now each frame looks: the first frame whose animation-frame
 * callbacks find the dot in the document is the frame that paints it (they run before that frame's style,
 * layout and paint; React never commits inside them), and the onset is the timestamp of the frame after
 * it. When the commit is on time, as it is in every run measured, that is exactly the frame the old stamp
 * was read in.
 *
 * AND THE TRACKER NO LONGER WORKS DURING THE TRIALS. A frame timestamp keeps work in the stamping frame
 * out of the stamp, but the tracker's work also ran in the frame that PAINTS the dot (video-frame
 * callbacks come before paint), delaying the paint itself while the frame's timestamp stayed put, and in
 * the frames that time the foreperiod. Measured with the frame stamp alone (headless Chromium, tracker
 * about 23-35 ms a frame), the onset fell up to 23 ms before the dot's paint had finished. So the tracker
 * also sits out the trials (useTracking holdFrames): nothing it computes during the reaction task is kept
 * (measurementSchedule.ts), the camera keeps running and its frames are still counted, and the tracker
 * gets them back when the last trial ends. With both, e2e/rtOnsetTiming.spec.ts measures the onset at the
 * begin time of the frame after the paint, 14-16 ms after the paint had finished, with the camera on as
 * off. Other main-thread work (a garbage collection, a database write finishing) can still lengthen a
 * frame; the frame timestamp keeps it out of the stamp.
 *
 * WHAT IS NOT CHANGED. The response is still the touch's own timestamp; the response window still closes
 * on it (lib/rtResponse.ts); touches are still taken as responses only from the stamping frame's callback
 * on, which is where the phase flips, as before.
 *
 * VERSIONED, because stored reaction times change meaning: rt_timing_version (02_conditions.csv,
 * analysis_long). 'rt-t1' rows with the camera on carry reaction times short by an unknown amount up to one
 * tracker call per trial, which cannot be recovered (the tracker's time per frame was not recorded);
 * 'rt-t1' rows with the camera off differ from 'rt-t2' by about a millisecond.
 */

/** The rule in force: 'rt-t2', the onset is the begin time of the frame after the one that painted the dot. */
export const RT_TIMING_VERSION = 'rt-t2';
/** Rows recorded before the stamp existed: the clock read in the second frame callback after rendering. */
export const RT_TIMING_VERSION_V1 = 'rt-t1';

/** The slice of `window` this needs, so a test can drive the frames itself. */
export interface FrameHost {
  requestAnimationFrame: (cb: (frameTime: number) => void) => number;
}

/**
 * How many frames to look for the dot before giving up on seeing it drawn. Never reached in a run that
 * works: React commits the dot within a frame or two. It exists so a dot that is never drawn (the task
 * unmounted under a pause or exit) cannot leave a loop polling forever; the onset is then the frame the
 * search stopped in, and the console says why.
 */
export const ONSET_SEARCH_MAX_FRAMES = 120;

/**
 * Wait for the frame that paints the stimulus, then call `onOnset` with the begin time of the frame after
 * it, from inside that frame's callback (so whatever the caller flips there — the phase that lets a touch
 * count as a response — flips at the same instant as the stamp, as before).
 *
 * `isDrawn` answers "is the stimulus in the document now?"; it is asked in each frame's callback.
 */
export function stampOnsetAfterPaint(
  isDrawn: () => boolean,
  onOnset: (frameTime: number) => void,
  host: FrameHost = window,
): Promise<number> {
  return new Promise((resolve) => {
    let looked = 0;
    const look = () => {
      looked += 1;
      if (!isDrawn() && looked < ONSET_SEARCH_MAX_FRAMES) {
        host.requestAnimationFrame(look);
        return;
      }
      if (looked >= ONSET_SEARCH_MAX_FRAMES && !isDrawn()) {
        console.error('[visulab] reaction-time onset: the dot was not found drawn; the onset is the frame the search stopped in.');
      }
      // This frame paints the stimulus. The next one's begin time is when it reached the screen.
      host.requestAnimationFrame((frameTime) => {
        onOnset(frameTime);
        resolve(frameTime);
      });
    };
    host.requestAnimationFrame(look);
  });
}
