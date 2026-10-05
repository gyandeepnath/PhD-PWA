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
import { estimateHeadPose, HEAD_LANDMARKS } from '@/tracking/headPose';

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

/*
 * Head roll mixes the axes the same way: an angle from a y difference over an x difference. On a 16:9
 * frame a 5 degree roll read about 8.8 degrees before round 75.
 */
describe('head roll with the frame aspect', () => {
  /** A face rolled by `rollDeg` about its centre in a W x H frame, with the landmarks headPose reads. */
  function head(W: number, H: number, rollDeg: number): Point[] {
    const lm: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const r = (rollDeg * Math.PI) / 180;
    const put = (i: number, dx: number, dy: number) => {
      const x = W / 2 + dx * Math.cos(r) - dy * Math.sin(r);
      const y = H / 2 + dx * Math.sin(r) + dy * Math.cos(r);
      lm[i] = { x: x / W, y: y / H };
    };
    put(HEAD_LANDMARKS.leftEyeCorner, -20, 0);
    put(HEAD_LANDMARKS.rightEyeCorner, 20, 0);
    put(HEAD_LANDMARKS.leftEar, -80, 10);
    put(HEAD_LANDMARKS.rightEar, 80, 10);
    put(HEAD_LANDMARKS.noseTip, 0, 40);
    put(HEAD_LANDMARKS.chin, 0, 110);
    return lm;
  }

  it('is the image angle whatever the frame shape', () => {
    expect(estimateHeadPose(head(1280, 720, 5), null, 1280 / 720).roll).toBeCloseTo(5, 6);
    expect(estimateHeadPose(head(640, 480, 5), null, 640 / 480).roll).toBeCloseTo(5, 6);
    expect(estimateHeadPose(head(1280, 720, -12), null, 1280 / 720).roll).toBeCloseTo(-12, 6);
  });

  it('without the aspect, a 16:9 frame overstated it — the defect this fixes', () => {
    const naive = estimateHeadPose(head(1280, 720, 5)).roll;
    expect(naive).toBeCloseTo((Math.atan(Math.tan((5 * Math.PI) / 180) * (1280 / 720)) * 180) / Math.PI, 6);
    expect(naive).toBeGreaterThan(8.5);
  });

  it('leaves yaw and pitch, which never mixed the axes, unchanged', () => {
    const lm = head(1280, 720, 0);
    const a = estimateHeadPose(lm, null, 1280 / 720);
    const b = estimateHeadPose(lm, null, 1);
    expect(a.yaw).toBe(b.yaw);
    expect(a.pitch).toBe(b.pitch);
  });
});
