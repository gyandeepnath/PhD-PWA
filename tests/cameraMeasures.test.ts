/**
 * One description of what the camera measures, on every screen and in the manual's script, naming
 * every family of camera measure the export carries (audit 86 UI-5).
 *
 * The consent named blinks, eyelid closure and head position; the camera set-up's privacy box named
 * "blink rate, head position and gaze zone"; the calibration runs a gaze check, and 07_eye_metrics
 * exports on_screen_ratio. The participant was told three different things, and the consent left out
 * the gaze estimate. This holds the screens to one source (start/cameraMeasures.ts) and that source to
 * the export's columns. What is collected is unchanged; the wording is the investigator's to check
 * against the approved consent (AUDIT_FINDINGS Round 90).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAMERA_MEASURES, CAMERA_MEASURES_TEXT, CAMERA_OPTION_TITLE } from '@/start/cameraMeasures';
import { CODEBOOK } from '@/storage/export';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
/** The source with its comments removed: a history quoted in a comment is not a screen's wording. */
const stages = read('src/start/setupStages.tsx').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('what the camera measures, said once', () => {
  it('names blinks, eyelid closure, head position and the gaze estimate, in plain words', () => {
    expect(CAMERA_MEASURES.map((m) => m.family)).toEqual(['blink', 'lid closure', 'head position', 'gaze']);
    expect(CAMERA_MEASURES_TEXT).toBe('how often you blink, how fully your eyelids close, your head position and roughly whether you are looking at the screen');
    expect(CAMERA_OPTION_TITLE).toBe('Use the camera for blink, eyelid, head-position and gaze measures');
  });

  it('each family it names is exported in 07_eye_metrics, and every camera-derived family exported is named', () => {
    const eyeColumns = new Set(CODEBOOK.filter((c) => c.file === '07_eye_metrics.csv').map((c) => c.column));
    for (const m of CAMERA_MEASURES) for (const col of m.exported) expect(eyeColumns, `${m.family}: ${col}`).toContain(col);
    // The gaze estimate is in the export: that is why it is named.
    expect(eyeColumns).toContain('on_screen_ratio');
  });

  it('the consent paragraph, its camera option and both privacy boxes read it from the one source', () => {
    expect(stages).toMatch(/import \{[^}]*CAMERA_MEASURES_TEXT[^}]*\} from '@\/start\/cameraMeasures'/);
    // The consent paragraph and the two privacy-box variants: three uses.
    expect(stages.match(/\{CAMERA_MEASURES_TEXT\}/g)?.length).toBe(3);
    expect(stages).toMatch(/title=\{CAMERA_OPTION_TITLE\}/);
    // No screen keeps a list of its own.
    expect(stages).not.toMatch(/gaze zone/);
    expect(stages).not.toMatch(/blink and head-position measures/);
    expect(stages).not.toMatch(/how fully your eyelids close/);
  });

  it('the codebook says what a camera consent agreed to, and from which round', () => {
    const entry = CODEBOOK.find((c) => c.file === '01_session_info.csv' && c.column === 'consent_camera_metrics')!;
    expect(entry.description).toContain(CAMERA_MEASURES_TEXT);
    expect(entry.description).toMatch(/Round 90/);
    expect(entry.description).toMatch(/Nothing collected changed/);
  });

  it('the manual\'s spoken consent script says the same', () => {
    // The script is a block quote: its line breaks carry "> ".
    const manual = read('docs/OPERATOR_MANUAL.md').replace(/\n\s*> ?/g, ' ').replace(/\s+/g, ' ');
    expect(manual).toContain(CAMERA_MEASURES_TEXT);
  });
});
