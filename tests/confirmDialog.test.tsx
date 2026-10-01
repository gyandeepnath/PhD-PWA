/**
 * The in-app dialog is modal and belongs to its screen.
 *
 * Round 62's review found it declared aria-modal but let Tab walk out to the page behind — the
 * in-loop Pause chip under the overlay included, which replaced the request being answered — dropped
 * the focus on <body> when it closed, had no description for assistive technology and one fixed title
 * id for every dialog, and could stay up over the next screen when a timed task ended under it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useDialog, type DialogApi } from '@/components/ConfirmDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: DialogApi | null = null;
function Harness() {
  const d = useDialog();
  api = d;
  return createElement(Fragment, null,
    createElement('button', { 'data-testid': 'opener', type: 'button' }, 'Open'),
    createElement('button', { 'data-testid': 'behind', type: 'button' }, 'Behind'),
    d.element);
}

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(createElement(Harness)); });
  const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { q };
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null; api = null;
});
const key = (k: string, shiftKey = false) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })); });
const open = (req: Parameters<DialogApi['confirm']>[0]) => {
  let p!: Promise<boolean>;
  act(() => { p = api!.confirm(req); });
  return p;
};
const req = { title: 'Pause and exit?', body: 'This condition will be restarted on resume.', confirmLabel: 'Pause and exit', cancelLabel: 'Keep going' };

describe('the confirmation dialog', () => {
  it('keeps Tab and Shift+Tab inside itself, and pulls the focus back in from the page behind', () => {
    const { q } = mount();
    q('opener')!.focus();
    void open(req);
    const cancel = q('confirm-cancel')!;
    const ok = q('confirm-ok')!;
    expect(document.activeElement).toBe(ok);
    key('Tab');
    expect(document.activeElement).toBe(cancel);   // last -> first
    key('Tab', true);
    expect(document.activeElement).toBe(ok);       // first -> last
    q('behind')!.focus();
    key('Tab');
    expect(document.activeElement).toBe(cancel);   // from outside -> back in
  });

  it('gives the focus back to the control that opened it, not to <body>', async () => {
    const { q } = mount();
    q('opener')!.focus();
    const answer = open(req);
    key('Escape');
    expect(await answer).toBe(false);
    expect(q('confirm-dialog')).toBeNull();
    expect(document.activeElement).toBe(q('opener'));
  });

  it('is named and described by ids of its own instance', () => {
    const { q } = mount();
    void open(req);
    const d = q('confirm-dialog')!;
    const title = document.getElementById(d.getAttribute('aria-labelledby')!);
    const body = document.getElementById(d.getAttribute('aria-describedby')!);
    expect(title?.textContent).toBe('Pause and exit?');
    expect(body?.textContent).toBe('This condition will be restarted on resume.');
    expect(d.getAttribute('aria-labelledby')).not.toBe('vl-dialog-title');
  });

  it('dismiss() answers an open request as declined and closes it — what a stage change does', async () => {
    const { q } = mount();
    q('opener')!.focus();
    const answer = open(req);
    act(() => api!.dismiss());
    expect(await answer).toBe(false);
    expect(q('confirm-dialog')).toBeNull();
    expect(document.activeElement).toBe(q('opener'));
    // With nothing open it does nothing.
    act(() => api!.dismiss());
    expect(q('confirm-dialog')).toBeNull();
  });

  it('a second request answers the first as declined, and the focus still goes back to the first opener', async () => {
    const { q } = mount();
    q('opener')!.focus();
    const first = open(req);
    const second = open({ ...req, title: 'Second' });
    expect(await first).toBe(false);
    act(() => { q('confirm-ok')!.click(); });
    expect(await second).toBe(true);
    expect(document.activeElement).toBe(q('opener'));
  });
});
