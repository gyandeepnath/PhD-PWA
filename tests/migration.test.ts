/**
 * IndexedDB schema migration.
 *
 * There was no test for this, and the upgrade path is the one code path that runs exactly once per
 * device, on a device that already holds data that cannot be re-collected. Getting it wrong is not
 * a bug that shows up in development: a fresh install creates every store and index correctly and
 * looks fine. It shows up on a study tablet, mid-recruitment, after an update.
 *
 * The bug this suite was written against: the upgrade handler created any store that did not exist,
 * but never created an INDEX that did not exist on a store that did. gatherSession reads every
 * child store through getAllByIndex(store, 'by_session', ...), so a device upgraded from a version
 * whose store lacked that index would throw NotFoundError on a store full of real measurements —
 * data present, unreadable, and unexportable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { DB_NAME, DB_VERSION } from '@/storage/schemaEnums';
import { getAll, getAllByIndex, put, _resetForTests, peekNextEnrolmentNumber } from '@/storage/db';
import { gatherSession } from '@/storage/gather';
import { buildFixtureBundle } from '@/sim/bundleFixture';

function freshDb() {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
}

/**
 * A database as an older build left it: the version is behind, one store is missing entirely, and
 * one store exists WITHOUT the by_session index. Both are shapes a real upgrade has to survive.
 */
async function seedLegacyDb(): Promise<void> {
  const db = await openDB(DB_NAME, DB_VERSION - 1, {
    upgrade(d) {
      d.createObjectStore('sessions', { keyPath: 'session_id' })
        .createIndex('by_participant', 'participant_id');
      d.createObjectStore('participants', { keyPath: 'participant_id' });
      d.createObjectStore('conditions', { keyPath: 'condition_id' })
        .createIndex('by_session', 'session_id');
      // Deliberately WITHOUT by_session: this is the shape that broke.
      d.createObjectStore('reaction_trials', { keyPath: 'trial_id' })
        .createIndex('by_condition', 'condition_id');
      d.createObjectStore('meta', { keyPath: 'key' });
      // nasa_tlx, eye_metrics, media_captures and the rest are absent entirely.
    },
  });

  const b = buildFixtureBundle();
  const tx = db.transaction(['sessions', 'participants', 'conditions', 'reaction_trials', 'meta'], 'readwrite');
  await tx.objectStore('sessions').put(b.session);
  if (b.participant) await tx.objectStore('participants').put(b.participant);
  for (const c of b.conditions) await tx.objectStore('conditions').put(c);
  for (const r of b.reactionTrials) await tx.objectStore('reaction_trials').put(r);
  await tx.objectStore('meta').put({ key: 'enrolment_counter', value: 7 });
  await tx.done;
  db.close();
}

describe('upgrading a device that already holds a study', () => {
  beforeEach(freshDb);

  it('keeps every record that was already there', async () => {
    const b = buildFixtureBundle();
    await seedLegacyDb();

    // First access through the app's own layer performs the upgrade.
    const sessions = await getAll('sessions');
    expect(sessions).toHaveLength(1);
    expect((await getAll('conditions'))).toHaveLength(b.conditions.length);
    expect((await getAll('reaction_trials'))).toHaveLength(b.reactionTrials.length);
    expect((await getAll('participants'))).toHaveLength(1);
  });

  it('adds an index that a later schema version introduced on an EXISTING store', async () => {
    // The legacy reaction_trials store has by_condition but not by_session. If the upgrade does not
    // add it, this throws rather than returning rows — which is what a tablet mid-study would do.
    const b = buildFixtureBundle();
    await seedLegacyDb();

    const rows = await getAllByIndex('reaction_trials', 'by_session', b.session.session_id);
    expect(rows.length).toBe(b.reactionTrials.length);
  });

  it('creates the stores a later schema version added, empty and usable', async () => {
    const b = buildFixtureBundle();
    await seedLegacyDb();

    expect(await getAll('nasa_tlx')).toEqual([]);
    await put('nasa_tlx', b.tlx[0]);
    expect(await getAll('nasa_tlx')).toHaveLength(1);
    expect(await getAll('media_captures')).toEqual([]);
    expect(await getAll('eye_metrics')).toEqual([]);
  });

  it('preserves the enrolment counter, which drives every condition order', async () => {
    // Re-issuing a used enrolment number gives two participants the same Williams order. An upgrade
    // that reset the counter would do exactly that, silently.
    await seedLegacyDb();
    expect(await peekNextEnrolmentNumber()).toBe(8);
  });

  it('leaves the migrated session gatherable and exportable', async () => {
    // The end-to-end property: after the upgrade the app can still read a whole session back out.
    // gatherSession reads every child store by index, so this exercises the whole index surface.
    const b = buildFixtureBundle();
    await seedLegacyDb();

    const restored = await gatherSession(b.session.session_id);
    expect(restored).not.toBeNull();
    expect(restored!.conditions).toHaveLength(b.conditions.length);
    expect(restored!.reactionTrials).toHaveLength(b.reactionTrials.length);
    expect(restored!.participant).toBeDefined();
    // Stores that did not exist in the legacy database come back empty, not undefined.
    expect(restored!.tlx).toEqual([]);
    expect(restored!.media).toEqual([]);
  });

  it('is idempotent: opening again at the same version changes nothing', async () => {
    const b = buildFixtureBundle();
    await seedLegacyDb();
    await getAll('sessions');

    _resetForTests();
    const again = await gatherSession(b.session.session_id);
    expect(again!.conditions).toHaveLength(b.conditions.length);
    expect(again!.reactionTrials).toHaveLength(b.reactionTrials.length);
  });
});
