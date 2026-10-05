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
import { faceEar, fitEarBaseline, EAR_TIERS, LEFT_EYE_EAR, RIGHT_EYE_EAR, type Point } from './blink';
import { startFramePump, frameTimestamp, type FrameMeta, type FramePump, type PumpVideo } from './framePump';
import { PipelineMeter, type MeterWindow, type PipelineSummary } from './pipelineStats';
import { startTracker, createTracker, errorSummary, TRACKER_BACKENDS, type FaceTracker, type TrackerBackend } from './trackers';
import {
  resolveTracker, loadTrackerChoice, saveTrackerChoice, pickFastest, earNoise,
  type TrackerTrial, type TrackerSelectionSource,
} from './trackerChoice';
import { APP_VERSION } from '@/lib/env';

/**
 * How often the operator's live readout updates, in hertz.
 *
 * Deliberately far below the frame rate. The monitor is an operator aid; re-rendering it on every
 * FaceMesh result would compete for the main thread with the tracker itself, and the tracker is the
 * one thing in this app that must never be starved — a dropped frame is a lost EAR sample and the
 * primary outcome is a count of events in that series.
 *
 * THE THROTTLE ONLY HELPS IF THE WORK IS BEHIND IT. An earlier version of this comment claimed the
 * protection above while the caller built the whole stats payload — `liveCounts()` included, which
 * runs classifyBlinks over the entire EAR series — before emitLive was even entered. The throttle
 * guarded the React render and nothing else, so the expensive part ran at full frame rate anyway.
 * emitLive now takes a thunk and invokes it only after both the rate check and the
 * zero-subscriber check pass.
 */
const LIVE_HZ = 4;
import { estimateHeadPose, isOffAxis, noseVerticalFraction } from './headPose';
import { estimateGaze } from './gaze';
import { lumaStatsFromRGBA } from './lighting';
import { CameraHealth } from './cameraHealth';
import { fitGazeCalibration, gazeQuality as gradeGaze, GAZE_TARGETS, type GazeCalibration, type GazeQuality, type GazeSample } from './gazeCalibration';
import { v4 as uuidv4 } from 'uuid';
import { EyeMetricsAggregator, disabledEyeMetrics } from './aggregator';
import { put } from '@/storage/db';
import { now } from '@/lib/timing';
import { startLivenessCheck } from './cameraLiveness';
import type { CameraStatus, CameraPipelineRecord, PipelineWindowFields } from '@/storage/types';

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

/** The landmarks' bounding box in normalised frame coordinates; null when it has no extent. */
function faceBoxFromLandmarks(lm: Point[]): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of lm) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX, h = maxY - minY;
  return w > 0 && h > 0 ? { x: minX, y: minY, w, h } : null;
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
  /**
   * Blinks counted in the reading exposure. LIVE while reading; after it, the count the exposure
   * just finished with, so the operator can see on the following screens that it worked.
   *
   * Null means genuinely not counted — no calibrated baseline, or no exposure has run yet. It never
   * means zero. The aggregator only exists between beginCondition() and endCondition(), i.e. only
   * during READING_TASK, which is why a live-only reading would have shown "—" on every screen the
   * monitor is actually visible on.
   */
  blinks: number | null;
  /** Of those, how many failed to close fully — the primary outcome as it accumulates. */
  incomplete: number | null;
  /** True when `blinks` is the running count of a live exposure rather than a finished one. */
  blinksLive: boolean;
  /**
   * The pipeline over the last ~2 s of the CURRENT screen (tracking/pipelineStats.ts): frames the
   * camera delivered, frames the tracker processed, and frames in which it found a face, per second,
   * with the time one tracker call took. `faceFps` is the rate effective_fps measures and the floor
   * applies to; the other two say which stage is limiting it. Live, not the exposure.
   */
  cameraFps: number | null;
  trackerFps: number | null;
  faceFps: number | null;
  processMsP50: number | null;
  processMsP95: number | null;
  /** How cameraFps was counted: the browser's frame counter, or one per callback (a lower bound). */
  frameCountSource: 'presented-frames' | 'callbacks' | null;
  /** Which tracker is running (tracking/trackers.ts); null before one has started. */
  backend: TrackerBackend | null;
  /** The frame size the camera actually delivers. */
  captureWidth: number | null;
  captureHeight: number | null;
  /**
   * The face's width in camera pixels. The landmark model resizes a crop around the face to 192 or 256
   * px; a face much narrower than that is upsampled and the eyelids lose detail. See CONFIG.CAMERA_WIDTH.
   */
  faceWidthPx: number | null;
  /** The face's bounding box in normalised frame coordinates (unmirrored), for the setup preview. */
  faceBox: { x: number; y: number; w: number; h: number } | null;
  /**
   * The six EAR points of each eye in normalised frame coordinates (unmirrored), for the overlay on
   * the researcher card's live picture. Null without a face.
   */
  eyes: { left: Point[]; right: Point[] } | null;
  /**
   * The last CONFIG.EAR_TRACE_MS of eye openness, one entry per processed frame: [ms before now (<= 0),
   * EAR, or null for a frame without a face]. The researcher card draws it against 0.75 and 0.60 of
   * the baseline — the two cuts that define a blink and a complete one.
   */
  earTrace: Array<[number, number | null]>;
  /** The participant's open-eye baseline, when calibration has fitted one. */
  baselineEar: number | null;
  /**
   * Effective frame rate of the last reading exposure, from the record that was written.
   *
   * This is the number that belongs beside the ratio's sampling floor; `fps` above describes
   * whatever screen is on now. Null until an exposure has completed.
   */
  exposureFps: number | null;
  /** Face bounding-box size as a fraction of the frame; a proxy for viewing distance. */
  faceSize: number | null;
  /** Whether gaze is currently in the central zone. */
  onScreen: boolean;
  /** Blinks counted across the sitting so far: every finished exposure plus the live one. */
  sessionBlinks: number | null;
  /** The 3x3 gaze zone this frame ('cc' is centre); null with no face. */
  gazeZone: string | null;
  /** How long the face has been missing right now, ms (0 with a face, or when the feed is blocked). */
  noFaceForMs: number;
  /** Mean frame luminance 0-255; near 0 means the camera sees nothing. */
  luma: number | null;
  /** True while the feed is judged covered or switched off. See cameraHealth.ts. */
  blocked: boolean;
}

