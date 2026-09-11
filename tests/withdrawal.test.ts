/**
 * A participant who withdraws must be recorded as having withdrawn.
 *
 * The tombstone existed and nothing set it. `withdrawn_at` is exported by analysisExport as the
 * `withdrawn` column, blocked on twice by joinIntegrity, and deliberately carried through a backup
 * restore UNCHANGED while `deleted_at` is cleared — precisely so a withdrawal survives what a bin
 * does not. The operator manual §6 tells the operator to "record the withdrawal so the sitting is
 * excluded from analysis rather than merely incomplete". No code anywhere assigned it.
 *
 * So the operator's only route was Delete, which puts the session in the thirty-day recycle bin,
 * and which a restore from any backup file silently reverses — bringing a withdrawn participant's
 * session back into the active list with nothing marking it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { put, get, getAllByIndex, _resetForTests } from '@/storage/db';
import { recordWithdrawal, softDeleteSession } from '@/storage/gather';
import { parseSessionBackup, serialiseSessionBackup, importSessionBackup } from '@/storage/backup';
import { buildFixtureBundle, withFixtureMedia } from '@/sim/bundleFixture';
import type { SessionRecord } from '@/storage/types';

const fresh = async () => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); };

describe('recording a withdrawal', () => {
  beforeEach(fresh);

  const seed = async () => {
    const b = withFixtureMedia(buildFixtureBundle());
    await put('sessions', b.session);
    for (const m of b.media) await put('media_captures', { ...m, blob: new Blob(['x']) } as never);
    return b;
  };

  it('stamps the tombstone the analysis reads', async () => {
    const b = await seed();
    await recordWithdrawal(b.session.session_id);
    const after = await get('sessions', b.session.session_id) as SessionRecord;
    expect(after.withdrawn_at).toBeTypeOf('number');
  });

  it('destroys the recordings, because a face cannot be defensibly retained past a withdrawal', async () => {
    const b = await seed();
    const { mediaDestroyed } = await recordWithdrawal(b.session.session_id);
    expect(mediaDestroyed).toBeGreaterThan(0);
    expect(await getAllByIndex('media_captures', 'by_session', b.session.session_id)).toHaveLength(0);
  });

  it('withdraws the media grants too, so nothing further can be captured or exported', async () => {
    const b = await seed();
    await recordWithdrawal(b.session.session_id);
    const after = await get('sessions', b.session.session_id) as SessionRecord;
    expect(after.media_consent?.setup_photos).toBe(false);
    expect(after.media_consent?.annotation_video).toBe(false);
    expect(after.media_consent_revoked_at).toBeTypeOf('number');
  });

  it('KEEPS the measurements — this is the retain-and-exclude branch, not the delete one', async () => {
    const b = await seed();
    await recordWithdrawal(b.session.session_id);
    expect(await get('sessions', b.session.session_id)).toBeTruthy();
  });

  it('keeps the first withdrawal time if it is recorded twice', async () => {
    const b = await seed();
    await recordWithdrawal(b.session.session_id);
    const first = (await get('sessions', b.session.session_id) as SessionRecord).withdrawn_at;
    await recordWithdrawal(b.session.session_id);
    expect((await get('sessions', b.session.session_id) as SessionRecord).withdrawn_at).toBe(first);
  });

  it('does nothing, and does not throw, for a session that is not here', async () => {
    await expect(recordWithdrawal('no-such-session')).resolves.toEqual({ mediaDestroyed: 0 });
  });
});

describe('a withdrawal outlives a restore, and a deletion does not', () => {
  beforeEach(fresh);

  it('survives re-importing the backup that predates it', async () => {
    // This is the whole reason the two tombstones are separate. deleted_at is cleared on restore —
    // deliberately, so a session does not come back invisible in the bin — which means Delete alone
    // could not carry a withdrawal across a restore.
    const b = buildFixtureBundle();
    const file = serialiseSessionBackup(b);
    await importSessionBackup(parseSessionBackup(file).backup!);

    await recordWithdrawal(b.session.session_id);
    await softDeleteSession(b.session.session_id);

    await importSessionBackup(parseSessionBackup(file).backup!, 'overwrite');
    const after = await get('sessions', b.session.session_id) as SessionRecord;
    expect(after.withdrawn_at, 'the withdrawal was reversed by a restore').toBeTypeOf('number');
    expect(after.deleted_at, 'the bin is correctly cleared on restore').toBeNull();
  });
});

describe('the operator has the control the manual tells them to use', () => {
  const manager = readFileSync('src/start/SessionManager.tsx', 'utf8');
  const manual = readFileSync('docs/OPERATOR_MANUAL.md', 'utf8');

  it('is wired to recordWithdrawal', () => {
    expect(manager).toMatch(/recordWithdrawal\(s\.session_id\)/);
    expect(manager).toMatch(/withdraw\(s\)/);
  });

  it('offers it on both in-progress and completed sittings', () => {
    // A participant withdraws mid-sitting far more often than after one.
    expect(manager.match(/withdraw\(s\)/g) ?? []).toHaveLength(2);
  });

  it('tells the operator to ask which the participant wants, rather than choosing for them', () => {
    const body = manager.slice(manager.indexOf('const withdraw ='), manager.indexOf('const del ='));
    expect(body).toMatch(/NOT asked for their data to be deleted/);
    expect(body).toMatch(/DESTROYED/);
    expect(body).toMatch(/recycle bin/);
  });

  it('the manual points at the control by the name on the button', () => {
    // The manual told the operator to "record the withdrawal" for a control that did not exist.
    // Now it names the button, so the instruction and the interface cannot drift apart silently.
    expect(manual).toMatch(/press \*\*Withdrew\*\*/);
    expect(manual).toMatch(/survives a restore from a backup/);
  });
});
