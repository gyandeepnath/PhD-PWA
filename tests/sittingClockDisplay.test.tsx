/**
 * The screens show a sitting's times on the clock its export is written on (Round 94, review B93-6).
 *
 * Round 93 (review R3) made 01_session_info.csv date and time a sitting by the UTC offset the tablet
 * stored, but the dashboard's sitting picker — the operator's way into Export — the withdrawal lines and
 * the restore-conflict message still wrote toLocaleString(): the viewing device's clock, with no offset.
 * On a device in another time zone that a backup was restored to, the picker gave another date and time
 * from the experiment_date and session_start_local its own export writes. Now a sitting's start and end
 * are shown on the stored offset (lib/localClock.ts, the same choice as export.ts sittingClock), and
 * every time on these screens carries its offset, so no clock is left implied.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { put, _resetForTests } from '@/storage/db';
import { clearResume } from '@/storage/sessionPersistence';
import { clockText, sittingStartText, sittingEndText, sittingOffsets } from '@/lib/localClock';
import { sittingClock } from '@/storage/export';
import { serialiseSessionBackup, parseSessionBackup, importSessionBackup } from '@/storage/backup';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { SessionRecord } from '@/storage/types';

vi.mock('@/lib/swUpdate', () => ({
  onUpdateWaiting: (l: (w: boolean) => void) => { l(false); return () => {}; },
  isUpdateWaiting: () => false,
  checkForUpdate: async () => 'current',
  applyUpdate: async () => {},
  installUpdateWatch: async () => {},
  onOfflineCopy: (l: (s: { state: string; reason: string | null }) => void) => { l({ state: 'ready', reason: null }); return () => {}; },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); }
  vi.restoreAllMocks();
});

// 05:00 on the 29th in Kolkata, where the tablet stored +330; 19:30 on the 28th in New York.
const START = Date.parse('2026-10-28T23:30:00Z');
const NEW_YORK = 240; // getTimezoneOffset: minutes WEST of UTC
const inNewYork = () => vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(NEW_YORK);

describe('a sitting\'s times on its own clock, with the offset printed', () => {
  const sitting = { session_start_time: START, session_end_time: START + 95 * 60_000, session_start_utc_offset_min: 330, session_end_utc_offset_min: 330 };

  it('the start and end read as 01 writes them, whatever the viewing device\'s zone', () => {
    inNewYork();
    expect(sittingStartText(sitting)).toBe('2026-10-29 05:00 UTC+05:30');
    expect(sittingEndText(sitting)).toBe('2026-10-29 06:35 UTC+05:30');
    // The same date and time as 01's session_start_local and session_end_local.
    const c = sittingClock(sitting);
    expect(sittingStartText(sitting).slice(0, 16)).toBe(c.startLocal.slice(0, 16).replace('T', ' '));
    expect(sittingEndText(sitting)!.slice(0, 16)).toBe(c.endLocal.slice(0, 16).replace('T', ' '));
    expect(sittingEndText({ ...sitting, session_end_time: null })).toBeNull();
  });

  it('a sitting that stored no offset is shown on the viewing device\'s clock, which is printed', () => {
    inNewYork();
    const old = { session_start_time: START, session_end_time: null };
    expect(sittingOffsets(old)).toEqual({ start: undefined, end: undefined });
    expect(sittingStartText(old)).toBe('2026-10-28 19:30 UTC-04:00');
    expect(sittingClock(old).startLocal).toBe('2026-10-28T19:30:00-04:00');
    // One stored offset serves both ends, as in the export.
    expect(sittingEndText({ session_start_time: START, session_end_time: START + 60_000, session_start_utc_offset_min: 330 })).toBe('2026-10-29 05:01 UTC+05:30');
    expect(clockText(START, 0)).toBe('2026-10-28 23:30 UTC+00:00');
    expect(clockText(START, 345)).toBe('2026-10-29 05:15 UTC+05:45');
  });
});

describe('the screens use it', () => {
  it('the Session Manager lists a restored sitting at the tablet\'s time, not the viewing device\'s', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetForTests();
    clearResume();
    const base = buildFixtureBundle().session;
    const s: SessionRecord = {
      ...base, session_id: 'restored', participant_id: 'P042', display_label: null, status: 'complete', deleted_at: null, withdrawn_at: null,
      session_start_time: START, session_end_time: START + 95 * 60_000, session_start_utc_offset_min: 330, session_end_utc_offset_min: 330,
    };
    await put('sessions', s);
    inNewYork();
    const { SessionManager } = await import('@/start/SessionManager');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    await act(async () => {
      root.render(createElement(SessionManager, { onNew: () => {}, onResume: () => {}, onOpen: () => {}, onHome: () => {} }));
    });
    // The manager lists completed sittings behind a toggle.
    await vi.waitFor(() => expect(host.querySelector('[data-testid="completed-toggle"]')?.textContent).toMatch(/Completed \(1\)/));
    await act(async () => { (host.querySelector('[data-testid="completed-toggle"]') as HTMLButtonElement).click(); });
    await vi.waitFor(() => expect(host.textContent).toMatch(/P042/));
    expect(host.textContent).toContain('2026-10-29 05:00 UTC+05:30');
  });

  it('the restore-conflict message gives each copy\'s end on the tablet\'s clock', async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetForTests();
    const b = buildFixtureBundle();
    b.session = { ...b.session, session_start_time: START, session_end_time: START + 95 * 60_000, session_start_utc_offset_min: 330, session_end_utc_offset_min: 330 };
    const parsed = parseSessionBackup(serialiseSessionBackup(b));
    expect((await importSessionBackup(parsed.backup!)).ok).toBe(true);
    inNewYork();
    const again = await importSessionBackup(parsed.backup!);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/ON THIS DEVICE: \d+ rows, ended 2026-10-29 06:35 UTC\+05:30/);
    expect(again.error).toMatch(/IN THIS FILE:\s+\d+ rows, ended 2026-10-29 06:35 UTC\+05:30/);
  });

  it('no screen writes a sitting\'s time with toLocaleString: the picker, the manager, the session form, the restore message', () => {
    for (const f of ['src/dashboard/Dashboard.tsx', 'src/start/SessionManager.tsx', 'src/start/setupStages.tsx', 'src/storage/backup.ts']) {
      const src = readFileSync(resolve(__dirname, '..', f), 'utf8');
      expect(src, f).not.toMatch(/toLocale(Date|Time)?String\(/);
    }
    const dash = readFileSync(resolve(__dirname, '../src/dashboard/Dashboard.tsx'), 'utf8');
    expect(dash).toMatch(/\{s\.participant_id\} · \{sittingStartText\(s\)\}/);
  });
});
