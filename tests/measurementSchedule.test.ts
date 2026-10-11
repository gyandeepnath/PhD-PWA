/**
 * What is measured, when, and where it is kept (Round 80, tracking/measurementSchedule.ts): the
 * recording label the researcher sees is read from the same references that route each frame, and every
 * window that keeps frames has a label.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RECORDING_LABEL, recordingLabel, recordingShort, measurementSchedule, scheduleMarkdown, MEASURE, LIVE_READOUT_HZ,
  type RecordingWindow,
} from '@/tracking/measurementSchedule';
import { CONFIG } from '@/experiment/config';
import { MIN_EAR_BASELINE_SAMPLES } from '@/tracking/blink';
import { GAZE_DOTS, GAZE_DOT_SAMPLE_MS, GAZE_DOT_SETTLE_MS } from '@/tracking/calibrationSequence';

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

describe('the measurement schedule (Round 80)', () => {
  const block = (doc: string) => {
    const text = readFileSync(doc, 'utf8');
    const from = text.indexOf('<!-- measurement-schedule:start');
    const to = text.indexOf('<!-- measurement-schedule:end -->');
    expect(from, `${doc} has no schedule block`).toBeGreaterThan(-1);
    return text.slice(text.indexOf('\n', from) + 1, to).trim();
  };

  it('is the same table in the operator manual and the protocol, rendered from the code', () => {
    // Regenerate with: npx tsx -e "import { scheduleMarkdown } from './src/tracking/measurementSchedule'; console.log(scheduleMarkdown())"
    expect(block('docs/OPERATOR_MANUAL.md')).toBe(scheduleMarkdown());
    expect(block('docs/PROTOCOL.md')).toBe(scheduleMarkdown());
  });

  it('has a row for every window that keeps frames, and says what the panel prints there', () => {
    const rows = measurementSchedule();
    const windows: RecordingWindow[] = ['reading', 'selftest', 'baseline', 'gaze_check'];
    for (const w of windows) {
      const keeping = rows.filter((r) => r.windows?.includes(w));
      expect(keeping.length, w).toBeGreaterThan(0);
      expect(keeping.some((r) => r.live.includes(`"${RECORDING_LABEL[w]}"`)), w).toBe(true);
    }
    expect(rows.some((r) => r.cadence === 'Not measured' && r.live.includes(RECORDING_LABEL.none))).toBe(true);
  });

  it('states the timings the code applies', () => {
    const text = scheduleMarkdown();
    expect(text).toContain(`at least ${CONFIG.EAR_BASELINE_MS / 1000} s, on until ${MIN_EAR_BASELINE_SAMPLES} usable frames, at most ${CONFIG.EAR_BASELINE_MAX_MS / 1000} s`);
    expect(text).toContain(`${GAZE_DOTS.length} dots across a reading line, each sampled ${GAZE_DOT_SAMPLE_MS / 1000} s after ${GAZE_DOT_SETTLE_MS / 1000} s to settle`);
    expect(text).toContain(`${CONFIG.LUMA_SAMPLE_HZ} times a second`);
    expect(text).toContain(`${LIVE_READOUT_HZ} updates a second`);
    // The hook's live rate is the schedule's.
    expect(hook).toMatch(/const LIVE_HZ = LIVE_READOUT_HZ;/);
  });

  it('names each measure by the one table of names', () => {
    const text = scheduleMarkdown();
    for (const k of ['incompleteRatio', 'blinkRate', 'perclos', 'samplingRate', 'faceInView', 'onScreen', 'openEyeBaseline', 'gazeCheck', 'cameraCheck'] as const) {
      expect(text, k).toContain(MEASURE[k].name);
    }
  });
});

describe('one name per measure on every screen (Round 80)', () => {
  // The labels each measure used to carry somewhere, now spelled by MEASURE: the same quantity read
  // "Face found", "FPS", "face fps" or "effective fps" depending on the screen.
  const RETIRED = ["'Face found'", "'FPS (tier)'", "'Face presence'", "'Blink/min'", "'IBI ms'", "'Long-closures'", 'Pooled IBR', 'Low fps', '>face fps<', "row('Gaze'"];
  const SCREENS = ['src/components/ResearcherPanel.tsx', 'src/components/LiveCamera.tsx', 'src/dashboard/Dashboard.tsx', 'src/start/setupStages.tsx'];

  it('the panel, the camera readout, the dashboard and camera setup use none of the retired labels', () => {
    for (const f of SCREENS) {
      const src = readFileSync(f, 'utf8');
      for (const r of RETIRED) expect(src.includes(r), `${f} still says ${r}`).toBe(false);
    }
  });

  it('they take the names from the one table', () => {
    expect(readFileSync('src/components/LiveCamera.tsx', 'utf8')).toMatch(/row\(MEASURE\.samplingRate\.name,/);
    const dash = readFileSync('src/dashboard/Dashboard.tsx', 'utf8');
    for (const k of ['samplingRate', 'faceInView', 'headTurnedAway', 'onScreen', 'blinkRate', 'incompleteRatio', 'interBlinkInterval', 'longClosures']) {
      expect(dash, k).toContain(`MEASURE.${k}.name`);
    }
    expect(readFileSync('src/components/ResearcherPanel.tsx', 'utf8')).toMatch(/MEASURE\.samplingRate\.name/);
  });
});

describe('the export says which column each on-screen name is (Round 80)', () => {
  it('every named column is a documented export column, and carries its name', async () => {
    const { MEASURE_COLUMNS, screenName } = await import('@/tracking/measurementSchedule');
    const { CODEBOOK } = await import('@/storage/export');
    for (const [k, cols] of Object.entries(MEASURE_COLUMNS) as Array<[keyof typeof MEASURE, string[]]>) {
      for (const fc of cols) {
        const [file, column] = fc.split(':');
        const row = CODEBOOK.find((r) => r.file === file && r.column === column);
        expect(row, fc).toBeTruthy();
        expect(row!.description, fc).toContain(`On screen: "${MEASURE[k].name}".`);
        expect(screenName(file, column)).toBe(MEASURE[k].name);
      }
    }
    // One name per column: no column is claimed twice.
    const all = Object.values(MEASURE_COLUMNS).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
