/**
 * Export builder. Produces the CSV bundle + JSON + master codebook + a provenance manifest with
 * per-file checksums. Pure (`buildExportFiles`) so it is fully unit-testable; `downloadExport`
 * is the thin browser wrapper that streams the files to the device.
 */
import { normaliseBundle, type SessionBundle } from './gather';
import type { SessionRecord } from './types';
import type { MediaRecord } from './media';
import { summariseLux, LUX_CHECKPOINTS } from '@/experiment/illumination';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { PASSAGES } from '@/experiment/passages';
import { CONDITIONS } from '@/experiment/conditions';
import { auditBundle } from './integrity';
import { serialiseSessionBackup } from './backup';

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

/** Extension for a stored capture, from its recorded MIME type. */
function mediaExtension(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  const known: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'video/webm': 'webm', 'video/mp4': 'mp4',
  };
  return known[m] ?? (m.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin');
}

/**
 * The name a consented photo or video is written under.
 *
 * Deliberately derived, not chosen at download time, so `15_media_inventory.csv` can name the file
 * it describes. Without that the inventory row and the file on disk are joined only by whatever
 * order the browser happened to write them in, and a coder working on the annotation sub-study has
 * no way to tell which video belongs to which condition — which is the whole point of the row.
 * Restricted to characters that survive every filesystem the data will pass through.
 */
