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
import { recordWithdrawal, softDeleteSession, sittingsInProgress, isWithdrawn } from '@/storage/gather';
import { listResumable } from '@/storage/sessionPersistence';
import { buildExportFiles } from '@/storage/export';
import { auditBundle } from '@/storage/integrity';
import { cohortSummary } from '@/dashboard/aggregate';
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
    await expect(recordWithdrawal('no-such-session')).resolves.toEqual({ mediaDestroyed: 0, sittings: 0 });
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

/*
 * A withdrawal ends the sitting for COLLECTION, and the exports say so.
 *
 * Before this, recording a withdrawal set the tombstone and revoked photo and video consent and
 * left the rest: the sitting stayed "in progress" with its resume pointer, so the Session Manager
 * kept offering Resume and resuming collected further data after consent had been taken back. And
 * none of the per-session CSVs carried the tombstone, so the R and Python templates — which read
 * exactly those CSVs — modelled a withdrawn sitting as an ordinary one.
 */
describe('a withdrawn sitting cannot be resumed and is not "in progress"', () => {
  beforeEach(fresh);

  const inProgress = () => {
    const b = buildFixtureBundle();
    return { ...b.session, status: 'in_progress', session_end_time: null, resume_next_index: 4 } as SessionRecord;
  };

  it('is not offered for resume', async () => {
    const s = inProgress();
    await put('sessions', s);
    expect((await listResumable()).map((p) => p.sessionId)).toContain(s.session_id);
    await recordWithdrawal(s.session_id);
    expect((await listResumable()).map((p) => p.sessionId)).not.toContain(s.session_id);
  });

  it('loses its durable resume pointer', async () => {
    const s = inProgress();
    await put('sessions', s);
    await recordWithdrawal(s.session_id);
    expect((await get('sessions', s.session_id) as SessionRecord).resume_next_index).toBeUndefined();
  });

  it('does not hold the update gate shut', async () => {
    const s = inProgress();
    await put('sessions', s);
    expect(await sittingsInProgress()).toHaveLength(1);
    await recordWithdrawal(s.session_id);
    expect(await sittingsInProgress()).toHaveLength(0);
  });

  it('KEEPS the camera-metrics grant, so lawfully collected ocular data is not reported as unconsented', async () => {
    // Revoking it looks thorough and is wrong: the integrity audit reads the grant as "what the
    // participant agreed to while this was measured", and would then call every eye-metrics row
    // "measured on a participant who did not consent". Collection is stopped by the resume block.
    const b = buildFixtureBundle();
    await put('sessions', b.session);
    await recordWithdrawal(b.session.session_id);
    const after = await get('sessions', b.session.session_id) as SessionRecord;
    expect(after.media_consent?.camera_metrics).toBe(b.session.media_consent?.camera_metrics);
    const codes = auditBundle({ ...b, session: after, media: [] }).findings.map((f) => f.check);
    expect(codes).not.toContain('ocular_requires_consent');
  });

  it('isWithdrawn reads the tombstone and nothing else', () => {
    expect(isWithdrawn({ withdrawn_at: 1 })).toBe(true);
    expect(isWithdrawn({ withdrawn_at: null })).toBe(false);
    expect(isWithdrawn({})).toBe(false);
  });
});

