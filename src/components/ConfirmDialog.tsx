/**
 * One in-app dialog for every confirmation, notice and text prompt — in place of window.confirm,
 * window.alert and window.prompt.
 *
 * WHY NOT THE BROWSER'S. The native dialogs were used for Pause, Withdraw, Delete, Purge, Rename, the
 * backup restore and the export check. They cannot be styled, so a long withdrawal notice arrived as a
 * block of small grey system text; their buttons say only "OK" and "Cancel", so the operator had to
 * read a paragraph to work out which of the two deleted something; and in a Chrome tab the browser
 * heads them "localhost says…" or with the site address. They also STOP THE PAGE: every timer and
 * animation frame freezes while one is open, which is why tracking/cameraLiveness.ts had to learn to
 * tell a frozen page from a lost camera.
 *
 * Here the buttons state what they do ("Move to recycle bin", "Keep it"), the text is set at the
 * operator floor, and the page keeps running.
 *
 * OVER A CONDITION SCREEN (the Pause confirmation) the dialog is drawn in that screen's own ink on
 * its own ground, with no dimming scrim — the same rule as the Pause chip: nothing inside the
 * condition-run may add a colour or a luminance the condition does not already have. The time it is
 * open is recorded as blocking-notice time by the caller (see Experiment.tsx).
 *
 * IT IS MODAL, AND BEHAVES SO. Tab and Shift+Tab cycle inside it: they used to walk out to the page
 * behind, the in-loop Pause chip under the overlay included, and pressing that replaced the request
 * being answered. Closing it gives the focus back to the control that opened it rather than dropping
 * it on <body>. Its title and body are named to assistive technology by ids unique to the instance.
 *
 * IT BELONGS TO ITS SCREEN. `dismiss()` answers whatever is open as declined; Experiment calls it
 * whenever the stage changes, so a confirmation raised on one screen never stays up over the next.
 *
 * Usage: `const dialog = useDialog();` render `{dialog.element}`, then
 * `if (!(await dialog.confirm({...}))) return;`.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { UI_TEXT } from '@/lib/uiPalette';

export interface DialogRequest {
  title: string;
  /** Plain text; line breaks are kept. */
  body?: ReactNode;
  /** States the action, e.g. "Move to recycle bin" — never a bare "OK". */
  confirmLabel: string;
  /** The way out without acting. Omitted for a notice, which has one button. */
  cancelLabel?: string;
  /** A destructive action: the confirm button is red and the cancel button takes the focus. */
  danger?: boolean;
  /** Raised over a condition screen: draw in the screen's own ink on its own ground. */
  ink?: { ink: string; ground: string } | null;
  testId?: string;
}

export interface PromptRequest extends DialogRequest {
  input: { label: string; initial: string; maxLength?: number };
}

type Pending = { seq: number } & (
  | { kind: 'confirm'; req: DialogRequest; resolve: (v: boolean) => void }
  | { kind: 'alert'; req: DialogRequest; resolve: () => void }
  | { kind: 'prompt'; req: PromptRequest; resolve: (v: string | null) => void });

export interface DialogApi {
  /** The dialog to render, or null. Render it once, anywhere in the screen. */
  element: ReactNode;
  /** A dialog is on screen. */
  open: boolean;
  confirm: (req: DialogRequest) => Promise<boolean>;
  alert: (req: Omit<DialogRequest, 'cancelLabel' | 'danger'>) => Promise<void>;
  prompt: (req: PromptRequest) => Promise<string | null>;
  /** Close whatever is open, answered as declined (false / null). For a screen going away under it. */
  dismiss: () => void;
}

/** The answer that does nothing: Cancel, Escape, a replacement by a later request, or dismiss(). */
function decline(p: Pending) {
  if (p.kind === 'confirm') p.resolve(false);
  else if (p.kind === 'prompt') p.resolve(null);
  else p.resolve();
}

/** How the dialog was closed: declined (Cancel, Escape), or accepted — with the typed text for a prompt. */
type Answer = { accept: false } | { accept: true; text?: string };

