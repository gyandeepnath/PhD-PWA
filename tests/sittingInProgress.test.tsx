/**
 * A new sitting is not started over one still in progress, and a superseded sitting is not resumed
 * (Round 87, audit 86 F3).
 *
 * The session form used to say "This sitting continues where they stopped" for a participant whose earlier
 * sitting was paused, and let a new one begin — after their last COMPLETED display. The earlier sitting
 * kept its Resume button, and resuming it ran the same displays again: positions 2-9 twice in the audit's
 * reproduction, eight passages read a second time and recorded as first readings.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { put, _resetForTests } from '@/storage/db';
import { priorParticipantProgress } from '@/storage/gather';
import { listResumable, supersededSittings } from '@/storage/sessionPersistence';
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

const sitting = (sid: string, start: number, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  ...buildFixtureBundle().session, session_id: sid, participant_id: 'DUP1', enrolment_number: 3,
  status: 'in_progress', deleted_at: null, withdrawn_at: null, session_start_time: start, session_index: 1,
  conditions_per_session: 10, resume_next_index: undefined, ...extra,
});

describe('which in-progress sittings a later sitting superseded', () => {
  it('an in-progress sitting with a later live sitting of the same participant is superseded by it', () => {
    const old = sitting('a', 1000);
    const later = sitting('b', 2000, { session_index: 2 });
    const m = supersededSittings([later, old]);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')!.session_id).toBe('b');
  });

  it('nothing supersedes the latest sitting, a finished one, or one whose successor is in the bin', () => {
    expect(supersededSittings([sitting('a', 1000)]).size).toBe(0);
    expect(supersededSittings([sitting('a', 1000, { status: 'complete' }), sitting('b', 2000)]).size).toBe(0);
    expect(supersededSittings([sitting('a', 1000), sitting('b', 2000, { deleted_at: 3000 })]).size).toBe(0);
    // Another participant's later sitting is nothing to do with it.
    expect(supersededSittings([sitting('a', 1000), sitting('b', 2000, { participant_id: 'OTHER' })]).size).toBe(0);
  });

  it('matches the participant regardless of letter case (audit 86 F2)', () => {
    expect(supersededSittings([sitting('a', 1000, { participant_id: 'dup1' }), sitting('b', 2000)]).has('a')).toBe(true);
  });
});

describe('the store: resumable and open sittings', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); });

  it('a superseded sitting is not offered for resuming; the later one is', async () => {
    // The state F3 left on a device: two sittings of one participant in progress at once.
    await put('sessions', sitting('a', 1000));
    await put('sessions', sitting('b', 2000, { session_index: 2, condition_offset: 2 }));
    expect((await listResumable()).map((p) => p.sessionId)).toEqual(['b']);
  });

  it('a sitting is resumable again once the one that superseded it is deleted', async () => {
    await put('sessions', sitting('a', 1000));
    await put('sessions', sitting('b', 2000, { deleted_at: 5000 }));
    expect((await listResumable()).map((p) => p.sessionId)).toEqual(['a']);
  });

  it('prior progress lists the participant’s open sitting, and not a finished, binned, withdrawn or superseded one', async () => {
    await put('sessions', sitting('done', 500, { status: 'complete', conditions_per_session: 5 }));
    await put('sessions', sitting('binned', 600, { deleted_at: 700 }));
    await put('sessions', sitting('open', 1000, { session_index: 2, conditions_per_session: 5 }));
    await put('conditions', { ...buildFixtureBundle().conditions[0], condition_id: 'c1', session_id: 'open', completed_at: 1100 });
    const p = await priorParticipantProgress('dup1');
    expect(p.openSittings).toEqual([{ session_id: 'open', session_index: 2, started_at: 1000, conditions_per_session: 5, conditions_completed: 1 }]);
    // Superseded: no longer open, and so no longer blocks.
    await put('sessions', sitting('later', 2000, { session_index: 3 }));
    expect((await priorParticipantProgress('DUP1')).openSittings.map((o) => o.session_id)).toEqual(['later']);
    await put('sessions', sitting('later', 2000, { session_index: 3, withdrawn_at: 2500 }));
    expect((await priorParticipantProgress('DUP1')).openSittings).toEqual([]);
  });
});

describe('the session form refuses a new sitting while one is open', () => {
  const mounted: { root: Root; host: HTMLElement }[] = [];
  afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

  it('says which sitting is open, keeps Begin setup disabled, and offers the way back to Resume it', async () => {
    const { SessionInit } = await import('@/start/setupStages');
    const assignment: IlluminationAssignment = {
      level: 'moderate', block: 0, orderFirst: 'moderate', enrolment: 3, conditionsCompleted: 2, priorPasses: 0,
      sittings: 1, withdrawnAt: null, storedParticipantId: 'DUP1', spellings: ['DUP1'],
      openSittings: [{ session_id: 'a', session_index: 1, started_at: 1000, conditions_per_session: 10, conditions_completed: 2 }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    let back = 0;
    const submitted: unknown[] = [];
    await act(async () => {
      root.render(createElement(SessionInit, {
        onSubmit: (d) => submitted.push(d), resolveAssignment: async () => assignment, onBackToSessions: () => { back++; },
      }));
    });
    const type = async (testId: string, value: string) => {
      const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await type('pid', 'DUP1');
    await type('lux', '300');
    const panel = host.querySelector('[data-testid="sitting-in-progress"]');
    expect(panel?.textContent).toMatch(/Sitting 1, started/);
    expect(panel?.textContent).toMatch(/2 of 10 displays finished in it/);
    expect(panel?.textContent).toMatch(/Resume it from the Session Manager/);
    // The old line that invited the second sitting is gone.
    expect(host.textContent).not.toMatch(/continues where they stopped/);
    const begin = [...host.querySelectorAll('button')].find((b) => /Begin setup/.test(b.textContent ?? ''))!;
    expect(begin.disabled).toBe(true);
    await act(async () => { begin.click(); });
    expect(submitted).toEqual([]);
    expect(host.querySelector('[data-testid="begin-blocked"]')?.textContent).toMatch(/cannot be started/);
    await act(async () => { (host.querySelector('[data-testid="back-to-resume"]') as HTMLButtonElement).click(); });
    expect(back).toBe(1);
  });
});