export function mediaFilename(session: SessionRecord, m: MediaRecord): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
  const where = m.condition_label ? safe(m.condition_label) : 'session';
  return `media_${safe(session.participant_id)}_S${session.session_index}_${safe(m.checkpoint)}_${where}_${safe(m.media_id)}.${mediaExtension(m.mime)}`;
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
  { file: '15_media_inventory.csv', column: 'blob_present', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the media file itself is still on this device. False after a session is restored from a backup, which carries the inventory row but not the binary. A false here means the checksum and byte count describe a file you no longer hold.' },
  { file: '15_media_inventory.csv', column: 'consent_annotation_video', type: 'boolean', unit: '-', role: 'qc', description: 'The consent state in force when this item was captured, snapshotted onto the record so a file can never be separated from its permission.' },

  // ---- 02_conditions.csv
  { file: '02_conditions.csv', column: 'session_position', type: 'integer', unit: '0-9', role: 'covariate', description: 'Serial position within the illumination BLOCK, 0-based — on a split sitting the second sitting continues the numbering rather than restarting, so this is not the position within the sitting. Enter in models: absorbs the vigilance decrement and fatigue accumulation.' },
  { file: '02_conditions.csv', column: 'passage_id', type: 'integer', unit: '-', role: 'covariate', description: 'Reading passage shown. Rotated independently of condition, so passage difficulty is orthogonal to display condition.' },
  { file: '02_conditions.csv', column: 'adaptation_ms_before', type: 'integer', unit: 'ms', role: 'qc', description: 'Grey-field adaptation before this condition. Doubled on a polarity switch; 0 for the first condition.' },
  { file: '02_conditions.csv', column: 'passage_repeat_number', type: 'integer', unit: 'count', role: 'covariate', description: "How many times this participant has read this passage, counting this run: 1 in the first sitting, 2 in the second. Ten passages cover twenty condition-runs, so every passage is re-read. Illumination is confounded with session order within a participant, so the practice effect loads onto the illumination main effect unless this is modelled." },
  { file: '02_conditions.csv', column: 'reading_time_ms', type: 'integer', unit: 'ms', role: 'dv', description: 'Self-paced reading duration. This is also the ocular-metrics exposure window.' },
  { file: '02_conditions.csv', column: 'reading_speed_wpm', type: 'integer', unit: 'words/min', role: 'dv', description: 'Derived: passage word count / reading_time_ms. Word counts are computed from the passage text, not declared.' },

  // ---- 03_fatigue_scores.csv
  { file: '03_fatigue_scores.csv', column: 'stage', type: 'factor', unit: '-', role: 'id', description: 'baseline (once per session) or post_condition (once per condition).' },
  { file: '03_fatigue_scores.csv', column: 'fatigue_mean', type: 'number', unit: '0-10', role: 'dv', description: 'Mean of the five visual-fatigue VAS items. Ordinal — model with a cumulative-link model, not OLS.' },
  { file: '03_fatigue_scores.csv', column: 'all_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Every slider was moved. False means at least one item kept its default and the record is suspect.' },
  { file: '03_fatigue_scores.csv', column: 'response_time_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Time from screen mount to submit. Implausibly fast = careless responding.' },

  // ---- 07_eye_metrics.csv
  { file: '07_eye_metrics.csv', column: 'incomplete_blink_ratio', type: 'number', unit: '0-1', role: 'primary', description: 'THE PRIMARY OUTCOME. Incomplete blinks / all detected blinks, during reading. A bounded proportion: model on the logit scale or with a beta/binomial mixed model.' },
  { file: '07_eye_metrics.csv', column: 'fps_adequate_for_ratio', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the achieved frame rate (>=30 fps) supports the primary outcome. Below it, the sampled minimum EAR is biased upward and incomplete_blink_ratio is inflated — a directional bias, not symmetric noise. Conditions are flagged, never dropped, because frame rate covaries with ambient illumination, which is an independent variable.' },
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

  // ---------------------------------------------------------------------------------------
  // Completion pass. Every exported column is documented; scripts/buildCodebook.ts enforces
  // the correspondence in both directions so a new column cannot ship undescribed.
  // ---------------------------------------------------------------------------------------
  { file: '01_session_info.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '02_conditions.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '03_fatigue_scores.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '04_comprehension.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '05_visual_search.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '06_display_perception.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '07_eye_metrics.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '08_reaction_trials.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '09_rt_summary.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '10_wide_summary.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '11_participant.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '12_quality_flags.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '13_cvsq.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '14_nasa_tlx.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '15_media_inventory.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '16_integrity_report.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately.' },
  { file: '02_conditions.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '03_fatigue_scores.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '04_comprehension.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '05_visual_search.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '06_display_perception.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '07_eye_metrics.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '08_reaction_trials.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '09_rt_summary.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '01_session_info.csv', column: 'session_index', type: 'integer', unit: '1-2', role: 'id', description: 'Which sitting this row came from. Session 1 and session 2 differ in ambient illumination level, so this is confounded with the illumination factor by design.' },
  { file: '10_wide_summary.csv', column: 'session_index', type: 'integer', unit: '1-2', role: 'id', description: 'Which sitting this row came from. Session 1 and session 2 differ in ambient illumination level, so this is confounded with the illumination factor by design.' },
  { file: '12_quality_flags.csv', column: 'session_index', type: 'integer', unit: '1-2', role: 'id', description: 'Which sitting this row came from. Session 1 and session 2 differ in ambient illumination level, so this is confounded with the illumination factor by design.' },
  { file: '14_nasa_tlx.csv', column: 'session_index', type: 'integer', unit: '1-2', role: 'id', description: 'Which sitting this row came from. Session 1 and session 2 differ in ambient illumination level, so this is confounded with the illumination factor by design.' },
  { file: '15_media_inventory.csv', column: 'session_index', type: 'integer', unit: '1-2', role: 'id', description: 'Which sitting this row came from. Session 1 and session 2 differ in ambient illumination level, so this is confounded with the illumination factor by design.' },
  { file: '16_integrity_report.csv', column: 'session_index', type: 'integer', unit: '1-2', role: 'id', description: 'Which sitting this row came from. Session 1 and session 2 differ in ambient illumination level, so this is confounded with the illumination factor by design.' },
  { file: '02_conditions.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '10_wide_summary.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '12_quality_flags.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '15_media_inventory.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '10_wide_summary.csv', column: 'session_position', type: 'integer', unit: '0-9', role: 'covariate', description: 'Serial position of the condition within the illumination BLOCK, 0-based. On a split sitting the second sitting continues the block numbering rather than restarting, so this is not the position within the sitting. Counterbalanced by a Williams square and entered as a covariate; a position effect is otherwise indistinguishable from a condition effect.' },
  { file: '12_quality_flags.csv', column: 'session_position', type: 'integer', unit: '0-9', role: 'covariate', description: 'Serial position of the condition within the illumination BLOCK, 0-based. On a split sitting the second sitting continues the block numbering rather than restarting, so this is not the position within the sitting. Counterbalanced by a Williams square and entered as a covariate; a position effect is otherwise indistinguishable from a condition effect.' },
  { file: '02_conditions.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: 'Which reading passage was shown. Rotated against condition so passage difficulty stays orthogonal to display condition.' },
  { file: '04_comprehension.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: 'Which reading passage was shown. Rotated against condition so passage difficulty stays orthogonal to display condition.' },
  { file: '05_visual_search.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: 'Which reading passage was shown. Rotated against condition so passage difficulty stays orthogonal to display condition.' },
  { file: '10_wide_summary.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: 'Which reading passage was shown. Rotated against condition so passage difficulty stays orthogonal to display condition.' },
  { file: '00_condition_reference.csv', column: 'background_color', type: 'string', unit: 'hex', role: 'iv', description: 'Background colour as an sRGB hex triplet, exactly as rendered.' },
  { file: '00_condition_reference.csv', column: 'text_color', type: 'string', unit: 'hex', role: 'iv', description: 'Text colour as an sRGB hex triplet, exactly as rendered.' },
  { file: '00_condition_reference.csv', column: 'wcag_level', type: 'string', unit: '-', role: 'covariate', description: 'Accessibility band implied by the contrast ratio: AAA, AA, AA Large, or Fail. Descriptive; model the continuous ratio, not this band.' },
  { file: '01_session_info.csv', column: 'experiment_date', type: 'string', unit: 'ISO 8601', role: 'meta', description: 'Date the sitting was run. Used to check the 48 to 72 hour spacing between a participant two sessions.' },
  { file: '01_session_info.csv', column: 'session_status', type: 'factor(2)', unit: '-', role: 'qc', description: 'in_progress or complete. An export may be taken at any time, including from a withdrawn or interrupted sitting, so this states whether the sitting actually finished.' },
  { file: '01_session_info.csv', column: 'conditions_completed', type: 'integer', unit: 'count', role: 'qc', description: 'Condition rows this export actually contains. Below conditions_per_session the series is truncated and the remaining conditions were never presented.' },
  { file: '01_session_info.csv', column: 'session_complete', type: 'boolean', unit: '-', role: 'qc', description: 'True only when the sitting was closed AND every planned condition ran. Filter on this before pooling sittings: a truncated series is unbalanced with respect to the Williams order.' },
  { file: '01_session_info.csv', column: 'conditions_per_session', type: 'integer', unit: '5 or 10', role: 'meta', description: 'Conditions presented in this sitting. 10 is the whole illumination block in one sitting; 5 means the block was split in two under the feasibility gate.' },
  { file: '01_session_info.csv', column: 'ambient_lux', type: 'number', unit: 'lux', role: 'iv', description: 'Measured room illuminance at the participant eye position for this sitting. The manipulated illumination factor; use the measured value, not the nominal level.' },
  { file: '01_session_info.csv', column: 'brightness_percent', type: 'number', unit: '0-100', role: 'covariate', description: 'Display brightness setting. Held fixed across conditions; recorded so any drift between sittings is detectable.' },
  { file: '01_session_info.csv', column: 'app_version', type: 'string', unit: '-', role: 'provenance', description: 'Instrument version that produced this row. Changes to timing or scoring are tied to this.' },
  { file: '01_session_info.csv', column: 'git_hash', type: 'string', unit: '-', role: 'provenance', description: 'Short commit hash of the build. Together with app_version this identifies the exact code that collected the data.' },
  { file: '01_session_info.csv', column: 'device_type', type: 'string', unit: '-', role: 'meta', description: 'Device the session ran on. Findings are device-specific, so this bounds generalisation.' },
  { file: '01_session_info.csv', column: 'screen_resolution', type: 'string', unit: 'px', role: 'meta', description: 'Viewport resolution in pixels. Affects line length and words per page.' },
  { file: '01_session_info.csv', column: 'consent_given', type: 'boolean', unit: '-', role: 'meta', description: 'Whether written informed consent was recorded before any measurement began.' },
  { file: '01_session_info.csv', column: 'preflight_complete', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the pre-session environment and device checks were completed. False indicates a session started outside protocol.' },
  { file: '01_session_info.csv', column: 'e2e_timing', type: 'boolean', unit: '-', role: 'qc', description: 'TRUE means this session ran under the end-to-end test harness, in which every protocol duration — reading floor, adaptation, search limit, reaction-time block — is collapsed to a token value. Such a row is a test artefact and must never be pooled with collected data.' },
  { file: '01_session_info.csv', column: 'stimulus_font_ok', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the vendored stimulus typeface (Roboto 400) was available when pre-flight ran. Empty where the browser gave no answer. False means the reading passage was rendered in a fallback face, which changes letter shape and stroke weight and so changes the display condition.' },
  { file: '01_session_info.csv', column: 'caffeine_today_session', type: 'boolean', unit: '-', role: 'covariate', description: "Caffeine in roughly the four hours before THIS sitting. Recorded per sitting because it varies between them; the participant record's copy is the first sitting's and must not be used as a per-session covariate." },
  { file: '01_session_info.csv', column: 'hours_since_sleep_session', type: 'float', unit: 'hours', role: 'covariate', description: 'Hours since waking, at THIS sitting. Per-sitting for the same reason as caffeine_today_session. Bears on blink rate and on the drowsiness covariates.' },
  { file: '01_session_info.csv', column: 'calibration_runs', type: 'integer', unit: 'count', role: 'qc', description: 'How many calibrations this sitting recorded. More than one means the session was interrupted and re-calibrated; the calibration_* columns describe the most recent, and per-condition ear_baseline in 07_eye_metrics.csv is what each condition actually used.' },
  { file: '01_session_info.csv', column: 'gaze_calibration_valid', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the nine-point gaze mapping met its acceptance criterion. When false, gaze columns are coarse-zone only and should not be treated as calibrated.' },
  { file: '01_session_info.csv', column: 'calibration_ear_baseline', type: 'number', unit: 'ratio', role: 'qc', description: 'Open-eye eye-aspect-ratio baseline for this participant. Every blink threshold is expressed as a fraction of this, so it is referenced to the individual rather than a population default.' },
  { file: '01_session_info.csv', column: 'calibration_pitch_baseline_frac', type: 'number', unit: 'ratio', role: 'qc', description: 'Frontal head-pose reference captured at calibration. Head-pose columns are relative to this when head_pitch_calibrated is true.' },
  { file: '01_session_info.csv', column: 'calibration_targets_detected', type: 'integer', unit: '0-9', role: 'qc', description: 'Calibration targets successfully detected out of nine. Low values indicate a poor camera setup for that sitting.' },
  { file: '02_conditions.csv', column: 'polarity', type: 'factor(2)', unit: '-', role: 'iv', description: 'positive = dark text on light background; negative = light text on dark.' },
  { file: '02_conditions.csv', column: 'background_color', type: 'string', unit: 'hex', role: 'iv', description: 'Background colour rendered for this condition-run.' },
  { file: '02_conditions.csv', column: 'text_color', type: 'string', unit: 'hex', role: 'iv', description: 'Text colour rendered for this condition-run.' },
  { file: '02_conditions.csv', column: 'color_name', type: 'factor(5)', unit: '-', role: 'iv', description: 'Text-colour factor: achromatic, blue, red, yellow or green. The same five levels appear in both polarities, which is what makes the polarity by colour interaction estimable.' },
  { file: '02_conditions.csv', column: 'ink_name', type: 'string', unit: '-', role: 'id', description: 'Human-readable ink colour. Display only; never an analysis factor.' },
  { file: '02_conditions.csv', column: 'wcag_contrast_ratio', type: 'number', unit: 'ratio 1-21', role: 'iv', description: 'Contrast from linearised sRGB relative luminance. Enter as log10 in models; the ordering across colours reverses between polarities by arithmetic, which is the basis of the contrast-mediation test.' },
  { file: '02_conditions.csv', column: 'wcag_level', type: 'string', unit: '-', role: 'covariate', description: 'Accessibility band implied by the ratio. Descriptive only.' },
  { file: '02_conditions.csv', column: 'michelson_contrast', type: 'number', unit: '0-1', role: 'covariate', description: 'Michelson contrast. Saturates at 1.000 for every negative-polarity condition because a pure black background sets minimum luminance to zero, so it cannot discriminate there.' },
  { file: '02_conditions.csv', column: 'below_wcag_aa', type: 'boolean', unit: '-', role: 'covariate', description: 'True when contrast is below 4.5:1. Balanced two per polarity by design, so polarity is not confounded with accessibility compliance.' },
  { file: '02_conditions.csv', column: 'condition_duration_sec', type: 'number', unit: 's', role: 'qc', description: 'Wall-clock duration of the condition-run. A large outlier indicates an interruption.' },
  { file: '03_fatigue_scores.csv', column: 'eye_strain', type: 'integer', unit: '0-10', role: 'dv', description: 'Eye strain rating on the five-item visual-fatigue scale, recorded per condition. Ordinal; model with a cumulative-link model rather than as continuous.' },
  { file: '03_fatigue_scores.csv', column: 'dryness', type: 'integer', unit: '0-10', role: 'dv', description: 'Dryness or grittiness rating on the five-item visual-fatigue scale, recorded per condition. Ordinal; model with a cumulative-link model rather than as continuous.' },
  { file: '03_fatigue_scores.csv', column: 'blur', type: 'integer', unit: '0-10', role: 'dv', description: 'Blurred vision rating on the five-item visual-fatigue scale, recorded per condition. Ordinal; model with a cumulative-link model rather than as continuous.' },
  { file: '03_fatigue_scores.csv', column: 'burning', type: 'integer', unit: '0-10', role: 'dv', description: 'Burning or stinging rating on the five-item visual-fatigue scale, recorded per condition. Ordinal; model with a cumulative-link model rather than as continuous.' },
  { file: '03_fatigue_scores.csv', column: 'headache', type: 'integer', unit: '0-10', role: 'dv', description: 'Headache rating on the five-item visual-fatigue scale, recorded per condition. Ordinal; model with a cumulative-link model rather than as continuous.' },
  { file: '04_comprehension.csv', column: 'question_index', type: 'integer', unit: '0-2', role: 'id', description: 'Position of the item within the passage. Three items per passage, so a condition contributes three rows; a join on condition_id must AGGREGATE rather than select one row.' },
  { file: '04_comprehension.csv', column: 'question_kind', type: 'factor(3)', unit: '-', role: 'iv', description: 'What the item probes: gist, inference or detail. Carried so accuracy can be modelled by item type instead of pooling three different demands.' },
  { file: '04_comprehension.csv', column: 'selected_index', type: 'integer', unit: '0-3', role: 'dv', description: 'Option the participant chose.' },
  { file: '04_comprehension.csv', column: 'correct_index', type: 'integer', unit: '0-3', role: 'meta', description: 'Option that is correct for this item.' },
  { file: '04_comprehension.csv', column: 'is_correct', type: 'boolean', unit: '-', role: 'dv', description: 'Whether the selection matched the key. Aggregate to a proportion over the three items per condition.' },
  { file: '04_comprehension.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Time from the item appearing to submission, timed per item rather than across the set.' },
  { file: '05_visual_search.csv', column: 'search_target', type: 'string', unit: '-', role: 'meta', description: 'Target word the participant was asked to tap in the passage.' },
  { file: '05_visual_search.csv', column: 'targets_in_set', type: 'integer', unit: 'count', role: 'meta', description: 'Authoritative number of target occurrences, computed from the passage text with the same tokenisation the task uses. This is the denominator of accuracy_rate.' },
  { file: '05_visual_search.csv', column: 'search_time_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Time spent on the search task, bounded by the fixed limit.' },
  { file: '05_visual_search.csv', column: 'time_to_first_target_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Latency to the first correct tap. Null when nothing was found.' },
  { file: '05_visual_search.csv', column: 'targets_found', type: 'integer', unit: 'count', role: 'dv', description: 'Number of correct target taps. The numerator of accuracy_rate.' },
  { file: '05_visual_search.csv', column: 'targets_missed', type: 'integer', unit: 'count', role: 'dv', description: 'Targets present but never tapped.' },
  { file: '05_visual_search.csv', column: 'false_detections', type: 'integer', unit: 'count', role: 'dv', description: 'Taps on words that were not the target. A rise here with stable accuracy indicates a criterion shift rather than a sensitivity change.' },
  { file: '05_visual_search.csv', column: 'accuracy_rate', type: 'number', unit: '0-1', role: 'dv', description: 'targets_found divided by targets_in_set. Comparable across passages only because target counts are held in a narrow band.' },
  { file: '05_visual_search.csv', column: 'search_efficiency', type: 'number', unit: 'hits/min', role: 'dv', description: 'Correct taps per minute. Combines speed and accuracy into one rate.' },
  { file: '05_visual_search.csv', column: 'mean_inter_target_interval_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean interval between successive correct taps. Rising within a block indicates slowing.' },
  { file: '05_visual_search.csv', column: 'termination_mode', type: 'factor(4)', unit: '-', role: 'qc', description: 'How the task ended: time_limit, voluntary_full (all targets found), voluntary_early, or session_terminated. Rows ending voluntary_early warrant inspection.' },
  { file: '06_display_perception.csv', column: 'display_comfort_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated comfort of the display in this condition, captured immediately after reading.' },
  { file: '06_display_perception.csv', column: 'text_clarity_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated clarity of the text in this condition, captured immediately after reading.' },
  { file: '06_display_perception.csv', column: 'comfort_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the comfort slider was actually moved. False means the value is the untouched default and should not be treated as a response.' },
  { file: '06_display_perception.csv', column: 'clarity_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the clarity slider was actually moved. False means the value is the untouched default.' },
  { file: '06_display_perception.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time from the rating screen appearing to submission. Very short values feed the rushed-response flag.' },
  { file: '07_eye_metrics.csv', column: 'camera_active', type: 'boolean', unit: '-', role: 'qc', description: 'Whether camera measurement ran for this condition. False when the participant declined camera consent or the camera failed; every ocular column is then missing rather than zero.' },
  { file: '07_eye_metrics.csv', column: 'blink_rate_full', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Rate of FULL (complete) blinks only. Read alongside blink_rate: a stable total with a falling full rate is the composition shift the study is designed to detect.' },
  { file: '07_eye_metrics.csv', column: 'mean_inter_blink_interval_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean interval between blinks. Lengthens as blinking is suppressed.' },
  { file: '07_eye_metrics.csv', column: 'inter_blink_interval_cv', type: 'number', unit: 'ratio', role: 'dv', description: 'Coefficient of variation of the inter-blink interval. Erratic blinking shows here before mean rate moves.' },
  { file: '07_eye_metrics.csv', column: 'perclos_p70', type: 'number', unit: '0-1', role: 'covariate', description: 'Proportion of time the eyes were at least 70 per cent closed. A more permissive companion to perclos_p80; a sleepiness covariate, not a visual-fatigue outcome.' },
  { file: '07_eye_metrics.csv', column: 'long_closure_count', type: 'integer', unit: 'count', role: 'covariate', description: 'Closures longer than 500 ms. A micro-sleep proxy; treat as a sleepiness covariate.' },
  { file: '07_eye_metrics.csv', column: 'long_closure_total_ms', type: 'number', unit: 'ms', role: 'covariate', description: 'Total duration of long closures within the condition.' },
  { file: '07_eye_metrics.csv', column: 'blink_duration_mean_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean blink duration. Gated on achieved frame rate; unreliable below about 25 fps.' },
  { file: '07_eye_metrics.csv', column: 'first_half_blink_rate', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Blink rate over the first half of the condition. Paired with the second half to expose within-condition drift.' },
  { file: '07_eye_metrics.csv', column: 'second_half_blink_rate', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Blink rate over the second half of the condition.' },
  { file: '07_eye_metrics.csv', column: 'ear_threshold_used', type: 'number', unit: 'ratio', role: 'qc', description: 'Eye-aspect-ratio threshold actually applied, expressed as a fraction of the participant calibrated baseline. Recorded so classification can be reproduced or re-cut later.' },
  { file: '07_eye_metrics.csv', column: 'ear_complete_threshold', type: 'float', unit: 'EAR', role: 'provenance', description: 'EAR at or below which a blink was counted as COMPLETE (0.60 x this participant\u2019s open-eye baseline). With ear_threshold_used, which is the registration cut at 0.75 x baseline, the complete/incomplete classification can be reproduced from the exported data.' },
  { file: '07_eye_metrics.csv', column: 'head_pitch_mean', type: 'number', unit: 'degrees', role: 'covariate', description: 'Mean head pitch. Relative to the participant calibrated frontal posture when head_pitch_calibrated is true, otherwise to a population default.' },
  { file: '07_eye_metrics.csv', column: 'head_yaw_mean', type: 'number', unit: 'degrees', role: 'covariate', description: 'Mean head yaw over the condition.' },
  { file: '07_eye_metrics.csv', column: 'head_roll_mean', type: 'number', unit: 'degrees', role: 'covariate', description: 'Mean head roll over the condition.' },
  { file: '07_eye_metrics.csv', column: 'head_movement_std', type: 'number', unit: 'degrees', role: 'covariate', description: 'Standard deviation of head position. High values indicate restlessness or a poorly supported posture.' },
  { file: '07_eye_metrics.csv', column: 'postural_load', type: 'number', unit: 'index', role: 'covariate', description: 'Composite index of sustained non-neutral head posture. A musculoskeletal-strain proxy, not an ocular measure.' },
  { file: '07_eye_metrics.csv', column: 'head_stability_score', type: 'number', unit: '0-1', role: 'qc', description: 'How steadily the head was held. Low values degrade the reliability of every camera-derived measure in the row.' },
  { file: '07_eye_metrics.csv', column: 'off_axis_ratio', type: 'number', unit: '0-1', role: 'qc', description: 'Proportion of processed frames in which the head was turned away from the display.' },
  { file: '07_eye_metrics.csv', column: 'gaze_calibrated', type: 'boolean', unit: '-', role: 'qc', description: 'Whether gaze columns rest on a valid nine-point calibration. When false, gaze is coarse-zone only.' },
  { file: '07_eye_metrics.csv', column: 'gaze_deviation_ratio', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of frames with gaze away from the reading region. Interpretable only when gaze_calibrated is true.' },
  { file: '07_eye_metrics.csv', column: 'zone_center_ratio', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of frames with gaze in the central reading zone.' },
  { file: '07_eye_metrics.csv', column: 'zone_transition_count', type: 'integer', unit: 'count', role: 'dv', description: 'Number of transitions between gaze zones. A coarse scanning-activity index.' },
  { file: '07_eye_metrics.csv', column: 'face_size_ratio', type: 'number', unit: 'ratio', role: 'qc', description: 'Detected face size relative to frame. A viewing-distance proxy; a large change between conditions means the participant moved.' },
  { file: '07_eye_metrics.csv', column: 'mean_face_luma', type: 'number', unit: '0-255', role: 'qc', description: 'Mean frame luminance over the condition, BT.601. Camera exposure and room-light quality control.' },
  { file: '07_eye_metrics.csv', column: 'lighting_quality', type: 'factor(3)', unit: '-', role: 'qc', description: 'Classified capture lighting: low, good or overexposed. Null when the camera was inactive. Rows outside good warrant a sensitivity check.' },
  { file: '08_reaction_trials.csv', column: 'trial_number', type: 'integer', unit: '1-32', role: 'id', description: 'Position of the trial within the condition block.' },
  { file: '08_reaction_trials.csv', column: 'trial_category', type: 'string', unit: '-', role: 'iv', description: 'Trial type as presented: go (achromatic target) or no-go (chromatic distractor).' },
  { file: '08_reaction_trials.csv', column: 'is_signal', type: 'boolean', unit: '-', role: 'iv', description: 'True on go trials. Signal and noise trials must both be present for sensitivity to be estimable.' },
  { file: '08_reaction_trials.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Latency from stimulus onset to response. Null when no response was made.' },
  { file: '08_reaction_trials.csv', column: 'accuracy', type: 'boolean', unit: '-', role: 'dv', description: 'Whether the trial was answered correctly: responding on go, withholding on no-go.' },
  { file: '08_reaction_trials.csv', column: 'anticipatory', type: 'boolean', unit: '-', role: 'qc', description: 'Response faster than the anticipation cutoff. Excluded from reaction-time means and counted separately, because it reflects guessing rather than detection.' },
  { file: '08_reaction_trials.csv', column: 'false_start', type: 'boolean', unit: '-', role: 'qc', description: 'Response made before the stimulus appeared.' },
  { file: '09_rt_summary.csv', column: 'total_trials', type: 'integer', unit: 'count', role: 'meta', description: 'Trials recorded in the block.' },
  { file: '09_rt_summary.csv', column: 'signal_trials', type: 'integer', unit: 'count', role: 'meta', description: 'Go trials in the block. Sensitivity is not estimable when this is zero.' },
  { file: '09_rt_summary.csv', column: 'hits', type: 'integer', unit: 'count', role: 'dv', description: 'Correct responses on go trials.' },
  { file: '09_rt_summary.csv', column: 'false_alarms', type: 'integer', unit: 'count', role: 'dv', description: 'Responses on no-go trials.' },
  { file: '09_rt_summary.csv', column: 'misses', type: 'integer', unit: 'count', role: 'dv', description: 'Go trials with no response.' },
  { file: '09_rt_summary.csv', column: 'correct_rejections', type: 'integer', unit: 'count', role: 'dv', description: 'No-go trials correctly withheld.' },
  { file: '09_rt_summary.csv', column: 'hit_rate', type: 'number', unit: '0-1', role: 'dv', description: 'hits divided by signal trials.' },
  { file: '09_rt_summary.csv', column: 'false_alarm_rate', type: 'number', unit: '0-1', role: 'dv', description: 'false alarms divided by noise trials.' },
  { file: '09_rt_summary.csv', column: 'error_rate', type: 'number', unit: '0-1', role: 'dv', description: 'Misses plus false alarms over all trials.' },
  { file: '09_rt_summary.csv', column: 'median_rt_hits_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Median latency over valid hits. More robust than the mean to the long right tail of reaction-time distributions.' },
  { file: '09_rt_summary.csv', column: 'rt_sd_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Standard deviation of hit latencies. Variability rises with fatigue before mean latency does.' },
  { file: '09_rt_summary.csv', column: 'anticipations', type: 'integer', unit: 'count', role: 'qc', description: 'Responses faster than the anticipation cutoff, excluded from the latency means.' },
  { file: '09_rt_summary.csv', column: 'lapse_count', type: 'integer', unit: 'count', role: 'dv', description: 'Valid hits slower than the lapse threshold. The attention-lapse index, following psychomotor vigilance practice.' },
  { file: '09_rt_summary.csv', column: 'inverse_efficiency_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean latency divided by proportion correct. Controls the speed-accuracy trade-off, so a condition cannot look fast merely by being careless.' },
  { file: '09_rt_summary.csv', column: 'first_half_mean_rt_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean hit latency over the first half of the block. Paired with the second half to index within-block vigilance decrement.' },
  { file: '09_rt_summary.csv', column: 'second_half_mean_rt_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean hit latency over the second half of the block.' },
  { file: '09_rt_summary.csv', column: 'd_prime_se', type: 'number', unit: '-', role: 'qc', description: 'Standard error of sensitivity. Values above 0.3 indicate small-sample instability; treat those estimates cautiously.' },
  { file: '09_rt_summary.csv', column: 'criterion', type: 'number', unit: '-', role: 'dv', description: 'Signal-detection response bias c. Above zero is conservative (fewer responses), below zero liberal. Reported alongside sensitivity so a bias shift is not read as a sensitivity change.' },
  { file: '10_wide_summary.csv', column: 'polarity', type: 'factor(2)', unit: '-', role: 'iv', description: 'Display polarity for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'color_name', type: 'factor(5)', unit: '-', role: 'iv', description: 'Text-colour factor for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'wcag_contrast_ratio', type: 'number', unit: 'ratio 1-21', role: 'iv', description: 'Contrast for this condition-run. Enter as log10; this is the mediator tested against hue.' },
  { file: '10_wide_summary.csv', column: 'below_wcag_aa', type: 'boolean', unit: '-', role: 'covariate', description: 'True when contrast is below 4.5:1.' },
  { file: '10_wide_summary.csv', column: 'mean_rt_hits_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean reaction time over valid hits.' },
  { file: '10_wide_summary.csv', column: 'd_prime', type: 'number', unit: '-', role: 'dv', description: 'Signal-detection sensitivity for the reaction-time block. Null when not estimable; never read a null as zero sensitivity.' },
  { file: '10_wide_summary.csv', column: 'd_prime_se', type: 'number', unit: '-', role: 'qc', description: 'Standard error of sensitivity for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'criterion', type: 'number', unit: '-', role: 'dv', description: 'Signal-detection response bias for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'fatigue_mean', type: 'number', unit: '0-10', role: 'dv', description: 'Mean of the five visual-fatigue items for this condition.' },
  { file: '10_wide_summary.csv', column: 'comprehension_correct', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of the three comprehension items answered correctly, so it takes the values 0, one third, two thirds or 1. Null when the condition recorded no item at all.' },
  { file: '10_wide_summary.csv', column: 'search_accuracy', type: 'number', unit: '0-1', role: 'dv', description: 'Visual-search accuracy for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'search_efficiency', type: 'number', unit: 'hits/min', role: 'dv', description: 'Visual-search correct taps per minute.' },
  { file: '10_wide_summary.csv', column: 'comfort_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated display comfort for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'clarity_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated text clarity for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'blink_rate', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Total blink rate for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'blink_rate_full', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Complete-blink rate for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'effective_fps', type: 'number', unit: 'fps', role: 'qc', description: 'Achieved camera sampling rate. Duration-based ocular measures are unreliable below about 25; check this before modelling them.' },
  { file: '10_wide_summary.csv', column: 'face_presence_ratio', type: 'number', unit: '0-1', role: 'qc', description: 'Proportion of the condition with a face detected. Low values mean the ocular row rests on little data.' },
  { file: '10_wide_summary.csv', column: 'qc_overall', type: 'string', unit: '-', role: 'qc', description: 'Overall quality verdict for the condition-run: good, warn or bad. Use it to define the sensitivity analysis, not to delete rows silently.' },
  { file: '11_participant.csv', column: 'enrolment_number', type: 'integer', unit: '1-n', role: 'id', description: 'Sequential enrolment index. Drives the counterbalancing row assignment and the illumination order, so it is not an arbitrary identifier and must not be reshuffled.' },
  { file: '11_participant.csv', column: 'age', type: 'integer', unit: 'years', role: 'covariate', description: 'Age at enrolment. The sample is delimited to 18 to 35.' },
  { file: '11_participant.csv', column: 'gender', type: 'string', unit: '-', role: 'covariate', description: 'Self-reported gender.' },
  { file: '11_participant.csv', column: 'daily_screen_hours', type: 'number', unit: 'hours', role: 'covariate', description: 'Habitual daily screen exposure. A pre-specified moderator.' },
  { file: '11_participant.csv', column: 'device_familiarity', type: 'factor(3)', unit: '-', role: 'covariate', description: 'Self-rated digital literacy: low, moderate or high. A pre-specified moderator.' },
  { file: '11_participant.csv', column: 'lighting_habit', type: 'factor(3)', unit: '-', role: 'covariate', description: 'Typical ambient lighting when using a screen: bright, moderate or dim. A pre-specified moderator.' },
  { file: '11_participant.csv', column: 'correction_type', type: 'factor(3)', unit: '-', role: 'covariate', description: 'Refractive correction worn during testing: none, glasses or contacts. Contact-lens wear on test days is an exclusion, so this should not read contacts for an included participant.' },
  { file: '11_participant.csv', column: 'cvd_status', type: 'factor(5)', unit: '-', role: 'covariate', description: "Colour-vision status: normal, self_reported_deficient, screen_failed, screen_inconclusive or unknown. screen_inconclusive means the greyscale control plate was missed, so the attempt measured nothing — it is NOT a pass and NOT an exclusion, and such a participant should be re-screened before their text-colour data is analysed. Anything other than normal bears directly on the text-colour factor." },
  { file: '11_participant.csv', column: 'ishihara_correct', type: 'integer', unit: 'count', role: 'qc', description: 'Ishihara plates identified correctly on the study display. Null when the screening was not run.' },
  { file: '11_participant.csv', column: 'ishihara_total', type: 'integer', unit: 'count', role: 'qc', description: 'Plates presented. The denominator for ishihara_correct.' },
  { file: '11_participant.csv', column: 'caffeine_today', type: 'boolean', unit: '-', role: 'covariate', description: 'Whether caffeine was consumed before the sitting. An arousal covariate for the vigilance measures.' },
  { file: '11_participant.csv', column: 'hours_since_sleep', type: 'number', unit: 'hours', role: 'covariate', description: 'Hours awake at the start of the sitting. A sleepiness covariate, read alongside PERCLOS.' },
  { file: '11_participant.csv', column: 'eligible', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the participant met every eligibility criterion. Rows with false must be excluded from the confirmatory analysis.' },
  { file: '11_participant.csv', column: 'exclusion_reason', type: 'string', unit: '-', role: 'qc', description: 'Recorded reason when eligible is false. Kept so exclusions can be reported rather than merely counted.' },
  { file: '11_participant.csv', column: 'baseline_fatigue', type: 'number', unit: '0-10', role: 'covariate', description: "The FIRST sitting's visual-fatigue rating taken before its first condition; empty if none was administered. This record is shared across a participant's two sittings and cannot hold both, so use the per-sitting baseline rows in 03_fatigue_scores.csv (stage='baseline') for any within-session change — that is what fatigue_delta is computed from." },
  { file: '12_quality_flags.csv', column: 'engagement_flag', type: 'string', unit: '-', role: 'qc', description: 'Composite verdict for the condition-run: good, warn or bad. Derived from the individual signals in this file.' },
  { file: '12_quality_flags.csv', column: 'quality_score', type: 'number', unit: '0-1', role: 'qc', description: 'Composite quality score after penalties. Lower means more disengagement signals fired.' },
  { file: '12_quality_flags.csv', column: 'reading_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time spent on the reading task, used with word count to detect skimming.' },
  { file: '12_quality_flags.csv', column: 'fatigue_response_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken over the fatigue scale. Very short values feed the rushed flag.' },
  { file: '12_quality_flags.csv', column: 'perception_response_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken over the comfort and clarity ratings.' },
  { file: '12_quality_flags.csv', column: 'reading_skim', type: 'boolean', unit: '-', role: 'qc', description: 'True when reading was faster than the plausible ceiling for the passage word count, so the exposure window cannot be treated as sustained reading.' },
  { file: '12_quality_flags.csv', column: 'rt_disengaged', type: 'boolean', unit: '-', role: 'qc', description: 'True when the reaction-time block shows a high false-alarm, error or lapse rate together, indicating the participant stopped attending.' },
  { file: '12_quality_flags.csv', column: 'careless_rushed_fatigue', type: 'boolean', unit: '-', role: 'qc', description: 'True when the fatigue scale was submitted too quickly to have been read.' },
  { file: '12_quality_flags.csv', column: 'careless_rushed_perception', type: 'boolean', unit: '-', role: 'qc', description: 'True when the comfort and clarity ratings were submitted too quickly to have been read.' },
  { file: '12_quality_flags.csv', column: 'careless_straight_lined', type: 'boolean', unit: '-', role: 'qc', description: 'True when all five fatigue items received an identical value, the classic straight-lining signature.' },
  { file: '12_quality_flags.csv', column: 'comprehension_wrong', type: 'boolean', unit: '-', role: 'qc', description: 'True when the participant scored below chance across the three items for this condition. A single slip does not fire it.' },
  { file: '12_quality_flags.csv', column: 'low_face_presence', type: 'boolean', unit: '-', role: 'qc', description: 'True when a face was detected for too little of the condition for the ocular measures to be trustworthy.' },
  { file: '12_quality_flags.csv', column: 'reasons', type: 'string', unit: '-', role: 'qc', description: 'Human-readable list of every penalty that fired, semicolon separated. Read this before excluding a row.' },
  { file: '13_cvsq.csv', column: 'stage', type: 'factor(2)', unit: '-', role: 'iv', description: 'When the questionnaire was administered: baseline or session_end. The key secondary outcome is the change between them.' },
  { file: '13_cvsq.csv', column: 'symptomatic', type: 'boolean', unit: '-', role: 'dv', description: 'Whether the total reached the validated cut-off for computer vision syndrome.' },
  { file: '13_cvsq.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken to complete the questionnaire.' },
  { file: '14_nasa_tlx.csv', column: 'ambient_illumination_level', type: 'factor(2)', unit: '-', role: 'iv', description: 'Illumination level of the sitting this workload rating belongs to: dim or moderate. Administered once per session, so workload inference is limited to the illumination contrast.' },
  { file: '14_nasa_tlx.csv', column: 'mental_demand', type: 'number', unit: '0-100', role: 'dv', description: 'Mental demand subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'physical_demand', type: 'number', unit: '0-100', role: 'dv', description: 'Physical demand subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'temporal_demand', type: 'number', unit: '0-100', role: 'dv', description: 'Temporal demand subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'effort', type: 'number', unit: '0-100', role: 'dv', description: 'Effort subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'frustration', type: 'number', unit: '0-100', role: 'dv', description: 'Frustration subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'all_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Whether every subscale slider was moved. False means at least one value is an untouched default.' },
  { file: '14_nasa_tlx.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken over the workload instrument.' },
  { file: '15_media_inventory.csv', column: 'captured_at', type: 'string', unit: 'ISO 8601', role: 'meta', description: 'When the file was captured.' },
  { file: '15_media_inventory.csv', column: 'mime', type: 'string', unit: '-', role: 'meta', description: 'Media type of the stored file.' },
  { file: '15_media_inventory.csv', column: 'bytes', type: 'integer', unit: 'bytes', role: 'meta', description: 'Size of the stored file in bytes. Used to reconcile the inventory against the media actually present.' },
  { file: '15_media_inventory.csv', column: 'width', type: 'integer', unit: 'px', role: 'meta', description: 'Pixel width, where applicable.' },
  { file: '15_media_inventory.csv', column: 'height', type: 'integer', unit: 'px', role: 'meta', description: 'Pixel height, where applicable.' },
  { file: '15_media_inventory.csv', column: 'duration_ms', type: 'number', unit: 'ms', role: 'meta', description: 'Duration for video segments; blank for photographs.' },
  { file: '15_media_inventory.csv', column: 'filename', type: 'string', unit: '-', role: 'meta', description: 'The name this capture is written under when the media files are downloaded, so an inventory row can be matched to the file on disk without relying on write order.' },
  { file: '15_media_inventory.csv', column: 'consent_setup_photos', type: 'boolean', unit: '-', role: 'meta', description: 'The setup-photograph permission in force at the moment of capture. Stored with the file so a recording is never separable from the basis on which it was taken.' },
];

export function buildExportFiles(input: SessionBundle): ExportFile[] {
  nonFiniteCells = 0;
  // Normalise ordering at the boundary so the export is reproducible regardless of how the bundle
  // was assembled - straight from IndexedDB, from a test fixture, or from an import. Without this
  // the same data can produce different bytes and the manifest checksums certify nothing.
  const bundle = normaliseBundle(input);
  const { session, participant } = bundle;
  const pid = session.participant_id;
  const date = new Date(session.session_start_time).toISOString().slice(0, 10);
  const summaries = buildConditionSummaries(bundle);
  // Most recent calibration by the time it was taken, falling back to document order for records
  // written before calibrated_at existed. Never an arbitrary uuid sort — see 01_session_info.
  const latestCalibration = [...bundle.calibration].sort(
    (a, b) => (a.calibrated_at ?? 0) - (b.calibrated_at ?? 0),
  ).at(-1);
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
    ['participant_id', 'experiment_date', 'enrolment_number', 'session_index', 'session_status', 'conditions_completed', 'session_complete', 'conditions_per_session', 'condition_offset', 'ambient_lux', 'ambient_illumination_level', 'illumination_block', 'illumination_order_first', 'lux_start', 'lux_middle', 'lux_end', 'lux_n_readings', 'lux_checkpoints_logged', 'lux_complete', 'lux_mean', 'lux_max_deviation', 'lux_logged_all_in_range', 'lux_deviation_note', 'screen_white_luminance_cd_m2', 'brightness_percent', 'session_duration_min', 'app_version', 'git_hash', 'condition_def_hash', 'schema_version', 'device_type', 'screen_resolution', 'consent_given', 'consent_camera_metrics', 'consent_setup_photos', 'consent_annotation_video', 'media_items_retained', 'preflight_complete', 'e2e_timing', 'stimulus_font_ok', 'caffeine_today_session', 'hours_since_sleep_session', 'gaze_calibration_valid', 'calibration_ear_baseline', 'calibration_pitch_baseline_frac', 'calibration_targets_detected', 'calibration_runs'],
    [{
      participant_id: pid, experiment_date: date, enrolment_number: session.enrolment_number,
      session_index: session.session_index,
      // Completeness, declared rather than inferred. An export can now be taken from a session that
      // is still running or that a participant withdrew from part-way, and such a session is a
      // legitimate — sometimes the only — record of what happened. But its condition rows are a
      // truncated series, not a balanced set, and pooling them with completed sittings without
      // noticing would bias every within-participant contrast toward the conditions that come
      // early in the Williams order. These three columns make that visible in the first file an
      // analyst opens.
      session_status: session.status,
      conditions_completed: bundle.conditions.length,
      session_complete: session.status === 'complete'
        && bundle.conditions.length === session.conditions_per_session,
      conditions_per_session: session.conditions_per_session, condition_offset: session.condition_offset,
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
      e2e_timing: session.e2e_timing ?? false,
      stimulus_font_ok: session.stimulus_font_ok ?? '',
      caffeine_today_session: session.caffeine_today ?? '',
      hours_since_sleep_session: session.hours_since_sleep ?? '',
      /**
       * The calibration that was actually in force for the LATEST part of the sitting, plus a count
       * so the reader knows there was more than one.
       *
       * These columns used to read `bundle.calibration[0]`, and the bundle is sorted by
       * calibration_id — a uuid. A resume re-runs calibration, so a session can hold two, and the
       * export picked between them at random: the participant's open-eye EAR baseline reported at
       * session level might be the one from before the interruption or the one from after, with
       * nothing to say which. Every blink threshold in the run is a fraction of that baseline.
       */
      gaze_calibration_valid: latestCalibration?.is_real_calibration ?? '',
      calibration_ear_baseline: latestCalibration?.ear_baseline ?? '',
      calibration_pitch_baseline_frac: latestCalibration?.pitch_baseline_frac ?? '',
      calibration_targets_detected: latestCalibration ? `${latestCalibration.targets_detected}/${latestCalibration.targets_total}` : '',
      calibration_runs: bundle.calibration.length,
    }]);

  // 02 — conditions (+ reading speed in words/min, derived from passage length & reading time)
  csv('02_conditions.csv',
    ['participant_id', 'condition_id', 'session_position', 'condition_label', 'polarity', 'background_color', 'text_color', 'color_name', 'ink_name', 'passage_id', 'wcag_contrast_ratio', 'wcag_level', 'michelson_contrast', 'below_wcag_aa', 'adaptation_ms_before', 'passage_repeat_number', 'reading_time_ms', 'reading_speed_wpm', 'condition_duration_sec'],
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
    ['participant_id', 'condition_id', 'passage_id', 'question_index', 'question_kind', 'selected_index', 'correct_index', 'is_correct', 'response_time_ms'],
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
    ['participant_id', 'condition_id', 'camera_active', 'effective_fps', 'fps_adequate_for_tiers', 'fps_adequate_for_ratio', 'blink_rate', 'blink_rate_full', 'incomplete_blink_ratio', 'mean_inter_blink_interval_ms', 'inter_blink_interval_cv', 'perclos_p80', 'perclos_p70', 'long_closure_count', 'long_closure_total_ms', 'blink_duration_mean_ms', 'first_half_blink_rate', 'second_half_blink_rate', 'ear_baseline', 'ear_threshold_used', 'ear_complete_threshold', 'head_pitch_mean', 'head_pitch_calibrated', 'head_yaw_mean', 'head_roll_mean', 'head_movement_std', 'postural_load', 'head_stability_score', 'off_axis_ratio', 'gaze_calibrated', 'gaze_deviation_ratio', 'zone_center_ratio', 'zone_transition_count', 'face_presence_ratio', 'face_size_ratio', 'mean_face_luma', 'lighting_quality'],
    bundle.eyeMetrics.map((e) => ({
      participant_id: pid, condition_id: e.condition_id, camera_active: e.camera_active,
      effective_fps: e.effective_fps, fps_adequate_for_tiers: e.fps_adequate_for_tiers,
      fps_adequate_for_ratio: e.fps_adequate_for_ratio,
      blink_rate: e.blink_rate, blink_rate_full: e.blink_rate_full, incomplete_blink_ratio: e.incomplete_blink_ratio,
      mean_inter_blink_interval_ms: e.mean_inter_blink_interval_ms, inter_blink_interval_cv: e.inter_blink_interval_cv,
      perclos_p80: e.perclos_p80, perclos_p70: e.perclos_p70, long_closure_count: e.long_closure_count, long_closure_total_ms: e.long_closure_total_ms,
      blink_duration_mean_ms: e.blink_duration_mean_ms,
      first_half_blink_rate: e.bins.first_half_blink_rate, second_half_blink_rate: e.bins.second_half_blink_rate,
      ear_baseline: e.ear_baseline, ear_threshold_used: e.ear_threshold_used,
      ear_complete_threshold: e.ear_complete_threshold,
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
  // per the original anchors), and it enters raw_tlx as marked — no reversal.
  //
  // There used to be a `performance_load` column holding 100 - performance, and raw_tlx was built
  // from it. That flipped the sign of one subscale in six: a participant marking near "Perfect"
  // contributed near-maximal load, and a condition that genuinely degraded performance pushed
  // raw_tlx DOWN. The column is gone rather than kept as an identity, because a duplicate of
  // `performance` under a name implying a transformation is how the confusion started.
  csv('14_nasa_tlx.csv',
    ['participant_id', 'session_index', 'ambient_illumination_level', 'raw_tlx',
     'mental_demand', 'physical_demand', 'temporal_demand', 'performance',
     'effort', 'frustration', 'all_touched', 'response_time_ms'],
    (bundle.tlx ?? []).map((t) => ({
      participant_id: pid, session_index: session.session_index,
      ambient_illumination_level: session.ambient_illumination_level,
      raw_tlx: round(t.raw_tlx, 2),
      mental_demand: t.mental_demand, physical_demand: t.physical_demand,
      temporal_demand: t.temporal_demand, performance: t.performance,
      effort: t.effort, frustration: t.frustration,
      all_touched: t.all_touched, response_time_ms: t.response_time_ms,
    })));

  // 15 — consented media inventory. Metadata and checksums only: the blobs are downloaded as
  // separate files, and embedding them here would make the CSV bundle unusable. The checksum lets
  // a reader confirm a given file is the one this session recorded.
  csv('15_media_inventory.csv',
    ['participant_id', 'session_index', 'media_id', 'kind', 'checkpoint', 'condition_label',
     'captured_at', 'mime', 'bytes', 'width', 'height', 'duration_ms', 'checksum_fnv1a',
     'blob_present', 'filename', 'consent_setup_photos', 'consent_annotation_video'],
    (bundle.media ?? []).map((m) => ({
      participant_id: pid, session_index: session.session_index,
      media_id: m.media_id, kind: m.kind, checkpoint: m.checkpoint,
      // The name the file is written under by Export → Download media files.
      filename: mediaFilename(session, m),
      // Whether the file itself is still on this device. A backup carries the inventory row but
      // not the binary, so after a restore this is false and the row describes a file that no
      // longer exists. Without the column the inventory asserts the file is present.
      blob_present: (m as unknown as { blob?: unknown; blob_present?: boolean }).blob != null
        || (m as unknown as { blob_present?: boolean }).blob_present === true,
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
    // NOTE: no exported_at here. An export timestamp describes WHEN the export ran, not what it
    // contains, and embedding it made the data file's bytes differ for identical data - so its
    // manifest checksum could not be used to confirm two exports hold the same dataset. The
    // timestamp lives in the manifest, which is provenance rather than data.
    provenance: session.provenance,
    session, participant,
    conditions: bundle.conditions, fatigue: bundle.fatigue, cvsq: bundle.cvsq, nasa_tlx: bundle.tlx,
    comprehension: bundle.comprehension, visual_search: bundle.visualSearch,
    display_perception: bundle.perception, eye_metrics: bundle.eyeMetrics,
    calibration: bundle.calibration,
    rt_summaries: bundle.rtSummaries, reaction_trials_count: bundle.reactionTrials.length,
  };
  files.push({ filename: `session_${safeFilePart(pid)}_${session.session_id.slice(0, 8)}.json`, content: JSON.stringify(jsonBundle, null, 2), mime: 'application/json' });

  // Complete backup. The analysis JSON above is deliberately partial (reaction trials appear only
  // as a count), so it cannot restore a session. This artefact can, and every export carries one so
  // that a tablet failing later never costs a session that was already exported once.
  files.push({
    filename: `backup_${safeFilePart(pid)}_${session.session_id.slice(0, 8)}.json`,
    content: serialiseSessionBackup(bundle),
    mime: 'application/json',
  });

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

/**
 * Browser-only: stream the consented photo and video files themselves to the device.
 *
 * The CSV bundle carries only the inventory — id, checkpoint, byte count and checksum — because a
 * blob embedded in a CSV would make the CSV unusable. That left the binaries reachable only by
 * opening IndexedDB by hand, so the material the annotation sub-study is coded from could not
 * actually leave the tablet, and a wiped device destroyed it. Each file is written under the name
 * `15_media_inventory.csv` gives it, so the two can always be joined.
 *
 * Returns what was written and what was missing. A row whose blob is gone — after a restore from a
 * backup, which carries the inventory but not the binary — is reported, never skipped silently.
 */
export async function downloadSessionMedia(
  bundle: SessionBundle,
): Promise<{ written: number; missing: string[] }> {
  const { session } = bundle;
  const missing: string[] = [];
  let written = 0;
  for (const m of bundle.media ?? []) {
    const blob = (m as unknown as { blob?: Blob }).blob;
    if (!(blob instanceof Blob)) { missing.push(m.media_id); continue; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mediaFilename(session, m);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    written++;
    await new Promise((r) => setTimeout(r, 130));
  }
  return { written, missing };
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
