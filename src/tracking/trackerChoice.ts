/**
 * Which face tracker this tablet uses — measured on the tablet, kept per device, frozen by config.
 *
 * WHY MEASURED. Which of the three backends (trackers.ts) is fastest depends on the device's GPU, its
 * CPU and its browser build, and none of them has been measured on the study tablet. On this
 * project's build machine (headless Chromium, software WebGL) the CPU path was the fastest and the GPU
 * path the slowest; a tablet with a real GPU may well be the other way round. Guessing wrong costs the
 * frame rate the primary outcome's gate is about. So the first time the camera is set up on a device
 * (CONFIG.TRACKER_BACKEND 'auto'), each backend runs for a few seconds on the live camera with the
 * operator's or participant's face in view, and the one that solves the most face frames per second is
 * kept for that device.
 *
 * WHY KEPT PER DEVICE, NOT CHOSEN PER SITTING. The three are not the same instrument: on one still
 * portrait the legacy model's and Face Landmarker's eye-aspect ratios differed by a few per cent
 * (round 75, docs/AUDIT_FINDINGS.md). A
 * choice re-made every sitting could put one participant's two sittings, or the two polarities of a
 * split sitting, on different models. Once chosen, the device keeps its tracker until the operator
 * deliberately measures again, every sitting records which one ran and how it was chosen, and the
 * integrity audit flags a participant measured on more than one.
 *
 * WHY FREEZABLE. The blink classifier's validation (the annotation sub-study) is valid only for the
 * tracker it was run on. Setting CONFIG.TRACKER_BACKEND to a named backend fixes it for every device
 * and disables the measurement, which is what the pilot and the validation sub-study need.
 */
import type { TrackerBackend } from './trackers';
import { TRACKER_BACKENDS } from './trackers';

/** One backend's few seconds on the live camera. */
export interface TrackerTrial {
  backend: TrackerBackend;
  /** False when it could not be started at all; `error` says why. */
  ok: boolean;
  error?: string;
  /** Time to load the model and answer the first frame, ms. */
  initMs: number | null;
  /** Frames the camera delivered per second during the trial. */
  cameraFps: number | null;
  /** Frames processed per second, and frames with a face found per second. */
  trackerFps: number | null;
  faceFps: number | null;
  processMsP50: number | null;
  processMsP95: number | null;
  /** Share of processed frames with a face. Low means the trial measured the detector, not tracking. */
  faceShare: number | null;
  /**
   * Frame-to-frame eye-aspect-ratio noise: the median absolute change between successive face frames,
   * as a share of the median EAR. Blinks are brief, so the median ignores them; what is left is how
   * much the eye "moves" when it does not — the tracker's precision on this device.
   */
  earNoise: number | null;
}

/** What is kept on the device after a measurement. */
export interface StoredTrackerChoice {
  backend: TrackerBackend;
  measuredAt: number;
  appVersion: string;
  trials: TrackerTrial[];
}

/** How the tracker that ran was chosen. Exported per sitting. */
export type TrackerSelectionSource =
  /** CONFIG.TRACKER_BACKEND names a backend: frozen for every device. */
  | 'config'
  /** Measured on this device during this sitting's camera setup. */
  | 'measured'
  /** Measured on this device in an earlier sitting and kept. */
  | 'stored'
  /** Nothing measured yet; the first backend that initialised in the default order. */
  | 'default';

/** Minimum share of frames with a face for a trial to count as a measurement of tracking. */
export const MIN_TRIAL_FACE_SHARE = 0.5;

/**
 * The fastest backend among the trials: the most face frames solved per second, and within 1 fps of
 * that, the least time per frame (less main-thread time taken from the tasks' own timing). Trials in
 * which a face was in view for under half the frames count only if no trial had a face — otherwise a
 * backend that saw no face (and so ran only its cheap detector) would win on a measurement of nothing.
 * Null when no backend could start.
 */
export function pickFastest(trials: TrackerTrial[]): TrackerBackend | null {
  const ok = trials.filter((t) => t.ok);
  if (!ok.length) return null;
  const withFace = ok.filter((t) => (t.faceShare ?? 0) >= MIN_TRIAL_FACE_SHARE);
  const pool = withFace.length ? withFace : ok;
  const rate = (t: TrackerTrial) => (withFace.length ? t.faceFps : t.trackerFps) ?? 0;
  const best = Math.max(...pool.map(rate));
  const near = pool.filter((t) => rate(t) >= best - 1);
  near.sort((a, b) => (a.processMsP50 ?? Infinity) - (b.processMsP50 ?? Infinity));
  return near[0].backend;
}

/** Frame-to-frame EAR noise as defined on TrackerTrial; null below ten face frames. */
export function earNoise(ears: number[]): number | null {
  const e = ears.filter((x) => Number.isFinite(x) && x > 0);
  if (e.length < 10) return null;
  const diffs: number[] = [];
  for (let i = 1; i < e.length; i++) diffs.push(Math.abs(e[i] - e[i - 1]));
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const level = med(e);
  return level > 0 ? med(diffs) / level : null;
}

const KEY = 'visulab.tracker.choice.v1';

export function loadTrackerChoice(storage: Pick<Storage, 'getItem'> | null = safeStorage()): StoredTrackerChoice | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredTrackerChoice;
    return v && (TRACKER_BACKENDS as readonly string[]).includes(v.backend) ? v : null;
  } catch {
    return null;
  }
}

export function saveTrackerChoice(c: StoredTrackerChoice, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(c)); } catch { /* private mode: measured again next time */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * The backend to start with, and how it was chosen. `configured` is CONFIG.TRACKER_BACKEND.
 * Under 'auto' with nothing stored, the default order is GPU, then CPU, then legacy — the order in
 * which trackers.ts falls back when one cannot initialise — and camera setup measures straight away.
 */
export function resolveTracker(
  configured: TrackerBackend | 'auto',
  stored: StoredTrackerChoice | null,
): { backend: TrackerBackend; source: TrackerSelectionSource } {
  if (configured !== 'auto') return { backend: configured, source: 'config' };
  if (stored) return { backend: stored.backend, source: 'stored' };
  return { backend: TRACKER_BACKENDS[0], source: 'default' };
}
