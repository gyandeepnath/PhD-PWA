/**
 * The gaze test's "eye open enough" cut is in the eye's own proportions, whatever the camera mode
 * (rule gaze-r3, Round 91; audit 86 CAM-11).
 *
 * Landmarks are normalised to the frame, x to its width and y to its height. The cut compared an
 * aperture in y with a width in x, so on the 16:9 mode it was in effect 0.12 x 9/16 = 0.067 of the eye's
 * width: a frame deep inside a blink (lids 4.8 px apart on a 60 px eye, a ratio of 0.08) got an on-screen
 * verdict at 1280x720 and none at 640x480. The same face in pixels now gets the same verdict in both, and
 * the cut is the 0.12 its comment describes.
 */
import { describe, it, expect } from 'vitest';
import { estimateGaze, IRIS, EYE_BOX } from '@/tracking/gaze';
import { GAZE_RULE } from '@/tracking/gazeCalibration';

/** One face, the same in pixels, normalised to a W x H frame: each eye 60 px wide, its lids `apPx` apart. */
function face(W: number, H: number, apPx: number) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const P = (xpx: number, ypx: number) => ({ x: xpx / W, y: ypx / H });
  const cy = H / 2;
  const eye = (x0: number, a: number, b: number, top: number, bot: number, iris: number) => {
    lm[a] = P(x0, cy); lm[b] = P(x0 + 60, cy);
    lm[top] = P(x0 + 30, cy - apPx / 2); lm[bot] = P(x0 + 30, cy + apPx / 2);
    lm[iris] = P(x0 + 30, cy);
  };
  eye(W / 2 - 100, EYE_BOX.leftOuter, EYE_BOX.leftInner, EYE_BOX.topL, EYE_BOX.botL, IRIS.left);
  eye(W / 2 + 40, EYE_BOX.rightInner, EYE_BOX.rightOuter, EYE_BOX.topR, EYE_BOX.botR, IRIS.right);
  return lm;
}

const verdict = (W: number, H: number, apPx: number) => Number.isFinite(estimateGaze(face(W, H, apPx), undefined, undefined, 0, 0, W / H).h);

describe('the eye-open test in pixel proportions (gaze-r3)', () => {
  it('is the rule in force', () => {
    expect(GAZE_RULE).toBe('gaze-r3');
  });

  it('the same eye gets the same verdict at 1280x720 and 640x480', () => {
    for (const ap of [3, 4.2, 4.8, 6, 6.6, 7.8, 12, 20]) {
      expect(verdict(1280, 720, ap), `lids ${ap} px apart`).toBe(verdict(640, 480, ap));
    }
  });

  it('cuts at 0.12 of the eye\'s width: a frame deep in a blink gets no verdict, an open eye does', () => {
    expect(verdict(1280, 720, 4.8)).toBe(false); // 0.08: inside a blink
    expect(verdict(1280, 720, 7.0)).toBe(false); // 0.117: just under the cut
    expect(verdict(1280, 720, 7.6)).toBe(true); // 0.127: just over it
    expect(verdict(1280, 720, 20)).toBe(true); // 0.33: an open eye
  });

  it('leaves the horizontal offset, the only thing the on-screen test reads, unchanged', () => {
    const lm = face(1280, 720, 20);
    lm[IRIS.left] = { x: lm[IRIS.left].x + 6 / 1280, y: lm[IRIS.left].y };
    lm[IRIS.right] = { x: lm[IRIS.right].x + 6 / 1280, y: lm[IRIS.right].y };
    expect(estimateGaze(lm, undefined, undefined, 0, 0, 16 / 9).h).toBeCloseTo(estimateGaze(lm).h, 12);
  });
});
