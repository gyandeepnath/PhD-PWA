/**
 * The end of a sitting: one photograph per checkpoint, a reading typed is a reading logged or cleared,
 * a lost thank-you screen loses nothing, and the way out always opens (audit 86 F4, F9, F10, F13).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { put, get, _resetForTests } from '@/storage/db';
import { captureDisposition } from '@/storage/media';
import { logLuxReading, endReadingMissing, endReadingDelayMin } from '@/storage/luxLog';
import { parseLuxEntry } from '@/experiment/illumination';
import { LuxCheckpointPanel } from '@/start/LuxCheckpoint';
import { SessionComplete } from '@/start/setupStages';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles } from '@/storage/export';
import type { SessionRecord } from '@/storage/types';
import { singleRow } from './helpers/csv';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('one photograph per checkpoint per sitting (audit 86 F9)', () => {
  const photo = (id: string, checkpoint: 'session_start' | 'session_end') => ({ media_id: id, checkpoint, condition_id: null, condition_label: null });

  it('the first start photograph is stored; the camera check of a resume does not store another', () => {
    expect(captureDisposition([], 'session_start')).toEqual({ store: true, replaces: [] });
    expect(captureDisposition([photo('a', 'session_start')], 'session_start')).toEqual({ store: false, replaces: [] });
    // Two resumes: still one.
    expect(captureDisposition([photo('a', 'session_start')], 'session_start').store).toBe(false);
  });

  it('the end photograph likewise, and a start photograph does not stand in for it', () => {
    expect(captureDisposition([photo('a', 'session_start')], 'session_end')).toEqual({ store: true, replaces: [] });
    expect(captureDisposition([photo('a', 'session_start'), photo('b', 'session_end')], 'session_end').store).toBe(false);
  });

  it('a reading segment still replaces the earlier clip of the same condition, and only that one', () => {
    const seg = (id: string, cid: string | null, label: string | null) => ({ media_id: id, checkpoint: 'reading_segment' as const, condition_id: cid, condition_label: label });
    const held = [seg('s1', 'c1', 'P1'), seg('s2', 'c2', 'N1'), seg('old', null, 'P3'), photo('p', 'session_start')];
    expect(captureDisposition(held, 'reading_segment', 'c1', 'P1')).toEqual({ store: true, replaces: ['s1'] });
    expect(captureDisposition(held, 'reading_segment', 'c3', 'P3')).toEqual({ store: true, replaces: ['old'] });
    expect(captureDisposition(held, 'reading_segment', 'c9', 'P9')).toEqual({ store: true, replaces: [] });
  });

  it('the sitting asks it before taking a photograph and again before storing one', () => {
    const src = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    const body = src.slice(src.indexOf('const captureMedia = useCallback'), src.indexOf('// --- SESSION INIT ---'));
    expect(body.match(/captureDisposition\(/g)?.length).toBe(2);
  });
});

describe('the closing photograph is taken at the last questionnaire, not on the thank-you screen (audit 86 F4)', () => {
  it('the NASA-TLX handler captures it after the completion write; the thank-you button does not', () => {
    const src = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    const tlx = src.slice(src.indexOf("case 'NASA_TLX':"), src.indexOf("case 'CAMERA_SETUP':"));
    expect(tlx.indexOf("status: 'complete'")).toBeGreaterThan(0);
    expect(tlx.indexOf("captureMedia('session_end')")).toBeGreaterThan(tlx.indexOf("status: 'complete'"));
    const thanks = src.slice(src.indexOf("case 'SESSION_COMPLETE':"), src.indexOf("case 'EXPORT_DASHBOARD':"));
    expect(thanks).not.toMatch(/captureMedia\(/);
  });
});

describe('the thank-you screen\'s way out always opens (audit 86 F13)', () => {
  it('stopping the camera and moving on are in a finally, after the only write', () => {
    const src = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    const thanks = src.slice(src.indexOf("case 'SESSION_COMPLETE':"), src.indexOf("case 'EXPORT_DASHBOARD':"));
    const fin = thanks.indexOf('} finally {');
    expect(fin).toBeGreaterThan(thanks.indexOf("await put('sessions'"));
    expect(thanks.lastIndexOf('tracking.stop();')).toBeGreaterThan(fin);
    expect(thanks.lastIndexOf('advance();')).toBeGreaterThan(fin);
    // And nothing before the finally can stop them: no capture, no unconditional write.
    expect(thanks.slice(0, fin)).not.toMatch(/captureMedia\(/);
    expect(thanks.slice(0, fin)).toMatch(/if \(fresh && \(fresh\.status !== 'complete' \|\| fresh\.session_end_time == null\)\)/);
  });
});

describe('a typed reading is logged or cleared before the screen is left (audit 86 F10)', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  };

  it('reports a typed value as pending, says so, and clears it when logged', () => {
    const pending: boolean[] = [];
    const logged: number[] = [];
    act(() => root.render(createElement(LuxCheckpointPanel, {
      checkpoint: 'middle', level: 'moderate', onSubmit: (l: number) => logged.push(l), onPendingChange: (p: boolean) => pending.push(p),
    })));
    const input = host.querySelector('[data-testid="lux-middle"]') as HTMLInputElement;
    type(input, '310');
    expect(pending.at(-1)).toBe(true);
    expect(host.querySelector('[data-testid="lux-middle-pending"]')?.textContent).toMatch(/Not logged yet/);
    act(() => (host.querySelector('[data-testid="lux-middle-save"]') as HTMLButtonElement).click());
    expect(logged).toEqual([310]);
    expect(pending.at(-1)).toBe(false);
  });

  it('a cleared box is not pending, and an unmounted panel releases the screen', () => {
    const pending: boolean[] = [];
    act(() => root.render(createElement(LuxCheckpointPanel, {
      checkpoint: 'end', level: 'moderate', onSubmit: () => {}, onPendingChange: (p: boolean) => pending.push(p),
    })));
    const input = host.querySelector('[data-testid="lux-end"]') as HTMLInputElement;
    type(input, '3');
    expect(pending.at(-1)).toBe(true);
    type(input, '');
    expect(pending.at(-1)).toBe(false);
    type(input, '305');
    expect(pending.at(-1)).toBe(true);
    act(() => root.render(createElement('div')));
    expect(pending.at(-1)).toBe(false);
  });

  it('the thank-you button is disabled while a reading waits, and does nothing if pressed', () => {
    const onExport = vi.fn();
    act(() => root.render(createElement(SessionComplete, { onExport, exportBlocked: true })));
    const btn = [...host.querySelectorAll('button')].find((b) => /view export dashboard/.test(b.textContent ?? ''))!;
    expect(btn.disabled).toBe(true);
    act(() => btn.click());
    expect(onExport).not.toHaveBeenCalled();
    act(() => root.render(createElement(SessionComplete, { onExport, exportBlocked: false })));
    act(() => ([...host.querySelectorAll('button')].find((b) => /view export dashboard/.test(b.textContent ?? ''))!).click());
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('the break and the thank-you screen wait on the panel (the wiring in the sitting)', () => {
    const src = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    expect(src).toMatch(/canContinue=\{\(launchOk \|\| breakTicked\) && !luxPending\}/);
    expect(src).toMatch(/exportBlocked=\{luxPending\}/);
    expect(src.match(/onPendingChange=\{setLuxPending\}/g)?.length).toBe(2);
  });

  it('one rule for a typed reading: 0 to 200,000', () => {
    expect(parseLuxEntry('310')).toBe(310);
    expect(parseLuxEntry(' 0 ')).toBe(0);
    for (const bad of ['', ' ', 'abc', '-1', '200001', 'NaN']) expect(parseLuxEntry(bad), bad).toBeNull();
  });
});

describe('a lost thank-you screen loses no end reading (audit 86 F4)', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); });

  const done = (extra: Partial<SessionRecord> = {}): SessionRecord => ({
    ...buildFixtureBundle().session, session_id: 'S1', status: 'complete', withdrawn_at: null, deleted_at: null,
    session_end_time: 1_000_000, lux_readings: [{ checkpoint: 'start', lux: 300, at: 1 }], ...extra,
  });

  it('a completed sitting without an end reading is offered one; with one, or withdrawn, or running, it is not', () => {
    expect(endReadingMissing(done())).toBe(true);
    expect(endReadingMissing(done({ lux_readings: [{ checkpoint: 'start', lux: 300, at: 1 }, { checkpoint: 'end', lux: 305, at: 2 }] }))).toBe(false);
    expect(endReadingMissing(done({ withdrawn_at: 5 }))).toBe(false);
    expect(endReadingMissing(done({ status: 'in_progress' }))).toBe(false);
  });

  it('logging it later stores the reading with its time, and the export says how late it was', async () => {
    await put('sessions', done());
    const updated = await logLuxReading('S1', 'end', 305, 1_000_000 + 45 * 60_000);
    expect(updated?.lux_readings.map((r) => r.checkpoint)).toEqual(['start', 'end']);
    const stored = await get('sessions', 'S1');
    expect(stored?.lux_readings.find((r) => r.checkpoint === 'end')).toEqual({ checkpoint: 'end', lux: 305, at: 1_000_000 + 45 * 60_000 });
    expect(stored?.lux_all_in_range).toBe(true);
    expect(endReadingMissing(stored!)).toBe(false);
    expect(endReadingDelayMin(stored!)).toBe(45);

    const b = buildFixtureBundle();
    b.session = { ...b.session, session_end_time: stored!.session_end_time, lux_readings: stored!.lux_readings };
    const row = singleRow(buildExportFiles(b).find((f) => f.filename === '01_session_info.csv')!.content);
    expect(row.lux_end).toBe('305');
    expect(row.lux_end_min_after_end).toBe('45');
  });

  it('logging a checkpoint again replaces it, never adds a second', async () => {
    await put('sessions', done());
    await logLuxReading('S1', 'end', 305, 2_000_000);
    await logLuxReading('S1', 'end', 299, 2_100_000);
    const stored = await get('sessions', 'S1');
    expect(stored?.lux_readings.filter((r) => r.checkpoint === 'end')).toEqual([{ checkpoint: 'end', lux: 299, at: 2_100_000 }]);
  });
});
