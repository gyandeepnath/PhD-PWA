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
 *
 * Here rather than in main.tsx (Round 86), so a screen that catches its own failed write — to hand its
 * controls back, as the camera check's Continue does — reports it the same way, instead of either
 * swallowing it or leaving it unhandled. main.tsx routes every unhandled rejection here.
 */
export function reportAsyncFailure(detail: string) {
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


/** The panel's line for a thrown value. */
export function describeFailure(r: unknown): string {
  return r instanceof Error ? `${r.name}: ${r.message}` : String(r);
}
