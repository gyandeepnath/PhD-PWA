import { useEffect, useState } from 'react';
import { onUpdateWaiting, applyUpdate } from '@/lib/swUpdate';
import { APP_VERSION, GIT_HASH } from '@/lib/env';

/**
 * Offer a waiting build to the operator, between sessions only.
 *
 * Render this on the landing and session-manager screens and nowhere else. Applying an update
 * reloads the page so the new worker takes control, which is exactly the operation that must never
 * happen during a sitting — see swUpdate.ts for why the precache swap costs the session.
 *
 * It also shows the running build, because "did my fix reach the tablet?" was unanswerable from the
 * device. A deployed fix and a stale cache look identical from the outside, and the whole point of
 * a version stamp is to tell those two apart in one glance rather than by experiment.
 */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => onUpdateWaiting(setWaiting), []);

  if (!waiting) return null;

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
          Apply it now, between sessions. Never during a sitting — it reloads the app.
        </div>
      </div>
      <button
        onClick={() => { setApplying(true); void applyUpdate(); }}
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
