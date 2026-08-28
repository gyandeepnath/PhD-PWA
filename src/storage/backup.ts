/**
 * Session backup and restore.
 *
 * WHY THIS EXISTS. Data collection runs on tablets, offline, for roughly two years. Everything a
 * session produces lives in that tablet's IndexedDB until it is exported. A lost, wiped, reset or
 * failed tablet therefore destroys every session on it that had not already been exported, and a
 * browser clearing site data does the same thing without warning. That is an unacceptable exposure
 * for participant data that cannot be recollected: the participant has already given the time.
 *
 * The analysis JSON that ships inside an export is NOT a backup. It deliberately omits the
 * trial-level reaction-time rows, carrying only reaction_trials_count, because it exists to be read
 * alongside the CSVs rather than to reconstitute a database. Restoring from it would silently lose
 * every one of the 320 reaction trials a full session records. This module writes a separate,
 * explicitly complete artefact instead, and leaves the verified analysis export untouched.
 *
 * WHAT IT GUARANTEES.
 *   - Completeness: every store the session writes is represented, reaction trials included.
 *   - Detectable corruption: the payload carries a checksum over its own canonical serialisation,
 *     so a truncated or edited file is rejected rather than half-imported.
 *   - No silent overwrite: importing over an existing session requires an explicit choice.
 *   - Idempotence: importing the same file twice leaves the database in the same state.
 *   - Honesty about media: photo and video BLOBS are binary and are not carried here. The
 *     inventory rows are, flagged blob_present: false, so a restored session reports its media as
 *     missing rather than appearing to still hold it.
 */
import { get, getAll, put, ensureEnrolmentAtLeast } from './db';
import { purgeSession } from './gather';
import { fnv1a } from './export';
import type { SessionBundle } from './gather';
import type { StoreName, StoreMap } from './types';

/** Bumped when the payload shape changes in a way an older reader could misread. */
export const BACKUP_FORMAT_VERSION = 1;

export interface SessionBackup {
  format: 'visulab.session-backup';
  format_version: number;
  /**
   * Provenance of the build that CREATED the backup, not the one restoring it.
   *
   * Deliberately carries no timestamp. A time-of-writing field would make two backups of identical
   * data differ in bytes, which would break the export's byte-reproducibility and, worse, would
   * make the checksum a statement about when the file was written rather than about what it holds.
   * When the backup was taken belongs in export_manifest.json, with the rest of the provenance.
   */
  created_by: { app_version: string; git_hash: string };
  /** fnv1a over the canonical serialisation of `data`. Verified on read. */
  checksum_fnv1a: string;
  data: BackupData;
}

interface BackupData {
  session: unknown;
  participant: unknown;
  conditions: unknown[];
  fatigue: unknown[];
  cvsq: unknown[];
  tlx: unknown[];
  comprehension: unknown[];
  visualSearch: unknown[];
  perception: unknown[];
  eyeMetrics: unknown[];
  reactionTrials: unknown[];
  rtSummaries: unknown[];
  calibration: unknown[];
  /** Inventory only; see the module note on blobs. */
  media: unknown[];
}

/**
 * Keys are serialised in a fixed order so the checksum depends on the DATA and not on the order a
 * JavaScript engine happened to enumerate properties in. Without this, two backups of an identical
 * session could differ in bytes and the checksum would stop being a statement about content.
 */
function canonical(data: BackupData): string {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(data).sort()) ordered[k] = (data as unknown as Record<string, unknown>)[k];
  return JSON.stringify(ordered);
}

/** The store each collection is written back into, and the field that keys it. */
const RESTORE_PLAN: { key: keyof BackupData; store: StoreName; keyPath: string }[] = [
  { key: 'conditions', store: 'conditions', keyPath: 'condition_id' },
  { key: 'fatigue', store: 'fatigue_scores', keyPath: 'fatigue_id' },
  { key: 'cvsq', store: 'cvsq_scores', keyPath: 'cvsq_id' },
  { key: 'tlx', store: 'nasa_tlx', keyPath: 'tlx_id' },
  { key: 'comprehension', store: 'comprehension_results', keyPath: 'comprehension_id' },
  { key: 'visualSearch', store: 'visual_search', keyPath: 'condition_id' },
  { key: 'perception', store: 'display_perception', keyPath: 'perception_id' },
  { key: 'eyeMetrics', store: 'eye_metrics', keyPath: 'condition_id' },
  { key: 'reactionTrials', store: 'reaction_trials', keyPath: 'trial_id' },
  { key: 'rtSummaries', store: 'rt_summaries', keyPath: 'condition_id' },
  { key: 'calibration', store: 'calibration_data', keyPath: 'calibration_id' },
];

