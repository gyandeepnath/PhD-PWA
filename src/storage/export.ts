/**
 * Export builder. Produces the CSV bundle + JSON + master codebook + a provenance manifest with
 * per-file checksums. Pure (`buildExportFiles`) so it is fully unit-testable; `downloadExport`
 * is the thin browser wrapper that streams the files to the device.
 */
import type { SessionBundle } from './gather';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { PASSAGES } from '@/experiment/passages';

export interface ExportFile {
  filename: string;
  content: string;
  mime: string;
}

/** CSV-escape a single value: wrap in quotes and double internal quotes when needed. */
export function escapeCsv(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  // Quote when the value contains a quote, comma, or ANY line break (\n or \r) — a bare \r would
  // otherwise be treated as a row terminator by Excel/read.csv and silently misalign columns.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from explicit headers and object rows (stable column order). */
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.join(',');
  const body = rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(',')).join('\n');
  return body ? `${head}\n${body}` : head;
}

/** FNV-1a 32-bit hash (hex) — lightweight integrity checksum for the manifest. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function buildExportFiles(bundle: SessionBundle): ExportFile[] {
  const { session, participant } = bundle;
  const pid = session.participant_id;
  const date = new Date(session.session_start_time).toISOString().slice(0, 10);
  const summaries = buildConditionSummaries(bundle);
  const files: ExportFile[] = [];
  const csv = (filename: string, headers: string[], rows: Record<string, unknown>[]) =>
    files.push({ filename, content: toCsv(headers, rows), mime: 'text/csv' });

  // 00 — codebook / condition key
  csv('00_MASTER_CODEBOOK.csv',
    ['condition_label', 'color_name', 'polarity', 'background_color', 'text_color', 'wcag_contrast_ratio', 'wcag_level', 'below_wcag_aa'],
    bundle.conditions.map((c) => ({
      condition_label: c.condition_label, color_name: c.color_name, polarity: c.polarity,
      background_color: c.background_color, text_color: c.text_color,
      wcag_contrast_ratio: c.wcag_contrast_ratio, wcag_level: c.wcag_level, below_wcag_aa: c.below_wcag_aa,
    })));

  // 01 — session info
  csv('01_session_info.csv',
    ['participant_id', 'experiment_date', 'enrolment_number', 'session_index', 'conditions_per_session', 'condition_offset', 'ambient_lux', 'ambient_illumination_level', 'screen_white_luminance_cd_m2', 'brightness_percent', 'session_duration_min', 'app_version', 'git_hash', 'condition_def_hash', 'schema_version', 'device_type', 'screen_resolution', 'consent_given', 'preflight_complete', 'gaze_calibration_valid', 'calibration_ear_baseline', 'calibration_pitch_baseline_frac', 'calibration_targets_detected'],
    [{
      participant_id: pid, experiment_date: date, enrolment_number: session.enrolment_number,
      session_index: session.session_index, conditions_per_session: session.conditions_per_session, condition_offset: session.condition_offset,
      ambient_lux: session.ambient_lux, ambient_illumination_level: session.ambient_illumination_level,
      screen_white_luminance_cd_m2: session.screen_white_luminance_cd_m2,
      brightness_percent: session.brightness_percent,
      session_duration_min: session.session_end_time ? ((session.session_end_time - session.session_start_time) / 60000).toFixed(2) : '',
      app_version: session.provenance.app_version, git_hash: session.provenance.git_hash,
      condition_def_hash: session.provenance.condition_def_hash, schema_version: session.provenance.schema_version,
      device_type: session.device_type, screen_resolution: session.screen_resolution,
      consent_given: session.consent_given, preflight_complete: session.preflight_complete,
      gaze_calibration_valid: bundle.calibration[0]?.is_real_calibration ?? '',
      calibration_ear_baseline: bundle.calibration[0]?.ear_baseline ?? '',
      calibration_pitch_baseline_frac: bundle.calibration[0]?.pitch_baseline_frac ?? '',
      calibration_targets_detected: bundle.calibration[0] ? `${bundle.calibration[0].targets_detected}/${bundle.calibration[0].targets_total}` : '',
    }]);

  // 02 — conditions (+ reading speed in words/min, derived from passage length & reading time)
  csv('02_conditions.csv',
    ['participant_id', 'condition_id', 'session_position', 'condition_label', 'polarity', 'background_color', 'text_color', 'color_name', 'passage_id', 'wcag_contrast_ratio', 'wcag_level', 'michelson_contrast', 'below_wcag_aa', 'adaptation_ms_before', 'reading_time_ms', 'reading_speed_wpm', 'condition_duration_sec'],
    bundle.conditions.map((c) => {
      const words = PASSAGES[c.passage_id]?.wordCount ?? null;
      const wpm = words != null && c.reading_time_ms ? Math.round(words / (c.reading_time_ms / 60000)) : '';
      return { participant_id: pid, ...c, reading_speed_wpm: wpm };
    }));

  // 03 — fatigue
  csv('03_fatigue_scores.csv',
    ['participant_id', 'condition_id', 'stage', 'eye_strain', 'dryness', 'blur', 'burning', 'headache', 'fatigue_mean', 'all_touched', 'response_time_ms'],
    bundle.fatigue.map((f) => ({ participant_id: pid, condition_id: f.condition_id ?? '', stage: f.stage, eye_strain: f.eye_strain, dryness: f.dryness, blur: f.blur, burning: f.burning, headache: f.headache, fatigue_mean: f.fatigue_mean, all_touched: f.all_touched, response_time_ms: f.response_time_ms })));

  // 04 — comprehension
  csv('04_comprehension.csv',
    ['participant_id', 'condition_id', 'passage_id', 'selected_index', 'correct_index', 'is_correct', 'response_time_ms'],
    bundle.comprehension.map((c) => ({ participant_id: pid, ...c, comprehension_id: undefined, session_id: undefined })));

  // 05 — visual search
  csv('05_visual_search.csv',
    ['participant_id', 'condition_id', 'passage_id', 'search_target', 'targets_in_set', 'search_time_ms', 'time_to_first_target_ms', 'targets_found', 'targets_missed', 'false_detections', 'accuracy_rate', 'search_efficiency', 'mean_inter_target_interval_ms', 'termination_mode'],
    bundle.visualSearch.map((v) => ({ participant_id: pid, ...v })));

  // 06 — display perception
  csv('06_display_perception.csv',
    ['participant_id', 'condition_id', 'display_comfort_score', 'text_clarity_score', 'comfort_touched', 'clarity_touched', 'response_time_ms'],
    bundle.perception.map((p) => ({ participant_id: pid, condition_id: p.condition_id, display_comfort_score: p.display_comfort_score, text_clarity_score: p.text_clarity_score, comfort_touched: p.comfort_touched, clarity_touched: p.clarity_touched, response_time_ms: p.response_time_ms })));

  // 07 — eye metrics
  csv('07_eye_metrics.csv',
    ['participant_id', 'condition_id', 'camera_active', 'effective_fps', 'fps_adequate_for_tiers', 'blink_rate', 'blink_rate_full', 'incomplete_blink_ratio', 'mean_inter_blink_interval_ms', 'inter_blink_interval_cv', 'perclos_p80', 'perclos_p70', 'long_closure_count', 'long_closure_total_ms', 'blink_duration_mean_ms', 'first_half_blink_rate', 'second_half_blink_rate', 'ear_baseline', 'ear_threshold_used', 'head_pitch_mean', 'head_pitch_calibrated', 'head_yaw_mean', 'head_roll_mean', 'head_movement_std', 'postural_load', 'head_stability_score', 'off_axis_ratio', 'gaze_calibrated', 'gaze_deviation_ratio', 'zone_center_ratio', 'zone_transition_count', 'face_presence_ratio', 'face_size_ratio', 'mean_face_luma', 'lighting_quality'],
    bundle.eyeMetrics.map((e) => ({
      participant_id: pid, condition_id: e.condition_id, camera_active: e.camera_active,
      effective_fps: e.effective_fps, fps_adequate_for_tiers: e.fps_adequate_for_tiers,
      blink_rate: e.blink_rate, blink_rate_full: e.blink_rate_full, incomplete_blink_ratio: e.incomplete_blink_ratio,
      mean_inter_blink_interval_ms: e.mean_inter_blink_interval_ms, inter_blink_interval_cv: e.inter_blink_interval_cv,
      perclos_p80: e.perclos_p80, perclos_p70: e.perclos_p70, long_closure_count: e.long_closure_count, long_closure_total_ms: e.long_closure_total_ms,
      blink_duration_mean_ms: e.blink_duration_mean_ms,
      first_half_blink_rate: e.bins.first_half_blink_rate, second_half_blink_rate: e.bins.second_half_blink_rate,
      ear_baseline: e.ear_baseline, ear_threshold_used: e.ear_threshold_used,
      head_pitch_mean: e.head_pitch_mean, head_pitch_calibrated: e.head_pitch_calibrated, head_yaw_mean: e.head_yaw_mean, head_roll_mean: e.head_roll_mean,
      head_movement_std: e.head_movement_std,
      postural_load: e.postural_load, head_stability_score: e.head_stability_score, off_axis_ratio: e.off_axis_ratio,
      gaze_calibrated: e.gaze_calibrated, gaze_deviation_ratio: e.gaze_deviation_ratio,
      zone_center_ratio: e.zone_center_ratio, zone_transition_count: e.zone_transition_count,
      face_presence_ratio: e.face_presence_ratio, face_size_ratio: e.face_size_ratio, mean_face_luma: e.mean_face_luma, lighting_quality: e.lighting_quality,
    })));

  // 08 — reaction trials
  csv('08_reaction_trials.csv',
    ['participant_id', 'condition_id', 'trial_number', 'trial_category', 'is_signal', 'response_time_ms', 'accuracy', 'anticipatory', 'false_start'],
    bundle.reactionTrials.map((t) => ({ participant_id: pid, condition_id: t.condition_id, trial_number: t.trial_number, trial_category: t.trial_category, is_signal: t.is_signal, response_time_ms: t.response_time_ms, accuracy: t.accuracy, anticipatory: t.anticipatory, false_start: t.false_start })));

  // 09 — rt summary
  csv('09_rt_summary.csv',
    ['participant_id', 'condition_id', 'total_trials', 'signal_trials', 'hits', 'false_alarms', 'misses', 'correct_rejections', 'hit_rate', 'false_alarm_rate', 'error_rate', 'mean_rt_hits_ms', 'median_rt_hits_ms', 'rt_sd_ms', 'rt_cv', 'anticipations', 'lapse_count', 'lapse_rate', 'inverse_efficiency_ms', 'first_half_mean_rt_ms', 'second_half_mean_rt_ms', 'd_prime', 'd_prime_se', 'd_prime_unstable', 'criterion'],
    bundle.rtSummaries.map((r) => ({ participant_id: pid, ...r })));

  // 10 — wide one-row-per-condition summary (joined)
  csv('10_wide_summary.csv',
    ['participant_id', 'session_index', 'condition_label', 'session_position', 'polarity', 'color_name', 'wcag_contrast_ratio', 'below_wcag_aa', 'passage_id', 'mean_rt_hits_ms', 'd_prime', 'd_prime_se', 'criterion', 'fatigue_mean', 'fatigue_delta', 'comprehension_correct', 'search_accuracy', 'search_efficiency', 'comfort_score', 'clarity_score', 'blink_rate', 'blink_rate_full', 'effective_fps', 'face_presence_ratio', 'qc_overall', 'engagement_flag', 'quality_score'],
    summaries.map((s) => ({
      participant_id: pid, session_index: session.session_index, condition_label: s.condition_label, session_position: s.session_position,
      polarity: s.polarity, color_name: s.color_name, wcag_contrast_ratio: s.wcag_contrast_ratio,
      below_wcag_aa: s.below_wcag_aa, passage_id: s.passage_id, mean_rt_hits_ms: s.mean_rt_hits_ms,
      d_prime: s.d_prime, d_prime_se: s.d_prime_se, criterion: s.criterion,
      fatigue_mean: s.fatigue_mean, fatigue_delta: s.fatigue_delta, comprehension_correct: s.comprehension_correct,
      search_accuracy: s.search_accuracy, search_efficiency: s.search_efficiency, comfort_score: s.comfort_score,
      clarity_score: s.clarity_score, blink_rate: s.blink_rate, blink_rate_full: s.blink_rate_full,
      effective_fps: s.effective_fps, face_presence_ratio: s.face_presence_ratio, qc_overall: s.qc.overall,
      engagement_flag: s.engagement, quality_score: s.quality_score,
    })));

  // 12 — engagement / careless-responding quality flags (boredom & disengagement detection)
  csv('12_quality_flags.csv',
    ['participant_id', 'session_index', 'condition_label', 'session_position', 'engagement_flag', 'quality_score', 'reading_time_ms', 'fatigue_response_ms', 'perception_response_ms', 'reading_skim', 'rt_disengaged', 'careless_rushed_fatigue', 'careless_rushed_perception', 'careless_straight_lined', 'comprehension_wrong', 'low_face_presence', 'reasons'],
    summaries.map((s) => ({
      participant_id: pid, session_index: session.session_index, condition_label: s.condition_label,
      session_position: s.session_position, engagement_flag: s.engagement, quality_score: s.quality_score,
      reading_time_ms: s.reading_time_ms, fatigue_response_ms: s.fatigue_response_ms, perception_response_ms: s.perception_response_ms,
      reading_skim: s.reading_skim, rt_disengaged: s.rt_disengaged, careless_rushed_fatigue: s.careless_rushed_fatigue,
      careless_rushed_perception: s.careless_rushed_perception, careless_straight_lined: s.careless_straight_lined,
      comprehension_wrong: s.comprehension_wrong, low_face_presence: s.low_face_presence, reasons: s.engagement_reasons.join('; '),
    })));

  // 11 — participant demographics + vision covariates (previously available only in the JSON bundle,
  // so the documented CSV analysis pipeline could not control for age/screen-habits/vision status).
  csv('11_participant.csv',
    ['participant_id', 'enrolment_number', 'age', 'gender', 'daily_screen_hours', 'device_familiarity', 'lighting_habit', 'correction_type', 'cvd_status', 'ishihara_correct', 'ishihara_total', 'caffeine_today', 'hours_since_sleep', 'eligible', 'exclusion_reason', 'baseline_fatigue'],
    participant ? [{ ...participant }] : []);

  // 13 — CVS-Q symptom questionnaire (baseline + session-end), wide with per-item columns. Was
  // JSON-only; the validated primary symptom instrument is now in the numbered CSV bundle.
  const maxCvsqItems = bundle.cvsq.reduce((m, c) => Math.max(m, c.frequency.length, c.intensity.length), 0);
  const cvsqItemCols = [
    ...Array.from({ length: maxCvsqItems }, (_, i) => `freq_${i + 1}`),
    ...Array.from({ length: maxCvsqItems }, (_, i) => `intensity_${i + 1}`),
  ];
  csv('13_cvsq.csv',
    ['participant_id', 'stage', 'total_score', 'symptomatic', 'response_time_ms', ...cvsqItemCols],
    bundle.cvsq.map((c) => {
      const row: Record<string, unknown> = {
        participant_id: pid, stage: c.stage, total_score: c.total_score,
        symptomatic: c.symptomatic, response_time_ms: c.response_time_ms,
      };
      c.frequency.forEach((f, i) => { row[`freq_${i + 1}`] = f; });
      c.intensity.forEach((v, i) => { row[`intensity_${i + 1}`] = v; });
      return row;
    }));

  // JSON bundle
  const jsonBundle = {
    exported_at: new Date().toISOString(),
    provenance: session.provenance,
    session, participant,
    conditions: bundle.conditions, fatigue: bundle.fatigue, cvsq: bundle.cvsq,
    comprehension: bundle.comprehension, visual_search: bundle.visualSearch,
    display_perception: bundle.perception, eye_metrics: bundle.eyeMetrics,
    calibration: bundle.calibration,
    rt_summaries: bundle.rtSummaries, reaction_trials_count: bundle.reactionTrials.length,
  };
  files.push({ filename: `session_${pid}_${session.session_id.slice(0, 8)}.json`, content: JSON.stringify(jsonBundle, null, 2), mime: 'application/json' });

  // Manifest with checksums
  const manifest = {
    exported_at: new Date().toISOString(),
    provenance: session.provenance,
    participant_id: pid,
    files: files.map((f) => ({ filename: f.filename, bytes: f.content.length, checksum_fnv1a: fnv1a(f.content) })),
  };
  files.push({ filename: 'export_manifest.json', content: JSON.stringify(manifest, null, 2), mime: 'application/json' });

  return files;
}

/** Browser-only: stream the files to the device (staggered to avoid the download-blocker). */
export async function downloadExport(files: ExportFile[]): Promise<void> {
  for (const f of files) {
    const blob = new Blob([f.content], { type: f.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await new Promise((r) => setTimeout(r, 130));
  }
}
