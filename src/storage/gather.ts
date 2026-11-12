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
  ReactionTrialRecord, RtSummaryRecord, CalibrationRecord, PerformanceLogRecord, OcularEventsRecord,
} from './types';
import { requiredGrant, type MediaRecord, type MediaConsent } from './media';
import { sameParticipant } from '@/lib/participantId';
import { supersededSittings } from './sessionPersistence';
import { buildKey, currentProvenance, describeBuild, sameBuild } from './buildStamp';
import { participantProgress } from '@/experiment/participantProgress';
import { canonicalParticipantId } from '@/lib/participantId';
import { exportNeedsKeptWindow, ocularRecordId } from '@/tracking/blinkLog';

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
  /**
   * Each reading window's blinks and per-frame trace (Round 78): the validation record behind
   * eyeMetrics' counts, exported as 07b/07c. Optional because a bundle built by hand, or gathered from
   * a sitting before schema 10, has none; absent and empty mean the same here.
   */
  ocularEvents?: OcularEventsRecord[];
  reactionTrials: ReactionTrialRecord[];
  rtSummaries: RtSummaryRecord[];
  calibration: CalibrationRecord[];
}

/**
 * Everything one sitting holds, from every store.
 *
 * `blinkRecords: false` leaves out ocular_events — about 1.7 MB a sitting — for a caller that writes
 * none of 07b/07c: the dashboard's cohort view and the pooled analysis set, which gather EVERY sitting on
 * the device each time (Round 81). It keeps one kind of record: the reading window of a camera-on row
 * recorded before Round 88 or 91 (no ibi_rule_version or blink_rule_version), which the export recomputes
 * its interval and blink counts from. Without it the pooled set and the cohort view gave such a row's
 * recorded ibi-r1/blink-r1 values while 07 gave the recomputed ibi-r2/blink-r2 ones (Round 94, review
 * B93-1; blinkLog.ts exportNeedsKeptWindow). A sitting recorded by a build from Round 91 on needs none,
 * and none is read. The per-sitting export, the backup and purgeSession gather everything, the default.
 */
