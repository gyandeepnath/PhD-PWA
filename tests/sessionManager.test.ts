import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, getAll, _resetForTests } from '@/storage/db';
import {
  listSessions, listDeleted, softDeleteSession, restoreSession, purgeSession, purgeExpired,
  renameSession, sessionLabel, BIN_RETENTION_MS,
} from '@/storage/gather';
import { saveResume, loadResume, clearResume } from '@/storage/sessionPersistence';
import type { Provenance, SessionRecord } from '@/storage/types';

const prov: Provenance = { app_version: 't', git_hash: 't', build_time: 't', condition_def_hash: 'h', schema_version: 7 };

function makeSession(id: string, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session_id: id, participant_id: `P-${id}`, enrolment_number: 1, status: 'complete',
    deleted_at: null, display_label: null, ambient_lux: 350, ambient_illumination_level: null, illumination_block: 0, illumination_order_first: 'dim' as const, lux_readings: [], lux_all_in_range: null, lux_deviation_note: null, screen_white_luminance_cd_m2: null,
    brightness_percent: null, session_start_time: Date.now(), session_end_time: Date.now(),
    randomisation_seed: 1, condition_order: [0], preflight_complete: true, e2e_timing: false, consent_given: true,
    consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: prov, device_type: 'X', browser: 'Y', screen_resolution: '1x1',
    conditions_per_session: 8, condition_offset: 0, session_index: 1,
    ...over,
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
  clearResume();
});

describe('session manager admin', () => {
  it('lists active sessions, excludes deleted', async () => {
    await put('sessions', makeSession('A'));
    await put('sessions', makeSession('B'));
    await softDeleteSession('B');
    const active = await listSessions();
    const bin = await listDeleted();
    expect(active.map((s) => s.session_id)).toEqual(['A']);
    expect(bin.map((s) => s.session_id)).toEqual(['B']);
  });

  it('restores from the bin', async () => {
    await put('sessions', makeSession('A'));
    await softDeleteSession('A');
    expect((await listSessions()).length).toBe(0);
    await restoreSession('A');
    expect((await listSessions()).map((s) => s.session_id)).toEqual(['A']);
  });

  it('renames via display_label with participant_id fallback', async () => {
    await put('sessions', makeSession('A', { participant_id: 'P001' }));
    expect(sessionLabel(makeSession('A', { participant_id: 'P001' }))).toBe('P001');
    await renameSession('A', 'Pilot 1');
    expect((await listSessions())[0].display_label).toBe('Pilot 1');
    expect(sessionLabel((await listSessions())[0])).toBe('Pilot 1');
  });

  it('purge cascades to all child records', async () => {
    await put('sessions', makeSession('A'));
    await put('participants', { participant_id: 'P-A', enrolment_number: 1, age: 30, gender: 'x', daily_screen_hours: 6, device_familiarity: 'high', lighting_habit: 'moderate', correction_type: 'none', cvd_status: 'normal', ishihara_correct: null, ishihara_total: null, caffeine_today: null, hours_since_sleep: null, eligible: true, exclusion_reason: null, baseline_fatigue: 0, session_id: 'A' });
    await put('conditions', { condition_id: 'c1', session_id: 'A', session_position: 0, condition_label: 'C1', polarity: 'positive', background_color: '#fff', text_color: '#000', color_name: 'black', ink_name: 'black', passage_id: 0, wcag_contrast_ratio: 21, wcag_level: 'AAA', michelson_contrast: 1, below_wcag_aa: false, started_at: 1, completed_at: 2, condition_duration_sec: 1, passage_repeat_number: 1, adaptation_ms_before: 0, reading_time_ms: null });
    await put('rt_summaries', { condition_id: 'c1', session_id: 'A', total_trials: 4, signal_trials: 2, hits: 2, false_alarms: 0, misses: 0, correct_rejections: 2, hit_rate: 1, false_alarm_rate: 0, error_rate: 0.1, rt_cv: 0.2, anticipations: 0, lapse_count: 0, lapse_rate: 0, inverse_efficiency_ms: 460, first_half_mean_rt_ms: 450, second_half_mean_rt_ms: 470, mean_rt_hits_ms: 400, median_rt_hits_ms: 400, rt_sd_ms: 10, d_prime: 2, d_prime_se: 0.4, d_prime_unstable: true, d_prime_estimable: true, criterion: 0 });

    await purgeSession('A');
    expect(await getAll('sessions')).toHaveLength(0);
    expect(await getAll('participants')).toHaveLength(0);
    expect(await getAll('conditions')).toHaveLength(0);
    expect(await getAll('rt_summaries')).toHaveLength(0);
  });

  it('auto-purges only bin entries older than 30 days', async () => {
    await put('sessions', makeSession('OLD', { deleted_at: Date.now() - BIN_RETENTION_MS - 1000 }));
    await put('sessions', makeSession('NEW', { deleted_at: Date.now() - 1000 }));
    const purged = await purgeExpired();
    expect(purged).toBe(1);
    expect((await listDeleted()).map((s) => s.session_id)).toEqual(['NEW']);
  });

  it('backfills status for legacy sessions missing v7 fields', async () => {
    // Simulate a pre-v7 record (no status/deleted_at/display_label).
    const legacy = makeSession('L');
    delete (legacy as Partial<SessionRecord>).status;
    delete (legacy as Partial<SessionRecord>).deleted_at;
    await put('sessions', legacy);
    const active = await listSessions();
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('complete'); // has session_end_time
  });
});

describe('resume persistence', () => {
  it('saves, loads and clears the resume pointer', () => {
    expect(loadResume()).toBeNull();
    saveResume('S1', 3);
    expect(loadResume()).toMatchObject({ sessionId: 'S1', nextStepIndex: 3 });
    clearResume('S1');
    expect(loadResume()).toBeNull();
  });

  it('does not clear another session’s pointer', () => {
    saveResume('S1', 2);
    clearResume('OTHER');
    expect(loadResume()).toMatchObject({ sessionId: 'S1' });
  });
});
