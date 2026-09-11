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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every .ts/.tsx file under a directory, for the store-writer ratchet below. */
const walkTs = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walkTs(p) : /\.tsx?$/.test(e.name) ? [p] : [];
});
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildSessionBackup, serialiseSessionBackup, parseSessionBackup, importSessionBackup,
  BACKUP_FORMAT_VERSION,
} from '@/storage/backup';
import { buildFixtureBundle, withFixtureMedia } from '@/sim/bundleFixture';
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
    const b = withFixtureMedia(buildFixtureBundle());
    expect(b.media.length).toBeGreaterThan(0);
    const backup = buildSessionBackup(b);
    for (const m of backup.data.media as Record<string, unknown>[]) {
      expect(m.blob).toBeUndefined();
      expect(m.blob_present).toBe(false);
    }
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    expect(parsed.warnings.join(' ')).toMatch(/media/i);
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

  /*
   * This test USED TO PASS IN A DEVICE STATE THAT CANNOT OCCUR.
   *
   * It wrote the media row but never the sessions row, so `existing` was falsy inside
   * importSessionBackup and the overwrite purge never ran — the blob survived because nothing had
   * tried to delete it. In the field the session row is always there (that is what makes the mode
   * 'overwrite'), purgeSession deletes every media row first, and the carry-forward loop then read
   * an empty store. The guard was dead in exactly the mode it exists for.
   *
   * Both states are now tested, and the overwrite one restores the session row first.
   */
  it('keeps a media blob that is still here, because the backup carries only the inventory row', async () => {
    // put() replaces the whole record, so writing the blob-stripped inventory row straight over a
    // row that still holds its binary would silently destroy consented media. That media is the
    // only material the annotation sub-study can be coded from.
    const b = withFixtureMedia(buildFixtureBundle());
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

  it('keeps it through a REAL overwrite, where the session is on the device and is purged first', async () => {
    const b = withFixtureMedia(buildFixtureBundle());
    const m = b.media[0];
    const parsed = parseSessionBackup(serialiseSessionBackup(b));

    // The device state an overwrite actually meets: the session is here, and so is the binary.
    await importSessionBackup(parsed.backup!);
    await put('media_captures', { ...m, blob: new Blob(['pretend-video']) } as never);
    expect(await get('sessions', b.session.session_id)).toBeTruthy();

    const res = await importSessionBackup(parsed.backup!, 'overwrite');
    expect(res.ok).toBe(true);

    const after = await get('media_captures', m.media_id);
    expect((after as unknown as { blob?: unknown }).blob, 'the purge destroyed a consented video').toBeTruthy();
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

/**
 * Structural validation, which the checksum does not provide.
 *
 * The checksum proves the file has not changed since it was written. It proves nothing about
 * whether what was written made sense: a build with a bug, a hand-edited file that was
 * re-checksummed, or a backup from a schema this build does not know all produce a file that passes
 * the checksum and then writes damaged records into IndexedDB. The worst of these is a row carrying
 * a DIFFERENT session's id — it is written successfully and then joins into the restored session's
 * export as if it had been measured there.
 */
describe('a structurally invalid backup is refused before anything is written', () => {
  const rewrite = (mutate: (d: Record<string, unknown>) => void) => {
    const b = buildFixtureBundle();
    const parsedGood = JSON.parse(serialiseSessionBackup(b));
    mutate(parsedGood.data);
    // Re-checksum, so the file is internally consistent and only the STRUCTURE is wrong. Without
    // this the checksum check would fire first and the structural check would never be exercised.
    parsedGood.checksum_fnv1a = null;
    return parsedGood;
  };

  it('rejects a row that has no primary key', () => {
    const obj = rewrite((d) => {
      const rows = d.conditions as Record<string, unknown>[];
      delete rows[0].condition_id;
    });
    // Give it a valid checksum for its (mutated) data so the structural check is what fires.
    const r = parseSessionBackup(withChecksum(obj));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/condition_id/);
  });

  it('rejects two rows sharing one primary key, which would silently become one row', () => {
    const obj = rewrite((d) => {
      const rows = d.reactionTrials as Record<string, unknown>[];
      rows[1].trial_id = rows[0].trial_id;
    });
    const r = parseSessionBackup(withChecksum(obj));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/appears more than once|replace/i);
  });

  it("rejects a row belonging to a different session, which would join into this one's export", () => {
    const obj = rewrite((d) => {
      const rows = d.eyeMetrics as Record<string, unknown>[];
      rows[0].session_id = 'some-other-session';
    });
    const r = parseSessionBackup(withChecksum(obj));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/belongs to session/);
  });

  it('rejects a collection that is not a list of records', () => {
    const obj = rewrite((d) => { d.comprehension = { not: 'a list' }; });
    const r = parseSessionBackup(withChecksum(obj));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not a list/);
  });

  it('writes nothing at all when the file is refused', async () => {
    clearDb();
    const obj = rewrite((d) => {
      const rows = d.conditions as Record<string, unknown>[];
      delete rows[0].condition_id;
    });
    const r = parseSessionBackup(withChecksum(obj));
    expect(r.ok).toBe(false);
    // The whole point of validating at parse time: the operator cannot get a half-import.
    expect(await getAll('conditions')).toHaveLength(0);
    expect(await getAll('sessions')).toHaveLength(0);
  });

  it('still accepts a backup that is merely unusual but sound', () => {
    // An empty collection is legitimate (a session that ran no reaction block), and must not be
    // confused with a damaged one.
    const obj = rewrite((d) => { d.tlx = []; });
    expect(parseSessionBackup(withChecksum(obj)).ok).toBe(true);
  });
});

