/**
 * The eye-aspect ratio is a ratio of image distances, so it must not depend on the frame's shape.
 *
 * Landmarks arrive normalised to the frame (x by its width, y by its height). Measured in round 75 on
 * one portrait captured at 1280x720 and at 640x480, EAR computed in those units was 0.357 and 0.274 —
 * a 23% "difference" from nothing but the frame's aspect ratio. faceEar(lm, aspect) puts both axes in
 * the same unit first.
 */
import { describe, it, expect } from 'vitest';
import { faceEar, LEFT_EYE_EAR, RIGHT_EYE_EAR, type Point } from '@/tracking/blink';

/** A face whose eyes are `w` px wide and `h` px tall (the lids' vertical gap) in a W x H frame. */
function face(W: number, H: number, w = 40, h = 12, rollDeg = 0): Point[] {
  const lm: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const r = (rollDeg * Math.PI) / 180;
  const put = (idx: number[], cx: number, cy: number) => {
    // p1 corner, p2/p3 upper lid, p4 corner, p5/p6 lower lid — in pixels, then rotated and normalised.
    const pts = [[-w / 2, 0], [-w / 6, -h / 2], [w / 6, -h / 2], [w / 2, 0], [w / 6, h / 2], [-w / 6, h / 2]];
    idx.forEach((i, k) => {
      const [dx, dy] = pts[k];
      const x = cx + dx * Math.cos(r) - dy * Math.sin(r);
      const y = cy + dx * Math.sin(r) + dy * Math.cos(r);
      lm[i] = { x: x / W, y: y / H };
    });
  };
  put(LEFT_EYE_EAR, W / 2 - 40, H / 2);
  put(RIGHT_EYE_EAR, W / 2 + 40, H / 2);
  return lm;
}

describe('faceEar with the frame aspect', () => {
  const trueEar = 12 / 40; // (|p2-p6| + |p3-p5|) / (2 |p1-p4|) for the eye drawn above

  it('is the image-plane ratio whatever the frame shape', () => {
    expect(faceEar(face(1280, 720), 1280 / 720)).toBeCloseTo(trueEar, 6);
    expect(faceEar(face(640, 480), 640 / 480)).toBeCloseTo(trueEar, 6);
    expect(faceEar(face(720, 1280), 720 / 1280)).toBeCloseTo(trueEar, 6);
  });

  it('without the aspect, a 16:9 frame inflates it by 16:9 — the defect this fixes', () => {
    expect(faceEar(face(1280, 720))).toBeCloseTo(trueEar * (1280 / 720), 6);
  });

  it('does not change with head roll once the axes share a unit', () => {
    const level = faceEar(face(1280, 720, 40, 12, 0), 1280 / 720);
    const rolled = faceEar(face(1280, 720, 40, 12, 15), 1280 / 720);
    expect(rolled).toBeCloseTo(level, 6);
    // In normalised units the same 15 degree roll moved it.
    expect(Math.abs(faceEar(face(1280, 720, 40, 12, 15)) - faceEar(face(1280, 720, 40, 12, 0)))).toBeGreaterThan(0.01);
  });

  it('still reports NaN, never a number, for an unusable eye', () => {
    expect(faceEar([], 1.78)).toBeNaN();
    expect(faceEar(face(1280, 720), NaN)).toBeCloseTo(trueEar * (1280 / 720), 6); // a bad aspect is ignored, not propagated
  });
});
