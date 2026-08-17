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

function indexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function getDB(): Promise<IDBPDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Additive: create any store that does not yet exist (covers fresh installs and
      // forward-migration from an older version that lacks the v6 stores).
      for (const spec of STORE_SPECS) {
        if (!db.objectStoreNames.contains(spec.name)) {
          const store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
          for (const idx of spec.indexes ?? []) {
            store.createIndex(idx.name, idx.keyPath);
          }
        }
      }
    },
  });
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
  await tx.store.put({ key: 'enrolment_counter', value: next });
  await tx.done;
  return next;
}

/** Test-only: reset the in-memory fallback + cached connection. */
export function _resetForTests(): void {
  memStores.clear();
  _dbPromise = null;
}
