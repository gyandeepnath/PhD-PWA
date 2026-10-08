/**
 * The camera request (Round 79): a 30-fps mode with a floor of 30, repeated without the floor only when
 * the camera refuses it, and what was asked and offered recorded with the sitting.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  initialCameraRequest, videoConstraints, openCamera, describeCapabilities, isOverconstrained,
} from '@/tracking/cameraRequest';
import { exposureCapsText } from '@/storage/export';
import { CONFIG } from '@/experiment/config';

const stream = {} as MediaStream;
const overconstrained = (constraint: string) => Object.assign(new Error('no format'), { name: 'OverconstrainedError', constraint });

describe('the camera request', () => {
  it('asks for a 30-fps mode at 1280x720, facing the user, with a floor of 30', () => {
    const r = initialCameraRequest();
    expect(r).toEqual({ width: CONFIG.CAMERA_WIDTH, height: CONFIG.CAMERA_HEIGHT, frameRate: 30, frameRateMin: 30, facingMode: 'user' });
    expect(videoConstraints(r)).toEqual({
      width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 30 }, facingMode: { ideal: 'user' },
    });
    // Without a floor, the rate is an ideal only.
    expect(videoConstraints({ ...r, frameRateMin: null }).frameRate).toEqual({ ideal: 30 });
  });

  it('opens with the floor when the camera accepts it, and records no fallback', async () => {
    const gum = vi.fn(async () => stream);
    const o = await openCamera(gum);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(o.requested.frameRateMin).toBe(30);
    expect(o.fallback).toBeNull();
  });

  it('repeats the request without the floor when the camera has no 30-fps mode, and says why', async () => {
    const gum = vi.fn()
      .mockRejectedValueOnce(overconstrained('frameRate'))
      .mockResolvedValueOnce(stream);
    const o = await openCamera(gum);
    expect(gum).toHaveBeenCalledTimes(2);
    expect((gum.mock.calls[1][0] as MediaStreamConstraints).video).toMatchObject({ frameRate: { ideal: 30 } });
    expect(((gum.mock.calls[1][0] as MediaStreamConstraints).video as MediaTrackConstraints).frameRate).not.toHaveProperty('min');
    expect(o.requested.frameRateMin).toBeNull();
    expect(o.fallback).toBe('OverconstrainedError: frameRate');
  });

  it('does not retry a refusal that is not about the request (permission, no camera)', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const gum = vi.fn().mockRejectedValue(denied);
    await expect(openCamera(gum)).rejects.toBe(denied);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(isOverconstrained(denied)).toBe(false);
  });

  it('records the exposure controls a camera offers, and nothing it does not', () => {
    // Chromium's fake camera, as read in headless Chromium (Round 79).
    const caps = {
      width: { min: 1, max: 3840 }, height: { min: 1, max: 2160 }, frameRate: { min: 0, max: 20 },
      exposureMode: ['manual', 'continuous'], exposureTime: { min: 10, max: 100, step: 5 },
    } as unknown as MediaTrackCapabilities;
    const d = describeCapabilities(caps)!;
    expect(d).toMatchObject({
      width_max: 3840, height_max: 2160, frame_rate_max: 20, exposure_modes: ['manual', 'continuous'],
      exposure_time_min: 10, exposure_time_max: 100, iso_min: null, exposure_comp_min: null,
    });
    expect(exposureCapsText(d)).toBe('modes manual/continuous; time 10-100');
    expect(exposureCapsText({ ...d, iso_min: 100, iso_max: 3200, exposure_comp_min: -2, exposure_comp_max: 2, exposure_comp_step: 1 / 3 }))
      .toBe('modes manual/continuous; time 10-100; iso 100-3200; comp -2-2/0.333');
    expect(describeCapabilities(null)).toBeNull();
    // A camera that reports no exposure control at all: blank, not a made-up range.
    expect(exposureCapsText(describeCapabilities({ frameRate: { min: 1, max: 30 } } as MediaTrackCapabilities))).toBe('');
  });
});
