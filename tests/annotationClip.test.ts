/**
 * An annotation clip is kept only if the reading run it filmed completed.
 *
 * A Pause mid-reading ends the camera tracks, which ends the recorder, and the partial clip used to
 * be stored as the condition's annotation segment; the redo then stored a second. See
 * recordDecidedSegment in storage/media.ts and captureMedia in Experiment.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { recordDecidedSegment } from '@/storage/media';

class StubRecorder {
  static isTypeSupported() { return true; }
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['frames']) });
    this.onstop?.();
  }
}

describe('recordDecidedSegment', () => {
  const original = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  beforeEach(() => { (globalThis as { MediaRecorder?: unknown }).MediaRecorder = StubRecorder; vi.useFakeTimers(); });
  afterEach(() => { (globalThis as { MediaRecorder?: unknown }).MediaRecorder = original; vi.useRealTimers(); });
  const stream = {} as MediaStream;

  it('keeps the clip when the run completes', async () => {
    const c = recordDecidedSegment(stream, 180_000);
    c.finish(true);
    expect(await c.kept).not.toBeNull();
  });

  it('discards the clip when the run is abandoned, although the recorder produced bytes', async () => {
    const c = recordDecidedSegment(stream, 180_000);
    c.finish(false);
    expect(await c.kept).toBeNull();
  });

  it('keeps a clip the length cap ended early, once its run then completes', async () => {
    const c = recordDecidedSegment(stream, 1_000);
    vi.advanceTimersByTime(1_000);   // the cap stops the recorder mid-run
    c.finish(true);
    expect(await c.kept).not.toBeNull();
  });

  it('the first decision wins: a later unmount cannot discard a completed run', async () => {
    const c = recordDecidedSegment(stream, 180_000);
    c.finish(true);
    c.finish(false);
    expect(await c.kept).not.toBeNull();
  });
});

describe('the experiment wires it', () => {
  const src = readFileSync('src/experiment/Experiment.tsx', 'utf8');
  it('reading completion keeps it; Pause and unmount discard it', () => {
    expect(src).toMatch(/annotationRecording\.current\?\.finish\(true\)/);
    // The one pause path, used by the Pause button and the camera-lost notice alike.
    const pause = src.slice(src.indexOf('const pauseAndExit = () =>'), src.indexOf('const pauseAndExit = () =>') + 600);
    expect(pause).toMatch(/annotationRecording\.current\?\.finish\(false\);\s*tracking\.stop\(\)/);
    expect(src).toMatch(/useEffect\(\(\) => \(\) => \{ annotationRecording\.current\?\.finish\(false\); \}, \[\]\)/);
  });
  it('a new segment replaces an earlier one of the same condition', () => {
    const body = src.slice(src.indexOf('const captureMedia'), src.indexOf("await put('media_captures'"));
    expect(body).toMatch(/m\.checkpoint !== 'reading_segment'/);
    expect(body).toMatch(/await remove\('media_captures', m\.media_id\)/);
    expect(src).toMatch(/captureMedia\('reading_segment', cond\?\.label \?\? null, conditionId\)/);
  });
});
