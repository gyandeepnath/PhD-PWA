/**
 * Camera + MediaPipe FaceMesh tracking hook.
 *
 * Self-hosts the FaceMesh assets (precached for offline). Degrades gracefully: if the camera is
 * denied/unavailable or MediaPipe fails to load, the experiment continues with camera_active=false
 * and disabled (zeroed) eye metrics. Per-condition aggregation is driven by beginCondition/endCondition.
 *
 * Calibration collects EAR samples to fit a real per-participant baseline AND a real per-participant
 * gaze mapping (tap targets → fitted iris-offset thresholds, used by estimateGaze at runtime). The
 * original build's "calibration" stored hardcoded zeros — see gaze.ts. gaze_calibrated is reported
 * truthfully (true only when the gaze fit is separable/valid).
 */
import { useCallback, useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { faceEar, baselineEar, EAR_TIERS, type Point } from './blink';

/**
 * How often the operator's live readout updates, in hertz.
 *
 * Deliberately far below the frame rate. The monitor is an operator aid; re-rendering it on every
 * FaceMesh result would compete for the main thread with the tracker itself, and the tracker is the
 * one thing in this app that must never be starved — a dropped frame is a lost EAR sample and the
 * primary outcome is a count of events in that series.
 */
const LIVE_HZ = 4;
import { estimateHeadPose, isOffAxis, noseVerticalFraction } from './headPose';
import { estimateGaze } from './gaze';
import { meanLumaFromRGBA } from './lighting';
import { fitGazeCalibration, type GazeCalibration, type GazeSample } from './gazeCalibration';
import { v4 as uuidv4 } from 'uuid';
import { EyeMetricsAggregator, disabledEyeMetrics } from './aggregator';
import { put } from '@/storage/db';
import { now } from '@/lib/timing';
import type { CameraStatus } from '@/storage/types';
import { loadFaceMesh, faceMeshAssetPath } from './faceMeshLoader';

/** Median of a numeric array (robust frontal-fraction estimate, ignores transient blinks/noise). */
function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Apparent face size as a fraction of the frame: the geometric mean of the landmark bounding box's
 * width and height (normalised coords). A viewing-distance / posture proxy — it shrinks as the
 * participant leans back. (FaceMesh gives no detection box, so we derive it from the landmark extent.)
 */
function faceSizeFromLandmarks(lm: Point[]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of lm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX, h = maxY - minY;
  // NaN, not 0, when the bounding box has no extent. A face size of 0 is a measurement ("the
  // face occupies none of the frame") that the aggregator would average in as a real value,
  // dragging face_size_ratio toward zero on exactly the frames where detection failed. The
  // aggregator filters non-finite on ingest, so NaN is correctly dropped instead.
  return w > 0 && h > 0 ? Math.sqrt(w * h) : NaN;
}

/**
 * A live readout of what the tracker is doing right now.
 *
 * Nothing in the app showed this once a session had started. The operator confirmed the face box at
 * camera setup and then ran ninety minutes on trust, and every way tracking can fail mid-session —
 * the participant leaning out of frame, the room going too dark for detection, the frame rate
 * collapsing — is silent until the export is opened. `blinks` in particular is the count feeding
 * the primary outcome, so watching it advance is the difference between knowing data is being
 * collected and assuming it.
 *
 * Every field is nullable and null means "not measured", never a stand-in zero: a face size of 0 or
 * a blink rate of 0 would read as a measurement of an absent face rather than as absence.
 */
export interface LiveTrackingStats {
  facePresent: boolean;
  /** Eye-aspect-ratio this frame; null when no face is in view. */
  ear: number | null;
  /** EAR relative to the participant's calibrated baseline, so 1.0 is their own open eye. */
  earRatio: number | null;
  /** Blinks counted since the current condition began; null when no baseline has been fitted. */
  blinks: number | null;
  /** Of those, how many failed to close fully — the primary outcome as it accumulates. */
  incomplete: number | null;
  /** Achieved FaceMesh throughput, frames per second. */
  fps: number | null;
  /** Face bounding-box size as a fraction of the frame; a proxy for viewing distance. */
  faceSize: number | null;
  /** Whether gaze is currently in the central zone. */
  onScreen: boolean;
}

interface TrackingApi {
  status: CameraStatus;
  /** Subscribe to the live readout. Returns an unsubscribe function. */
  subscribeLive: (fn: (s: LiveTrackingStats) => void) => () => void;
  /** Request camera + init FaceMesh. Returns the resulting status. */
  start: () => Promise<CameraStatus>;
  stop: () => void;
  /** Collect calibration EAR samples for ~`ms` and fit the baseline. Resolves to the baseline. */
  calibrate: (ms: number) => Promise<number | null>;
  /** Live video element + stream for CONSENTED capture; null when the camera is not running. */
  mediaSource: () => { video: HTMLVideoElement; stream: MediaStream } | null;
  /** Begin gaze calibration: start EAR baseline collection and reset gaze samples. */
  beginGazeCalibration: () => void;
  /** Sample iris offset for a calibration target for ~`ms` while the participant fixates it. */
  sampleGazeTarget: (targetId: string, ms: number) => Promise<void>;
  /** Fit gaze calibration + EAR baseline, persist a CalibrationRecord. Returns whether gaze fit is valid. */
  endGazeCalibration: (sessionId: string) => Promise<boolean>;
  beginCondition: () => void;
  /** Finalise the current condition and persist an EyeMetricsRecord. */
  endCondition: (conditionId: string, sessionId: string) => Promise<void>;
}

export function useTracking(): TrackingApi {
  const [status, setStatus] = useState<CameraStatus>('unavailable');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Tiny offscreen canvas for cheap per-frame luminance sampling (lighting QC).
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMeshRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);
  const aggRef = useRef<EyeMetricsAggregator | null>(null);
  const calibrating = useRef<{ samples: number[]; noseFracs: number[] } | null>(null);
  const baselineEarRef = useRef<number | null>(null);
  // Per-participant frontal nose fraction (pitch zero), captured during calibration.
  const pitchBaselineFracRef = useRef<number | null>(null);
  const frameCounter = useRef(0);
  // Gaze calibration state.
  const gazeCalRef = useRef<GazeCalibration | null>(null);
  const gazeSamplesRef = useRef<Record<string, GazeSample[]>>({});
  const gazeCollectingTarget = useRef<string | null>(null);

  const gazeFor = (lm: Point[]) => {
    const c = gazeCalRef.current;
    return c
      ? estimateGaze(lm, c.hThreshold, c.vThreshold, c.h0, c.v0)
      : estimateGaze(lm);
  };

  /** Mean luminance of the current video frame (0-255), null if unavailable. */
  const sampleLuma = (): number | null => {
    const v = videoRef.current;
    const cv = lumaCanvasRef.current;
    if (!v || !cv || v.readyState < 2) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(v, 0, 0, cv.width, cv.height);
      return meanLumaFromRGBA(ctx.getImageData(0, 0, cv.width, cv.height).data);
    } catch {
      return null; // e.g. tainted canvas — skip lighting for this frame
    }
  };

  // Ingest exactly ONE sample per FaceMesh result, so the EAR series is sampled at the true
  // measurement rate (not the display refresh rate). The previous build ran a free-running 60 fps
  // sampler over stale landmarks, duplicating samples and overstating effective_fps.
  /*
   * Live-readout plumbing. Emission is throttled to LIVE_HZ rather than fired per frame: the
   * monitor is an operator aid and re-rendering it 30 times a second would compete with the
   * tracker for the main thread, which is the one thing that must never be starved.
   */
  const liveSubs = useRef(new Set<(s: LiveTrackingStats) => void>());
  const lastLiveEmit = useRef(0);
  const frameTimes = useRef<number[]>([]);

  const subscribeLive = useCallback((fn: (s: LiveTrackingStats) => void) => {
    liveSubs.current.add(fn);
    return () => { liveSubs.current.delete(fn); };
  }, []);

  const emitLive = useCallback((t: number, stats: Omit<LiveTrackingStats, 'fps'>) => {
    // Achieved throughput over a short window, which is what the FPS gate on the primary outcome
    // actually depends on.
    frameTimes.current.push(t);
    while (frameTimes.current.length > 0 && t - frameTimes.current[0] > 2000) frameTimes.current.shift();
    const span = frameTimes.current.length > 1
      ? (frameTimes.current[frameTimes.current.length - 1] - frameTimes.current[0]) / 1000
      : 0;
    const fps = span > 0.5 ? (frameTimes.current.length - 1) / span : null;

    if (t - lastLiveEmit.current < 1000 / LIVE_HZ) return;
    lastLiveEmit.current = t;
    if (liveSubs.current.size === 0) return;
    const payload: LiveTrackingStats = { ...stats, fps };
    for (const fn of liveSubs.current) fn(payload);
  }, []);

  const ingestResult = useCallback((lm: Point[] | null) => {
    const t = now();
    const luma = sampleLuma();
    if (lm && lm.length > 0) {
      const ear = faceEar(lm);
      if (calibrating.current) {
        calibrating.current.samples.push(ear);
        // During calibration the participant is frontal (eyes-only movement), so the nose fraction
        // here defines their personal pitch zero.
        const frac = noseVerticalFraction(lm);
        if (frac != null) calibrating.current.noseFracs.push(frac);
      }
      const gazeNow = gazeFor(lm);
      if (gazeCollectingTarget.current) {
        const id = gazeCollectingTarget.current;
        (gazeSamplesRef.current[id] ??= []).push({ h: gazeNow.h, v: gazeNow.v });
      }
      const agg = aggRef.current;
      if (agg) {
        const pose = estimateHeadPose(lm, pitchBaselineFracRef.current);
        agg.ingest({
          t_ms: t,
          ear,
          pose,
          zone: gazeNow.zone,
          isCenter: gazeNow.isCenter,
          offAxis: isOffAxis(pose),
          facePresent: true,
          faceSize: faceSizeFromLandmarks(lm),
          luma,
        });
      }
      const live = agg?.liveCounts(baselineEarRef.current);
      emitLive(t, {
        facePresent: true,
        ear: Number.isFinite(ear) ? ear : null,
        earRatio: baselineEarRef.current && Number.isFinite(ear) ? ear / baselineEarRef.current : null,
        blinks: live?.blinks ?? null,
        incomplete: live?.incomplete ?? null,
        faceSize: (() => { const f = faceSizeFromLandmarks(lm); return Number.isFinite(f) ? f : null; })(),
        onScreen: gazeNow.isCenter,
      });
    } else if (aggRef.current) {
      const live = aggRef.current.liveCounts(baselineEarRef.current);
      emitLive(t, {
        facePresent: false, ear: null, earRatio: null,
        blinks: live.blinks, incomplete: live.incomplete,
        faceSize: null, onScreen: false,
      });
      aggRef.current.ingest({
        t_ms: t,
        ear: 0,
        pose: { pitch: 0, yaw: 0, roll: 0 },
        zone: 'cc',
        isCenter: false,
        offAxis: false,
        facePresent: false,
        faceSize: 0,
        luma,
      });
    }
  }, [emitLive]);

  const start = useCallback(async (): Promise<CameraStatus> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return 'unavailable';
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CONFIG.CAMERA_WIDTH, height: CONFIG.CAMERA_HEIGHT, frameRate: CONFIG.CAMERA_FPS },
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      /**
       * Attached to the document, not left detached.
       *
       * A never-appended <video> producing frames is version-dependent on iPadOS Safari; if play()
       * rejects there, the whole start() falls through to catch and the sitting runs with no ocular
       * data. Off-screen and inert rather than hidden with display:none, which suspends decoding.
       */
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
      video.setAttribute('aria-hidden', 'true');
      document.body.appendChild(video);
      await video.play();
      videoRef.current = video;

      /**
       * A track that ENDS mid-condition must be detected.
       *
       * Nothing listened for it. iOS hands the camera to an incoming call, a second app claims it,
       * or the OS drops it — the track fires `ended`, fm.send() then throws into the pump's empty
       * catch, and onResults simply stops firing. The aggregator's denominators are its own
       * samples, so the row still reports camera_active TRUE, effective_fps ~30 and
       * face_presence_ratio ~0.95, with an incomplete-blink ratio computed over whatever fraction
       * of the exposure it saw. Indistinguishable from a good row — and the operator manual tells
       * the operator to check exactly those two fields.
       */
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          setStatus('failed');
          trackEndedRef.current = true;
        });
      }
      trackEndedRef.current = false;
      // Small canvas for downsampled luminance sampling (lighting QC) — cheap to read each frame.
      const lumaCanvas = document.createElement('canvas');
      lumaCanvas.width = 32;
      lumaCanvas.height = 24;
      lumaCanvasRef.current = lumaCanvas;

      /**
       * Dynamic import keeps MediaPipe out of the critical path and lets the app build/run without
       * it. The constructor is resolved through faceMeshLoader rather than read off the module
       * namespace directly, because the package publishes onto a global under Rollup and onto the
       * module exports under esbuild — see that file for why reading `mod.FaceMesh` here shipped a
       * build that could not track a single blink.
       *
       * Asset paths are base-relative for the same class of reason: `/mediapipe/${f}` is
       * root-absolute, so it only resolves when the app is served from `/`. This app is served
       * from a GitHub Pages project site at `https://user.github.io/repo/`, where every wasm and
       * model fetch would 404 — while getUserMedia still succeeds and the preview still shows a
       * face, so the operator ticks every checklist box and the session records nothing.
       */
      const FaceMeshCtor = await loadFaceMesh();
      const fm = new FaceMeshCtor({ locateFile: faceMeshAssetPath });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      // One ingest per result → EAR is sampled at the real FaceMesh throughput.
      fm.onResults((r) => ingestResult(r.multiFaceLandmarks?.[0] ?? null));
      faceMeshRef.current = fm;

      // Drive MediaPipe: send each frame (awaited, so the loop self-paces to the achieved rate).
      const pump = async () => {
        frameCounter.current++;
        if (frameCounter.current % CONFIG.PROCESS_EVERY_N_FRAMES === 0 && videoRef.current) {
          try {
            await fm.send({ image: videoRef.current });
          } catch {
            /* transient frame error — ignore */
          }
        }
        rafRef.current = requestAnimationFrame(pump);
      };
      rafRef.current = requestAnimationFrame(pump);

      setStatus('active');
      return 'active';
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      const s: CameraStatus = denied ? 'denied' : 'failed';
      setStatus(s);
      return s;
    }
  }, [ingestResult]);

  /** Set when a video track ended after the camera had started. See start(). */
  const trackEndedRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const v = videoRef.current;
    if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    videoRef.current = null;
  }, []);

  const calibrate = useCallback(async (ms: number): Promise<number | null> => {
    if (status !== 'active') return null;
    calibrating.current = { samples: [], noseFracs: [] };
    await new Promise((r) => setTimeout(r, ms));
    const cal = calibrating.current;
    calibrating.current = null;
    if (cal.noseFracs.length >= 10) pitchBaselineFracRef.current = medianOf(cal.noseFracs);
    if (cal.samples.length < 10) return null;
    const base = baselineEar(cal.samples);
    baselineEarRef.current = base;
    return base;
  }, [status]);

  const beginGazeCalibration = useCallback(() => {
    calibrating.current = { samples: [], noseFracs: [] };
    gazeSamplesRef.current = {};
    gazeCalRef.current = null;
  }, []);

  const sampleGazeTarget = useCallback(async (targetId: string, ms: number): Promise<void> => {
    gazeCollectingTarget.current = targetId;
    await new Promise((r) => setTimeout(r, ms));
    gazeCollectingTarget.current = null;
  }, []);

  const endGazeCalibration = useCallback(async (sessionId: string): Promise<boolean> => {
    const earSamples = calibrating.current?.samples ?? [];
    const noseFracs = calibrating.current?.noseFracs ?? [];
    calibrating.current = null;
    if (earSamples.length >= 10) baselineEarRef.current = baselineEar(earSamples);
    if (noseFracs.length >= 10) pitchBaselineFracRef.current = medianOf(noseFracs);
    const cal = fitGazeCalibration(gazeSamplesRef.current);
    gazeCalRef.current = cal;
    const targetsDetected = Object.values(gazeSamplesRef.current).filter((a) => a.length > 0).length;
    await put('calibration_data', {
      calibration_id: uuidv4(),
      session_id: sessionId,
      is_real_calibration: cal.valid,
      targets_detected: targetsDetected,
      targets_total: 9,
      ear_baseline: baselineEarRef.current,
      gaze_h_threshold: cal.valid ? cal.hThreshold : null,
      gaze_v_threshold: cal.valid ? cal.vThreshold : null,
      pitch_baseline_frac: pitchBaselineFracRef.current,
      calibrated_at: Date.now(),
    });
    return cal.valid;
  }, []);

  const beginCondition = useCallback(() => {
    aggRef.current = new EyeMetricsAggregator();
  }, []);

  const endCondition = useCallback(
    async (conditionId: string, sessionId: string) => {
      if (status !== 'active' || !aggRef.current) {
        await put('eye_metrics', disabledEyeMetrics(conditionId, sessionId));
        return;
      }
      const record = aggRef.current.finalize({
        conditionId,
        sessionId,
        cameraActive: true,
        baselineEarValue: baselineEarRef.current,
        // The BLINK-DETECTION threshold, which is what a blink is registered at, not the
        // completeness cut. This exported 0.6 x baseline — the boundary between complete and
        // incomplete — while classification actually keys on 0.75 x baseline, so a reader could not
        // reproduce the classification from the CSV as the codebook promised. Both are now
        // exported: the detection threshold here, the completeness cut beside it.
        earThresholdUsed: baselineEarRef.current != null ? baselineEarRef.current * EAR_TIERS.partial : null,
        earCompleteThreshold: baselineEarRef.current != null ? baselineEarRef.current * EAR_TIERS.full : null,
        gazeCalibrated: gazeCalRef.current?.valid ?? false,
        headPitchCalibrated: pitchBaselineFracRef.current != null,
      });
      aggRef.current = null;
      await put('eye_metrics', record);
    },
    [status],
  );

  /**
   * The live video element and its stream, for CONSENTED media capture only.
   *
   * Exposed rather than hidden because the alternative is a second getUserMedia call, which on many
   * tablets fails or steals the camera from the tracker mid-session. Callers must still check the
   * persisted media_consent grant before capturing — see storage/media.ts mayCapture().
   */
  const mediaSource = useCallback(() => {
    const v = videoRef.current;
    const stream = (v?.srcObject as MediaStream | null) ?? null;
    return v && stream ? { video: v, stream } : null;
  }, []);

  return {
    status,
    subscribeLive, start, stop, calibrate, mediaSource,
    beginGazeCalibration, sampleGazeTarget, endGazeCalibration,
    beginCondition, endCondition,
  };
}
