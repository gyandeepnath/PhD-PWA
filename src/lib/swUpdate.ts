/**
 * The missing half of the service-worker update policy.
 *
 * vite.config.ts sets `registerType: 'prompt'` with `skipWaiting` and `clientsClaim` off, and the
 * reasoning there is sound: `autoUpdate` would let a new worker seize a page mid-session, replacing
 * the precache so the previous build's content-hashed chunks stop resolving. The two things this
 * app loads lazily are the dashboard, which is the only export path, and MediaPipe, which produces
 * the primary outcome. Losing either 70 minutes into a sitting costs the sitting.
 *
 * But 'prompt' is a contract with two sides, and only one was written. It means "install the new
 * worker, leave it waiting, and let the APP decide when to activate it" — and nothing in the app
 * ever registered for that decision or made it. The consequence was total: a tablet that had once
 * loaded the app kept serving that build forever. Closing tabs did not help, and neither did
 * removing and re-adding the home-screen shortcut, because the shortcut is not the worker — the
 * worker belongs to the origin and survives both. The only escape was clearing the site's data, an
 * instruction nothing in the app gave.
 *
 * That was discovered the worst way. A fix for the face tracker was deployed, verified live, and
 * the tablet went on reporting the identical error from the old cached build, which looked exactly
 * like a fix that had not worked.
 *
 * So: this module registers the worker, notices when a new build is waiting, and exposes an
 * explicit apply step. `UpdateBanner` renders that step ONLY on the landing and session-manager
 * screens — between sessions, never inside one — which preserves the original safety property
 * while giving the update somewhere to happen.
 */

type Listener = (waiting: boolean) => void;

/**
 * WHETHER THIS TABLET HOLDS AN OFFLINE COPY OF THE APP (Round 92, audit 86 P4, P9).
 *
 * The app works without a network only once its service worker has installed and precached every
 * asset — about 45 MB since the second face tracker was bundled — and nothing on screen said whether
 * that had happened. An operator who switched on aeroplane mode before the download finished had no
 * offline app and no warning; and a tablet that ran from the field package's own HTTPS server never
 * got one at all, because Chrome refuses to install a service worker from a site whose certificate it
 * does not trust, even after the warning has been accepted (the field server's certificate is
 * self-signed). The registration's failure was swallowed, and "Check for updates" blamed "a development
 * server". The state is now kept and shown beside the build (components/BuildInfo.tsx):
 *
 *   ready       — a service worker controls this page, or has just finished precaching: the app will
 *                 open with the network off.
 *   installing  — a worker is installing: the download is under way; keep the tablet online.
 *   none        — no worker could be installed here (`reason` says what is known), or the browser has
 *                 none: the app needs the server it was loaded from for every reload.
 *   checking    — not yet known (the first moments after start-up).
 */
export type OfflineCopy = 'checking' | 'ready' | 'installing' | 'none';
export interface OfflineCopyState { state: OfflineCopy; reason: string | null }
type OfflineListener = (s: OfflineCopyState) => void;

let offline: OfflineCopyState = { state: 'checking', reason: null };
/** How long after start-up a missing registration is taken to mean none is coming. */
export const OFFLINE_SETTLE_MS = 8000;
const offlineListeners = new Set<OfflineListener>();

function setOffline(next: OfflineCopyState): void {
  // 'ready' is final for this page: the copy exists whatever a later check finds.
  if (offline.state === 'ready' && next.state !== 'ready') return;
  offline = next;
  for (const l of offlineListeners) l(offline);
}

/** Subscribe to the offline copy's state. Returns an unsubscribe function. */
export function onOfflineCopy(l: OfflineListener): () => void {
  offlineListeners.add(l);
  l(offline);
  return () => offlineListeners.delete(l);
}

/** The offline copy's state now. */
export function offlineCopy(): OfflineCopyState {
  return offline;
}

/** Why a registration failed, as far as the error says. Chrome names a certificate error in the console only. */
function registrationFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /certificate|SSL/i.test(msg)
    ? 'the browser refused this site\'s certificate for the offline copy'
    : `the browser would not install the offline copy here${msg ? ` (${msg.slice(0, 160)})` : ''}`;
}

/**
 * The state from the browser itself: a page a service worker controls was served by it, so the copy
 * exists; a registration with a worker installing is downloading it.
 */
function offlineFromBrowser(r: ServiceWorkerRegistration | null): void {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (sw?.controller) { setOffline({ state: 'ready', reason: null }); return; }
  if (r?.installing || r?.waiting) { setOffline({ state: 'installing', reason: null }); return; }
  if (r?.active) { setOffline({ state: 'ready', reason: null }); }
}

let updateWaiting = false;
const listeners = new Set<Listener>();
let applyFn: ((reload: boolean) => Promise<void>) | null = null;
let registered = false;
/** The worker's registration, once the browser has one: what "Check for updates" asks. */
let registration: ServiceWorkerRegistration | null = null;

function announce(): void {
  for (const l of listeners) l(updateWaiting);
}

/** Subscribe to "a new build is waiting". Returns an unsubscribe function. */
export function onUpdateWaiting(l: Listener): () => void {
  listeners.add(l);
  l(updateWaiting);
  return () => listeners.delete(l);
}