interface TrackingApi {
  status: CameraStatus;
  /** Subscribe to the live readout. Returns an unsubscribe function. */
  subscribeLive: (fn: (s: LiveTrackingStats) => void) => () => void;
  /** Request the camera and start the face tracker. Returns the resulting status. */
  start: () => Promise<CameraStatus>;
  stop: () => void;
  /** Why the last start() failed, in the library's words; null after a successful start. */
  startError: string | null;
  /**
   * What the camera and the tracker are actually running as: the backend and how it was chosen, what
   * was asked of the camera and what it gave. Null while the camera is not running.
   */
  pipelineInfo: () => CameraPipelineRecord | null;
  /**
   * Measure every tracker backend on the live camera for a few seconds each, keep the fastest for this
   * device, and switch to it (tracking/trackerChoice.ts). `onProgress` reports which one is running.
   * Resolves to the trials, or null when the tracker is frozen by CONFIG.TRACKER_BACKEND or the camera
   * is not running.
   */
  compareTrackers: (onProgress?: (p: { backend: TrackerBackend; index: number; total: number }) => void) => Promise<TrackerTrial[] | null>;
  /**
   * Open the dedicated open-eye baseline window for ~`ms` while the participant fixates the centre,
   * and fit the baseline from those frames alone. Resolves to the fit and the evidence behind it.
   */
  measureEarBaseline: (ms: number) => Promise<{ baseline: number | null; usable: number }>;
  /** Live video element + stream for CONSENTED capture; null when the camera is not running. */
  mediaSource: () => { video: HTMLVideoElement; stream: MediaStream } | null;
  /**
   * Begin gaze calibration: reset the gaze sample pool. Opens NO EAR window — the nine targets move
   * the eye through three vertical postures, and frames taken there do not describe the open eye at
   * the reading posture. See calibrationSequence.ts.
   */
  beginGazeCalibration: () => void;
  /** Sample iris offset for a calibration target for ~`ms` while the participant fixates it. */
  sampleGazeTarget: (targetId: string, ms: number) => Promise<void>;
  /**
   * Fit the gaze mapping, persist a CalibrationRecord carrying it together with the baseline
   * measured earlier by measureEarBaseline, and report both verdicts.
   */
  endGazeCalibration: (sessionId: string) => Promise<CalibrationOutcome>;
  beginCondition: () => void;
  /** Start and finish the camera self-test (see tracking/selfTest.ts); endSelfTest returns what it saw. */
  beginSelfTest: () => void;
  endSelfTest: () => SelfTestObservation;
  /** Finalise the current condition and persist an EyeMetricsRecord. */
  endCondition: (conditionId: string, sessionId: string) => Promise<void>;
  /**
   * When the camera was LOST after it had started — the track ended, or frames stopped arriving while
   * the page was visible. Null while it is running or was never started. The experiment must act on
   * this: see the camera-lost notice in Experiment.tsx.
   */
  cameraLostAt: number | null;
  /**
   * The camera is running but sees nothing — covered, or switched off by the Android camera-privacy
   * toggle, which delivers black frames instead of ending the stream. Clears by itself when the
   * picture returns. See cameraHealth.ts.
   */
  cameraBlocked: boolean;
}

/** What the self-test window saw: blinks, face coverage, and what the pipeline did meanwhile. */
export interface SelfTestObservation {
  blinkOnsets: number[];
  /** Face-solved frame rate of the EAR series (the rate effective_fps measures). */
  fps: number | null;
  facePresence: number | null;
  /** Camera, tracker and processing-time figures over the same window; null without a camera. */
  pipeline: PipelineWindowFields | null;
}

/** A meter summary as the record fields stored per condition and with the self-test. */
export function pipelineFields(
  sum: PipelineSummary,
  info: Pick<CameraPipelineRecord, 'tracker_backend' | 'camera_settings' | 'timestamp_source'> | null,
): PipelineWindowFields {
  const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    tracker_backend: info?.tracker_backend ?? null,
    camera_fps_delivered: r1(sum.cameraFps),
    tracker_fps: r1(sum.trackerFps),
    frames_delivered: sum.framesDelivered,
    frames_processed: sum.framesProcessed,
    frames_skipped: sum.framesSkipped,
    process_ms_p50: r1(sum.processMsP50),
    process_ms_p95: r1(sum.processMsP95),
    camera_setting_width: info?.camera_settings.width ?? null,
    camera_setting_height: info?.camera_settings.height ?? null,
    camera_setting_fps: info?.camera_settings.frameRate ?? null,
    frame_count_source: sum.deliveredSource,
    timestamp_source: info?.timestamp_source ?? null,
  };
}

/**
 * What a calibration actually established.
 *
 * A bare boolean could only carry the gaze verdict, so the one thing the primary outcome depends
 * on — whether this participant has an open-eye EAR baseline — had no way of reaching the caller.
 */
export interface CalibrationOutcome {
  /** The nine-point gaze mapping met its acceptance criterion. */
  gazeValid: boolean;
  /** The participant's open-eye EAR baseline, or null if none could be fitted. */
  earBaseline: number | null;
  /** How many frames of the routine yielded a usable EAR. Distinguishes a thin fit from a solid one. */
  earSamplesUsable: number;
  /**
   * How much evidence the gaze fit actually rests on.
   *
   * gazeValid is one boolean over a deliberately lenient bar, and it hid the distinction that
   * matters: nine targets with two dozen samples each, and six targets with a single frame each,
   * both produced `true` and both showed the operator nothing. This carries the counts so a
   * calibration that barely happened can be told apart from one that did.
   */
  gazeQuality: GazeQuality;
}

