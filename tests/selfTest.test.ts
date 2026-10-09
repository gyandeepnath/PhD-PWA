import { describe, it, expect } from 'vitest';
import {
  SELF_TEST, SELF_TEST_RULE, SELF_TEST_RULE_V1, scoreSelfTest, fpsReason, minHits, attemptSummary,
} from '@/tracking/selfTest';
import { FPS_GATE, samplingFpsObserved } from '@/tracking/frameRateGate';
import { CONFIG } from '@/experiment/config';
import { EyeMetricsAggregator } from '@/tracking/aggregator';

const cues = [2500, 5500, 8500, 11500, 14500];
/** A tablet camera at 24 frames a second, face in view throughout: what the investigator reported. */
const good = { fps: 24, samplingFps: 24, facePresence: 0.98 };

describe('camera self-test scoring (rule st-r2)', () => {
  it('passes when every cued blink is seen at an adequate frame rate with the face in view', () => {
    const r = scoreSelfTest(cues, cues.map((c) => c + 300), good);
    expect(r).toMatchObject({
      rule: SELF_TEST_RULE, cued: 5, detected: 5, extra: 0, pass: true, reasons: [], notes: [],
      verdict: 'working', tier: 'A', samplingFps: 24, ground: CONFIG.ADAPTATION_COLOR,
    });
  });

  it('counts a blink for at most one cue, and blinks outside the window as extras', () => {
    // One blink between two cues cannot satisfy both; one far away is an extra.
    const r = scoreSelfTest([1000, 2000], [1500, 9000], good);
    expect(r.detected).toBe(1);
    expect(r.extra).toBe(1);
  });

  it('records, for each flash, how long after it the matched blink began — null for a flash with none', () => {
    const r = scoreSelfTest([1000, 4000, 7000], [1300, 3900], good);
    expect(r.cueLags).toEqual([300, -100, null]);
  });

  it('fails with a plain reason, and the share it needed, when too few cued blinks are seen', () => {
    const r = scoreSelfTest(cues, cues.slice(0, 3), good);
    expect(r.pass).toBe(false);
    expect(r.verdict).toBe('failed');
    expect(r.reasons.join(' ')).toMatch(/only 3 of 5 blinks were seen \(needs 4\)/);
  });

  it('needs a SHARE of the flashes (80%), rounded up — 4 of 5 — not a fixed count', () => {
    expect(minHits(5)).toBe(4);
    expect(minHits(10)).toBe(8);
    expect(minHits(3)).toBe(3);
    expect(minHits(SELF_TEST.CUES)).toBe(4);
  });

  it('fails on the face out of view, saying the share it needed, even when all blinks were seen', () => {
    const blinks = cues.map((c) => c + 100);
    expect(scoreSelfTest(cues, blinks, { ...good, facePresence: 0.5 }).reasons.join(' ')).toMatch(/only 50% of the time \(needs 90%\)/);
    expect(scoreSelfTest(cues, blinks, { fps: null, samplingFps: null, facePresence: null }).pass).toBe(false);
  });

  it('ignores blinks just outside the matching window, and counts one exactly at its edge', () => {
    expect(scoreSelfTest([5000], [5000 + SELF_TEST.WINDOW_MS + 1], good).detected).toBe(0);
    expect(scoreSelfTest([5000], [5000 - SELF_TEST.WINDOW_MS], good).detected).toBe(1);
  });
});

/*
 * WHY THE RULE CHANGED (Round 79). Rule st-r1 failed any test whose face-solved rate over the whole
 * window was under 25. The study tablet's camera delivers at most 23-25 frames a second (the
 * investigator's report), so the check failed whatever the participant did — and every moment without
 * a face lowered that rate further. st-r2 judges the frame-rate gate's own rate, the one every reading
 * row is tiered on: adequate at 20, reduced (a pass, said so) from 15, a fail below.
 */
