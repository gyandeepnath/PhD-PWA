/**
 * Keep the screen awake for the duration of a sitting.
 *
 * There was no wake lock at all, and the operator manual's substitute — "screen timeout disabled"
 * — is not achievable on every target device. On stock Android the longest screen timeout is 30
 * MINUTES; there is no "Never". A sitting is about 90 minutes and the reading task asks the
 * participant to read for three of them without touching anything, so the tablet WILL sleep
 * mid-exposure. On iPadOS, Auto-Lock → Never exists but Low Power Mode forces it back to 30 s and
 * greys the setting out.
 *
 * What sleeping costs: requestAnimationFrame stops, so the FaceMesh pump stops and the exposure's
 * ocular samples simply end; on iOS the capture session is suspended and the track may end
 * outright. The adaptation screen, which is also rAF-driven, records a full 60 or 120 s of
 * grey-field adaptation that was in fact delivered against a locked black screen.
 *
 * The lock is released by the browser whenever the page is hidden, so it has to be re-requested on
 * every return to visibility — that is not a workaround, it is the specified behaviour.
 *
 * Absence is reported, never assumed away: `supported` is false where the API does not exist, and
 * the caller surfaces that so the operator knows the device setting is the only defence left.
 */
export interface WakeLockHandle {
  /** Whether the API exists at all on this device. */
  supported: boolean;
  /** Whether a lock is currently held. */
  active: () => boolean;
  release: () => Promise<void>;
}

interface SentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (t: string, cb: () => void) => void;
}

type WakeLockCapableNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<SentinelLike> };
};

export function acquireScreenWakeLock(): WakeLockHandle {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as WakeLockCapableNavigator | undefined;
  const api = nav?.wakeLock;
  if (!api || typeof api.request !== 'function') {
    return { supported: false, active: () => false, release: async () => {} };
  }

  let sentinel: SentinelLike | null = null;
  let disposed = false;

  const request = async () => {
    if (disposed || sentinel) return;
    try {
      const s = await api.request('screen');
      if (disposed) { void s.release(); return; }
      sentinel = s;
      // The browser releases the lock on hide; clear our handle so the next visibility change
      // re-requests rather than believing it still holds one.
      s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    } catch {
      /* denied or unavailable in this context — the operator banner covers it */
    }
  };

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void request();
  };

  void request();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return {
    supported: true,
    active: () => sentinel != null && !sentinel.released,
    release: async () => {
      disposed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s && !s.released) { try { await s.release(); } catch { /* already gone */ } }
    },
  };
}