export function useTracking(): TrackingApi {
  const [status, setStatus] = useState<CameraStatus>('unavailable');
  const [cameraLostAt, setCameraLostAt] = useState<number | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** Blinks counted in the sitting's FINISHED exposures, for the researcher panel's running total. */
  const sessionBlinksDone = useRef(0);
  const healthRef = useRef(new CameraHealth());
  /** Muted time of the camera track in the current condition; see the mute listeners in start(). */
  const mutedSinceRef = useRef<number | null>(null);
  const mutedMsRef = useRef(0);
  /** Set when the camera stopped after starting; read synchronously by endCondition. */
  const lostRef = useRef(false);
  /** When the tracker last produced a result (face or not). The liveness signal for the stall check. */
  const lastResultAtRef = useRef<number | null>(null);
  /** Teardown for the stall watchdog and its visibility listener, while the camera runs. */
  const watchdogStopRef = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Tiny offscreen canvas for downsampled luminance sampling (lighting QC), read at LUMA_SAMPLE_HZ.
  const lumaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * The last luminance reading and when it was taken. Frames between readings carry it forward to the
   * camera-health check, which judges "black for 3 s" and so is unaffected by a 250 ms grid; the
   * aggregator receives each reading once, so mean_face_luma is a mean of readings, not of copies.
   */
  const lumaHeldRef = useRef<{ t: number; mean: number; std: number } | null>(null);
  /** The face tracker, when the camera is running. See trackers.ts. */
  const trackerRef = useRef<FaceTracker | null>(null);
  /** Detect calls that threw since the tracker last answered; see process(). */
  const trackerErrorsRef = useRef(0);
  const trackerAnsweredRef = useRef(false);
  /** The frame pump, when the camera is running. See framePump.ts. */
  const pumpRef = useRef<FramePump | null>(null);
  /** Camera, tracker and processing-time counts. See pipelineStats.ts. */
  const meterRef = useRef(new PipelineMeter());
  /** The pipeline as it is running now, for the session record. */
  const pipelineRef = useRef<CameraPipelineRecord | null>(null);
  /** The condition's (or self-test's) stretch of the meter. */
  const conditionWindowRef = useRef<MeterWindow | null>(null);
  const selfTestWindowRef = useRef<MeterWindow | null>(null);
  /** Last sample time handed out, so the series stays strictly increasing. */
  const lastSampleTRef = useRef<number>(-Infinity);
  /** EAR values collected while one tracker backend is being trialled; null otherwise. */
  const trialEarsRef = useRef<number[] | null>(null);
  /** The last EAR_TRACE_MS of [time, EAR or null], for the researcher card's trace. */
  const earTraceRef = useRef<Array<[number, number | null]>>([]);
  const aggRef = useRef<EyeMetricsAggregator | null>(null);
  const calibrating = useRef<{ samples: number[]; noseFracs: number[] } | null>(null);
  const baselineEarRef = useRef<number | null>(null);
  /** Usable frames behind baselineEarRef. Carried to the record so a thin fit is distinguishable. */
  const earSamplesUsableRef = useRef(0);
  // Per-participant frontal nose fraction (pitch zero), captured during calibration.
  const pitchBaselineFracRef = useRef<number | null>(null);
  // Gaze calibration state.
  const gazeCalRef = useRef<GazeCalibration | null>(null);
  /** The calibration record written by the last completed calibration of THIS mount; null before one. */
  const calibrationIdRef = useRef<string | null>(null);
  const gazeSamplesRef = useRef<Record<string, GazeSample[]>>({});
  const gazeCollectingTarget = useRef<string | null>(null);

  const gazeFor = (lm: Point[]) => {
    const c = gazeCalRef.current;
    return c
      ? estimateGaze(lm, c.hThreshold, c.vThreshold, c.h0, c.v0)
      : estimateGaze(lm);
  };

  /** Mean and spread of luminance of the current video frame (0-255), null if unavailable. */
  const sampleLuma = (): { mean: number; std: number } | null => {
    const v = videoRef.current;
    const cv = lumaCanvasRef.current;
    if (!v || !cv || v.readyState < 2) return null;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(v, 0, 0, cv.width, cv.height);
      return lumaStatsFromRGBA(ctx.getImageData(0, 0, cv.width, cv.height).data);
    } catch {
      return null; // e.g. tainted canvas — skip lighting for this frame
    }
  };

  // Ingest exactly ONE sample per tracker result, so the EAR series is sampled at the true
  // measurement rate (not the display refresh rate). The previous build ran a free-running 60 fps
  // sampler over stale landmarks, duplicating samples and overstating effective_fps.
  /*
   * Live-readout plumbing. Emission is throttled to LIVE_HZ rather than fired per frame: the
   * monitor is an operator aid and re-rendering it 30 times a second would compete with the
   * tracker for the main thread, which is the one thing that must never be starved.
   */
  const liveSubs = useRef(new Set<(s: LiveTrackingStats) => void>());
  /*
   * The blink counts the most recent reading exposure ENDED with.
   *
   * The aggregator is created in beginCondition() and consumed in endCondition(), both of which
   * happen inside READING_TASK — and the monitor is deliberately hidden during reading, because a
   * changing number in peripheral vision competes with the stimulus the blink data comes from. So a
   * readout that only ever reported the live aggregator would show "—" on every screen it is
   * actually visible on. Retaining the last finished count is what makes the monitor answer the
   * question it exists to answer: did the exposure that just ran record blinks?
   */
  const lastConditionCounts = useRef<{ blinks: number | null; incomplete: number | null }>({ blinks: null, incomplete: null });
  /**
   * The effective frame rate the last reading exposure actually achieved.
   *
   * The live fps is measured over a 2-second trailing window, and the monitor is hidden during
   * reading — so every fps an operator could ever see described the CURRENT non-reading screen
   * while being coloured against FPS_RATIO_THRESHOLD, a floor that means "the rate needed for the
   * incomplete-blink ratio to be measurable during reading". The two screens do not even carry the
   * same per-frame cost: reading additionally runs head-pose estimation and aggregator ingest.
   * A green 34 fps on the comprehension screen therefore said nothing about the exposure it
   * appeared to vouch for.
   */
  const lastConditionFps = useRef<number | null>(null);
  const lastLiveEmit = useRef(0);

  const subscribeLive = useCallback((fn: (s: LiveTrackingStats) => void) => {
    liveSubs.current.add(fn);
    return () => { liveSubs.current.delete(fn); };
  }, []);

  type LiveCore = Omit<LiveTrackingStats,
    'cameraFps' | 'trackerFps' | 'faceFps' | 'processMsP50' | 'processMsP95' | 'frameCountSource' | 'backend'
    | 'captureWidth' | 'captureHeight' | 'earTrace' | 'baselineEar'>;

  /**
   * Emit the live readout, at most LIVE_HZ times a second and only when someone is listening.
   *
   * `build` is a THUNK, and that is the whole point. It used to take an already-constructed stats
   * object, so the caller evaluated everything — including `liveCounts()`, which runs
   * classifyBlinks over the entire EAR series — on every single frame, before the throttle and
   * before the zero-subscriber check.
   *
   * The cost was quadratic and landed in the worst possible place. The aggregator exists only
   * between beginCondition and endCondition, i.e. only during READING_TASK, which is exactly when
   * the monitor is hidden and the subscriber set is empty. Measured over a 3-minute condition at
   * 30 fps: 14.6 million sample scans and 5,400 array allocations, on the main thread, for a
   * readout nobody was watching — 7.5x the work of doing it at LIVE_HZ. Every millisecond spent
   * there is a millisecond the tracker is not running, and a dropped frame is a lost EAR sample
   * from the series the primary outcome is counted in.
   *
   * The frame rates now come from the pipeline meter, which counts every frame in O(1).
   */
  const emitLive = useCallback((t: number, build: () => LiveCore) => {
    if (t - lastLiveEmit.current < 1000 / LIVE_HZ) return;
    if (liveSubs.current.size === 0) return;
    lastLiveEmit.current = t;
    const m = meterRef.current.live();
    const v = videoRef.current;
    const trace = earTraceRef.current.map(([ts, e]): [number, number | null] => [Math.round(ts - t), e]);
    const payload: LiveTrackingStats = {
      ...build(),
      cameraFps: m.cameraFps, trackerFps: m.trackerFps, faceFps: m.faceFps,
      processMsP50: m.processMsP50, processMsP95: m.processMsP95, frameCountSource: m.deliveredSource,
      backend: trackerRef.current?.backend ?? null,
      captureWidth: v?.videoWidth || null, captureHeight: v?.videoHeight || null,
      earTrace: trace,
      baselineEar: baselineEarRef.current,
    };
    for (const fn of liveSubs.current) fn(payload);
  }, []);

  const ingestResult = useCallback((lm: Point[] | null, t: number) => {
    lastResultAtRef.current = now();
    /*
     * Brightness, read LUMA_SAMPLE_HZ times a second rather than every frame (CONFIG.LUMA_SAMPLE_HZ).
     * `fresh` is this frame's reading when one was taken; `held` is the latest reading, which the
     * camera-health check needs on every frame.
     */
    let fresh: { mean: number; std: number } | null = null;
    const held0 = lumaHeldRef.current;
    if (!held0 || t - held0.t >= 1000 / CONFIG.LUMA_SAMPLE_HZ || t < held0.t) {
      fresh = sampleLuma();
      if (fresh) lumaHeldRef.current = { t, ...fresh };
    }
    const held = lumaHeldRef.current;
    const luma = held ? held.mean : null;
    // Is the camera seeing anything, and is it seeing the participant? See cameraHealth.ts.
    const health = healthRef.current;
    if (health.observe({ t, luma, lumaStd: held ? held.std : null, face: !!(lm && lm.length > 0) })) {
      setCameraBlocked(health.isBlocked());
    }
    const v = videoRef.current;
    const aspect = v && v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 1;
    // The eye-openness trace for the researcher card: one entry per processed frame, CONFIG.EAR_TRACE_MS long.
    const trace = earTraceRef.current;
    if (lm && lm.length > 0) {
      const ear = faceEar(lm, aspect);
      trace.push([t, Number.isFinite(ear) ? ear : null]);
      if (trialEarsRef.current && Number.isFinite(ear)) trialEarsRef.current.push(ear);
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
      const agg = aggRef.current ?? selfTestAggRef.current;
      if (agg) {
        const pose = estimateHeadPose(lm, pitchBaselineFracRef.current, aspect);
        agg.ingest({
          t_ms: t,
          ear,
          pose,
          zone: gazeNow.zone,
          isCenter: gazeNow.isCenter,
          offAxis: isOffAxis(pose),
          facePresent: true,
          faceSize: faceSizeFromLandmarks(lm),
          luma: fresh ? fresh.mean : null,
        });
      }
      emitLive(t, () => {
        const live = agg?.liveCounts(baselineEarRef.current);
        const box = faceBoxFromLandmarks(lm);
        return {
          facePresent: true,
          ear: Number.isFinite(ear) ? ear : null,
          earRatio: baselineEarRef.current && Number.isFinite(ear) ? ear / baselineEarRef.current : null,
          blinks: live?.blinks ?? lastConditionCounts.current.blinks,
          incomplete: live?.incomplete ?? lastConditionCounts.current.incomplete,
          blinksLive: live != null,
          exposureFps: lastConditionFps.current,
          faceSize: box ? Math.sqrt(box.w * box.h) : null,
          faceWidthPx: box && v?.videoWidth ? Math.round(box.w * v.videoWidth) : null,
          faceBox: box,
          eyes: {
            left: LEFT_EYE_EAR.map((i) => lm[i]).filter(Boolean).map((p) => ({ x: p.x, y: p.y })),
            right: RIGHT_EYE_EAR.map((i) => lm[i]).filter(Boolean).map((p) => ({ x: p.x, y: p.y })),
          },
          onScreen: gazeNow.isCenter,
          gazeZone: gazeNow.zone ?? null,
          sessionBlinks: sessionBlinksDone.current + (live?.blinks ?? 0),
          noFaceForMs: 0,
          luma: luma != null ? Math.round(luma) : null,
          blocked: health.isBlocked(),
        };
      });
    } else {
      trace.push([t, null]);
      /*
       * No face. This MUST emit whether or not an aggregator exists.
       *
       * It used to be gated on `aggRef.current`, which exists only during reading — so on every
       * screen the monitor is visible, losing the face emitted nothing at all and the readout froze
       * on its last value: a green dot and "face", indefinitely. An operator aid that silently
       * reports the opposite of the truth is worse than none.
       */
      emitLive(t, () => {
        const live = aggRef.current?.liveCounts(baselineEarRef.current);
        return {
          facePresent: false, ear: null, earRatio: null,
          blinks: live?.blinks ?? lastConditionCounts.current.blinks,
          incomplete: live?.incomplete ?? lastConditionCounts.current.incomplete,
          blinksLive: live != null,
          exposureFps: lastConditionFps.current,
          faceSize: null, faceWidthPx: null, faceBox: null, eyes: null, onScreen: false,
          gazeZone: null,
          sessionBlinks: sessionBlinksDone.current + (live?.blinks ?? 0),
          noFaceForMs: health.noFaceForMs(t),
          luma: luma != null ? Math.round(luma) : null,
          blocked: health.isBlocked(),
        };
      });
    }
    while (trace.length && t - trace[0][0] > CONFIG.EAR_TRACE_MS) trace.shift();
    const idleAgg = aggRef.current ?? selfTestAggRef.current;
    if (!(lm && lm.length > 0) && idleAgg) {
      idleAgg.ingest({
        t_ms: t,
        ear: 0,
        pose: { pitch: 0, yaw: 0, roll: 0 },
        zone: 'cc',
        isCenter: false,
        offAxis: false,
        facePresent: false,
        faceSize: 0,
        luma: fresh ? fresh.mean : null,
      });
    }
  }, [emitLive]);

  /**
   * One camera frame through the tracker.
   *
   * The frame's measurements are stamped with the time the camera CAPTURED it (framePump.ts,
   * frameTimestamp), not the time the result came back. Strictly increasing, so a capture time that
   * repeats or steps back by a fraction of a millisecond cannot reorder the series.
   */
  const fallBackRef = useRef<((reason: string) => void) | null>(null);
  const process = useCallback(async (meta: FrameMeta) => {
    const tracker = trackerRef.current;
    const video = videoRef.current;
    if (!tracker || !video) return;
    const stamp = frameTimestamp(meta);
    const t = Math.max(stamp.t, lastSampleTRef.current + 0.01);
    lastSampleTRef.current = t;
    if (pipelineRef.current && pipelineRef.current.timestamp_source == null) pipelineRef.current.timestamp_source = stamp.source;
    const a = now();
    let lm: Point[] | null;
    try {
      lm = await tracker.detect(video);
    } catch (err) {
      /*
       * A tracker that throws on every frame from the start is not working, however cleanly it
       * constructed — a GPU delegate whose WebGL context is unusable does exactly that. Ten in a row
       * before it has ever answered moves to the next backend in the chain; after it has answered,
       * an error is one lost frame and the stall watchdog judges anything longer.
       */
      trackerErrorsRef.current += 1;
      if (!trackerAnsweredRef.current && trackerErrorsRef.current >= 10 && trackerRef.current === tracker) {
        fallBackRef.current?.(errorSummary(err));
      }
      return;
    }
    if (trackerRef.current !== tracker) return; // switched while this frame was in flight
    trackerAnsweredRef.current = true;
    trackerErrorsRef.current = 0;
    const done = now();
    meterRef.current.processed(done, done - a, !!(lm && lm.length));
    ingestResult(lm, t);
  }, [ingestResult]);

  /*
   * THE CAMERA STOPPED, AND SOMETHING MUST SAY SO.
   *
   * The `ended` listener used to set a flag that nothing read, and status 'failed', which only made
   * the tracking monitor disappear. Every later condition then wrote a camera-off row — the primary
   * outcome missing for the rest of the sitting — with no notice to the operator, no attempt at
   * recovery, and nothing in the data to tell it from a participant who declined the camera. And a
   * camera that is muted or paused rather than ended (backgrounding does this on some tablets) did not
   * even do that: status stayed 'active' and rows were written with camera_active TRUE over no frames.
   *
   * Now either route lands here: the pump and the stream are released (so no frozen frame can be
   * captured as a setup photo), status becomes 'failed', and cameraLostAt tells the experiment, which
   * stops the sitting to offer a pause — a resume re-runs camera setup and calibration and redoes the
   * condition. Rows written while it is lost say camera_inactive_reason = 'lost'.
   */
  const releasePipeline = useCallback(() => {
    watchdogStopRef.current?.();
    watchdogStopRef.current = null;
    pumpRef.current?.stop();
    pumpRef.current = null;
    /*
     * The tracker is CLOSED, not just dropped. Neither the pre-flight probe nor the tracker ever
     * called close(), so every start — a resume, a retry, a camera restarted after it was lost — left
     * another model, WebGL context and wasm heap behind on a tablet that has to run for ninety
     * minutes (round 74, R1 D4).
     */
    trackerRef.current?.close();
    trackerRef.current = null;
    const v = videoRef.current;
    if (v?.srcObject) (v.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
    if (v) { v.srcObject = null; v.remove(); }
    videoRef.current = null;
    pipelineRef.current = null;
  }, []);

  const markLost = useCallback(() => {
    if (lostRef.current) return;
    lostRef.current = true;
    releasePipeline();
    setStatus('failed');
    setCameraLostAt(Date.now());
  }, [releasePipeline]);

  /**
   * A tracker is about to be replaced: the stretch until the new one answers is a model loading, not
   * a stalled camera. The stall watchdog arms only once a result has arrived (cameraLiveness.ts), so
   * clearing the last-result time disarms it until the new tracker's first result. Loading a model
   * the first time on a tablet (an 11 MB wasm to compile) can take longer than CAMERA_STALL_MS.
   */
  const holdWatchdog = () => { lastResultAtRef.current = null; };

  /** Put `tracker` in charge of the frames; the previous one, if any, is closed. */
  const installTracker = useCallback((tracker: FaceTracker) => {
    const old = trackerRef.current;
    trackerRef.current = tracker;
    trackerErrorsRef.current = 0;
    trackerAnsweredRef.current = false;
    if (old && old !== tracker) old.close();
    if (pipelineRef.current) pipelineRef.current.tracker_backend = tracker.backend;
  }, []);

  /** The tracker failed on its first frames: record why and start the next backend in its chain. */
  fallBackRef.current = (reason: string) => {
    const failed = trackerRef.current;
    const info = pipelineRef.current;
    if (!failed || !info) return;
    trackerRef.current = null;
    holdWatchdog();
    failed.close();
    info.tracker_failures.push({ backend: failed.backend, error: `failed on its first frames: ${reason}` });
    const next = TRACKER_BACKENDS[TRACKER_BACKENDS.indexOf(failed.backend) + 1];
    if (!next) return; // nothing left: no results, and the stall watchdog reports the camera lost
    void startTracker(next, null).then(({ tracker, failures }) => {
      if (pipelineRef.current !== info) { tracker.close(); return; }
      info.tracker_failures.push(...failures);
      installTracker(tracker);
    }).catch((err) => {
      info.tracker_failures.push({ backend: next, error: errorSummary(err) });
    });
  };

  /** The start in progress, so a second call (a double tap on "continue") joins it. */
  const startingRef = useRef<Promise<CameraStatus> | null>(null);

  const startCamera = useCallback(async (): Promise<CameraStatus> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      setStartError('This browser has no camera API.');
      return 'unavailable';
    }
    /*
     * One pipeline at a time. A second start() in one mount — camera setup reached again on a resume —
     * used to open a second stream and a second model beside the first, whose pump and tracker then
     * ran on unseen for the rest of the sitting.
     */
    releasePipeline();
    let stream: MediaStream | null = null;
    try {
      const requested = { width: CONFIG.CAMERA_WIDTH, height: CONFIG.CAMERA_HEIGHT, frameRate: CONFIG.CAMERA_FPS };
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...requested } });
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

      /*
       * What the camera actually gave. Nothing read this before round 75: the app asked for 1280x720
       * at 60 fps and recorded only what the tracker achieved, so a camera that delivered 15 fps in a
       * dim room was indistinguishable from a tracker that could not keep up.
       */
      const videoTrack = stream.getVideoTracks()[0];
      const st = (videoTrack?.getSettings?.() ?? {}) as MediaTrackSettings;
      let caps: MediaTrackCapabilities | null = null;
      try { caps = videoTrack?.getCapabilities?.() ?? null; } catch { caps = null; }
      const numMax = (r: unknown) => {
        const m = (r as { max?: number } | undefined)?.max;
        return typeof m === 'number' && Number.isFinite(m) ? m : null;
      };

      /**
       * A track that ENDS mid-condition must be detected.
       *
       * Nothing listened for it. iOS hands the camera to an incoming call, a second app claims it,
       * or the OS drops it — the track fires `ended`, the tracker then throws into the pump's empty
       * catch, and results simply stop. The aggregator's denominators are its own samples, so the
       * row still reports camera_active TRUE, effective_fps ~30 and face_presence_ratio ~0.95, with
       * an incomplete-blink ratio computed over whatever fraction of the exposure it saw.
       * Indistinguishable from a good row — and the operator manual tells the operator to check
       * exactly those two fields.
       */
      lostRef.current = false;
      setCameraLostAt(null);
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', markLost);
        /*
         * A MUTED track delivers no frames without ending: backgrounding does this on some tablets.
         * The time is recorded per condition (camera_muted_ms); if it lasts while the page is visible,
         * the stall watchdog declares the camera lost.
         */
        track.addEventListener('mute', () => { if (mutedSinceRef.current == null) mutedSinceRef.current = now(); });
        track.addEventListener('unmute', () => {
          if (mutedSinceRef.current != null) {
            mutedMsRef.current += now() - mutedSinceRef.current;
            mutedSinceRef.current = null;
          }
        });
      }
      // Small canvas for downsampled luminance sampling (lighting QC).
      const lumaCanvas = document.createElement('canvas');
      lumaCanvas.width = 32;
      lumaCanvas.height = 24;
      lumaCanvasRef.current = lumaCanvas;
      lumaHeldRef.current = null;

      /*
       * The tracker: the backend this device uses (tracking/trackerChoice.ts), started with its
       * fallback chain (tracking/trackers.ts). Models and wasm are imported lazily and resolved
       * base-relative, for the reasons faceMeshLoader.ts records: a root-absolute path 404s on the
       * GitHub Pages project site while getUserMedia still succeeds and the preview still shows a face.
       * The first frame is used as a probe only when one is already decoded.
       */
      const choice = resolveTracker(CONFIG.TRACKER_BACKEND, loadTrackerChoice());
      const stored = choice.source === 'stored' ? loadTrackerChoice() : null;
      const { tracker, failures } = await startTracker(choice.backend, video.readyState >= 2 ? video : null);
      pipelineRef.current = {
        tracker_backend: tracker.backend,
        tracker_requested: choice.backend,
        tracker_selection: choice.source,
        tracker_failures: failures,
        tracker_trials: stored?.trials ?? null,
        tracker_measured_at: stored?.measuredAt ?? null,
        camera_requested: requested,
        camera_settings: {
          width: typeof st.width === 'number' ? st.width : null,
          height: typeof st.height === 'number' ? st.height : null,
          frameRate: typeof st.frameRate === 'number' ? Math.round(st.frameRate * 10) / 10 : null,
        },
        camera_capabilities: caps ? {
          width_max: numMax(caps.width), height_max: numMax(caps.height), frame_rate_max: numMax(caps.frameRate),
        } : null,
        timestamp_source: null,
        started_at: Date.now(),
      };
      installTracker(tracker);
      meterRef.current.resetCounter();
      lastSampleTRef.current = -Infinity;
      earTraceRef.current = [];

      /*
       * Drive the tracker once per CAMERA frame.
       *
       * This was requestAnimationFrame, which fires at the display's refresh rate and sent whatever
       * the video element was holding without asking whether it was new. A 30 fps camera on a 60 Hz
       * panel had every frame sent twice, each duplicate producing its own result, its own EAR
       * sample and its own timestamp — so the series looked twice as fast as the eye was actually
       * observed, and effective_fps is computed from those timestamps and gates the primary
       * outcome. See framePump.ts.
       */
      pumpRef.current = startFramePump(
        video as unknown as PumpVideo,
        process,
        {
          everyN: CONFIG.PROCESS_EVERY_N_FRAMES,
          onPresented: (meta) => meterRef.current.delivered(meta.now, meta.presentedFrames),
        },
      );

      /*
       * Liveness: a muted or paused camera never fires `ended`. The tracker yields a result per
       * processed frame, face or no face, so no result for CAMERA_STALL_MS while the page is visible
       * means frames have stopped. Armed only after the first result (the model loads first), and the
       * clock restarts when the page becomes visible again — hidden time is not a stall — after
       * nudging the video, which some browsers pause while the page is in the background.
       */
      lastResultAtRef.current = null;
      watchdogStopRef.current = startLivenessCheck({
        lastResultAt: lastResultAtRef,
        isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
        now,
        stallMs: CONFIG.CAMERA_STALL_MS,
        onStall: markLost,
        onVisible: () => { void videoRef.current?.play().catch(() => { /* the stall check decides */ }); },
      });

      setStartError(null);
      setStatus('active');
      return 'active';
    } catch (err) {
      /*
       * Release whatever was acquired. A start that failed AFTER getUserMedia — the face model would
       * not load, say — used to leave the stream running with its `ended` listener attached: the
       * camera light stayed on, and when the OS later ended that track the sitting was told its
       * camera had been LOST, although it never produced a frame.
       */
      for (const t of stream?.getTracks() ?? []) {
        t.removeEventListener('ended', markLost);
        t.stop();
      }
      releasePipeline();
      const name = (err as { name?: string })?.name ?? '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      const s: CameraStatus = denied ? 'denied' : 'failed';
      setStartError(errorSummary(err, 400));
      setStatus(s);
      return s;
    }
  }, [process, markLost, releasePipeline, installTracker]);

  // One camera at a time: two concurrent starts orphaned the first one's pump and watchdog.
  const start = useCallback((): Promise<CameraStatus> => {
    if (!startingRef.current) {
      startingRef.current = startCamera().finally(() => { startingRef.current = null; });
    }
    return startingRef.current;
  }, [startCamera]);

  const stop = useCallback(() => {
    releasePipeline();
  }, [releasePipeline]);

  const pipelineInfo = useCallback((): CameraPipelineRecord | null => {
    const p = pipelineRef.current;
    return p ? { ...p, tracker_failures: [...p.tracker_failures] } : null;
  }, []);

  /** A comparison in progress, so a second tap joins it. */
  const comparingRef = useRef<Promise<TrackerTrial[] | null> | null>(null);
  const compareTrackers = useCallback((onProgress?: (p: { backend: TrackerBackend; index: number; total: number }) => void) => {
    if (comparingRef.current) return comparingRef.current;
    const run = async (): Promise<TrackerTrial[] | null> => {
      const info = pipelineRef.current;
      const video = videoRef.current;
      if (CONFIG.TRACKER_BACKEND !== 'auto' || !info || !video) return null;
      const trials: TrackerTrial[] = [];
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < TRACKER_BACKENDS.length; i++) {
        const backend = TRACKER_BACKENDS[i];
        onProgress?.({ backend, index: i, total: TRACKER_BACKENDS.length });
        if (pipelineRef.current !== info) return null; // the camera stopped
        const t0 = now();
        let tracker: FaceTracker;
        try {
          // The one being measured runs ALONE: the previous tracker is closed first, so two models
          // never compete for the main thread inside one measurement.
          trackerRef.current?.close();
          trackerRef.current = null;
          holdWatchdog();
          tracker = await createTracker(backend);
          if (video.readyState >= 2) await tracker.detect(video);
        } catch (err) {
          trials.push({ backend, ok: false, error: errorSummary(err), initMs: null,
            cameraFps: null, trackerFps: null, faceFps: null, processMsP50: null, processMsP95: null, faceShare: null, earNoise: null });
          continue;
        }
        const initMs = Math.round(now() - t0);
        if (pipelineRef.current !== info) { tracker.close(); return null; }
        installTracker(tracker);
        await wait(CONFIG.TRACKER_TRIAL_WARMUP_MS);
        const win = meterRef.current.open();
        trialEarsRef.current = [];
        await wait(CONFIG.TRACKER_TRIAL_MS);
        const sum = win.close();
        const ears = trialEarsRef.current ?? [];
        trialEarsRef.current = null;
        const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
        trials.push({
          backend, ok: true, initMs,
          cameraFps: r1(sum.cameraFps), trackerFps: r1(sum.trackerFps), faceFps: r1(sum.faceFps),
          processMsP50: r1(sum.processMsP50), processMsP95: r1(sum.processMsP95),
          faceShare: sum.framesProcessed > 0 ? Math.round((sum.framesWithFace / sum.framesProcessed) * 100) / 100 : null,
          earNoise: earNoise(ears),
        });
      }
      const best = pickFastest(trials);
      if (pipelineRef.current !== info) return null;
      /*
       * Start the winner — or, if none could be measured, the one that was running before, so the
       * camera is not left with no tracker at all (the stall watchdog would then report it lost).
       */
      const next = best ?? info.tracker_requested;
      if (trackerRef.current?.backend !== next) {
        try {
          holdWatchdog();
          const { tracker, failures } = await startTracker(next, video.readyState >= 2 ? video : null);
          if (pipelineRef.current !== info) { tracker.close(); return null; }
          info.tracker_failures.push(...failures);
          installTracker(tracker);
        } catch (err) {
          info.tracker_failures.push({ backend: next, error: errorSummary(err) });
        }
      }
      const measuredAt = Date.now();
      if (best) saveTrackerChoice({ backend: best, measuredAt, appVersion: APP_VERSION, trials });
      info.tracker_requested = best ?? info.tracker_requested;
      info.tracker_selection = 'measured' as TrackerSelectionSource;
      info.tracker_trials = trials;
      info.tracker_measured_at = measuredAt;
      return trials;
    };
    comparingRef.current = run().finally(() => { comparingRef.current = null; });
    return comparingRef.current;
  }, [installTracker]);

  /**
   * The open-eye baseline, measured in the posture the outcome is measured in.
   *
   * This used to be dead code — nothing called it — while the baseline was taken from the frames of
   * the nine-point gaze routine instead, three of whose targets sit at the top of the screen. The
   * eye is not the same shape looking up as it is reading, the 90th percentile picks the widest
   * frames in the pool, and every blink threshold is a fraction of the result. It is now the ONLY
   * path that fits a baseline, and the routine runs it first, at centre fixation.
   *
   * Head pitch zero is captured from the same window for the same reason: it defines "frontal" for
   * this participant, and the nine-point routine is the one moment the head is least likely to be.
   */
  const measureEarBaseline = useCallback(async (ms: number): Promise<{ baseline: number | null; usable: number }> => {
    if (status !== 'active') {
      baselineEarRef.current = null;
      earSamplesUsableRef.current = 0;
      return { baseline: null, usable: 0 };
    }
    calibrating.current = { samples: [], noseFracs: [] };
    await new Promise((r) => setTimeout(r, ms));
    const cal = calibrating.current ?? { samples: [], noseFracs: [] };
    calibrating.current = null;
    if (cal.noseFracs.length >= 10) pitchBaselineFracRef.current = medianOf(cal.noseFracs);
    const fit = fitEarBaseline(cal.samples);
    baselineEarRef.current = fit.baseline;
    earSamplesUsableRef.current = fit.usable;
    return fit;
  }, [status]);

  const beginGazeCalibration = useCallback(() => {
    /*
     * No EAR window is opened here, and that omission is the point. See calibrationSequence.ts:
     * frames taken while the participant looks at the top row of targets have a wider palpebral
     * fissure than frames taken while they read, and the baseline is a high percentile of whatever
     * pool it is given.
     */
    gazeSamplesRef.current = {};
    gazeCalRef.current = null;
  }, []);

  const sampleGazeTarget = useCallback(async (targetId: string, ms: number): Promise<void> => {
    gazeCollectingTarget.current = targetId;
    await new Promise((r) => setTimeout(r, ms));
    gazeCollectingTarget.current = null;
  }, []);

  const endGazeCalibration = useCallback(async (sessionId: string): Promise<CalibrationOutcome> => {
    /*
     * THE BASELINE IS NOT FITTED HERE. It was, and that was the defect.
     *
     * Every frame of the nine-point routine was pushed into one pool and this function took the
     * 90th percentile of it. Three of the nine targets sit at y = 0.1: looking up lifts the upper
     * lid, widens the fissure and raises EAR, and a 90th percentile is exactly the statistic that
     * finds those frames. The baseline came out above the participant's straight-ahead open eye,
     * both blink thresholds scale with it (0.75 onset, 0.60 complete), and an incomplete blink —
     * the study's primary outcome — passes below an inflated complete threshold and is counted as
     * complete. One-directional, on the primary outcome, and in the direction that makes a real
     * effect look null.
     *
     * measureEarBaseline now owns the baseline, from its own centre-fixation window taken before
     * the eye is asked to move. This function reads what it established and records it, so the
     * gaze fit and the baseline can fail independently and be reported independently.
     *
     * (An earlier fix here counted USABLE frames rather than raw ones: faceEar returns NaN for a
     * degenerate landmark solve, so a `>= 10` raw check was satisfied by three hundred NaNs. That
     * floor lives in fitEarBaseline and still applies — it is applied in measureEarBaseline.)
     */
    calibrating.current = null;
    const earBaseline = baselineEarRef.current;
    const earSamplesUsable = earSamplesUsableRef.current;

    const cal = fitGazeCalibration(gazeSamplesRef.current);
    gazeCalRef.current = cal;
    /*
     * Taken from the fit, not recounted here. Recounting here is what produced the defect: this
     * line filtered on `a.length > 0` over the RAW samples, while fitGazeCalibration decides
     * validity after dropping non-finite ones. A target that returned nothing but NaN was therefore
     * exported as "detected" in the QC column and simultaneously excluded from the calibration —
     * and the QC column is exactly what an analyst reads to decide whether a sitting's gaze data
     * can be trusted. It overstated coverage in the only case where it mattered.
     */
    const targetsDetected = cal.targetsWithSamples;
    const quality = gradeGaze(cal);
    const calibrationId = uuidv4();
    await put('calibration_data', {
      calibration_id: calibrationId,
      session_id: sessionId,
      is_real_calibration: cal.valid,
      targets_detected: targetsDetected,
      targets_total: GAZE_TARGETS.length,
      samples_per_target: cal.samplesPerTarget,
      gaze_trust: quality.trust,
      gaze_targets_well_covered: quality.wellCovered,
      gaze_threshold_floored: cal.thresholdFloored,
      ear_baseline: earBaseline,
      gaze_h_threshold: cal.valid ? cal.hThreshold : null,
      gaze_v_threshold: cal.valid ? cal.vThreshold : null,
      pitch_baseline_frac: pitchBaselineFracRef.current,
      ear_samples_usable: earSamplesUsable,
      calibrated_at: Date.now(),
    });
    // Every exposure measured from here on is measured under THIS record; see EyeMetricsRecord.
    calibrationIdRef.current = calibrationId;
    return { gazeValid: cal.valid, earBaseline, earSamplesUsable, gazeQuality: quality };
  }, []);

  /** A separate aggregator for the self-test, so it never mixes with a condition's exposure. */
  const selfTestAggRef = useRef<EyeMetricsAggregator | null>(null);
  const beginSelfTest = useCallback(() => {
    selfTestAggRef.current = new EyeMetricsAggregator();
    selfTestWindowRef.current?.close();
    selfTestWindowRef.current = meterRef.current.open();
  }, []);
  const endSelfTest = useCallback((): SelfTestObservation => {
    const agg = selfTestAggRef.current;
    selfTestAggRef.current = null;
    const win = selfTestWindowRef.current;
    selfTestWindowRef.current = null;
    // What the camera and the tracker did over the same seconds, so a low rate says WHY (selfTest.ts).
    const pipeline = win ? pipelineFields(win.close(), pipelineRef.current) : null;
    if (!agg) return { blinkOnsets: [], fps: null, facePresence: null, pipeline };
    const cov = agg.coverage();
    return { blinkOnsets: agg.blinkEvents(baselineEarRef.current).map((e) => e.onset_ms), fps: cov.fps, facePresence: cov.facePresence, pipeline };
  }, []);

  const beginCondition = useCallback(() => {
    aggRef.current = new EyeMetricsAggregator();
    healthRef.current.resetCounts(now());
    mutedMsRef.current = 0;
    if (mutedSinceRef.current != null) mutedSinceRef.current = now();
    conditionWindowRef.current?.close();
    conditionWindowRef.current = meterRef.current.open();
  }, []);

  /** What the camera-health monitor saw during the exposure now ending, for the eye record. */
  const healthFields = () => {
    const t = now();
    const c = healthRef.current.read(t);
    const muted = mutedMsRef.current + (mutedSinceRef.current != null ? t - mutedSinceRef.current : 0);
    return {
      camera_blocked_ms: Math.round(c.blockedMs),
      no_face_longest_ms: Math.round(c.noFaceLongestMs),
      no_face_episodes: c.noFaceEpisodes,
      camera_muted_ms: Math.round(muted),
    };
  };

  const endCondition = useCallback(
    async (conditionId: string, sessionId: string) => {
      const win = conditionWindowRef.current;
      conditionWindowRef.current = null;
      const meterSummary = win?.close() ?? null;
      if (lostRef.current || status !== 'active' || !aggRef.current) {
        // Camera-health fields stay blank here: they describe frames, and none were being measured.
        await put('eye_metrics', disabledEyeMetrics(conditionId, sessionId, lostRef.current ? 'lost' : 'not_running'));
        return;
      }
      /*
       * Retain what this exposure finished with, so the monitor can report it on the screens that
       * follow. Read from the finalized record rather than recomputed, so the number the operator
       * sees is the number that was written to the database.
       */
      const finished = aggRef.current.liveCounts(baselineEarRef.current);
      lastConditionCounts.current = { blinks: finished.blinks, incomplete: finished.incomplete };
      if (typeof finished.blinks === 'number') sessionBlinksDone.current += finished.blinks;

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
        calibrationId: calibrationIdRef.current,
      });
      aggRef.current = null;

      // The rate the exposure ACTUALLY achieved, taken from the record that was written, not
      // recomputed — so the monitor and the export cannot disagree about it.
      lastConditionFps.current = typeof record.effective_fps === 'number' ? record.effective_fps : null;
      /*
       * What the camera and the tracker did during this exposure (round 75): frames delivered,
       * processed and skipped, processing time, the tracker that ran and the camera's actual mode.
       * effective_fps says how often the eye was measured; these say why it was not more often.
       */
      const pipeline = meterSummary ? pipelineFields(meterSummary, pipelineRef.current) : {};
      await put('eye_metrics', { ...record, ...healthFields(), ...pipeline });
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
    subscribeLive, start, stop, measureEarBaseline, mediaSource,
    startError, pipelineInfo, compareTrackers,
    beginGazeCalibration, sampleGazeTarget, endGazeCalibration,
    beginCondition, endCondition,
    beginSelfTest, endSelfTest,
    cameraLostAt,
    cameraBlocked,
  };
}
