/**
 * The frame-interval check (Round 79): the gaps between stored frames say whether the camera itself is
 * slow (about 40 ms apart, exposure-limited) or the tracker skips frames (about 33 and 67 ms).
 */
import { describe, it, expect } from 'vitest';
import { summariseIntervals, MIN_INTERVALS } from '@/tracking/frameIntervals';

/** Frames at the given gaps, all with a face unless `noFace` lists their indices. */
function frames(gaps: number[], noFace: number[] = []) {
  let t = 1000;
  const out = [{ t_ms: t, face: !noFace.includes(0) }];
  gaps.forEach((g, i) => { t += g; out.push({ t_ms: t, face: !noFace.includes(i + 1) }); });
  return out;
}
const repeat = (pattern: number[], n: number) => Array.from({ length: n }, (_, i) => pattern[i % pattern.length]);

describe('the frame-interval check', () => {
  it('reads a camera running at 25 (frames 40 ms apart) as exposure-limited', () => {
    const s = summariseIntervals(frames(repeat([40, 39.6, 40.4], 200)));
    expect(s.verdict).toBe('camera-25');
    expect(s.shares[1]).toBe(1);
    expect(s.medianMs).toBeCloseTo(40, 0);
  });

  it('reads a 30-fps camera whose tracker drops one frame in five as skipping, not as the camera', () => {
    // Mean rate 24 fps — the same average as the 25-fps camera above, opposite cause.
    const s = summariseIntervals(frames(repeat([33.3, 33.3, 33.3, 66.7], 240)));
    expect(s.verdict).toBe('tracker-skips');
    expect(s.shares[0]).toBeCloseTo(0.75, 2);
    expect(s.shares[3]).toBeCloseTo(0.25, 2);
  });

  it('reads an even 30 fps as such', () => {
    expect(summariseIntervals(frames(repeat([33.3, 33.4], 200))).verdict).toBe('camera-30');
  });

  it('does not count a gap that involves a frame without a face', () => {
    // Face lost on frame 3: the 33-ms gaps either side of it are not counted, and nothing else changes.
    const s = summariseIntervals(frames(repeat([33.3], 100), [3]));
    expect(s.n).toBe(98);
    expect(s.verdict).toBe('camera-30');
  });

  it('gives no verdict on too few frames', () => {
    const s = summariseIntervals(frames(repeat([40], MIN_INTERVALS - 1)));
    expect(s.verdict).toBe('too-few');
    expect(summariseIntervals([]).medianMs).toBeNull();
  });
});
