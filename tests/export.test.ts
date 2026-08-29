import { describe, it, expect } from 'vitest';
import { buildConditionSummaries, baselineFatigueMean } from '@/dashboard/aggregate';
import { buildExportFiles, escapeCsv, toCsv, fnv1a } from '@/storage/export';
import type { SessionBundle } from '@/storage/gather';
import type { Provenance } from '@/storage/types';

const prov: Provenance = {
  app_version: '2.1.0', git_hash: 'abc1234', build_time: 't', condition_def_hash: 'def5678', schema_version: 6,
};

function bundle(): SessionBundle {
  return {
    session: {
      session_id: 'S1', participant_id: 'P001', enrolment_number: 1, status: 'complete', deleted_at: null, display_label: null, ambient_lux: 350, ambient_illumination_level: null, illumination_block: 0, illumination_order_first: 'dim' as const, lux_readings: [], lux_all_in_range: null, lux_deviation_note: null,
      screen_white_luminance_cd_m2: 120, brightness_percent: 80, session_start_time: 1700000000000,
      session_end_time: 1700000600000, randomisation_seed: 1, condition_order: [0, 1],
      preflight_complete: true, consent_given: true, consent_time: 1, media_consent: { camera_metrics: true, setup_photos: false, annotation_video: false, granted_at: null }, provenance: prov,
      device_type: 'Android', browser: 'Chrome', screen_resolution: '2880x1800',
      conditions_per_session: 8, condition_offset: 0, session_index: 1,
    },
    participant: undefined,
    conditions: [
      { condition_id: 'A', session_id: 'S1', session_position: 0, condition_label: 'C1', polarity: 'positive', background_color: '#FFFFFF', text_color: '#000000', color_name: 'black', ink_name: 'black', passage_id: 3, wcag_contrast_ratio: 21, wcag_level: 'AAA', michelson_contrast: 1, below_wcag_aa: false, started_at: 1, completed_at: 2, condition_duration_sec: 1, passage_repeat_number: 1, adaptation_ms_before: 0, reading_time_ms: null },
      { condition_id: 'B', session_id: 'S1', session_position: 1, condition_label: 'C4', polarity: 'positive', background_color: '#FFFFFF', text_color: '#C9A400', color_name: 'yellow', ink_name: 'yellow', passage_id: 5, wcag_contrast_ratio: 2.39, wcag_level: 'Fail', michelson_contrast: 0.4, below_wcag_aa: true, started_at: 3, completed_at: 4, condition_duration_sec: 1, passage_repeat_number: 1, adaptation_ms_before: 60000, reading_time_ms: null },
    ],
    fatigue: [
      { fatigue_id: 'f0', session_id: 'S1', condition_id: null, stage: 'baseline', eye_strain: 1, dryness: 1, blur: 1, burning: 1, headache: 1, fatigue_mean: 1, touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true }, all_touched: true, response_time_ms: 8000 },
      { fatigue_id: 'f1', session_id: 'S1', condition_id: 'A', stage: 'post_condition', eye_strain: 2, dryness: 3, blur: 2, burning: 1, headache: 2, fatigue_mean: 2, touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true }, all_touched: true, response_time_ms: 8000 },
      { fatigue_id: 'f2', session_id: 'S1', condition_id: 'B', stage: 'post_condition', eye_strain: 4, dryness: 5, blur: 3, burning: 4, headache: 4, fatigue_mean: 4, touched: { eye_strain: true, dryness: true, blur: true, burning: true, headache: true }, all_touched: true, response_time_ms: 8000 },
    ],
    media: [],
    tlx: [],
    cvsq: [],
    comprehension: [
      { comprehension_id: 'c1', session_id: 'S1', condition_id: 'A', passage_id: 3, question_index: 0, question_kind: 'detail', selected_index: 2, correct_index: 2, is_correct: true, response_time_ms: 2500 },
    ],
    visualSearch: [
      { condition_id: 'A', session_id: 'S1', passage_id: 3, search_target: 'plate', targets_in_set: 5, search_time_ms: 12000, time_to_first_target_ms: 800, targets_found: 5, targets_missed: 0, false_detections: 1, accuracy_rate: 1, search_efficiency: 25, mean_inter_target_interval_ms: 2000, termination_mode: 'voluntary_full' },
    ],
    perception: [
      { perception_id: 'p1', session_id: 'S1', condition_id: 'A', display_comfort_score: 80, text_clarity_score: 90, comfort_touched: true, clarity_touched: true, response_time_ms: 5000 },
    ],
    eyeMetrics: [
      { condition_id: 'A', session_id: 'S1', camera_active: true, effective_fps: 28, fps_adequate_for_tiers: true, fps_adequate_for_ratio: true, blink_rate: 9, blink_rate_full: 8, incomplete_blink_ratio: 0.1, blink_duration_mean_ms: 150, bins: { first_half_blink_rate: 8, second_half_blink_rate: 10 }, mean_inter_blink_interval_ms: 6000, inter_blink_interval_cv: 0.3, perclos_p80: 0.05, perclos_p70: 0.08, long_closure_count: 0, long_closure_total_ms: 0, blink_rate_micro: 0, blink_count_full: 8, blink_count_micro: 0, blink_count_incomplete: 1, ear_baseline: 0.3, ear_threshold_used: 0.18, head_pitch_mean: 2, head_pitch_calibrated: true, head_yaw_mean: 1, head_roll_mean: 0, head_movement_std: 1, postural_load: 1.5, head_stability_score: 0.5, off_axis_ratio: 0.1, gaze_calibrated: false, gaze_deviation_ratio: 0.2, zone_center_ratio: 0.8, zone_transition_count: 5, face_presence_ratio: 0.95, face_size_ratio: 0.2, mean_face_luma: 130, lighting_quality: 'good' },
      { condition_id: 'B', session_id: 'S1', camera_active: false, effective_fps: null, fps_adequate_for_tiers: false, fps_adequate_for_ratio: false, blink_rate: 0, blink_rate_full: 0, incomplete_blink_ratio: 0, blink_duration_mean_ms: null, bins: { first_half_blink_rate: null, second_half_blink_rate: null }, mean_inter_blink_interval_ms: null, inter_blink_interval_cv: null, perclos_p80: null, perclos_p70: null, long_closure_count: 0, long_closure_total_ms: 0, blink_rate_micro: 0, blink_count_full: 0, blink_count_micro: 0, blink_count_incomplete: 0, ear_baseline: null, ear_threshold_used: null, head_pitch_mean: 0, head_pitch_calibrated: false, head_yaw_mean: 0, head_roll_mean: 0, head_movement_std: 0, postural_load: 0, head_stability_score: 0, off_axis_ratio: 0, gaze_calibrated: false, gaze_deviation_ratio: 0, zone_center_ratio: 0, zone_transition_count: 0, face_presence_ratio: 0, face_size_ratio: 0, mean_face_luma: null, lighting_quality: null },
    ],
    reactionTrials: Array.from({ length: 48 }, (_, i) => ({ trial_id: `t${i}`, condition_id: 'A', session_id: 'S1', trial_number: i, trial_category: 'signal' as const, is_signal: true, stimulus_onset_time: 0, response_time_ms: 450, accuracy: 'hit' as const, false_start: false, anticipatory: false })),
    rtSummaries: [
      { condition_id: 'A', session_id: 'S1', total_trials: 48, signal_trials: 24, hits: 22, false_alarms: 2, misses: 2, correct_rejections: 22, hit_rate: 0.92, false_alarm_rate: 0.08, error_rate: 0.1, rt_cv: 0.2, anticipations: 0, lapse_count: 0, lapse_rate: 0, inverse_efficiency_ms: 460, first_half_mean_rt_ms: 450, second_half_mean_rt_ms: 470, mean_rt_hits_ms: 460, median_rt_hits_ms: 455, rt_sd_ms: 50, d_prime: 2.8, d_prime_se: 0.45, d_prime_unstable: true, d_prime_estimable: true, criterion: -0.3 },
    ],
    calibration: [
      { calibration_id: 'cal1', session_id: 'S1', is_real_calibration: true, targets_detected: 9, targets_total: 9, ear_baseline: 0.31, gaze_h_threshold: 0.12, gaze_v_threshold: 0.1, pitch_baseline_frac: 0.46 },
    ],
  };
}