describe('the frame rate is judged by the frame-rate gate fps-g2', () => {
  const blinks = cues.map((c) => c + 300);

  it('passes the investigator\'s camera: 23-25 frames a second is tier A, where st-r1 failed it', () => {
    for (const f of [23, 23.5, 24, 25]) {
      const r = scoreSelfTest(cues, blinks, { fps: f, samplingFps: f, facePresence: 0.99 });
      expect(r.pass, String(f)).toBe(true);
      expect(r.verdict).toBe('working');
      expect(f < 25).toBe(f !== 25); // st-r1 failed all but the last
    }
  });

  it('does not charge a moment without a face to the rate: it judges samplingFps, not fps', () => {
    // 24 a second while the face was seen, the face lost for 1 s of 19: the whole-window rate reads
    // about 22.7 (st-r1's number); the gate's rate is still 24.
    const r = scoreSelfTest(cues, blinks, { fps: 22.7, samplingFps: 24, facePresence: 0.95 });
    expect(r).toMatchObject({ pass: true, verdict: 'working', fps: 22.7, samplingFps: 24 });
  });

  it('a reduced rate (tier B, 15 to 20) passes as "reduced", with a note — never a reason', () => {
    const r = scoreSelfTest(cues, blinks, { fps: 17, samplingFps: 17, facePresence: 0.99 });
    expect(r).toMatchObject({ pass: true, verdict: 'reduced', tier: 'B', reasons: [] });
    expect(r.notes!.join(' ')).toMatch(/Reduced frame rate: the eye was sampled 17 times a second \(20 or more is adequate\)/);
    expect(r.notes!.join(' ')).toMatch(/flagged "reduced"/);
  });

  it('under 15 (tier C), or no rate at all, fails', () => {
    const slow = scoreSelfTest(cues, blinks, { fps: 12, samplingFps: 12, facePresence: 0.99 });
    expect(slow).toMatchObject({ pass: false, verdict: 'failed', tier: 'C' });
    expect(slow.reasons.join(' ')).toMatch(/12 frames per second, below 15/);
    expect(scoreSelfTest(cues, blinks, { fps: null, samplingFps: null, facePresence: 0.99 })).toMatchObject({ pass: false, tier: null });
  });

  it('its floors are the gate\'s: pass from the reduced floor, "working" from the adequate one', () => {
    expect(SELF_TEST.MIN_FPS).toBe(FPS_GATE.REDUCED);
    expect(scoreSelfTest(cues, blinks, { fps: 15, samplingFps: FPS_GATE.REDUCED, facePresence: 1 }).verdict).toBe('reduced');
    expect(scoreSelfTest(cues, blinks, { fps: 14.99, samplingFps: 14.99, facePresence: 1 }).verdict).toBe('failed');
    expect(scoreSelfTest(cues, blinks, { fps: 20, samplingFps: FPS_GATE.ADEQUATE, facePresence: 1 }).verdict).toBe('working');
  });

  it('runs on the grey field, and its versions name the rules', () => {
    expect(SELF_TEST.GROUND).toBe(CONFIG.ADAPTATION_COLOR);
    expect(SELF_TEST_RULE).toBe('st-r2');
    expect(SELF_TEST_RULE_V1).toBe('st-r1');
    // Every criterion is a time or a share; none is a number of frames.
    expect(SELF_TEST).toMatchObject({ WINDOW_MS: 1200, MIN_HIT_SHARE: 0.8, MIN_FACE: 0.9 });
  });

  it('keeps an earlier attempt as a one-line summary', () => {
    const r = scoreSelfTest(cues, cues.slice(0, 2), { fps: 21, samplingFps: 21.5, facePresence: 0.7 });
    expect(attemptSummary(r)).toEqual({ verdict: 'failed', cued: 5, detected: 2, samplingFps: 21.5, facePresence: 0.7 });
    // A record from before st-r2 has no verdict: its pass stands for one.
    expect(attemptSummary({ ...r, verdict: undefined, pass: true }).verdict).toBe('working');
  });
});

/*
 * The rate the self-test judges is the rate a reading row is tiered on: the same aggregator, the same
 * two values (face-solved samples, observed time), the same formula.
 */
