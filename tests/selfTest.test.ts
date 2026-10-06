import { describe, it, expect } from 'vitest';
import { SELF_TEST, scoreSelfTest, fpsReason } from '@/tracking/selfTest';

const cues = [2500, 5500, 8500, 11500, 14500];
const good = { fps: 30, facePresence: 0.98 };

describe('camera self-test scoring', () => {
  it('passes when every cued blink is seen at an adequate frame rate with the face in view', () => {
    const r = scoreSelfTest(cues, cues.map((c) => c + 300), good);
    expect(r).toMatchObject({ cued: 5, detected: 5, extra: 0, pass: true, reasons: [] });
  });

  it('counts a blink for at most one cue, and blinks outside the window as extras', () => {
    // One blink between two cues cannot satisfy both; one far away is an extra.
    const r = scoreSelfTest([1000, 2000], [1500, 9000], good);
    expect(r.detected).toBe(1);
    expect(r.extra).toBe(1);
  });

  it('fails with a plain reason when too few cued blinks are seen', () => {
    const r = scoreSelfTest(cues, cues.slice(0, SELF_TEST.MIN_HITS - 1), good);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/only 3 of 5 blinks/);
  });

  it('fails on a low frame rate or the face out of view even when all blinks were seen', () => {
    const blinks = cues.map((c) => c + 100);
    expect(scoreSelfTest(cues, blinks, { fps: 12, facePresence: 0.99 }).reasons.join(' ')).toMatch(/12 frames per second/);
    expect(scoreSelfTest(cues, blinks, { fps: 30, facePresence: 0.5 }).reasons.join(' ')).toMatch(/only 50%/);
    expect(scoreSelfTest(cues, blinks, { fps: null, facePresence: null }).pass).toBe(false);
  });

  it('ignores blinks just outside the matching window', () => {
    const r = scoreSelfTest([5000], [5000 + SELF_TEST.WINDOW_MS + 1], good);
    expect(r.detected).toBe(0);
  });
});

/*
 * WHY the frame rate was low (round 75). The investigator's tablet failed this test on frame rate every
 * time and the advice was always "close other apps and check the light". The camera and the tracker
 * are now counted separately, and the reason must name the one that was short — with its numbers —
 * because the remedies are opposite.
 */
describe('a low frame rate says which stage was short', () => {
  const blinks = cues.map((c) => c + 100);
  const pipe = (o: Record<string, unknown>) => ({
    camera_fps_delivered: 30, tracker_fps: 30, process_ms_p50: 20, process_ms_p95: 28,
    camera_setting_width: 1280, camera_setting_height: 720, tracker_backend: 'tasks-cpu',
    frame_count_source: 'presented-frames' as const, ...o,
  });

  it('the CAMERA, when it delivered fewer frames than the floor — and the advice is light, not apps', () => {
    const r = scoreSelfTest(cues, blinks, { fps: 14, facePresence: 0.99, pipeline: pipe({ camera_fps_delivered: 15, tracker_fps: 15 }) });
    expect(r.pass).toBe(false);
    expect(r.limit).toBe('camera');
    const why = r.reasons.join(' ');
    expect(why).toMatch(/CAMERA delivered only 15 frames per second at 1280×720/);
    expect(why).toMatch(/more light/);
    expect(why).not.toMatch(/battery saver/);
  });

  it('camera AND tracker when both are short — never "not the processor" while the tracker skips frames', () => {
    for (const [cam, trk] of [[20, 10], [24, 14]]) {
      const r = scoreSelfTest(cues, blinks, { fps: trk, facePresence: 0.99, pipeline: pipe({ camera_fps_delivered: cam, tracker_fps: trk, process_ms_p50: 80, process_ms_p95: 110 }) });
      expect(r.limit).toBe('camera_and_tracker');
      const why = r.reasons.join(' ');
      expect(why).toMatch(new RegExp(`camera delivered only ${cam} frames per second.*TRACKER processed only ${trk}`));
      expect(why).toMatch(/BOTH the camera and the tablet's processor/);
      expect(why).toMatch(/close other apps.*charger/i);
      expect(why).not.toMatch(/not the processor/);
    }
  });

  it('the TRACKER, when the camera delivered enough — with the time per frame, and the advice is the processor', () => {
    const r = scoreSelfTest(cues, blinks, { fps: 16, facePresence: 0.99, pipeline: pipe({ camera_fps_delivered: 30, tracker_fps: 16, process_ms_p50: 61, process_ms_p95: 88 }) });
    expect(r.limit).toBe('tracker');
    const why = r.reasons.join(' ');
    expect(why).toMatch(/camera delivered 30 frames per second but the TRACKER processed only 16/);
    expect(why).toMatch(/about 61 ms a frame \(slowest 5%: 88 ms\)/);
    expect(why).toMatch(/close other apps.*charger/i);
  });

  it('offers comparing the trackers only as bench advice, and never when the tracker is frozen', () => {
    const p = pipe({ camera_fps_delivered: 30, tracker_fps: 16, process_ms_p50: 61, process_ms_p95: 88 });
    const auto = fpsReason(16, p, 'tracker', false);
    // The button's own label, and the manual's rule: at the bench, not between a participant's sittings.
    expect(auto).toMatch(/"Measure trackers again"/);
    expect(auto).toMatch(/at the bench/);
    expect(auto).toMatch(/not between one participant's sittings/);
    const frozen = fpsReason(16, p, 'tracker', true);
    expect(frozen).not.toMatch(/Measure trackers/);
    expect(frozen).toMatch(/close other apps.*charger/i);
  });

  it('the face, when frames were processed but the face was found in too few', () => {
    const r = scoreSelfTest(cues, blinks, { fps: 10, facePresence: 0.95, pipeline: pipe({ camera_fps_delivered: 30, tracker_fps: 29 }) });
    expect(r.limit).toBe('face');
    expect(r.reasons.join(' ')).toMatch(/found the face in only some/);
  });

  it('will not blame the camera when the browser gave no frame counter', () => {
    const r = scoreSelfTest(cues, blinks, { fps: 14, facePresence: 0.99, pipeline: pipe({ camera_fps_delivered: 15, tracker_fps: 15, frame_count_source: 'callbacks' }) });
    expect(r.limit).toBe('undetermined');
    expect(r.reasons.join(' ')).toMatch(/cannot be told apart/);
  });

  it('records the pipeline with the result, pass or fail, and no limit on a pass', () => {
    const r = scoreSelfTest(cues, blinks, { fps: 29, facePresence: 0.99, pipeline: pipe({}) });
    expect(r.pass).toBe(true);
    expect(r.limit).toBeNull();
    expect(r.pipeline?.tracker_backend).toBe('tasks-cpu');
  });

  it('the floor itself is unchanged: 25 face-solved frames per second', () => {
    expect(SELF_TEST.MIN_FPS).toBe(25);
  });
});
