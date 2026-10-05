/**
 * Both face trackers deliver the same landmark topology, and every index this app reads means the same
 * point in both.
 *
 * The blink measure (blink.ts), gaze (gaze.ts) and head pose (headPose.ts) index the 478-point mesh by
 * number. Moving from the legacy @mediapipe/face_mesh solution to the Tasks Face Landmarker (round 75)
 * is only safe if index 160 is still the upper eyelid and 468 still the iris centre. The packages
 * publish their own connection lists for the eye contours and irises; this checks the app's constants
 * against BOTH, and the two packages against each other, so a future model with a different topology
 * fails here instead of producing an eye-aspect ratio from the wrong points. (That the same image gives
 * the same landmarks through both paths is checked in a browser: e2e/trackerEquivalence.spec.ts.)
 */
import { describe, it, expect } from 'vitest';
import { LEFT_EYE_EAR, RIGHT_EYE_EAR } from '@/tracking/blink';
import { IRIS } from '@/tracking/gaze';
import { HEAD_LANDMARKS } from '@/tracking/headPose';

type Edge = [number, number] | { start: number; end: number };
const vertices = (edges: Edge[]): Set<number> => new Set(edges.flatMap((e) => (Array.isArray(e) ? e : [e.start, e.end])));
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

async function legacy() {
  const m = (await import('@mediapipe/face_mesh')) as unknown as Record<string, Edge[]>;
  const g = globalThis as unknown as Record<string, Edge[]>;
  const pick = (k: string) => (m[k] ?? (m as unknown as { default?: Record<string, Edge[]> }).default?.[k] ?? g[k]);
  return {
    rightEye: vertices(pick('FACEMESH_RIGHT_EYE')), leftEye: vertices(pick('FACEMESH_LEFT_EYE')),
    rightIris: vertices(pick('FACEMESH_RIGHT_IRIS')), leftIris: vertices(pick('FACEMESH_LEFT_IRIS')),
  };
}
async function tasks() {
  const { FaceLandmarker: F } = await import('@mediapipe/tasks-vision');
  return {
    rightEye: vertices(F.FACE_LANDMARKS_RIGHT_EYE), leftEye: vertices(F.FACE_LANDMARKS_LEFT_EYE),
    rightIris: vertices(F.FACE_LANDMARKS_RIGHT_IRIS), leftIris: vertices(F.FACE_LANDMARKS_LEFT_IRIS),
  };
}

describe('landmark topology', () => {
  it('the two packages publish identical eye and iris contours', async () => {
    const [a, b] = await Promise.all([legacy(), tasks()]);
    for (const k of ['rightEye', 'leftEye', 'rightIris', 'leftIris'] as const) {
      expect(sorted(a[k]), k).toEqual(sorted(b[k]));
    }
  });

  it('every EAR point is on one eye contour, the same eye in both packages', async () => {
    for (const p of [await legacy(), await tasks()]) {
      // The app's "LEFT" eye is the one on the image's left: MediaPipe's (the subject's) RIGHT eye.
      for (const i of LEFT_EYE_EAR) expect(p.rightEye.has(i), `index ${i}`).toBe(true);
      for (const i of RIGHT_EYE_EAR) expect(p.leftEye.has(i), `index ${i}`).toBe(true);
    }
  });

  it('the gaze iris centres are the 478-point model\'s iris centres, beside the eye they belong to', async () => {
    for (const p of [await legacy(), await tasks()]) {
      // Each iris is five points: its centre, then the four contour points the packages connect.
      expect(IRIS.left).toBe(Math.min(...p.rightIris) - 1);
      expect(IRIS.right).toBe(Math.min(...p.leftIris) - 1);
      expect(Math.max(...p.leftIris)).toBe(477); // 478 landmarks: 0..477
    }
  });

  it('head-pose points are mesh points (0..467), not iris points', () => {
    for (const i of Object.values(HEAD_LANDMARKS)) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(468);
    }
    // The eye corners head pose uses are the EAR corners (p1 and p4) of each eye.
    expect([LEFT_EYE_EAR[3], RIGHT_EYE_EAR[0]]).toEqual([HEAD_LANDMARKS.leftEyeCorner, HEAD_LANDMARKS.rightEyeCorner]);
  });
});