export function buildSessionBackup(bundle: SessionBundle): SessionBackup {
  const data: BackupData = {
    session: bundle.session,
    participant: bundle.participant ?? null,
    conditions: bundle.conditions,
    fatigue: bundle.fatigue,
    cvsq: bundle.cvsq,
    tlx: bundle.tlx,
    comprehension: bundle.comprehension,
    visualSearch: bundle.visualSearch,
    perception: bundle.perception,
    eyeMetrics: bundle.eyeMetrics,
    reactionTrials: bundle.reactionTrials,
    rtSummaries: bundle.rtSummaries,
    calibration: bundle.calibration,
    // Strip the blob and say so, rather than emitting a record that looks like it still has one.
    media: bundle.media.map((m) => {
      const { blob: _blob, ...rest } = m as unknown as Record<string, unknown> & { blob?: unknown };
      return { ...rest, blob_present: false };
    }),
  };
  const prov = (bundle.session as unknown as { provenance?: { app_version?: string; git_hash?: string } }).provenance;
  return {
    format: 'visulab.session-backup',
    format_version: BACKUP_FORMAT_VERSION,
    created_by: {
      app_version: prov?.app_version ?? 'unknown',
      git_hash: prov?.git_hash ?? 'unknown',
    },
    checksum_fnv1a: fnv1a(canonical(data)),
    data,
  };
}

export function serialiseSessionBackup(bundle: SessionBundle): string {
  return JSON.stringify(buildSessionBackup(bundle), null, 2);
}

export interface ParseResult {
  ok: boolean;
  backup?: SessionBackup;
  /** Populated when ok is false. Written for a research assistant, not a developer. */
  error?: string;
  /** Non-fatal observations the operator should still see. */
  warnings: string[];
}

export function parseSessionBackup(text: string): ParseResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON. It may have been truncated during copying.', warnings };
  }
  const b = parsed as Partial<SessionBackup>;
  if (b?.format !== 'visulab.session-backup') {
    return {
      ok: false,
      warnings,
      error: 'This is not a VisuLab session backup. The analysis JSON inside an export is not a backup: it omits the reaction-time trials and cannot restore a session.',
    };
  }
  if (typeof b.format_version !== 'number' || b.format_version > BACKUP_FORMAT_VERSION) {
    return { ok: false, warnings, error: `This backup was written in format version ${String(b.format_version)}, which this build cannot read. Restore it with the version of the app that created it.` };
  }
  if (!b.data || typeof b.data !== 'object') {
    return { ok: false, warnings, error: 'The backup contains no data section.' };
  }
  const actual = fnv1a(canonical(b.data as BackupData));
  if (actual !== b.checksum_fnv1a) {
    return { ok: false, warnings, error: 'The backup failed its checksum. The file has been altered or damaged since it was written; do not import it.' };
  }
  const session = (b.data as BackupData).session as { session_id?: string } | null;
  if (!session?.session_id) {
    return { ok: false, warnings, error: 'The backup has no session record, so there is nothing to restore.' };
  }
  const media = (b.data as BackupData).media ?? [];
  if (media.length) {
    warnings.push(`${media.length} media file(s) are listed in the inventory but their contents are not carried in a backup. The restored session will show them as missing.`);
  }
  if (!(b.data as BackupData).participant) {
    warnings.push('This backup carries no participant record; demographic and screening covariates will be absent.');
  }
  return { ok: true, backup: b as SessionBackup, warnings };
}

export type ImportMode = 'refuse-if-present' | 'overwrite';

export interface ImportResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
  /** Rows written per store, so the operator can see the restore was complete. */
  written: Record<string, number>;
  /** Non-fatal observations from the write itself, distinct from the file's own warnings. */
  warnings?: string[];
  /**
   * Set when the restored enrolment number was already issued on this device to somebody else.
   * The restore still succeeds — the data is worth keeping — but the counterbalance is compromised
   * for both participants and the investigator has to know.
   */
  collision?: string;
}

/**
 * Write a parsed backup into IndexedDB.
 *
 * Records are keyed by their own identifiers, so a repeated import overwrites the same rows rather
 * than duplicating them. That is what makes the operation safe to retry after a failure part-way
 * through, which matters because a partial restore is otherwise indistinguishable from a session
 * that genuinely lost records.
 */
