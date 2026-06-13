/**
 * Gather all records for a session (or every session) from IndexedDB into a typed bundle.
 * Pure data access — the aggregation/export/dashboard layers operate on these bundles, so they
 * can be unit-tested without a DB by constructing bundles directly.
 */
import { get, getAll, getAllByIndex } from './db';
import type {
  SessionRecord, ParticipantRecord, ConditionRecord, FatigueRecord, CvsqRecord,
  ComprehensionRecord, VisualSearchRecord, DisplayPerceptionRecord, EyeMetricsRecord,
  ReactionTrialRecord, RtSummaryRecord,
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
}

export async function gatherSession(sessionId: string): Promise<SessionBundle | null> {
  const session = await get('sessions', sessionId);
  if (!session) return null;
  const bySession = <T>(store: Parameters<typeof getAllByIndex>[0]) =>
    getAllByIndex(store, 'by_session', sessionId) as Promise<T[]>;

  const [
    participants, conditions, fatigue, cvsq, comprehension, visualSearch, perception,
    eyeMetrics, reactionTrials, rtSummaries,
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
  ]);

  return {
    session,
    participant: participants[0],
    conditions: conditions.sort((a, b) => a.session_position - b.session_position),
    fatigue, cvsq, comprehension, visualSearch, perception, eyeMetrics, reactionTrials, rtSummaries,
  };
}

/** Every session (most recent first), for the researcher session list. */
export async function listSessions(): Promise<SessionRecord[]> {
  const sessions = await getAll('sessions');
  return sessions.sort((a, b) => b.session_start_time - a.session_start_time);
}
