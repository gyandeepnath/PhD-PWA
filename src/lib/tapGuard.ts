/**
 * A TOUCH THAT BEGINS AS THE SCREEN CHANGES WAS AIMED AT THE SCREEN THAT WENT (Round 86, audit 86 F8,
 * F11, M1, M2).
 *
 * On the tablet a double tap — two touches a hundred or two milliseconds apart, a finger bouncing or an
 * impatient second press — reached the app as two complete taps. When the first one changed the screen,
 * the second landed on whatever the NEW screen had drawn at the same place, and the new screen took it
 * as an answer nobody gave:
 *
 *   - "Begin setup" → the consent screen's camera option sits under it: the participant's optional,
 *     off-by-default camera grant arrived ticked (F8);
 *   - a colour-vision digit → the same digit on the next plate, which had been on screen for ~140 ms (F11);
 *   - "Begin search" → a word of the passage under the button: a false alarm in the search d′ (M1);
 *   - the reaction task's "Start" → the trial field, whose whole surface is the response key: trial 1
 *     scored as an anticipation (or, at the device's timing, a false start) (M2).
 *
 * Each screen's own latch cannot see this — the tap is the NEW screen's first — so the guard is one
 * place, for every screen: a touch that STARTS less than TAP_GUARD_MS after a screen change is dropped,
 * whole (its pointer events, its touch events, the mouse events and the click the browser makes from
 * it), before any of the app's handlers see it. So is the rest of a touch that started before the change
 * and ends after it. A screen change is wherever a screen arms the guard (useTapGuard): every stage of
 * the sitting, a task's instruction card handing over to the task, a new colour-vision plate or question,
 * a dialog opening or closing.
 *
 * WHY 300 ms. It is Android's own double-tap window (ViewConfiguration.DOUBLE_TAP_TIMEOUT): the platform
 * counts a second touch within 300 ms of the first one's release as the second tap of a double tap, and a
 * screen can change no earlier than that release, so every second tap the platform would call one falls
 * inside the guard. A deliberate tap on a screen that has just appeared needs it to have been seen and
 * read first, which takes longer. The window is measured on each event's own timestamp (the clock the
 * reaction task times responses on), so a touch made before a busy frame let it through is judged by when
 * it was made.
 *
 * WHAT IT CANNOT SWALLOW. Inside a timed task the guard is armed by the instruction card's hand-over and
 * never by the task's own stimuli: the reaction task's dot, its fixation cross and its feedback are not
 * screen changes, and a reading page or a search passage changes nothing under it. The reaction task's
 * first trial opens with a FIXED 400 ms fixation cross (config.ts RT_FIXATION_MIN_MS, then a delay of at
 * least 300 ms), so the guard ends 100 ms before that cross can even give way, and at least 400 ms before
 * the first dot can appear: no response to a stimulus, and no false start in the foreperiod's delay, can
 * fall inside it. tests/tapGuard.test.tsx holds the constants to that order. What it does take is a
 * touch in the first 300 ms of trial 1's fixation cross, which used to be scored a false start: inside
 * the platform's double-tap window it cannot be told from the second tap of "Start", and that is what it
 * was in the audit's reproduction. Onset and response timestamps are untouched: the guard drops events
 * or lets them through unchanged and stamps nothing — the response time is still the touch's own
 * timeStamp minus the onset taken at paint (e2e/doubleTap.spec.ts measures it), and the listener costs
 * about a microsecond an event in desktop Chromium (Round 86; not measured on the tablet).
 *
 * VERSIONED. What reaches a task changed, so the condition row says which rule it was recorded under:
 * tap_guard_version (02_conditions.csv), TAP_GUARD_VERSION below.
 *
 * TOUCH AND PEN ONLY. The study's input is a finger on the tablet. A mouse is the development and
 * end-to-end test device here, and the test suite clicks through screens faster than any participant
 * could, by design; it is never on the study tablet. A double MOUSE click that changes the screen is
 * still met by the stage machine's own guard (experiment/useStageTransitions.ts) and by each screen's
 * latch, which hold for every kind of pointer.
 */
import { useLayoutEffect } from 'react';

/** How long after a screen change a new touch is taken as aimed at the screen that went. */
export const TAP_GUARD_MS = 300;

