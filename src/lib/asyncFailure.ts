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
  const at = new Date().toTimeString().slice(0, 8);
  const existing = document.getElementById('visulab-async-error');
  if (existing) {
    existing.querySelector('[data-detail]')!.textContent = detail;
    existing.querySelector('[data-at]')!.textContent = at;
    return;
  }
  const panel = document.createElement('div');
  panel.id = 'visulab-async-error';
  panel.setAttribute('role', 'alert');
  /*
   * THE PANEL IS READ AND THEN PUT AWAY, AND IT TAKES ITS OWN ROOM WHILE IT IS UP (audit 86 M1, UI-4).
   *
   * It was fixed over the bottom of the screen, never removed, and had no control: on a reading page a
   * one-line failure covered the whole "Next page" button, on pre-flight scrolled to its end both
   * "← Back to the profile" and "All checks pass — continue", and an in-app Exit and Resume kept it,
   * because it lives on document.body. Only reloading the app cleared it — the act that costs a
   * condition. Its instruction, the one line that says what to do (for a full device: stop, export,
   * copy, delete, purge), was 12 px monospace at 85% opacity, under the app's 14 px floor.
   *
   * Now: (1) a Hide button, which removes it — the failure has been named, the time is on it to note,
   * and the next failure raises it again; (2) while it is up its height is published as --vl-alert-h,
   * and the set-up and closing screens, the landing page and the session manager end above it
   * (theme.css), so their buttons are never under it; condition screens do not move — their geometry is
   * the stimulus — and the participant who cannot reach "Next page" is what the panel asks for: stop,
   * tell the researcher, who reads it and hides it; (3) every line in the operator type, Roboto at 15
   * px or more at full opacity, scaled with the canvas above 1 like everything inside #root.
   *
   * It stays outside React on purpose: it reports failures the React tree may not survive.
   */
  const up = 'max(1, var(--vl-scale))';
  panel.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647',
    'background:#7a1f1f', 'color:#fff', `padding:calc(12px * ${up}) calc(18px * ${up})`,
    `font:calc(15px * ${up})/1.45 Roboto,system-ui,sans-serif`, 'box-shadow:0 -2px 12px rgba(0,0,0,.3)',
    'display:flex', 'align-items:center', `gap:calc(16px * ${up})`,
  ].join(';');
  panel.innerHTML =
    '<div style="flex:1 1 auto;min-width:0">'
    + '<strong>Something failed in the background</strong> (at <span data-at></span>). The session may not '
    + 'have saved the last step. Note the time and tell the researcher before continuing.'
    + '<div data-detail style="margin-top:4px;overflow-wrap:anywhere"></div>'
    + '</div>'
    + '<button type="button" data-testid="async-error-hide" '
    + `style="flex:0 0 auto;min-height:calc(44px * ${up});padding:0 calc(18px * ${up});border-radius:10px;`
    + 'border:1px solid #fff;background:transparent;color:#fff;font:inherit;font-weight:500;cursor:pointer">'
    + 'Noted — hide</button>';
  panel.querySelector('[data-detail]')!.textContent = detail;
  panel.querySelector('[data-at]')!.textContent = at;
  document.body.appendChild(panel);

  // Its height in DESIGN px, which is what the screens inside the scaled #root pad by.
  const root = document.documentElement;
  const publish = () => {
    const scale = Number(getComputedStyle(root).getPropertyValue('--vl-scale')) || 1;
    root.style.setProperty('--vl-alert-h', `${Math.ceil(panel.offsetHeight / scale)}px`);
  };
  publish();
  // Its own size changes (a longer detail) and the scale it is divided by (a turn, a split screen).
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
  ro?.observe(panel);
  // A frame later, so the scale the resize sets (viewportScale.ts) is the one read.
  const onResize = () => requestAnimationFrame(publish);
  window.addEventListener('resize', onResize);
  panel.querySelector('[data-testid="async-error-hide"]')!.addEventListener('click', () => {
    ro?.disconnect();
    window.removeEventListener('resize', onResize);
    root.style.removeProperty('--vl-alert-h');
    panel.remove();
  });
}


/** The panel's line for a thrown value. */
export function describeFailure(r: unknown): string {
  return r instanceof Error ? `${r.name}: ${r.message}` : String(r);
}
