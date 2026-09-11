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
 * search time against a 40-second limit, response times on the questionnaires, the exposure window
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

  target?.addEventListener('visibilitychange', onVisibility);

  const read = (): HiddenTime => ({
    hiddenMs: Math.round(accumulated + (since != null ? clock() - since : 0)),
    events,
  });

  return {
    read,
    stop: () => {
      if (!stopped) {
        stopped = true;
        target?.removeEventListener('visibilitychange', onVisibility);
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
