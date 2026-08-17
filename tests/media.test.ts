import { describe, it, expect } from 'vitest';
import {
  noMediaConsent, mayCapture, requiredGrant, fnv1aBytes, formatBytes,
  type MediaConsent,
} from '@/storage/media';

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
