/**
 * What is measured, when, and where it is kept (Round 80, tracking/measurementSchedule.ts): the
 * recording label the researcher sees is read from the same references that route each frame, and every
 * window that keeps frames has a label.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECORDING_LABEL, recordingLabel, recordingShort, type RecordingWindow } from '@/tracking/measurementSchedule';

const hook = readFileSync('src/tracking/useTracking.ts', 'utf8');

describe('the recording label', () => {
  it('is reported from the references that decide where a frame goes', () => {
    // ingestResult routes a frame by these four references, and nowhere else keeps one.
    expect(hook).toMatch(/if \(calibrating\.current\) \{\s*calibrating\.current\.samples\.push/);
    expect(hook).toMatch(/if \(gazeCollectingTarget\.current\) \{/);
    expect(hook).toMatch(/const agg = aggRef\.current \?\? selfTestAggRef\.current;/);
    // The live payload names the window from exactly those, in the same precedence.
    expect(hook).toMatch(/recording: aggRef\.current \? 'reading'\s*: selfTestAggRef\.current \? 'selftest'\s*: calibrating\.current \? 'baseline'\s*: gazeCollectingTarget\.current \? 'gaze_check'\s*: null,/);
  });

  it('has words for every window, and says "not recorded" outside them', () => {
    const windows: RecordingWindow[] = ['reading', 'selftest', 'baseline', 'gaze_check'];
    for (const w of windows) {
      expect(recordingLabel(w)).toMatch(/^Recording: /);
      expect(recordingShort(w)).toBe('Recording');
    }
    expect(recordingLabel(null)).toBe('Live only — not recorded');
    expect(recordingShort(undefined)).toBe('Not recorded');
    expect(Object.keys(RECORDING_LABEL).sort()).toEqual([...windows, 'none'].sort());
  });
});
