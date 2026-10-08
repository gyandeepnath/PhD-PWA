/**
 * What the camera is asked for, and what is done when it cannot comply (Round 79).
 *
 * WHAT A PAGE CAN AND CANNOT ASK FOR. Read in the Chromium source (GitHub mirror chromium/chromium,
 * main, fetched 2026-10-08; docs/CITATION_VERIFICATION.md #60):
 *
 *   - Blink treats `frameRate` as a FORMAT filter. A format whose native rate is below `frameRate.min`
 *     is not a candidate (media_stream_constraints_util_video_device.cc, SatisfiesFrameRateConstraint),
 *     and the camera is then opened at the chosen format's native rate (`requested_format =
 *     candidate_format.format()`). `ideal` only ranks formats and sets the track's frame dropping.
 *   - On Android the camera's auto-exposure frame-rate range is then chosen by Chrome, not by the page:
 *     VideoCapture.java getClosestFramerateRange "Tries to find a range with as low of a minimum value
 *     as possible to allow the camera adjust based on the lighting conditions." So no frameRate value,
 *     min or exact, stops auto-exposure lengthening the frame in a dim scene. The lever for that is the
 *     camera's exposure (tracking/cameraExposure.ts), not this request.
 *
 * So the request does the one thing a constraint can do: make Chrome pick a format that CAN run at
 * 30 frames a second, at 1280x720 if one can. It used to ask for `frameRate: 60` as an ideal, which on
 * a camera whose formats top out at 30 changed nothing, and was recorded as if it had been asked of
 * the camera.
 *
 * THE FALLBACK. `min` is a hard constraint: a camera with no 30-fps format refuses the request with an
 * OverconstrainedError naming frameRate (Chromium's fake test camera, which delivers 20, does exactly
 * that). The request is then repeated without `min`, so a slower camera still runs, and the record says
 * that the floor was dropped and why. Any other error is the caller's to handle.
 */
import { CONFIG } from '@/experiment/config';
import type { CameraPipelineRecord } from '@/storage/types';

export interface CameraRequest {
  width: number;
  height: number;
  /** The ideal frame rate. */
  frameRate: number;
  /** The frame-rate floor sent with the request; null when the camera refused it and it was dropped. */
  frameRateMin: number | null;
  /** The camera facing asked for (an ideal, not a requirement). */
  facingMode: 'user';
}

/** The first request: CONFIG's size and rate, with the frame-rate floor. */
export function initialCameraRequest(): CameraRequest {
  return {
    width: CONFIG.CAMERA_WIDTH,
    height: CONFIG.CAMERA_HEIGHT,
    frameRate: CONFIG.CAMERA_FPS,
    frameRateMin: CONFIG.CAMERA_FPS_MIN,
    facingMode: 'user',
  };
}

/** The request as getUserMedia constraints. Size and facing are ideals; only the rate floor binds. */
export function videoConstraints(r: CameraRequest): MediaTrackConstraints {
  return {
    width: { ideal: r.width },
    height: { ideal: r.height },
    frameRate: r.frameRateMin != null ? { ideal: r.frameRate, min: r.frameRateMin } : { ideal: r.frameRate },
    facingMode: { ideal: r.facingMode },
  };
}

/** True for the refusal the fallback answers: no format meets a constraint (any constraint). */
export function isOverconstrained(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError';
}

/** A numeric capability range as {min, max, step}; null when the browser does not report it. */
export function capRange(r: unknown): { min: number; max: number; step: number | null } | null {
  const o = r as { min?: unknown; max?: unknown; step?: unknown } | null | undefined;
  if (!o || typeof o.min !== 'number' || typeof o.max !== 'number' || !Number.isFinite(o.min) || !Number.isFinite(o.max)) return null;
  return { min: o.min, max: o.max, step: typeof o.step === 'number' && Number.isFinite(o.step) ? o.step : null };
}

/**
 * The camera's capabilities as recorded with the sitting: its size and rate maxima, and the exposure
 * controls it offers. Exposure capabilities come from Blink's image-capture state, which loads after
 * the track starts, so they are read again when the exposure is set (tracking/cameraExposure.ts).
 */
export function describeCapabilities(caps: MediaTrackCapabilities | null): CameraCapabilityRecord | null {
  if (!caps) return null;
  const c = caps as MediaTrackCapabilities & Record<string, unknown>;
  // A maximum alone is enough here; some browsers report no minimum.
  const max = (r: unknown) => {
    const m = (r as { max?: unknown } | null | undefined)?.max;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
  };
  const modes = Array.isArray(c.exposureMode) ? (c.exposureMode as unknown[]).filter((m): m is string => typeof m === 'string') : null;
  const time = capRange(c.exposureTime);
  const iso = capRange(c.iso);
  const comp = capRange(c.exposureCompensation);
  return {
    width_max: max(c.width), height_max: max(c.height), frame_rate_max: max(c.frameRate),
    exposure_modes: modes,
    exposure_time_min: time?.min ?? null, exposure_time_max: time?.max ?? null,
    iso_min: iso?.min ?? null, iso_max: iso?.max ?? null,
    exposure_comp_min: comp?.min ?? null, exposure_comp_max: comp?.max ?? null, exposure_comp_step: comp?.step ?? null,
  };
}

export type CameraCapabilityRecord = NonNullable<CameraPipelineRecord['camera_capabilities']>;

export interface OpenedCamera {
  stream: MediaStream;
  /** What was asked of the camera in the request that succeeded. */
  requested: CameraRequest;
  /** Why the first request was repeated without its frame-rate floor; null when it was not. */
  fallback: string | null;
}

/**
 * Open the camera: first with the 30-fps floor, then — only if the camera refuses that — without it.
 * `getUserMedia` is passed in so the fallback can be tested without a browser.
 */
export async function openCamera(
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>,
  first: CameraRequest = initialCameraRequest(),
): Promise<OpenedCamera> {
  try {
    return { stream: await getUserMedia({ video: videoConstraints(first) }), requested: first, fallback: null };
  } catch (err) {
    if (first.frameRateMin == null || !isOverconstrained(err)) throw err;
    const e = err as { name?: string; constraint?: string };
    const why = `${e.name ?? 'OverconstrainedError'}${e.constraint ? `: ${e.constraint}` : ''}`;
    const second: CameraRequest = { ...first, frameRateMin: null };
    return { stream: await getUserMedia({ video: videoConstraints(second) }), requested: second, fallback: why };
  }
}
