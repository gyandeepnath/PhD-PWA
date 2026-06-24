/**
 * Gather all records for a session (or every session) from IndexedDB into a typed bundle.
 * Pure data access — the aggregation/export/dashboard layers operate on these bundles, so they
 * can be unit-tested without a DB by constructing bundles directly.
 */
import { get, getAll, getAllByIndex, put, remove } from './db';
import type {
  SessionRecord, ParticipantRecord, ConditionRecord, FatigueRecord, CvsqRecord,
  ComprehensionRecord, VisualSearchRecord, DisplayPerceptionRecord, EyeMetricsRecord,
  ReactionTrialRecord, RtSummaryRecord, CalibrationRecord, PerformanceLogRecord,
} from './types';

export interface SessionBundle {
  session: SessionRecord;
  participant: ParticipantRecord | undefined;
  conditions: ConditionRecord[];
  fatigue: FatigueRecord[];
  cvsq: CvsqRecord[];
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
    participants, conditions, fatigue, cvsq, comprehension, visualSearch, perception,
    eyeMetrics, reactionTrials, rtSummaries, calibration,
  ] = await Promise.all([
    bySession<ParticipantRecord>('participants'),
    bySession<ConditionRecord>('conditions'),
    bySession<FatigueRecord>('fatigue_scores'),
    bySession<CvsqRecord>('cvsq_scores'),
    bySession<ComprehensionRecord>('comprehension_results'),
    bySession<VisualSearchRecord>('visual_search'),
    bySession<DisplayPerceptionRecord>('display_perception'),
    bySession<EyeMetricsRecord>('eye_metrics'),
    bySession<ReactionTrialRecord>('reaction_trials'),
    bySession<RtSummaryRecord>('rt_summaries'),
    bySession<CalibrationRecord>('calibration_data'),
  ]);

  return {
    session,
    participant: participants[0],
    conditions: conditions.sort((a, b) => a.session_position - b.session_position),
    fatigue, cvsq, comprehension, visualSearch, perception, eyeMetrics, reactionTrials, rtSummaries, calibration,
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
  if (bundle.participant) await remove('participants', bundle.participant.participant_id);
  await remove('sessions', sessionId);
}

/** Auto-purge bin entries older than the retention window. Returns how many were purged. */
export async function purgeExpired(now = Date.now()): Promise<number> {
  const expired = (await listDeleted()).filter((s) => now - (s.deleted_at ?? 0) > BIN_RETENTION_MS);
  for (const s of expired) await purgeSession(s.session_id);
  return expired.length;
}

export function sessionLabel(s: SessionRecord): string {
  return s.display_label || s.participant_id;
}
