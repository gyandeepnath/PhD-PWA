/**
 * IndexedDB access layer (idb).
 *
 * Stores mirror the original v5 schema and add the v6 refinement stores/fields. The enrolment
 * counter lives in a `meta` keyval store and is incremented atomically so counterbalancing uses a
 * true sequential index (fixing the original hash-of-arbitrary-ID assignment that broke balance).
 *
 * Falls back to an in-memory implementation when IndexedDB is unavailable (e.g. file://), matching
 * the original build's resilience.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION } from './schemaEnums';
import type { StoreMap, StoreName } from './types';

interface StoreSpec {
  name: StoreName | 'meta';
  keyPath: string;
  indexes?: { name: string; keyPath: string }[];
}

const STORE_SPECS: StoreSpec[] = [
  { name: 'participants', keyPath: 'participant_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }, { name: 'by_enrolment', keyPath: 'enrolment_number' }] },
  { name: 'sessions', keyPath: 'session_id', indexes: [{ name: 'by_participant', keyPath: 'participant_id' }] },
  { name: 'conditions', keyPath: 'condition_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'fatigue_scores', keyPath: 'fatigue_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }, { name: 'by_condition', keyPath: 'condition_id' }] },
  { name: 'cvsq_scores', keyPath: 'cvsq_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'media_captures', keyPath: 'media_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'nasa_tlx', keyPath: 'tlx_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'display_perception', keyPath: 'perception_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }, { name: 'by_condition', keyPath: 'condition_id' }] },
  { name: 'comprehension_results', keyPath: 'comprehension_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }, { name: 'by_condition', keyPath: 'condition_id' }] },
  { name: 'visual_search', keyPath: 'condition_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'reaction_trials', keyPath: 'trial_id', indexes: [{ name: 'by_condition', keyPath: 'condition_id' }, { name: 'by_session', keyPath: 'session_id' }] },
  { name: 'rt_summaries', keyPath: 'condition_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'eye_metrics', keyPath: 'condition_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'calibration_data', keyPath: 'calibration_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'system_performance_logs', keyPath: 'log_id', indexes: [{ name: 'by_session', keyPath: 'session_id' }] },
  { name: 'meta', keyPath: 'key' },
];

let _dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Set once another tab has upgraded the database past the version THIS build knows about.
 *
 * From that moment this tab can never open the database again: openDB asks for DB_VERSION, the
 * constant compiled into this build, and IndexedDB rejects an open at a version BELOW the one on
 * disk. Recording the fact lets every later call fail immediately with a sentence an operator can
 * act on, instead of a bare VersionError raised from whichever write happened to come next.
 */
let _supersededByNewerBuild = false;

/**
 * What the operator is told when this tab has been superseded. Written for a research assistant.
 * "Your data is safe" is the first thing they need to know and is true: nothing was deleted, this
 * tab simply holds a connection to a schema that no longer exists.
 */
export const SUPERSEDED_MESSAGE =
  'This window is running an older version of VisuLab and can no longer save data, because another '
  + 'window or tab has updated the app. Nothing has been lost — the sessions already saved are safe. '
  + 'Close every VisuLab window and open the app again. If a sitting was in progress, resume it from '
  + 'the Session Manager after reopening.';

function indexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function getDB(): Promise<IDBPDatabase> {
  // Fail fast and legibly rather than attempting an open that cannot succeed; see the flag above.
  if (_supersededByNewerBuild) return Promise.reject(new Error(SUPERSEDED_MESSAGE));
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    /**
     * A second tab, or a service-worker update that bumps DB_VERSION, must not hang every write.
     *
     * `upgrade` used to be the only callback. Without `blocking`, a tab holding an open connection
     * never closes it when another tab opens a newer version, so the newer tab's openDB promise
     * NEVER SETTLES and every `await put(...)` there waits for ever. It does not reject, so
     * main.tsx's unhandledrejection panel never fires either: the screen simply stops advancing,
     * mid-condition, with nothing anywhere saying why. Without `terminated`, a connection the
     * browser reclaims — WebKit does this to backgrounded tabs — leaves the cached promise
     * resolving to a closed database, and every later call rejects for the rest of the session
     * with no attempt to reopen.
     */
    blocked() {
      console.error('[visulab] The database is open in another tab, which is blocking an upgrade. Close the other tab.');
    },
    blocking(_cur, next, ev) {
      /*
       * This connection is the one in the way, so it has to be released or the other tab's upgrade
       * hangs for ever. What it must NOT do is claim the release is recoverable.
       *
       * The comment here used to say "the next call here reopens". It does not. `next` is a version
       * higher than the DB_VERSION this build was compiled with — that is the only reason blocking
       * fires — and IndexedDB refuses an open below the version on disk. So the reopen this tab
       * would attempt rejects with VersionError, and it will reject for as long as the tab is open.
       * The fix turned a silent hang into a permanent failure, which is better, but calling it a
       * reopen made it look like neither.
       *
       * The honest position is that this tab is finished with the database. Say so once, here, so
       * that every later call carries a sentence an operator can act on rather than a VersionError
       * surfacing from an arbitrary write mid-condition.
       */
      if (next != null && next > DB_VERSION) {
        _supersededByNewerBuild = true;
        console.error(`[visulab] ${SUPERSEDED_MESSAGE}`);
      }
      _dbPromise = null;
      (ev.target as IDBDatabase | null)?.close();
    },
    terminated() {
      _dbPromise = null;
    },
    upgrade(db, _oldVersion, _newVersion, tx) {
      // Additive: create any store that does not yet exist (covers fresh installs and
      // forward-migration from an older version that lacks the v6 stores).
      for (const spec of STORE_SPECS) {
        if (!db.objectStoreNames.contains(spec.name)) {
          const store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
          for (const idx of spec.indexes ?? []) {
            store.createIndex(idx.name, idx.keyPath);
          }
          continue;
        }

        // The store already exists, but an index added in a later schema version does NOT appear
        // just because the store does. Without this, a device upgraded from an earlier version
        // keeps a store that is missing an index the code now reads through, and gatherSession's
        // getAllByIndex(store, 'by_session', ...) throws NotFoundError on a store full of real
        // data — a tablet mid-study that can no longer open its own sessions. Indexes can only be
        // created inside the version-change transaction, which is what `tx` is.
        const store = tx.objectStore(spec.name);
        for (const idx of spec.indexes ?? []) {
          if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath);
        }
      }
    },
  });
  // A failed open must not be cached as a permanent rejection: the next call should try again.
  _dbPromise.catch(() => { _dbPromise = null; });
  return _dbPromise;
}

/** ---- In-memory fallback (file:// or no IndexedDB) ---- */
const memStores = new Map<string, Map<unknown, unknown>>();
function memStore(name: string): Map<unknown, unknown> {
  let s = memStores.get(name);
  if (!s) {
    s = new Map();
    memStores.set(name, s);
  }
  return s;
}
function keyOf(name: StoreName | 'meta', record: Record<string, unknown>): unknown {
  const spec = STORE_SPECS.find((s) => s.name === name)!;
  return record[spec.keyPath];
}

// ---- Typed API ----

export async function put<N extends StoreName>(store: N, record: StoreMap[N]): Promise<void> {
  if (!indexedDBAvailable()) {
    memStore(store).set(keyOf(store, record as unknown as Record<string, unknown>), record);
    return;
  }
  const db = await getDB();
  await db.put(store, record);
}

export async function get<N extends StoreName>(
  store: N,
  key: IDBValidKey,
): Promise<StoreMap[N] | undefined> {
  if (!indexedDBAvailable()) return memStore(store).get(key) as StoreMap[N] | undefined;
  const db = await getDB();
  return db.get(store, key) as Promise<StoreMap[N] | undefined>;
}

export async function getAll<N extends StoreName>(store: N): Promise<StoreMap[N][]> {
  if (!indexedDBAvailable()) return [...memStore(store).values()] as StoreMap[N][];
  const db = await getDB();
  return db.getAll(store) as Promise<StoreMap[N][]>;
}

