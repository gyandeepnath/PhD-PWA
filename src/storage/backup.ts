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
import { get, getAll, put, ensureEnrolmentAtLeast, MAX_PLAUSIBLE_ENROLMENT } from './db';
import { purgeSession } from './gather';
import { fnv1a } from './export';
import type { SessionBundle } from './gather';
import type { StoreName, StoreMap } from './types';

/** Bumped when the payload shape changes in a way an older reader could misread. */
export const BACKUP_FORMAT_VERSION = 2;

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
 *
 * Sorting is applied at EVERY level, not just the top. The previous version sorted only the outer
 * collection names, which left every record's own field order to whatever order the fields happened
 * to be assigned in. That order survives a round trip through IndexedDB's structured clone, so the
 * checksum held in practice — but it held by luck, not by construction: a record rebuilt with its
 * fields in a different order (a restore, a re-export, a refactor of the object literal that writes
 * it) produces a different checksum for identical data, and the operator is told the file is
 * damaged when it is not.
 *
 * `undefined` is encoded explicitly. JSON.stringify silently omits a key whose value is undefined,
 * so a field that vanished upstream and a field that was never defined hash identically, and the
 * checksum cannot tell them apart. The marker makes the absence part of what is signed.
 */
function canonicalValue(v: unknown): unknown {
  if (v === undefined) return { __undefined__: true };
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalValue);
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) out[k] = canonicalValue(src[k]);
  return out;
}

function canonical(data: BackupData): string {
  return JSON.stringify(canonicalValue(data));
}

/**
 * The version-1 checksum: top-level keys only. Kept so a backup written by an earlier build still
 * verifies instead of being rejected as damaged. A backup file is the last copy of a session that
 * a wiped tablet took with it; breaking the ability to read one is not a cost worth paying for a
 * tidier code path.
 */
