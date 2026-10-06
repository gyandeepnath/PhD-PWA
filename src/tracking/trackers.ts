/**
 * The face tracker, behind one interface, with three interchangeable backends.
 *
 *   'tasks-gpu' — MediaPipe Tasks Face Landmarker (@mediapipe/tasks-vision), WebGL inference.
 *   'tasks-cpu' — the same model, CPU (XNNPACK) inference.
 *   'legacy'    — the original @mediapipe/face_mesh 0.4 solution (attention mesh, refineLandmarks).
 *
 * WHY THREE. The investigator's tablet failed the camera self-test on frame rate every time, and no
 * measurement exists of either library on that tablet (Snapdragon 870, Chrome). What WAS measured, in
 * headless Chromium on this project's build machine (round 75, docs/AUDIT_FINDINGS.md), is that the
 * ordering is not obvious: there, with software WebGL, the Tasks CPU path took about 85 ms a frame
 * (median), the legacy path about 165 ms and the Tasks GPU path about 325 ms, in paired runs on a
 * machine shared with other work — the absolute figures moved by tens of per cent between runs, the
 * order never did. On a tablet with a real GPU the order may well reverse. So the choice is MEASURED
 * on the device (tracking/trackerChoice.ts), recorded with every condition, and can be frozen in
 * CONFIG.TRACKER_BACKEND for the pilot and the validation sub-study, because the blink classifier's
 * validation is only valid for the tracker it was run on.
 *
 * TWO DECISIONS THAT ARE ABOUT THE MEASUREMENT, NOT SPEED — both measured, both easy to undo by
 * accident, which is why they are spelled out here:
 *
 *  1. Face Landmarker runs in IMAGE mode, one independent detection per camera frame — NOT the VIDEO
 *     mode its documentation recommends for video. In VIDEO mode with numFaces 1 the graph smooths
 *     landmarks over time (the wasm carries the message "Currently face landmarks smoothing only
 *     support a single face"). A step test on a still portrait (round 75) showed it: shifted by 2 px,
 *     the upper-lid landmarks moved 31% of the way on the first frame, 55% on the second and 66% on
 *     the third, and 66/86/91% of a 6 px shift (IMAGE mode: 100% at once). An eyelid in a blink
 *     moves a few pixels per frame and the incomplete-blink ratio is decided by how deep the minimum
 *     gets, so a filter like that makes blinks shallower and pushes complete blinks toward
 *     "incomplete": a bias in the primary outcome, larger at lower frame rates. IMAGE mode applies no
 *     temporal filter — every frame is measured on its own, as the legacy solution (whose graph has no
 *     smoothing calculator) always did. It is NOT free: it runs the face detector on every frame
 *     instead of following the last frame's landmarks, and cost 104 against 97 ms a frame in paired
 *     runs (92 against 77 under heavier load). That is the price of an unsmoothed blink depth; a tablet
 *     that turns out tracker-limited is a reason to look at the GPU path, not at VIDEO mode. (The two
 *     modes also crop the face differently, and gave different open-eye EARs on the same still
 *     portrait: 0.198 in IMAGE mode, 0.208 in VIDEO mode.)
 *  2. The legacy solution is asked for its landmark stream ONLY. By default it also renders every
 *     input frame back out to a canvas and an ImageBitmap the app never used. See landmarkProto.ts.
 *
 * Landmarks from every backend are the same 478-point topology (468 mesh + 10 iris) in the same
 * normalised image coordinates, so blink.ts, gaze.ts and headPose.ts index them identically. That is
 * asserted against both packages' own landmark constants in tests/landmarkTopology.test.ts.
 *
 * TELEMETRY. @mediapipe/tasks-vision posts usage metrics to a Google endpoint (the 'odml.pa' host on
 * Google's API domain, stated in its README and visible in its bundle; not named here because
 * tests/pwaPolicy.test.ts forbids any Google host in the app's own source). This app blocks every connection to any origin but
 * its own with a Content-Security-Policy in index.html; e2e/trackerTelemetry.spec.ts proves the block.
 */
import type { Point } from './blink';
import { loadFaceMesh, faceMeshAssetPath, type FaceMeshListenerConfig } from './faceMeshLoader';
import { decodeNormalizedLandmarkList } from './landmarkProto';

export type TrackerBackend = 'tasks-gpu' | 'tasks-cpu' | 'legacy';
export const TRACKER_BACKENDS: readonly TrackerBackend[] = ['tasks-gpu', 'tasks-cpu', 'legacy'];

