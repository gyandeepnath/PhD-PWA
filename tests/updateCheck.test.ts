/**
 * "Check for updates" asks the server and applies nothing.
 *
 * The browser looks for a new service worker when a page is navigated to; an installed app reopened
 * from recent apps never is, so a tablet could run yesterday's build all day. checkForUpdate() calls
 * the registration's own update() and reports what it found. A build it finds installs and WAITS:
 * skipWaiting stays off, and UpdateBanner's gated "Update now" is still the only way it takes over.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type FakeReg = { update: () => Promise<void>; waiting: unknown; installing: unknown };
let reg: FakeReg | undefined;
let needRefresh: (() => void) | undefined;
const applied = vi.fn(async () => {});

vi.mock('virtual:pwa-register', () => ({
  registerSW(o: { onNeedRefresh?: () => void; onRegisteredSW?: (u: string, r: unknown) => void }) {
    needRefresh = o.onNeedRefresh;
    o.onRegisteredSW?.('sw.js', reg);
    return applied;
  },
}));

async function fresh(r: FakeReg | undefined) {
  reg = r;
  vi.resetModules();
  const m = await import('@/lib/swUpdate');
  await m.installUpdateWatch();
  return m;
}

describe('checkForUpdate', () => {
  beforeEach(() => { applied.mockClear(); needRefresh = undefined; });

  it('reports the newest build when the server has nothing newer', async () => {
    const update = vi.fn(async () => {});
    const m = await fresh({ update, waiting: null, installing: null });
    expect(await m.checkForUpdate()).toBe('current');
    expect(update).toHaveBeenCalledTimes(1);
    expect(applied).not.toHaveBeenCalled();
  });

  it('reports a build that is downloading, and one that has installed and waits', async () => {
    const r: FakeReg = { update: async () => { r.installing = {}; }, waiting: null, installing: null };
    const m = await fresh(r);
    expect(await m.checkForUpdate()).toBe('installing');
    r.installing = null; r.waiting = {};
    expect(await m.checkForUpdate()).toBe('waiting');
    // Found is not applied: nothing reloads until the gated button is pressed.
    expect(applied).not.toHaveBeenCalled();
  });

  it('says waiting at once when the notice is already up', async () => {
    const update = vi.fn(async () => {});
    const m = await fresh({ update, waiting: null, installing: null });
    needRefresh?.();
    expect(m.isUpdateWaiting()).toBe(true);
    expect(await m.checkForUpdate()).toBe('waiting');
    expect(update).not.toHaveBeenCalled();
  });

  it('says offline when the server cannot be reached, not "newest"', async () => {
    const m = await fresh({ update: async () => { throw new TypeError('Failed to fetch'); }, waiting: null, installing: null });
    expect(await m.checkForUpdate()).toBe('offline');
  });

  it('says unavailable where there is no registration, rather than claiming the build is current', async () => {
    const m = await fresh(undefined);
    expect(await m.checkForUpdate()).toBe('unavailable');
  });
});