export async function importSessionBackup(
  backup: SessionBackup,
  mode: ImportMode = 'refuse-if-present',
): Promise<ImportResult> {
  const written: Record<string, number> = {};
  const warnings: string[] = [];
  let collision: string | undefined;
  const data = backup.data;
  const session = data.session as StoreMap['sessions'];
  const sessionId = (session as unknown as { session_id: string }).session_id;

  const existing = await get('sessions', sessionId);
  if (existing && mode === 'refuse-if-present') {
    return {
      ok: false,
      written,
      warnings,
      error: `A session with this id is already on this device. Importing would overwrite it. Choose overwrite only if you are sure the copy on the device is the damaged one.`,
    };
  }

  // 'overwrite' has to MEAN overwrite. Putting the backup's rows without removing what is already
  // here merges the two: rows the device holds and the backup lacks survive, producing a session
  // that never existed — the backup's session record joined to a superset of its measurements —
  // which auditBundle then certifies as sound because every row it can see is internally
  // consistent. Purging first makes the result exactly the backup, which is what was promised.
  if (existing && mode === 'overwrite') {
    await purgeSession(sessionId);
  }

  // Participant first: several stores are only interpretable with it, and it is shared across a
  // participant's two sittings, so it may already exist from the other session.
  if (data.participant) {
    await put('participants', data.participant as StoreMap['participants']);
    written.participants = 1;
  }
  await put('sessions', session);
  written.sessions = 1;

  // The enrolment number drives the Williams condition order and the illumination order, and the
  // counter that issues it is a per-device integer that no backup carried. A replacement tablet
  // starts at zero, so without this it would hand enrolment 1 to the next participant while the
  // restored session already holds it: two participants, one condition order, recorded as two
  // distinct enrolments. Raising the counter here closes that path.
  const enrolment = (session as unknown as { enrolment_number?: number }).enrolment_number;
  if (typeof enrolment === 'number' && Number.isFinite(enrolment)) {
    // Warn if this device already issued the number to somebody else, which the restore cannot
    // undo and which invalidates the counterbalance for both participants.
    const pid = (session as unknown as { participant_id?: string }).participant_id;
    const clash = (await getAll('sessions')).filter((s) => {
      const r = s as unknown as { enrolment_number?: number; participant_id?: string; session_id?: string };
      return r.enrolment_number === enrolment && r.participant_id !== pid;
    });
    if (clash.length) {
      collision = `Enrolment number ${enrolment} is already held on this device by a different participant. Both participants now share a condition order, which breaks the counterbalance for each of them. Record this and tell the investigator before collecting more data.`;
    }
    await ensureEnrolmentAtLeast(enrolment);
  }

  // From here on a failure leaves the device holding a PARTIAL copy. IndexedDB gives no
  // transaction across this many stores through the wrapper in use, so the next best thing is to
  // report the partial state precisely rather than let the exception escape: SessionManager's
  // catch would otherwise tell the operator "Could not read the file", for a file it read
  // perfectly and half-imported. A half-restored session also re-exports as a fresh,
  // checksum-valid backup that looks complete, so the operator has to be told now.
  try {
    for (const { key, store } of RESTORE_PLAN) {
      const rows = (data[key] as unknown[]) ?? [];
      for (const row of rows) await put(store, row as StoreMap[typeof store]);
      written[store] = rows.length;
    }

    // Media: the backup carries the inventory row but never the binary. Writing that row straight
    // over the device's row would DESTROY a blob that is still here, because put() replaces the
    // whole record rather than merging fields. Carry any surviving blob forward.
    const media = (data.media as unknown[]) ?? [];
    let blobsKept = 0;
    for (const row of media) {
      const r = row as unknown as Record<string, unknown> & { media_id?: string };
      const prev = r.media_id ? await get('media_captures', r.media_id) : undefined;
      const prevBlob = (prev as unknown as { blob?: unknown } | undefined)?.blob;
      if (prevBlob) {
        await put('media_captures', { ...r, blob: prevBlob, blob_present: true } as unknown as StoreMap['media_captures']);
        blobsKept++;
      } else {
        await put('media_captures', row as StoreMap['media_captures']);
      }
    }
    written.media_captures = media.length;
    if (blobsKept) {
      warnings.push(`${blobsKept} media file(s) were already on this device and their contents have been kept; the rest are listed in the inventory but their files are gone.`);
    }
  } catch (err) {
    const stores = Object.entries(written).filter(([, n]) => n > 0).map(([s, n]) => `${s}: ${n}`).join(', ');
    return {
      ok: false,
      sessionId,
      written,
      collision,
      warnings,
      error: `The file was read and verified, but writing it to this device failed part-way through. `
        + `The device now holds a PARTIAL copy of this session (${stores || 'nothing written'}). `
        + `Do not export it as if it were complete. Free up storage and import the same file again, `
        + `which will overwrite what landed. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, sessionId, written, collision, warnings };
}