describe('CSV helpers', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(escapeCsv('plain')).toBe('plain');
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('she said "hi"')).toBe('"she said ""hi"""');
    expect(escapeCsv(null)).toBe('');
  });
  it('builds csv with stable headers', () => {
    const out = toCsv(['a', 'b'], [{ a: 1, b: 2 }, { a: 3, b: 'x,y' }]);
    expect(out).toBe('a,b\n1,2\n3,"x,y"');
  });
  it('emits header-only csv for empty rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });
});

describe('condition aggregation', () => {
  it('produces one summary per condition with joined data', () => {
    const s = buildConditionSummaries(bundle());
    expect(s).toHaveLength(2);
    expect(s[0].mean_rt_hits_ms).toBe(460);
    expect(s[0].comprehension_correct).toBe(1);
    expect(s[0].search_accuracy).toBe(1);
  });
  it('computes fatigue delta from baseline', () => {
    expect(baselineFatigueMean(bundle())).toBe(1);
    const s = buildConditionSummaries(bundle());
    expect(s[0].fatigue_delta).toBe(1); // 2 - 1
    expect(s[1].fatigue_delta).toBe(3); // 4 - 1
  });
  it('flags QC: good camera condition vs camera-off condition', () => {
    const s = buildConditionSummaries(bundle());
    expect(s[0].qc.overall).toBe('good'); // fps 28, presence .95, offAxis .1
    expect(s[1].camera_active).toBe(false);
    expect(s[1].qc.overall).toBe('warn'); // camera off -> warn, not bad
  });
  it('carries the below-AA contrast flag (C4)', () => {
    const s = buildConditionSummaries(bundle());
    expect(s[1].below_wcag_aa).toBe(true);
    expect(s[1].wcag_level).toBe('Fail');
  });
});

