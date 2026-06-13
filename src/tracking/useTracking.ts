/**
 * Camera + MediaPipe FaceMesh tracking hook.
 *
 * Self-hosts the FaceMesh assets (precached for offline). Degrades gracefully: if the camera is
 * denied/unavailable or MediaPipe fails to load, the experiment continues with camera_active=false
 * and disabled (zeroed) eye metrics. Per-condition aggregation is driven by beginCondition/endCondition.
 *
 * Calibration collects EAR samples to fit a real per-participant baseline (the original build's
 * "calibration" stored hardcoded zeros — see gaze.ts). Gaze thresholds remain default unless a
 * future real gaze calibration fits them; gaze_calibrated is reported truthfully.
 */
import { useCallback, useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { faceEar, baselineEar, type Point } from './blink';
import { estimateHeadPose, isOffAxis } from './headPose';
import { estimateGaze } from './gaze';
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
  beginCondition: () => void;
  /** Finalise the current condition and persist an EyeMetricsRecord. */
  endCondition: (conditionId: string, sessionId: string) => Promise<void>;
  setBaselineBlinkRate: (rate: number) => void;
}

export function useTracking(): TrackingApi {
  const [status, setStatus] = useState<CameraStatus>('unavailable');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceMeshRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);
  const latestLandmarks = useRef<Point[] | null>(null);
  const aggRef = useRef<EyeMetricsAggregator | null>(null);
  const calibrating = useRef<{ samples: number[] } | null>(null);
  const baselineEarRef = useRef<number | null>(null);
  const baselineBlinkRef = useRef<number | null>(null);
  const frameCounter = useRef(0);

  const onFrame = useCallback(() => {
    const lm = latestLandmarks.current;
    if (lm && lm.length > 0) {
      const ear = faceEar(lm);
      if (calibrating.current) calibrating.current.samples.push(ear);
      const agg = aggRef.current;
      if (agg) {
        const pose = estimateHeadPose(lm);
        const gaze = estimateGaze(lm);
        agg.ingest({
          t_ms: now(),
          ear,
          pose,
          zone: gaze.zone,
          isCenter: gaze.isCenter,
          offAxis: isOffAxis(pose),
          facePresent: true,
          faceSize: 0, // populated from detection box when available
        });
      }
    } else if (aggRef.current) {
      aggRef.current.ingest({
        t_ms: now(),
        ear: 0,
        pose: { pitch: 0, yaw: 0, roll: 0 },
        zone: 'cc',
        isCenter: false,
        offAxis: false,
        facePresent: false,
        faceSize: 0,
      });
    }
    rafRef.current = requestAnimationFrame(onFrame);
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
      fm.onResults((r) => {
        latestLandmarks.current = r.multiFaceLandmarks?.[0] ?? null;
      });
      faceMeshRef.current = fm;

      // Drive MediaPipe + the sampling loop.
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
      // Separate sampler so metrics are captured even between MediaPipe results.
      requestAnimationFrame(onFrame);

      setStatus('active');
      return 'active';
    } catch (err) {
      const name = (err as { name?: string })?.name ?? '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      const s: CameraStatus = denied ? 'denied' : 'failed';
      setStatus(s);
      return s;
    }
  }, [onFrame]);

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
        gazeCalibrated: false,
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

  return { status, start, stop, calibrate, beginCondition, endCondition, setBaselineBlinkRate };
}
