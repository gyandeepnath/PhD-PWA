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
import { get, getAll, put } from './db';
import type { SessionRecord } from './types';

const KEY = 'visulab_resume';

export interface ResumePointer {
  sessionId: string;
  /** Condition index to resume at (0-based). At or past the sitting's length: go to the close. */
  nextStepIndex: number;
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
    const idx = s.resume_next_index ?? cached?.nextStepIndex ?? 0;
    out.push({ sessionId: s.session_id, nextStepIndex: idx, savedAt: cached?.savedAt ?? s.session_start_time });
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
