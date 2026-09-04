/**
 * Gather all records for a session (or every session) from IndexedDB into a typed bundle.
 * Pure data access — the aggregation/export/dashboard layers operate on these bundles, so they
 * can be unit-tested without a DB by constructing bundles directly.
 */
import { get, getAll, getAllByIndex, put, remove } from './db';
import type {
  SessionRecord, ParticipantRecord, ConditionRecord, FatigueRecord, CvsqRecord,
  NasaTlxRecord,
  ComprehensionRecord, VisualSearchRecord, DisplayPerceptionRecord, EyeMetricsRecord,
  ReactionTrialRecord, RtSummaryRecord, CalibrationRecord, PerformanceLogRecord,
} from './types';
import { requiredGrant, type MediaRecord, type MediaConsent } from './media';

export interface SessionBundle {
  session: SessionRecord;
  participant: ParticipantRecord | undefined;
  conditions: ConditionRecord[];
  fatigue: FatigueRecord[];
  cvsq: CvsqRecord[];
  /** NASA-TLX: at most one record per session (administered once, at close). */
  tlx: NasaTlxRecord[];
  /** Consented photo/video captures. Blobs are present but are never written into the JSON bundle. */
  media: MediaRecord[];
  comprehension: ComprehensionRecord[];
  visualSearch: VisualSearchRecord[];
  perception: DisplayPerceptionRecord[];
  eyeMetrics: EyeMetricsRecord[];
  reactionTrials: ReactionTrialRecord[];
  rtSummaries: RtSummaryRecord[];
  calibration: CalibrationRecord[];
}

export async function gatherSession(sessionId: string): Promise<SessionBundle | null> {
  const session = await get('sessions', sessionId);
  if (!session) return null;
  const bySession = <T>(store: Parameters<typeof getAllByIndex>[0]) =>
    getAllByIndex(store, 'by_session', sessionId) as Promise<T[]>;

  const [
    participant, conditions, fatigue, cvsq, tlx, media, comprehension, visualSearch, perception,
    eyeMetrics, reactionTrials, rtSummaries, calibration,
  ] = await Promise.all([
    // Fetch by participant_id, NOT by session_id: the participant record is created once and SHARED
    // across a participant's sittings, so the 2nd+ sitting's session_id never matches it.
    get('participants', session.participant_id),
    bySession<ConditionRecord>('conditions'),
    bySession<FatigueRecord>('fatigue_scores'),
    bySession<CvsqRecord>('cvsq_scores'),
    bySession<NasaTlxRecord>('nasa_tlx'),
    bySession<MediaRecord>('media_captures'),
    bySession<ComprehensionRecord>('comprehension_results'),
    bySession<VisualSearchRecord>('visual_search'),
    bySession<DisplayPerceptionRecord>('display_perception'),
    bySession<EyeMetricsRecord>('eye_metrics'),
    bySession<ReactionTrialRecord>('reaction_trials'),
    bySession<RtSummaryRecord>('rt_summaries'),
    bySession<CalibrationRecord>('calibration_data'),
  ]);

  return normaliseBundle({
    session,
    participant: participant as ParticipantRecord | undefined,
    conditions, fatigue, cvsq, tlx, media, comprehension, visualSearch,
    perception, eyeMetrics, reactionTrials, rtSummaries, calibration,
  });
}

/**
 * Put every store into a deterministic order.
 *
 * IndexedDB returns rows in primary-key order, which for uuid keys is arbitrary and can differ
 * between a first export and a re-export after a reload. The exported bytes then differ for
 * identical data, and the manifest's per-file checksums stop being able to certify "this is the
 * same dataset" - which is the only thing they are for. Normalising makes reproducibility a
 * property of the pipeline rather than an accident of how the store happened to iterate.
 *
 * Applied both here and at the export boundary, so a bundle assembled by any other route - a test
 * fixture, an import, a merge - is exported identically to one that came straight from the store.
 *
 * Child stores sort by the serial position of the condition they belong to, so a reader scanning
 * any file sees the session in the order it was actually run, with the record id breaking ties.
 */
