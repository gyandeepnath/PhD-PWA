/**
 * Decode a serialized MediaPipe `NormalizedLandmarkList` — the bytes the legacy FaceMesh graph emits.
 *
 * WHY THIS EXISTS. The legacy `@mediapipe/face_mesh` solution answers every frame with three outputs:
 * the landmarks, a face-geometry list, and the input frame itself ("image_transformed"), which its
 * wrapper renders to a WebGL canvas and hands back as an ImageBitmap — a full-resolution blit and a new
 * bitmap per frame that this app never looked at (and never closed). The wrapper's constructor merges
 * the caller's config over its own (`Object.assign({}, defaults, config)`), so asking for the landmark
 * stream alone is a supported override — but the wrapper's own landmark decoder lives inside its
 * minified closure and only runs for its own listener. Taking the stream alone therefore means taking
 * the raw protobuf bytes and decoding them here. Measured in headless Chromium (round 75), the lean
 * listener's landmarks agree with the wrapper's own to within 1.5 px on a 1280x720 frame; see
 * docs/AUDIT_FINDINGS.md.
 *
 * The schema (mediapipe/framework/formats/landmark.proto), the only part of protobuf needed:
 *
 *   message NormalizedLandmarkList { repeated NormalizedLandmark landmark = 1; }
 *   message NormalizedLandmark { float x = 1; float y = 2; float z = 3;
 *                                float visibility = 4; float presence = 5; }
 *
 * Unknown fields are skipped by wire type, so a future field does not break decoding. A truncated or
 * malformed buffer throws — the caller treats that frame as having no face, which is what it is.
 */

export interface DecodedLandmark { x: number; y: number; z: number }

export function decodeNormalizedLandmarkList(bytes: Uint8Array): DecodedLandmark[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;

  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (i >= bytes.length) throw new Error('truncated varint');
      const b = bytes[i++];
      // Lengths and tags here are small; 32 bits is ample and keeps the arithmetic exact.
      if (shift < 32) result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return result >>> 0;
      shift += 7;
      if (shift > 63) throw new Error('varint too long');
    }
  };

  const skip = (wire: number): void => {
    if (wire === 0) varint();
    else if (wire === 1) i += 8;
    else if (wire === 2) i += varint();
    else if (wire === 5) i += 4;
    else throw new Error(`unsupported wire type ${wire}`);
    if (i > bytes.length) throw new Error('truncated field');
  };

  const out: DecodedLandmark[] = [];
  while (i < bytes.length) {
    const tag = varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field !== 1 || wire !== 2) { skip(wire); continue; }
    const len = varint();
    const end = i + len;
    if (end > bytes.length) throw new Error('truncated landmark');
    const p: DecodedLandmark = { x: NaN, y: NaN, z: NaN };
    while (i < end) {
      const t = varint();
      const f = t >>> 3;
      const w = t & 7;
      if (w === 5 && f >= 1 && f <= 3) {
        if (i + 4 > end) throw new Error('truncated float');
        const v = view.getFloat32(i, true);
        i += 4;
        if (f === 1) p.x = v; else if (f === 2) p.y = v; else p.z = v;
      } else {
        skip(w);
      }
    }
    out.push(p);
  }
  return out;
}
