/**
 * Export builder. Produces the CSV bundle + JSON + master codebook + a provenance manifest with
 * per-file checksums. Pure (`buildExportFiles`) so it is fully unit-testable; `downloadExport`
 * is the thin browser wrapper that streams the files to the device.
 */
import { RATE_CORRECTION_NOTE } from '@/lib/signalDetection';
import { CONFIG } from '@/experiment/config';
import { normaliseBundle, sessionForExport, type SessionBundle } from './gather';
import type { SessionRecord } from './types';
import type { MediaRecord } from './media';
import { summariseLux, LUX_CHECKPOINTS } from '@/experiment/illumination';
import { buildConditionSummaries, ENGAGEMENT } from '@/dashboard/aggregate';
import { isConditionComplete } from './conditionStatus';
import { latestCalibration as lastCalibrationTaken } from './calibrationLookup';
import { isWithdrawn } from './gather';
import { SCREEN_TEST_PLATES, SCREEN_ALLOWED_SLIPS } from '@/screening/ishihara';
import { PASSAGES, SEARCH_EXCERPT_MAX_WORDS } from '@/experiment/passages';
import { CONDITIONS } from '@/experiment/conditions';
import { auditBundle } from './integrity';
import { serialiseSessionBackup } from './backup';
import { requiredGrant } from './media';

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

/**
 * Start counting non-finite cells afresh, and read the running total.
 *
 * escapeCsv() blanks a NaN or an Infinity rather than writing the literal, because R would coerce
 * either into something that looks like data. That silence is only tolerable because a count of how
 * often it happened travels in the manifest. The counter was module-private and reset only inside
 * buildExportFiles(), so the POOLED analysis export — which builds its CSVs through the same
 * escapeCsv() — could blank a non-finite cell with nothing anywhere to say it had. The pair is
 * exported so any builder emitting a manifest can bracket its own CSV writes and report the same
 * number for its own files rather than inheriting a total left over from some earlier export.
 */
export function beginNonFiniteCount(): void { nonFiniteCells = 0; }
export function nonFiniteCellCount(): number { return nonFiniteCells; }

/**
 * The numeric range a codebook `unit` declares, or null when it declares no range.
 *
 * Handles the forms this codebook actually uses: '0-1', '0-100', '0-9', '0-10', '0-2', '0-3' and
 * 'ratio 1-21'. Units that are dimensions rather than ranges ('ms', 'lux', 'count', 'degrees', '-')
 * return null and are handled separately or not at all.
 */
