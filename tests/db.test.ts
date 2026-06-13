import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, get, getAll, getAllByIndex, remove, nextEnrolmentNumber, _resetForTests } from '@/storage/db';
import type { SessionRecord, ReactionTrialRecord } from '@/storage/types';

beforeEach(() => {
  // Fresh IndexedDB per test.
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

function makeSession(id: string, participant: string, enrolment: number): SessionRecord {
  return {
    session_id: id,
    participant_id: participant,
    enrolment_number: enrolment, status: 'complete', deleted_at: null, display_label: null,
    ambient_lux: 350,
    screen_white_luminance_cd_m2: 120,
    brightness_percent: 80,
    session_start_time: Date.now(),
    session_end_time: null,
    randomisation_seed: 12345,
    condition_order: [0, 1, 7, 2, 6, 3, 5, 4],
    preflight_complete: true,
    consent_given: true,
    consent_time: Date.now(),
    provenance: {
      app_version: 'test',
      git_hash: 'test',
      build_time: 'test',
      condition_def_hash: 'abcd1234',
      schema_version: 6,
    },
    device_type: 'Android Tablet',
    browser: 'Chrome 120',
    screen_resolution: '2880x1800',
  };
}

describe('IndexedDB storage layer', () => {
  it('round-trips a session record', async () => {
    await put('sessions', makeSession('S1', 'P001', 1));
    const got = await get('sessions', 'S1');
    expect(got?.participant_id).toBe('P001');
    expect(got?.condition_order).toEqual([0, 1, 7, 2, 6, 3, 5, 4]);
    expect(got?.provenance.schema_version).toBe(6);
  });

  it('queries by index', async () => {
    await put('sessions', makeSession('S1', 'P001', 1));
    await put('sessions', makeSession('S2', 'P001', 1));
    await put('sessions', makeSession('S3', 'P002', 2));
    const forP001 = await getAllByIndex('sessions', 'by_participant', 'P001');
    expect(forP001.map((s) => s.session_id).sort()).toEqual(['S1', 'S2']);
  });

  it('stores many reaction trials and retrieves by condition', async () => {
    for (let i = 0; i < 48; i++) {
      const trial: ReactionTrialRecord = {
        trial_id: `T${i}`,
        condition_id: 'COND1',
        session_id: 'S1',
        trial_number: i,
        trial_category: 'signal_congruent',
        is_signal: true,
        is_congruent: true,
        stimulus_onset_time: 0,
        response_time_ms: 420,
        accuracy: 'hit',
        false_start: false,
      };
      await put('reaction_trials', trial);
    }
    const trials = await getAllByIndex('reaction_trials', 'by_condition', 'COND1');
    expect(trials).toHaveLength(48);
  });

  it('removes records', async () => {
    await put('sessions', makeSession('S1', 'P001', 1));
    await remove('sessions', 'S1');
    expect(await get('sessions', 'S1')).toBeUndefined();
    expect(await getAll('sessions')).toHaveLength(0);
  });

  it('allocates sequential enrolment numbers atomically', async () => {
    const a = await nextEnrolmentNumber();
    const b = await nextEnrolmentNumber();
    const c = await nextEnrolmentNumber();
    expect([a, b, c]).toEqual([1, 2, 3]);
  });

  it('enrolment numbers are unique under concurrent allocation', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => nextEnrolmentNumber()));
    expect(new Set(results).size).toBe(10);
  });
});
