/**
 * THE SYSTEM BACK GESTURE IS THE TOP-LEFT CHIP, NEVER A WAY OUT OF THE APP (Round 87, audit 86 F6).
 *
 * The app kept all of its navigation in React state and never touched the browser's history, so the
 * page had no history entry of its own to go back to. On the tablet — the installed app, full screen,
 * MIUI gesture navigation — an edge swipe is Back, and with nothing to go back to Chrome closes the app
 * window. In the audit, Back on page 2 of a display unloaded the app (in a tab, to about:blank); the
 * sitting came back under Resume, with that display lost and run again as a second exposure of its
 * passage. Nothing asked first. A swipe from the edge is easy to make by accident when a hand rests on
 * the tablet, and the participant holds it.
 *
 * WHAT BACK DOES NOW. Exactly what the operator chip at the top left of the screen does (NavChip.tsx):
 * Pause, with its confirmation, inside a display; "Exit — resume later", with its confirmation, on a
 * set-up screen, the break and the closing questionnaires; Cancel on the session form; Back to sessions
 * on the dashboard; Back to home in the session manager. Where the chip is withheld — the colour-vision
 * plates, the calibration dots, the self-test, the reaction trials, the thank-you screen, while a
 * session is being written — Back does nothing at all: the same rule the chip's own absence states
 * (experiment/navigation.ts). With a confirmation open, Back answers it as declined, as Escape does
 * (ConfirmDialog.tsx): it can never be what confirms leaving. Under a blocking notice that covers the
 * chip (the portrait block, the camera notices) Back does nothing; the notice has its own buttons.
 * On the landing page nothing is claimed and Back belongs to the browser again, so the app closes as
 * any Android app does from its first screen (the first press there takes the app's own entry, the
 * second closes it).
 *
 * HOW. One history entry of the app's own (the "sentinel") is kept on top of the entry the app was
 * opened on, both the same document. Back takes the browser from the sentinel to the entry beneath it
 * without leaving the page — a `popstate`, not an unload — and this module puts the sentinel straight
 * back and hands the gesture to whatever claims it: the topmost of the claims below, by layer (a
 * notice over a dialog over a chip over the screen) and, within a layer, the latest. The URL never
 * changes. The sentinel carries a mark unique to this load of the page, so after a reload — which keeps
 * the entry and its state, but not the document the entry beneath it belonged to — the old mark is not
 * taken for this page's own, and a new sentinel is pushed over it; going back across documents would
 * reload the app.
 *
 * WHAT IT CANNOT DO. Chrome does not let a page keep the Back button forever. Its "history manipulation
 * intervention" (Chromium docs/history_manipulation_intervention.md, read in full through a mirror:
 * docs/CITATION_VERIFICATION.md #71) makes Back skip an entry whose page added history without a user
 * activation — a touch — and, since a later fix, does not let going back and forth between a page's own
 * entries stand in for one; on Android, with every earlier entry skipped, Back closes the tab (the
 * document's word; that the installed app's window closes the same way is a reading the document does
 * not state, and it was not checked on the tablet). Every screen of the study is answered by touch, so
 * after a tap the app's entry is there for the next Back; but two Back gestures with no touch between
 * them may still reach past it and close the app on the tablet, as before — the sitting is then
 * resumable, and the display restarted, exactly as after a crash. Not measured on the tablet (Round 87):
 * the browser's Back in the test suite (page.goBack) goes to the entry before, skipped or not.
 *
 * TIMING. Nothing here listens to input or runs per frame: one `popstate` listener, and one
 * `history.pushState` when a claim first appears and after each Back. It changes nothing a task
 * measures; a Pause confirmation that Back raises over a display is timed as a notice exactly like the
 * one the chip raises (Experiment.tsx pauseConfirmOverTask).
 */
import { useEffect, useRef } from 'react';

/** What claims the gesture, lowest first: a claim in a higher layer is drawn over a lower one. */
export type BackLayer = 'screen' | 'control' | 'dialog' | 'notice';
const RANK: Record<BackLayer, number> = { screen: 0, control: 1, dialog: 2, notice: 3 };

interface Claim { layer: BackLayer; seq: number; run: () => void }

/** The key of the sentinel's history state. */
const KEY = 'visulabBack';
/** This load of the page: a sentinel left by an earlier load (a reload keeps the entry) is not ours. */
const LOAD = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const claims = new Set<Claim>();
let seq = 0;
let target: Window | null = null;

const onSentinel = (w: Window): boolean => {
  const s = w.history.state as Record<string, unknown> | null;
  return s != null && typeof s === 'object' && s[KEY] === LOAD;
};

/** Keep the app's own entry on top while anything claims the gesture. */
function arm(): void {
  if (!target || claims.size === 0 || onSentinel(target)) return;
  target.history.pushState({ [KEY]: LOAD }, '');
}

function topClaim(): Claim | null {
  let top: Claim | null = null;
  for (const c of claims) {
    if (!top || RANK[c.layer] > RANK[top.layer] || (RANK[c.layer] === RANK[top.layer] && c.seq > top.seq)) top = c;
  }
  return top;
}

/**
 * Claim the gesture: while the claim stands and is the topmost, Back runs `run`. Returns the release.
 * A claim whose `run` does nothing makes Back do nothing.
 */
export function claimSystemBack(layer: BackLayer, run: () => void): () => void {
  const claim: Claim = { layer, seq: ++seq, run };
  claims.add(claim);
  arm();
  return () => { claims.delete(claim); };
}

/**
 * Listen for the gesture, for the life of the app. Returns the uninstaller. The sentinel is pushed by
 * the first claim, not here: until a screen claims Back (the landing page claims nothing) it is the
 * browser's.
 */
export function installSystemBack(win: Window = window): () => void {
  target = win;
  const onPop = () => {
    // Forward onto the sentinel (after Back on the landing page): already where it should be.
    if (onSentinel(win)) return;
    const top = topClaim();
    // Nothing claims it here: the gesture was the browser's, and the app's entry is gone with it.
    if (!top) return;
    win.history.pushState({ [KEY]: LOAD }, '');
    top.run();
  };
  win.addEventListener('popstate', onPop);
  arm();
  return () => {
    win.removeEventListener('popstate', onPop);
    if (target === win) target = null;
  };
}

/** No claims and no window. For tests. */
export function resetSystemBack(): void {
  claims.clear();
  seq = 0;
  target = null;
}

/**
 * Claim the system Back gesture for as long as this component is mounted and `enabled`: Back runs the
 * latest `onBack`, or does nothing when it is null (a control that is disabled, a screen that offers no
 * way out).
 */
export function useSystemBack(layer: BackLayer, onBack: (() => void) | null, enabled = true): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!enabled) return undefined;
    return claimSystemBack(layer, () => latest.current?.());
  }, [layer, enabled]);
}