export async function gatherSession(sessionId: string, opts: { blinkRecords?: boolean } = {}): Promise<SessionBundle | null> {
  const session = await get('sessions', sessionId);
  if (!session) return null;
  const bySession = <T>(store: Parameters<typeof getAllByIndex>[0]) =>
    getAllByIndex(store, 'by_session', sessionId) as Promise<T[]>;

  const [
    participant, conditions, fatigue, cvsq, tlx, media, comprehension, visualSearch, perception,
    eyeMetrics, ocularEvents, reactionTrials, rtSummaries, calibration,
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
    opts.blinkRecords === false ? Promise.resolve(undefined) : bySession<OcularEventsRecord>('ocular_events'),
    bySession<ReactionTrialRecord>('reaction_trials'),
    bySession<RtSummaryRecord>('rt_summaries'),
    bySession<CalibrationRecord>('calibration_data'),
  ]);

  // A lean gather still carries the reading windows the export recomputes earlier-rule rows from, and
  // only those: the same records exportedBlinkCounts and exportedInterBlinkInterval look up.
  let ocular = ocularEvents;
  if (opts.blinkRecords === false) {
    const needed = new Set(eyeMetrics.filter(exportNeedsKeptWindow).map((e) => ocularRecordId('reading', e.condition_id)));
    if (needed.size > 0) {
      ocular = (await bySession<OcularEventsRecord>('ocular_events')).filter((o) => o.window === 'reading' && needed.has(o.record_id));
    }
  }

  return normaliseBundle({
    session,
    participant: participant as ParticipantRecord | undefined,
    conditions, fatigue, cvsq, tlx, media, comprehension, visualSearch,
    perception, eyeMetrics, ocularEvents: ocular, reactionTrials, rtSummaries, calibration,
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
  /**
   * Condition position first, then the row's own administration order, then the record id.
   *
   * `within` used to be applied by the CALLER, as `byCondition(idKey)(x, y) || x.trial_number - ...`
   * — and that never ran. Two rows in the same condition have different uuids, so the id tie-break
   * returned a non-zero value and the `||` short-circuited every time. The two largest row-level
   * files in the export were therefore ordered by uuid within each condition:
   * `08_reaction_trials.csv` shuffled inside each 32-trial block, and `04_comprehension.csv` not
   * listing gist, inference and detail in the order administered — which is exactly what the
   * comment beside it said it did.
   *
   * No computed value was wrong: `trial_number` and `question_index` are columns in every row, the
   * integrity audit checks trial numbering as a set, and every consumer keys by id. What was wrong
   * is that file order silently meant nothing while this docstring and that comment both said it
   * meant something — and an analyst reading a trial file top to bottom for a sequential effect
   * (post-error slowing, time-on-task drift) got a scrambled sequence with no sign anything was off.
   *
   * The id remains the FINAL tie-break, so the ordering is still total and byte-reproducible.
   */
  const byCondition = <T extends { condition_id?: string | null }>(
    idKey: (t: T) => string,
    within?: (x: T, y: T) => number,
  ) =>
    (x: T, y: T) => {
      const px = positionOf.get(x.condition_id ?? '') ?? Number.MAX_SAFE_INTEGER;
      const py = positionOf.get(y.condition_id ?? '') ?? Number.MAX_SAFE_INTEGER;
      if (px !== py) return px - py;
      const w = within ? within(x, y) : 0;
      return w !== 0 ? w : idKey(x).localeCompare(idKey(y));
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
    comprehension: [...b.comprehension].sort(
      byCondition<ComprehensionRecord>((r) => r.comprehension_id, (x, y) => x.question_index - y.question_index),
    ),
    visualSearch: [...b.visualSearch].sort(byCondition<VisualSearchRecord>((r) => r.condition_id)),
    perception: [...b.perception].sort(byCondition<DisplayPerceptionRecord>((r) => r.perception_id)),
    eyeMetrics: [...b.eyeMetrics].sort(byCondition<EyeMetricsRecord>((r) => r.condition_id)),
    // In condition order; the self-test record, which belongs to no condition, sorts after them.
    ocularEvents: [...(b.ocularEvents ?? [])].sort(byCondition<OcularEventsRecord>((r) => r.record_id)),
    reactionTrials: [...b.reactionTrials].sort(
      byCondition<ReactionTrialRecord>((r) => r.trial_id, (x, y) => x.trial_number - y.trial_number),
    ),
    rtSummaries: [...b.rtSummaries].sort(byCondition<RtSummaryRecord>((r) => r.condition_id)),
    calibration: [...b.calibration].sort((x, y) => x.calibration_id.localeCompare(y.calibration_id)),
  };
}

/**
 * Every sitting recorded under this participant code, the recycle bin included, matched as the same
 * participant (lib/participantId.ts sameParticipant: letter case and surrounding spaces do not make a
 * different person). Round 87, audit 86 F2: the lookup used to be the by_participant index, an exact
 * match, so "case1" found nothing of "CASE1" and became a second participant.
 *
 * A scan of the sessions store rather than an index read: a sitting record is small, a tablet holds a
 * study's worth of them (tens to a few hundred), and an index on a case-folded key would have to be
 * added to every record on the device by a migration — rewriting stored records to save a scan.
 */
export async function sittingsOfParticipant(participantId: string): Promise<SessionRecord[]> {
  return (await getAll('sessions') as SessionRecord[]).filter((s) => sameParticipant(s.participant_id, participantId));
}

/**
 * The enrolment number a sitting takes when its participant consents: the number a consented sitting of
 * the same participant already holds, else the next number of the device's sequence — allocated HERE,
 * and not before.
 *
 * Round 89, audit 86 F17. The number was allocated at "Begin setup", before the consent screen. It fixes
 * the participant's Williams row (condition order), the passage rotation and the annotation-video
 * subsample, and the counter only goes up: a code typed wrong and noticed on the consent screen, or a
 * person who then declined, spent a number nobody would ever use, and every one left a gap in the
 * counterbalancing sequence (counterbalance.ts: gaps make rows unevenly used). A sitting now carries a
 * PROVISIONAL number until consent — the next free one, which is what it gets unless another
 * participant consented in between — and an unconsented sitting deleted from the session manager costs
 * the sequence nothing. A sitting that already consented (Back to consent in the same sitting) keeps
 * its number.
 */
export async function enrolmentAtConsent(
  session: Pick<SessionRecord, 'session_id' | 'participant_id' | 'consent_given' | 'enrolment_number'>,
  allocate: () => Promise<number>,
): Promise<number> {
  if (session.consent_given) return session.enrolment_number;
  const held = (await sittingsOfParticipant(session.participant_id))
    .filter((s) => s.session_id !== session.session_id && s.deleted_at == null && s.consent_given)
    .reduce((min, s) => Math.min(min, s.enrolment_number), Infinity);
  return Number.isFinite(held) ? held : allocate();
}

/** What priorParticipantProgress knows about a participant before a new sitting is started. */
export interface PriorParticipantProgress {
  /**
   * The code as this participant's sittings already store it, letter case included, which a new
   * sitting must reuse so the export joins it to them; null for a participant new to this device, or
   * when their sittings store it in more than one spelling (see `spellings`).
   */
  participantId: string | null;
  /**
   * Every spelling the matching sittings store, bin included. More than one means the device already
   * holds the same code in two letter cases — two enrolments that may be one person, recorded before
   * Round 87 — and a new sitting would join only one of them: refused until the researcher decides.
   */
  spellings: string[];
  enrolment: number | null;
  conditionsCompleted: number;
  sittings: number;
  withdrawnAt: number | null;
  /**
   * This participant's sittings that are still open — in progress, not in the recycle bin, not
   * withdrawn, not superseded by a later sitting — oldest first. While there is one, a new sitting is
   * refused (Round 87, audit 86 F3): it would start after the participant's last COMPLETED display, and
   * resuming the open one would then present the same displays again.
   */
  openSittings: OpenSitting[];
  /**
   * This participant's earlier sittings that were recorded by a build other than the one running now
   * (Round 88, audit 86 D10), oldest first. A sitting started now would give the participant sittings
   * from two builds, and the pooled export's join check then excludes them from every model
   * (mixed_build_within_participant). Not refused — the build cannot be taken back, and whether the
   * participant counts is the researcher's decision — but said on the New Session form before it begins.
   */
  earlierBuilds: EarlierBuild[];
}

/** An earlier sitting recorded by another build, as the session form names it. */
export interface EarlierBuild {
  session_index: number;
  started_at: number;
  /** describeBuild() of the build that recorded it. */
  build: string;
}

/** An open sitting, as the session form describes it. */
export interface OpenSitting {
  session_id: string;
  session_index: number;
  started_at: number;
  conditions_per_session: number;
  /** Displays this sitting finished. */
  conditions_completed: number;
}

/**
 * Prior progress for a participant across all their (non-deleted) sittings. Used to make
 * split-sessions work: the enrolment number — which drives the Williams counterbalance order —
 * MUST be reused across a participant's sittings (a fresh number would re-roll the condition order
 * on sitting 2 and break the design), and the next sitting must resume at the global serial
 * position where the last one stopped.
 */
export async function priorParticipantProgress(participantId: string): Promise<PriorParticipantProgress> {
  const every = (await sittingsOfParticipant(participantId)).map(normalise);
  const spellings = [...new Set(every.map((s) => s.participant_id))].sort();
  const stored = spellings.length === 1 ? spellings[0] : null;
  // Withdrawal is read across EVERY sitting, the recycle bin included: a withdrawn sitting that was
  // later binned is still a participant who withdrew.
  const withdrawnAt = every.reduce<number | null>(
    (w, s) => (s.withdrawn_at != null && (w == null || s.withdrawn_at < w) ? s.withdrawn_at : w), null);
  const sessions = every.filter((s) => s.deleted_at == null);
  if (sessions.length === 0) {
    return { participantId: stored, spellings, enrolment: null, conditionsCompleted: 0, sittings: 0, withdrawnAt, openSittings: [], earlierBuilds: [] };
  }
  // Reuse the earliest-assigned enrolment number for stability — a CONSENTED sitting's: an unconsented
  // sitting's number is provisional, not yet spent (Round 89, audit 86 F17; see enrolmentAtConsent).
  const enrolment = sessions.filter((s) => s.consent_given).reduce((min, s) => Math.min(min, s.enrolment_number), Infinity);
  const superseded = supersededSittings(sessions);
  let conditionsCompleted = 0;
  const openSittings: OpenSitting[] = [];
  for (const s of sessions) {
    const conds = await getAllByIndex('conditions', 'by_session', s.session_id) as { completed_at: number | null }[];
    const done = conds.filter((c) => c.completed_at != null).length;
    conditionsCompleted += done;
    if (s.status === 'in_progress' && !isWithdrawn(s) && !superseded.has(s.session_id)) {
      openSittings.push({
        session_id: s.session_id, session_index: s.session_index, started_at: s.session_start_time,
        conditions_per_session: s.conditions_per_session, conditions_completed: done,
      });
    }
  }
  openSittings.sort((a, b) => a.started_at - b.started_at);
  // By the join check's own comparison (buildStamp.ts), against the stamp a sitting started now gets.
  const now = currentProvenance();
  const earlierBuilds: EarlierBuild[] = sessions
    .filter((s) => !sameBuild(s.provenance, now))
    .sort((a, b) => a.session_start_time - b.session_start_time)
    .map((s) => ({ session_index: s.session_index, started_at: s.session_start_time, build: describeBuild(buildKey(s.provenance)) }));
  return {
    participantId: stored, spellings,
    enrolment: Number.isFinite(enrolment) ? enrolment : null, conditionsCompleted, sittings: sessions.length, withdrawnAt,
    openSittings, earlierBuilds,
  };
}

/** A participant part-way through their ten displays with no sitting open: a later sitting is due. */
export interface BetweenSittings {
  participant_id: string;
  /** Displays finished across their sittings (bin excluded). */
  conditions_completed: number;
  sittings: number;
}

/**
 * Participants BETWEEN SITTINGS: displays finished part-way through a pass of ten, no sitting open, not
 * withdrawn — the first half of a split done and the second still to come (Round 88, audit 86 D10).
 *
 * Exists for the update notice. Its open-sitting gate (sittingsInProgress) cannot see these: the first
 * half of a split is COMPLETE, so the notice offered "Update now" between the two halves, and an update
 * there puts the participant's two sittings on two builds, which the pooled export's join check blocks
 * (mixed_build_within_participant). One read of each store, not one per sitting: the notice re-asks
 * every few seconds while it is up.
 */
export async function participantsBetweenSittings(): Promise<BetweenSittings[]> {
  const sessions = (await getAll('sessions') as SessionRecord[]).map(normalise).filter((s) => s.deleted_at == null);
  const done = new Map<string, number>();
  for (const c of await getAll('conditions') as Array<{ session_id: string; completed_at: number | null }>) {
    if (c.completed_at != null) done.set(c.session_id, (done.get(c.session_id) ?? 0) + 1);
  }
  const byParticipant = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    const key = canonicalParticipantId(s.participant_id);
    (byParticipant.get(key) ?? byParticipant.set(key, []).get(key)!).push(s);
  }
  const out: BetweenSittings[] = [];
  for (const [, own] of byParticipant) {
    if (own.some(isWithdrawn)) continue;
    const superseded = supersededSittings(own);
    // An open sitting is the open-sitting gate's business, which refuses the update outright.
    if (own.some((s) => s.status === 'in_progress' && !superseded.has(s.session_id))) continue;
    const completed = own.reduce((n, s) => n + (done.get(s.session_id) ?? 0), 0);
    if (participantProgress(completed).offset > 0) {
      const latest = own.reduce((a, b) => (b.session_start_time > a.session_start_time ? b : a));
      out.push({ participant_id: latest.participant_id, conditions_completed: completed, sittings: own.length });
    }
  }
  return out.sort((a, b) => a.participant_id.localeCompare(b.participant_id));
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

/**
 * The sittings that are open right now: started, not finished, not in the recycle bin.
 *
 * Exists to gate the service-worker update. Applying an update reloads the page, and the question
 * "is a participant part-way through a sitting?" cannot be answered from the React state of the
 * screen asking it — a SECOND TAB on the same tablet can be mid-condition and is invisible from
 * here. IndexedDB is shared by every tab on the origin, so asking the database is what makes the
 * gate hold across all of them.
 */
export async function sittingsInProgress(): Promise<SessionRecord[]> {
  // A withdrawn sitting is not in progress: no participant is part-way through it and none will
  // return to it. It used to count here and held the update gate shut until the operator deleted it.
  return (await listSessions()).filter((s) => s.status === 'in_progress' && !isWithdrawn(s));
}

/**
 * The participant withdrew this sitting. The one definition every consumer uses: a withdrawn sitting
 * is never resumed, never counted as in progress, and never analysed.
 */
export function isWithdrawn(s: { withdrawn_at?: number | null }): boolean {
  return s.withdrawn_at != null;
}

/** Soft-deleted sessions still inside the retention window (the recycle bin). */
export async function listDeleted(): Promise<SessionRecord[]> {
  const sessions = (await getAll('sessions')).map(normalise);
  return sessions
    .filter((s) => s.deleted_at != null)
    .sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
}

/**
 * `evenWhenFull` on both: this is the step STORAGE_FULL_MESSAGE tells the operator to take, and it
 * is a put, so the flag that prints that message used to refuse it. Purge — the one that actually
 * frees space — is reachable only from the recycle bin, and the only way in is this Delete. Restore
 * is allowed for the same reason: an operator freeing space under pressure who bins the wrong
 * session must be able to undo it, and refusing the undo of a write we permit is worse than either.
 * Neither consumes space; both are same-size overwrites of a row already present.
 */
export async function softDeleteSession(sessionId: string): Promise<void> {
  const s = await get('sessions', sessionId);
  if (s) await put('sessions', { ...normalise(s), deleted_at: Date.now() }, { evenWhenFull: true });
}

export async function restoreSession(sessionId: string): Promise<void> {
  const s = await get('sessions', sessionId);
  if (s) await put('sessions', { ...normalise(s), deleted_at: null }, { evenWhenFull: true });
}

/**
 * Longest session label kept.
 *
 * A label exists to pick one row out of a list of twenty on a tablet. Past roughly this length it
 * stops being a label and becomes a notes field, and a free-text notes field attached to a
 * participant is exactly where identifying detail accumulates.
 */
export const MAX_DISPLAY_LABEL = 40;

/**
 * Clean an operator-typed session label.
 *
 * What this deliberately does NOT do is check the content, and that is worth stating plainly
 * because the neighbouring participant_id finding was closed for precisely this confusion: no
 * character class separates "Pilot 1" from "PriyaSharma". A charset restriction here would look
 * like a privacy control while guaranteeing nothing.
 *
 * The actual guard is `sessionForExport()` below — the label never leaves the device. This
 * function only bounds what is stored: control characters (which a paste can carry) neutralised,
 * runs of whitespace collapsed, length capped.
 */
export function sanitiseDisplayLabel(raw: string): string | null {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_LABEL)
    .trim();
  return cleaned || null;
}

