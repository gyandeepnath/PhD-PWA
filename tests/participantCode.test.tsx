/**
 * One participant, one code, however it is typed (Round 87, audit 86 F2).
 *
 * The code was stored and looked up exactly as typed. On the tablet's keyboard "case1" for "CASE1" (Gboard
 * capitalises a field's first letter, or not) found no earlier record and enrolled the participant afresh —
 * a new Williams order from position 0, and two half-participants in the export; "CASE1 " (the space a
 * keyboard suggestion adds) failed the pattern and left "Begin setup" grey with no word as to why.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { put, get, _resetForTests } from '@/storage/db';
import { priorParticipantProgress, recordWithdrawal, sittingsOfParticipant } from '@/storage/gather';
import {
  canonicalParticipantId, participantIdProblem, sameParticipant, PARTICIPANT_ID_PATTERN,
} from '@/lib/participantId';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { IlluminationAssignment } from '@/start/setupStages';
import type { SessionRecord } from '@/storage/types';

vi.mock('@/lib/swUpdate', () => ({
  onUpdateWaiting: (l: (w: boolean) => void) => { l(false); return () => {}; },
  isUpdateWaiting: () => false,
  checkForUpdate: async () => 'current',
  applyUpdate: async () => {},
  installUpdateWatch: async () => {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the canonical form of a code', () => {
  it('is trimmed and upper-cased: what the keyboard adds by itself makes no new participant', () => {
    expect(canonicalParticipantId(' case1 ')).toBe('CASE1');
    expect(canonicalParticipantId('Case1 ')).toBe('CASE1');
    expect(canonicalParticipantId('p-01_a')).toBe('P-01_A');
    expect(sameParticipant('case1', 'CASE1 ')).toBe(true);
    expect(sameParticipant('CASE1', 'CASE2')).toBe(false);
  });

  it('says in words why a code is not one the app issues, and nothing for a good one or an empty field', () => {
    expect(participantIdProblem('P001')).toBeNull();
    expect(participantIdProblem('')).toBeNull();
    expect(participantIdProblem('P 01')).toMatch(/no spaces/);
    expect(participantIdProblem('P.01')).toMatch(/only letters, digits, - and _ \(not “\.”\)/);
    expect(participantIdProblem('P'.repeat(21))).toMatch(/at most 20 characters; this one has 21/);
    // Every code the problem function passes is one the pattern accepts, and the reverse.
    for (const c of ['P001', 'a', 'x-y_z', 'P 1', 'é', '']) {
      expect(participantIdProblem(c) == null, c).toBe(c === '' || PARTICIPANT_ID_PATTERN.test(c));
    }
  });
});

describe('a code is looked up regardless of letter case', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); });

  const sitting = (pid: string, sid: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
    ...buildFixtureBundle().session, session_id: sid, participant_id: pid, enrolment_number: 7,
    status: 'complete', deleted_at: null, session_start_time: 1000, ...extra,
  });

  it('finds the earlier sitting of "CASE1" when "case1" is typed, and reuses its enrolment and spelling', async () => {
    await put('sessions', sitting('CASE1', 's1'));
    const p = await priorParticipantProgress('case1');
    expect(p.enrolment).toBe(7);
    expect(p.sittings).toBe(1);
    expect(p.participantId).toBe('CASE1');
    expect(p.spellings).toEqual(['CASE1']);
    expect((await sittingsOfParticipant(' Case1 ')).map((s) => s.session_id)).toEqual(['s1']);
  });

  it('keeps the stored spelling of a code recorded in lower case before Round 87', async () => {
    // The export joins a participant's sittings on the code as stored: the second half must carry it.
    await put('sessions', sitting('case1', 's1'));
    expect((await priorParticipantProgress('CASE1')).participantId).toBe('case1');
  });

  it('reports a code stored in two letter cases, and picks neither', async () => {
    await put('sessions', sitting('CASE1', 's1'));
    await put('sessions', sitting('case1', 's2', { enrolment_number: 9, session_start_time: 2000 }));
    const p = await priorParticipantProgress('CASE1');
    expect(p.spellings).toEqual(['CASE1', 'case1']);
    expect(p.participantId).toBeNull();
  });

  it('reads a withdrawal recorded under another letter case of the code', async () => {
    await put('sessions', sitting('case1', 's1', { withdrawn_at: 5 }));
    expect((await priorParticipantProgress('CASE1')).withdrawnAt).toBe(5);
  });

  it('withdraws every sitting of the participant, whatever letter case it was stored under', async () => {
    await put('sessions', sitting('CASE1', 's1'));
    await put('sessions', sitting('case1', 's2', { session_start_time: 2000 }));
    await put('sessions', sitting('CASE2', 's3'));
    expect((await recordWithdrawal('s1')).sittings).toBe(2);
    expect(((await get('sessions', 's2')) as SessionRecord).withdrawn_at).toBeTypeOf('number');
    expect(((await get('sessions', 's3')) as SessionRecord).withdrawn_at ?? null).toBeNull();
  });
});

describe('the session form keeps the code canonical and says what is wrong', () => {
  const mounted: { root: Root; host: HTMLElement }[] = [];
  afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

  const assignment = (over: Partial<IlluminationAssignment> = {}): IlluminationAssignment => ({
    level: 'moderate', block: 0, orderFirst: 'moderate', enrolment: 1, conditionsCompleted: 0, priorPasses: 0,
    sittings: 0, withdrawnAt: null, storedParticipantId: null, spellings: [], openSittings: [], ...over,
  });

  async function renderForm(resolve: (id: string) => Promise<IlluminationAssignment>) {
    const { SessionInit } = await import('@/start/setupStages');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const submitted: string[] = [];
    await act(async () => {
      root.render(createElement(SessionInit, { onSubmit: (d) => submitted.push(d.participantId), resolveAssignment: resolve }));
    });
    const type = async (testId: string, value: string) => {
      const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const q = (testId: string) => host.querySelector(`[data-testid="${testId}"]`);
    const begin = () => [...host.querySelectorAll('button')].find((b) => /Begin setup/.test(b.textContent ?? ''))!;
    return { host, type, q, begin, submitted };
  }

  it('shows the code trimmed and in capitals as it is typed, asks the keyboard for capitals, and looks it up so', async () => {
    const looked: string[] = [];
    const f = await renderForm(async (id) => { looked.push(id); return assignment(); });
    await f.type('pid', 'case1 ');
    const input = f.q('pid') as HTMLInputElement;
    expect(input.value).toBe('CASE1');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(looked).toEqual(['CASE1']);
    await f.type('lux', '300');
    expect(f.begin().disabled).toBe(false);
    await act(async () => { f.begin().click(); });
    expect(f.submitted).toEqual(['CASE1']);
  });

  it('says why a code is refused, and why Begin setup is disabled', async () => {
    const f = await renderForm(async () => assignment());
    await f.type('pid', 'P.01');
    expect(f.q('pid-problem')?.textContent).toMatch(/only letters, digits/);
    expect(f.begin().disabled).toBe(true);
    expect(f.q('begin-blocked')?.textContent).toMatch(/only letters, digits/);
    await f.type('pid', 'P01');
    expect(f.q('pid-problem')).toBeNull();
    // The code is fine now; what is still missing is the illuminance, and it is said.
    expect(f.q('begin-blocked')?.textContent).toMatch(/illuminance/);
  });

  it('names the stored spelling a returning participant is recorded under', async () => {
    const f = await renderForm(async () => assignment({ storedParticipantId: 'case1', spellings: ['case1'], sittings: 1, conditionsCompleted: 5 }));
    await f.type('pid', 'CASE1');
    expect(f.q('pid-stored-as')?.textContent).toMatch(/Recorded as case1/);
  });

  it('refuses a code stored in two letter cases until the researcher decides', async () => {
    const f = await renderForm(async () => assignment({ spellings: ['CASE1', 'case1'], sittings: 2, conditionsCompleted: 4 }));
    await f.type('pid', 'CASE1');
    await f.type('lux', '300');
    expect(f.q('participant-ambiguous')?.textContent).toMatch(/CASE1, case1/);
    expect(f.begin().disabled).toBe(true);
  });
});
