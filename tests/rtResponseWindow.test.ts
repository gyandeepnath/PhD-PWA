/**
 * The reaction block's response window closes at its deadline (audit 86 D15; rt_window_version rw-v2).
 *
 * It was closed by a once-per-frame poll, so a touch up to one frame after the window was taken as a
 * response, found too late, and recorded as a FALSE START — "a response made before the stimulus
 * appeared" — for a touch made after it. The audit's run: touches 120-128 ms after onset against a
 * 120 ms window gave ten false starts in forty trials.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyRtTouch, RT_WINDOW_VERSION, RT_WINDOW_VERSION_V1 } from '@/lib/rtResponse';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { splitCsvRow } from './helpers/csv';

const W = 1000;
const ONSET = 50_000.25;

describe('a touch is classified by its phase and its own timestamp (audit 86 D15)', () => {
  it('during the fixation cross or the foreperiod it is a false start', () => {
    expect(classifyRtTouch('fixation', ONSET - 600, ONSET, W, false)).toBe('false_start');
    expect(classifyRtTouch('delay', ONSET - 5, ONSET, W, false)).toBe('false_start');
  });

  it('inside the window it is a response, up to and including the deadline', () => {
    for (const ms of [0, 150, 432.7, 999.9, 1000]) expect(classifyRtTouch('stimulus', ONSET + ms, ONSET, W, false), String(ms)).toBe('response');
  });

  it('after the deadline, while the frame still shows the dot, it is ignored — not a false start (the audit\'s band)', () => {
    // One frame at 60 Hz past the window, and the audit's harness band (window 120 ms, touches 120.4-127.8 ms).
    for (const ms of [1000.1, 1005, 1016.6]) expect(classifyRtTouch('stimulus', ONSET + ms, ONSET, W, false), String(ms)).toBe('ignored');
    for (const ms of [120.4, 121.5, 127.8]) expect(classifyRtTouch('stimulus', ONSET + ms, ONSET, 120, false), String(ms)).toBe('ignored');
  });

  it('a second touch in the same trial, and any touch between trials, are ignored', () => {
    expect(classifyRtTouch('stimulus', ONSET + 300, ONSET, W, true)).toBe('ignored');
    expect(classifyRtTouch('iti', ONSET + 1200, ONSET, W, false)).toBe('ignored');
    expect(classifyRtTouch('instruction', 0, 0, W, false)).toBe('ignored');
  });

  it('the task takes every touch through it, with the touch\'s own timestamp', () => {
    const src = readFileSync(resolve(__dirname, '../src/tasks/ReactionTimeTask.tsx'), 'utf8');
    const handler = src.slice(src.indexOf('const handleResponse ='), src.indexOf('const waitForResponseOrTimeout'));
    expect(handler).toMatch(/classifyRtTouch\(phaseRef\.current, e\.timeStamp, onsetRef\.current, CONFIG\.RT_RESPONSE_WINDOW_MS,/);
    expect(handler).toMatch(/respondedAtRef\.current = e\.timeStamp;/);
    expect(handler).not.toMatch(/ph === 'stimulus'/);
  });

  it('is versioned per condition: rw-v2 when stamped, rw-v1 for a row recorded before', () => {
    expect(RT_WINDOW_VERSION).toBe('rw-v2');
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => (i === 0 ? { ...c, rt_window_version: RT_WINDOW_VERSION } : { ...c, rt_window_version: undefined }));
    const csv = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!.content.trim().split('\n');
    const col = splitCsvRow(csv[0]).indexOf('rt_window_version');
    expect(col).toBeGreaterThan(-1);
    const values = new Set(csv.slice(1).map((l) => splitCsvRow(l)[col]));
    expect(values).toEqual(new Set([RT_WINDOW_VERSION, RT_WINDOW_VERSION_V1]));
    expect(CODEBOOK.find((r) => r.file === '08_reaction_trials.csv' && r.column === 'false_start')!.description).toMatch(/rw-v1 rows/);
  });
});
