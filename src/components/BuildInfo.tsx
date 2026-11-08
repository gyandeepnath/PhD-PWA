/**
 * Which build is running, and a way to ask for a newer one — on every screen an operator starts from.
 *
 * WHY. The investigator reported that the app "keeps updating but the version remains the same". On
 * screen it did: the landing page's only stamp was `v2.1.0 · <hash>`, the version never changed, and
 * nothing said when the build was made. A deployed fix and a stale cache looked identical from the
 * tablet. `buildIdentity()` (lib/env.ts) now says "VisuLab 2.2.0 · built 4 Oct 2026 09:33 UTC ·
 * e05d3c4", and the build time changes with every deployment.
 *
 * And the browser only looks for a new build when the page is navigated to — which an installed app
 * reopened from recent apps never is — so "Check for updates" asks the server on demand. It applies
 * nothing: whatever it finds installs and waits for UpdateBanner's gated "Update now".
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { buildIdentity } from '@/lib/env';
import { checkForUpdate, onOfflineCopy, onUpdateWaiting, type OfflineCopyState, type UpdateCheck } from '@/lib/swUpdate';

/** "VisuLab 2.2.0 · built 4 Oct 2026 09:33 UTC · e05d3c4", as text. */
export function BuildIdentity({ testId = 'build-identity', style }: { testId?: string; style?: CSSProperties }) {
  return (
    <span data-testid={testId} className="font-lab" style={{ fontSize: 14, color: '#4a4a60', ...style }}>
      {buildIdentity()}
    </span>
  );
}

/** Whether a newer build is installed and waiting (swUpdate.onUpdateWaiting), kept live. */
export function useUpdateWaiting(): boolean {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => onUpdateWaiting(setWaiting), []);
  return waiting;
}

const CHECK_TEXT: Record<UpdateCheck, string> = {
  waiting: 'A newer build is ready and waiting — see the notice.',
  installing: 'A newer build was found and is downloading. A notice appears when it is ready.',
  current: 'This is the newest build the server has.',
  unavailable: 'Updates cannot be checked here: no service worker controls this page — so there is no offline copy either (see the line above).',
  offline: 'Could not reach the server. Connect the tablet to the internet and try again.',
};

/**
 * A "Check for updates" button and what it found. `auto` checks once on mount as well — used on the
 * landing page, where a waiting build can still be applied, so a build published since the app was
 * last relaunched is found before a sitting starts.
 */
export function UpdateCheckButton({ auto = false }: { auto?: boolean }) {
  const [state, setState] = useState<UpdateCheck | 'checking' | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const run = () => {
    setState('checking');
    void checkForUpdate().then((r) => { setState(r); setAt(new Date()); });
  };
  useEffect(() => {
    if (!auto) return undefined;
    let live = true;
    void checkForUpdate().then((r) => {
      // Only a find is worth reporting unasked; "newest" and "unavailable" stay quiet until tapped.
      if (live && (r === 'waiting' || r === 'installing')) { setState(r); setAt(new Date()); }
    });
    return () => { live = false; };
  }, [auto]);
  const hhmm = at ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button type="button" data-testid="update-check" onClick={run} disabled={state === 'checking'}
        className="font-sans text-[15px]"
        style={{
          minHeight: 'var(--vl-nav-chip-h)', padding: '6px 14px', borderRadius: 10, border: '1px solid #bdb8ae',
          background: '#fff', color: '#1a1a2e', cursor: state === 'checking' ? 'progress' : 'pointer',
        }}>
        {state === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
      {state && state !== 'checking' && (
        <span data-testid="update-check-result" role="status" className="font-sans text-[15px]" style={{ color: '#3a3a4a' }}>
          {CHECK_TEXT[state]}{hhmm && state === 'current' ? ` (checked ${hhmm})` : ''}
        </span>
      )}
    </span>
  );
}

/** The offline copy's state (swUpdate.onOfflineCopy), kept live. */
export function useOfflineCopy(): OfflineCopyState {
  const [s, setS] = useState<OfflineCopyState>({ state: 'checking', reason: null });
  useEffect(() => onOfflineCopy(setS), []);
  return s;
}

/**
 * WHETHER THE APP WILL OPEN WITH THE NETWORK OFF (Round 92, audit 86 P4, P9). Nothing said so: the
 * operator could switch on aeroplane mode before the 45 MB download had finished, and a tablet run from
 * the field package's HTTPS server never had a copy at all — Chrome will not install one from a site
 * with a self-signed certificate, even once its warning has been accepted — with nothing on screen.
 */
export function OfflineCopyStatus() {
  const { state, reason } = useOfflineCopy();
  const text = state === 'ready'
    ? 'Offline copy: ready — the app opens with the network off.'
    : state === 'installing'
      ? 'Offline copy: downloading — keep the tablet online until this says ready.'
      : state === 'none'
        ? `Offline copy: NOT installed — ${reason ?? 'no service worker here'}. Every reload needs the server this page came from. `
          + 'For sittings without a network, open the study\'s HTTPS address (DEPLOYMENT.md); the field server\'s self-signed HTTPS cannot install one.'
        : 'Offline copy: checking…';
  return (
    <span data-testid="offline-copy" data-state={state} role="status" className="font-sans text-[15px]"
      style={{ color: state === 'none' ? '#8a1c1c' : '#3a3a4a', fontWeight: state === 'none' ? 600 : 400 }}>
      {text}
    </span>
  );
}

/**
 * The identity line and the check, together: the landing page's footer, the session manager's header
 * and pre-flight's device box all use this, so the three cannot disagree about the build. The offline
 * copy's state sits under them (Round 92).
 */
export function BuildInfo({ auto = false, testId = 'build-stamp' }: { auto?: boolean; testId?: string }) {
  const waiting = useUpdateWaiting();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <BuildIdentity testId={testId} />
        {waiting && (
          <span data-testid="update-waiting-flag" className="font-sans text-[15px] font-medium"
            style={{ padding: '4px 10px', borderRadius: 8, background: '#1a1a2e', color: '#fff' }}>
            Newer build waiting
          </span>
        )}
        <UpdateCheckButton auto={auto} />
      </div>
      <OfflineCopyStatus />
    </div>
  );
}