export function normaliseBundle(b: SessionBundle): SessionBundle {
  const conditions = [...b.conditions].sort((x, y) => x.session_position - y.session_position);
  const positionOf = new Map(conditions.map((c) => [c.condition_id, c.session_position]));
  const byCondition = <T extends { condition_id?: string | null }>(idKey: (t: T) => string) =>
    (x: T, y: T) => {
      const px = positionOf.get(x.condition_id ?? '') ?? Number.MAX_SAFE_INTEGER;
      const py = positionOf.get(y.condition_id ?? '') ?? Number.MAX_SAFE_INTEGER;
      return px !== py ? px - py : idKey(x).localeCompare(idKey(y));
    };
  return {
    ...b,
    conditions,
    fatigue: [...b.fatigue].sort((x, y) =>
      (x.stage === 'baseline' ? 0 : 1) - (y.stage === 'baseline' ? 0 : 1)
      || byCondition<FatigueRecord>((r) => r.fatigue_id)(x, y)),
    cvsq: [...b.cvsq].sort((x, y) => x.stage.localeCompare(y.stage) || x.cvsq_id.localeCompare(y.cvsq_id)),
    tlx: [...(b.tlx ?? [])].sort((x, y) => x.tlx_id.localeCompare(y.tlx_id)),
    media: [...(b.media ?? [])].sort((x, y) => x.captured_at - y.captured_at || x.media_id.localeCompare(y.media_id)),
    // Within a condition, order by the item's position in the passage rather than by its uuid, so
    // 04_comprehension.csv lists gist, inference and detail in the order they were administered.
    comprehension: [...b.comprehension].sort((x, y) =>
      byCondition<ComprehensionRecord>((r) => r.comprehension_id)(x, y)
      || x.question_index - y.question_index),
    visualSearch: [...b.visualSearch].sort(byCondition<VisualSearchRecord>((r) => r.condition_id)),
    perception: [...b.perception].sort(byCondition<DisplayPerceptionRecord>((r) => r.perception_id)),
    eyeMetrics: [...b.eyeMetrics].sort(byCondition<EyeMetricsRecord>((r) => r.condition_id)),
    reactionTrials: [...b.reactionTrials].sort((x, y) =>
      byCondition<ReactionTrialRecord>((r) => r.trial_id)(x, y) || x.trial_number - y.trial_number),
    rtSummaries: [...b.rtSummaries].sort(byCondition<RtSummaryRecord>((r) => r.condition_id)),
    calibration: [...b.calibration].sort((x, y) => x.calibration_id.localeCompare(y.calibration_id)),
  };
}

/**
 * Prior progress for a participant across all their (non-deleted) sittings. Used to make
 * split-sessions work: the enrolment number — which drives the Williams counterbalance order —
 * MUST be reused across a participant's sittings (a fresh number would re-roll the condition order
 * on sitting 2 and break the design), and the next sitting must resume at the global serial
 * position where the last one stopped.
 */
export async function priorParticipantProgress(
  participantId: string,
): Promise<{ enrolment: number | null; conditionsCompleted: number; sittings: number }> {
  const sessions = (await getAllByIndex('sessions', 'by_participant', participantId) as SessionRecord[])
    .map(normalise)
    .filter((s) => s.deleted_at == null);
  if (sessions.length === 0) return { enrolment: null, conditionsCompleted: 0, sittings: 0 };
  // Reuse the earliest-assigned enrolment number for stability.
  const enrolment = sessions.reduce((min, s) => Math.min(min, s.enrolment_number), Infinity);
  let conditionsCompleted = 0;
  for (const s of sessions) {
    const conds = await getAllByIndex('conditions', 'by_session', s.session_id) as { completed_at: number | null }[];
    conditionsCompleted += conds.filter((c) => c.completed_at != null).length;
  }
  return { enrolment: Number.isFinite(enrolment) ? enrolment : null, conditionsCompleted, sittings: sessions.length };
}

