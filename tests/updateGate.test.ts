/**
 * Applying a service-worker update must not be possible while a participant is mid-sitting.
 *
 * `registerType: 'prompt'` was chosen so a new build could never seize a running page, and
 * UpdateBanner was rendered only on the landing and session-manager screens because those are
 * between-sessions screens. Two paths went straight through that reasoning.
 *
 *   1. Pause. The Pause control exits a running experiment TO THE SESSION MANAGER, which is where
 *      the banner lives. A sitting paused at condition seven therefore put the operator in front of
 *      "Apply it now, between sessions" — a sentence that was false at exactly that moment.
 *
 *   2. A second tab. vite-plugin-pwa's prompt-mode register attaches a `controlling` listener in
 *      every tab that sees the waiting worker, and skipWaiting() hands the new worker every client
 *      the old one controlled. Pressing Update in one window reloads them all, including one that
 *      is mid-condition, with no action taken in that window at all.
 *
 * Both are closed by the same move: ask the DATABASE whether a sitting is open, not the screen.
 * IndexedDB is shared by every tab on the origin, so a sitting open in any window is visible from
 * all of them — which is the property the second failure needs and React state cannot provide.
 *
 * This file also covers the connection this build can no longer open after another tab has upgraded
 * the schema, which is the other half of "what happens when two builds meet on one tablet".
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { put, get, _resetForTests, SUPERSEDED_MESSAGE } from '@/storage/db';
import { sittingsInProgress } from '@/storage/gather';
import { DB_NAME, DB_VERSION } from '@/storage/schemaEnums';
import type { SessionRecord } from '@/storage/types';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

function session(id: string, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session_id: id, participant_id: `P-${id}`, enrolment_number: 1,
    status: 'complete', deleted_at: null, display_label: null,
    session_start_time: 1, session_end_time: 2,
    ambient_lux: 10, ambient_illumination_level: 'dim', illumination_block: 0,
    illumination_order_first: 'dim', lux_readings: [],
    ...over,
  } as unknown as SessionRecord;
}

describe('the gate is the database, so it holds across tabs', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetForTests();
  });

  it('reports nothing open when every sitting has finished', async () => {
    await put('sessions', session('a'));
    await put('sessions', session('b'));
    expect(await sittingsInProgress()).toHaveLength(0);
  });

  it('reports a sitting that is still running', async () => {
    await put('sessions', session('a'));
    await put('sessions', session('live', { status: 'in_progress', session_end_time: null }));
    expect((await sittingsInProgress()).map((s) => s.session_id)).toEqual(['live']);
  });

  it('sees a PAUSED sitting, which is the case that defeated the screen-based gate', async () => {
    // Pause exits to the session manager and leaves status 'in_progress'. Nothing about the screen
    // says a participant is waiting; the record does.
    await put('sessions', session('paused', { status: 'in_progress', session_end_time: null }));
    expect(await sittingsInProgress()).toHaveLength(1);
  });

  it('ignores a sitting in the recycle bin, which nobody is sitting through', async () => {
    await put('sessions', session('binned', { status: 'in_progress', deleted_at: Date.now() }));
    expect(await sittingsInProgress()).toHaveLength(0);
  });

  it('does not care which window wrote the record', async () => {
    // The whole point: a second tab's in-progress session is an ordinary row here. This is the
    // property that stops one window reloading another window's participant out of a condition.
    await put('sessions', session('other-tab', { status: 'in_progress', session_end_time: null }));
    _resetForTests();                       // as if a different tab opened its own connection
    expect(await sittingsInProgress()).toHaveLength(1);
  });
});

describe('a tab superseded by a newer build says so, instead of failing at a random write', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    _resetForTests();
  });

  it('refuses further work with a sentence an operator can act on', async () => {
    await put('sessions', session('a'));    // opens this build's connection

    // Another tab, running a newer build, opens the same database at a higher version. That fires
    // versionchange on the connection above, which is idb's `blocking`.
    await new Promise<void>((resolve_, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
      req.onupgradeneeded = () => { /* schema irrelevant; the version bump is the event */ };
      req.onsuccess = () => { req.result.close(); resolve_(); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('the old connection never released'));
    });

    // The previous behaviour claimed "the next call here reopens". It cannot: openDB asks for
    // DB_VERSION, and IndexedDB refuses an open below the version now on disk. What arrived at the
    // caller was a bare VersionError from whichever write came next.
    await expect(get('sessions', 'a')).rejects.toThrow(SUPERSEDED_MESSAGE);
    await expect(put('sessions', session('b'))).rejects.toThrow(SUPERSEDED_MESSAGE);
  });

  it('says the saved data is safe, because that is the operator\'s first question', () => {
    expect(SUPERSEDED_MESSAGE).toMatch(/safe/i);
    expect(SUPERSEDED_MESSAGE).toMatch(/close/i);
    // No jargon: a research assistant reads this, not a developer.
    expect(SUPERSEDED_MESSAGE).not.toMatch(/IndexedDB|VersionError|schema|service worker/i);
  });
});

/*
 * Source-level assertions, for the same reason tests/pwaPolicy.test.ts uses them: the behaviour
 * they describe only appears on a live redeploy with two tablets' worth of tabs open, which is
 * precisely the situation nobody will be testing in.
 */
describe('the update control is wired to the gate', () => {
  const banner = src('src/components/UpdateBanner.tsx');

  it('asks the database before offering the button', () => {
    expect(banner).toMatch(/sittingsInProgress/);
  });

  it('renders the button only when nothing is open', () => {
    expect(banner).toMatch(/\{!blocked && \(/);
  });

  it('treats an unanswered check as blocking, not as permission', () => {
    // null means the query has not come back. Offering the update in that window would be deciding
    // the question by assuming the convenient answer.
    expect(banner).toMatch(/openSittings == null \|\| openSittings\.length > 0/);
  });

  it('releases the applying latch when the update fails', () => {
    // Otherwise the button sits disabled reading "Updating…" for ever, which reports an update in
    // progress when the tablet is in fact still on the stale build.
    expect(banner).toMatch(/applyUpdate\(\)\.catch/);
    expect(banner).toMatch(/setApplying\(false\)/);
  });
});

describe('swUpdate no longer claims a fallback it does not have', () => {
  // Comments stripped, because the module now DISCUSSES the removed fallback at length and a naive
  // source match would be satisfied by the explanation of the very thing it is checking is gone.
  const code = src('src/lib/swUpdate.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('does not reload as if that bypassed the service worker', () => {
    // A reload on a controlled page is served BY the worker from the same precache, so the old
    // fallback would have re-served the stale build while its comment said it fetched from the
    // network. The branch was also unreachable.
    expect(code).not.toMatch(/location\.reload\(\)/);
  });

  it('still has the guard, reporting the impossible case instead of pretending to handle it', () => {
    expect(code).toMatch(/if \(!applyFn\)/);
    expect(code).toMatch(/throw new Error/);
  });
});