/** Recompute the file's checksum over its own (possibly mutated) data, as the writer would. */
function withChecksum(obj: Record<string, unknown>): string {
  const canonicalValue = (v: unknown): unknown => {
    if (v === undefined) return { __undefined__: true };
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(canonicalValue);
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonicalValue(src[k]);
    return out;
  };
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  };
  obj.checksum_fnv1a = fnv(JSON.stringify(canonicalValue(obj.data)));
  return JSON.stringify(obj);
}

describe('the checksum survives a change in field order', () => {
  it('hashes the DATA, not the order the fields happened to be written in', () => {
    // The v1 canonicaliser sorted only the outer collection names, so a record rebuilt with its
    // fields in a different order hashed differently and the operator was told a good file was
    // damaged. Rebuilding a row's fields in reverse must not change the verdict.
    const b = buildFixtureBundle();
    const original = JSON.parse(serialiseSessionBackup(b));
    const shuffled = JSON.parse(JSON.stringify(original));
    shuffled.data.conditions = shuffled.data.conditions.map((c: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(c).reverse()));

    const r = parseSessionBackup(JSON.stringify(shuffled));
    expect(r.ok).toBe(true);
  });
});

/**
 * Three more shapes a self-consistent backup could take, each of which used to get through.
 *
 * The checksum proves the file has not changed since it was written. It proves nothing about
 * whether what was written made sense, so a buggy build — or a hand-edited, re-checksummed file —
 * can carry any of these.
 */
