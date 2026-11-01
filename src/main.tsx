import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/theme.css';
import { installViewportScale } from './lib/viewportScale';
import { installUpdateWatch } from './lib/swUpdate';
import { reportAsyncFailure, describeFailure } from './lib/asyncFailure';
import { installTapGuard } from './lib/tapGuard';

// See lib/asyncFailure.ts for why every unhandled rejection is named on screen.
window.addEventListener('unhandledrejection', (e) => {
  reportAsyncFailure(describeFailure(e.reason));
});
window.addEventListener('error', (e) => {
  // Chunk-load failures land here, and they are the signature of a service-worker update having
  // replaced the assets this page was built from while the page is still running.
  if (e.message && /chunk|dynamically imported module|Importing a module script failed/i.test(e.message)) {
    reportAsyncFailure(`${e.message} — the app may have updated while running. Do not reload mid-condition; tell the researcher.`);
  }
});

/*
 * Fit the design canvas to this device BEFORE the first paint.
 *
 * theme.css scales #root by --vl-scale and nothing ever set it, so every device rendered at the
 * design size. #root is overflow:hidden and body is touch-action:none, both deliberately, so on a
 * shorter viewport the clipped part of a screen was not merely off-view — it was unreachable by
 * any gesture. That is how a tablet 20% shorter than the design canvas produced setup screens whose
 * Continue button could not be pressed at all.
 */
installViewportScale();

/*
 * A touch that starts as the screen changes was aimed at the screen that went: dropped before any
 * handler sees it, for the life of the app (lib/tapGuard.ts; audit 86). Each screen arms it as it
 * changes.
 */
installTapGuard();

/*
 * Watch for a newer build. vite.config.ts registers with 'prompt' precisely so a new worker cannot
 * seize a running session — but nothing was listening for the prompt, so an installed tablet served
 * its original build forever and no amount of closing tabs or reinstalling the shortcut changed it.
 * UpdateBanner offers the waiting build on the between-sessions screens only.
 */
void installUpdateWatch();

// Note: StrictMode is intentionally omitted — its dev double-invocation of effects double-requests
// the camera and re-runs FaceMesh init (the original VisuLab was a production build with no
// StrictMode). Production behaviour is unchanged.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
