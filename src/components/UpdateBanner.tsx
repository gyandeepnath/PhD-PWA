import { useCallback, useEffect, useState } from 'react';
import { onUpdateWaiting, applyUpdate } from '@/lib/swUpdate';
import { sittingsInProgress, sessionLabel } from '@/storage/gather';
import { APP_VERSION, GIT_HASH } from '@/lib/env';

/**
 * Offer a waiting build to the operator — but only when no sitting is open.
 *
 * WHY THE GATE. Rendering this component on the landing and session-manager screens was meant to
 * be the safeguard: those are between-sessions screens, so applying an update could never reload
 * the app mid-protocol. Two paths went straight through it.
 *
 * The first is the Pause button. Pause exits the running experiment to the SESSION MANAGER, which
 * is where this banner renders. So a paused sitting — a participant sitting in the room, seven
 * conditions in — put the operator on a screen offering "Apply it now, between sessions", which is
 * the one moment that sentence is false. The banner's own reassurance was the trap.
 *
 * The second needs no operator action at all. `registerSW` in prompt mode attaches a `controlling`
 * listener in every tab that sees the waiting worker, and `skipWaiting()` makes the new worker take
 * over every client the old one controlled. So pressing Update in one tab reloads EVERY open tab of
 * the app, including one that is mid-condition in another window.
 *
 * Both are closed by asking the database rather than the screen. `sittingsInProgress()` reads
 * IndexedDB, which every tab on the device shares, so a sitting open in any window blocks the
 * button in all of them. The notice stays visible either way: hiding it silently would bring back
 * the failure this whole module exists for — a deployed fix and a stale cache look identical from
 * the tablet, and telling them apart took a full round trip of screenshots.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** null while the check is still running: neither offer nor refuse on an unanswered question. */
  const [openSittings, setOpenSittings] = useState<string[] | null>(null);

  useEffect(() => onUpdateWaiting(setWaiting), []);

  const recheck = useCallback(() => {
    let live = true;
    sittingsInProgress()
      .then((ss) => { if (live) setOpenSittings(ss.map(sessionLabel)); })
      // A database that cannot be read is not evidence that nothing is running. Refuse rather than
      // assume: the update waits for a screen where the question can be answered.
      .catch(() => { if (live) setOpenSittings(['(could not read the session list)']); });
    return () => { live = false; };
  }, []);

  // Re-checked on mount and whenever a build starts waiting. The shell mounts a fresh banner per
  // view, so finishing a sitting and returning to the manager asks again.
  useEffect(() => (waiting ? recheck() : undefined), [waiting, recheck]);

  if (!waiting) return null;

  const blocked = openSittings == null || openSittings.length > 0;

  const apply = () => {
    setApplying(true);
    setFailure(null);
    void applyUpdate().catch((err: unknown) => {
      // Normally unreachable, because a successful apply reloads the page and this component goes
      // with it. When it is reached, the latch has to be released: leaving the button disabled
      // showing "Updating…" for ever tells the operator the update is in progress when it has in
      // fact failed, and the only build that ever reaches the tablet is the stale one.
      setApplying(false);
      setFailure(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        background: '#1a1a2e', color: '#fff', borderRadius: 14,
        padding: '14px 18px', boxShadow: '0 6px 24px rgba(0,0,0,.25)',
      }}
    >
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div className="font-lab text-sm" style={{ fontWeight: 600 }}>
          A newer version of VisuLab is ready
        </div>
        <div className="font-lab text-xs" style={{ opacity: 0.8, marginTop: 2 }}>
          {openSittings == null
            ? 'Checking whether a sitting is open…'
            : blocked
              ? `Not now: ${openSittings.join(', ')} is still in progress, in this or another window. `
                + 'Applying an update reloads the app in every open window. Finish or delete the '
                + 'sitting, then this will offer to update.'
              : 'Apply it now, between sessions. Never during a sitting — it reloads the app.'}
        </div>
        {failure && (
          <div className="font-lab text-xs" style={{ marginTop: 6, color: '#ffb4b4' }}>
            The update did not apply: {failure}
          </div>
        )}
      </div>
      {!blocked && (
        <button
          onClick={apply}
          disabled={applying}
          className="font-lab text-sm"
          style={{
            flex: '0 0 auto', background: '#fff', color: '#1a1a2e',
            border: 'none', borderRadius: 10, padding: '10px 18px',
            cursor: applying ? 'progress' : 'pointer', fontWeight: 600,
          }}
        >
          {applying ? 'Updating…' : 'Update now'}
        </button>
      )}
    </div>
  );
}

/**
 * The build this tablet is actually running.
 *
 * Small and unobtrusive, but always present on the landing screen: without it, a stale cache and a
 * failed deployment are indistinguishable from the device, and distinguishing them took a full
 * round trip of screenshots.
 */
export function BuildStamp() {
  return (
    <div
      className="font-lab text-xs"
      style={{ position: 'fixed', right: 12, bottom: 10, zIndex: 30, opacity: 0.45, pointerEvents: 'none' }}
    >
      v{APP_VERSION} · {GIT_HASH}
    </div>
  );
}
