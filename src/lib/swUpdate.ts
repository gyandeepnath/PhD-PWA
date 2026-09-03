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
    // No registration to update through — reload anyway so a hard-refreshed page at least picks up
    // whatever the network has.
    location.reload();
    return;
  }
  await applyFn(true);
}
