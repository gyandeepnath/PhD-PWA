/**
 * Storage health.
 *
 * Everything a session produces lives in this device's IndexedDB until it is exported. Three
 * browser behaviours can destroy it without ever raising an error, and the application had no way
 * to see any of them coming:
 *
 *   1. EPHEMERAL STORAGE. In a private or incognito window IndexedDB works normally and is
 *      discarded when the tab closes. An operator who launches the app in a private tab runs a
 *      full ninety-minute session, watches every write succeed, and loses the participant's data
 *      on close with no error at any point. This is the worst path in the system, because nothing
 *      about it looks wrong until the data is already gone.
 *
 *   2. EVICTION. Without an explicit persistence grant the origin is "best-effort", which means
 *      the browser may reclaim it under storage pressure. `navigator.storage.persist()` asks for
 *      the durable grant; on an installed PWA it is normally given without a prompt.
 *
 *   3. QUOTA. A session accumulates reaction trials, ocular samples and, where consented, a
 *      three-minute video. Exceeding the quota rejects the write, and a rejected write in the
 *      experiment flow used to stall the session silently.
 *
 * This module reports on all three BEFORE a session starts, so the failure is caught while it is
 * still an inconvenience rather than a lost participant. The result is also stamped into the
 * session record, so the analyst can tell whether a given sitting ran on durable storage.
 *
 * Every API used here is optional in older browsers. Absence is reported as "unknown", never as
 * "fine": a check that cannot run has not passed.
 */

export type StorageVerdict = 'ok' | 'warn' | 'blocked' | 'unknown';

export interface StorageHealth {
  verdict: StorageVerdict;
  /** True when the browser has granted durable storage for this origin. */
  persisted: boolean | null;
  /** Bytes currently used and the quota, where the browser reports them. */
  usageBytes: number | null;
  quotaBytes: number | null;
  availableMb: number | null;
  /** Operator-facing lines, most serious first. Written for a research assistant. */
  messages: string[];
}

/**
 * Headroom a full sitting needs. A session without media runs to a few megabytes; the annotation
 * video dominates when it is consented. 300 MB is comfortable for one sitting plus the ~17 MB
 * precache, and small enough not to fail on a modest tablet.
 */
const REQUIRED_HEADROOM_MB = 300;

function supported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage;
}

/**
 * Ask for durable storage, then report what the browser actually granted.
 *
 * Called once before a session rather than at app start, so the prompt (where a browser shows one)
 * appears while the operator is setting up rather than in front of the participant.
 */
export async function requestPersistence(): Promise<boolean | null> {
  if (!supported() || typeof navigator.storage.persist !== 'function') return null;
  try {
    if (typeof navigator.storage.persisted === 'function' && (await navigator.storage.persisted())) {
      return true;
    }
    return await navigator.storage.persist();
  } catch {
    // A browser that throws here has told us nothing, which is not the same as saying no.
    return null;
  }
}

export async function assessStorageHealth(): Promise<StorageHealth> {
  const messages: string[] = [];

  if (!supported()) {
    return {
      verdict: 'unknown',
      persisted: null,
      usageBytes: null,
      quotaBytes: null,
      availableMb: null,
      messages: ['This browser does not report storage status, so durability could not be checked. Export after every session and copy the export off the device the same day.'],
    };
  }

  const persisted = await requestPersistence();

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let availableMb: number | null = null;
  try {
    if (typeof navigator.storage.estimate === 'function') {
      const e = await navigator.storage.estimate();
      usageBytes = e.usage ?? null;
      quotaBytes = e.quota ?? null;
      if (usageBytes != null && quotaBytes != null) {
        availableMb = Math.round((quotaBytes - usageBytes) / (1024 * 1024));
      }
    }
  } catch {
    /* estimate is advisory; its absence is reported through availableMb staying null. */
  }

  let verdict: StorageVerdict = 'ok';
  const worse = (v: StorageVerdict) => {
    const rank: Record<StorageVerdict, number> = { ok: 0, unknown: 1, warn: 2, blocked: 3 };
    if (rank[v] > rank[verdict]) verdict = v;
  };

  /**
   * A very small quota is the signature of an ephemeral or heavily restricted context — private
   * browsing typically reports a fraction of the normal allowance. It is a heuristic, not a
   * detection: no browser exposes "you are in a private window". Treating it as blocking is the
   * right trade, because the cost of a false positive is one puzzled operator and the cost of a
   * false negative is a whole session.
   */
  if (quotaBytes != null && quotaBytes < 50 * 1024 * 1024) {
    worse('blocked');
    messages.push('This browser is reporting a very small storage allowance, which usually means a private or incognito window. Data written here is destroyed when the tab closes. Close this window and reopen the app normally before starting a session.');
  }

  if (persisted === false) {
    worse('warn');
    messages.push('The browser has not granted durable storage, so this data could be cleared automatically if the device runs low on space. Install the app to the home screen and reopen it from there, then re-run this check.');
  } else if (persisted === null) {
    worse('unknown');
    messages.push('Durable storage could not be confirmed on this browser. Export after every session rather than relying on the tablet to hold the data.');
  }

  if (availableMb != null && availableMb < REQUIRED_HEADROOM_MB) {
    worse(availableMb < 50 ? 'blocked' : 'warn');
    messages.push(`Only about ${availableMb} MB of storage is free. A sitting needs roughly ${REQUIRED_HEADROOM_MB} MB, more when video is consented. Export and remove older sessions before continuing.`);
  }

  if (verdict === 'ok') {
    messages.push(`Storage is durable and about ${availableMb ?? '?'} MB is free.`);
  }

  return { verdict, persisted, usageBytes, quotaBytes, availableMb, messages };
}
