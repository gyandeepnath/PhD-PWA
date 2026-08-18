/**
 * Export builder. Produces the CSV bundle + JSON + master codebook + a provenance manifest with
 * per-file checksums. Pure (`buildExportFiles`) so it is fully unit-testable; `downloadExport`
 * is the thin browser wrapper that streams the files to the device.
 */
import type { SessionBundle } from './gather';
import type { SessionRecord } from './types';
import { summariseLux, LUX_CHECKPOINTS } from '@/experiment/illumination';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { PASSAGES } from '@/experiment/passages';
import { CONDITIONS } from '@/experiment/conditions';
import { auditBundle } from './integrity';

export interface ExportFile {
  filename: string;
  content: string;
  mime: string;
}

/** One logged illuminance reading, or '' when that checkpoint was never taken. */
function luxAt(session: SessionRecord, cp: 'start' | 'middle' | 'end'): number | '' {
  return session.lux_readings?.find((r) => r.checkpoint === cp)?.lux ?? '';
}

/** Mean and worst deviation across whatever readings exist for the session's assigned level. */
function luxSummary(session: SessionRecord): { mean: number | null; max_deviation: number | null } {
  const s = summariseLux(session.ambient_illumination_level, session.lux_readings);
  return { mean: s.mean, max_deviation: s.max_deviation };
}

/**
 * Count of non-finite numeric cells encountered during the current export.
 * Reset at the start of buildExportFiles() and surfaced in the manifest.
 */
let nonFiniteCells = 0;

/** CSV-escape a single value: wrap in quotes and double internal quotes when needed. */
export function escapeCsv(value: unknown): string {
  if (value == null) return '';
  // A non-finite number is not a measurement. Rendering it as the literal "NaN" or "Infinity" is
  // worse than useless: R's read_csv silently coerces "NaN" to NA and "Infinity" to Inf, so the
  // anomaly disappears into the analysis instead of being noticed. Emit the same empty marker used
  // for every other missing value; buildExportFiles counts these and reports the total in the
  // manifest, so the fact that something went non-finite upstream is still visible.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    nonFiniteCells++;
    return '';
  }
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

/**
 * Round a number for PRESENTATION in a CSV, leaving storage at full precision.
 *
 * Raw IEEE-754 subtraction leaks artefacts into analyst-facing files — a fatigue delta of
 * `-0.19999999999999996` instead of `-0.2`, a mean of `150.33333333333334`. Those are not more
 * precise, just noisier, and they invite spurious significant figures in a thesis table. Applied
 * at the export boundary only, so the stored records and the JSON bundle keep full precision.
 */
export function round(value: unknown, dp = 4): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  const scaled = value * 10 ** dp;
  // Scaling a very large magnitude overflows to Infinity, and rounding must never turn a finite
  // number into a non-finite one - that would convert a real (if implausible) measurement into a
  // cell the boundary then blanks. Values too large to scale are already integral at this
  // precision, so returning them unchanged is exact.
  if (!Number.isFinite(scaled)) return value;
  return Math.round(scaled) / 10 ** dp;
}

/** Make a string safe for a filename on every platform (Windows forbids " < > : | ? * \ /). */
export function safeFilePart(s: string, max = 32): string {
  // Control characters are matched deliberately: a filename containing one is not merely ugly, it
  // is rejected outright by Windows and can truncate a ZIP entry name. Stripping them is the point.
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1f,]/g, '_').replace(/_{2,}/g, '_').replace(/^[._]+|[._]+$/g, '');
  return (cleaned || 'unknown').slice(0, max);
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


/**
 * Data dictionary for the export bundle.
 *
 * `role` values: iv = independent variable, dv = dependent variable, primary = the confirmatory
 * outcome, covariate, qc = quality control, id = identifier, provenance.
 */
