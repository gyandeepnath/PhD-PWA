import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, get, _resetForTests } from '@/storage/db';
import { gatherSession, listSessions, purgeSession } from '@/storage/gather';
import { buildExportFiles } from '@/storage/export';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import type { Provenance } from '@/storage/types';

const prov: Provenance = { app_version: 't', git_hash: 't', build_time: 't', condition_def_hash: 'h', schema_version: 6 };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

async function seed() {
  await put('sessions', {
    session_id: 'S1', participant_id: 'P001', enrolment_number: 1, status: 'complete', deleted_at: null, display_label: null, ambient_lux: 350, ambient_illumination_level: null, illumination_block: 0, illumination_order_first: 'dim' as const, lux_readings: [], lux_all_in_range: null, lux_deviation_note: null,
    screen_white_luminance_cd_m2: 120, brightness_percent: 80, session_start_time: 1700000000000,
    session_end_time: 1700000600000, randomisation_seed: 1, condition_order: [0], preflight_complete: true,
    consent_given: true, consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: prov, device_type: 'Android', browser: 'Chrome', screen_resolution: '2880x1800',
    conditions_per_session: 8, condition_offset: 0, session_index: 1,
  });
  await put('conditions', {
    condition_id: 'A', session_id: 'S1', session_position: 0, condition_label: 'C1', polarity: 'positive',
    background_color: '#FFFFFF', text_color: '#000000', color_name: 'black', ink_name: 'black', passage_id: 0,
    wcag_contrast_ratio: 21, wcag_level: 'AAA', michelson_contrast: 1, below_wcag_aa: false,
    started_at: 1, completed_at: 2, condition_duration_sec: 1, adaptation_ms_before: 0, reading_time_ms: null
  });
  await put('fatigue_scores', {
    fatigue_id: 'f0', session_id: 'S1', condition_id: null, stage: 'baseline', eye_strain: 1, dryness: 1,
    blur: 1, burning: 1, headache: 1, fatigue_mean: 1,
    touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true }, all_touched: true,
    response_time_ms: 8000,
  });
  await put('rt_summaries', {
    condition_id: 'A', session_id: 'S1', total_trials: 48, signal_trials: 24, hits: 22, false_alarms: 2,
    misses: 2, correct_rejections: 22, hit_rate: 0.92, false_alarm_rate: 0.08, error_rate: 0.1, rt_cv: 0.2, anticipations: 0, lapse_count: 0, lapse_rate: 0, inverse_efficiency_ms: 460, first_half_mean_rt_ms: 450, second_half_mean_rt_ms: 470, mean_rt_hits_ms: 460,
    median_rt_hits_ms: 455, rt_sd_ms: 50,
    d_prime: 2.8, d_prime_se: 0.45, d_prime_unstable: true, criterion: -0.3,
  });
}

describe('gather → aggregate → export integration (fake IndexedDB)', () => {
  it('gathers a written session into a bundle', async () => {
    await seed();
    const bundle = await gatherSession('S1');
    expect(bundle).not.toBeNull();
    expect(bundle!.conditions).toHaveLength(1);
    expect(bundle!.rtSummaries[0].mean_rt_hits_ms).toBe(460);
    expect(bundle!.fatigue.find((f) => f.stage === 'baseline')?.fatigue_mean).toBe(1);
  });

  it('returns null for a missing session', async () => {
    expect(await gatherSession('nope')).toBeNull();
  });

  it('lists sessions', async () => {
    await seed();
    const list = await listSessions();
    expect(list.map((s) => s.session_id)).toContain('S1');
  });

  it('purging one sitting keeps the participant record shared by another sitting (M1)', async () => {
    await seed(); // S1 for participant P001
    // A second sitting for the SAME participant (split-session), sharing the participant record.
    await put('sessions', {
      session_id: 'S2', participant_id: 'P001', enrolment_number: 1, status: 'in_progress', deleted_at: null,
      display_label: null, ambient_lux: 350, ambient_illumination_level: null, illumination_block: 0, illumination_order_first: 'dim' as const, lux_readings: [], lux_all_in_range: null, lux_deviation_note: null, screen_white_luminance_cd_m2: 120,
      brightness_percent: 80, session_start_time: 1700001000000, session_end_time: null, randomisation_seed: 1,
      condition_order: [1], preflight_complete: true, consent_given: true, consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: prov,
      device_type: 'Android', browser: 'Chrome', screen_resolution: '2880x1800',
      conditions_per_session: 4, condition_offset: 4, session_index: 2,
    });
    await put('participants', {
      participant_id: 'P001', enrolment_number: 1, age: 25, gender: 'f', daily_screen_hours: 6,
      device_familiarity: 'high', lighting_habit: 'moderate', correction_type: 'none', cvd_status: 'normal',
      ishihara_correct: 14, ishihara_total: 14, caffeine_today: null, hours_since_sleep: null,
      eligible: true, exclusion_reason: null, baseline_fatigue: 1, session_id: 'S1',
    });
    await purgeSession('S1');
    // S1 gone, but the shared participant must survive because S2 still references it.
    expect(await gatherSession('S1')).toBeNull();
    expect(await get('participants', 'P001')).toBeTruthy();

    // Purging the last remaining sitting now removes the participant.
    await purgeSession('S2');
    expect(await get('participants', 'P001')).toBeUndefined();
  });

  it('aggregates and exports the gathered bundle', async () => {
    await seed();
    const bundle = (await gatherSession('S1'))!;
    const summaries = buildConditionSummaries(bundle);
    expect(summaries[0].mean_rt_hits_ms).toBe(460);
    const files = buildExportFiles(bundle);
    expect(files.some((f) => f.filename === '10_wide_summary.csv')).toBe(true);
    expect(files.some((f) => f.filename === 'export_manifest.json')).toBe(true);
  });
});
