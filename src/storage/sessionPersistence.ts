/**
 * Resume persistence. Stores a coarse, condition-level resume pointer so an interrupted in-progress
 * session can be continued from the start of the next condition (matching the original build's
 * "resume at the beginning of the next condition to ensure data integrity" — a partially-completed
 * condition is discarded rather than stitched together).
 *
 * Two things were wrong with the original single-key design, and both cost sessions:
 *
 *   - ONE key held ONE pointer. Starting a second session overwrote the first's, so the first
 *     became unresumable even though every row of its data was still on the device. The operator
 *     manual promises "Session Manager offers Resume at the next condition" after an interruption;
 *     with two sittings in progress — which happens whenever a participant is part-way through and
 *     the next participant is started — that promise was false for whichever one was older.
 *   - localStorage and IndexedDB are separately evictable. A browser that cleared site data
 *     partially, or an operator who "cleared history", could take the pointer while leaving every
 *     measurement in place: the data survived and became uncontinuable.
 *
 * So the pointer is now per session, and IndexedDB is the source of truth. localStorage is kept as
 * a synchronous fast path for the Session Manager's first paint — it is an optimisation, and losing
 * it costs nothing.
 */
import { get, getAll, getAllByIndex, put } from './db';
import type { SessionRecord } from './types';

const KEY = 'visulab_resume';

export interface ResumePointer {
  sessionId: string;
  /** Condition index to resume at (0-based). At or past the sitting's length: go to the close. */
  nextStepIndex: number;
  /**
   * Whether this session ever entered the condition loop. False means it was interrupted somewhere
   * in setup and nextStepIndex is a default, not a record of progress.
   */
  reachedLoop?: boolean;
  savedAt: number;
}

function available(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** The whole cache: sessionId -> pointer. Tolerates the old single-object shape. */
function readCache(): Record<string, ResumePointer> {
  if (!available()) return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    // Migration from the single-pointer format written by earlier builds.
    const one = parsed as Partial<ResumePointer>;
    if (typeof one.sessionId === 'string' && typeof one.nextStepIndex === 'number') {
      return { [one.sessionId]: { sessionId: one.sessionId, nextStepIndex: one.nextStepIndex, savedAt: one.savedAt ?? 0 } };
    }
    const out: Record<string, ResumePointer> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const p = v as Partial<ResumePointer>;
      if (typeof p?.nextStepIndex === 'number') {
        out[k] = { sessionId: k, nextStepIndex: p.nextStepIndex, savedAt: p.savedAt ?? 0 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeCache(all: Record<string, ResumePointer>): void {
  if (!available()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full / disabled — the IndexedDB copy is the one that matters */
  }
}

/**
 * Record where this session should resume.
 *
 * Writes both copies. The IndexedDB write is awaited by callers that can; the pointer also lands in
 * localStorage synchronously so a reload a moment later still finds it.
 */
export function saveResume(sessionId: string, nextStepIndex: number): void {
  const all = readCache();
  all[sessionId] = { sessionId, nextStepIndex, savedAt: Date.now() };
  writeCache(all);
  void persistResume(sessionId, nextStepIndex);
}

/** The durable half of saveResume, on the session record itself. */
async function persistResume(sessionId: string, nextStepIndex: number): Promise<void> {
  try {
    const s = await get('sessions', sessionId);
    if (!s) return;
    // Only rewrite when it actually changed: this runs at every condition boundary and the session
    // record is read by the Session Manager's list.
    if ((s as SessionRecord).resume_next_index === nextStepIndex) return;
    await put('sessions', { ...(s as SessionRecord), resume_next_index: nextStepIndex });
  } catch {
    /* the localStorage copy still stands */
  }
}

/** Synchronous fast path: the cached pointer for one session, or the most recent of any. */
export function loadResume(sessionId?: string): ResumePointer | null {
  const all = readCache();
  if (sessionId) return all[sessionId] ?? null;
  const list = Object.values(all).sort((a, b) => b.savedAt - a.savedAt);
  return list[0] ?? null;
}

/**
 * Every resumable session on this device, newest first, read from IndexedDB.
 *
 * This is the authoritative list. A session that is in progress and has a recorded pointer is
 * resumable whether or not localStorage still remembers it; a session that is in progress with no
 * pointer at all is resumable from its first condition, because that is what the data says.
 */
export async function listResumable(): Promise<ResumePointer[]> {
  const cache = readCache();
  let sessions: SessionRecord[] = [];
  try {
    sessions = (await getAll('sessions')) as SessionRecord[];
  } catch {
    return Object.values(cache).sort((a, b) => b.savedAt - a.savedAt);
  }
  const out: ResumePointer[] = [];
  for (const s of sessions) {
    if (s.status !== 'in_progress' || s.deleted_at) continue;
    const cached = cache[s.session_id];

    /**
     * The CONDITION ROWS are the authority, not the pointer.
     *
     * Both copies of the pointer are caches, and both are losable: localStorage is separately
     * evictable, and the IndexedDB copy is written without an await and with its failure
     * discarded. When both were missing, `reachedLoop` was false and the resume restarted at
     * condition 0 — silently replaying conditions the participant had already completed. The redo
     * reuses each position's existing condition_id, so it OVERWRITES the first attempt everywhere,
     * and the resulting dataset has ten conditions, unique ids, full coverage and joins_sound:
     * true. Nothing anywhere records that six of them were read twice.
     *
     * A completed condition row is not a cache. Counting them recovers the position from data.
     */
    let completed = 0;
    try {
      const rows = await getAllByIndex('conditions', 'by_session', s.session_id);
      completed = (rows as { completed_at: number | null }[]).filter((c) => c.completed_at != null).length;
    } catch {
      /* fall back to the pointer below */
    }

    const cachedIdx = s.resume_next_index ?? cached?.nextStepIndex ?? null;
    // Take whichever is further on: a pointer ahead of the condition rows means the last condition
    // finished but its row had not been stamped yet, and a condition count ahead of the pointer
    // means the pointer was lost. Neither may send the participant backwards over finished work.
    const recorded = completed > 0 || cachedIdx != null
      ? Math.max(completed, cachedIdx ?? 0)
      : null;
    // reachedLoop distinguishes "interrupted at condition 1" from "interrupted during setup and
    // never got as far as condition 1". Both are resumable; they resume to different places, and
    // conflating them dropped a participant into the reading task with no consent record, no
    // screening and no baselines. A synthesised 0 is not evidence that the loop was ever entered.
    out.push({
      sessionId: s.session_id,
      nextStepIndex: recorded ?? 0,
      reachedLoop: recorded != null,
      savedAt: cached?.savedAt ?? s.session_start_time,
    });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** Drop one session's pointer (or, with no argument, every pointer). */
export function clearResume(sessionId?: string): void {
  if (sessionId) {
    const all = readCache();
    delete all[sessionId];
    writeCache(all);
    void (async () => {
      try {
        const s = await get('sessions', sessionId);
        if (s && (s as SessionRecord).resume_next_index != null) {
          const { resume_next_index: _drop, ...rest } = s as SessionRecord;
          await put('sessions', rest as SessionRecord);
        }
      } catch {
        /* ignore */
      }
    })();
    return;
  }
  if (!available()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