describe('the self-test\'s rate, through the aggregator that measures it', () => {
  const BASE = 0.3;
  /** A 19-s test at `fps`, five firm blinks 300 ms after each flash, and the face lost over `lost`. */
  function run(fps: number, lost: [number, number] | null = null) {
    const agg = new EyeMetricsAggregator();
    const dt = 1000 / fps;
    const pose = { pitch: 0, yaw: 0, roll: 0 };
    for (let t = 0; t < 19_000; t += dt) {
      const into = cues.map((c) => t - (c + 300)).find((x) => x >= 0 && x < 300);
      const ear = into == null ? BASE : BASE * (into < 100 ? 1 - 0.85 * (into / 100) : 0.15 + 0.85 * ((into - 100) / 200));
      const face = !(lost && t >= lost[0] && t < lost[1]);
      agg.ingest({ t_ms: t, ear, earLeft: ear, earRight: ear, pose, zone: 'cc', isCenter: true, offAxis: false, facePresent: face, faceSize: 0.2, luma: null });
    }
    return agg;
  }

  it('at 24 frames a second, with the face lost for a second, passes — st-r1 would have failed it', () => {
    // Lost between blinks: a blink the face is lost DURING is open across a gap and is dropped (blink-r1).
    const agg = run(24, [16_000, 17_000]);
    const cov = agg.coverage();
    expect(cov.samplingFps!).toBeGreaterThan(23.5);
    expect(cov.fps!).toBeLessThan(23); // the whole-window rate st-r1 judged
    expect(cov.facePresence!).toBeGreaterThan(0.9);
    const r = scoreSelfTest(cues, agg.blinkEvents(BASE).map((e) => e.onset_ms), cov);
    expect(r).toMatchObject({ pass: true, verdict: 'working', detected: 5 });
  });

  it('is, to the digit, the sampling_fps_observed a condition row would store from the same frames', () => {
    for (const [fps, lost] of [[24, [6000, 7000]], [17, null], [30, [100, 400]]] as const) {
      const agg = run(fps, lost as [number, number] | null);
      const rec = agg.finalize({
        conditionId: 'C', sessionId: 'S', cameraActive: true, baselineEarValue: BASE, earThresholdUsed: 0.225,
        gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
      });
      expect(agg.coverage().samplingFps).toBe(samplingFpsObserved(rec.ear_sample_count, rec.observed_duration_ms));
    }
  });

  it('hands the result screen the samples it scored', () => {
    const agg = run(24);
    expect(agg.earSamples().length).toBe(agg.finalize({
      conditionId: 'C', sessionId: 'S', cameraActive: true, baselineEarValue: BASE, earThresholdUsed: 0.225,
      gazeCalibrated: false, headPitchCalibrated: false, calibrationId: null,
    }).ear_sample_count);
  });
});

/*
 * WHY the frame rate was low (round 75). The investigator's tablet failed this test on frame rate every
 * time and the advice was always "close other apps and check the light". The camera and the tracker
 * are now counted separately, and the reason must name the one that was short — with its numbers —
 * because the remedies are opposite. From st-r2 the stage is named against the floor the test MISSED:
 * 15 on a fail, 20 on a reduced pass.
 */