export async function renameSession(sessionId: string, label: string): Promise<void> {
  const s = await get('sessions', sessionId);
  if (s) await put('sessions', { ...normalise(s), display_label: sanitiseDisplayLabel(label) });
}

/**
 * The session record as it is permitted to leave the device.
 *
 * `display_label` is operator convenience — a name to find a sitting by in the Session Manager
 * list — and it is the one field in the whole record that a person types freely. The prompt says
 * "Rename session", which invites "Priya S - Tue am", and the export spread the entire session
 * object into `session_*.json` and `backup_*.json`. So that string travelled inside a bundle the
 * protocol treats as de-identified, in the two files least likely to be opened and read, alongside
 * the backup that is the designated OFF-device copy.
 *
 * Restricting the label's charset would not have closed this: `PriyaSharma` passes any charset a
 * human-readable label could have. What software can genuinely guarantee is that the field does not
 * cross the boundary — and nothing downstream wants it. No CSV column carries it, the codebook
 * never mentions it, and no analysis reads it.
 *
 * The cost is that restoring a backup onto a replacement tablet brings back the sitting under its
 * participant_id rather than the operator's nickname. That is the correct trade: the nickname is a
 * convenience for finding a row in a list, and a restore is the moment an old tablet's nicknames
 * mean least.
 *
 * Set to null rather than deleted, so an exported record has the same SHAPE whether or not the
 * session was ever renamed. A useful consequence: renaming a session no longer alters the bytes of
 * its export, so it no longer alters the manifest checksum that is supposed to describe content.
 */
