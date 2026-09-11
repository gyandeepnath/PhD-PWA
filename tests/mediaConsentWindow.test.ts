/**
 * A recording must not survive the withdrawal of the consent it was taken under.
 *
 * captureMedia checks the PERSISTED grant before it starts, which is right and is what stops a
 * stale component capturing after a revocation. An annotation segment then runs for three minutes.
 *
 * A participant who says "stop recording me" part-way through is exactly what the revocation
 * control exists for, and revokeMediaGrant withdraws the grant and deletes the blobs that exist —
 * which the in-flight one does not yet. The recorder finished and the write stored a video of their
 * face, stamped with the consent_snapshot from before they withdrew.
 *
 * The export refused it afterwards, because that path checks the live grant, so it was never
 * analysed. It was still on the device, which is the wrong the grant exists to prevent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { put, get, getAllByIndex, _resetForTests } from '@/storage/db';
import { revokeMediaGrant, recordWithdrawal } from '@/storage/gather';
import { mayCapture } from '@/storage/media';
import { buildFixtureBundle, withFixtureMedia } from '@/sim/bundleFixture';
import type { SessionRecord } from '@/storage/types';

beforeEach(async () => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); });

describe('the grant is re-read after the recording, not only before it', () => {
  const src = readFileSync('src/experiment/Experiment.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const capture = src.slice(src.indexOf('const captureMedia = useCallback('), src.indexOf('}, [session, tracking]);'));

  it('checks before capture — the stale-component guard', () => {
    expect(capture).toMatch(/const fresh = await get\('sessions'[\s\S]*?mayCapture\(fresh\?\.media_consent, checkpoint\)/);
  });

  it('checks AGAIN immediately before the write', () => {
    const atWrite = capture.indexOf("const atWrite = await get('sessions'");
    const theWrite = capture.indexOf("await put('media_captures'");
    expect(atWrite, 'no second read of the grant').toBeGreaterThan(-1);
    expect(atWrite).toBeLessThan(theWrite);
    expect(capture).toMatch(/if \(!mayCapture\(atWrite\?\.media_consent, checkpoint\)\) return;/);
  });

  it('stamps the snapshot from the SECOND read, so it is the consent in force when stored', () => {
    expect(capture).toMatch(/consent_snapshot: atWrite!\.media_consent/);
    expect(capture, 'the pre-capture grant is still being stamped').not.toMatch(/consent_snapshot: fresh!/);
  });
});

describe('what the two revocation paths do to a grant', () => {
  const seed = async (): Promise<SessionRecord> => {
    const b = withFixtureMedia(buildFixtureBundle());
    await put('sessions', b.session);
    for (const m of b.media) await put('media_captures', { ...m, blob: new Blob(['v']) } as never);
    return b.session;
  };

  it('revoking the video grant makes a later write inadmissible', async () => {
    const s = await seed();
    expect(mayCapture((await get('sessions', s.session_id) as SessionRecord).media_consent, 'reading_segment')).toBe(true);
    await revokeMediaGrant(s.session_id, 'annotation_video');
    // This is the value the second read returns, and what the in-flight recording is now measured
    // against rather than the grant it began under.
    expect(mayCapture((await get('sessions', s.session_id) as SessionRecord).media_consent, 'reading_segment')).toBe(false);
  });

  it('a recorded withdrawal closes both grants and empties the store', async () => {
    const s = await seed();
    await recordWithdrawal(s.session_id);
    const after = await get('sessions', s.session_id) as SessionRecord;
    expect(mayCapture(after.media_consent, 'reading_segment')).toBe(false);
    expect(mayCapture(after.media_consent, 'session_start')).toBe(false);
    expect(await getAllByIndex('media_captures', 'by_session', s.session_id)).toHaveLength(0);
  });

  it('leaves the metrics grant alone, because it is separately given', async () => {
    // camera_metrics is the numbers, not the recordings. Revoking a recording grant must not
    // silently end the ocular measurement the participant did consent to.
    const s = await seed();
    await revokeMediaGrant(s.session_id, 'annotation_video');
    const after = await get('sessions', s.session_id) as SessionRecord;
    expect(after.media_consent?.camera_metrics).toBe(true);
  });
});