export const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Backfill defaults for sessions written before v7 (status/deleted_at/display_label). */
function normalise(s: SessionRecord): SessionRecord {
  return {
    ...s,
    status: s.status ?? (s.session_end_time ? 'complete' : 'in_progress'),
    deleted_at: s.deleted_at ?? null,
    display_label: s.display_label ?? null,
  };
}

/** Non-deleted sessions, most recent first (the manager's active list). */
export async function listSessions(): Promise<SessionRecord[]> {
  const sessions = (await getAll('sessions')).map(normalise);
  return sessions
    .filter((s) => s.deleted_at == null)
    .sort((a, b) => b.session_start_time - a.session_start_time);
}

/** Soft-deleted sessions still inside the retention window (the recycle bin). */
export async function listDeleted(): Promise<SessionRecord[]> {
  const sessions = (await getAll('sessions')).map(normalise);
  return sessions
    .filter((s) => s.deleted_at != null)
    .sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
}

export async function softDeleteSession(sessionId: string): Promise<void> {
  const s = await get('sessions', sessionId);
  if (s) await put('sessions', { ...normalise(s), deleted_at: Date.now() });
}

export async function restoreSession(sessionId: string): Promise<void> {
  const s = await get('sessions', sessionId);
  if (s) await put('sessions', { ...normalise(s), deleted_at: null });
}

export async function renameSession(sessionId: string, label: string): Promise<void> {
  const s = await get('sessions', sessionId);
  if (s) await put('sessions', { ...normalise(s), display_label: label.trim() || null });
}

/**
 * Withdraw one media grant and destroy the recordings it covered.
 *
 * WHY THIS HAS TO EXIST. Three documents promise it. `src/storage/media.ts` says media "is deletable
 * independently of the research data, so a later withdrawal of media consent does not force
 * discarding the numeric dataset"; `docs/PROTOCOL.md` repeats it; and the synopsis submitted to the
 * ethics committee states that "retained media are held apart from the research dataset and
 * deletable independently of it". The separate-store half was true. The independent-deletion half
 * described an operation that existed nowhere.
 *
 * The only button that removed a video was Purge, which destroys the entire sitting — ten condition
 * rows, hundreds of reaction trials, both questionnaires, the participant record. So a participant
 * who wanted their reading clips destroyed while remaining enrolled could not be accommodated
 * without discarding consented research data, which is precisely the outcome the promise ruled out.
 *
 * Returns how many recordings were destroyed, so the operator can be shown a number rather than
 * being asked to trust that something happened.
 */
export async function revokeMediaGrant(
  sessionId: string,
  grant: keyof MediaConsent,
): Promise<number> {
  const session = await get('sessions', sessionId) as SessionRecord | undefined;
  if (!session) return 0;

  /*
   * Consent is withdrawn BEFORE the blobs go, not after.
   *
   * If the deletion loop fails part-way — a quota error, the tab closing — the surviving
   * recordings are already covered by a withdrawn grant, so the export path refuses them. The other
   * order would leave a live grant over recordings that were meant to be destroyed.
   */
  const media = (await getAllByIndex('media_captures', 'by_session', sessionId)) as MediaRecord[];
  await put('sessions', {
    ...session,
    media_consent: { ...session.media_consent, [grant]: false },
    media_consent_revoked_at: Date.now(),
  });

  let removed = 0;
  for (const m of media) {
    if (requiredGrant(m.checkpoint) !== grant) continue;
    await remove('media_captures', m.media_id);
    removed++;
  }
  return removed;
}