function canonicalV1(data: BackupData): string {
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
  // Verify with the scheme that matches the file's own format version, so a version-1 backup is
  // still readable rather than being reported as damaged.
  const expected = b.format_version >= 2
    ? fnv1a(canonical(b.data as BackupData))
    : fnv1a(canonicalV1(b.data as BackupData));
  if (expected !== b.checksum_fnv1a) {
    return { ok: false, warnings, error: 'The backup failed its checksum. The file has been altered or damaged since it was written; do not import it.' };
  }
  const session = (b.data as BackupData).session as { session_id?: string } | null;
  if (!session?.session_id) {
    return { ok: false, warnings, error: 'The backup has no session record, so there is nothing to restore.' };
  }
  const problems = validateStructure(
    b.data as BackupData,
    session.session_id,
    (session as unknown as { participant_id?: string }).participant_id ?? '',
  );
  if (problems.length) {
    const shown = problems.slice(0, 6).map((p) => `  - ${p}`).join('\n');
    const more = problems.length > 6 ? `\n  ...and ${problems.length - 6} more.` : '';
    return {
      ok: false,
      warnings,
      error: `The backup passed its checksum but its contents are not structurally valid, so importing `
        + `it would write damaged records into this device:\n${shown}${more}\n\n`
        + `The checksum only proves the file has not changed since it was written. Keep the file and `
        + `send it to the investigator rather than deleting it.`,
    };
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

/**
 * Structural validation of a backup's rows, before a single one is written.
 *
 * The checksum proves the file is unaltered since it was written. It proves nothing about whether
 * what was written made sense — a build with a bug, a hand-edited file that was re-checksummed, or
 * a backup from a future schema all produce a file that passes the checksum and then writes
 * nonsense into IndexedDB. put() keys each row by its own identifier, so a row missing that
 * identifier is rejected by IndexedDB mid-restore, leaving a partial copy; and a row carrying a
 * DIFFERENT session's id is worse, because it is written successfully and then silently joins into
 * the restored session's export as if it had been measured there.
 *
 * `keyPath` on RESTORE_PLAN existed for this and was never read. This is what reads it.
 *
 * Refuses rather than repairs. A backup is a last copy; quietly dropping the rows that look wrong
 * would hand the operator a file that imported "successfully" and lost data.
 */
function validateStructure(data: BackupData, sessionId: string, participantId: string): string[] {
  const problems: string[] = [];

  for (const { key, store, keyPath } of RESTORE_PLAN) {
    const rows = data[key];
    if (rows === undefined || rows === null) continue;
    if (!Array.isArray(rows)) {
      problems.push(`"${key}" is not a list of records.`);
      continue;
    }
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        problems.push(`${store}[${i}] is not a record.`);
        continue;
      }
      const r = row as Record<string, unknown>;

      const id = r[keyPath];
      if (typeof id !== 'string' || id === '') {
        problems.push(`${store}[${i}] has no ${keyPath}. IndexedDB keys this store on that field, so the row cannot be written.`);
      } else if (seen.has(id)) {
        // Two rows sharing a key means the second overwrites the first: the restore would report
        // writing N rows while the device ends up with fewer, and nothing downstream would notice.
        problems.push(`${store}: ${keyPath} "${id}" appears more than once. One of these records would silently replace the other.`);
      } else {
        seen.add(id);
      }

      /**
       * session_id must be PRESENT and correct, not merely correct if present.
       *
       * `'session_id' in r` let a row lacking the field skip the check entirely. Such a row is
       * written to IndexedDB perfectly happily and is then invisible to every read path in the app,
       * because gatherSession reads each child store through getAllByIndex(store, 'by_session', …)
       * and an absent key is not indexed. The restore reports N rows written, the session opens
       * with fewer, and nothing anywhere says a row was lost — the worst shape a data-loss bug can
       * take.
       *
       * The participant record is the one exception: it is keyed by participant_id and shared
       * across a participant's two sittings, so its session_id points at whichever sitting created
       * it and need not match this one.
       */
      if (store !== 'participants') {
        if (typeof r.session_id !== 'string' || r.session_id === '') {
          problems.push(`${store}[${i}] has no session_id. It would be written but invisible to every read path, so the restore would silently lose it.`);
        } else if (r.session_id !== sessionId) {
          problems.push(`${store}[${i}] belongs to session "${String(r.session_id)}", not to the session this backup restores ("${sessionId}").`);
        }
      }
    }
  }

  /**
   * Every child row's condition_id must name a condition IN THIS BACKUP.
   *
   * visual_search, eye_metrics and rt_summaries are keyed on condition_id alone, so put() replaces
   * whatever is already under that key. A self-consistent file carrying a condition_id that belongs
   * to another participant's already-collected session would overwrite THEIR eye-metrics row — the
   * primary outcome — and move it under this session in the by_session index. The victim's next
   * export raises a coverage error, but if they were already exported the device copy is silently
   * wrong and a re-export would differ from the dataset in hand.
   */
  {
    const known = new Set(
      (Array.isArray(data.conditions) ? data.conditions : [])
        .map((c) => (c as Record<string, unknown>)?.condition_id)
        .filter((id): id is string => typeof id === 'string'),
    );
    for (const { key, store } of RESTORE_PLAN) {
      const rows = data[key];
      if (!Array.isArray(rows) || store === 'conditions') continue;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as Record<string, unknown> | null;
        if (!r || typeof r !== 'object') continue;
        const cid = r.condition_id;
        if (cid === undefined || cid === null) continue;
        if (typeof cid !== 'string' || !known.has(cid)) {
          problems.push(`${store}[${i}] references condition "${String(cid)}", which is not one of this backup's own conditions.`);
        }
      }
    }
  }

  // The media inventory is written through its own path, but the same two rules apply to it.
  const media = data.media;
  if (media !== undefined && media !== null) {
    if (!Array.isArray(media)) {
      problems.push('"media" is not a list of records.');
    } else {
      const seen = new Set<string>();
      for (let i = 0; i < media.length; i++) {
        const r = media[i] as Record<string, unknown> | null;
        if (r === null || typeof r !== 'object') { problems.push(`media_captures[${i}] is not a record.`); continue; }
        const id = r.media_id;
        if (typeof id !== 'string' || id === '') problems.push(`media_captures[${i}] has no media_id.`);
        else if (seen.has(id)) problems.push(`media_captures: media_id "${id}" appears more than once.`);
        else seen.add(id);
        if (typeof r.session_id !== 'string' || r.session_id === '') {
          problems.push(`media_captures[${i}] has no session_id and would be invisible after import.`);
        } else if (r.session_id !== sessionId) {
          problems.push(`media_captures[${i}] belongs to session "${String(r.session_id)}", not to this one.`);
        }
      }
    }
  }

  const participant = data.participant as Record<string, unknown> | null | undefined;
  if (participant && typeof participant === 'object') {
    if (typeof participant.participant_id !== 'string' || participant.participant_id === '') {
      problems.push('The participant record has no participant_id and cannot be written.');
    } else if (participant.participant_id !== participantId) {
      /**
       * It must EQUAL the id the session names, because that is the only key it is ever read back
       * by. A mismatch — even a difference of case — restores "successfully", reports
       * participants: 1, and then gatherSession finds nothing: 11_participant.csv exports as
       * headers only, with no age, no correction_type, no cvd_status, no eligible and no
       * exclusion_reason, while the integrity report still reads joins_sound with zero errors.
       */
      problems.push(
        `The participant record is keyed "${String(participant.participant_id)}" but the session `
        + `names participant "${participantId}". Nothing would ever read it back, so every `
        + 'demographic and eligibility covariate would be silently absent.',
      );
    }
  }

  const enrolment = (data.session as Record<string, unknown> | null)?.enrolment_number;
  if (enrolment !== undefined) {
    // A wild enrolment number does not merely mislabel this session: importSessionBackup raises the
    // device counter to it, and above 2^53 the counter can no longer increment, so every later
    // participant on that tablet would share one number and therefore one condition order.
    if (typeof enrolment !== 'number' || !Number.isSafeInteger(enrolment)
        || enrolment < 1 || enrolment > MAX_PLAUSIBLE_ENROLMENT) {
      problems.push(
        `The session's enrolment_number (${String(enrolment)}) is not a plausible enrolment. `
        + 'Importing it would raise this device\u2019s counter beyond the point where it can be '
        + 'incremented, and every subsequent participant would receive the same counterbalancing.',
      );
    }
  }

  return problems;
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
  /** The device's participant row, kept across a purge when the backup carries none. */
  let priorParticipant: unknown = null;
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
  /**
   * From HERE, not fifty lines further down, the writes are protected.
   *
   * purgeSession destroys the device copy, and the three writes that followed it — participant,
   * session, enrolment counter — sat OUTSIDE the try that exists precisely so a half-import is
   * reported as a half-import. A quota failure on the session write therefore escaped the function
   * entirely and surfaced through SessionManager's catch as "Could not read the file" — for a file
   * that was read perfectly, while the device copy had already been deleted. The operator is told
   * to blame the last remaining copy of the data.
   */
  try {
    if (existing && mode === 'overwrite') {
      /**
       * purgeSession removes the participant record too, when no OTHER session references it. The
       * re-write below is conditional on the backup carrying one, and a participant-less backup is
       * explicitly admitted with only a warning — so overwriting with a backup taken before the
       * profile stage silently destroyed the participant's demographics, vision covariates,
       * colour-vision result and eligibility decision, for BOTH sittings, since the record is
       * shared. Carry it forward.
       */
      priorParticipant = data.participant
        ? null
        : ((await get('participants', (session as unknown as { participant_id: string }).participant_id)) ?? null);
      await purgeSession(sessionId);
      if (priorParticipant) {
        await put('participants', priorParticipant as StoreMap['participants']);
        written.participants = 1;
      }
    }

    // Participant first: several stores are only interpretable with it, and it is shared across a
    // participant's two sittings, so it may already exist from the other session.
    if (data.participant) {
    await put('participants', data.participant as StoreMap['participants']);
    written.participants = 1;
    }
    /**
     * Normalised, not written verbatim.
     *
     * deleted_at and status came straight from the file. A backup taken from a session that was in
     * the recycle bin — or one whose deleted_at was corrupted — restored INTO the bin: the operator
     * saw "Session restored" and then could not find it anywhere in the active list, because
     * listSessions filters deleted rows out. Thirty days later the auto-purge destroyed it.
     */
    await put('sessions', {
      ...(session as unknown as Record<string, unknown>),
      deleted_at: null,
      status: (session as unknown as { session_end_time?: number | null }).session_end_time != null
        ? 'complete'
        : (session as unknown as { status?: string }).status === 'complete' ? 'complete' : 'in_progress',
    } as StoreMap['sessions']);
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