/**
 * The rule a condition's touches were taken under, stamped on its row (types.ts ConditionRecord):
 * 'tg-v2' from Round 86, touches starting within TAP_GUARD_MS of a screen change dropped. A change to
 * the window, or to what counts as a screen change inside a task, is a new version.
 */
export const TAP_GUARD_VERSION = 'tg-v2';
/** Rows recorded before Round 86: no guard, every touch reached whatever was under it. */
export const TAP_GUARD_VERSION_V1 = 'tg-v1';

/**
 * The consent screen holds touches off for longer. Its options are the participant's grants, they start
 * unticked, and the screen is read before anything on it is chosen; a touch inside its first second is
 * a carried one or an accident, never a decision about the camera, the photographs or the video.
 */
export const CONSENT_TAP_GUARD_MS = 1000;

/** How long after a dropped touch's last event its click and the browser's mouse events can follow. */
const GESTURE_TAIL_MS = 1000;

/** The last screen change, and until when a touch starting is dropped: performance clock. */
let armedAt = -Infinity;
let guardedUntil = -Infinity;
/** The touch in progress, or the last one: when it started and whether it is being dropped. */
let gesture: { start: number; last: number; dropped: boolean } | null = null;

/** A screen has just changed: touches starting in the next `ms` are dropped. */
export function armTapGuard(ms: number = TAP_GUARD_MS, at: number = performance.now()): void {
  armedAt = Math.max(armedAt, at);
  guardedUntil = Math.max(guardedUntil, at + ms);
}

/** Back to nothing armed and no touch in progress. For tests. */
export function resetTapGuard(): void {
  armedAt = -Infinity;
  guardedUntil = -Infinity;
  gesture = null;
}

/**
 * Arms the guard when this screen appears, whenever `screen` changes, and when it goes — in the commit
 * that draws the change, before anything on the new screen can be touched. `holdMs` is how long.
 */
export function useTapGuard(screen?: unknown, holdMs: number = TAP_GUARD_MS): void {
  useLayoutEffect(() => {
    armTapGuard(holdMs);
    return () => armTapGuard();
  }, [screen, holdMs]);
}

const isTouchLike = (e: Event) => {
  const type = (e as PointerEvent).pointerType;
  return type === 'touch' || type === 'pen';
};

function drop(e: Event): void {
  e.stopImmediatePropagation();
  if (e.cancelable && !e.type.startsWith('touch')) e.preventDefault();
}

/**
 * Listen, in the capture phase on the window — ahead of React's root listeners and every element's own —
 * for the whole life of the app. Returns the uninstaller.
 */
export function installTapGuard(target: Window = window): () => void {
  const onDown = (e: Event) => {
    if (!isTouchLike(e)) { gesture = null; return; }
    const t = e.timeStamp;
    gesture = { start: t, last: t, dropped: t < guardedUntil };
    if (gesture.dropped) drop(e);
  };
  /** The rest of a touch: dropped with its start, or when it started on a screen that has since gone. */
  const onRest = (e: Event) => {
    if (!gesture || !isTouchLike(e)) return;
    if (gesture.start < armedAt) gesture.dropped = true;
    if (!gesture.dropped) return;
    gesture.last = e.timeStamp;
    drop(e);
  };
  /** The touch events, and the mouse events and click the browser makes from a touch. */
  const onFollow = (e: Event) => {
    if (!gesture?.dropped || e.timeStamp - gesture.last > GESTURE_TAIL_MS) return;
    if (e.type !== 'click') gesture.last = e.timeStamp;
    drop(e);
  };
  const opts = { capture: true, passive: false } as const;
  const rest = ['pointermove', 'pointerup', 'pointercancel'];
  const follow = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'];
  target.addEventListener('pointerdown', onDown, opts);
  for (const type of rest) target.addEventListener(type, onRest, opts);
  for (const type of follow) target.addEventListener(type, onFollow, opts);
  return () => {
    target.removeEventListener('pointerdown', onDown, opts);
    for (const type of rest) target.removeEventListener(type, onRest, opts);
    for (const type of follow) target.removeEventListener(type, onFollow, opts);
  };
}