export const TRACKER_LABEL: Record<TrackerBackend, string> = {
  'tasks-gpu': 'Face Landmarker (GPU)',
  'tasks-cpu': 'Face Landmarker (CPU)',
  legacy: 'FaceMesh (legacy)',
};

/** Anything a tracker can read a frame from. */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

export interface FaceTracker {
  readonly backend: TrackerBackend;
  /**
   * Find the face in the frame `source` holds NOW. Returns the 478 landmarks, or null when there is no
   * face. Synchronous for Face Landmarker; a promise for the legacy solution, whose API is async.
   */
  detect(source: FrameSource): Point[] | null | Promise<Point[] | null>;
  /** Release the model, its WebGL context and its wasm heap. The tracker is unusable afterwards. */
  close(): void;
}

/** Options shared by all backends, matching what the legacy solution was always run with. */
const MIN_DETECTION_CONFIDENCE = 0.5;
const MIN_TRACKING_CONFIDENCE = 0.5;

/** Base-relative URL of a vendored Tasks asset (public/tasks-vision/, see scripts/copy-mediapipe.mjs). */
export function tasksAssetPath(file = ''): string {
  const base = new URL(import.meta.env.BASE_URL ?? './', document.baseURI);
  const url = new URL(`tasks-vision/${file}`, base).toString();
  // FilesetResolver appends "/<name>_internal.js" itself, so the directory goes without its slash.
  return file === '' ? url.replace(/\/$/, '') : url;
}

/** The model file, vendored at build time from a pinned URL and checksum (never fetched at run time). */
export const FACE_LANDMARKER_MODEL = 'face_landmarker.task';

/**
 * The legacy solution's landmark stream, and nothing else. The wrapper's default listener also wants
 * "image_transformed" (the input frame, rendered back to a canvas per result) and
 * "multi_face_geometry"; neither is used here.
 */
export const LEGACY_LANDMARKS_ONLY: FaceMeshListenerConfig[] = [
  { wants: ['multi_face_landmarks'], outs: { multiFaceLandmarks: { type: 'proto_list', stream: 'multi_face_landmarks' } } },
];

/** Landmarks as delivered by either legacy listener shape. */
export function legacyLandmarks(raw: unknown): Point[] | null {
  if (raw == null) return null;
  if (raw instanceof Uint8Array) {
    const pts = decodeNormalizedLandmarkList(raw);
    return pts.length ? pts : null;
  }
  return Array.isArray(raw) && raw.length ? (raw as Point[]) : null;
}

async function createLegacy(): Promise<FaceTracker> {
  const Ctor = await loadFaceMesh();
  const fm = new Ctor({ locateFile: faceMeshAssetPath, listeners: LEGACY_LANDMARKS_ONLY });
  fm.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
    minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
  });
  let last: Point[] | null = null;
  fm.onResults((r) => {
    try { last = legacyLandmarks(r.multiFaceLandmarks?.[0]); } catch { last = null; }
  });
  // Load the wasm and the graph now, so a model that cannot load fails HERE (and the next backend in
  // the chain is tried) rather than on the first frame, after the operator has been told it works.
  await fm.initialize?.();
  let closed = false;
  return {
    backend: 'legacy',
    detect: async (source) => {
      if (closed) return null;
      last = null;
      await fm.send({ image: source });
      return last;
    },
    close: () => {
      if (closed) return;
      closed = true;
      void Promise.resolve(fm.close?.()).catch(() => { /* already gone */ });
    },
  };
}

/**
 * Clear the global `Module` the legacy solution's Emscripten scripts leave behind.
 *
 * Both libraries are Emscripten builds. The legacy wasm loader runs as a classic script and leaves a
 * global `Module` carrying debug-build property traps; tasks-vision's loader, finding `self.Module`
 * set, adopts it as its own configuration — and the first trap it touches aborts the start ("Module.
 * noExitRuntime has been replaced…"). Found in round 75: the trackers were measured in the order GPU,
 * CPU, legacy, the CPU path won, and switching to it failed because the legacy one had just run, so the
 * device silently kept the slowest-but-one. tasks-vision clears `self.Module` itself once it has
 * started; the legacy solution does not need it after its own start. Assigned rather than deleted:
 * a `var` global cannot be deleted.
 */
function clearForeignEmscriptenModule(): void {
  const g = globalThis as { Module?: unknown };
  if (g.Module !== undefined) g.Module = undefined;
}