export function rangeOfUnit(unit: string | undefined): [number, number] | null {
  if (!unit) return null;
  const m = /^(?:ratio )?(-?\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(unit.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Cells whose value falls outside the range their own codebook entry declares.
 *
 * WHY THIS EXISTS, and why it counts rather than corrects.
 *
 * The codebook declares a `unit` for every column and 21 of them say '0-1', 12 say '0-100', 9 say
 * '0-10'. Nothing checked the data against those declarations, and the export passes a value
 * straight through: a corrupt store, a restored older-schema backup or a bad import could put
 * `incomplete_blink_ratio` at 1.8, `hit_rate` at 2.5 or `blink_count_full` at -3, and the file would
 * carry them inside columns the codebook promises are bounded. A model fitted on a proportion of 1.8
 * does not fail; it produces a number.
 *
 * Passing the value through is the RIGHT behaviour — clamping 1.8 to 1.0 would fabricate a
 * measurement, which this export refuses to do anywhere. What was missing is the other half of the
 * same bargain, and `escapeCsv` above states it exactly: a silence is only tolerable when a count of
 * how often it happened travels in the manifest. This is that count, for this class.
 *
 * Empty cells are skipped: absence is reported by the completeness checks, not here. Non-numeric
 * text in a numeric column is left to the declared-type gate in scripts/verifyExport.ts.
 */
export function countOutOfDeclaredRange(
  files: { filename: string; content: string }[],
  /**
   * How to find the declared unit for a column. Defaults to the per-session CODEBOOK, keyed by file
   * AND column because the same column name means different things in different files.
   *
   * Passed in so the POOLED analysis export can hold its own declarations to the same standard:
   * `analysis_long.csv` is the modelling unit and is documented by ANALYSIS_CODEBOOK, which is keyed
   * by column alone. A check that only covered the per-session files would leave the file the models
   * actually read unguarded — which is exactly the gap that let three QC columns go missing from it.
   */
  unitFor: (filename: string, column: string) => string | undefined =
    (filename, column) => CODEBOOK.find((c) => c.file === filename && c.column === column)?.unit,
): { cells: number; columns: string[] } {
  const offenders = new Set<string>();
  let cells = 0;
  for (const file of files) {
    if (!file.filename.endsWith('.csv') || file.filename === '00_CODEBOOK.csv') continue;
    const rows = parseCsvForRangeCheck(file.content);
    if (rows.length < 2) continue;
    const headers = rows[0];
    for (const row of rows.slice(1)) {
      headers.forEach((header, i) => {
        const unit = unitFor(file.filename, header);
        if (!unit) return;
        const raw = (row[i] ?? '').trim();
        if (raw === '') return;
        const value = Number(raw);
        if (!Number.isFinite(value)) return;
        const range = rangeOfUnit(unit);
        if (range) {
          if (value < range[0] || value > range[1]) {
            cells++;
            offenders.add(`${file.filename}:${header} (declared ${unit}, saw ${raw})`);
          }
        } else if (unit === 'count' && (value < 0 || !Number.isInteger(value))) {
          // A count is a non-negative integer by definition; the unit says so without a range.
          cells++;
          offenders.add(`${file.filename}:${header} (declared count, saw ${raw})`);
        } else if (unit === 'ratio' && value < 0) {
          /*
           * `ratio` asserts a floor and NOT a ceiling, which is what the eight columns declaring it
           * actually are. The eye aspect ratio is a ratio of distances (roughly 0.1-0.4 for an open
           * eye) and a coefficient of variation is sd/mean — both can exceed 1 legitimately, so
           * reading 'ratio' as 0-1 would invent a bound the codebook never claimed and flag real
           * data. Neither can be NEGATIVE, though, so that much is checkable without inventing
           * anything, and a negative EAR or CV is corruption rather than a measurement.
           */
          cells++;
          offenders.add(`${file.filename}:${header} (declared ratio, saw ${raw} — a ratio cannot be negative)`);
        }
      });
    }
  }
  return { cells, columns: [...offenders].sort() };
}

/** Minimal RFC-4180 reader, local to the range check so it cannot drift from the writer above. */
function parseCsvForRangeCheck(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

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
/**
 * The face-presence pilot gate, rendered for codebook prose. DERIVED, so this file cannot restate it
 * wrongly: the gate lives once, as ENGAGEMENT.FACE_PRESENCE_PILOT_GATE.
 *
 * It was previously typed as a literal "0.90" in the codebook and as a literal 0.8 in the dashboard
 * QC flag, and the two drifted — see the constant's own comment. Only one restatement now remains
 * outside TypeScript, QC_FACE_PRESENCE_MIN in analysis_template.R, and that one cannot be derived
 * across languages, so tests/export.test.ts asserts it directly.
 */
const FACE_PRESENCE_PILOT_GATE = ENGAGEMENT.FACE_PRESENCE_PILOT_GATE.toFixed(2);
const FACE_PRESENCE_PILOT_GATE_PCT = Math.round(ENGAGEMENT.FACE_PRESENCE_PILOT_GATE * 100);

/** The search task's target-count range across passages, for codebook prose. Derived, never typed. */
const SEARCH_TARGET_MIN = Math.min(...PASSAGES.map((x) => x.searchTargetCount));
const SEARCH_TARGET_MAX = Math.max(...PASSAGES.map((x) => x.searchTargetCount));

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
  { file: '01_session_info.csv', column: 'enrolment_number', type: 'integer', unit: '-', role: 'id', description: 'Sequential 1-based enrolment index. Drives the Williams condition row AND the illumination order; must stay dense for balance.' },
  { file: '01_session_info.csv', column: 'session_index', type: 'integer', unit: '-', role: 'iv', description: 'Sitting number for this participant, 1-based.' },
  { file: '01_session_info.csv', column: 'condition_offset', type: 'integer', unit: 'conditions', role: 'qc', description: 'Conditions already completed before this sitting, within the illumination block.' },
  { file: '01_session_info.csv', column: 'ambient_illumination_level', type: 'factor(1)', unit: '-', role: 'meta', description: "CONSTANT in this dataset: every sitting runs at the single ambient level, 'moderate' (300 lux, accepted band 250-350). Illumination was a two-level session factor in an earlier version of the protocol and the column is retained so the two are distinguishable; here it carries no variance and must not be entered in any model. The measured value is in lux_start / lux_mean." },
  { file: '01_session_info.csv', column: 'protocol_pass', type: 'integer', unit: 'count', role: 'qc', description: "Complete passes through the ten conditions this participant had already finished when this sitting began. 0 for every sitting of the study as designed. 1 or more means this sitting is a REPEAT: the participant re-read every passage, repeated every visual search and saw every comprehension question again, so reading time, comprehension score and search time on those rows are second-exposure values. Exclude or model those participants; do not pool the two passes as independent observations. Blank for sittings recorded before this was captured, which were all first passes." },
  { file: '01_session_info.csv', column: 'sitting_split_reason', type: 'text', unit: '-', role: 'qc', description: "Why the researcher split this participant's conditions across two sittings. Required by the console before a split can start, so it is recorded at the moment of the decision. Blank for a single sitting. READ IT BEFORE POOLING: if splits were granted because a participant looked tired, fatigue exposure varies between people for a reason correlated with the outcome, and that is a covariate rather than a free choice." },
  { file: '01_session_info.csv', column: 'repeat_run_note', type: 'text', unit: '-', role: 'qc', description: 'Why the researcher ran a participant who had already completed the protocol. Required by the console before a repeat sitting can start, so it is recorded at the moment of the decision. Blank when protocol_pass is 0.' },
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
  { file: '15_media_inventory.csv', column: 'condition_id', type: 'string', unit: 'uuid', role: 'id', description: 'For a reading segment, the condition it filmed: join to 07_eye_metrics.csv on this to compare the manual coding with the automated measure of the SAME exposure. A segment is kept only when its reading run completed, and replaces any earlier segment of the same condition, so there is at most one per condition. Blank for setup stills, and for segments stored before this column existed (use condition_label, which occurs once per sitting).' },
  { file: '15_media_inventory.csv', column: 'checksum_fnv1a', type: 'string', unit: '-', role: 'provenance', description: 'FNV-1a over the file bytes. Confirms a given file is the one this session recorded and has not been altered or swapped.' },
  { file: '15_media_inventory.csv', column: 'blob_present', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the media file itself is still on this device. False after a session is restored from a backup, which carries the inventory row but not the binary. A false here means the checksum and byte count describe a file you no longer hold.' },
  { file: '15_media_inventory.csv', column: 'consent_annotation_video', type: 'boolean', unit: '-', role: 'qc', description: 'The consent state in force when this item was captured, snapshotted onto the record so a file can never be separated from its permission.' },

  // ---- 02_conditions.csv
  { file: '02_conditions.csv', column: 'session_id', type: 'string', unit: '-', role: 'id', description: 'The sitting this condition ran in. Without it a pooled dataset has no key path from a condition row to its ambient illumination level, and a join on participant_id + condition_label is unique per participant under the single-sitting protocol, but was NOT under the earlier two-block design and would silently double-count in a pooled file.' },
  { file: '02_conditions.csv', column: 'session_index', type: 'integer', unit: 'count', role: 'qc', description: 'Which sitting this condition ran in. Normally 1: the ten conditions run in a single sitting. Greater than 1 only where the sitting was split for scheduling, which is a packaging difference and not an experimental factor.' },
  { file: '02_conditions.csv', column: 'session_position', type: 'integer', unit: '0-9', role: 'covariate', description: 'Serial position within the illumination BLOCK, 0-based — on a split sitting the second sitting continues the numbering rather than restarting, so this is not the position within the sitting. Enter in models: absorbs the vigilance decrement and fatigue accumulation.' },
  { file: '02_conditions.csv', column: 'adaptation_ms_before', type: 'integer', unit: 'ms', role: 'covariate', description: "Grey-field adaptation actually in front of the participant before this condition, in milliseconds (time the tablet was hidden, in portrait, or behind a notice is excluded). The field is PARTICIPANT-PACED: from adaptation_ms_min the participant may tap Continue, and it ends by itself at adaptation_ms_planned. So this length was chosen by the participant — it can relate to fatigue or to how the previous condition felt — and is a covariate to model or report by condition, not a controlled variable. The FIRST condition of a sitting also gets a grey field, so a session_position=0 row carries a normal value; 0 here means the field was not delivered. Rows from builds before the field was participant-paced ran a fixed 60 s, or 120 s across a polarity switch." },
  { file: '02_conditions.csv', column: 'passage_repeat_number', type: 'integer', unit: 'count', role: 'covariate', description: "How many times this participant has read this passage under the PLANNED protocol, counting this run. 1 for every row of a participant's first pass through the ten conditions; 2 or more when the whole protocol was run again (see protocol_pass in 01_session_info.csv). It was derived from the illumination block, which is clamped to the number of levels in the design and so stayed at 1 through a complete replay; it is now derived from protocol_pass. It still does NOT count an unplanned re-reading of a single condition after an interruption: use attempt_number for that." },
  { file: '02_conditions.csv', column: 'adaptation_ms_planned', type: 'integer', unit: 'ms', role: 'qc', description: "The MAXIMUM grey field before this condition: 60,000 ms normally, 120,000 ms across a polarity switch. The field ends by itself here if the participant has not continued. Blank for rows written before this was recorded." },
  { file: '02_conditions.csv', column: 'adaptation_ms_min', type: 'integer', unit: 'ms', role: 'qc', description: "The MINIMUM grey field before the participant was offered Continue (30,000 ms). Chosen by the investigator as a judgement on modest evidence: after a step down the pupil redilates gradually over many seconds, shown across a 20 s dark phase (Mathôt 2018, J Cogn 1(1):16) and foveal light adaptation at photopic levels settles in 10-15 s (Hayhoe, Levin & Koshel 1992, Vision Res 32(2):323-33). The integrity audit checks delivered time against this. Blank for rows from builds with a fixed field." },
  { file: '02_conditions.csv', column: 'adaptation_ended_by', type: 'factor(2)', unit: '-', role: 'qc', description: "participant = tapped Continue after the minimum; timer = the field reached its maximum. Blank for rows from builds with a fixed field, and for a first condition reached without a field." },
  { file: '02_conditions.csv', column: 'condition_hidden_ms', type: 'integer', unit: 'ms', role: 'qc', description: "Milliseconds the app spent in the background at any point during this condition — the participant switched apps, a notification took the screen, or the tablet slept. 0 is the expected value. This is not only lost time: a hidden tab has its timers and animation frames throttled, so anything measured against a clock while hidden measures the throttling. That covers the visual-search limit, every response time, and the reaction-time block, whose one-second trials and one-second response windows turn into misses and lapses that describe the device rather than the participant. Treat a non-zero value as grounds to exclude this row's timing measures, and see reading_hidden_ms for the reading exposure specifically. Blank for rows written before this was captured or never completed." },
  { file: '02_conditions.csv', column: 'condition_portrait_ms', type: 'integer', unit: 'ms', role: 'qc', description: "Milliseconds this condition spent with the tablet in PORTRAIT. 0 is the expected value. This is NOT covered by condition_hidden_ms: rotating does not fire a visibility change, the page stays visible so nothing is throttled, and the blocking overlay the app shows is drawn OVER the running task rather than replacing it — so the task keeps running while the participant cannot reach it. A rotation during the reaction-time block turns go trials into misses that look exactly like inattention; during visual search it burns the time limit; during reading it inflates the exposure the ocular measures are counted over. Treat a non-zero value as grounds to exclude this row's timing and performance measures." },
  { file: '02_conditions.csv', column: 'condition_portrait_events', type: 'integer', unit: 'count', role: 'qc', description: 'How many separate times the tablet was rotated to portrait during this condition. One long rotation and six brief ones cost the same milliseconds and mean different things. Blank when condition_portrait_ms is blank.' },
  { file: '02_conditions.csv', column: 'condition_notice_ms', type: 'integer', unit: 'ms', role: 'qc', description: "Milliseconds the 'camera has stopped' notice covered this condition. The task kept running underneath, as it does behind the portrait overlay, so this time is inside the condition's reading, search and adaptation clocks. Above the same limit as condition_hidden_ms it marks the condition interrupted. Blank on rows recorded before it existed." },
  { file: '02_conditions.csv', column: 'condition_notice_events', type: 'integer', unit: 'count', role: 'qc', description: 'How many times the camera-lost notice went up during this condition.' },
  { file: '02_conditions.csv', column: 'stimulus_scale_changes', type: 'integer', unit: 'count', role: 'qc', description: 'How many times the display scale changed while this condition was on screen. The scale is frozen during a condition and may only shrink, if the screen genuinely got smaller, so content stays reachable; it never grows under a reader. 0 in a normal run. Above 0, stimulus_scale describes the start of the condition only. Blank on rows recorded before this was kept.' },
  { file: '02_conditions.csv', column: 'condition_monitor_open_ms', type: 'integer', unit: 'ms', role: 'qc', description: "Milliseconds the researcher panel (live camera readout and clock) was OPEN on screen during this condition. It opens only when the researcher taps it or has chosen to keep it open, is drawn in the condition's own ink, and never covers the passage — but it is a live readout the participant can see, so its presence is recorded rather than assumed harmless. 0 in a normal run. Blank on rows recorded before the panel existed." },
  { file: '02_conditions.csv', column: 'condition_monitor_open_events', type: 'integer', unit: 'count', role: 'qc', description: 'How many times the researcher panel was opened during this condition.' },
  { file: '02_conditions.csv', column: 'reading_monitor_open_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'The part of condition_monitor_open_ms that fell inside the reading exposure itself, where the blink measures come from. A sensitivity analysis on the primary outcome can drop rows where this is above 0.' },
  { file: '02_conditions.csv', column: 'condition_hidden_events', type: 'integer', unit: 'count', role: 'qc', description: 'How many separate times the app went to the background during this condition. One long absence and six brief ones cost the same milliseconds and mean different things: the first is an interruption, the second is a participant repeatedly attending to something else. Blank when condition_hidden_ms is blank.' },
  { file: '02_conditions.csv', column: 'stimulus_scale', type: 'number', unit: 'factor', role: 'qc', description: "The root scale factor THIS condition's stimuli were presented at, read when the condition started. Scaling the root scales the stimulus text, so this factor is the visual angle the condition was run at; 1.0 is the design canvas and the app never magnifies above it. The session-level stimulus_scale in 01_session_info.csv is stamped once inside session creation, before the participant has touched the tablet, and can differ from what was actually shown — use this column for anything about visual angle. A value of exactly 0.5 is the floor: the viewport could not fit the canvas even there, OR — in builds before the scale was re-measured between screens — the scale had locked small on a screen that could show it larger (layout_viewport then shows a full-size screen). Either way the reading text was half its design size; the integrity audit flags it as stimulus_at_min_scale. Originally: the viewport could not fit the design canvas at all, so screens were clipped. Blank for rows written before this was captured." },
  { file: '02_conditions.csv', column: 'layout_viewport', type: 'text', unit: 'px', role: 'qc', description: "The viewport in CSS pixels, as WxH, that this condition's scale was computed from — the smallest seen in the current orientation, which is the box the layout was fitted to. Distinct from screen_resolution, which describes the physical panel whether or not browser chrome is covering part of it. Blank for rows written before this was captured." },
  { file: '02_conditions.csv', column: 'attempt_number', type: 'integer', unit: 'count', role: 'qc', description: "How many times this condition was started, counting the one this row describes. 1 for a clean run. Above 1 means the condition was restarted after a pause or a crash, so the participant had already read this passage, already found the search target and already seen the comprehension questions — reading time, comprehension and search time on this row are second-exposure values. Exclude or model these rows; do not assume passage_repeat_number covers them. Blank for rows written before this was recorded." },
  { file: '02_conditions.csv', column: 'condition_complete', type: 'boolean', unit: '-', role: 'qc', description: "TRUE when this condition-run FINISHED — its reaction-time block completed and stamped completed_at. FALSE for a condition that was started and not finished: paused, crashed or abandoned part-way. The Pause dialog tells the operator such a condition 'will be restarted on resume'; if the sitting was never resumed, its partial rows stay in every file of this bundle, and nothing else here says so. Later stages of such a run are empty and the ones present describe a run that did not end: it is NOT a measurement of its condition. Filter on this before modelling anything from this bundle." },
  { file: '10_wide_summary.csv', column: 'condition_complete', type: 'boolean', unit: '-', role: 'qc', description: 'Whether this condition-run finished. See 02_conditions.csv. A FALSE row carries partial values and is not a measurement of its condition.' },
  { file: '10_wide_summary.csv', column: 'attempt_number', type: 'integer', unit: 'count', role: 'qc', description: 'How many times this condition was started, counting this run. Above 1: reading, comprehension and search on this row are second-exposure values. See 02_conditions.csv.' },
  { file: '12_quality_flags.csv', column: 'condition_complete', type: 'boolean', unit: '-', role: 'qc', description: 'Whether this condition-run finished. The other flags on a FALSE row describe a run that did not end — a missing reaction-time block, for instance, is not evidence about the participant. See 02_conditions.csv.' },
  { file: '12_quality_flags.csv', column: 'attempt_number', type: 'integer', unit: 'count', role: 'qc', description: 'How many times this condition was started, counting this run. See 02_conditions.csv.' },
  { file: '02_conditions.csv', column: 'reading_time_ms', type: 'integer', unit: 'ms', role: 'dv', description: 'Self-paced reading duration. This is also the ocular-metrics exposure window.' },
  { file: '02_conditions.csv', column: 'reading_wall_clock_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Unadjusted first-to-last span of the reading task, before hidden time was subtracted. reading_time_ms is this minus reading_hidden_ms; both are exported so the adjustment is auditable rather than silent.' },
  { file: '02_conditions.csv', column: 'reading_hidden_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Time the app spent backgrounded or the screen off during the passage. Already subtracted from reading_time_ms. Large values mean the participant was not looking at the stimulus for part of the window the ocular measures cover.' },
  { file: '02_conditions.csv', column: 'reading_min_page_dwell_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Shortest single-page dwell in the passage. A page advanced within about a second of its own 20 s unlock was '
      + 'waited out, not read — which the whole-passage skim rule could not detect, because the four unlocks guarantee 80 s '
      + 'against a skim floor of 86-90 s. WALL CLOCK: unlike reading_time_ms beside it, no hidden time is subtracted from '
      + 'this, so a page the participant was away for looks longer rather than shorter. The direction is conservative — an '
      + 'interrupted page cannot masquerade as a waited-out one — but the two columns are on different clocks and a '
      + 'difference between them is not evidence of anything on its own. Use condition_hidden_ms to tell them apart.' },
  { file: '02_conditions.csv', column: 'reading_speed_wpm', type: 'integer', unit: 'words/min', role: 'dv', description: 'Derived: passage word count / reading_time_ms. Word counts are computed from the passage text, not declared.' },

  // ---- 03_fatigue_scores.csv
  { file: '03_fatigue_scores.csv', column: 'stage', type: 'factor', unit: '-', role: 'id', description: 'baseline (once per session) or post_condition (once per condition).' },
  { file: '03_fatigue_scores.csv', column: 'fatigue_mean', type: 'number', unit: '0-10', role: 'dv', description: 'Mean of the five visual-fatigue VAS items. Ordinal — model with a cumulative-link model, not OLS.' },
  { file: '03_fatigue_scores.csv', column: 'all_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Every slider was moved. False means at least one item kept its default and the record is suspect.' },
  { file: '03_fatigue_scores.csv', column: 'response_time_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Time from screen mount to submit. Implausibly fast = careless responding.' },

  // ---- 07_eye_metrics.csv
  { file: '07_eye_metrics.csv', column: 'incomplete_blink_ratio', type: 'number', unit: '0-1', role: 'primary', description: "THE PRIMARY OUTCOME. Incomplete blinks / all detected blinks, during reading. A bounded proportion: model on the logit scale or with a beta/binomial mixed model. HOW THE CLASSIFICATION IS MADE, because it bears on what this column can support: a blink is registered when the eye aspect ratio falls below 0.75 of the participant's own open-eye baseline and counted COMPLETE when it falls below 0.60. Baseline normalisation and the 0.75 registration cut each have published precedent; the 0.60 completeness cut has NONE — docs/LITERATURE_VALIDATION.md searched for it and found no validation of that separation for webcam EAR at any baseline fraction, and every retrieved study classifying blink completeness against a reference standard uses a different signal (near-infrared segmentation, keratograph, high-speed infrared, or a masked clinical observer). Incomplete blinks are also the harder class even with far better instrumentation. Treat the ratio as a within-study relative measure, not as a value comparable to published incomplete-blink proportions, and state the classifier limitation in any write-up." },
  { file: '07_eye_metrics.csv', column: 'fps_adequate_for_ratio', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the achieved frame rate (>=30 fps) supports the primary outcome. Below it, the sampled minimum EAR is biased upward and incomplete_blink_ratio is inflated — a directional bias, not symmetric noise. Conditions are flagged, never dropped, because frame rate covaries with room brightness, which is held constant by protocol rather than manipulated.' },
  { file: '07_eye_metrics.csv', column: 'observed_duration_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Milliseconds of the reading exposure actually observed by the camera, dropouts excluded. COMPARE THIS TO reading_time_ms in 02_conditions.csv: a large shortfall means the camera stopped part-way, and every rate in this row then describes only the fraction that was seen — the rates themselves look entirely normal, because they are computed over the samples that exist.' },
  { file: '07_eye_metrics.csv', column: 'open_ear_measured', type: 'number', unit: 'ratio', role: 'qc', description: "This condition's own open-eye eye-aspect ratio, by the same 90th-percentile estimator that produced ear_baseline. ear_baseline is fitted once before the sitting and every threshold in every condition is a fraction of it, while the open eye itself drifts downward over ninety minutes with ocular fatigue — so a fixed complete-closure cut relabels genuinely incomplete blinks as complete, and does so more at the end of the sitting than at the start. Divide by ear_baseline to see that drift: values below 1 mean incomplete_blink_ratio on this row is conservative. Null when fewer than 30 usable frames. The recorded outcome is NOT corrected by this column; it is here so the drift can be modelled rather than absorbed." },
  { file: '07_eye_metrics.csv', column: 'ear_sample_count', type: 'integer', unit: 'count', role: 'qc', description: 'EAR samples behind this row. Zero means nothing was measured, whatever the other columns show.' },
  { file: '07_eye_metrics.csv', column: 'blink_rate', type: 'number', unit: 'blinks/min', role: 'dv', description: 'All detected blinks per minute. Secondary: rate alone is a poor fatigue index, since it falls during reading on any medium and can hold steady while completeness degrades.' },
  { file: '07_eye_metrics.csv', column: 'effective_fps', type: 'number', unit: 'frames/s', role: 'qc', description: "Achieved sampling rate OF THE EAR SERIES — the frames in which a face was actually solved, not the frames the pipeline processed. A camera running at 30 fps whose face solves in 60% of frames reports about 18 here, and that is the correct number to gate the primary outcome on, because the ratio is counted in that series. It is not the camera frame rate. Below ~25 the duration-based metrics are sub-Nyquist; proportion measures remain valid." },
  { file: '07_eye_metrics.csv', column: 'fps_adequate_for_tiers', type: 'boolean', unit: '-', role: 'qc', description: 'effective_fps >= 25. Gate duration-based blink metrics on this.' },
  { file: '07_eye_metrics.csv', column: 'perclos_p80', type: 'number', unit: '0-1', role: 'covariate', description: 'Proportion of time eyes >80% closed. A SLEEPINESS covariate, never a visual-fatigue outcome — it is insensitive in moderate drowsiness.' },
  { file: '07_eye_metrics.csv', column: 'face_presence_ratio', type: 'number', unit: '0-1', role: 'qc', description: `Fraction of frames with a detected face. Pilot gate: >= ${FACE_PRESENCE_PILOT_GATE} in at least 90% of condition-runs.` },
  { file: '07_eye_metrics.csv', column: 'ear_baseline', type: 'number', unit: 'ratio', role: 'qc', description: 'Per-participant open-eye eye-aspect-ratio from calibration. All blink thresholds are relative to this.' },
  { file: '07_eye_metrics.csv', column: 'head_pitch_calibrated', type: 'boolean', unit: '-', role: 'qc', description: 'True when head_pitch_mean is relative to the participant\'s own frontal posture rather than a population default.' },

  // ---- 09_rt_summary.csv
  { file: '09_rt_summary.csv', column: 'mean_rt_hits_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean RT for correct go responses, excluding anticipations (<150 ms).' },
  { file: '09_rt_summary.csv', column: 'rt_cv', type: 'number', unit: 'ratio', role: 'dv', description: 'RT coefficient of variation. One of the two most fatigue-sensitive indices.' },
  { file: '09_rt_summary.csv', column: 'lapse_rate', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of valid hits slower than 600 ms. The other fatigue-sensitive index.' },
  { file: '09_rt_summary.csv', column: 'd_prime', type: 'number', unit: 'z units', role: 'dv', description: `Signal-detection sensitivity. Unstable at low trial counts — model hierarchically; check d_prime_unstable. ${RATE_CORRECTION_NOTE}` },
  { file: '09_rt_summary.csv', column: 'd_prime_estimable', type: 'boolean', unit: '-', role: 'qc', description: "FALSE when one of the two trial pools was empty, so sensitivity could not be estimated at all — distinct from an estimate that is merely imprecise, which is what d_prime_unstable reports. It is recorded on every block and was being dropped from this file, leaving an empty d_prime cell to mean either 'unestimable' or 'not written'. The case is real: every no-go trial scored as an anticipation (RT under 150 ms) empties the noise pool, and a rhythmically-tapping, disengaged participant is the phenotype this task exists to detect." },
  { file: '09_rt_summary.csv', column: 'd_prime_unstable', type: 'boolean', unit: '-', role: 'qc', description: "Set when the standard error of d-prime exceeds 0.3, i.e. the per-condition estimate is too imprecise to compare directly. With 20 signal and 12 noise trials the smallest achievable SE is about 0.46, so this is TRUE for every possible block: per-condition d-prime must be modelled hierarchically, not read row by row. It does NOT mean a rate hit a bound and was corrected — an earlier version of this line said so, and it does not describe the code." },

  // ---- 10_wide_summary.csv
  { file: '10_wide_summary.csv', column: 'fatigue_delta', type: 'number', unit: '-10-10', role: 'dv', description: 'post_condition fatigue_mean minus the session baseline: SIGNED, positive = worse than baseline, negative = better. It was declared 0-10, which made every improvement count as out of range in the manifest. Rounded to 4 dp for presentation.' },
  { file: '12_quality_flags.csv', column: 'blink_count_total', type: 'integer', unit: 'count', role: 'qc', description: 'Blinks captured during the condition. The incomplete-blink ratio is a binomial proportion, so its precision depends entirely on this.' },
  { file: '12_quality_flags.csv', column: 'insufficient_blinks', type: 'boolean', unit: '-', role: 'qc', description: 'TRUE when fewer than 20 blinks were captured, at which point the incomplete-blink ratio for that condition is too imprecise to interpret (SE >= 0.082 at p=0.16). Flagged, not dropped — down-weight or exclude in a sensitivity analysis.' },
  { file: '10_wide_summary.csv', column: 'engagement_flag', type: 'factor(3)', unit: '-', role: 'qc', description: 'good | warn | bad. Sensitivity analyses should be run with and without "bad".' },
  { file: '10_wide_summary.csv', column: 'quality_score', type: 'number', unit: '0-1', role: 'qc', description: 'Composite data-quality score for the condition-run.' },

  // ---- 13_cvsq.csv
  { file: '13_cvsq.csv', column: 'frame', type: 'factor(2)', unit: '-', role: 'provenance', description: "The recall frame the participant was given. 'habitual_computer_work' is the validated CVS-Q frame, whose frequency anchors are defined in events per week (occasionally = sporadic or about once a week; often/always = 2-3 times a week to almost every day) and against which the >= 6 cut-off is calibrated. 'this_session' is a deliberate re-anchoring to the ~90-minute exposure and is a DOCUMENTED DEVIATION: its total must not be read against the published cut-off or against published norms, and a baseline-to-close difference is a difference between two different questions. See docs/LITERATURE_VALIDATION.md." },
  { file: '13_cvsq.csv', column: 'total_score', type: 'integer', unit: '0-32', role: 'dv', description: 'CVS-Q total. The KEY SECONDARY outcome is the session_end minus baseline change. Cut-off 6 for symptomatic.' },
  { file: '13_cvsq.csv', column: 'freq_1..16', type: 'integer', unit: '0-2', role: 'dv', description: 'Per-item frequency: 0 never, 1 occasionally, 2 often/always.' },
  { file: '13_cvsq.csv', column: 'intensity_1..16', type: 'integer', unit: '0-2', role: 'dv', description: 'Per-item intensity: 1 moderate, 2 intense; 0 when frequency is 0.' },

  // ---- 14_nasa_tlx.csv
  { file: '14_nasa_tlx.csv', column: 'raw_tlx', type: 'number', unit: '0-100', role: 'dv', description: 'Unweighted mean of the six subscales AS MARKED. Performance is anchored Perfect(0) to Failure(100), so it already points in the load direction and is NOT reversed; reversing it flips the sign of one subscale in six. Session-level: ONE rating per participant, describing the sitting as a whole. It cannot be attributed to polarity or colour, since both vary within the sitting, and with a single illumination level it carries no within-participant contrast either. Treat it as a descriptive session-level index, not an outcome to contrast.' },
  { file: '14_nasa_tlx.csv', column: 'performance', type: 'number', unit: '0-100', role: 'dv', description: 'RAW response. Anchored Perfect(0) to Failure(100), so LOW means good performance.' },

  // ---------------------------------------------------------------------------------------
  // Completion pass. Every exported column is documented; scripts/buildCodebook.ts enforces
  // the correspondence in both directions so a new column cannot ship undescribed.
  // ---------------------------------------------------------------------------------------
  { file: '01_session_info.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '02_conditions.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '03_fatigue_scores.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '04_comprehension.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '05_visual_search.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '06_display_perception.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '07_eye_metrics.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '08_reaction_trials.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '09_rt_summary.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '10_wide_summary.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '11_participant.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '12_quality_flags.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Join key for this row, matching 02_conditions.csv and every other per-condition table. Join on THIS, never on participant_id + condition_label: a label repeats across sittings, and without this column the per-condition quality signals in this file could not be attached to the modelling frame at all.' },
  { file: '12_quality_flags.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '13_cvsq.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '14_nasa_tlx.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '15_media_inventory.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '16_integrity_report.csv', column: 'participant_id', type: 'string', unit: '-', role: 'id', description: 'De-identified participant code. Join key across every file in the bundle. The PROTOCOL REQUIRES that it carry no identifying information — no name, initials or roll number — and the link to the enrolment record is held separately. The app validates only the character class, not the content: this is a requirement on the operator, not a guarantee the software can make.' },
  { file: '02_conditions.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '03_fatigue_scores.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '04_comprehension.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '05_visual_search.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '06_display_perception.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '07_eye_metrics.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '08_reaction_trials.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '09_rt_summary.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'Unique key for one condition-run (one display condition within one session). The grain of the repeated-measures design; join child tables on this.' },
  { file: '10_wide_summary.csv', column: 'session_index', type: 'integer', unit: 'count', role: 'qc', description: 'Which sitting this row came from. Normally 1: the ten conditions run in a single sitting. Greater than 1 only where the sitting was split for scheduling, which is a packaging difference and not an experimental factor.' },
  { file: '12_quality_flags.csv', column: 'session_index', type: 'integer', unit: 'count', role: 'qc', description: 'Which sitting this row came from. Normally 1: the ten conditions run in a single sitting. Greater than 1 only where the sitting was split for scheduling, which is a packaging difference and not an experimental factor.' },
  { file: '14_nasa_tlx.csv', column: 'session_index', type: 'integer', unit: 'count', role: 'qc', description: 'Which sitting this row came from. Normally 1: the ten conditions run in a single sitting. Greater than 1 only where the sitting was split for scheduling, which is a packaging difference and not an experimental factor.' },
  { file: '15_media_inventory.csv', column: 'session_index', type: 'integer', unit: 'count', role: 'qc', description: 'Which sitting this row came from. Normally 1: the ten conditions run in a single sitting. Greater than 1 only where the sitting was split for scheduling, which is a packaging difference and not an experimental factor.' },
  { file: '16_integrity_report.csv', column: 'session_index', type: 'integer', unit: 'count', role: 'qc', description: 'Which sitting this row came from. Normally 1: the ten conditions run in a single sitting. Greater than 1 only where the sitting was split for scheduling, which is a packaging difference and not an experimental factor.' },
  { file: '02_conditions.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '10_wide_summary.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '12_quality_flags.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '15_media_inventory.csv', column: 'condition_label', type: 'string', unit: '-', role: 'id', description: 'Condition code. P1-P5 positive polarity, N1-N5 negative. Same coding as 00_condition_reference.csv.' },
  { file: '10_wide_summary.csv', column: 'condition_id', type: 'string', unit: '-', role: 'id', description: 'The condition-run this summary row describes. Join on this, never on participant_id + condition_label: each label occurs twice per participant, once per illumination block.' },
  { file: '10_wide_summary.csv', column: 'session_position', type: 'integer', unit: '0-9', role: 'covariate', description: 'Serial position of the condition within the illumination BLOCK, 0-based. On a split sitting the second sitting continues the block numbering rather than restarting, so this is not the position within the sitting. Counterbalanced by a Williams square and entered as a covariate; a position effect is otherwise indistinguishable from a condition effect.' },
  { file: '12_quality_flags.csv', column: 'session_position', type: 'integer', unit: '0-9', role: 'covariate', description: 'Serial position of the condition within the illumination BLOCK, 0-based. On a split sitting the second sitting continues the block numbering rather than restarting, so this is not the position within the sitting. Counterbalanced by a Williams square and entered as a covariate; a position effect is otherwise indistinguishable from a condition effect.' },
  { file: '02_conditions.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: "Rotated against condition with a period coprime to the condition count, so PASSAGE x SERIAL POSITION is exactly uniform across the cohort. It is NOT orthogonal to display condition: 13 rotation offsets cannot reduce uniformly onto 10 conditions, so each condition meets three of the ten passages twice as often as the other seven (20 vs 10 at n=130). Verified, not assumed - see tests/counterbalance.test.ts. The residual leak onto the polarity contrast is small because the corpus is length- and difficulty-matched by construction, but it is structural and does not shrink with recruitment, so model the passage random intercept and do not treat passage as balanced against condition." },
  { file: '04_comprehension.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: "Rotated against condition with a period coprime to the condition count, so PASSAGE x SERIAL POSITION is exactly uniform across the cohort. It is NOT orthogonal to display condition: 13 rotation offsets cannot reduce uniformly onto 10 conditions, so each condition meets three of the ten passages twice as often as the other seven (20 vs 10 at n=130). Verified, not assumed - see tests/counterbalance.test.ts. The residual leak onto the polarity contrast is small because the corpus is length- and difficulty-matched by construction, but it is structural and does not shrink with recruitment, so model the passage random intercept and do not treat passage as balanced against condition." },
  { file: '05_visual_search.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: "Rotated against condition with a period coprime to the condition count, so PASSAGE x SERIAL POSITION is exactly uniform across the cohort. It is NOT orthogonal to display condition: 13 rotation offsets cannot reduce uniformly onto 10 conditions, so each condition meets three of the ten passages twice as often as the other seven (20 vs 10 at n=130). Verified, not assumed - see tests/counterbalance.test.ts. The residual leak onto the polarity contrast is small because the corpus is length- and difficulty-matched by construction, but it is structural and does not shrink with recruitment, so model the passage random intercept and do not treat passage as balanced against condition." },
  { file: '10_wide_summary.csv', column: 'passage_id', type: 'integer', unit: '0-9', role: 'covariate', description: "Rotated against condition with a period coprime to the condition count, so PASSAGE x SERIAL POSITION is exactly uniform across the cohort. It is NOT orthogonal to display condition: 13 rotation offsets cannot reduce uniformly onto 10 conditions, so each condition meets three of the ten passages twice as often as the other seven (20 vs 10 at n=130). Verified, not assumed - see tests/counterbalance.test.ts. The residual leak onto the polarity contrast is small because the corpus is length- and difficulty-matched by construction, but it is structural and does not shrink with recruitment, so model the passage random intercept and do not treat passage as balanced against condition." },
  { file: '00_condition_reference.csv', column: 'background_color', type: 'string', unit: 'hex', role: 'iv', description: 'Background colour as an sRGB hex triplet, exactly as rendered.' },
  { file: '00_condition_reference.csv', column: 'text_color', type: 'string', unit: 'hex', role: 'iv', description: 'Text colour as an sRGB hex triplet, exactly as rendered.' },
  { file: '00_condition_reference.csv', column: 'wcag_level', type: 'string', unit: '-', role: 'covariate', description: 'Accessibility band implied by the contrast ratio: AAA, AA, AA Large, or Fail. Descriptive; model the continuous ratio, not this band.' },
  { file: '01_session_info.csv', column: 'experiment_date', type: 'string', unit: 'ISO 8601', role: 'meta', description: 'Date the sitting was run. Session timing. Under the single-sitting protocol there is no between-visit spacing to check; retained for earlier two-visit data and for split sittings.' },
  { file: '01_session_info.csv', column: 'session_status', type: 'factor(2)', unit: '-', role: 'qc', description: 'in_progress or complete. An export may be taken at any time, including from a withdrawn or interrupted sitting, so this states whether the sitting actually finished. It does NOT say whether the participant withdrew: see withdrawn.' },
  { file: '01_session_info.csv', column: 'withdrawn', type: 'boolean', unit: '-', role: 'qc', description: 'TRUE means the PARTICIPANT WITHDREW from the study. Recording a withdrawal marks every sitting of that participant on the device, so each of their bundles carries it. Not a quality flag — a standing instruction: no row of this bundle, nor of any other bundle for the same participant_id, may be analysed, under any sensitivity analysis. The measurements are kept and exported so the withdrawal is auditable, which is what the participant agreed to when they withdrew without asking for deletion. This column used to be absent, so a withdrawn sitting exported CSVs identical to an ordinary paused one. The shipped R and Python templates drop every sitting of a participant with any withdrawn sitting before modelling, which also covers a sitting exported from another device before the withdrawal was recorded.' },
  { file: '01_session_info.csv', column: 'withdrawn_at', type: 'datetime', unit: 'ISO 8601', role: 'qc', description: 'When the withdrawal was recorded. Blank when the participant did not withdraw.' },
  { file: '01_session_info.csv', column: 'conditions_completed', type: 'integer', unit: 'count', role: 'qc', description: 'FINISHED condition-runs this export contains (condition_complete TRUE on 02_conditions.csv) — it used to count condition ROWS, which include a condition paused part-way. The export may contain more rows than this; the unfinished ones are flagged, not measurements. Below conditions_per_session the series is truncated and the remaining conditions were never presented.' },
  { file: '01_session_info.csv', column: 'session_complete', type: 'boolean', unit: '-', role: 'qc', description: 'True only when the sitting was closed, the participant did not withdraw, AND every planned condition FINISHED. Filter on this before pooling sittings: a truncated series is unbalanced with respect to the Williams order.' },
  { file: '01_session_info.csv', column: 'conditions_per_session', type: 'integer', unit: '5 or 10', role: 'meta', description: 'Conditions presented in this sitting. 10 is the whole illumination block in one sitting; 5 means the block was split in two under the feasibility gate.' },
  { file: '01_session_info.csv', column: 'ambient_lux', type: 'number', unit: 'lux', role: 'iv', description: 'Measured room illuminance at the participant eye position for this sitting. The manipulation CHECK for the single 300 lux level (accepted 250-350), NOT a factor: it should be constant by design, and a reading outside the band is a protocol deviation. Use this measured value rather than the nominal level.' },
  { file: '01_session_info.csv', column: 'brightness_percent', type: 'number', unit: '0-100', role: 'covariate', description: 'Display brightness setting. Held fixed across conditions; recorded so any drift between sittings is detectable.' },
  { file: '01_session_info.csv', column: 'app_version', type: 'string', unit: '-', role: 'provenance', description: 'Instrument version that produced this row. Changes to timing or scoring are tied to this.' },
  { file: '01_session_info.csv', column: 'git_hash', type: 'string', unit: '-', role: 'provenance', description: "Short commit hash of the build that STARTED this sitting. It is stamped once, at session creation. If build_changed_mid_sitting is TRUE it does not describe the whole sitting — read session_builds." },
  { file: '01_session_info.csv', column: 'build_changed_mid_sitting', type: 'boolean', unit: '-', role: 'qc', description: "TRUE when the sitting was resumed under a different build from the one that started it. A service worker can activate on its own once every window is closed, so a tablet that slept or rebooted mid-sitting can resume on new code with no operator action. Treat the conditions in such a sitting as collected by two instruments until you have checked what changed between the builds." },
  { file: '01_session_info.csv', column: 'session_builds', type: 'string', unit: '-', role: 'provenance', description: "Every distinct build hash that collected part of this sitting, oldest first, separated by '+'. Equals git_hash alone in the ordinary case. This is the evidence behind build_changed_mid_sitting." },
  { file: '01_session_info.csv', column: 'device_type', type: 'string', unit: '-', role: 'meta', description: 'Device the session ran on. Findings are device-specific, so this bounds generalisation.' },
  { file: '01_session_info.csv', column: 'screen_resolution', type: 'string', unit: 'px', role: 'meta', description: 'Viewport resolution in pixels. Affects line length and words per page.' },
  { file: '01_session_info.csv', column: 'stimulus_scale', type: 'number', unit: '0-1', role: 'covariate', description: 'Factor the interface was rendered at AT SESSION CREATION. The layout is authored on a fixed canvas and scaled down to fit a smaller screen, so a value below 1 means a smaller visual angle than the design size. This is stamped before the participant has touched the tablet and the scale can still settle elsewhere afterwards — if the setup screens were in portrait, or the address bar was still showing — so for anything about the visual angle of the STIMULUS use stimulus_scale in 02_conditions.csv, which is read per condition. Empty for sessions recorded before this was captured.' },
  { file: '01_session_info.csv', column: 'layout_viewport', type: 'string', unit: 'px', role: 'meta', description: 'The viewport the scale was fitted to, WxH in CSS pixels. Differs from screen_resolution, which is the physical panel and ignores space taken by the browser address bar.' },
  { file: '01_session_info.csv', column: 'consent_given', type: 'boolean', unit: '-', role: 'meta', description: 'Whether written informed consent was recorded before any measurement began.' },
  { file: '01_session_info.csv', column: 'preflight_complete', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the pre-session environment and device checks were completed. False indicates a session started outside protocol.' },
  { file: '01_session_info.csv', column: 'e2e_timing', type: 'boolean', unit: '-', role: 'qc', description: 'TRUE means this session ran under the end-to-end test harness, in which every protocol duration — reading floor, adaptation, search limit, reaction-time block — is collapsed to a token value. Such a row is a test artefact and must never be pooled with collected data.' },
  { file: '01_session_info.csv', column: 'stimulus_font_ok', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the vendored stimulus typeface (Roboto 400) was available when pre-flight ran. Empty where the browser gave no answer. False means the reading passage was rendered in a fallback face, which changes letter shape and stroke weight and so changes the display condition.' },
  { file: '01_session_info.csv', column: 'caffeine_today_session', type: 'boolean', unit: '-', role: 'covariate', description: "Caffeine in roughly the four hours before THIS sitting. Recorded per sitting because it varies between them; the participant record's copy is the first sitting's and must not be used as a per-session covariate." },
  { file: '01_session_info.csv', column: 'hours_since_sleep_session', type: 'float', unit: 'hours', role: 'covariate', description: 'Hours since waking, at THIS sitting. Per-sitting for the same reason as caffeine_today_session. Bears on blink rate and on the drowsiness covariates.' },
  { file: '01_session_info.csv', column: 'calibration_runs', type: 'integer', unit: 'count', role: 'qc', description: 'How many calibration records this sitting holds. More than one means calibration was retried within the routine or re-run on a resume; it does not by itself mean the sitting was interrupted. The calibration_* and gaze_* columns of this file describe the LAST one only. Which one governed each condition is calibration_id in 07_eye_metrics.csv, and per-condition ear_baseline there is what each condition actually used.' },
  { file: '01_session_info.csv', column: 'selftest_cued', type: 'integer', unit: 'count', role: 'qc', description: 'Camera self-test, run after calibration: how many times the dot flashed for the participant to blink (5). Blank when the camera was not used or the sitting predates the test. The last attempt is recorded.' },
  { file: '01_session_info.csv', column: 'selftest_detected', type: 'integer', unit: 'count', role: 'qc', description: 'How many of those cued blinks the tracker found within 1.2 s of the cue. The pass rule needs 4 of 5. An engineering check that the camera sees this participant\'s blinks — deliberate blinks are complete and slow — not a validation of incomplete-blink classification.' },
  { file: '01_session_info.csv', column: 'selftest_extra', type: 'integer', unit: 'count', role: 'qc', description: 'Blinks found during the self-test that matched no cue: spontaneous blinks, or false detections. Many extras with few hits suggests an unstable eye signal.' },
  { file: '01_session_info.csv', column: 'selftest_fps', type: 'number', unit: 'fps', role: 'qc', description: 'Face-solved frame rate during the self-test. Below 25 fails the test (the blink-rate tier floor; fps_adequate_for_tiers). A low value here predicts low effective_fps in every condition.' },
  { file: '01_session_info.csv', column: 'selftest_face_presence', type: 'number', unit: '0-1', role: 'qc', description: 'Share of self-test frames with a face in view. Below 0.9 fails the test.' },
  { file: '01_session_info.csv', column: 'selftest_pass', type: 'boolean', unit: '-', role: 'qc', description: 'The self-test verdict shown to the operator. FALSE means the operator chose "continue anyway": treat every blink measure of this sitting with caution and read the other selftest_ columns for why.' },
  { file: '01_session_info.csv', column: 'gaze_calibration_valid', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the nine-point gaze mapping met its acceptance criterion. When false, gaze columns are coarse-zone only and should not be treated as calibrated.' },
  { file: '01_session_info.csv', column: 'calibration_ear_baseline', type: 'number', unit: 'ratio', role: 'qc', description: 'Open-eye eye-aspect-ratio baseline for this participant, measured at centre fixation before the gaze targets, in the posture the reading task is performed in. Every blink threshold is expressed as a fraction of this, so it is referenced to the individual rather than a population default. Compare against open_ear_measured in 07_eye_metrics.csv for within-sitting drift.' },
  { file: '01_session_info.csv', column: 'calibration_pitch_baseline_frac', type: 'number', unit: 'ratio', role: 'qc', description: 'Frontal head-pose reference captured at calibration. Head-pose columns are relative to this when head_pitch_calibrated is true.' },
  { file: '01_session_info.csv', column: 'gaze_trust', type: 'factor(3)', unit: '-', role: 'qc', description: "How much evidence the gaze fit rests on: good (two thirds of targets tracked through at least half their dwell), thin (it met the acceptance rule but on very little data), unusable (the fit was rejected). gaze_calibration_valid is TRUE for both good and thin, so THIS is the column to filter gaze measures on. A thin calibration produces thresholds that are closer to noise than to measurement. Describes the sitting's LAST calibration: when calibration_runs > 1, filter per condition on the calibration named by calibration_id in 07_eye_metrics.csv, or on gaze_trust in analysis_long.csv, which is resolved per row." },
  { file: '01_session_info.csv', column: 'gaze_targets_well_covered', type: 'integer', unit: 'targets', role: 'qc', description: "How many of the nine targets were tracked through at least half their dwell, as opposed to merely registering at all. Read beside calibration_targets_detected: a large gap between them means most targets were caught only in passing." },
  { file: '01_session_info.csv', column: 'gaze_threshold_floored', type: 'boolean', unit: '-', role: 'qc', description: "TRUE when the fitted gaze threshold hit its minimum on either axis, so the threshold used is partly a floor rather than a measurement of this participant. It binds for a participant with limited gaze excursion or a distant camera, and when it does, classifications use a wider threshold than their eyes earned — which biases gaze_deviation_ratio DOWNWARD. Filter or model these sittings; before this column existed they could not be found." },
  { file: '01_session_info.csv', column: 'calibration_targets_detected', type: 'integer', unit: 'targets', role: 'qc', description: "How many of the nine calibration targets produced at least one usable sample. Counted on the same finite-filtered pool the calibration fit is judged on, so it cannot disagree with gaze_calibration_valid. Low values mean a poor camera setup for that sitting." },
  { file: '01_session_info.csv', column: 'calibration_ear_samples', type: 'integer', unit: 'count', role: 'qc', description: 'Frames of the dedicated centre-fixation baseline window that yielded a usable eye-aspect ratio, and so fed calibration_ear_baseline. The nine gaze targets contribute none — they move the eye through three vertical postures and the fissure is widest in up-gaze. Six seconds at 30 fps contributes ~180; a low value means the baseline every blink threshold is a fraction of rests on very little, and the ocular measures for that sitting should be treated with caution. Blank for sittings recorded before this was captured.' },
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
  { file: '05_visual_search.csv', column: 'search_target', type: 'string', unit: '-', role: 'meta', description: "Target word the participant was asked to tap. The search is over a one-screen EXCERPT of the condition's passage, not the whole passage: see targets_in_set." },
  { file: '05_visual_search.csv', column: 'targets_in_set', type: 'integer', unit: 'count', role: 'meta', description: `Number of target occurrences ON THE SEARCH SCREEN, computed with the same tokenisation the task uses; the denominator of accuracy_rate. The search shows a single screen at the reading font size — whole sentences, at most ${SEARCH_EXCERPT_MAX_WORDS} words, the stretch of the passage where its target word is densest — with no scrolling. It used to show the whole passage in a scroll box 2.5-2.7 screens tall with no scroll cue, so the share of targets visible without scrolling ranged from 1 of 10 to 12 of 12 by passage and search time partly measured discovering the scroll. BY INVESTIGATOR DECISION the counts now differ by passage, ${SEARCH_TARGET_MIN} to ${SEARCH_TARGET_MAX}: an equal count is not available from these texts in one screen (no content word exceeds 4-5 in the sparsest passages), and equalising at that floor was judged too coarse. Model passage (or this count) rather than assuming the rows are equally difficult.` },
  { file: '05_visual_search.csv', column: 'search_time_ms', type: 'number', unit: 'ms', role: 'dv', description: `Time spent on the search task. The ${CONFIG.VS_TIME_LIMIT_MS / 1000}-second limit is enforced by a timer, and a browser throttles `
      + 'timers while the app is in the background, so a block interrupted that way can exceed it — see '
      + 'condition_hidden_ms on 02_conditions.csv, which flags the condition though it cannot localise the absence '
      + 'to this task. Absent any interruption the limit holds.' },
  { file: '05_visual_search.csv', column: 'time_to_first_target_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Latency to the first correct tap. Null when nothing was found.' },
  { file: '05_visual_search.csv', column: 'targets_found', type: 'integer', unit: 'count', role: 'dv', description: 'Number of correct target taps. The numerator of accuracy_rate.' },
  { file: '05_visual_search.csv', column: 'targets_missed', type: 'integer', unit: 'count', role: 'dv', description: 'Targets present but never tapped.' },
  { file: '05_visual_search.csv', column: 'false_detections', type: 'integer', unit: 'count', role: 'dv', description: 'Non-target WORDS tapped — counted once each, however many times the participant tapped them, so that hits and false alarms in search_d_prime are counted in the same units. It formerly counted tap events, while a repeat tap on an already-found target was ignored, so a double-tapped wrong word contributed two false alarms for one word. A rise here with stable accuracy indicates a criterion shift rather than a sensitivity change.' },
  { file: '05_visual_search.csv', column: 'search_d_prime', type: 'number', unit: "d'", role: 'dv', description: "Sensitivity over WORDS as trials: targets found are hits, non-target words tapped are false alarms, the rest are correct rejections. Prefer this to accuracy_rate as the search outcome. accuracy_rate ignores false detections entirely, so a participant who taps every word finds all targets in seconds and scores 1.0 with an efficiency three times their own mean, while no quality flag fires; d-prime cannot be inflated that way. " + RATE_CORRECTION_NOTE },
  { file: '05_visual_search.csv', column: 'distractor_words', type: 'integer', unit: 'count', role: 'meta', description: "Non-target tappable tokens ON THE SEARCH SCREEN (the excerpt, not the whole passage): the correct-rejection pool behind search_d_prime. Tappable is the task's own definition — any non-whitespace token, so a standalone punctuation mark or a bare numeral is a trial the participant could have committed a false alarm on. That makes this a shade larger than the passage's word count (under 1%), and it is the right pool because it is the set of things that could be tapped. It formerly counted the whitespace runs too, because the renderer's tokeniser keeps them to preserve spacing — roughly doubling the value and shrinking every false-alarm rate accordingly." },
  { file: '05_visual_search.csv', column: 'search_d_prime_se', type: 'number', unit: "d'", role: 'qc', description: `Standard error of search_d_prime (the same formula as d_prime_se in 09_rt_summary.csv). With ${SEARCH_TARGET_MIN} to ${SEARCH_TARGET_MAX} target words per excerpt the signal pool is small, so this is large and varies by passage; weight by its inverse or model passage. Blank where search_d_prime is blank, and on records written before it was kept.` },
  { file: '05_visual_search.csv', column: 'accuracy_rate', type: 'number', unit: '0-1', role: 'dv', description: `targets_found divided by targets_in_set. NOT directly comparable across passages: targets_in_set ranges from ${SEARCH_TARGET_MIN} to ${SEARCH_TARGET_MAX} by passage, so this moves in steps of ${Math.round(100 / SEARCH_TARGET_MIN)}% in the sparsest and about ${Math.round(100 / SEARCH_TARGET_MAX)}% in the densest, and a passage with more targets is a longer task.` + ' The rotation spreads passages across conditions, but a model should carry passage (as a random effect) or targets_in_set, not treat the rows as equally difficult. This entry used to say the counts were held in a narrow band, which stopped being true when the search moved to a one-screen excerpt.' },
  { file: '05_visual_search.csv', column: 'search_efficiency', type: 'number', unit: 'hits/min', role: 'dv', description: 'Correct taps per minute. Combines speed and accuracy into one rate.' },
  { file: '05_visual_search.csv', column: 'mean_inter_target_interval_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Mean interval between successive correct taps. Rising within a block indicates slowing.' },
  { file: '05_visual_search.csv', column: 'termination_mode', type: 'factor(3)', unit: '-', role: 'qc', description: 'How the task ended: time_limit, voluntary_full (all targets '
      + 'found), or voluntary_early. Only voluntary_full makes search_time_ms a measurement: at time_limit and at voluntary_early the time to find every target was not observed, so both are right-censored. This entry previously '
      + 'documented a fourth level, session_terminated, that nothing can produce — a search abandoned part-way '
      + 'writes NO row at all, because the visual_search record is written from the completion handler, so an '
      + 'abandoned block is an ABSENT row rather than a marked one. Check for missing condition_ids, not for a '
      + 'termination level.' },
  { file: '06_display_perception.csv', column: 'display_comfort_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated comfort of the display in this condition, captured immediately after reading.' },
  { file: '06_display_perception.csv', column: 'text_clarity_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated clarity of the text in this condition, captured immediately after reading.' },
  { file: '06_display_perception.csv', column: 'comfort_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the comfort slider was actually moved. False means the value is the untouched default and should not be treated as a response.' },
  { file: '06_display_perception.csv', column: 'clarity_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the clarity slider was actually moved. False means the value is the untouched default.' },
  { file: '06_display_perception.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time from the rating screen appearing to submission. Very short values feed the rushed-response flag.' },
  { file: '07_eye_metrics.csv', column: 'camera_active', type: 'boolean', unit: '-', role: 'qc', description: 'Whether camera measurement ran for this condition. False when the participant declined camera consent or the camera failed; every ocular column is then missing rather than zero.' },
  { file: '07_eye_metrics.csv', column: 'camera_inactive_reason', type: 'factor(2)', unit: '-', role: 'qc', description: "Why camera_active is FALSE. lost = the camera had been running in this sitting and stopped (its track ended, or frames stopped arriving while the page was visible); the operator was stopped and offered a pause, which restarts the camera and the condition, and chose to continue instead or the condition ended first. not_running = the camera was not running for this condition and had not been lost since this stretch of the sitting began (consent declined, permission denied, unavailable, or skipped when the sitting was resumed — a resume starts the camera afresh, so a camera lost before a pause and not restarted after it reads not_running). Blank when camera_active is TRUE and on rows recorded before this column existed. A run of 'lost' rows is missing data with a known cause, not a participant choice." },
  { file: '07_eye_metrics.csv', column: 'camera_blocked_ms', type: 'integer', unit: 'ms', role: 'qc', description: "Time during this reading exposure that the camera image was black and flat — the lens covered, or camera access switched off in the tablet's quick settings, which gives apps a blank picture instead of stopping the camera. Such frames used to count as an active camera with no face in view. Above 0, the blink measures of this row rest on less of the exposure than observed_duration_ms suggests; the operator was shown a notice while it lasted. Blank on camera-off rows and rows recorded before this existed." },
  { file: '07_eye_metrics.csv', column: 'camera_muted_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Time the camera track reported itself muted (delivering no frames without stopping) during this exposure, e.g. while the app was in the background. Blank on camera-off rows and rows recorded before this existed.' },
  { file: '07_eye_metrics.csv', column: 'no_face_longest_ms', type: 'integer', unit: 'ms', role: 'qc', description: 'Longest continuous stretch of this exposure in which the camera could see but found no face (participant turned or leaned away, hand over the face). Read beside face_presence_ratio, which gives the total. Blank on camera-off rows and rows recorded before this existed.' },
  { file: '07_eye_metrics.csv', column: 'no_face_episodes', type: 'integer', unit: 'count', role: 'qc', description: 'How many stretches of 2 s or more had no face in an otherwise working camera image. Several short episodes and one long absence mean different things for the blink measures. Blank on camera-off rows and rows recorded before this existed.' },
  { file: '07_eye_metrics.csv', column: 'blink_rate_full', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Rate of FULL (complete) blinks only. Read alongside blink_rate: a stable total with a falling full rate is the composition shift the study is designed to detect.' },
  { file: '07_eye_metrics.csv', column: 'blink_count_incomplete', type: 'integer', unit: 'count', role: 'primary', description: 'NUMERATOR of the primary outcome: blinks in which the lid crossed the registration threshold but never reached full closure. Null when the camera was not running.' },
  { file: '07_eye_metrics.csv', column: 'blink_count_full', type: 'integer', unit: 'count', role: 'primary', description: 'Complete blinks. With blink_count_micro and blink_count_incomplete this gives the DENOMINATOR of incomplete_blink_ratio, which is what makes a binomial model of the primary outcome possible: a ratio from 8 blinks carries far less information than one from 60, and a Gaussian model of the naked proportion treats them as equal.' },
  { file: '07_eye_metrics.csv', column: 'blink_count_micro', type: 'integer', unit: 'count', role: 'primary', description: 'Complete but very brief blinks (< 40 ms). Part of the denominator of incomplete_blink_ratio.' },
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
  { file: '07_eye_metrics.csv', column: 'calibration_id', type: 'string', unit: 'uuid', role: 'id', description: 'The calibration this condition was measured under, as calibration_id in the calibration records. A sitting holds more than one when calibration was retried or the sitting was resumed; the calibration_* and gaze_trust columns of 01_session_info.csv describe only the LAST, so join on this to get the fit that governed THIS row. Blank when the camera was not running, and on rows recorded before this column existed.' },
  { file: '07_eye_metrics.csv', column: 'gaze_deviation_ratio', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of frames with gaze away from the reading region. Interpretable only when gaze_calibrated is true.' },
  { file: '07_eye_metrics.csv', column: 'zone_center_ratio', type: 'number', unit: '0-1', role: 'dv', description: 'Proportion of frames with gaze in the central reading zone.' },
  { file: '07_eye_metrics.csv', column: 'zone_transition_count', type: 'integer', unit: 'count', role: 'dv', description: 'Number of transitions between gaze zones. A coarse scanning-activity index.' },
  { file: '07_eye_metrics.csv', column: 'face_size_ratio', type: 'number', unit: 'ratio', role: 'qc', description: 'Detected face size relative to frame. A viewing-distance proxy; a large change between conditions means the participant moved.' },
  { file: '07_eye_metrics.csv', column: 'mean_face_luma', type: 'number', unit: '0-255', role: 'qc', description: 'Mean frame luminance over the condition, BT.601. Camera exposure and room-light quality control.' },
  { file: '07_eye_metrics.csv', column: 'lighting_quality', type: 'factor(3)', unit: '-', role: 'qc', description: 'Classified capture lighting: low, good or overexposed. Null when the camera was inactive. Rows outside good warrant a sensitivity check.' },
  { file: '08_reaction_trials.csv', column: 'trial_number', type: 'integer', unit: '1-32', role: 'id', description: 'Position of the trial within the condition block.' },
  { file: '08_reaction_trials.csv', column: 'trial_category', type: 'factor(2)', unit: '-', role: 'iv', description: "Trial type as presented. The LEVELS ARE 'signal' and 'noise' — this entry used to name them 'go' and 'no-go', which is the spoken description of the task and not what the column contains, so a filter on \"go\" returned no rows at all. Signal is the go-target — this condition's own text colour — and noise is a dot in one of the other text colours of the same polarity; stimulus_color says which." },
  { file: '08_reaction_trials.csv', column: 'stimulus_color', type: 'string', unit: 'hex', role: 'iv', description: "The colour of the dot on this trial. The reaction-time block runs IN the condition's display: the go-target is the condition's own text colour on its own background, and the no-go dots are the other four text colours of that polarity, so the rule is constant (tap the dot that matches the text) while the colour it picks out changes. Recorded per trial because what was on screen can no longer be reconstructed from a constant, and because no-go difficulty now varies with the distractor: a false alarm to a 2.39:1 yellow dot on white is not the same event as one to a 21:1 black dot. This REPLACED an achromatic go-target (black on light, white on dark) by investigator decision; RT therefore partly reflects the visibility of the condition's colour and is not a display-independent attention probe. Blank for trials recorded before this column existed." },
  { file: '08_reaction_trials.csv', column: 'is_signal', type: 'boolean', unit: '-', role: 'iv', description: 'True on go trials. Signal and noise trials must both be present for sensitivity to be estimable.' },
  { file: '08_reaction_trials.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Latency from stimulus onset to response. Null when no response was made.' },
  { file: '08_reaction_trials.csv', column: 'accuracy', type: 'factor(5)', unit: '-', role: 'dv', description: "hit, miss, false_alarm, correct_rejection, or anticipation. An ANTICIPATION is a response faster than the 150 ms cutoff, which cannot reflect stimulus processing; it is its own level rather than a hit or a false alarm, and it is excluded from both signal-detection pools and from error_rate. Scoring anticipations as detections credited participants who had stopped watching, and the credit was largest exactly where disengagement was greatest. A latency outside [0, the response window] is a clock fault rather than a measurement, so the trial is recorded with a null response_time_ms, false_start true, and — on a go trial — accuracy 'miss'. The participant may well have responded; what is asserted is that the timing cannot be trusted. Those trials therefore lower hit_rate and raise error_rate, so check false_start before reading a low sensitivity as inattention." },
  { file: '08_reaction_trials.csv', column: 'anticipatory', type: 'boolean', unit: '-', role: 'qc', description: 'Response faster than the anticipation cutoff. Excluded from reaction-time means and counted separately, because it reflects guessing rather than detection.' },
  { file: '08_reaction_trials.csv', column: 'false_start', type: 'boolean', unit: '-', role: 'qc', description: 'Response made before the stimulus appeared.' },
  { file: '09_rt_summary.csv', column: 'total_trials', type: 'integer', unit: 'count', role: 'meta', description: 'Trials recorded in the block.' },
  { file: '09_rt_summary.csv', column: 'signal_trials', type: 'integer', unit: 'count', role: 'meta', description: "Go trials that were SCORED — hits plus misses. It is hit_rate's denominator, which is why it excludes anticipations, and it is therefore NOT the number of go trials presented. Do not derive the no-go count as total_trials minus this: with five anticipations on go trials a 32-trial block reports 15 here, and that subtraction gives 17 where 12 were shown. Sensitivity is not estimable when this is zero, which is what a participant whose every response fell inside the anticipation cutoff produces." },
  { file: '09_rt_summary.csv', column: 'hits', type: 'integer', unit: 'count', role: 'dv', description: 'Correct responses on go trials.' },
  { file: '09_rt_summary.csv', column: 'false_alarms', type: 'integer', unit: 'count', role: 'dv', description: 'Responses on no-go trials.' },
  { file: '09_rt_summary.csv', column: 'misses', type: 'integer', unit: 'count', role: 'dv', description: 'Go trials with no response.' },
  { file: '09_rt_summary.csv', column: 'correct_rejections', type: 'integer', unit: 'count', role: 'dv', description: 'No-go trials correctly withheld.' },
  { file: '09_rt_summary.csv', column: 'hit_rate', type: 'number', unit: '0-1', role: 'dv', description: 'Hits divided by signal trials. EMPTY when the block held no signal trials — not 0, which would assert the participant never responded to one.' },
  { file: '09_rt_summary.csv', column: 'false_alarm_rate', type: 'number', unit: '0-1', role: 'dv', description: 'False alarms divided by noise trials. EMPTY when the block held no noise trials — not 0, which would assert the participant never false-alarmed.' },
  { file: '09_rt_summary.csv', column: 'error_rate', type: 'number', unit: '0-1', role: 'dv', description: "Misses plus false alarms over SCORED trials — not over all trials, which is what this entry used to say and which contradicted the neighbouring note that anticipations are 'excluded from both signal-detection pools and from error_rate'. An anticipation is neither an error nor a correct response, so leaving it in the denominator diluted the error rate of exactly the participants producing them. Re-deriving (misses + false_alarms) / total_trials from 08_reaction_trials.csv will therefore disagree with this column for any block containing one. BLANK when no trial was scored at all: that is a participant whose every response fell inside the anticipation cutoff, and it used to read 0 — a perfect score for the block least deserving of one." },
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
  { file: '10_wide_summary.csv', column: 'search_time_ms', type: 'number', unit: 'ms', role: 'dv', description: 'Visual-search time for this condition-run. CENSORED unless search_termination is voluntary_full: at the time limit the clock ran out, and on voluntary_early the participant stopped before finding every target, so the time to find them all was never observed. It used to be absent from this file, which then offered search_efficiency — found per minute, blind to both — as its only search timing.' },
  { file: '10_wide_summary.csv', column: 'search_termination', type: 'factor(3)', unit: '-', role: 'qc', description: 'How the search ended: voluntary_full (every target found), voluntary_early (stopped by the participant first), time_limit (the clock ran out). Read before search_time_ms; see 05_visual_search.csv termination_mode.' },
  { file: '10_wide_summary.csv', column: 'search_accuracy', type: 'number', unit: '0-1', role: 'dv', description: 'Visual-search accuracy for this condition-run. Blank, not 0, if the excerpt held no target.' },
  { file: '10_wide_summary.csv', column: 'search_efficiency', type: 'number', unit: 'hits/min', role: 'dv', description: 'Visual-search correct taps per minute.' },
  { file: '10_wide_summary.csv', column: 'comfort_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated display comfort for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'clarity_score', type: 'number', unit: '0-100', role: 'dv', description: 'Rated text clarity for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'blink_rate', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Total blink rate for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'blink_rate_full', type: 'number', unit: 'blinks/min', role: 'dv', description: 'Complete-blink rate for this condition-run.' },
  { file: '10_wide_summary.csv', column: 'effective_fps', type: 'number', unit: 'fps', role: 'qc', description: "Achieved sampling rate of the EAR series (face-solved frames), not the camera's frame rate. See 07_eye_metrics.csv. Duration-based ocular measures are unreliable below about 25; check this before modelling them." },
  { file: '10_wide_summary.csv', column: 'face_presence_ratio', type: 'number', unit: '0-1', role: 'qc', description: 'Proportion of the condition with a face detected. Low values mean the ocular row rests on little data. '
    + `Same measure and same pilot gate (>= ${FACE_PRESENCE_PILOT_GATE_PCT}%) as the 07_eye_metrics.csv column of this name.` },
  { file: '10_wide_summary.csv', column: 'qc_overall', type: 'string', unit: '-', role: 'qc', description: 'Overall quality verdict for the condition-run: good, warn or bad. Use it to define the sensitivity analysis, not to delete rows silently.' },
  { file: '11_participant.csv', column: 'enrolment_number', type: 'integer', unit: '1-n', role: 'id', description: 'Sequential enrolment index. Drives the counterbalancing row assignment and the illumination order, so it is not an arbitrary identifier and must not be reshuffled.' },
  { file: '11_participant.csv', column: 'age', type: 'integer', unit: 'years', role: 'covariate', description: 'Age at enrolment. The sample is delimited to 18 to 35.' },
  { file: '11_participant.csv', column: 'gender', type: 'string', unit: '-', role: 'covariate', description: 'Self-reported gender.' },
  { file: '11_participant.csv', column: 'daily_screen_hours', type: 'number', unit: 'hours', role: 'covariate', description: 'Habitual daily screen exposure. A pre-specified moderator.' },
  { file: '11_participant.csv', column: 'device_familiarity', type: 'factor(3)', unit: '-', role: 'covariate', description: 'Self-rated digital literacy: low, moderate or high. A pre-specified moderator.' },
  { file: '11_participant.csv', column: 'lighting_habit', type: 'factor(3)', unit: '-', role: 'covariate', description: 'Typical ambient lighting when using a screen: bright, moderate or dim. A pre-specified moderator.' },
  { file: '11_participant.csv', column: 'correction_type', type: 'factor(3)', unit: '-', role: 'covariate', description: 'Refractive correction worn during testing: none, glasses or contacts. Contact-lens wear on test days is an exclusion, so this should not read contacts for an included participant.' },
  { file: '11_participant.csv', column: 'cvd_status', type: 'factor(5)', unit: '-', role: 'covariate', description: "Colour-vision status: normal, self_reported_deficient, screen_failed, screen_inconclusive or unknown. NEITHER screen_failed NOR screen_inconclusive sets eligible=false: the app's own screen is a covariate, and cvd_clinical — the operator's formal plates — is the criterion. screen_failed therefore marks a participant who is IN the confirmatory sample and whose colour perception is in doubt, so check cvd_clinical on that row and consider a sensitivity analysis without them; the operator is prompted at the time to run the formal plates. screen_inconclusive means the greyscale control plate was missed, so the attempt measured nothing — it is not a pass and not a failure. Anything other than normal bears directly on the text-colour factor." },
  { file: '11_participant.csv', column: 'cvd_clinical', type: 'factor(3)', unit: '-', role: 'covariate', description: "The operator's FORMAL colour-vision plate result (Ishihara or Farnsworth), taken alongside the app: normal, deficient or not_done. This is the basis for exclusion; a 'deficient' result sets eligible=false. 'not_done' means no formal screening was performed and is not a pass." },
  { file: '11_participant.csv', column: 'cvd_screen_correct', type: 'integer', unit: 'count', role: 'qc', description: `CONFUSION plates identified correctly on the app's own digital colour-vision screen, run on the study display. `
    + `THE DENOMINATOR: the participant sees ${SCREEN_TEST_PLATES + 1} plates — a greyscale control everyone should pass, which is a validity check counted in `
    + `neither the numerator nor the denominator, and ${SCREEN_TEST_PLATES} red-green confusion plates, counted in both. So this is out of ${SCREEN_TEST_PLATES}, `
    + `not out of ${SCREEN_TEST_PLATES + 1}. Missing the control sets cvd_status to screen_inconclusive whatever this value is. `
    + `THE PASS RULE: ${SCREEN_TEST_PLATES - SCREEN_ALLOWED_SLIPS} or more correct is 'normal', fewer is 'screen_failed' — an allowance of ${SCREEN_ALLOWED_SLIPS}, with nothing published behind it, `
    + 'set so a single mis-tap does not overturn an administration. Null when the screen was not run. '
    + `HOW THE PLATES ARE BUILT: the ${SCREEN_TEST_PLATES} confusion plates are split evenly between the two red-green axes — ${SCREEN_TEST_PLATES / 2} on the PROTAN confusion `
    + `axis and ${SCREEN_TEST_PLATES / 2} on the DEUTAN — and each plate's two dot palettes are computed to project to a SINGLE colour under the Viénot, Brettel & Mollon (1999) `
    + 'simulation for that deficiency: same hue and same brightness, so a dichromat of that type sees a blank disc with no edge of any kind to read. '
    + 'A dichromat of either type therefore misses at least the three plates aimed at them, and in the rendered simulation reads the other three as uniform too: the expected pattern is a '
    + `score at or near zero on the confusion plates WITH THE GREYSCALE CONTROL CORRECT, which is what separates a colour-vision deficiency from inattention — someone who is not attending misses the control as well, and that is recorded as screen_inconclusive rather than as a failure. The worst case the ${SCREEN_TEST_PLATES / 2}-per-axis split is sized against is a dichromat who reads all three cross-axis plates, i.e. ${SCREEN_TEST_PLATES / 2} of ${SCREEN_TEST_PLATES}, still short of the pass mark. `
    + 'WHAT IT IS NOT: this is not the Ishihara test. It is a home-made screen whose sensitivity and specificity are unknown, it models the DICHROMATIC extreme and says nothing '
    + 'established about anomalous trichromacy (the commoner condition), and it is a covariate and a flag, never a criterion for exclusion — cvd_clinical, the formal plates, is that. '
    + 'Digits, plate order, axis order and which palette carries the figure all vary per administration, so two administrations are not the same test and the counts are not directly '
    + "comparable between them. When a participant was screened at more than one sitting and an earlier FAILURE was carried forward, these counts are that failing administration's, "
    + 'not the later one\'s — the numbers always describe the administration that produced cvd_status.' },
  { file: '11_participant.csv', column: 'cvd_screen_total', type: 'integer', unit: 'count', role: 'qc', description: `Confusion plates scored. The denominator for cvd_screen_correct, and ${SCREEN_TEST_PLATES} in every administration of this build — the greyscale control plate is presented but not scored. Null when the screen was not run.` },
  { file: '11_participant.csv', column: 'caffeine_today', type: 'boolean', unit: '-', role: 'covariate', description: 'Whether caffeine was consumed before the sitting. An arousal covariate for the vigilance measures.' },
  { file: '11_participant.csv', column: 'hours_since_sleep', type: 'number', unit: 'hours', role: 'covariate', description: 'Hours awake at the start of the sitting. A sleepiness covariate, read alongside PERCLOS.' },
  { file: '11_participant.csv', column: 'eligible', type: 'boolean', unit: '-', role: 'qc', description: 'Whether the participant met every eligibility criterion. Rows with false must be excluded from the confirmatory analysis.' },
  { file: '11_participant.csv', column: 'exclusion_reason', type: 'string', unit: '-', role: 'qc', description: 'Recorded reason when eligible is false. Kept so exclusions can be reported rather than merely counted.' },
  { file: '11_participant.csv', column: 'baseline_fatigue', type: 'number', unit: '0-10', role: 'covariate', description: "The visual-fatigue rating taken before the first condition of the participant's first sitting; empty if none was administered. This record holds one value per participant, so use the per-sitting baseline rows in 03_fatigue_scores.csv (stage='baseline') for any within-session change — that is what fatigue_delta is computed from." },
  { file: '12_quality_flags.csv', column: 'engagement_flag', type: 'string', unit: '-', role: 'qc', description: 'Composite verdict for the condition-run: good, warn or bad. Derived from the individual signals in this file.' },
  { file: '12_quality_flags.csv', column: 'quality_score', type: 'number', unit: '0-1', role: 'qc', description: 'Composite quality score after penalties. Lower means more disengagement signals fired.' },
  { file: '12_quality_flags.csv', column: 'reading_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time spent on the reading task, used with word count to detect skimming.' },
  { file: '12_quality_flags.csv', column: 'fatigue_response_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken over the fatigue scale. Very short values feed the rushed flag.' },
  { file: '12_quality_flags.csv', column: 'perception_response_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken over the comfort and clarity ratings.' },
  { file: '12_quality_flags.csv', column: 'reading_skim', type: 'boolean', unit: '-', role: 'qc', description: 'True when reading was faster than the plausible ceiling for the passage word count, so the exposure window cannot be treated as sustained reading.' },
  { file: '12_quality_flags.csv', column: 'rt_disengaged', type: 'boolean', unit: '-', role: 'qc', description: `True when the participant tapped more than ${ENGAGEMENT.RT_FALSE_ALARM_MAX * 100}% of the NO-GO dots (commission errors), or when every `
      + 'response fell inside the anticipation cutoff, indicating the participant stopped attending. OMISSIONS DO NOT COUNT: the go-target is '
      + "the condition's own text colour, so missed and late go-dots are legitimately driven by how visible that colour is (yellow on white is "
      + '2.39:1), and counting them would flag the hardest conditions as disengaged more often than the easy ones — differential attrition on '
      + 'the manipulated factor. error_rate and lapse_rate remain in 09_rt_summary.csv as outcomes. WITHHELD when condition_interrupted is true: a backgrounded block comes back as misses and lapses produced by '
      + 'the throttled clock, and the rates alone cannot distinguish that from disengagement, so the interruption is reported instead of '
      + 'a verdict about the participant. A false value therefore means either that the rates were fine or that the condition was '
      + 'interrupted — check condition_interrupted before reading it as evidence of engagement.' },
  { file: '12_quality_flags.csv', column: 'careless_rushed_fatigue', type: 'boolean', unit: '-', role: 'qc', description: 'True when the fatigue scale was submitted too quickly to have been read.' },
  { file: '12_quality_flags.csv', column: 'careless_rushed_perception', type: 'boolean', unit: '-', role: 'qc', description: 'True when the comfort and clarity ratings were submitted too quickly to have been read.' },
  { file: '12_quality_flags.csv', column: 'careless_straight_lined', type: 'boolean', unit: '-', role: 'qc', description: 'True when all five fatigue items received an identical value, the classic straight-lining signature.' },
  { file: '12_quality_flags.csv', column: 'condition_interrupted', type: 'boolean', unit: '-', role: 'qc', description: 'The app was backgrounded, OR the tablet was held in portrait (behind the blocking overlay, where no tap reaches the task), OR the camera-lost notice was up, for more than 2 s somewhere in this condition — see condition_hidden_ms, condition_portrait_ms and condition_notice_ms on 02_conditions.csv for which. Portrait counts because it blocks input exactly as backgrounding throttles it, while leaving hidden time at 0. reading_interrupted does not cover this — it '
      + 'watches the passage only, and every other task in a condition is also timed. The threshold is lower than the reading one on '
      + 'purpose: reading is self-paced and dwell-gated, so a few seconds away costs time and nothing else, while the reaction-time '
      + 'block is one-second trials with one-second response windows and a browser throttles timers in a hidden tab. When this is TRUE, '
      + 'rt_disengaged is withheld — the high error rates cannot be told apart from the throttling, so attributing them to the '
      + 'participant would be a guess. See condition_hidden_ms on 02_conditions.csv for the duration.' },
  { file: '12_quality_flags.csv', column: 'reading_interrupted', type: 'boolean', unit: '-', role: 'qc', description: 'The app was backgrounded or the screen went off for more than 5 s during the reading exposure. The ocular measures for this condition therefore cover a window that includes time the participant was not looking at the stimulus.' },
  { file: '12_quality_flags.csv', column: 'comprehension_wrong', type: 'boolean', unit: '-', role: 'qc', description: 'True when the participant scored below chance across the three items for this condition. A single slip does not fire it.' },
  { file: '12_quality_flags.csv', column: 'low_face_presence', type: 'boolean', unit: '-', role: 'qc', description: `True when face_presence_ratio is below ${ENGAGEMENT.FACE_PRESENCE_MIN} — a face detected for less than `
    + `${Math.round(ENGAGEMENT.FACE_PRESENCE_MIN * 100)}% of the condition, which is the participant turning away rather than a `
    + 'tracking wobble. This is a LOWER bar than the pilot gate stated for face_presence_ratio on '
    + `07_eye_metrics.csv (>= ${FACE_PRESENCE_PILOT_GATE_PCT}%): a run can pass this flag and still fail the gate. Filter on the `
    + 'ratio itself, not on this boolean, if the gate is what you mean.' },
  { file: '12_quality_flags.csv', column: 'reasons', type: 'string', unit: '-', role: 'qc', description: 'Human-readable list of every penalty that fired, semicolon separated. Read this before excluding a row.' },
  { file: '13_cvsq.csv', column: 'session_index', type: 'integer', unit: '1 or 2', role: 'iv', description: 'Which sitting this administration belongs to. The CVS-Q is given twice per sitting (baseline and session_end), so without this a pooled dataset cannot tell the two rows apart. Under the single-sitting protocol that is two rows per participant; the contrast of interest is baseline-to-close WITHIN the sitting.' },
  { file: '13_cvsq.csv', column: 'ambient_illumination_level', type: 'factor(1)', unit: '-', role: 'meta', description: "The sitting's illumination level. CONSTANT in this dataset — see 01_session_info.csv. Retained so a pooled file that also contains earlier two-level data stays separable." },
  { file: '13_cvsq.csv', column: 'stage', type: 'factor(2)', unit: '-', role: 'iv', description: 'When the questionnaire was administered: baseline or session_end. The key secondary outcome is the change between them.' },
  { file: '13_cvsq.csv', column: 'symptomatic', type: 'boolean', unit: '-', role: 'dv', description: "Whether total_score reached the >= 6 cut-off. INTERPRETABLE ONLY ON THE 'habitual_computer_work' ROW. The cut-off is calibrated against that frame's weekly frequency anchors, and the session-end row re-anchors the same items to the ~90-minute exposure — so on that row this column is the same arithmetic applied outside the frame it was validated in, and the `frame` column says in terms that such a total must not be read against the published cut-off or against published norms. It is computed for both rows because suppressing it would hide the arithmetic rather than the caveat; filter on `frame` before using it, and do not read a baseline-to-close change in this boolean as a change in caseness." },
  { file: '13_cvsq.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken to complete the questionnaire.' },
  { file: '14_nasa_tlx.csv', column: 'ambient_illumination_level', type: 'factor(1)', unit: '-', role: 'meta', description: 'Illumination level of the sitting this workload rating belongs to. CONSTANT in this dataset. NASA-TLX is administered ONCE per sitting, so it describes the sitting as a whole and cannot be attributed to any single condition — it is not a per-condition outcome.' },
  { file: '14_nasa_tlx.csv', column: 'mental_demand', type: 'number', unit: '0-100', role: 'dv', description: 'Mental demand subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'physical_demand', type: 'number', unit: '0-100', role: 'dv', description: 'Physical demand subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'temporal_demand', type: 'number', unit: '0-100', role: 'dv', description: 'Temporal demand subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'effort', type: 'number', unit: '0-100', role: 'dv', description: 'Effort subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'frustration', type: 'number', unit: '0-100', role: 'dv', description: 'Frustration subscale. Higher is more load; this subscale needs no reversal before entering raw_tlx.' },
  { file: '14_nasa_tlx.csv', column: 'all_touched', type: 'boolean', unit: '-', role: 'qc', description: 'Whether every subscale slider was moved. False means at least one value is an untouched default.' },
  { file: '14_nasa_tlx.csv', column: 'response_time_ms', type: 'number', unit: 'ms', role: 'qc', description: 'Time taken over the workload instrument.' },
  { file: '15_media_inventory.csv', column: 'captured_at', type: 'string', unit: 'ISO 8601', role: 'meta', description: 'When the file was captured.' },
  { file: '15_media_inventory.csv', column: 'mime', type: 'string', unit: '-', role: 'meta', description: 'Media type of the stored file.' },
  { file: '15_media_inventory.csv', column: 'bytes', type: 'integer', unit: 'bytes', role: 'meta', description: 'Size of the stored file in bytes, as the browser reports the blob. Used to reconcile the inventory against the media actually present.' },
  { file: '15_media_inventory.csv', column: 'width', type: 'integer', unit: 'px', role: 'meta', description: 'Pixel width, where applicable.' },
  { file: '15_media_inventory.csv', column: 'height', type: 'integer', unit: 'px', role: 'meta', description: 'Pixel height, where applicable.' },
  { file: '15_media_inventory.csv', column: 'duration_ms', type: 'number', unit: 'ms', role: 'meta', description: 'Duration for video segments; blank for photographs.' },
  { file: '15_media_inventory.csv', column: 'filename', type: 'string', unit: '-', role: 'meta', description: 'The name this capture is written under when the media files are downloaded, so an inventory row can be matched to the file on disk without relying on write order.' },
  { file: '15_media_inventory.csv', column: 'consent_setup_photos', type: 'boolean', unit: '-', role: 'meta', description: 'The setup-photograph permission in force at the moment of capture. Stored with the file so a recording is never separable from the basis on which it was taken.' },
];

export function buildExportFiles(input: SessionBundle): ExportFile[] {
  beginNonFiniteCount();
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
  const latestCalibration = lastCalibrationTaken(bundle.calibration);
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
    ['participant_id', 'experiment_date', 'enrolment_number', 'session_index', 'session_status', 'withdrawn', 'withdrawn_at', 'conditions_completed', 'session_complete', 'conditions_per_session', 'condition_offset', 'ambient_lux', 'ambient_illumination_level', 'illumination_block', 'protocol_pass', 'repeat_run_note', 'sitting_split_reason', 'illumination_order_first', 'lux_start', 'lux_middle', 'lux_end', 'lux_n_readings', 'lux_checkpoints_logged', 'lux_complete', 'lux_mean', 'lux_max_deviation', 'lux_logged_all_in_range', 'lux_deviation_note', 'screen_white_luminance_cd_m2', 'brightness_percent', 'session_duration_min', 'app_version', 'git_hash', 'build_changed_mid_sitting', 'session_builds', 'condition_def_hash', 'schema_version', 'device_type', 'screen_resolution', 'stimulus_scale', 'layout_viewport', 'consent_given', 'consent_camera_metrics', 'consent_setup_photos', 'consent_annotation_video', 'media_items_retained', 'preflight_complete', 'e2e_timing', 'stimulus_font_ok', 'caffeine_today_session', 'hours_since_sleep_session', 'gaze_calibration_valid', 'gaze_trust', 'gaze_targets_well_covered', 'gaze_threshold_floored', 'calibration_ear_baseline', 'calibration_pitch_baseline_frac', 'calibration_targets_detected', 'calibration_ear_samples', 'calibration_runs', 'selftest_cued', 'selftest_detected', 'selftest_extra', 'selftest_fps', 'selftest_face_presence', 'selftest_pass'],
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
      // The participant withdrew. It was carried only by the session JSON and the backup, so every
      // CSV of a withdrawn sitting was identical to an ordinary paused one — and the R and Python
      // templates read exactly these CSVs. Both templates now drop a withdrawn sitting at source.
      withdrawn: isWithdrawn(session),
      withdrawn_at: session.withdrawn_at != null ? new Date(session.withdrawn_at).toISOString() : '',
      // FINISHED conditions, not condition rows: a row exists from the moment a condition starts, so
      // a paused condition used to count as completed here too. See storage/conditionStatus.ts.
      conditions_completed: bundle.conditions.filter(isConditionComplete).length,
      session_complete: session.status === 'complete' && !isWithdrawn(session)
        && bundle.conditions.filter(isConditionComplete).length === session.conditions_per_session,
      conditions_per_session: session.conditions_per_session, condition_offset: session.condition_offset,
      ambient_lux: session.ambient_lux, ambient_illumination_level: session.ambient_illumination_level,
      illumination_block: session.illumination_block,
      protocol_pass: session.protocol_pass ?? '',
      repeat_run_note: session.repeat_run_note ?? '',
      sitting_split_reason: session.sitting_split_reason ?? '',
      illumination_order_first: session.illumination_order_first,
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
      // A sitting resumed after the service worker swapped builds was exported under one hash for
      // all ten conditions, and nothing said otherwise. joinIntegrity compares sittings with each
      // other, so a change WITHIN one is invisible to it by construction.
      build_changed_mid_sitting: (session.additional_builds?.length ?? 0) > 0,
      session_builds: [session.provenance.git_hash, ...(session.additional_builds ?? [])]
        .filter(Boolean).join('+'),
      condition_def_hash: session.provenance.condition_def_hash, schema_version: session.provenance.schema_version,
      device_type: session.device_type, screen_resolution: session.screen_resolution,
      /*
       * `?? null` rather than a default: a session recorded before this field existed did not
       * measure a scale, and writing 1 there would assert that its stimuli were presented at the
       * design size when nobody knows whether they were.
       */
      stimulus_scale: session.stimulus_scale ?? null,
      layout_viewport: session.layout_viewport ?? null,
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
      /*
       * A bare count, not "7/9". The codebook declares this column `integer` and an analyst filters
       * on it to drop sittings with a poor camera setup — but the emitted value was a ratio STRING,
       * so `as.integer()` in R yields NA without an error and the filter silently passes every
       * sitting. The denominator carried no information either: it is GAZE_TARGETS.length on every
       * row, and the codebook's unit already states the range.
       */
      gaze_trust: latestCalibration?.gaze_trust ?? '',
      gaze_targets_well_covered: latestCalibration?.gaze_targets_well_covered ?? '',
      gaze_threshold_floored: latestCalibration?.gaze_threshold_floored ?? '',
      calibration_targets_detected: latestCalibration ? latestCalibration.targets_detected : '',
      calibration_ear_samples: latestCalibration?.ear_samples_usable ?? '',
      calibration_runs: bundle.calibration.length,
      selftest_cued: session.camera_selftest?.cued ?? '',
      selftest_detected: session.camera_selftest?.detected ?? '',
      selftest_extra: session.camera_selftest?.extra ?? '',
      selftest_fps: round(session.camera_selftest?.fps ?? null, 1),
      selftest_face_presence: round(session.camera_selftest?.facePresence ?? null, 3),
      selftest_pass: session.camera_selftest ? session.camera_selftest.pass : '',
    }]);

  // 02 — conditions (+ reading speed in words/min, derived from passage length & reading time)
  csv('02_conditions.csv',
    ['participant_id', 'session_id', 'session_index', 'condition_id', 'session_position', 'condition_label', 'polarity', 'background_color', 'text_color', 'color_name', 'ink_name', 'passage_id', 'wcag_contrast_ratio', 'wcag_level', 'michelson_contrast', 'below_wcag_aa', 'adaptation_ms_before', 'adaptation_ms_planned', 'adaptation_ms_min', 'adaptation_ended_by', 'passage_repeat_number', 'attempt_number', 'condition_complete', 'stimulus_scale', 'layout_viewport', 'condition_hidden_ms', 'condition_hidden_events', 'condition_portrait_ms', 'condition_portrait_events', 'condition_notice_ms', 'condition_notice_events', 'stimulus_scale_changes', 'condition_monitor_open_ms', 'condition_monitor_open_events', 'reading_monitor_open_ms', 'reading_time_ms', 'reading_wall_clock_ms', 'reading_hidden_ms', 'reading_min_page_dwell_ms', 'reading_speed_wpm', 'condition_duration_sec'],
    bundle.conditions.map((c) => {
      const words = PASSAGES[c.passage_id]?.wordCount ?? null;
      const wpm = words != null && c.reading_time_ms ? Math.round(words / (c.reading_time_ms / 60000)) : '';
      return {
        participant_id: pid, session_index: session.session_index, ...c,
        condition_complete: isConditionComplete(c),
        stimulus_scale: c.stimulus_scale ?? '', layout_viewport: c.layout_viewport ?? '',
        condition_hidden_ms: c.condition_hidden_ms ?? '', condition_hidden_events: c.condition_hidden_events ?? '',
        condition_portrait_ms: c.condition_portrait_ms ?? '', condition_portrait_events: c.condition_portrait_events ?? '',
        condition_notice_ms: c.condition_notice_ms ?? '', condition_notice_events: c.condition_notice_events ?? '',
        stimulus_scale_changes: c.stimulus_scale_changes ?? '',
        condition_monitor_open_ms: c.condition_monitor_open_ms ?? '', condition_monitor_open_events: c.condition_monitor_open_events ?? '',
        reading_monitor_open_ms: c.reading_monitor_open_ms ?? '',
        reading_speed_wpm: wpm,
      };
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
    ['participant_id', 'condition_id', 'passage_id', 'search_target', 'targets_in_set', 'search_time_ms', 'time_to_first_target_ms', 'targets_found', 'targets_missed', 'false_detections', 'search_d_prime', 'search_d_prime_se', 'distractor_words', 'accuracy_rate', 'search_efficiency', 'mean_inter_target_interval_ms', 'termination_mode'],
    bundle.visualSearch.map((v) => ({ participant_id: pid, ...v })));

  // 06 — display perception
  csv('06_display_perception.csv',
    ['participant_id', 'condition_id', 'display_comfort_score', 'text_clarity_score', 'comfort_touched', 'clarity_touched', 'response_time_ms'],
    bundle.perception.map((p) => ({ participant_id: pid, condition_id: p.condition_id, display_comfort_score: p.display_comfort_score, text_clarity_score: p.text_clarity_score, comfort_touched: p.comfort_touched, clarity_touched: p.clarity_touched, response_time_ms: p.response_time_ms })));

  // 07 — eye metrics
  csv('07_eye_metrics.csv',
    ['participant_id', 'condition_id', 'camera_active', 'camera_inactive_reason', 'camera_blocked_ms', 'camera_muted_ms', 'no_face_longest_ms', 'no_face_episodes', 'effective_fps', 'fps_adequate_for_tiers', 'fps_adequate_for_ratio', 'observed_duration_ms', 'ear_sample_count', 'open_ear_measured', 'blink_rate', 'blink_rate_full', 'incomplete_blink_ratio', 'blink_count_incomplete', 'blink_count_full', 'blink_count_micro', 'mean_inter_blink_interval_ms', 'inter_blink_interval_cv', 'perclos_p80', 'perclos_p70', 'long_closure_count', 'long_closure_total_ms', 'blink_duration_mean_ms', 'first_half_blink_rate', 'second_half_blink_rate', 'ear_baseline', 'ear_threshold_used', 'ear_complete_threshold', 'head_pitch_mean', 'head_pitch_calibrated', 'head_yaw_mean', 'head_roll_mean', 'head_movement_std', 'postural_load', 'head_stability_score', 'off_axis_ratio', 'gaze_calibrated', 'calibration_id', 'gaze_deviation_ratio', 'zone_center_ratio', 'zone_transition_count', 'face_presence_ratio', 'face_size_ratio', 'mean_face_luma', 'lighting_quality'],
    bundle.eyeMetrics.map((e) => ({
      participant_id: pid, condition_id: e.condition_id, camera_active: e.camera_active,
      camera_inactive_reason: e.camera_inactive_reason ?? '',
      camera_blocked_ms: e.camera_blocked_ms ?? '', camera_muted_ms: e.camera_muted_ms ?? '',
      no_face_longest_ms: e.no_face_longest_ms ?? '', no_face_episodes: e.no_face_episodes ?? '',
      effective_fps: e.effective_fps, fps_adequate_for_tiers: e.fps_adequate_for_tiers,
      fps_adequate_for_ratio: e.fps_adequate_for_ratio,
      observed_duration_ms: e.observed_duration_ms, ear_sample_count: e.ear_sample_count,
      open_ear_measured: e.open_ear_measured ?? '',
      blink_rate: e.blink_rate, blink_rate_full: e.blink_rate_full, incomplete_blink_ratio: e.incomplete_blink_ratio,
      blink_count_incomplete: e.blink_count_incomplete, blink_count_full: e.blink_count_full, blink_count_micro: e.blink_count_micro,
      mean_inter_blink_interval_ms: e.mean_inter_blink_interval_ms, inter_blink_interval_cv: e.inter_blink_interval_cv,
      perclos_p80: e.perclos_p80, perclos_p70: e.perclos_p70, long_closure_count: e.long_closure_count, long_closure_total_ms: e.long_closure_total_ms,
      blink_duration_mean_ms: e.blink_duration_mean_ms,
      first_half_blink_rate: e.bins.first_half_blink_rate, second_half_blink_rate: e.bins.second_half_blink_rate,
      ear_baseline: e.ear_baseline, ear_threshold_used: e.ear_threshold_used,
      ear_complete_threshold: e.ear_complete_threshold,
      head_pitch_mean: e.head_pitch_mean, head_pitch_calibrated: e.head_pitch_calibrated, head_yaw_mean: e.head_yaw_mean, head_roll_mean: e.head_roll_mean,
      head_movement_std: e.head_movement_std,
      postural_load: e.postural_load, head_stability_score: e.head_stability_score, off_axis_ratio: e.off_axis_ratio,
      gaze_calibrated: e.gaze_calibrated,
      // Which calibration this row was measured under; see storage/calibrationLookup.ts. Blank when
      // the camera was not running, and on rows written before the link existed — the time-based
      // resolution for those is done where the value is USED (analysis_long.csv), not faked here.
      calibration_id: e.calibration_id ?? '',
      gaze_deviation_ratio: e.gaze_deviation_ratio,
      zone_center_ratio: e.zone_center_ratio, zone_transition_count: e.zone_transition_count,
      face_presence_ratio: e.face_presence_ratio, face_size_ratio: e.face_size_ratio, mean_face_luma: e.mean_face_luma, lighting_quality: e.lighting_quality,
    })));

  // 08 — reaction trials
  csv('08_reaction_trials.csv',
    ['participant_id', 'condition_id', 'trial_number', 'trial_category', 'is_signal', 'stimulus_color', 'response_time_ms', 'accuracy', 'anticipatory', 'false_start'],
    // stimulus_color passes through as null for rows written before it existed — never a guessed colour.
    bundle.reactionTrials.map((t) => ({ participant_id: pid, condition_id: t.condition_id, trial_number: t.trial_number, trial_category: t.trial_category, is_signal: t.is_signal, stimulus_color: t.stimulus_color ?? null, response_time_ms: t.response_time_ms, accuracy: t.accuracy, anticipatory: t.anticipatory, false_start: t.false_start })));

  // 09 — rt summary
  csv('09_rt_summary.csv',
    ['participant_id', 'condition_id', 'total_trials', 'signal_trials', 'hits', 'false_alarms', 'misses', 'correct_rejections', 'hit_rate', 'false_alarm_rate', 'error_rate', 'mean_rt_hits_ms', 'median_rt_hits_ms', 'rt_sd_ms', 'rt_cv', 'anticipations', 'lapse_count', 'lapse_rate', 'inverse_efficiency_ms', 'first_half_mean_rt_ms', 'second_half_mean_rt_ms', 'd_prime', 'd_prime_se', 'd_prime_unstable', 'd_prime_estimable', 'criterion'],
    bundle.rtSummaries.map((r) => ({ participant_id: pid, ...r })));

  // 10 — wide one-row-per-condition summary (joined)
  csv('10_wide_summary.csv',
    ['participant_id', 'session_index', 'condition_id', 'condition_complete', 'attempt_number', 'condition_label', 'session_position', 'polarity', 'color_name', 'wcag_contrast_ratio', 'below_wcag_aa', 'passage_id', 'mean_rt_hits_ms', 'd_prime', 'd_prime_se', 'criterion', 'fatigue_mean', 'fatigue_delta', 'comprehension_correct', 'search_time_ms', 'search_termination', 'search_accuracy', 'search_efficiency', 'comfort_score', 'clarity_score', 'blink_rate', 'blink_rate_full', 'effective_fps', 'face_presence_ratio', 'qc_overall', 'engagement_flag', 'quality_score'],
    summaries.map((s) => ({
      participant_id: pid, session_index: session.session_index,
      condition_complete: s.condition_complete, attempt_number: s.attempt_number,
      /*
       * THE JOIN KEY. The header declared condition_id and this row object omitted it, so every
       * row of 10_wide_summary.csv carried a blank one — the file could not be joined to anything.
       * The Python analysis template's FIRST operation is that join, and it crashed on a dtype
       * mismatch (str against an all-NaN float column) before printing a line, complete with an
       * assert written to catch exactly a bad join.
       */
      condition_id: s.condition_id,
      condition_label: s.condition_label, session_position: s.session_position,
      polarity: s.polarity, color_name: s.color_name, wcag_contrast_ratio: s.wcag_contrast_ratio,
      below_wcag_aa: s.below_wcag_aa, passage_id: s.passage_id, mean_rt_hits_ms: s.mean_rt_hits_ms,
      d_prime: s.d_prime, d_prime_se: s.d_prime_se, criterion: s.criterion,
      fatigue_mean: round(s.fatigue_mean), fatigue_delta: round(s.fatigue_delta), comprehension_correct: s.comprehension_correct,
      search_time_ms: s.search_time_ms, search_termination: s.search_termination ?? '',
      search_accuracy: s.search_accuracy, search_efficiency: s.search_efficiency, comfort_score: s.comfort_score,
      clarity_score: s.clarity_score, blink_rate: s.blink_rate, blink_rate_full: s.blink_rate_full,
      effective_fps: s.effective_fps, face_presence_ratio: s.face_presence_ratio, qc_overall: s.qc.overall,
      engagement_flag: s.engagement, quality_score: s.quality_score,
    })));

  csv('11_participant.csv',
    ['participant_id', 'enrolment_number', 'age', 'gender', 'daily_screen_hours', 'device_familiarity', 'lighting_habit', 'correction_type', 'cvd_status', 'cvd_clinical', 'cvd_screen_correct', 'cvd_screen_total', 'caffeine_today', 'hours_since_sleep', 'eligible', 'exclusion_reason', 'baseline_fatigue'],
    participant ? [{ ...participant }] : []);

  // 12 — engagement / careless-responding quality flags (boredom & disengagement detection)
  /*
   * condition_id leads this file, and its absence was a real defect rather than an omission.
   *
   * Every other per-condition table carries it, and the analysis templates' own join rule is to join
   * on condition_id and NEVER on participant_id + condition_label, because a label repeats across
   * sittings. This file had only the label, so the per-condition quality signals — straight-lining,
   * rushed responses, low face presence — could not be joined onto the modelling frame the safe way
   * at all. The R template therefore read `engagement_flag` from the wide summary and reported the
   * careless-responding flags only as overall counts, which answers "how often did this happen in the
   * study" and cannot answer "was THIS condition for THIS participant rushed", which is the question
   * ANALYSIS_PLAN.md §5.5 actually asks.
   */
  csv('12_quality_flags.csv',
    ['condition_id', 'participant_id', 'session_index', 'condition_label', 'session_position', 'condition_complete', 'attempt_number', 'engagement_flag', 'quality_score', 'blink_count_total', 'insufficient_blinks', 'reading_time_ms', 'fatigue_response_ms', 'perception_response_ms', 'reading_skim', 'reading_interrupted', 'condition_interrupted', 'rt_disengaged', 'careless_rushed_fatigue', 'careless_rushed_perception', 'careless_straight_lined', 'comprehension_wrong', 'low_face_presence', 'reasons'],
    summaries.map((s) => ({
      condition_id: s.condition_id,
      participant_id: pid, session_index: session.session_index, condition_label: s.condition_label,
      session_position: s.session_position,
      condition_complete: s.condition_complete, attempt_number: s.attempt_number,
      engagement_flag: s.engagement, quality_score: s.quality_score,
      blink_count_total: s.blink_count_total, insufficient_blinks: s.insufficient_blinks,
      reading_time_ms: s.reading_time_ms, fatigue_response_ms: s.fatigue_response_ms, perception_response_ms: s.perception_response_ms,
      reading_skim: s.reading_skim, reading_interrupted: s.reading_interrupted,
      condition_interrupted: s.condition_interrupted, rt_disengaged: s.rt_disengaged, careless_rushed_fatigue: s.careless_rushed_fatigue,
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
    ['participant_id', 'session_index', 'ambient_illumination_level', 'stage', 'frame', 'total_score', 'symptomatic', 'response_time_ms', ...cvsqItemCols],
    bundle.cvsq.map((c) => {
      const row: Record<string, unknown> = {
        participant_id: pid, session_index: session.session_index,
        ambient_illumination_level: session.ambient_illumination_level,
        stage: c.stage, frame: c.frame, total_score: c.total_score,
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
    ['participant_id', 'session_index', 'media_id', 'kind', 'checkpoint', 'condition_label', 'condition_id',
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
      condition_label: m.condition_label ?? '', condition_id: m.condition_id ?? '',
      captured_at: new Date(m.captured_at).toISOString(),
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
    // The operator's free-text label is device-local and does not leave with the data; see
    // sessionForExport() in gather.ts for why a charset check would not have been a substitute.
    session: sessionForExport(session),
    participant,
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

  /*
   * Computed over the files as written, not from the records, so it sees exactly what the analyst
   * will see — including anything a formatter or a rounding step introduced on the way out.
   */
  const outOfRange = countOutOfDeclaredRange(files);

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
    non_finite_cells: nonFiniteCellCount(),
    /**
     * How many numeric cells fell OUTSIDE the range their own codebook entry declares, and which
     * columns they were in.
     *
     * Companion to non_finite_cells above, and for the same reason: the value is written through
     * unaltered, because clamping it would fabricate a measurement, so the only thing that keeps
     * that silence honest is a count travelling with the file. After the upstream guards this
     * should be 0. Any other value means a column the codebook promises is bounded is carrying
     * something it should not — investigate before analysing, and do not assume the bound held just
     * because the codebook states it.
     */
    out_of_declared_range_cells: outOfRange.cells,
    out_of_declared_range_columns: outOfRange.columns,
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
    /*
     * BYTES, measured as bytes.
     *
     * This was `f.content.length`, which is a count of UTF-16 code units, not of bytes. Every
     * non-ASCII character in the export makes the two differ, and the export is full of
     * operator-typed free text — lux_deviation_note, repeat_run_note, exclusion_reason — as well as
     * the en dashes and times signs in the codebook prose itself. An operator checking a copied
     * file's size on the receiving machine against this manifest, which is the only defence against
     * a truncated transfer, was comparing it with a number that is wrong whenever any of that
     * appears.
     */
    files: files.map((f) => ({
      filename: f.filename,
      bytes: new TextEncoder().encode(f.content).length,
      checksum_fnv1a: fnv1a(f.content),
    })),
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
): Promise<{ written: number; missing: string[]; refused: string[] }> {
  const { session } = bundle;
  const missing: string[] = [];
  const refused: string[] = [];
  let written = 0;
  for (const m of bundle.media ?? []) {
    /*
     * CURRENT consent, not the snapshot taken when the file was captured.
     *
     * This loop tested nothing at all, and the inventory beside it reported the historical
     * snapshot — so once a grant could be withdrawn, a withdrawn recording would still have been
     * written to the researcher's machine, and 15_media_inventory.csv would have said the grant was
     * live while 01_session_info.csv in the same bundle said it was not. The correct pattern was
     * already twelve lines above the equivalent check in integrity.ts, applied to ocular data.
     */
    const grant = requiredGrant(m.checkpoint);
    if (bundle.session?.media_consent?.[grant] !== true) { refused.push(m.media_id); continue; }
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
  return { written, missing, refused };
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