export async function getAllByIndex<N extends StoreName>(
  store: N,
  index: string,
  value: IDBValidKey,
): Promise<StoreMap[N][]> {
  if (!indexedDBAvailable()) {
    const spec = STORE_SPECS.find((s) => s.name === store)!;
    const idxKeyPath = spec.indexes?.find((i) => i.name === index)?.keyPath;
    return [...memStore(store).values()].filter(
      (r) => idxKeyPath && (r as Record<string, unknown>)[idxKeyPath] === value,
    ) as StoreMap[N][];
  }
  const db = await getDB();
  return db.getAllFromIndex(store, index, value) as Promise<StoreMap[N][]>;
}

export async function remove(store: StoreName, key: IDBValidKey): Promise<void> {
  if (!indexedDBAvailable()) {
    memStore(store).delete(key);
    return;
  }
  const db = await getDB();
  await db.delete(store, key);
}

/**
 * The enrolment number a NEW participant would receive, WITHOUT consuming it.
 *
 * Used to preview the counterbalanced illumination assignment while the researcher is still
 * typing the participant id. Calling nextEnrolmentNumber() for a preview would burn a number on
 * every keystroke and tear holes in the Williams allocation, which depends on a dense sequence.
 */
export async function peekNextEnrolmentNumber(): Promise<number> {
  if (!indexedDBAvailable()) {
    const meta = memStore('meta');
    return ((meta.get('enrolment_counter') as { key: string; value: number } | undefined)?.value ?? 0) + 1;
  }
  const db = await getDB();
  const rec = (await db.get('meta', 'enrolment_counter')) as { key: string; value: number } | undefined;
  return (rec?.value ?? 0) + 1;
}

/**
 * Atomically allocate the next sequential enrolment number (1-based). Uses a readwrite
 * transaction on `meta` so concurrent session creation can't collide.
 */
export async function nextEnrolmentNumber(): Promise<number> {
  if (!indexedDBAvailable()) {
    const meta = memStore('meta');
    const cur = ((meta.get('enrolment_counter') as { key: string; value: number } | undefined)
      ?.value ?? 0) + 1;
    meta.set('enrolment_counter', { key: 'enrolment_counter', value: cur });
    return cur;
  }
  const db = await getDB();
  const tx = db.transaction('meta', 'readwrite');
  const rec = (await tx.store.get('enrolment_counter')) as
    | { key: string; value: number }
    | undefined;
  const next = (rec?.value ?? 0) + 1;
  // If the counter did not actually advance, the stored value is beyond safe integer arithmetic and
  // every subsequent participant would share this number — and therefore share a condition order
  // and an illumination assignment — while being recorded as a distinct enrolment.
  if (!Number.isSafeInteger(next) || next <= (rec?.value ?? 0)) {
    throw new Error(
      `Enrolment counter is corrupt (${String(rec?.value)}): it can no longer be incremented, so `
      + 'every further participant would receive the same counterbalancing. Stop and fix this '
      + 'device before enrolling anyone else.',
    );
  }
  await tx.store.put({ key: 'enrolment_counter', value: next });
  await tx.done;
  return next;
}

/**
 * Raise the enrolment counter so it will never re-issue a number at or below `used`.
 *
 * The enrolment number is the sole input to both the Williams condition order and the illumination
 * order, so two participants sharing one is not a bookkeeping annoyance: they receive identical
 * condition orders while the dataset records them as distinct enrolments, and the counterbalance
 * silently stops being balanced.
 *
 * A replacement tablet starts its counter at zero. Restoring a session onto it without this would
 * leave the device ready to issue enrolment 1 again, to a different participant. Called on import
 * so the counter always dominates every enrolment number the device has seen.
 *
 * Returns the counter value in force afterwards.
 */
/**
 * Upper bound on a plausible enrolment number for this study (target n = 130, 145 enrolled).
 * Generous by two orders of magnitude, and far below where integer arithmetic stops incrementing.
 */
export const MAX_PLAUSIBLE_ENROLMENT = 100_000;

