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
import { faceEar, baselineEar, type Point } from './blink';
import { estimateHeadPose, isOffAxis } from './headPose';
import { estimateGaze } from './gaze';
import { meanLumaFromRGBA } from './lighting';
import { fitGazeCalibration, type GazeCalibration, type GazeSample } from './gazeCalibration';
import { v4 as uuidv4 } from 'uuid';
import { EyeMetricsAggregator, disabledEyeMetrics } from './aggregator';
import { put } from '@/storage/db';
import { now } from '@/lib/timing';
import type { CameraStatus } from '@/storage/types';

interface TrackingApi {
  status: CameraStatus;
  /** Request camera + init FaceMesh. Returns the resulting status. */
  start: () => Promise<CameraStatus>;
  stop: () => void;
  /** Collect calibration EAR samples for ~`ms` and fit the baseline. Resolves to the baseline. */
  calibrate: (ms: number) => Promise<number | null>;
  /** Begin gaze calibration: start EAR baseline collection and reset gaze samples. */
  beginGazeCalibration: () => void;
  /** Sample iris offset for a calibration target for ~`ms` while the participant fixates it. */
  sampleGazeTarget: (targetId: string, ms: number) => Promise<void>;
  /** Fit gaze calibration + EAR baseline, persist a CalibrationRecord. Returns whether gaze fit is valid. */
  endGazeCalibration: (sessionId: string) => Promise<boolean>;
  beginCondition: () => void;
  /** Finalise the current condition and persist an EyeMetricsRecord. */
  endCondition: (conditionId: string, sessionId: string) => Promise<void>;
  setBaselineBlinkRate: (rate: number) => void;
}

export function useTracking(): TrackingApi {
  const [status, setStatus] = useState<CameraStatus>('unavailable');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Tiny offscreen canvas for cheap per-frame luminance sampling (lighting QC).
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceMeshRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);
  const aggRef = useRef<EyeMetricsAggregator | null>(null);
  const calibrating = useRef<{ samples: number[] } | null>(null);
  const baselineEarRef = useRef<number | null>(null);
  const baselineBlinkRef = useRef<number | null>(null);
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
  const ingestResult = useCallback((lm: Point[] | null) => {
    const t = now();
    const luma = sampleLuma();
    if (lm && lm.length > 0) {
      const ear = faceEar(lm);
      if (calibrating.current) calibrating.current.samples.push(ear);
      const gazeNow = gazeFor(lm);
      if (gazeCollectingTarget.current) {
        const id = gazeCollectingTarget.current;
        (gazeSamplesRef.current[id] ??= []).push({ h: gazeNow.h, v: gazeNow.v });
      }
      const agg = aggRef.current;
      if (agg) {
        const pose = estimateHeadPose(lm);
        agg.ingest({
          t_ms: t,
          ear,
          pose,
          zone: gazeNow.zone,
          isCenter: gazeNow.isCenter,
          offAxis: isOffAxis(pose),
          facePresent: true,
          faceSize: 0, // populated from detection box when available
          luma,
        });
      }
    } else if (aggRef.current) {
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
  }, []);

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
      await video.play();
      videoRef.current = video;
      // Small canvas for downsampled luminance sampling (lighting QC) — cheap to read each frame.
      const lumaCanvas = document.createElement('canvas');
      lumaCanvas.width = 32;
      lumaCanvas.height = 24;
      lumaCanvasRef.current = lumaCanvas;

      // Dynamic import keeps MediaPipe out of the critical path and lets the app build/run without it.
      const mod = (await import('@mediapipe/face_mesh')) as unknown as {
        FaceMesh: new (cfg: { locateFile: (f: string) => string }) => {
          setOptions: (o: Record<string, unknown>) => void;
          onResults: (cb: (r: { multiFaceLandmarks?: Point[][] }) => void) => void;
          send: (i: { image: HTMLVideoElement }) => Promise<void>;
        };
      };
      const fm = new mod.FaceMesh({ locateFile: (f) => `/mediapipe/${f}` });
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

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const v = videoRef.current;
    if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    videoRef.current = null;
  }, []);

  const calibrate = useCallback(async (ms: number): Promise<number | null> => {
    if (status !== 'active') return null;
    calibrating.current = { samples: [] };
    await new Promise((r) => setTimeout(r, ms));
    const samples = calibrating.current.samples;
    calibrating.current = null;
    if (samples.length < 10) return null;
    const base = baselineEar(samples);
    baselineEarRef.current = base;
    return base;
  }, [status]);

  const beginGazeCalibration = useCallback(() => {
    calibrating.current = { samples: [] };
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
    calibrating.current = null;
    if (earSamples.length >= 10) baselineEarRef.current = baselineEar(earSamples);
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
        earThresholdUsed: baselineEarRef.current != null ? baselineEarRef.current * 0.6 : null,
        gazeCalibrated: gazeCalRef.current?.valid ?? false,
        baselineBlinkRate: baselineBlinkRef.current,
      });
      aggRef.current = null;
      await put('eye_metrics', record);
    },
    [status],
  );

  const setBaselineBlinkRate = useCallback((rate: number) => {
    baselineBlinkRef.current = rate;
  }, []);

  return {
    status, start, stop, calibrate,
    beginGazeCalibration, sampleGazeTarget, endGazeCalibration,
    beginCondition, endCondition, setBaselineBlinkRate,
  };
}