/** Permanently delete a session and ALL of its child records across every store. */
export async function purgeSession(sessionId: string): Promise<void> {
  const bundle = await gatherSession(sessionId);
  if (!bundle) {
    await remove('sessions', sessionId);
    return;
  }
  for (const r of bundle.reactionTrials) await remove('reaction_trials', r.trial_id);
  for (const r of bundle.fatigue) await remove('fatigue_scores', r.fatigue_id);
  for (const r of bundle.cvsq) await remove('cvsq_scores', r.cvsq_id);
  for (const r of bundle.tlx ?? []) await remove('nasa_tlx', r.tlx_id);
  for (const r of bundle.media ?? []) await remove('media_captures', r.media_id);
  for (const r of bundle.comprehension) await remove('comprehension_results', r.comprehension_id);
  for (const r of bundle.perception) await remove('display_perception', r.perception_id);
  for (const r of bundle.visualSearch) await remove('visual_search', r.condition_id);
  for (const r of bundle.eyeMetrics) await remove('eye_metrics', r.condition_id);
  for (const r of bundle.rtSummaries) await remove('rt_summaries', r.condition_id);
  for (const r of bundle.calibration) await remove('calibration_data', r.calibration_id);
  // Performance logs aren't part of the analysis bundle, so purge them directly by session index.
  const perfLogs = await getAllByIndex('system_performance_logs', 'by_session', sessionId) as PerformanceLogRecord[];
  for (const r of perfLogs) await remove('system_performance_logs', r.log_id);
  for (const r of bundle.conditions) await remove('conditions', r.condition_id);
  // The participant record is keyed by participant_id and SHARED across a participant's sittings
  // (split sessions reuse it). Only delete it when no other session still references it — otherwise
  // purging one sitting would strip the demographics/vision covariates from the surviving sitting.
  if (bundle.participant) {
    const siblings = await getAllByIndex('sessions', 'by_participant', bundle.participant.participant_id);
    if (!siblings.some((s) => s.session_id !== sessionId)) {
      await remove('participants', bundle.participant.participant_id);
    }
  }
  await remove('sessions', sessionId);
}

/** Auto-purge bin entries older than the retention window. Returns how many were purged. */
/**
 * Auto-purge of the recycle bin. Runs unattended whenever the Session Manager mounts, and destroys
 * a whole sitting across every store, so what it REFUSES to touch matters more than what it takes.
 *
 * Three guards, each for a way it could have destroyed unrecoverable data silently:
 *
 *  - THE CLOCK. deleted_at is wall-clock. A tablet that fully discharges and boots offline — which
 *    this study's tablets do, in aeroplane mode — comes up with a reset clock, so a session deleted
 *    in that window carries a deleted_at years in the past and was purged instantly on the next
 *    mount, with no thirty-day window at all. A deleted_at earlier than the session's own start is
 *    impossible and proves the clock moved, so such a session is never auto-purged.
 *  - EXPORT. A session that was never exported exists only on this device. It now needs a
 *    deliberate purge from the bin, not a timer.
 *  - IN PROGRESS. A sitting deleted while a participant was part-way through went down the same
 *    path as a finished one.
 *
 * Returns what it purged AND what it declined to, so the caller can tell the operator rather than
 * discarding the number.
 */
export interface PurgeOutcome {
  purged: number;
  /** Sessions past the retention window that were deliberately NOT purged, with the reason. */
  retained: { session_id: string; reason: string }[];
}

export async function purgeExpired(now = Date.now()): Promise<PurgeOutcome> {
  const outcome: PurgeOutcome = { purged: 0, retained: [] };
  for (const s of await listDeleted()) {
    const deletedAt = s.deleted_at ?? 0;
    if (now - deletedAt <= BIN_RETENTION_MS) continue;

    if (deletedAt < s.session_start_time) {
      outcome.retained.push({
        session_id: s.session_id,
        reason: 'its deletion timestamp precedes the session itself, so the device clock moved; the retention window cannot be trusted',
      });
      continue;
    }
    if (s.status === 'in_progress') {
      outcome.retained.push({ session_id: s.session_id, reason: 'the sitting is still marked in progress' });
      continue;
    }
    if (s.exported_at == null) {
      outcome.retained.push({
        session_id: s.session_id,
        reason: 'it was never exported, so this device holds the only copy',
      });
      continue;
    }
    await purgeSession(s.session_id);
    outcome.purged++;
  }
  return outcome;
}

export function sessionLabel(s: SessionRecord): string {
  return s.display_label || s.participant_id;
}