export async function ensureEnrolmentAtLeast(used: number): Promise<number> {
  /**
   * Number.isFinite admits 1e17. Above 2^53 the IEEE-754 spacing exceeds 1, so `value + 1 === value`
   * and nextEnrolmentNumber() returns the SAME number for ever. The enrolment number is the sole
   * input to the Williams condition order and the illumination assignment, so every participant
   * enrolled afterwards would receive an identical order while being recorded as a distinct
   * enrolment. Nothing lowers the counter, so it is not recoverable in the field.
   */
  if (!Number.isSafeInteger(used) || used < 1 || used > MAX_PLAUSIBLE_ENROLMENT) {
    return peekNextEnrolmentNumber().then((n) => n - 1);
  }
  const target = Math.floor(used);
  if (!indexedDBAvailable()) {
    const meta = memStore('meta');
    const cur = (meta.get('enrolment_counter') as { key: string; value: number } | undefined)?.value ?? 0;
    const next = Math.max(cur, target);
    meta.set('enrolment_counter', { key: 'enrolment_counter', value: next });
    return next;
  }
  const db = await getDB();
  const tx = db.transaction('meta', 'readwrite');
  const rec = (await tx.store.get('enrolment_counter')) as { key: string; value: number } | undefined;
  const next = Math.max(rec?.value ?? 0, target);
  await tx.store.put({ key: 'enrolment_counter', value: next });
  await tx.done;
  return next;
}

/**
 * Delete every row in `store` belonging to `conditionId`.
 *
 * Resume deliberately reuses the condition_id of an interrupted condition so that redoing it
 * OVERWRITES its rows rather than creating orphans. That works only for stores whose keyPath IS
 * condition_id. Three per-condition stores are keyed by their own uuid instead —
 * comprehension_results, display_perception and fatigue_scores — so a redo appended a second set
 * beside the first.
 *
 * For comprehension that is not merely untidy. The per-condition score is a proportion over the
 * rows present, so two attempts of a three-item passage yield six rows and a score of 0.5, a value
 * the codebook states cannot occur. Calling this immediately before rewriting a condition's rows
 * restores the intended "a redo replaces the attempt" semantics for every store.
 */
export async function clearConditionRows(store: StoreName, conditionId: string): Promise<void> {
  const spec = STORE_SPECS.find((s) => s.name === store);
  const keyPath = spec?.keyPath;
  if (!keyPath) return;
  const rows = await getAllByIndex(store, 'by_condition', conditionId);
  for (const row of rows) {
    const key = (row as unknown as Record<string, IDBValidKey>)[keyPath];
    if (key !== undefined) await remove(store, key);
  }
}

/**
 * Remove a session's rows for one CVS-Q stage, so re-administering it replaces rather than appends.
 *
 * A crash between the closing CVS-Q and the NASA-TLX left the resume pointer past the last
 * condition, which resumes at CVSQ_END — so the participant answered the sixteen items a second
 * time and the session shipped two `session_end` rows with different totals. The integrity audit
 * checked only that each stage was PRESENT, so it reported nothing, and the CVS-Q change score —
 * the study's key secondary outcome — became ambiguous for that participant, with whichever row the
 * analyst's join happened to pick being the post-rest one and biased low.
 */
export async function clearSessionStageRows(
  store: 'cvsq_scores' | 'fatigue_scores',
  sessionId: string,
  stage: string,
): Promise<void> {
  const spec = STORE_SPECS.find((s) => s.name === store);
  const keyPath = spec?.keyPath;
  if (!keyPath) return;
  const rows = await getAllByIndex(store, 'by_session', sessionId);
  for (const row of rows) {
    const r = row as unknown as Record<string, unknown>;
    if (r.stage !== stage) continue;
    // Only session-level rows: a post-condition fatigue row belongs to its condition, not here.
    if (r.condition_id != null) continue;
    const key = r[keyPath] as IDBValidKey | undefined;
    if (key !== undefined) await remove(store, key);
  }
}

/** Test-only: reset the in-memory fallback + cached connection. */
export function _resetForTests(): void {
  memStores.clear();
  _dbPromise = null;
  _supersededByNewerBuild = false;
}
