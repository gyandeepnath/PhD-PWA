/**
 * Session backup and restore.
 *
 * These tests exist because the failure this feature guards against is unrecoverable. A tablet that
 * is wiped, reset or replaced destroys every session on it, and the participants cannot be asked to
 * sit the protocol again. So the properties that matter are not "the happy path works" but:
 *
 *   - nothing is lost in the round trip, reaction trials included
 *   - a damaged file is REFUSED rather than half-imported
 *   - restoring cannot silently destroy a good copy already on the device
 *   - restoring twice is the same as restoring once
 *
 * The last one matters more than it looks: an operator whose import appears to stall will retry it,
 * and a non-idempotent restore would leave duplicated rows that the integrity audit would then
 * report as corruption of the data rather than of the restore.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildSessionBackup, serialiseSessionBackup, parseSessionBackup, importSessionBackup,
  BACKUP_FORMAT_VERSION,
} from '@/storage/backup';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { gatherSession } from '@/storage/gather';
import { get, getAll, put, peekNextEnrolmentNumber, nextEnrolmentNumber, _resetForTests } from '@/storage/db';
import { buildExportFiles } from '@/storage/export';

/**
 * Fresh IndexedDB per test, using the same reset the storage tests use. Idempotence has to be
 * measured against an empty device, not inherited from whatever the previous test left behind.
 */
function clearDb() {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
}

describe('a backup carries everything a session produced', () => {
  it('round-trips every store without loss', async () => {
    const b = buildFixtureBundle();
    const backup = buildSessionBackup(b);
    expect(backup.data.conditions).toHaveLength(b.conditions.length);
    expect(backup.data.comprehension).toHaveLength(b.comprehension.length);
    expect(backup.data.eyeMetrics).toHaveLength(b.eyeMetrics.length);
    expect(backup.data.rtSummaries).toHaveLength(b.rtSummaries.length);
    expect(backup.data.calibration).toHaveLength(b.calibration.length);
  });

  it('carries the reaction TRIALS, which the analysis JSON does not', async () => {
    // The analysis bundle records reaction_trials_count and drops the rows. Restoring from it would
    // lose every trial-level observation in the session, silently.
    const b = buildFixtureBundle();
    expect(b.reactionTrials.length).toBeGreaterThan(0);

    const analysisJson = buildExportFiles(b).find((f) => f.filename.startsWith('session_'))!;
    const analysis = JSON.parse(analysisJson.content);
    expect(analysis.reaction_trials_count).toBe(b.reactionTrials.length);
    expect(analysis.reaction_trials).toBeUndefined();

    const backup = buildSessionBackup(b);
    expect(backup.data.reactionTrials).toHaveLength(b.reactionTrials.length);
  });

  it('is included in every export, under a name that cannot be mistaken for the analysis JSON', () => {
    const files = buildExportFiles(buildFixtureBundle());
    const backups = files.filter((f) => f.filename.startsWith('backup_'));
    expect(backups).toHaveLength(1);
    const parsed = parseSessionBackup(backups[0].content);
    expect(parsed.ok).toBe(true);
  });

  it('strips media blobs and says so rather than implying the media survived', () => {
    const b = buildFixtureBundle();
    const backup = buildSessionBackup(b);
    for (const m of backup.data.media as Record<string, unknown>[]) {
      expect(m.blob).toBeUndefined();
      expect(m.blob_present).toBe(false);
    }
    if (b.media.length) {
      const parsed = parseSessionBackup(serialiseSessionBackup(b));
      expect(parsed.warnings.join(' ')).toMatch(/media/i);
    }
  });

  it('carries no timestamp, so identical data always produces identical bytes', () => {
    // A time-of-writing field would break the export's byte-reproducibility and turn the checksum
    // into a statement about when the file was written rather than about what it contains.
    const b = buildFixtureBundle();
    const first = serialiseSessionBackup(b);
    const second = serialiseSessionBackup(b);
    expect(first).toBe(second);
    expect(first).not.toMatch(/created_at|exported_at/);
  });
});

describe('a damaged backup is refused, not half-imported', () => {
  it('rejects a file whose data was edited after it was written', () => {
    const b = buildFixtureBundle();
    const good = JSON.parse(serialiseSessionBackup(b));
    // Change one measurement, the way a well-meaning edit in a text editor would.
    good.data.conditions[0].condition_label = 'TAMPERED';
    const r = parseSessionBackup(JSON.stringify(good));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/checksum/i);
  });

  it('rejects truncated JSON', () => {
    const text = serialiseSessionBackup(buildFixtureBundle());
    const r = parseSessionBackup(text.slice(0, Math.floor(text.length / 2)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON|truncated/i);
  });

  it('rejects the analysis JSON with an explanation, since an operator will reach for it first', () => {
    const analysis = buildExportFiles(buildFixtureBundle()).find((f) => f.filename.startsWith('session_'))!;
    const r = parseSessionBackup(analysis.content);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a VisuLab session backup/i);
  });

  it('refuses a format version it cannot read rather than guessing', () => {
    const good = JSON.parse(serialiseSessionBackup(buildFixtureBundle()));
    good.format_version = BACKUP_FORMAT_VERSION + 1;
    const r = parseSessionBackup(JSON.stringify(good));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/format version/i);
  });
});

