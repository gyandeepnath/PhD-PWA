import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/theme.css';
import { installViewportScale } from './lib/viewportScale';
import { installUpdateWatch } from './lib/swUpdate';

/**
 * Surface asynchronous failures, which the React error boundary cannot see.
 *
 * Every persistence call in the experiment flow is an `await put(...)` inside an async event
 * handler, and the stage only advances after those awaits resolve. If one rejects — a storage
 * quota exceeded, a connection the browser terminated while the tab was backgrounded, a version
 * conflict after an update — the rejection is unhandled: the stage never advances, the screen sits
 * on the finished task, and the operator sees an app that appears merely slow. ErrorBoundary
 * catches render errors only, so nothing in the app reported this.
 *
 * A silent stall is the worst outcome available here, because the operator's reasonable response
 * is to wait, then reload, and a reload mid-condition costs the condition. Naming the failure lets
 * them write it down and act on it.
 */
function reportAsyncFailure(detail: string) {
  const existing = document.getElementById('visulab-async-error');
  if (existing) {
    existing.querySelector('[data-detail]')!.textContent = detail;
    return;
  }
  const panel = document.createElement('div');
  panel.id = 'visulab-async-error';
  panel.setAttribute('role', 'alert');
  panel.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
    'background:#7a1f1f', 'color:#fff', 'padding:14px 18px',
    'font:14px/1.5 system-ui,sans-serif', 'box-shadow:0 -2px 12px rgba(0,0,0,.3)',
  ].join(';');
  panel.innerHTML =
    '<strong>Something failed in the background.</strong> The session may not have saved the last '
    + 'step. Note the time and tell the researcher before continuing.<br>'
    + '<span data-detail style="opacity:.85;font-family:ui-monospace,monospace;font-size:12px"></span>';
  panel.querySelector('[data-detail]')!.textContent = detail;
  document.body.appendChild(panel);
}

window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  reportAsyncFailure(r instanceof Error ? `${r.name}: ${r.message}` : String(r));
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