/** Whether a new build is installed and waiting to take over. */
export function isUpdateWaiting(): boolean {
  return updateWaiting;
}

/**
 * Register the service worker and watch for a waiting update.
 *
 * Called once at startup. Failures are swallowed deliberately: an unregistrable worker means no
 * offline support, which is a degradation, while throwing here would take the whole app down.
 */
export async function installUpdateWatch(): Promise<void> {
  if (registered) return;
  registered = true;
  const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  if (!swSupported) setOffline({ state: 'none', reason: 'this browser has no service workers' });
  // A page already controlled was served from the copy: say so before the registration resolves.
  else offlineFromBrowser(null);
  try {
    // Virtual module from vite-plugin-pwa. Absent in dev unless devOptions are enabled, and absent
    // in unit tests, so the import is guarded rather than assumed.
    const { registerSW } = await import('virtual:pwa-register');
    applyFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        updateWaiting = true;
        announce();
      },
      // The first install has precached everything: the copy exists (audit 86 P4).
      onOfflineReady() {
        setOffline({ state: 'ready', reason: null });
      },
      onRegisteredSW(_url: string, r: ServiceWorkerRegistration | undefined) {
        registration = r ?? null;
        offlineFromBrowser(registration);
        // A first install reports itself through onOfflineReady; one that fails while installing leaves
        // no worker at all, which this catches.
        registration?.installing?.addEventListener?.('statechange', (e) => {
          if ((e.target as ServiceWorker | null)?.state === 'redundant' && !navigator.serviceWorker?.controller) {
            setOffline({ state: 'none', reason: 'the offline copy started to download and failed' });
          }
        });
      },
      // Registration refused — a self-signed certificate is the case that matters (audit 86 P9).
      onRegisterError(err: unknown) {
        setOffline({ state: 'none', reason: registrationFailure(err) });
      },
    });
    // The development server's registerSW does nothing and calls nothing back. If no registration
    // exists after a while, there is no offline copy coming; a slow one that turns up later still
    // moves this on (only 'ready' is final).
    if (swSupported) setTimeout(() => {
      if (offline.state !== 'checking') return;
      void navigator.serviceWorker.getRegistration().then((r) => {
        if (offline.state !== 'checking') return;
        if (r) offlineFromBrowser(r);
        else setOffline({ state: 'none', reason: 'no service worker was registered from this server' });
      }).catch(() => setOffline({ state: 'none', reason: 'no service worker was registered from this server' }));
    }, OFFLINE_SETTLE_MS);
  } catch {
    /* No service worker in this environment (the development server); the app runs online-only. */
    setOffline({ state: 'none', reason: 'this server provides no service worker (a development server)' });
  }
}

/**
 * Activate the waiting build and reload.
 *
 * Only ever called from a between-sessions screen. The reload is the point: the waiting worker
 * takes control and the page re-fetches from the new precache, which is precisely the operation
 * that must never happen mid-protocol.
 */
export async function applyUpdate(): Promise<void> {
  if (!applyFn) {
    /*
     * Unreachable in the shipped app, and deliberately a thrown error rather than a fallback,
     * because what used to be here was not one.
     *
     * registerSW() returns its update function synchronously and unconditionally — even in a
     * browser with no service worker at all — so applyFn is assigned the moment installUpdateWatch's
     * dynamic import resolves. updateWaiting turns true only from onNeedRefresh, which cannot fire
     * before that, and UpdateBanner is the sole caller and renders only while updateWaiting is
     * true. There is no ordering in which applyFn is null here.
     *
     * The previous branch called location.reload() with a comment saying that would "pick up
     * whatever the network has". On a page a service worker controls, a reload is served BY that
     * worker out of the same precache, so it would have re-served the stale build — the claim was
     * false as well as dead. Throwing at least reaches the operator through the banner instead of
     * looking like an update that worked.
     */
    throw new Error('No service-worker registration to update through.');
  }
  await applyFn(true);
}

/** What a "Check for updates" tap found. */
export type UpdateCheck =
  /** A newer build is already installed and waiting: the update notice is up. */
  | 'waiting'
  /** A newer build was found and is downloading; the notice appears when it has installed. */
  | 'installing'
  /** The server has nothing newer than the build running now. */
  | 'current'
  /** No service worker here (a test server, an unsupported browser): updates cannot be checked. */
  | 'unavailable'
  /** The check could not reach the server — usually because the tablet is offline. */
  | 'offline';

/**
 * Ask the server, now, whether there is a newer build — the registration's own `update()`.
 *
 * WHY THIS EXISTS. The browser checks for a new worker when a page is NAVIGATED to, and otherwise
 * about once a day. An installed app that is opened from recent apps rather than relaunched is never
 * navigated, so a tablet could sit on yesterday's build all day with nothing to say a newer one had
 * been published. This does not apply anything: a build it finds installs and WAITS (skipWaiting is
 * off), and the gated "Update now" in UpdateBanner is still the only way it takes over. So it is
 * harmless to call during a sitting, which is why pre-flight offers it too.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (updateWaiting) return 'waiting';
  if (!registration) return 'unavailable';
  try {
    await registration.update();
  } catch {
    return 'offline';
  }
  if (updateWaiting || registration.waiting) return 'waiting';
  if (registration.installing) return 'installing';
  return 'current';
}