export function useDialog(): DialogApi {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const seq = useRef(0);
  /** The control that had the focus when the dialog opened; it gets the focus back when it closes. */
  const opener = useRef<HTMLElement | null>(null);

  // A second request while one is open answers the first as "no" rather than leaving it hanging. The
  // focus still goes back, at the end, to whatever had it before the first.
  const open = useCallback((next: Pending) => {
    const prev = current.current;
    if (!prev) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    current.current = next;
    setPending(next);
    if (prev) decline(prev);
  }, []);

  /** Close `which` (or whatever is open, for null) with `answer`. A stale dialog's answer is ignored. */
  const settle = useCallback((which: Pending | null, answer: Answer) => {
    const p = current.current;
    if (!p || (which && which !== p)) return;
    current.current = null;
    setPending(null);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    if (!answer.accept) decline(p);
    else if (p.kind === 'confirm') p.resolve(true);
    else if (p.kind === 'prompt') p.resolve(answer.text ?? '');
    else p.resolve();
  }, []);

  const confirm = useCallback((req: DialogRequest) => new Promise<boolean>((resolve) => {
    open({ seq: ++seq.current, kind: 'confirm', req, resolve });
  }), [open]);
  const alert = useCallback((req: Omit<DialogRequest, 'cancelLabel' | 'danger'>) => new Promise<void>((resolve) => {
    open({ seq: ++seq.current, kind: 'alert', req, resolve });
  }), [open]);
  const prompt = useCallback((req: PromptRequest) => new Promise<string | null>((resolve) => {
    open({ seq: ++seq.current, kind: 'prompt', req, resolve });
  }), [open]);
  const dismiss = useCallback(() => settle(null, { accept: false }), [settle]);

  const element = pending ? <ConfirmDialog key={pending.seq} pending={pending} onAnswer={(a) => settle(pending, a)} /> : null;
  return { element, open: pending != null, confirm, alert, prompt, dismiss };
}

/** What Tab may land on inside the card. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function ConfirmDialog({ pending, onAnswer }: { pending: Pending; onAnswer: (a: Answer) => void }) {
  const { req } = pending;
  const [text, setText] = useState(pending.kind === 'prompt' ? pending.req.input.initial : '');
  const ok = () => onAnswer({ accept: true, text });
  const cancel = () => onAnswer({ accept: false });
  const cancellable = pending.kind !== 'alert';
  // Per instance: two dialogs on one page (the manager's and the dashboard's) must not share an id.
  const titleId = useId();
  const bodyId = useId();

  const cardRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (pending.kind === 'prompt') inputRef.current?.focus();
    else if (req.danger) cancelRef.current?.focus();
    else okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cancel(); return; }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the card: first <-> last, and back in from anywhere outside it.
      const card = cardRef.current;
      if (!card) return;
      const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!card.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ink = req.ink ?? null;
  const fg = ink ? ink.ink : UI_TEXT.ink;
  const btnBase: React.CSSProperties = {
    minHeight: 'var(--vl-nav-chip-h)', padding: '0 22px', borderRadius: 12, fontSize: 17,
    fontWeight: 500, cursor: 'pointer',
  };
  const confirmStyle: React.CSSProperties = ink
    ? { ...btnBase, border: `2px solid ${ink.ink}`, background: 'transparent', color: ink.ink }
    : { ...btnBase, border: 'none', background: req.danger ? UI_TEXT.red : UI_TEXT.ink, color: '#ffffff' };
  const cancelStyle: React.CSSProperties = ink
    ? { ...btnBase, border: `1px solid ${ink.ink}`, background: 'transparent', color: ink.ink }
    : { ...btnBase, border: '1px solid #bdb8ae', background: '#ffffff', color: UI_TEXT.body };

  return (
    <div
      data-testid={req.testId ?? 'confirm-dialog'}
      role={cancellable ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={req.body != null ? bodyId : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 24,
        // No scrim over a condition screen: it would darken the stimulus field.
        background: ink ? 'transparent' : 'rgba(26,26,46,0.45)',
      }}
    >
      <div
        ref={cardRef}
        className="font-sans"
        style={{
          width: '100%', maxWidth: 620, maxHeight: '100%', display: 'flex', flexDirection: 'column',
          background: ink ? ink.ground : '#ffffff', color: fg, borderRadius: 16,
          border: ink ? `2px solid ${ink.ink}` : '1px solid #e5e2dc',
          boxShadow: ink ? 'none' : '0 10px 40px rgba(0,0,0,0.25)', padding: '24px 26px',
        }}
      >
        <h2 id={titleId} style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>{req.title}</h2>
        {req.body != null && (
          <div
            id={bodyId}
            className="scrollable"
            style={{ marginTop: 10, fontSize: 17, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: ink ? ink.ink : UI_TEXT.body, flex: '1 1 auto', minHeight: 0 }}
          >
            {req.body}
          </div>
        )}
        {pending.kind === 'prompt' && (
          <label style={{ display: 'block', marginTop: 14 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 500, color: UI_TEXT.body }}>{pending.req.input.label}</span>
            <input
              ref={inputRef}
              data-testid="confirm-input"
              value={text}
              maxLength={pending.req.input.maxLength}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ok(); }}
              style={{ marginTop: 8, width: '100%', padding: '12px 14px', border: '1px solid #bdb8ae', borderRadius: 10, fontFamily: "'DM Mono', monospace", fontSize: 17, background: '#fff', color: UI_TEXT.ink }}
            />
          </label>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 20, flex: '0 0 auto' }}>
          {cancellable && (
            <button ref={cancelRef} type="button" data-testid="confirm-cancel" onClick={cancel} style={cancelStyle}>
              {req.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button ref={okRef} type="button" data-testid="confirm-ok" onClick={ok} style={confirmStyle}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
