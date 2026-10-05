/**
 * The legacy FaceMesh solution, asked for its landmark stream alone, hands back serialized
 * NormalizedLandmarkList bytes; tracking/landmarkProto.ts decodes them. Encoded here by hand from the
 * schema, so the decoder is checked against the wire format rather than against itself.
 */
import { describe, it, expect } from 'vitest';
import { decodeNormalizedLandmarkList } from '@/tracking/landmarkProto';
import { legacyLandmarks } from '@/tracking/trackers';

const varint = (n: number): number[] => {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
};
const f32 = (tag: number, v: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [tag, ...b];
};
/** One NormalizedLandmark message. Field order is deliberately not 1,2,3 for the second one. */
function landmark(x: number, y: number, z: number, extra: number[] = []): number[] {
  const body = [...f32(0x0d, x), ...f32(0x15, y), ...f32(0x1d, z), ...extra];
  return [0x0a, ...varint(body.length), ...body];
}

describe('decodeNormalizedLandmarkList', () => {
  it('decodes x, y and z of every landmark in order', () => {
    const bytes = new Uint8Array([...landmark(0.25, 0.5, -0.01), ...landmark(0.75, 0.125, 0.02)]);
    const out = decodeNormalizedLandmarkList(bytes);
    expect(out).toHaveLength(2);
    expect(out[0].x).toBeCloseTo(0.25, 6);
    expect(out[0].y).toBeCloseTo(0.5, 6);
    expect(out[0].z).toBeCloseTo(-0.01, 6);
    expect(out[1].x).toBeCloseTo(0.75, 6);
    expect(out[1].y).toBeCloseTo(0.125, 6);
  });

  it('skips fields it does not know (visibility, presence, a future varint) without losing its place', () => {
    const extra = [...f32(0x25, 0.9), ...f32(0x2d, 0.8), 0x30, ...varint(300)];
    const bytes = new Uint8Array([...landmark(0.1, 0.2, 0.3, extra), 0x10, ...varint(7), ...landmark(0.4, 0.5, 0.6)]);
    const out = decodeNormalizedLandmarkList(bytes);
    expect(out).toHaveLength(2);
    expect(out[1].x).toBeCloseTo(0.4, 6);
  });

  it('decodes the full 478-point mesh at the size the legacy graph emits (8126 bytes)', () => {
    const parts: number[] = [];
    for (let i = 0; i < 478; i++) parts.push(...landmark(i / 478, 1 - i / 478, 0));
    const bytes = new Uint8Array(parts);
    // Measured in headless Chromium: the raw list for one face is 8126 bytes, 17 per landmark.
    expect(bytes.length).toBe(8126);
    const out = decodeNormalizedLandmarkList(bytes);
    expect(out).toHaveLength(478);
    expect(out[477].x).toBeCloseTo(477 / 478, 5);
  });

  it('throws on a truncated buffer rather than inventing a landmark', () => {
    const good = landmark(0.1, 0.2, 0.3);
    expect(() => decodeNormalizedLandmarkList(new Uint8Array(good.slice(0, good.length - 3)))).toThrow();
  });

  it('a missing coordinate is NaN, never 0', () => {
    const body = [...f32(0x0d, 0.5)];
    const out = decodeNormalizedLandmarkList(new Uint8Array([0x0a, body.length, ...body]));
    expect(out[0].x).toBeCloseTo(0.5, 6);
    expect(Number.isNaN(out[0].y)).toBe(true);
  });
});

describe('legacyLandmarks accepts either listener shape', () => {
  it('raw bytes are decoded; decoded arrays pass through; nothing is null', () => {
    const bytes = new Uint8Array(landmark(0.3, 0.4, 0));
    expect(legacyLandmarks(bytes)![0].x).toBeCloseTo(0.3, 6);
    const arr = [{ x: 0.1, y: 0.2 }];
    expect(legacyLandmarks(arr)).toBe(arr);
    expect(legacyLandmarks(undefined)).toBeNull();
    expect(legacyLandmarks([])).toBeNull();
  });
});
