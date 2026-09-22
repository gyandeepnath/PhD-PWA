import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, get, _resetForTests } from '@/storage/db';
import { gatherSession, listSessions, purgeSession, normaliseBundle } from '@/storage/gather';
import { buildFixtureBundle } from '@/sim/bundleFixture';
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
    session_end_time: 1700000600000, randomisation_seed: 1, condition_order: [0], preflight_complete: true, e2e_timing: false,
    consent_given: true, consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: prov, device_type: 'Android', browser: 'Chrome', screen_resolution: '2880x1800', stimulus_scale: 1, layout_viewport: '1194x834',
    conditions_per_session: 8, condition_offset: 0, session_index: 1,
  });
  await put('conditions', {
    condition_id: 'A', session_id: 'S1', session_position: 0, condition_label: 'C1', polarity: 'positive',
    background_color: '#FFFFFF', text_color: '#000000', color_name: 'black', ink_name: 'black', passage_id: 0,
    wcag_contrast_ratio: 21, wcag_level: 'AAA', michelson_contrast: 1, below_wcag_aa: false,
    started_at: 1, completed_at: 2, condition_duration_sec: 1, passage_repeat_number: 1, adaptation_ms_before: 0, reading_time_ms: null
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
    d_prime: 2.8, d_prime_se: 0.45, d_prime_unstable: true, criterion: -0.3, d_prime_estimable: true,
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
      condition_order: [1], preflight_complete: true, e2e_timing: false, consent_given: true, consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: prov,
      device_type: 'Android', browser: 'Chrome', screen_resolution: '2880x1800', stimulus_scale: 1, layout_viewport: '1194x834',
      conditions_per_session: 4, condition_offset: 4, session_index: 2,
    });
    await put('participants', {
      participant_id: 'P001', enrolment_number: 1, age: 25, gender: 'f', daily_screen_hours: 6,
      device_familiarity: 'high', lighting_habit: 'moderate', correction_type: 'none', cvd_status: 'normal',
      cvd_screen_correct: 14, cvd_screen_total: 14, cvd_clinical: 'normal' as const, caffeine_today: null, hours_since_sleep: null,
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

/**
 * Row order inside a condition is the order the rows were ADMINISTERED, not the order their uuids
 * happen to sort in.
 *
 * `normaliseBundle`'s docstring promises "a reader scanning any file sees the session in the order
 * it was actually run", and the comment above the comprehension sort says it lists gist, inference
 * and detail "in the order they were administered". Neither was true. The within-condition
 * tie-breaks were written as `byCondition(idKey)(x, y) || x.trial_number - y.trial_number`, and
 * `byCondition` falls back to comparing the record ids — two rows in one condition always have
 * different uuids, so the `||` never evaluated.
 *
 * Nothing COMPUTED was wrong: trial_number and question_index are columns in every row, and every
 * consumer keys by id. The damage is that file order silently meant nothing while two comments said
 * it meant something. An analyst reading 08_reaction_trials.csv top to bottom for a sequential
 * effect — post-error slowing, time-on-task drift — read a sequence shuffled inside each 32-trial
 * block, with nothing to indicate it.
 */
describe('rows within a condition are in administration order', () => {
  it('orders reaction trials by trial_number, not by trial_id', () => {
    const b = buildFixtureBundle();
    const n = normaliseBundle({ ...b, reactionTrials: [...b.reactionTrials].reverse() });
    for (const c of n.conditions) {
      const nums = n.reactionTrials.filter((t) => t.condition_id === c.condition_id).map((t) => t.trial_number);
      expect(nums.length).toBeGreaterThan(1);
      expect(nums, `trials out of order in ${c.condition_id}`).toEqual([...nums].sort((x, y) => x - y));
    }
  });

  it('orders comprehension items by question_index even when the uuids sort the other way', () => {
    /*
     * The ids are rewritten so lexicographic order is the REVERSE of administration order. Without
     * that the fixture's own ids already happen to sort correctly, and the test would pass against
     * the defect — a check that cannot fail is worse than no check.
     */
    const b = buildFixtureBundle();
    const comprehension = b.comprehension.map((r) => ({
      ...r, comprehension_id: `${r.condition_id}-${9 - r.question_index}`,
    }));
    const n = normaliseBundle({ ...b, comprehension });
    for (const c of n.conditions) {
      const idx = n.comprehension.filter((r) => r.condition_id === c.condition_id).map((r) => r.question_index);
      expect(idx.length).toBeGreaterThan(1);
      expect(idx, `items out of order in ${c.condition_id}`).toEqual([...idx].sort((x, y) => x - y));
    }
  });

  it('still orders conditions by session position, and stays total', () => {
    // The id remains the FINAL tie-break, so the ordering is still deterministic and the export
    // stays byte-reproducible. Two runs over differently-ordered inputs must agree exactly.
    const b = buildFixtureBundle();
    const a = normaliseBundle(b);
    const z = normaliseBundle({
      ...b,
      conditions: [...b.conditions].reverse(),
      reactionTrials: [...b.reactionTrials].reverse(),
      comprehension: [...b.comprehension].reverse(),
    });
    expect(a.conditions.map((c) => c.session_position)).toEqual(
      [...a.conditions.map((c) => c.session_position)].sort((x, y) => x - y),
    );
    expect(z.reactionTrials.map((t) => t.trial_id)).toEqual(a.reactionTrials.map((t) => t.trial_id));
    expect(z.comprehension.map((r) => r.comprehension_id)).toEqual(a.comprehension.map((r) => r.comprehension_id));
  });
});
