import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, _resetForTests } from '@/storage/db';
import { gatherSession, listSessions } from '@/storage/gather';
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
    session_id: 'S1', participant_id: 'P001', enrolment_number: 1, status: 'complete', deleted_at: null, display_label: null, ambient_lux: 350, ambient_illumination_level: null,
    screen_white_luminance_cd_m2: 120, brightness_percent: 80, session_start_time: 1700000000000,
    session_end_time: 1700000600000, randomisation_seed: 1, condition_order: [0], preflight_complete: true,
    consent_given: true, consent_time: 1, provenance: prov, device_type: 'Android', browser: 'Chrome', screen_resolution: '2880x1800',
  });
  await put('conditions', {
    condition_id: 'A', session_id: 'S1', session_position: 0, condition_label: 'C1', polarity: 'positive',
    background_color: '#FFFFFF', text_color: '#000000', color_name: 'black', passage_id: 0,
    wcag_contrast_ratio: 21, wcag_level: 'AAA', michelson_contrast: 1, below_wcag_aa: false,
    started_at: 1, completed_at: 2, condition_duration_sec: 1, adaptation_ms_before: 0, reading_time_ms: null
  });
  await put('fatigue_scores', {
    fatigue_id: 'f0', session_id: 'S1', condition_id: null, stage: 'baseline', eye_strain: 1, dryness: 1,
    blur: 1, burning: 1, headache: 1, fatigue_mean: 1,
    touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true }, all_touched: true,
  });
  await put('rt_summaries', {
    condition_id: 'A', session_id: 'S1', total_trials: 48, signal_trials: 24, hits: 22, false_alarms: 2,
    misses: 2, correct_rejections: 22, hit_rate: 0.92, false_alarm_rate: 0.08, error_rate: 0.1, rt_cv: 0.2, mean_rt_hits_ms: 460,
    median_rt_hits_ms: 455, rt_sd_ms: 50, mean_rt_congruent_ms: 440, mean_rt_incongruent_ms: 480,
    flanker_congruency_effect_ms: 40, d_prime: 2.8, d_prime_se: 0.45, d_prime_unstable: true,
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