describe('a low frame rate says which stage was short', () => {
  const blinks = cues.map((c) => c + 100);
  const pipe = (o: Record<string, unknown>) => ({
    camera_fps_delivered: 30, tracker_fps: 30, process_ms_p50: 20, process_ms_p95: 28,
    camera_setting_width: 1280, camera_setting_height: 720, tracker_backend: 'tasks-cpu',
    frame_count_source: 'presented-frames' as const, ...o,
  });
  const at = (f: number, o: Record<string, unknown>) => scoreSelfTest(cues, blinks, { fps: f, samplingFps: f, facePresence: 0.99, pipeline: pipe(o) });

  it('the CAMERA, when it delivered fewer frames than the floor — and the advice is light, not apps', () => {
    const r = at(11, { camera_fps_delivered: 12, tracker_fps: 12 });
    expect(r.pass).toBe(false);
    expect(r.limit).toBe('camera');
    const why = r.reasons.join(' ');
    expect(why).toMatch(/CAMERA delivered only 12 frames per second at 1280×720/);
    expect(why).toMatch(/more light/);
    expect(why).not.toMatch(/battery saver/);
  });

  it('camera AND tracker when both are short — never "not the processor" while the tracker skips frames', () => {
    for (const [cam, trk] of [[14, 8], [12, 7]]) {
      const r = at(trk, { camera_fps_delivered: cam, tracker_fps: trk, process_ms_p50: 80, process_ms_p95: 110 });
      expect(r.limit).toBe('camera_and_tracker');
      const why = r.reasons.join(' ');
      expect(why).toMatch(new RegExp(`camera delivered only ${cam} frames per second.*TRACKER processed only ${trk}`));
      expect(why).toMatch(/BOTH the camera and the tablet's processor/);
      expect(why).toMatch(/close other apps.*charger/i);
      expect(why).not.toMatch(/not the processor/);
    }
  });

  it('the TRACKER, when the camera delivered enough — with the time per frame, and the advice is the processor', () => {
    const r = at(12, { camera_fps_delivered: 30, tracker_fps: 12, process_ms_p50: 61, process_ms_p95: 88 });
    expect(r.limit).toBe('tracker');
    const why = r.reasons.join(' ');
    expect(why).toMatch(/camera delivered 30 frames per second but the TRACKER processed only 12/);
    expect(why).toMatch(/about 61 ms a frame \(slowest 5%: 88 ms\)/);
    expect(why).toMatch(/close other apps.*charger/i);
  });

  it('offers comparing the trackers only as bench advice, and never when the tracker is frozen', () => {
    const p = pipe({ camera_fps_delivered: 30, tracker_fps: 12, process_ms_p50: 61, process_ms_p95: 88 });
    const auto = fpsReason(12, p, 'tracker', false);
    // The button's own label, and the manual's rule: at the bench, not between a participant's sittings.
    expect(auto).toMatch(/"Measure trackers again"/);
    expect(auto).toMatch(/at the bench/);
    expect(auto).toMatch(/not between one participant's sittings/);
    const frozen = fpsReason(12, p, 'tracker', true);
    expect(frozen).not.toMatch(/Measure trackers/);
    expect(frozen).toMatch(/close other apps.*charger/i);
  });

  it('the face, when frames were processed but the face was found in too few', () => {
    const r = at(10, { camera_fps_delivered: 30, tracker_fps: 29 });
    expect(r.limit).toBe('face');
    expect(r.reasons.join(' ')).toMatch(/found the face in only some/);
  });

  it('names the stage short of the floor the test MISSED: a fail at 12 with the camera at 18 is the face, not the camera', () => {
    // 18 is short of 20 but not of 15; what kept the rate under 15 is the face found in too few frames.
    expect(at(12, { camera_fps_delivered: 18, tracker_fps: 18 }).limit).toBe('face');
  });

  it('a reduced pass says which stage holds it under 20, as a note', () => {
    const r = at(18, { camera_fps_delivered: 18, tracker_fps: 18 });
    expect(r).toMatchObject({ pass: true, verdict: 'reduced', limit: 'camera', reasons: [] });
    expect(r.notes!.join(' ')).toMatch(/Why: 18 face frames per second, below 20: the CAMERA delivered only 18/);
  });

  it('will not blame the camera when the browser gave no frame counter', () => {
    const r = at(11, { camera_fps_delivered: 12, tracker_fps: 12, frame_count_source: 'callbacks' });
    expect(r.limit).toBe('undetermined');
    expect(r.reasons.join(' ')).toMatch(/cannot be told apart/);
  });

  it('records the pipeline with the result, pass or fail, and no limit at tier A', () => {
    const r = at(24, { camera_fps_delivered: 24, tracker_fps: 24 });
    expect(r.pass).toBe(true);
    expect(r.limit).toBeNull();
    expect(r.pipeline?.tracker_backend).toBe('tasks-cpu');
  });
});