describe('the per-session export says the participant withdrew', () => {
  const row = (b: ReturnType<typeof buildFixtureBundle>) => {
    const f = buildExportFiles(b).find((x) => x.filename === '01_session_info.csv')!;
    const [head, body] = f.content.trim().split('\n');
    const cols = head.split(',');
    // The fixture participant id carries a comma inside quotes; read the columns we need from the
    // right-hand end of the header instead of splitting a quoted field.
    const cells = body.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ''));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  };

  it('carries withdrawn and withdrawn_at', () => {
    const b = buildFixtureBundle();
    expect(row(b).withdrawn).toBe('false');
    expect(row(b).withdrawn_at).toBe('');
    const w = { ...b, session: { ...b.session, withdrawn_at: Date.UTC(2026, 0, 2, 3, 4, 5) } };
    expect(row(w).withdrawn).toBe('true');
    expect(row(w).withdrawn_at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('never calls a withdrawn sitting complete, even one that finished', () => {
    const b = buildFixtureBundle();
    expect(row(b).session_complete).toBe('true');
    expect(row({ ...b, session: { ...b.session, withdrawn_at: 1 } }).session_complete).toBe('false');
  });

  it('counts FINISHED condition-runs, not rows', () => {
    const b = buildFixtureBundle();
    const paused = { ...b, conditions: b.conditions.map((c, i) => (i === b.conditions.length - 1 ? { ...c, completed_at: null } : c)) };
    expect(row(paused).conditions_completed).toBe(String(b.conditions.length - 1));
    expect(row(paused).session_complete).toBe('false');
  });
});

describe('the cohort view keeps a withdrawn participant out of its figures', () => {
  it('counts their rows as withdrawn and excludes them from the mean', () => {
    const head = 'condition_label,polarity,text_colour,withdrawn,condition_complete,analysable,exclusion_reason,fps_adequate_for_ratio,n_blinks_total,incomplete_blink_ratio,session_position';
    const csv = [head,
      'P1,positive,achromatic,false,true,true,,true,20,0.1,0',
      'P1,positive,achromatic,true,true,false,participant_withdrawn,true,20,0.9,0',
    ].join('\n');
    const c = cohortSummary([{ filename: 'analysis_long.csv', content: csv }],
      { total_participants: 2, analysable_participants: 1, issues: [] }, 10);
    expect(c.conditions[0].n).toBe(2);
    expect(c.conditions[0].n_withdrawn).toBe(1);
    expect(c.conditions[0].mean_ibr).toBeCloseTo(0.1);
    expect(c.positionBalance.P1[0]).toBe(1);
  });
});

describe('the Session Manager lists a withdrawn sitting on its own', () => {
  const manager = readFileSync('src/start/SessionManager.tsx', 'utf8');
  it('under neither In progress nor Completed', () => {
    expect(manager).toMatch(/status === 'in_progress' && !isWithdrawn\(s\)/);
    expect(manager).toMatch(/status === 'complete' && !isWithdrawn\(s\)/);
    expect(manager).toMatch(/Withdrawn \(\$\{withdrawn\.length\}\)/);
  });
  it('drops the localStorage resume pointer as well', () => {
    const body = manager.slice(manager.indexOf('const withdraw ='), manager.indexOf('const del ='));
    expect(body).toMatch(/for \(const x of siblings\) clearResume\(x\.session_id\)/);
  });
  it('the manual orders the steps so the export carries the mark', () => {
    const manual = readFileSync('docs/OPERATOR_MANUAL.md', 'utf8');
    expect(manual).toMatch(/press \*\*Withdrew\*\* on that session FIRST, then \*\*Export\*\*/);
  });
});


/*
 * The PARTICIPANT withdraws. Marking one sitting left a split participant's other sitting unmarked:
 * listed as Completed, exported withdrawn = FALSE, averaged into the cohort view, while the join check
 * and both templates excluded the participant.
 */
describe('a withdrawal applies to every sitting of the participant', () => {
  beforeEach(fresh);

  const twoSittings = async () => {
    const b = buildFixtureBundle();
    const s1 = { ...b.session, session_id: 'sit-1', status: 'complete' } as SessionRecord;
    const s2 = { ...b.session, session_id: 'sit-2', status: 'in_progress', session_end_time: null, resume_next_index: 2 } as SessionRecord;
    const binned = { ...b.session, session_id: 'sit-0', deleted_at: Date.now() } as SessionRecord;
    const other = { ...b.session, session_id: 'other', participant_id: 'SOMEONE-ELSE' } as SessionRecord;
    for (const s of [s1, s2, binned, other]) await put('sessions', s);
    return { s1, s2, binned, other };
  };

  it('marks every sitting of that participant, the recycle bin included, and no one else', async () => {
    const { s1, s2, binned, other } = await twoSittings();
    const r = await recordWithdrawal(s2.session_id);
    expect(r.sittings).toBe(3);
    for (const s of [s1, s2, binned]) {
      expect((await get('sessions', s.session_id) as SessionRecord).withdrawn_at, s.session_id).toBeTypeOf('number');
    }
    expect((await get('sessions', other.session_id) as SessionRecord).withdrawn_at ?? null).toBeNull();
  });

  it('every sitting takes the same withdrawal time', async () => {
    const { s1, s2 } = await twoSittings();
    await recordWithdrawal(s2.session_id);
    const a = (await get('sessions', s1.session_id) as SessionRecord).withdrawn_at;
    const b = (await get('sessions', s2.session_id) as SessionRecord).withdrawn_at;
    expect(a).toBe(b);
  });

  it('a new sitting cannot be started for them', async () => {
    const { priorParticipantProgress } = await import('@/storage/gather');
    const { s2 } = await twoSittings();
    expect((await priorParticipantProgress(s2.participant_id)).withdrawnAt).toBeNull();
    await recordWithdrawal(s2.session_id);
    expect((await priorParticipantProgress(s2.participant_id)).withdrawnAt).toBeTypeOf('number');
    const form = readFileSync('src/start/setupStages.tsx', 'utf8');
    expect(form).toMatch(/repeatAcknowledged && splitAcknowledged && !withdrawn;/);
    const exp = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(exp).toMatch(/if \(prior\.withdrawnAt != null\) \{/);
  });
});

describe('the pooled file and the cohort view treat the participant, not the sitting, as withdrawn', () => {
  it('a split participant who withdrew in sitting 2: sitting 1 rows are withdrawn too, and out of the cohort mean', async () => {
    const { buildAnalysisDataset } = await import('@/storage/analysisExport');
    const base = buildFixtureBundle();
    const s1 = { ...base, session: { ...base.session, session_id: 'A1', withdrawn_at: null } };
    const s2 = {
      ...base,
      session: { ...base.session, session_id: 'A2', withdrawn_at: Date.now(), session_start_time: base.session.session_start_time + 86_400_000 },
      conditions: base.conditions.map((c) => ({ ...c, condition_id: 'A2-' + c.condition_id })),
      eyeMetrics: base.eyeMetrics.map((e) => ({ ...e, condition_id: 'A2-' + e.condition_id })),
    };
    const ds = buildAnalysisDataset([s1, s2] as never);
    const longFile = ds.files.find((f) => f.filename === 'analysis_long.csv')!;
    const [head, ...body] = longFile.content.trim().split('\n');
    const wi = head.split(',').indexOf('withdrawn');
    const sidI = head.split(',').indexOf('session_id');
    // Every row of the participant, sitting 1's included, reads withdrawn.
    const cells = body.map((line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '')));
    expect(cells.filter((c) => c[sidI] === 'A1').every((c) => c[wi] === 'true')).toBe(true);
    const c = cohortSummary(ds.files, ds.integrity, 10);
    expect(c.conditions.reduce((n, r) => n + r.n_with_outcome, 0)).toBe(0);
    expect(c.conditions.reduce((n, r) => n + r.n_withdrawn, 0)).toBe(body.length);
  });
});