export function sessionForExport(s: SessionRecord): SessionRecord {
  return s.display_label == null ? s : { ...s, display_label: null };
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

/**
 * Record that the participant withdrew from the study, keeping their data but marking it unusable.
 *
 * THIS EXISTED AS A TOMBSTONE WITH NOTHING TO SET IT. `withdrawn_at` is read in three places —
 * analysisExport exports it as the `withdrawn` column, joinIntegrity blocks on it twice — and
 * importSessionBackup deliberately carries it through a restore UNCHANGED while clearing
 * `deleted_at`, precisely so that a withdrawal survives what a bin does not. The operator manual
 * instructs "record the withdrawal so the sitting is excluded from analysis rather than merely
 * incomplete". No code anywhere assigned it. The whole design was correct and unreachable, and the
 * operator's only route was Delete — which puts the session in the recycle bin, and which a restore
 * from any backup file silently reverses.
 *
 * Retain-and-exclude rather than destroy, deliberately, and the two are offered separately: the
 * manual has the operator ASK the participant which they want, because the consent form offers
 * both. Deletion is Delete → Purge and is already here. This is the other branch — for a
 * participant who does not ask for deletion but has stopped taking part — and it is the one that
 * has to survive a restore, because data already exported cannot be recalled, only marked.
 *
 * Media is destroyed either way. A recording of someone's face is the one thing that cannot be
 * defensibly retained past a withdrawal, and unlike the numbers it is still only on this device.
 */
export async function recordWithdrawal(sessionId: string): Promise<{ mediaDestroyed: number; sittings: number }> {
  const named = await get('sessions', sessionId) as SessionRecord | undefined;
  if (!named) return { mediaDestroyed: 0, sittings: 0 };

  /*
   * THE PARTICIPANT withdraws, not one sitting of theirs.
   *
   * This marked only the sitting the button was pressed on. In a split protocol the participant's
   * other sitting stayed unmarked: listed as Completed, exported with withdrawn = FALSE, offered to
   * the cohort view's averages — while the pooled join check and both analysis templates exclude the
   * whole participant. A researcher who exported the Completed sittings handed the templates a folder
   * without the flag and the participant was modelled. Every sitting of theirs on this device is now
   * marked, the recycle bin included (a restore would otherwise bring one back unmarked), and the
   * media of every sitting is destroyed.
   */
  // Matched as the same participant (sittingsOfParticipant), so a sitting stored before Round 87 under
  // another letter case of the code is withdrawn with the rest; the confirmation names the spellings.
  const sittings = named.participant_id ? await sittingsOfParticipant(named.participant_id) : [named];
  const at = named.withdrawn_at ?? Date.now();
  let mediaDestroyed = 0;
  for (const session of sittings) {
    // The tombstone first, for the same reason revokeMediaGrant withdraws consent before deleting:
    // if the loop below fails part-way, what survives is already covered by a recorded withdrawal.
    /*
     * A withdrawal ends the sitting for COLLECTION, not only for analysis.
     *
     * It used to set the tombstone, revoke photo and video consent, and leave the sitting otherwise as
     * it was: in progress, with its resume pointer. The Session Manager kept offering Resume, and
     * resuming wrote further condition rows and camera-active eye metrics AFTER the participant had
     * withdrawn. The block is in listResumable, keyed on this tombstone; the pointer is dropped here
     * as well so no copy of it survives to be picked up by a later route.
     *
     * The camera-metrics grant is deliberately NOT revoked. It records what the participant agreed to
     * while the measurements already taken were being collected, and the integrity audit reads it as
     * exactly that: revoking it would make every lawfully collected ocular row read as "measured
     * without consent". Nothing further can be collected, because the sitting cannot be resumed.
     */
    const { resume_next_index: _dropPointer, ...rest } = session;
    await put('sessions', {
      ...rest,
      withdrawn_at: session.withdrawn_at ?? at,
      media_consent: session.media_consent
        ? { ...session.media_consent, setup_photos: false, annotation_video: false }
        : session.media_consent,
      media_consent_revoked_at: Date.now(),
    });
    for (const m of (await getAllByIndex('media_captures', 'by_session', session.session_id)) as MediaRecord[]) {
      await remove('media_captures', m.media_id);
      mediaDestroyed++;
    }
  }
  return { mediaDestroyed, sittings: sittings.length };
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
  for (const r of bundle.ocularEvents ?? []) await remove('ocular_events', r.record_id);
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
    /*
     * CONFIRMED, not merely attempted.
     *
     * exported_at was the gate, and it is stamped unconditionally after downloadExport returns —
     * but that function drives `a.click()`, which cannot report a blocked download, a cancelled
     * save dialog or a full disk. Chrome also prompts before allowing multiple downloads and an
     * export writes about twenty files, so a refused prompt leaves exported_at set and every file
     * absent. Thirty days later this loop would destroy the only copy, unattended.
     */
    if (s.export_confirmed_at == null) {
      outcome.retained.push({
        session_id: s.session_id,
        reason: s.exported_at == null
          ? 'it was never exported, so this device holds the only copy'
          : 'an export was attempted but never confirmed as arrived, so this device may hold the only copy',
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
