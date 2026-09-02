/**
 * Consented photo and video capture.
 *
 * The default posture of the instrument is that NO image or video leaves the frame buffer: the
 * camera produces numeric ocular measures and the pixels are discarded. That default is what the
 * synopsis promises in §3.10, and it stays the default here.
 *
 * Two things need pixels, though, and both are opt-in and separately consented:
 *
 *  1. SETUP PROOF PHOTOS — one still at session start and one at session end. These document that
 *     the participant was seated at the specified distance under the assigned lighting, which is
 *     the kind of claim a thesis examiner can otherwise only take on trust.
 *
 *  2. ANNOTATION VIDEO — short reading-task segments for the manual blink-annotation sub-study
 *     (Objective 4). Establishing criterion validity for the automated incomplete-blink classifier
 *     REQUIRES video a human can code frame by frame; there is no way to validate the measure
 *     without it. Only the pre-specified validation subsample needs to be asked.
 *
 * Consent rules enforced here rather than left to the UI:
 *  - Each capture type is a separate grant. Declining either leaves the participant fully enrolled;
 *    they simply contribute no media. §3.10 requires camera measurement to be refusable "without
 *    affecting participation", and that has to hold for the stronger ask of retained pixels too.
 *  - Nothing is captured unless the matching grant is present at the moment of capture, checked
 *    against the stored session record rather than a component's local state.
 *  - Every stored item carries its own consent snapshot, so a recording can never be separated
 *    from the permission under which it was made.
 *  - Media is deletable independently of the research data, so a later withdrawal of media consent
 *    does not force discarding the numeric dataset.
 */

export type MediaKind = 'photo' | 'video';
export type MediaCheckpoint = 'session_start' | 'session_end' | 'reading_segment';

/** Per-session media permissions. All default to false — absence of a grant is a refusal. */
export interface MediaConsent {
  /** Numeric ocular measures from the camera (no pixels retained). */
  camera_metrics: boolean;
  /** Retained stills at session start and end, as setup proof. */
  setup_photos: boolean;
  /** Retained reading-task video for manual blink annotation (validation subsample only). */
  annotation_video: boolean;
  /** When the media grants were recorded. */
  granted_at: number | null;
}

export function noMediaConsent(): MediaConsent {
  return { camera_metrics: false, setup_photos: false, annotation_video: false, granted_at: null };
}

export interface MediaRecord {
  media_id: string;
  session_id: string;
  participant_id: string;
  kind: MediaKind;
  checkpoint: MediaCheckpoint;
  /** Condition label when the capture belongs to a specific condition; null for session-level. */
  condition_label: string | null;
  captured_at: number;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  /** FNV-1a over the bytes — lets an export manifest prove the file was not altered or swapped. */
  checksum_fnv1a: string;
  /** The consent state in force when this item was captured. */
  consent_snapshot: MediaConsent;
  /** The bytes themselves. Stored in IndexedDB, never uploaded anywhere by this app. */
  blob: Blob;
}

/** Which consent grant a given capture requires. */
export function requiredGrant(checkpoint: MediaCheckpoint): keyof MediaConsent {
  return checkpoint === 'reading_segment' ? 'annotation_video' : 'setup_photos';
}

/**
 * Whether a capture is permitted right now. Checked against the persisted consent record, so a
 * stale component cannot capture after consent was withdrawn.
 */
export function mayCapture(consent: MediaConsent | null | undefined, checkpoint: MediaCheckpoint): boolean {
  if (!consent) return false;
  return consent[requiredGrant(checkpoint)] === true;
}

/** FNV-1a 32-bit over raw bytes. */
export function fnv1aBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function checksumOfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return fnv1aBytes(new Uint8Array(buf));
}

/**
 * Grab a single still from a live video element.
 *
 * Downscaled to at most `maxWidth` and encoded as JPEG: a setup-proof photo needs to show posture,
 * distance and lighting, not fine detail, and a smaller file keeps a two-session study inside a
 * device storage budget. Returns null when the element has no frame yet, so a caller cannot store
 * an all-black placeholder and mistake it for evidence.
 */
export async function capturePhoto(
  video: HTMLVideoElement,
  maxWidth = 640,
  quality = 0.8,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return blob ? { blob, width: w, height: h } : null;
}

/** Pick a container/codec the browser will actually produce, or null if none is supported. */
export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/**
 * Record a fixed-length segment from a MediaStream.
 *
 * Deliberately time-boxed rather than start/stop-controlled: the annotation sub-study needs a known
 * segment length per condition (the synopsis specifies two 3-minute segments per participant), and
 * an open-ended recording risks filling device storage mid-session and losing the run.
 */
export interface SegmentRecording {
  /** Resolves when the recorder has stopped and the blob is assembled. */
  done: Promise<{ blob: Blob; mime: string; duration_ms: number } | null>;
  /** Stop early — called when the reading exposure ends. Idempotent. */
  stop: () => void;
}

/**
 * Time-boxed, but STOPPABLE.
 *
 * The clip must cover the same window the automated measure does. The recorder used to run a fixed
 * ANNOTATION_SEGMENT_MS and stop on its own timer, while the automated measurement closes at the
 * end of reading — so the clip routinely continued 30-100 s past it, through the comprehension
 * questions and the display-perception ratings. Objective 4 compares human frame-by-frame blink
 * coding against the classifier; coding a window that includes the participant answering
 * multiple-choice questions estimates the disagreement between windows, not the validity of the
 * classifier. The caller now stops it when reading ends, and the timer is only an upper bound.
 *
 * setTimeout is also throttled or suspended while the app is backgrounded, which extended the
 * overrun further; an explicit stop is immune to that.
 */
export function recordSegment(stream: MediaStream, maxDurationMs: number): SegmentRecording {
  const mime = pickVideoMime();
  if (!mime) return { done: Promise.resolve(null), stop: () => {} };

  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    // An explicit bitrate. The default is unbounded, and a 1080p front camera can produce well over
    // 100 MB for three minutes — enough to exhaust the device quota and take the numeric writes of
    // later conditions down with it. 1.2 Mbps is ample for frame-by-frame blink coding.
    videoBitsPerSecond: 1_200_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const started = Date.now();
  let settled = false;
  const stop = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (rec.state !== 'inactive') rec.stop();
  };

  const done = new Promise<{ blob: Blob; mime: string; duration_ms: number } | null>((res) => {
    rec.onstop = () => {
      res(chunks.length ? { blob: new Blob(chunks, { type: mime }), mime, duration_ms: Date.now() - started } : null);
    };
    // An errored recorder never fires onstop, which used to leave the promise pending for ever.
    rec.onerror = () => { settled = true; clearTimeout(timer); res(null); };
  });

  const timer = setTimeout(stop, maxDurationMs);
  rec.start();
  return { done, stop };
}

/** Human-readable size, for the researcher-facing media list. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