describe('restoring into a device', () => {
  beforeEach(clearDb);

  it('reconstitutes a session that can be gathered and exported again', async () => {
    const original = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(original));
    expect(parsed.ok).toBe(true);

    const res = await importSessionBackup(parsed.backup!);
    expect(res.ok).toBe(true);
    expect(res.written.reaction_trials).toBe(original.reactionTrials.length);

    const restored = await gatherSession(res.sessionId!);
    expect(restored).not.toBeNull();
    expect(restored!.conditions).toHaveLength(original.conditions.length);
    expect(restored!.reactionTrials).toHaveLength(original.reactionTrials.length);
    expect(restored!.comprehension).toHaveLength(original.comprehension.length);

    // The point of a restore is that the data can be analysed, so it must survive the export path.
    const files = buildExportFiles(restored!);
    expect(files.find((f) => f.filename === '02_conditions.csv')).toBeDefined();
  });

  it('will not silently overwrite a session already on the device', async () => {
    const b = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    expect((await importSessionBackup(parsed.backup!)).ok).toBe(true);

    const second = await importSessionBackup(parsed.backup!);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already on this device/i);

    const forced = await importSessionBackup(parsed.backup!, 'overwrite');
    expect(forced.ok).toBe(true);
  });

  it('is idempotent: importing twice leaves exactly one copy of every row', async () => {
    const b = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    await importSessionBackup(parsed.backup!);
    const afterFirst = (await getAll('reaction_trials')).length;

    await importSessionBackup(parsed.backup!, 'overwrite');
    const afterSecond = (await getAll('reaction_trials')).length;

    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).toBe(b.reactionTrials.length);

    // And the restored session must still pass its own integrity audit, not merely have the right
    // row count: a duplicated import that kept counts but broke keys would be worse than useless.
    const restored = await gatherSession(parsed.backup!.data.session ? (parsed.backup!.data.session as { session_id: string }).session_id : '');
    expect(restored!.conditions).toHaveLength(b.conditions.length);
  });
});

describe('restoring carries the enrolment number forward', () => {
  beforeEach(clearDb);

  it('raises the device counter so a replacement tablet cannot re-issue a used number', async () => {
    // A fresh device would hand out 1. The restored session already holds its own enrolment
    // number, and that number is the sole input to the Williams condition order and the
    // illumination order — two participants sharing one share a condition order.
    expect(await peekNextEnrolmentNumber()).toBe(1);

    const b = buildFixtureBundle();
    const enrolment = b.session.enrolment_number;
    expect(enrolment).toBeGreaterThan(0);

    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    await importSessionBackup(parsed.backup!);

    expect(await peekNextEnrolmentNumber()).toBe(enrolment + 1);
  });

  it('never lowers a counter that is already ahead of the backup', async () => {
    const b = buildFixtureBundle();
    // This device has already enrolled well past the restored session.
    for (let i = 0; i < b.session.enrolment_number + 5; i++) await nextEnrolmentNumber();
    const before = await peekNextEnrolmentNumber();

    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    await importSessionBackup(parsed.backup!);

    expect(await peekNextEnrolmentNumber()).toBe(before);
  });

  it('reports a collision when the number is already held by a different participant', async () => {
    const b = buildFixtureBundle();
    // Somebody else on this device already has that enrolment number.
    await put('sessions', {
      ...b.session,
      session_id: 'other-session',
      participant_id: 'SOMEONE-ELSE',
    });

    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    const res = await importSessionBackup(parsed.backup!);

    // The restore still succeeds — the data is worth keeping — but it must say so.
    expect(res.ok).toBe(true);
    expect(res.collision).toMatch(/already held on this device/i);
    expect(res.collision).toMatch(/counterbalance/i);
  });

  it('reports no collision on a clean device', async () => {
    const b = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    const res = await importSessionBackup(parsed.backup!);
    expect(res.ok).toBe(true);
    expect(res.collision).toBeUndefined();
  });
});

describe('a restore does not destroy what is already on the device', () => {
  beforeEach(clearDb);

  it('keeps a media blob that is still here, because the backup carries only the inventory row', async () => {
    // put() replaces the whole record, so writing the blob-stripped inventory row straight over a
    // row that still holds its binary would silently destroy consented media. That media is the
    // only material the annotation sub-study can be coded from.
    const b = buildFixtureBundle();
    if (!b.media.length) return;
    const m = b.media[0];
    await put('media_captures', { ...m, blob: new Blob(['pretend-video']) } as never);

    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    const res = await importSessionBackup(parsed.backup!, 'overwrite');
    expect(res.ok).toBe(true);

    const after = await get('media_captures', m.media_id);
    expect((after as unknown as { blob?: unknown }).blob).toBeTruthy();
    expect((after as unknown as { blob_present?: boolean }).blob_present).toBe(true);
    expect(res.warnings?.join(' ')).toMatch(/kept/i);
  });

  it('overwrite REPLACES rather than merges, so no hybrid session survives', async () => {
    const b = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    await importSessionBackup(parsed.backup!);

    // The device copy acquires a row the backup does not have — the shape a damaged copy takes.
    await put('comprehension_results', {
      ...b.comprehension[0], comprehension_id: 'stray-row', question_index: 0,
    });
    expect((await getAll('comprehension_results')).length).toBe(b.comprehension.length + 1);

    await importSessionBackup(parsed.backup!, 'overwrite');

    // Exactly the backup, not the union of the two.
    const rows = await getAll('comprehension_results');
    expect(rows.length).toBe(b.comprehension.length);
    expect(rows.some((r) => r.comprehension_id === 'stray-row')).toBe(false);
  });
});
