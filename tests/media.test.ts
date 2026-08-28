import { describe, it, expect } from 'vitest';
import {
  noMediaConsent, mayCapture, requiredGrant, fnv1aBytes, formatBytes,
  type MediaConsent,
} from '@/storage/media';
import { buildExportFiles, mediaFilename } from '@/storage/export';
import { buildFixtureBundle, withFixtureMedia } from '@/sim/bundleFixture';
import { splitCsvRow, singleRow } from './helpers/csv';

const grant = (o: Partial<MediaConsent>): MediaConsent => ({ ...noMediaConsent(), ...o });

describe('media consent gate', () => {
  it('defaults every grant to a refusal', () => {
    const c = noMediaConsent();
    expect(c.camera_metrics).toBe(false);
    expect(c.setup_photos).toBe(false);
    expect(c.annotation_video).toBe(false);
    expect(c.granted_at).toBeNull();
  });

  it('permits nothing without a consent record at all', () => {
    for (const cp of ['session_start', 'session_end', 'reading_segment'] as const) {
      expect(mayCapture(null, cp)).toBe(false);
      expect(mayCapture(undefined, cp)).toBe(false);
    }
  });

  it('maps each checkpoint to the grant that actually covers it', () => {
    expect(requiredGrant('session_start')).toBe('setup_photos');
    expect(requiredGrant('session_end')).toBe('setup_photos');
    expect(requiredGrant('reading_segment')).toBe('annotation_video');
  });

  it('does NOT let a photo grant authorise video, or vice versa', () => {
    // The two are separate asks with different burdens; one must never imply the other.
    const photosOnly = grant({ setup_photos: true });
    expect(mayCapture(photosOnly, 'session_start')).toBe(true);
    expect(mayCapture(photosOnly, 'reading_segment')).toBe(false);

    const videoOnly = grant({ annotation_video: true });
    expect(mayCapture(videoOnly, 'reading_segment')).toBe(true);
    expect(mayCapture(videoOnly, 'session_start')).toBe(false);
    expect(mayCapture(videoOnly, 'session_end')).toBe(false);
  });

  it('does not let the camera-metrics grant authorise retaining pixels', () => {
    // Deriving numbers from discarded frames is a weaker ask than keeping the frames.
    const metricsOnly = grant({ camera_metrics: true });
    expect(mayCapture(metricsOnly, 'session_start')).toBe(false);
    expect(mayCapture(metricsOnly, 'reading_segment')).toBe(false);
  });

  it('treats a withdrawn grant as an immediate refusal', () => {
    const before = grant({ setup_photos: true });
    expect(mayCapture(before, 'session_end')).toBe(true);
    const after = { ...before, setup_photos: false };
    expect(mayCapture(after, 'session_end')).toBe(false);
  });
});

describe('media checksums', () => {
  it('is stable for identical bytes and differs for a single flipped byte', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    const c = new Uint8Array([1, 2, 3, 4, 6]);
    expect(fnv1aBytes(a)).toBe(fnv1aBytes(b));
    expect(fnv1aBytes(a)).not.toBe(fnv1aBytes(c));
    expect(fnv1aBytes(a)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles an empty buffer without throwing', () => {
    expect(fnv1aBytes(new Uint8Array([]))).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('formatBytes', () => {
  it('scales units readably', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

/**
 * The media files and the incomplete-session export.
 *
 * Two failures motivated these. First, the binaries were reachable only by opening IndexedDB by
 * hand, so the material the annotation sub-study is coded from could not leave the tablet, and the
 * inventory row that describes a file was joined to it by nothing at all. Second, the export was
 * offered for completed sessions only, while the operator manual instructs the operator to export
 * what exists when a participant withdraws — an instruction that could not be followed.
 *
 * The risk in fixing the second is worse than the bug: a truncated series pooled with completed
 * sittings is unbalanced with respect to the Williams order, so it biases every within-participant
 * contrast toward whichever conditions come early. The export therefore has to declare it.
 */
describe('consented media can actually leave the device', () => {
  const withMedia = () => withFixtureMedia(buildFixtureBundle());

  it('gives every capture a filename the inventory row also carries', () => {
    const b = withMedia();
    expect(b.media.length).toBeGreaterThan(0);
    const inv = buildExportFiles(b).find((f) => f.filename === '15_media_inventory.csv')!;
    const rows = inv.content.split('\n');
    const cols = splitCsvRow(rows[0]);
    const idIdx = cols.indexOf('media_id');
    const nameIdx = cols.indexOf('filename');
    expect(nameIdx).toBeGreaterThanOrEqual(0);

    for (const m of b.media) {
      const row = rows.slice(1).find((r) => splitCsvRow(r)[idIdx] === m.media_id)!;
      expect(row).toBeDefined();
      expect(splitCsvRow(row)[nameIdx]).toBe(mediaFilename(b.session, m));
    }
  });

  it('names files portably, and distinctly per capture', () => {
    const b = withMedia();
    const names = b.media.map((m) => mediaFilename(b.session, m));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(n).toMatch(/\.(jpg|png|webp|webm|mp4|bin)$/);
    }
  });

  it('carries the condition a capture belongs to into its name', () => {
    const b = withMedia();
    const m = b.media.find((x) => x.condition_label)!;
    expect(m).toBeDefined();
    expect(mediaFilename(b.session, m)).toContain(m.condition_label!.replace(/[^A-Za-z0-9._-]/g, '_'));
  });
});

describe('an unfinished session exports, and says that it is unfinished', () => {
  const sessionInfo = (b: ReturnType<typeof buildFixtureBundle>) =>
    singleRow(buildExportFiles(b).find((x) => x.filename === '01_session_info.csv')!.content);

  it('reports a completed sitting as complete', () => {
    const b = buildFixtureBundle();
    const info = sessionInfo(b);
    expect(info.session_status).toBe('complete');
    expect(Number(info.conditions_completed)).toBe(b.conditions.length);
    expect(info.session_complete).toBe('true');
  });

  it('reports a withdrawal as incomplete rather than letting it pass as a full sitting', () => {
    // A participant leaves after three conditions. The rows that exist are real measurements and
    // are worth keeping; what must not happen is that they look like a finished sitting.
    const full = buildFixtureBundle();
    const b = {
      ...full,
      session: { ...full.session, status: 'in_progress' as const },
      conditions: full.conditions.slice(0, 3),
    };
    const info = sessionInfo(b);
    expect(info.session_status).toBe('in_progress');
    expect(Number(info.conditions_completed)).toBe(3);
    expect(info.session_complete).toBe('false');
    expect(Number(info.conditions_per_session)).toBeGreaterThan(3);
  });

  it('is false when the sitting closed but conditions are missing', () => {
    const full = buildFixtureBundle();
    const b = { ...full, conditions: full.conditions.slice(0, 2) };
    expect(sessionInfo(b).session_complete).toBe('false');
  });
});