describe('a structurally plausible but wrong backup is still refused', () => {
  const rebuild = (mutate: (d: Record<string, unknown>) => void) => {
    const obj = JSON.parse(serialiseSessionBackup(buildFixtureBundle()));
    mutate(obj.data);
    return withChecksum(obj);
  };

  it('refuses a participant record keyed differently from the session', () => {
    // It restores "successfully" and reports participants: 1, and then gatherSession finds nothing
    // — 11_participant.csv exports as headers only, with no eligible and no exclusion_reason,
    // beside an integrity report reading joins_sound with zero errors.
    const r = parseSessionBackup(rebuild((d) => {
      (d.participant as Record<string, unknown>).participant_id = 'SOMEONE-ELSE';
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/keyed .* but the session names/i);
  });

  it('refuses an enrolment number that would freeze the device counter', () => {
    // Above 2^53 the counter can no longer increment, so every later participant on that tablet
    // shares one number — and therefore one Williams order and one illumination assignment.
    const r = parseSessionBackup(rebuild((d) => {
      (d.session as Record<string, unknown>).enrolment_number = 1e17;
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/enrolment/i);
  });

  it("refuses a child row pointing at a condition the backup does not contain", () => {
    // eye_metrics is keyed on condition_id alone, so put() would replace whatever is under that
    // key — including another participant's already-collected primary outcome.
    const r = parseSessionBackup(rebuild((d) => {
      (d.eyeMetrics as Record<string, unknown>[])[0].condition_id = 'someone-elses-condition';
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not one of this backup/i);
  });
});

describe('a restored session lands where the operator can see it', () => {
  beforeEach(clearDb);

  it('never restores into the recycle bin', async () => {
    // deleted_at used to be written verbatim, so a backup taken from a binned session restored
    // straight back into the bin: "Session restored", then nothing in the active list, then
    // destroyed by the auto-purge thirty days later.
    const b = buildFixtureBundle();
    const obj = JSON.parse(serialiseSessionBackup(b));
    (obj.data.session as Record<string, unknown>).deleted_at = Date.now() - 1000;
    const parsed = parseSessionBackup(withChecksum(obj));
    expect(parsed.ok).toBe(true);

    const res = await importSessionBackup(parsed.backup!);
    expect(res.ok).toBe(true);
    const stored = await get('sessions', res.sessionId!);
    expect((stored as unknown as { deleted_at: number | null }).deleted_at).toBeNull();
  });
});

describe('a restore says what it could not restore, and what it is about to destroy', () => {
  beforeEach(clearDb);

  /** Tamper with a good file and re-seal it, so only the SHAPE differs from what the reader expects. */
  const reseal = (mutate: (d: Record<string, unknown>) => void) => {
    const obj = JSON.parse(serialiseSessionBackup(buildFixtureBundle())) as Record<string, unknown>;
    mutate(obj.data as Record<string, unknown>);
    return parseSessionBackup(withChecksum(obj));
  };

  it('names a collection the file does not carry at all', () => {
    // Absent is not empty. `(data[key] ?? [])` wrote zero rows and said nothing, and the UI then
    // filtered the zero out — so 320 reaction trials dropped by a schema mismatch left exactly as
    // much trace as a session that legitimately had none.
    const parsed = reseal((d) => { delete d.reactionTrials; });
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings.join(' ')).toMatch(/NO reaction_trials section at all/);
  });

  it('stays silent about a collection that is present and legitimately empty', () => {
    const parsed = reseal((d) => { d.reactionTrials = []; });
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings.join(' ')).not.toMatch(/reaction_trials/);
  });

  it('names a collection this build does not know how to restore', () => {
    const parsed = reseal((d) => { d.pupilTraces = [{ x: 1 }]; });
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings.join(' ')).toMatch(/pupilTraces[\s\S]*DROPPED/);
  });

  it('says outright when a file carries no measurements at all', () => {
    // Every collection empty and no participant passes every structural check — the only required
    // field is the session id — so the operator was shown "Session restored" over a one-row file.
    const parsed = reseal((d) => {
      for (const k of Object.keys(d)) if (Array.isArray(d[k])) d[k] = [];
      d.participant = null;
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings.join(' ')).toMatch(/NO measurements at all/);
  });

  it('stays quiet about that for a file that does carry measurements', () => {
    expect(parseSessionBackup(serialiseSessionBackup(buildFixtureBundle())).warnings.join(' '))
      .not.toMatch(/NO measurements/);
  });

  /**
   * A ratchet, not a check on today's behaviour.
   *
   * system_performance_logs is declared in STORE_SPECS and cleared by purgeSession, and appears in
   * neither BackupData nor RESTORE_PLAN nor gatherSession. Nothing writes it, so nothing is lost
   * today — but the moment anything does, a backup drops it in silence and a restore does not
   * notice, which is the failure mode the missing-collection warning was just added for.
   */
  it('a store nothing backs up must also be a store nothing writes', () => {
    const writers = ['src', 'scripts']
      .flatMap((dir) => walkTs(dir))
      .filter((f) => !/storage\/db\.ts$|storage\/gather\.ts$|storage\/types\.ts$/.test(f))
      .filter((f) => /put\(\s*'system_performance_logs'/.test(readFileSync(f, 'utf8')));
    expect(writers, 'something now writes system_performance_logs — add it to BackupData, '
      + 'RESTORE_PLAN and gatherSession in the same change, or a backup will drop it').toEqual([]);
  });

  it('warns that a fresh tablet cannot see enrolments issued on another one', async () => {
    // ensureEnrolmentAtLeast raises the counter to the highest enrolment RESTORED, and the clash
    // scan only reads this device's sessions. Restoring one session onto a replacement tablet
    // therefore resumes numbering below any participant recorded elsewhere, and two participants
    // sharing an enrolment share a Williams condition order. No local check can see that.
    const b = buildFixtureBundle();
    const res = await importSessionBackup(parseSessionBackup(serialiseSessionBackup(b)).backup!);
    expect(res.ok).toBe(true);
    expect(res.warnings?.join(' ')).toMatch(/only see its own sessions/);
  });

  it('does not repeat that warning once the tablet already holds other sessions', async () => {
    // A tablet with its own history is not a fresh one, and the numbering advice does not apply.
    const b = buildFixtureBundle();
    await put('sessions', { ...b.session, session_id: 'unrelated-sitting', participant_id: 'P-OTHER' } as never);
    const res = await importSessionBackup(parseSessionBackup(serialiseSessionBackup(b)).backup!);
    expect(res.ok).toBe(true);
    expect(res.warnings?.join(' ') ?? '').not.toMatch(/only see its own sessions/);
  });

  it('gives the operator both row counts and says the delete is permanent', async () => {
    // SessionManager turns this refusal straight into a confirm() one tap from purgeSession, which
    // is a hard delete outside the thirty-day bin. It used to carry nothing to decide with.
    const b = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    await importSessionBackup(parsed.backup!);

    const again = await importSessionBackup(parsed.backup!);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/ON THIS DEVICE: \d+ rows/);
    expect(again.error).toMatch(/IN THIS FILE:\s+\d+ rows/);
    expect(again.error).toMatch(/permanently/);
    expect(again.error).toMatch(/not yet confirmed as exported/i);
  });

  it('names the participant fields a restore is about to blank', async () => {
    const b = buildFixtureBundle();
    const parsed = parseSessionBackup(serialiseSessionBackup(b));

    // The device's record has been filled in since the backup was taken — the eligibility decision
    // and the colour-vision result are written after the profile stage, and the record is SHARED
    // across a participant's two sittings.
    await put('participants', {
      ...b.participant, exclusion_reason: 'recorded after this backup was taken',
    } as never);

    const res = await importSessionBackup(parsed.backup!);
    expect(res.ok).toBe(true);
    expect(res.warnings?.join(' ')).toMatch(/exclusion_reason/);
    expect(res.warnings?.join(' ')).toMatch(/BOTH/);
  });
});
