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
      onRegisteredSW(_url: string, r: ServiceWorkerRegistration | undefined) {
        registration = r ?? null;
      },
    });
  } catch {
    /* No service worker in this environment; the app runs online-only. */
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