async function createTasks(delegate: 'GPU' | 'CPU'): Promise<FaceTracker> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  clearForeignEmscriptenModule();
  const fileset = await FilesetResolver.forVisionTasks(tasksAssetPath());
  const fl = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: tasksAssetPath(FACE_LANDMARKER_MODEL), delegate },
    // IMAGE, not VIDEO: VIDEO mode smooths landmarks over time. See decision 1 at the top of the file.
    runningMode: 'IMAGE',
    numFaces: 1,
    minFaceDetectionConfidence: MIN_DETECTION_CONFIDENCE,
    minFacePresenceConfidence: MIN_DETECTION_CONFIDENCE,
    minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
    // The blink blendshape is NOT an outcome of this study and is not computed (it would also cost a
    // second model per frame).
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  let closed = false;
  return {
    backend: delegate === 'GPU' ? 'tasks-gpu' : 'tasks-cpu',
    detect: (source) => {
      if (closed) return null;
      const r = fl.detect(source);
      const lm = r.faceLandmarks?.[0];
      return lm && lm.length ? lm : null;
    },
    close: () => {
      if (closed) return;
      closed = true;
      try { fl.close(); } catch { /* already gone */ }
    },
  };
}

/**
 * Whatever was thrown, as words. Not every rejection is an Error: when a tracker's wasm loader script
 * fails to load, Emscripten and FilesetResolver reject with the script element's error EVENT, whose
 * String() is the literal '[object Event]' — which is what the trials table, 'Passed over: …' and the
 * export's tracker_failures used to record (round 77), losing the one fact the column exists for.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const o = err as { type?: unknown; target?: unknown; message?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    // An Event (or anything shaped like one): say what happened and to which asset.
    if (typeof o.type === 'string' && o.type) {
      const t = o.target as { src?: unknown; href?: unknown } | null | undefined;
      const url = typeof t?.src === 'string' && t.src ? t.src : typeof t?.href === 'string' && t.href ? t.href : null;
      return `${o.type} event loading ${url ?? 'a tracker asset'}`;
    }
    const text = String(err);
    if (!/^\[object \w+\]$/.test(text)) return text;
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch { /* circular: fall through */ }
    return `${text.slice(8, -1)} with no message`;
  }
  return String(err);
}

/**
 * An error as one short line. The wasm libraries put a whole Emscripten stack trace into the message,
 * which is unreadable on the camera-setup screen and bloats the export; the first line names the
 * failure.
 */
export function errorSummary(err: unknown, max = 160): string {
  const raw = describeError(err);
  const first = raw.split(/\n| at (?:Error|jsStackTrace|stackTrace|abort)\b/)[0].trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Construct one backend. Throws (with the library's message) when it cannot initialise. */
export function createTracker(backend: TrackerBackend): Promise<FaceTracker> {
  if (backend === 'legacy') return createLegacy();
  return createTasks(backend === 'tasks-gpu' ? 'GPU' : 'CPU');
}

/**
 * The backends to try, in order, when `preferred` is asked for. Always toward the legacy solution and
 * never away from it: GPU falls back to CPU, and Face Landmarker falls back to the legacy solution only
 * when it cannot initialise at all. A tracker frozen to 'legacy' never silently becomes a different
 * model.
 */
export function fallbackChain(preferred: TrackerBackend): TrackerBackend[] {
  const i = TRACKER_BACKENDS.indexOf(preferred);
  return TRACKER_BACKENDS.slice(i < 0 ? 0 : i) as TrackerBackend[];
}

export interface TrackerStart {
  tracker: FaceTracker;
  /** Every backend tried before the one that ran, and why it was passed over. */
  failures: Array<{ backend: TrackerBackend; error: string }>;
}

/**
 * Start the first backend in `preferred`'s chain that initialises AND answers one frame without
 * throwing. A GPU delegate can construct and then fail on its first frame (a lost or unsupported WebGL
 * context), which is why construction alone is not taken as success.
 */
export async function startTracker(
  preferred: TrackerBackend,
  probe: FrameSource | null,
  create: (b: TrackerBackend) => Promise<FaceTracker> = createTracker,
): Promise<TrackerStart> {
  const failures: TrackerStart['failures'] = [];
  for (const backend of fallbackChain(preferred)) {
    let tracker: FaceTracker | null = null;
    try {
      tracker = await create(backend);
      if (probe) await tracker.detect(probe);
      return { tracker, failures };
    } catch (err) {
      tracker?.close();
      failures.push({ backend, error: errorSummary(err) });
    }
  }
  const detail = failures.map((f) => `${f.backend}: ${f.error}`).join('; ');
  throw new Error(`no face tracker could be started (${detail})`);
}
