/**
 * A covered lens or the Android camera-privacy switch gives a blank feed, not a stopped one, so the
 * stall watchdog never fired. The frame's own brightness and spread decide it. See cameraHealth.ts.
 */
import { describe, it, expect } from 'vitest';
import { CameraHealth } from '@/tracking/cameraHealth';
import { lumaStatsFromRGBA } from '@/tracking/lighting';

const run = (h: CameraHealth, from: number, to: number, luma: number, std: number, face: boolean, step = 33) => {
  let changed = 0;
  for (let t = from; t <= to; t += step) if (h.observe({ t, luma, lumaStd: std, face })) changed++;
  return changed;
};

describe('camera blocked (covered / switched off)', () => {
  it('a black, flat feed is blocked after 3 s — not before', () => {
    const h = new CameraHealth();
    run(h, 0, 2900, 2, 1, false);
    expect(h.isBlocked()).toBe(false);
    run(h, 2933, 3100, 2, 1, false);
    expect(h.isBlocked()).toBe(true);
  });

  it('a dark room with a face in it is NOT blocked: it is dark but not flat', () => {
    const h = new CameraHealth();
    run(h, 0, 10_000, 12, 25, true);
    expect(h.isBlocked()).toBe(false);
  });

  it('uncovering the lens clears it after a second, and the blocked time is counted', () => {
    const h = new CameraHealth();
    run(h, 0, 5000, 1, 0.5, false);
    expect(h.isBlocked()).toBe(true);
    run(h, 5033, 5900, 120, 40, true);
    expect(h.isBlocked()).toBe(true);        // not yet a full second of picture
    run(h, 5933, 6100, 120, 40, true);
    expect(h.isBlocked()).toBe(false);
    const c = h.read(6100);
    expect(c.blockedMs).toBeGreaterThan(4500);
    expect(c.noFaceEpisodes).toBe(0);        // a blocked feed is not a missing face
  });
});

describe('no face in an unblocked feed', () => {
  it('counts an episode once it lasts 2 s, and records the longest', () => {
    const h = new CameraHealth();
    run(h, 0, 1000, 120, 40, true);
    run(h, 1033, 1900, 120, 40, false);      // 0.9 s: a glance away, not an episode
    run(h, 1933, 3000, 120, 40, true);
    run(h, 3033, 9000, 120, 40, false);      // 6 s gone
    expect(h.noFaceForMs(9000)).toBeGreaterThan(5900);
    run(h, 9033, 9500, 120, 40, true);
    const c = h.read(9500);
    expect(c.noFaceEpisodes).toBe(1);
    expect(c.noFaceLongestMs).toBeGreaterThan(5900);
  });

  it('resetCounts starts a new condition without forgetting a blocked feed', () => {
    const h = new CameraHealth();
    run(h, 0, 4000, 1, 0.5, false);
    h.resetCounts(4000);
    expect(h.isBlocked()).toBe(true);
    expect(h.read(5000).blockedMs).toBe(1000);
  });
});

describe('luminance spread', () => {
  it('is zero on a uniform frame and large on a varied one', () => {
    const flat = new Uint8ClampedArray(4 * 16).fill(3);
    expect(lumaStatsFromRGBA(flat).std).toBeCloseTo(0, 5);
    const varied = new Uint8ClampedArray(4 * 16);
    for (let i = 0; i < 16; i++) varied.set(i % 2 ? [200, 200, 200, 255] : [20, 20, 20, 255], i * 4);
    expect(lumaStatsFromRGBA(varied).std).toBeGreaterThan(80);
  });
});
