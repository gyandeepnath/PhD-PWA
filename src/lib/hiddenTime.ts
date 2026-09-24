/**
 * How long the document was hidden, and how many times it went away.
 *
 * WHY THIS IS ONE MODULE NOW. The reading task and the adaptation field each grew their own copy of
 * this, and the two did not agree. The adaptation copy seeds its "hidden since" from the CURRENT
 * visibility state; the reading copy seeds it to null. So when a reading page began while the
 * document was already hidden — which is exactly what happens when the tablet is backgrounded
 * during the adaptation field and the reading task mounts behind it — the visible→hidden edge had
 * already passed, the hidden→visible edge found a null to compare against, and the whole interval
 * was dropped. `reading_hidden_ms` then understated the interruption it exists to report.
 *
 * The reading copy also never flushed an interval still in progress when the task ended, so a page
 * closed out while hidden lost its final stretch too.
 *
 * WHY IT MATTERS BEYOND READING. Backgrounding does not only cost time. Browsers throttle timers and
 * animation frames in a hidden tab, so anything measured against a clock while hidden is measuring
 * the throttling. The reaction-time block is the extreme case — trials are about a second each with
 * a one-second response window, so a backgrounded RT block produces misses and lapses that describe
 * the operating system, not the participant — but every task in a condition has a clock in it:
 * search time against its own limit, response times on the questionnaires, the exposure window
 * the eye metrics are counted over.
 *
 * So the condition as a whole is tracked, not just the tasks that happened to grow their own copy.
 * One number per condition row says whether that condition was interrupted at all, and the analyst
 * can exclude or model it without needing a column per task.
 */
import { now } from './timing';

export interface HiddenTime {
  /** Milliseconds the document spent hidden, including an interval still in progress. */
  hiddenMs: number;
  /** How many separate times it went hidden. One long absence and six flickers are not the same. */
  events: number;
}

export interface HiddenTimeTracker {
  /** The total so far, safe to call at any moment. */
  read: () => HiddenTime;
  /** Detach the listener and return the final total. Idempotent. */
  stop: () => HiddenTime;
}

interface Options {
  /** Defaults to `document`. Injected so the behaviour can be tested without a real page. */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** Defaults to reading `document.visibilityState`. */
  isHidden?: () => boolean;
  /** Defaults to the app's monotonic clock. */
  clock?: () => number;
  /**
   * Which event signals that the blocked/unblocked state may have changed.
   *
   * Parameterised so the portrait tracker below can reuse this implementation rather than grow a
   * second copy of it — which is what happened the first time, when the reading task and the
   * adaptation field each kept their own and the two disagreed.
   */
  eventName?: string;
}

/**
 * Start tracking. Counts an interval that was ALREADY in progress when tracking began, which is the
 * case the reading task's own copy lost.
 */
export function trackHiddenTime(opts: Options = {}): HiddenTimeTracker {
  const clock = opts.clock ?? now;
  const isHidden = opts.isHidden
    ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const target = opts.target
    ?? (typeof document !== 'undefined' ? document : null);

  let accumulated = 0;
  let since: number | null = isHidden() ? clock() : null;
  // An absence that had already started when tracking began still happened, and still cost the
  // participant's attention, so it counts as an event.
  let events = since != null ? 1 : 0;
  let stopped = false;

  const onVisibility = () => {
    if (isHidden()) {
      if (since == null) {
        since = clock();
        events += 1;
      }
      return;
    }
    if (since != null) {
      accumulated += clock() - since;
      since = null;
    }
  };

  const eventName = opts.eventName ?? 'visibilitychange';
  target?.addEventListener(eventName, onVisibility);

  const read = (): HiddenTime => ({
    hiddenMs: Math.round(accumulated + (since != null ? clock() - since : 0)),
    events,
  });

  return {
    read,
    stop: () => {
      if (!stopped) {
        stopped = true;
        target?.removeEventListener(eventName, onVisibility);
      }
      const final = read();
      // Close any interval still open, so a second stop() cannot keep accruing against a clock
      // nobody is watching.
      accumulated = final.hiddenMs;
      since = null;
      return final;
    },
  };
}

/**
 * How long the tablet spent in PORTRAIT, and how many times it was rotated there.
 *
 * The same measurement as hidden time and for the same reason, on an event the visibility API does
 * not report. Rotating a tablet does not fire `visibilitychange`, the page stays visible so nothing
 * is throttled, and the blocking overlay Experiment.tsx renders over the task is a SIBLING of it —
 * the task underneath stays mounted and keeps running. The reaction-time block is a bare async loop
 * with no abort path, the visual-search timer is armed once and never paused, and the reading page
 * clock keeps accruing.
 *
 * So a rotation mid-block silently converts go trials into misses that are indistinguishable in the
 * export from genuine inattention, burns the search limit, and inflates the reading exposure the
 * ocular window is counted over — while the overlay tells the participant "The task resumes as soon
 * as the tablet is landscape again", which was not true of any of the four tasks.
 *
 * Pausing every task is the better fix and a much larger change: it means an abort path through an
 * async trial loop, a re-armable search timer, and a decision about what a half-delivered trial
 * means. That is a protocol question as much as an engineering one. This is the smaller half of the
 * bargain the rest of this export already keeps — the interval is MEASURED and exported, so affected
 * conditions can be found and excluded rather than silently entering the analysis.
 */
export function trackPortraitTime(opts: Options = {}): HiddenTimeTracker {
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(orientation: portrait)')
    : null;
  return trackHiddenTime({
    clock: opts.clock,
    target: opts.target ?? mq ?? undefined,
    isHidden: opts.isHidden ?? (() => mq?.matches === true),
    eventName: opts.eventName ?? 'change',
  });
}

/**
 * Time a full-screen field was NOT in front of the participant: the document hidden OR the tablet in
 * portrait, counted once where the two overlap.
 *
 * For the grey adaptation field. It subtracted hidden time only, so a tablet rotated to portrait
 * mid-field — which puts the blocking overlay, a dark navy panel, over the grey — counted the whole
 * rotation as adaptation delivered. The eye was adapting to the overlay, and `adaptation_delivered_ms`
 * certified a grey field that was not there. The two sources are merged into one "blocked" signal so
 * an interval that is both hidden and portrait is not subtracted twice.
 */
export function trackFieldBlockedTime(opts: {
  documentTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  orientationTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  isDocumentHidden?: () => boolean;
  isPortrait?: () => boolean;
  clock?: () => number;
} = {}): HiddenTimeTracker {
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(orientation: portrait)')
    : null;
  const docTarget = opts.documentTarget ?? (typeof document !== 'undefined' ? document : undefined);
  const orientTarget = opts.orientationTarget !== undefined ? opts.orientationTarget : mq;
  const docHidden = opts.isDocumentHidden
    ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const portrait = opts.isPortrait ?? (() => mq?.matches === true);

  // One relay, so the shared implementation sees a single blocked/unblocked signal.
  const relay = new EventTarget();
  const fire = () => { relay.dispatchEvent(new Event('blocked')); };
  docTarget?.addEventListener('visibilitychange', fire);
  orientTarget?.addEventListener('change', fire);
  const inner = trackHiddenTime({
    target: relay, eventName: 'blocked', clock: opts.clock,
    isHidden: () => docHidden() || portrait(),
  });
  return {
    read: inner.read,
    stop: () => {
      docTarget?.removeEventListener('visibilitychange', fire);
      orientTarget?.removeEventListener('change', fire);
      return inner.stop();
    },
  };
}
