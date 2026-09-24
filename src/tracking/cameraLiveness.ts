/**
 * Is the camera still delivering frames? — the liveness check behind the camera-lost notice.
 *
 * A camera that is muted or paused, rather than ended, fires no event: frames simply stop, the face
 * tracker stops producing results, and a condition is written with camera_active TRUE over nothing.
 * The tracker yields a result per processed frame whether or not a face is in it, so the time since
 * the last result is a direct liveness signal. It counts only while the page is visible (a hidden
 * page is throttled and its camera may be suspended by design), restarting when the page returns,
 * and it is armed only after the first result, because the model loads before any frame is processed.
 */
export interface LivenessDeps {
  /** When the tracker last produced a result; null before the first. Written by the tracker. */
  lastResultAt: { current: number | null };
  isVisible: () => boolean;
  now: () => number;
  stallMs: number;
  onStall: () => void;
  /** Called when the page becomes visible again: a chance to restart a paused video element. */
  onVisible?: () => void;
  /** Injected for tests. */
  every?: (fn: () => void, ms: number) => () => void;
  visibilityTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

export function startLivenessCheck(d: LivenessDeps): () => void {
  const every = d.every ?? ((fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); });
  const target = d.visibilityTarget !== undefined ? d.visibilityTarget
    : (typeof document !== 'undefined' ? document : null);
  let fired = false;

  const onVisibility = () => {
    if (!d.isVisible()) return;
    // Hidden time is not a stall: restart the clock, if it was running at all.
    if (d.lastResultAt.current != null) d.lastResultAt.current = d.now();
    d.onVisible?.();
  };
  target?.addEventListener('visibilitychange', onVisibility);

  const cancel = every(() => {
    if (fired) return;
    const last = d.lastResultAt.current;
    if (last != null && d.isVisible() && d.now() - last > d.stallMs) {
      fired = true;
      d.onStall();
    }
  }, 1000);

  return () => {
    cancel();
    target?.removeEventListener('visibilitychange', onVisibility);
  };
}
