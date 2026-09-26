import { describe, it, expect } from 'vitest';
import { SELF_TEST, scoreSelfTest } from '@/tracking/selfTest';

const cues = [2500, 5500, 8500, 11500, 14500];
const good = { fps: 30, facePresence: 0.98 };

describe('camera self-test scoring', () => {
  it('passes when every cued blink is seen at an adequate frame rate with the face in view', () => {
    const r = scoreSelfTest(cues, cues.map((c) => c + 300), good);
    expect(r).toMatchObject({ cued: 5, detected: 5, extra: 0, pass: true, reasons: [] });
  });

  it('counts a blink for at most one cue, and blinks outside the window as extras', () => {
    // One blink between two cues cannot satisfy both; one far away is an extra.
    const r = scoreSelfTest([1000, 2000], [1500, 9000], good);
    expect(r.detected).toBe(1);
    expect(r.extra).toBe(1);
  });

  it('fails with a plain reason when too few cued blinks are seen', () => {
    const r = scoreSelfTest(cues, cues.slice(0, SELF_TEST.MIN_HITS - 1), good);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/only 3 of 5 blinks/);
  });

  it('fails on a low frame rate or the face out of view even when all blinks were seen', () => {
    const blinks = cues.map((c) => c + 100);
    expect(scoreSelfTest(cues, blinks, { fps: 12, facePresence: 0.99 }).reasons.join(' ')).toMatch(/12 frames per second/);
    expect(scoreSelfTest(cues, blinks, { fps: 30, facePresence: 0.5 }).reasons.join(' ')).toMatch(/only 50%/);
    expect(scoreSelfTest(cues, blinks, { fps: null, facePresence: null }).pass).toBe(false);
  });

  it('ignores blinks just outside the matching window', () => {
    const r = scoreSelfTest([5000], [5000 + SELF_TEST.WINDOW_MS + 1], good);
    expect(r.detected).toBe(0);
  });
});