export const CODEBOOK: Record<string, string>[] = [
  // ---- 00_condition_reference.csv
  { file: '00_condition_reference.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Synopsis Table 3.4.' },
  { file: '00_condition_reference.csv', column: 'color_name', type: 'factor(5)', unit: '-', role: 'iv', description: 'Text-colour factor: achromatic | blue | red | yellow | green. Same 5 levels in both polarities, which is what makes polarity x colour estimable.' },
  { file: '00_condition_reference.csv', column: 'ink_name', type: 'string', unit: '-', role: 'id', description: 'Human-readable ink colour (black/white/blue/...). Display only; never an analysis factor.' },
  { file: '00_condition_reference.csv', column: 'polarity', type: 'factor(2)', unit: '-', role: 'iv', description: 'positive = dark text on light background; negative = light text on dark.' },
  { file: '00_condition_reference.csv', column: 'wcag_contrast_ratio', type: 'number', unit: 'ratio 1-21', role: 'iv', description: 'WCAG 2.x contrast from linearised sRGB relative luminance. Enter as log10 in models.' },
  { file: '00_condition_reference.csv', column: 'michelson_contrast', type: 'number', unit: '0-1', role: 'covariate', description: 'Michelson contrast. SATURATES at 1.000 for every negative-polarity condition (pure black background => Lmin = 0), so it cannot discriminate there. Reported for completeness only.' },
  { file: '00_condition_reference.csv', column: 'below_wcag_aa', type: 'boolean', unit: '-', role: 'covariate', description: 'True when contrast < 4.5:1. Balanced 2 per polarity by design (P4,P5 / N2,N3).' },
  { file: '00_condition_reference.csv', column: 'ran_in_this_session', type: 'boolean', unit: '-', role: 'qc', description: 'Whether this condition was actually presented in this session. False for the other half of a split sitting.' },

  // ---- 01_session_info.csv
  { file: '01_session_info.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'Researcher-assigned participant code. Shared across a participant\'s sittings.' },
  { file: '01_session_info.csv', column: 'enrolment_number', type: 'integer', unit: '-', role: 'id', description: 'Sequential 1-based enrolment index. Drives the Williams condition row AND the illumination order; must stay dense for balance.' },
  { file: '01_session_info.csv', column: 'session_index', type: 'integer', unit: '-', role: 'iv', description: 'Sitting number for this participant, 1-based.' },
  { file: '01_session_info.csv', column: 'condition_offset', type: 'integer', unit: 'conditions', role: 'qc', description: 'Conditions already completed before this sitting, within the illumination block.' },
  { file: '01_session_info.csv', column: 'ambient_illumination_level', type: 'factor(2)', unit: '-', role: 'iv', description: 'Session-level (whole-plot) factor: dim (~10 lux) or moderate (~150 lux). ASSIGNED by counterbalancing, not chosen.' },
  { file: '01_session_info.csv', column: 'illumination_block', type: 'integer', unit: '-', role: 'iv', description: '0 = this participant\'s first illumination level, 1 = their second.' },
  { file: '01_session_info.csv', column: 'illumination_order_first', type: 'factor(2)', unit: '-', role: 'covariate', description: 'Which level the participant received first. The counterbalancing assignment, for reporting order effects.' },
  { file: '01_session_info.csv', column: 'lux_start', type: 'number', unit: 'lux', role: 'qc', description: 'Meter reading at the participant\'s eye at session start. Mandatory.' },
  { file: '01_session_info.csv', column: 'lux_middle', type: 'number', unit: 'lux', role: 'qc', description: 'Meter reading at the mid-session break. EMPTY if the researcher did not take it.' },
  { file: '01_session_info.csv', column: 'lux_end', type: 'number', unit: 'lux', role: 'qc', description: 'Meter reading at session completion. EMPTY if not taken.' },
  { file: '01_session_info.csv', column: 'lux_n_readings', type: 'integer', unit: 'count', role: 'qc', description: 'How many of the three checkpoints were actually recorded (0-3).' },
  { file: '01_session_info.csv', column: 'lux_checkpoints_logged', type: 'string', unit: '-', role: 'qc', description: 'Which checkpoints exist, + separated, e.g. "start+end".' },
  { file: '01_session_info.csv', column: 'lux_complete', type: 'boolean', unit: '-', role: 'qc', description: 'TRUE only when all three checkpoints were recorded. Check this before treating illuminance as verified across the sitting.' },
  { file: '01_session_info.csv', column: 'lux_mean', type: 'number', unit: 'lux', role: 'covariate', description: 'Mean of the readings that exist. With one reading this is just that reading — read alongside lux_n_readings.' },
  { file: '01_session_info.csv', column: 'lux_max_deviation', type: 'number', unit: 'lux', role: 'qc', description: 'Largest absolute deviation of any reading from the assigned level\'s target.' },
  { file: '01_session_info.csv', column: 'lux_logged_all_in_range', type: 'boolean', unit: '-', role: 'qc', description: 'Whether every LOGGED reading fell inside the accepted range. Says nothing about readings never taken — pair with lux_complete.' },
  { file: '01_session_info.csv', column: 'lux_deviation_note', type: 'string', unit: '-', role: 'qc', description: 'Researcher-entered reason for running outside the accepted range. Non-empty = protocol deviation.' },
  { file: '01_session_info.csv', column: 'screen_white_luminance_cd_m2', type: 'number', unit: 'cd/m2', role: 'covariate', description: 'Photometrically measured display white point. Working target 120-150.' },
  { file: '01_session_info.csv', column: 'session_duration_min', type: 'number', unit: 'minutes', role: 'qc', description: 'Wall-clock session length. Feasibility gate: median <= 120.' },
  { file: '01_session_info.csv', column: 'condition_def_hash', type: 'string', unit: '-', role: 'provenance', description: 'Hash of the locked condition table. Ties a dataset to the exact stimulus set that produced it.' },
  { file: '01_session_info.csv', column: 'schema_version', type: 'integer', unit: '-', role: 'provenance', description: 'IndexedDB schema version at export time.' },

  { file: '01_session_info.csv', column: 'consent_camera_metrics', type: 'boolean', unit: '-', role: 'qc', description: 'Participant permitted camera-derived numeric measures. FALSE means no ocular data was collected for them; every other measure still ran.' },
  { file: '01_session_info.csv', column: 'consent_setup_photos', type: 'boolean', unit: '-', role: 'qc', description: 'Participant permitted two retained setup photographs. Separate, optional grant.' },
  { file: '01_session_info.csv', column: 'consent_annotation_video', type: 'boolean', unit: '-', role: 'qc', description: 'Participant permitted retained reading video for the manual blink-annotation sub-study (validation subsample only).' },
  { file: '01_session_info.csv', column: 'media_items_retained', type: 'integer', unit: 'count', role: 'qc', description: 'How many photo/video files this session actually retained. 0 unless a media grant was given.' },

  // ---- 16_integrity_report.csv
  { file: '16_integrity_report.csv', column: 'severity', type: 'factor(3)', unit: '-', role: 'qc', description: 'error = a join in this dataset cannot be trusted; warning = something expected is missing; info = all checks passed.' },
  { file: '16_integrity_report.csv', column: 'check', type: 'string', unit: '-', role: 'qc', description: 'Which integrity assumption was tested, e.g. condition_id_unique, no_orphan_records, complete_coverage.' },
  { file: '16_integrity_report.csv', column: 'detail', type: 'string', unit: '-', role: 'qc', description: 'What was found and what it means for the analysis. Read this before using the dataset.' },
  { file: '16_integrity_report.csv', column: 'refs', type: 'string', unit: '-', role: 'qc', description: 'Identifiers involved, pipe-separated, so a finding can be traced to specific records.' },

  // ---- 15_media_inventory.csv
  { file: '15_media_inventory.csv', column: 'media_id', type: 'string', unit: '-', role: 'id', description: 'Identifier of one retained photo or video file.' },
  { file: '15_media_inventory.csv', column: 'kind', type: 'factor(2)', unit: '-', role: 'id', description: 'photo (a setup-proof still) or video (a reading segment for manual annotation).' },
  { file: '15_media_inventory.csv', column: 'checkpoint', type: 'factor(3)', unit: '-', role: 'id', description: 'session_start / session_end (setup-proof stills) or reading_segment (annotation video).' },
  { file: '15_media_inventory.csv', column: 'checksum_fnv1a', type: 'string', unit: '-', role: 'provenance', description: 'FNV-1a over the file bytes. Confirms a given file is the one this session recorded and has not been altered or swapped.' },
  { file: '15_media_inventory.csv', column: 'consent_annotation_video', type: 'boolean', unit: '-', role: 'qc', description: 'The consent state in force when this item was captured, snapshotted onto the record so a file can never be separated from its permission.' },

  // ---- 02_conditions.csv
  { file: '02_conditions.csv', column: 'session_position', type: 'integer', unit: '-', role: 'covariate', description: 'Serial position within the sitting, 0-based. Enter in models: absorbs the vigilance decrement and fatigue accumulation.' },
  { file: '02_conditions.csv', column: 'passage_id', type: 'integer', unit: '-', role: 'covariate', description: 'Reading passage shown. Rotated independently of condition, so passage difficulty is orthogonal to display condition.' },
  { file: '02_conditions.csv', column: 'adaptation_ms_before', type: 'integer', unit: 'ms', role: 'qc', description: 'Grey-field adaptation before this condition. Doubled on a polarity switch; 0 for the first condition.' },
  { file: '02_conditions.csv', column: 'reading_time_ms', type: 'integer', unit: 'ms', role: 'dv', description: 'Self-paced reading duration. This is also the ocular-metrics exposure window.' },
  { file: '02_conditions.csv', column: 'reading_speed_wpm', type: 'integer', unit: 'words/min', role: 'dv', description: 'Derived: passage word count / reading_time_ms. Word counts are computed from the passage text, not declared.' },

  // ---- 03_fatigue_scores.csv
  { file: '03_fatigue_scores.csv', column: 'stage', type: 'factor', unit: '-', role: 'id', description: 'baseline (once per session) or post_condition (once per condition).' },
  { file: '03_fatigue_scores.csv', column: 'fatigue_mean', type: 'number', unit: '0-10', role: 'dv', description: 'Mean of the five visual-fatigue VAS items. Ordinal — model with a cumulative-link model, not OLS.' },
  { file: '03_fatigue_scores.csv', column: 'all_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Every slider was moved. False means at least one item kept its default and the record is suspect.' },
  { file: '03_fatigue_scores.csv', column: 'response_time_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Time from screen mount to submit. Implausibly fast = careless responding.' },

  // ---- 07_eye_metrics.csv
  { file: '07_eye_metrics.csv', column: 'incomplete_blink_ratio', type: 'number', unit: '0-1', role: 'primary', description: 'THE PRIMARY OUTCOME. Incomplete blinks / all detected blinks, during reading. A bounded proportion: model on the logit scale or with a beta/binomial mixed model.' },
  { file: '07_eye_metrics.csv', column: 'blink_rate', type: 'number', unit: 'blinks/min', role: 'dv', description: 'All detected blinks per minute. Secondary: rate alone is a poor fatigue index, since it falls during reading on any medium and can hold steady while completeness degrades.' },
  { file: '07_eye_metrics.csv', column: 'effective_fps', type: 'number', unit: 'frames/s', role: 'qc', description: 'Achieved processing rate. Below ~25 the duration-based metrics are sub-Nyquist; proportion measures remain valid.' },
  { file: '07_eye_metrics.csv', column: 'fps_adequate_for_tiers', type: 'boolean', unit: '-', role: 'qc', description: 'effective_fps >= 25. Gate duration-based blink metrics on this.' },
  { file: '07_eye_metrics.csv', column: 'perclos_p80', type: 'number', unit: '0-1', role: 'covariate', description: 'Proportion of time eyes >80% closed. A SLEEPINESS covariate, never a visual-fatigue outcome — it is insensitive in moderate drowsiness.' },
  { file: '07_eye_metrics.csv', column: 'face_presence_ratio', type: 'number', unit: '0-1', role: 'qc', description: 'Fraction of frames with a detected face. Pilot gate: >= 0.90 in at least 90% of condition-runs.' },
  { file: '07_eye_metrics.csv', column: 'ear_baseline', type: 'number', unit: 'ratio', role: 'qc', description: 'Per-participant open-eye eye-aspect-ratio from calibration. All blink thresholds are relative to this.' },
  { file: '07_eye_metrics.csv', column: 'head_pitch_calibrated', type: 'boolean', unit: '-', role: 'qc', description: 'True when head_pitch_mean is relative to the participant\'s own frontal posture rather than a population default.' },

  // ---- 09_rt_summary.csv
  { file: '09_rt_summary.csv', column: 'mean_rt_hits_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean RT for correct go responses, excluding anticipations (<150 ms).' },
  { file: '09_rt_summary.csv', column: 'rt_cv', type: 'number', unit: 'ratio', role: 'dv', description: 'RT coefficient of variation. One of the two most fatigue-sensitive indices.' },
  { file: '09_rt_summary.csv', column: 'lapse_rate', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of valid hits slower than 600 ms. The other fatigue-sensitive index.' },
  { file: '09_rt_summary.csv', column: 'd_prime', type: 'number', unit: 'z units', role: 'dv', description: 'Signal-detection sensitivity. Unstable at low trial counts — model hierarchically; check d_prime_unstable.' },
  { file: '09_rt_summary.csv', column: 'd_prime_unstable', type: 'boolean', unit: '-', role: 'qc', description: 'Set when hit or false-alarm rate hit a bound and required a correction.' },

  // ---- 10_wide_summary.csv
  { file: '10_wide_summary.csv', column: 'fatigue_delta', type: 'number', unit: '0-10', role: 'dv', description: 'post_condition fatigue_mean minus the session baseline. Rounded to 4 dp for presentation.' },
  { file: '12_quality_flags.csv', column: 'blink_count_total', type: 'integer', unit: 'count', role: 'qc', description: 'Blinks captured during the condition. The incomplete-blink ratio is a binomial proportion, so its precision depends entirely on this.' },
  { file: '12_quality_flags.csv', column: 'insufficient_blinks', type: 'boolean', unit: '-', role: 'qc', description: 'TRUE when fewer than 20 blinks were captured, at which point the incomplete-blink ratio for that condition is too imprecise to interpret (SE >= 0.082 at p=0.16). Flagged, not dropped — down-weight or exclude in a sensitivity analysis.' },
  { file: '10_wide_summary.csv', column: 'engagement_flag', type: 'factor(3)', unit: '-', role: 'qc', description: 'good | warn | bad. Sensitivity analyses should be run with and without "bad".' },
  { file: '10_wide_summary.csv', column: 'quality_score', type: 'number', unit: '0-1', role: 'qc', description: 'Composite data-quality score for the condition-run.' },

  // ---- 13_cvsq.csv
  { file: '13_cvsq.csv', column: 'total_score', type: 'integer', unit: '0-32', role: 'dv', description: 'CVS-Q total. The KEY SECONDARY outcome is the session_end minus baseline change. Cut-off 6 for symptomatic.' },
  { file: '13_cvsq.csv', column: 'freq_1..16', type: 'integer', unit: '0-2', role: 'dv', description: 'Per-item frequency: 0 never, 1 occasionally, 2 often/always.' },
  { file: '13_cvsq.csv', column: 'intensity_1..16', type: 'integer', unit: '0-2', role: 'dv', description: 'Per-item intensity: 1 moderate, 2 intense; 0 when frequency is 0.' },

  // ---- 14_nasa_tlx.csv
  { file: '14_nasa_tlx.csv', column: 'raw_tlx', type: 'number', unit: '0-100', role: 'dv', description: 'Unweighted mean of the six LOAD-aligned subscales (Performance reversed). Session-level: supports inference about the illumination contrast only.' },
  { file: '14_nasa_tlx.csv', column: 'performance', type: 'number', unit: '0-100', role: 'dv', description: 'RAW response. Anchored Perfect(0) to Failure(100), so LOW means good performance.' },
  { file: '14_nasa_tlx.csv', column: 'performance_load', type: 'number', unit: '0-100', role: 'dv', description: 'Performance after reversal (100 - performance). This is the value that enters raw_tlx.' },
];

export function buildExportFiles(bundle: SessionBundle): ExportFile[] {
  nonFiniteCells = 0;
  const { session, participant } = bundle;
  const pid = session.participant_id;
  const date = new Date(session.session_start_time).toISOString().slice(0, 10);
  const summaries = buildConditionSummaries(bundle);
  const files: ExportFile[] = [];
  const csv = (filename: string, headers: string[], rows: Record<string, unknown>[]) =>
    files.push({ filename, content: toCsv(headers, rows), mime: 'text/csv' });

  // 00 — DATA DICTIONARY.
  // Every column of every exported file, with its unit and meaning. This is what makes the export
  // manually verifiable: without it a reader has to infer from column names whether a duration is
  // in ms or s, whether a ratio is 0-1 or a percentage, and which columns are outcomes versus
  // quality flags. Kept adjacent to the code that writes the columns so the two cannot drift.
  csv('00_CODEBOOK.csv',
    ['file', 'column', 'type', 'unit', 'role', 'description'],
    CODEBOOK);

  // 00 — condition REFERENCE table.
  // Built from the canonical CONDITIONS table, NOT from this session's rows. Deriving it from the
  // session made it vary per participant (presentation order) and silently truncated it to 5 rows
  // for a split sitting — a reference table that changes per file is not a reference.
  csv('00_condition_reference.csv',
    ['condition_label', 'color_name', 'ink_name', 'polarity', 'background_color', 'text_color', 'wcag_contrast_ratio', 'wcag_level', 'michelson_contrast', 'below_wcag_aa', 'ran_in_this_session'],
    CONDITIONS.map((c) => ({
      condition_label: c.label, color_name: c.colorName, ink_name: c.inkName, polarity: c.polarity,
      background_color: c.background, text_color: c.text,
      wcag_contrast_ratio: c.wcag_contrast_ratio, wcag_level: c.wcag_level,
      michelson_contrast: c.michelson_contrast, below_wcag_aa: c.below_wcag_aa,
      ran_in_this_session: bundle.conditions.some((x) => x.condition_label === c.label),
    })));

  // 01 — session info
  csv('01_session_info.csv',
    ['participant_id', 'experiment_date', 'enrolment_number', 'session_index', 'conditions_per_session', 'condition_offset', 'ambient_lux', 'ambient_illumination_level', 'illumination_block', 'illumination_order_first', 'lux_start', 'lux_middle', 'lux_end', 'lux_n_readings', 'lux_checkpoints_logged', 'lux_complete', 'lux_mean', 'lux_max_deviation', 'lux_logged_all_in_range', 'lux_deviation_note', 'screen_white_luminance_cd_m2', 'brightness_percent', 'session_duration_min', 'app_version', 'git_hash', 'condition_def_hash', 'schema_version', 'device_type', 'screen_resolution', 'consent_given', 'consent_camera_metrics', 'consent_setup_photos', 'consent_annotation_video', 'media_items_retained', 'preflight_complete', 'gaze_calibration_valid', 'calibration_ear_baseline', 'calibration_pitch_baseline_frac', 'calibration_targets_detected'],
    [{
      participant_id: pid, experiment_date: date, enrolment_number: session.enrolment_number,
      session_index: session.session_index, conditions_per_session: session.conditions_per_session, condition_offset: session.condition_offset,
      ambient_lux: session.ambient_lux, ambient_illumination_level: session.ambient_illumination_level,
      illumination_block: session.illumination_block, illumination_order_first: session.illumination_order_first,
      lux_start: luxAt(session, 'start'), lux_middle: luxAt(session, 'middle'), lux_end: luxAt(session, 'end'),
      // Completeness is reported SEPARATELY from range compliance. Previously a session with only
      // the mandatory start reading exported lux_all_in_range=true, which an analyst would read as
      // "illuminance was verified throughout" when it was verified once and never re-checked.
      lux_n_readings: (session.lux_readings ?? []).length,
      lux_checkpoints_logged: (session.lux_readings ?? []).map((r) => r.checkpoint).join('+'),
      lux_complete: LUX_CHECKPOINTS.every((cp) => (session.lux_readings ?? []).some((r) => r.checkpoint === cp)),
      lux_mean: round(luxSummary(session).mean, 2), lux_max_deviation: round(luxSummary(session).max_deviation, 2),
      lux_logged_all_in_range: session.lux_all_in_range, lux_deviation_note: session.lux_deviation_note,
      screen_white_luminance_cd_m2: session.screen_white_luminance_cd_m2,
      brightness_percent: session.brightness_percent,
      session_duration_min: session.session_end_time ? ((session.session_end_time - session.session_start_time) / 60000).toFixed(2) : '',
      app_version: session.provenance.app_version, git_hash: session.provenance.git_hash,
      condition_def_hash: session.provenance.condition_def_hash, schema_version: session.provenance.schema_version,
      device_type: session.device_type, screen_resolution: session.screen_resolution,
      consent_given: session.consent_given,
      consent_camera_metrics: session.media_consent?.camera_metrics ?? '',
      consent_setup_photos: session.media_consent?.setup_photos ?? '',
      consent_annotation_video: session.media_consent?.annotation_video ?? '',
      media_items_retained: (bundle.media ?? []).length,
      preflight_complete: session.preflight_complete,
      gaze_calibration_valid: bundle.calibration[0]?.is_real_calibration ?? '',
      calibration_ear_baseline: bundle.calibration[0]?.ear_baseline ?? '',
      calibration_pitch_baseline_frac: bundle.calibration[0]?.pitch_baseline_frac ?? '',
      calibration_targets_detected: bundle.calibration[0] ? `${bundle.calibration[0].targets_detected}/${bundle.calibration[0].targets_total}` : '',
    }]);

  // 02 — conditions (+ reading speed in words/min, derived from passage length & reading time)
  csv('02_conditions.csv',
    ['participant_id', 'condition_id', 'session_position', 'condition_label', 'polarity', 'background_color', 'text_color', 'color_name', 'ink_name', 'passage_id', 'wcag_contrast_ratio', 'wcag_level', 'michelson_contrast', 'below_wcag_aa', 'adaptation_ms_before', 'reading_time_ms', 'reading_speed_wpm', 'condition_duration_sec'],
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
      fatigue_mean: round(s.fatigue_mean), fatigue_delta: round(s.fatigue_delta), comprehension_correct: s.comprehension_correct,
      search_accuracy: s.search_accuracy, search_efficiency: s.search_efficiency, comfort_score: s.comfort_score,
      clarity_score: s.clarity_score, blink_rate: s.blink_rate, blink_rate_full: s.blink_rate_full,
      effective_fps: s.effective_fps, face_presence_ratio: s.face_presence_ratio, qc_overall: s.qc.overall,
      engagement_flag: s.engagement, quality_score: s.quality_score,
    })));

  csv('11_participant.csv',
    ['participant_id', 'enrolment_number', 'age', 'gender', 'daily_screen_hours', 'device_familiarity', 'lighting_habit', 'correction_type', 'cvd_status', 'ishihara_correct', 'ishihara_total', 'caffeine_today', 'hours_since_sleep', 'eligible', 'exclusion_reason', 'baseline_fatigue'],
    participant ? [{ ...participant }] : []);

  // 12 — engagement / careless-responding quality flags (boredom & disengagement detection)
  csv('12_quality_flags.csv',
    ['participant_id', 'session_index', 'condition_label', 'session_position', 'engagement_flag', 'quality_score', 'blink_count_total', 'insufficient_blinks', 'reading_time_ms', 'fatigue_response_ms', 'perception_response_ms', 'reading_skim', 'rt_disengaged', 'careless_rushed_fatigue', 'careless_rushed_perception', 'careless_straight_lined', 'comprehension_wrong', 'low_face_presence', 'reasons'],
    summaries.map((s) => ({
      participant_id: pid, session_index: session.session_index, condition_label: s.condition_label,
      session_position: s.session_position, engagement_flag: s.engagement, quality_score: s.quality_score,
      blink_count_total: s.blink_count_total, insufficient_blinks: s.insufficient_blinks,
      reading_time_ms: s.reading_time_ms, fatigue_response_ms: s.fatigue_response_ms, perception_response_ms: s.perception_response_ms,
      reading_skim: s.reading_skim, rt_disengaged: s.rt_disengaged, careless_rushed_fatigue: s.careless_rushed_fatigue,
      careless_rushed_perception: s.careless_rushed_perception, careless_straight_lined: s.careless_straight_lined,
      comprehension_wrong: s.comprehension_wrong, low_face_presence: s.low_face_presence, reasons: s.engagement_reasons.join('; '),
    })));

  // 11 — participant demographics + vision covariates (previously available only in the JSON bundle,
  // so the documented CSV analysis pipeline could not control for age/screen-habits/vision status).
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

  // NASA-TLX: session-level, one row per session. `performance` is the raw response (low = good,
  // per the original anchors); `performance_load` is it reversed, which is what enters raw_tlx.
  csv('14_nasa_tlx.csv',
    ['participant_id', 'session_index', 'ambient_illumination_level', 'raw_tlx',
     'mental_demand', 'physical_demand', 'temporal_demand', 'performance', 'performance_load',
     'effort', 'frustration', 'all_touched', 'response_time_ms'],
    (bundle.tlx ?? []).map((t) => ({
      participant_id: pid, session_index: session.session_index,
      ambient_illumination_level: session.ambient_illumination_level,
      raw_tlx: round(t.raw_tlx, 2),
      mental_demand: t.mental_demand, physical_demand: t.physical_demand,
      temporal_demand: t.temporal_demand, performance: t.performance,
      performance_load: t.performance_load, effort: t.effort, frustration: t.frustration,
      all_touched: t.all_touched, response_time_ms: t.response_time_ms,
    })));

  // 15 — consented media inventory. Metadata and checksums only: the blobs are downloaded as
  // separate files, and embedding them here would make the CSV bundle unusable. The checksum lets
  // a reader confirm a given file is the one this session recorded.
  csv('15_media_inventory.csv',
    ['participant_id', 'session_index', 'media_id', 'kind', 'checkpoint', 'condition_label',
     'captured_at', 'mime', 'bytes', 'width', 'height', 'duration_ms', 'checksum_fnv1a',
     'consent_setup_photos', 'consent_annotation_video'],
    (bundle.media ?? []).map((m) => ({
      participant_id: pid, session_index: session.session_index,
      media_id: m.media_id, kind: m.kind, checkpoint: m.checkpoint,
      condition_label: m.condition_label ?? '', captured_at: new Date(m.captured_at).toISOString(),
      mime: m.mime, bytes: m.bytes, width: m.width ?? '', height: m.height ?? '',
      duration_ms: m.duration_ms ?? '', checksum_fnv1a: m.checksum_fnv1a,
      consent_setup_photos: m.consent_snapshot.setup_photos,
      consent_annotation_video: m.consent_snapshot.annotation_video,
    })));

  // 16 - referential-integrity report.
  // The join onto conditions is only sound if condition_id is unique and every child row points at
  // a real condition. Neither was previously verified, and a duplicate id makes two different
  // display conditions report the SAME measurements with nothing in the output looking wrong.
  // Faults are reported, never silently repaired: quietly de-duplicating would hide the bug that
  // produced the duplicate.
  const integrity = auditBundle(bundle);
  csv('16_integrity_report.csv',
    ['participant_id', 'session_index', 'severity', 'check', 'detail', 'refs'],
    integrity.findings.length
      ? integrity.findings.map((x) => ({
          participant_id: pid, session_index: session.session_index,
          severity: x.severity, check: x.check, detail: x.detail, refs: x.refs.join(' | '),
        }))
      : [{
          participant_id: pid, session_index: session.session_index,
          severity: 'info', check: 'all_checks_passed',
          detail: 'condition_id and session_position unique; no orphan or duplicate child rows; coverage complete.',
          refs: '',
        }]);

  // JSON bundle
  const jsonBundle = {
    exported_at: new Date().toISOString(),
    provenance: session.provenance,
    session, participant,
    conditions: bundle.conditions, fatigue: bundle.fatigue, cvsq: bundle.cvsq, nasa_tlx: bundle.tlx,
    comprehension: bundle.comprehension, visual_search: bundle.visualSearch,
    display_perception: bundle.perception, eye_metrics: bundle.eyeMetrics,
    calibration: bundle.calibration,
    rt_summaries: bundle.rtSummaries, reaction_trials_count: bundle.reactionTrials.length,
  };
  files.push({ filename: `session_${safeFilePart(pid)}_${session.session_id.slice(0, 8)}.json`, content: JSON.stringify(jsonBundle, null, 2), mime: 'application/json' });

  // Manifest with checksums
  const manifest = {
    exported_at: new Date().toISOString(),
    provenance: session.provenance,
    participant_id: pid,
    /**
     * How many numeric cells were non-finite and therefore written as empty. After the upstream
     * guards this should always be 0; any other value means something produced a NaN or Infinity
     * and the affected columns must be investigated before the data is analysed.
     */
    non_finite_cells: nonFiniteCells,
    /**
     * Referential integrity of the joins this export performed. joins_sound=false means at least
     * one condition's measurements cannot be trusted to belong to it - see 16_integrity_report.csv
     * before analysing the data.
     */
    integrity: {
      joins_sound: integrity.joins_sound,
      errors: integrity.errors,
      warnings: integrity.warnings,
    },
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
