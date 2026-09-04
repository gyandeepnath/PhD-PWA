/**
 * A participant must be able to have their recordings destroyed without losing their data.
 *
 * Three documents promised this — media.ts, docs/PROTOCOL.md, and the synopsis §3.10 submitted to
 * the ethics committee, which states retained media are "held apart from the research dataset and
 * deletable independently of it". The separate-store half was true; independent deletion existed
 * nowhere. The only control that removed a video was Purge, which also destroys ten condition rows,
 * the reaction trials, both questionnaires and the participant record.
 *
 * These tests run against the real IndexedDB layer, not a stub, because the property that matters
 * is what survives in the database afterwards.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { put, getAll, _resetForTests } from '@/storage/db';
import { revokeMediaGrant, gatherSession } from '@/storage/gather';
import type { SessionRecord, ConditionRecord } from '@/storage/types';
import type { MediaRecord } from '@/storage/media';

const SID = 'sess-media-1';

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session_id: SID, participant_id: 'P01', enrolment_number: 1,
    status: 'complete', deleted_at: null, display_label: null,
    ambient_lux: 10, ambient_illumination_level: 'dim', illumination_block: 0,
    illumination_order_first: 'dim', lux_readings: [], lux_all_in_range: true,
    lux_deviation_note: null, screen_white_luminance_cd_m2: null, brightness_percent: null,
    session_start_time: 1, session_end_time: 2, randomisation_seed: 1, condition_order: [0],
    preflight_complete: true, e2e_timing: false, consent_given: true, consent_time: 1,
    media_consent: { camera_metrics: true, setup_photos: true, annotation_video: true, granted_at: 1 },
    provenance: { app_version: 't', git_hash: 't', build_time: 't', condition_def_hash: 'h', schema_version: 7 },
    device_type: 'X', browser: 'Y', screen_resolution: '1x1',
    stimulus_scale: 1, layout_viewport: '1194x834',
    conditions_per_session: 10, condition_offset: 0, session_index: 1,
    ...overrides,
  } as SessionRecord;
}

const media = (id: string, checkpoint: MediaRecord['checkpoint']): MediaRecord => ({
  media_id: id,
  session_id: SID,
  checkpoint,
  condition_label: null,
  mime: checkpoint === 'reading_segment' ? 'video/webm' : 'image/jpeg',
  bytes: 10,
  captured_at: 1,
  consent_snapshot: { camera_metrics: true, setup_photos: true, annotation_video: true, granted_at: 1 },
  blob: new Blob(['x']),
} as unknown as MediaRecord);

async function seed() {
  // Fresh IndexedDB per test, matching the convention in tests/db.test.ts.
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
  await put('sessions', session());
  await put('conditions', {
    condition_id: 'c0', session_id: SID, session_position: 0, condition_label: 'P1',
  } as unknown as ConditionRecord);
  await put('media_captures', media('m-photo-start', 'session_start'));
  await put('media_captures', media('m-photo-end', 'session_end'));
  await put('media_captures', media('m-video', 'reading_segment'));
}

describe('revokeMediaGrant', () => {
  beforeEach(seed);

  it('destroys only the recordings the withdrawn grant covered', async () => {
    const removed = await revokeMediaGrant(SID, 'annotation_video');
    expect(removed).toBe(1);
    const left = (await getAll('media_captures')) as MediaRecord[];
    expect(left.map((m) => m.media_id).sort()).toEqual(['m-photo-end', 'm-photo-start']);
  });

  it('keeps the research data, which is the entire point', async () => {
    // Purge was the only alternative, and it destroys all of this.
    await revokeMediaGrant(SID, 'annotation_video');
    const bundle = await gatherSession(SID);
    expect(bundle).not.toBeNull();
    expect(bundle!.conditions).toHaveLength(1);
    expect(bundle!.session.session_id).toBe(SID);
  });

  it('records the withdrawal on the session, so it is not merely an absence', async () => {
    await revokeMediaGrant(SID, 'setup_photos');
    const bundle = await gatherSession(SID);
    expect(bundle!.session.media_consent.setup_photos).toBe(false);
    // The other grants are untouched: withdrawing one is not withdrawing all.
    expect(bundle!.session.media_consent.annotation_video).toBe(true);
    expect(bundle!.session.media_consent.camera_metrics).toBe(true);
    expect(bundle!.session.media_consent_revoked_at).toBeTypeOf('number');
  });

  it('withdraws the permission even when nothing had been captured', async () => {
    // A participant may withdraw before any file exists. Reporting zero and doing nothing would
    // leave the grant live, so a later capture would be lawful when it should not be.
    globalThis.indexedDB = new IDBFactory();
    _resetForTests();
    await put('sessions', session());
    const removed = await revokeMediaGrant(SID, 'setup_photos');
    expect(removed).toBe(0);
    const bundle = await gatherSession(SID);
    expect(bundle!.session.media_consent.setup_photos).toBe(false);
  });

  it('is idempotent', async () => {
    expect(await revokeMediaGrant(SID, 'annotation_video')).toBe(1);
    expect(await revokeMediaGrant(SID, 'annotation_video')).toBe(0);
  });

  it('does nothing for a session that does not exist', async () => {
    expect(await revokeMediaGrant('no-such-session', 'setup_photos')).toBe(0);
  });

  it('leaves any survivor covered by a withdrawn grant, which the audit then catches', async () => {
    /*
     * Consent is written BEFORE the blobs are removed, and the reason only shows up when something
     * goes wrong. If the deletion loop failed part-way — a quota error, the tab closing — this
     * ordering means every survivor is already covered by a withdrawn grant, so the export refuses
     * it and the integrity audit reports it. The other order would leave a live grant over
     * recordings that were meant to be destroyed, and nothing would notice.
     *
     * Simulated here by revoking and then re-inserting a file, which is exactly the state a
     * part-way failure leaves behind.
     */
    await revokeMediaGrant(SID, 'setup_photos');
    await put('media_captures', media('m-survivor', 'session_start'));

    const bundle = await gatherSession(SID);
    const { auditBundle } = await import('@/storage/integrity');
    const report = auditBundle(bundle!);

    const withdrawn = report.findings.filter((f) => f.check === 'media_grant_withdrawn');
    expect(withdrawn.length, 'a recording held under a withdrawn grant was not reported').toBe(1);
    expect(withdrawn[0].severity).toBe('error');
    expect(report.errors).toBeGreaterThan(0);
  });

  it('does not report a withdrawal error for media still under a live grant', async () => {
    // The audit must not cry wolf: the video grant is untouched here.
    await revokeMediaGrant(SID, 'setup_photos');
    const bundle = await gatherSession(SID);
    const { auditBundle } = await import('@/storage/integrity');
    const report = auditBundle(bundle!);
    const aboutVideo = report.findings.filter(
      (f) => f.check === 'media_grant_withdrawn' && f.refs?.includes('m-video'));
    expect(aboutVideo).toHaveLength(0);
  });
});