describe('export builder', () => {
  const files = buildExportFiles(bundle());
  const names = files.map((f) => f.filename);

  it('produces all 18 CSVs + JSON + manifest', () => {
    expect(names).toContain('00_CODEBOOK.csv');
    expect(names).toContain('10_wide_summary.csv');
    expect(names).toContain('12_quality_flags.csv');
    expect(names.filter((n) => n.endsWith('.csv'))).toHaveLength(18);
    expect(names).toContain('export_manifest.json');
    expect(names.some((n) => n.startsWith('session_P001_'))).toBe(true);
  });

  it('emits participant + CVS-Q CSVs with covariate/instrument columns (no longer JSON-only)', () => {
    const p = files.find((f) => f.filename === '11_participant.csv')!;
    expect(p).toBeTruthy();
    const pHeader = p.content.split('\n')[0];
    for (const col of ['age', 'gender', 'cvd_status', 'ishihara_correct', 'hours_since_sleep']) {
      expect(pHeader).toContain(col);
    }
    const q = files.find((f) => f.filename === '13_cvsq.csv')!;
    expect(q).toBeTruthy();
    expect(q.content.split('\n')[0]).toContain('total_score');
  });

  it('07_eye_metrics CSV now carries ear_baseline + head_movement_std + face_size_ratio', () => {
    const header = files.find((f) => f.filename === '07_eye_metrics.csv')!.content.split('\n')[0];
    for (const col of ['ear_baseline', 'ear_threshold_used', 'head_movement_std', 'face_size_ratio']) {
      expect(header).toContain(col);
    }
  });

  it('wide summary + quality flags carry the engagement columns', () => {
    const wide = files.find((f) => f.filename === '10_wide_summary.csv')!;
    expect(wide.content.split('\n')[0]).toContain('engagement_flag');
    const qf = files.find((f) => f.filename === '12_quality_flags.csv')!;
    const lines = qf.content.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2 conditions
    expect(lines[0]).toContain('reading_skim');
    expect(lines[0]).toContain('reasons');
  });

  it('reaction-trials CSV has 48 data rows', () => {
    const f = files.find((f) => f.filename === '08_reaction_trials.csv')!;
    expect(f.content.trim().split('\n').length).toBe(49); // header + 48
  });

  it('wide summary has a row per condition and includes qc + contrast', () => {
    const f = files.find((f) => f.filename === '10_wide_summary.csv')!;
    const lines = f.content.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2
    expect(lines[0]).toContain('wcag_contrast_ratio');
    expect(lines[0]).toContain('qc_overall');
  });

  it('manifest lists every file with a checksum', () => {
    const m = JSON.parse(files.find((f) => f.filename === 'export_manifest.json')!.content);
    // Manifest lists every file except itself.
    expect(m.files.length).toBe(files.length - 1);
    expect(m.provenance.condition_def_hash).toBe('def5678');
    for (const entry of m.files) expect(entry.checksum_fnv1a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('checksum is stable and content-sensitive', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).not.toBe(fnv1a('hellp'));
  });
});
