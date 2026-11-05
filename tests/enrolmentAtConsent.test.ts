/**
 * The enrolment number is spent at consent (audit 86 F17): enrolmentAtConsent, against the store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, nextEnrolmentNumber, peekNextEnrolmentNumber, _resetForTests } from '@/storage/db';
import { enrolmentAtConsent, priorParticipantProgress } from '@/storage/gather';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { SessionRecord } from '@/storage/types';

const sitting = (sid: string, pid: string, enrol: number, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  ...buildFixtureBundle().session, session_id: sid, participant_id: pid, enrolment_number: enrol,
  status: 'in_progress', deleted_at: null, withdrawn_at: null, consent_given: false, consent_time: null, ...extra,
});

describe('the enrolment number is spent when the participant consents (audit 86 F17)', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); });

  it('a new participant takes the next number at consent; Begin setup only read it', async () => {
    const provisional = await peekNextEnrolmentNumber();
    expect(provisional).toBe(1);
    const s = sitting('a', 'P001', provisional);
    await put('sessions', s);
    expect(await peekNextEnrolmentNumber()).toBe(1);
    expect(await enrolmentAtConsent(s, nextEnrolmentNumber)).toBe(1);
    expect(await peekNextEnrolmentNumber()).toBe(2);
  });

  it('an abandoned unconsented sitting leaves its number for the next participant', async () => {
    await put('sessions', sitting('typo', 'P0O1', 1));
    const s = sitting('b', 'P001', await peekNextEnrolmentNumber());
    expect(s.enrolment_number).toBe(1);
    expect(await enrolmentAtConsent(s, nextEnrolmentNumber)).toBe(1);
  });

  it('when another participant consented in between, the sitting takes the next number, not a shared one', async () => {
    const a = sitting('a', 'PA', await peekNextEnrolmentNumber());
    const b = sitting('b', 'PB', await peekNextEnrolmentNumber());
    expect([a.enrolment_number, b.enrolment_number]).toEqual([1, 1]);
    expect(await enrolmentAtConsent(b, nextEnrolmentNumber)).toBe(1);
    expect(await enrolmentAtConsent(a, nextEnrolmentNumber)).toBe(2);
  });

  it('a returning participant keeps the number a consented sitting holds; a re-consent keeps its own', async () => {
    await put('sessions', sitting('first', 'P001', 4, { consent_given: true, status: 'complete' }));
    const second = sitting('second', 'p001', 4);
    await put('sessions', second);
    expect(await enrolmentAtConsent(second, nextEnrolmentNumber)).toBe(4);
    expect(await peekNextEnrolmentNumber()).toBe(1);
    expect(await enrolmentAtConsent({ ...second, consent_given: true, enrolment_number: 4 }, nextEnrolmentNumber)).toBe(4);
  });

  it('the session form reads a returning participant\'s number from consented sittings only', async () => {
    await put('sessions', sitting('open', 'P009', 7, { status: 'in_progress' }));
    expect((await priorParticipantProgress('P009')).enrolment).toBeNull();
    await put('sessions', sitting('done', 'P009', 3, { consent_given: true, status: 'complete' }));
    expect((await priorParticipantProgress('P009')).enrolment).toBe(3);
  });
});
