/**
 * What the Session Manager and the session form say about the sitting (audit 86 F1, F15, F16).
 *
 * F1  — a sitting stopped at its closing questionnaires was offered as "next condition 11/10".
 * F15 — the form told the operator to delete an earlier sitting "in the dashboard", which has no delete,
 *       and not that a participant with nothing left on the tablet is then enrolled afresh.
 * F16 — beside "5 of 10 conditions completed" the form said "Single sitting: all 10 conditions" while the
 *       sitting created ran the remaining five.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { put, _resetForTests } from '@/storage/db';
import { resumeLabel, clearResume } from '@/storage/sessionPersistence';
import { sittingLength } from '@/experiment/participantProgress';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { IlluminationAssignment } from '@/start/setupStages';
import type { SessionRecord } from '@/storage/types';

vi.mock('@/lib/swUpdate', () => ({
  onUpdateWaiting: (l: (w: boolean) => void) => { l(false); return () => {}; },
  isUpdateWaiting: () => false,
  checkForUpdate: async () => 'current',
  applyUpdate: async () => {},
  installUpdateWatch: async () => {},
  onOfflineCopy: (l: (s: { state: string; reason: string | null }) => void) => { l({ state: 'ready', reason: null }); return () => {}; },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

function mount(): { root: Root; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  return { root, host };
}

describe('the resume pointer in words (F1)', () => {
  it('names the next display while one is left, and the closing questionnaires once every display is done', () => {
    expect(resumeLabel({ nextStepIndex: 0, reachedLoop: true }, 10)).toBe('next condition 1/10');
    expect(resumeLabel({ nextStepIndex: 9, reachedLoop: true }, 10)).toBe('next condition 10/10');
    expect(resumeLabel({ nextStepIndex: 10, reachedLoop: true }, 10)).toBe('all displays done — closing questionnaires');
    // A split half: five displays, stopped after the fifth.
    expect(resumeLabel({ nextStepIndex: 4, reachedLoop: true }, 5)).toBe('next condition 5/5');
    expect(resumeLabel({ nextStepIndex: 5, reachedLoop: true }, 5)).toBe('all displays done — closing questionnaires');
    expect(resumeLabel({ nextStepIndex: 0, reachedLoop: false }, 10)).toMatch(/interrupted during setup/);
  });

  it('the Session Manager banner never prints a display past the sitting’s length', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetForTests();
    clearResume();
    const base = buildFixtureBundle().session;
    const s: SessionRecord = {
      ...base, session_id: 'closing', participant_id: 'E2E01', status: 'in_progress', deleted_at: null,
      withdrawn_at: null, display_label: null, conditions_per_session: 10, resume_next_index: 10,
    };
    await put('sessions', s);
    const { SessionManager } = await import('@/start/SessionManager');
    const { root, host } = mount();
    await act(async () => {
      root.render(createElement(SessionManager, { onNew: () => {}, onResume: () => {}, onOpen: () => {}, onHome: () => {} }));
    });
    await vi.waitFor(() => expect(host.textContent).toMatch(/Resume E2E01/));
    expect(host.textContent).toMatch(/all displays done — closing questionnaires/);
    expect(host.textContent).not.toMatch(/11\/10/);
  });
});

describe('the session form describes the sitting it will create (F16)', () => {
  it('sittingLength is the cut beginSession makes: the choice, or what the participant has left of the pass', () => {
    expect(sittingLength(10, 0)).toBe(10);
    expect(sittingLength(5, 0)).toBe(5);
    expect(sittingLength(10, 5)).toBe(5);
    expect(sittingLength(5, 5)).toBe(5);
    expect(sittingLength(10, 2)).toBe(8);
    // A completed pass starts the next one from its first display.
    expect(sittingLength(10, 10)).toBe(10);
  });

  it('the help line counts with the same function, for every history and either choice', async () => {
    const { sittingStructureHelp, chosenSittingSize } = await import('@/start/setupStages');
    expect(sittingStructureHelp('single', 0)).toMatch(/^Single sitting: all 10 conditions/);
    expect(sittingStructureHelp('split', 0)).toMatch(/^Split: 5 conditions now, the remaining 5/);
    expect(sittingStructureHelp('single', 5)).toBe(
      'This sitting: the remaining 5 conditions (displays 6–10 of 10), in the participant\'s condition order. '
      + 'Both sittings export as ONE participant.',
    );
    expect(sittingStructureHelp('single', 5)).not.toMatch(/all 10/);
    expect(sittingStructureHelp('split', 5)).toMatch(/nothing left to split\. Choose Single/);
    expect(sittingStructureHelp('split', 2)).toMatch(/^Split: 5 of the remaining 8 conditions now \(displays 3–7 of 10\), the last 3/);
    expect(sittingStructureHelp('single', 10)).toMatch(/^Single sitting: all 10 conditions/);
    // The number the line states is the number of conditions the sitting will run.
    for (let done = 0; done <= 10; done++) {
      for (const choice of ['single', 'split'] as const) {
        const n = sittingLength(chosenSittingSize(choice), done);
        const text = sittingStructureHelp(choice, done);
        const stated = /all (\d+) conditions|remaining (\d+) conditions|Split: (\d+)/.exec(text)!;
        expect(Number(stated[1] ?? stated[2] ?? stated[3]), `${choice} after ${done}: ${text}`).toBe(n);
      }
    }
  });

  const assignment = (over: Partial<IlluminationAssignment>): IlluminationAssignment => ({
    level: 'moderate', block: 0, orderFirst: 'moderate', enrolment: 3, conditionsCompleted: 0, priorPasses: 0,
    sittings: 0, withdrawnAt: null, storedParticipantId: null, spellings: [], openSittings: [], ...over,
  });

  async function renderForm(a: IlluminationAssignment): Promise<HTMLElement> {
    const { SessionInit } = await import('@/start/setupStages');
    const { root, host } = mount();
    await act(async () => {
      root.render(createElement(SessionInit, { onSubmit: () => {}, resolveAssignment: async () => a }));
    });
    const el = host.querySelector('[data-testid="pid"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'P005');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="sitting-structure-help"]')).not.toBeNull());
    return host;
  }

  it('the second half of a split is described as the remaining five, beside the record of the first', async () => {
    const host = await renderForm(assignment({ conditionsCompleted: 5, sittings: 1, storedParticipantId: 'P005', spellings: ['P005'] }));
    await vi.waitFor(() => expect(host.querySelector('[data-testid="prior-progress"]')?.textContent).toMatch(/5 of 10 conditions completed/));
    const help = host.querySelector('[data-testid="sitting-structure-help"]')!.textContent;
    expect(help).toMatch(/the remaining 5 conditions \(displays 6–10 of 10\)/);
    expect(help).not.toMatch(/all 10 conditions/);
  });

  it('a participant who finished the protocol is told where Delete is, and what it costs (F15)', async () => {
    const host = await renderForm(assignment({ conditionsCompleted: 10, priorPasses: 1, sittings: 1, storedParticipantId: 'P005', spellings: ['P005'] }));
    await vi.waitFor(() => expect(host.querySelector('[data-testid="prior-progress"]')).not.toBeNull());
    const panel = host.querySelector('[data-testid="prior-progress"]')!.textContent!;
    expect(panel).toMatch(/Delete it in the Session Manager first/);
    expect(panel).toMatch(/enrolled afresh, with a new enrolment number and condition order/);
    expect(host.textContent).not.toMatch(/delete it in the dashboard/i);
  });
});
