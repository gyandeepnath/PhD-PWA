/**
 * Whether the tablet holds an offline copy of the app is known and shown (Round 92, audit 86 P4, P9).
 *
 * The app opens without a network only once its service worker has precached every asset (about 45 MB).
 * Nothing said whether that had happened: an operator could switch on aeroplane mode mid-download, and a
 * tablet run from the field package's HTTPS server never got a copy at all — Chrome will not install a
 * service worker from a site whose certificate is self-signed, warning accepted or not — while the
 * registration's failure was swallowed and "Check for updates" blamed "a development server". swUpdate
 * now keeps the state and BuildInfo shows it on the landing page, the session manager and pre-flight.
 * The two real cases (a worker that installs over http://localhost, one refused over the field server's
 * self-signed HTTPS) are driven end to end in e2e-prod/offlineCopy.spec.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';

type Opts = {
  onOfflineReady?: () => void;
  onRegisteredSW?: (u: string, r: unknown) => void;
  onRegisterError?: (e: unknown) => void;
};
let opts: Opts = {};
let noop = false;

vi.mock('virtual:pwa-register', () => ({
  registerSW(o: Opts) {
    if (!noop) opts = o;
    return async () => {};
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setServiceWorker(sw: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
}

async function fresh() {
  vi.resetModules();
  const m = await import('@/lib/swUpdate');
  await m.installUpdateWatch();
  return m;
}

describe('the offline copy', () => {
  beforeEach(() => { opts = {}; noop = false; });
  afterEach(() => {
    // jsdom has no service workers; put it back that way.
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    vi.useRealTimers();
  });

  it('a browser without service workers has none', async () => {
    const m = await fresh();
    expect(m.offlineCopy()).toEqual({ state: 'none', reason: 'this browser has no service workers' });
  });

  it('is ready once the first install has precached everything', async () => {
    setServiceWorker({ controller: null, getRegistration: async () => undefined });
    const m = await fresh();
    expect(m.offlineCopy().state).toBe('checking');
    opts.onRegisteredSW?.('sw.js', { installing: { addEventListener: () => {} }, waiting: null, active: null });
    expect(m.offlineCopy().state).toBe('installing');
    opts.onOfflineReady?.();
    expect(m.offlineCopy()).toEqual({ state: 'ready', reason: null });
  });

  it('a page a worker controls was served from the copy: ready at once, and nothing later undoes it', async () => {
    setServiceWorker({ controller: {}, getRegistration: async () => ({}) });
    const m = await fresh();
    expect(m.offlineCopy().state).toBe('ready');
    opts.onRegisterError?.(new Error('anything'));
    expect(m.offlineCopy().state).toBe('ready');
  });

  it('a refused registration is "none", and a certificate error says so (the field server)', async () => {
    setServiceWorker({ controller: null, getRegistration: async () => undefined });
    const m = await fresh();
    opts.onRegisterError?.(new Error('Failed to register a ServiceWorker for scope (\'https://192.0.2.2:5326/\'): An SSL certificate error occurred when fetching the script.'));
    expect(m.offlineCopy().state).toBe('none');
    expect(m.offlineCopy().reason).toMatch(/certificate/);
  });

  it('a server that registers nothing (the development server) settles on "none"', async () => {
    vi.useFakeTimers();
    noop = true;
    setServiceWorker({ controller: null, getRegistration: async () => undefined });
    const m = await fresh();
    expect(m.offlineCopy().state).toBe('checking');
    await vi.advanceTimersByTimeAsync(m.OFFLINE_SETTLE_MS + 10);
    expect(m.offlineCopy()).toEqual({ state: 'none', reason: 'no service worker was registered from this server' });
  });
});

describe('what the screen says', () => {
  const say = async (state: string, reason: string | null) => {
    vi.resetModules();
    vi.doMock('@/lib/swUpdate', () => ({
      onUpdateWaiting: (l: (w: boolean) => void) => { l(false); return () => {}; },
      checkForUpdate: async () => 'current',
      onOfflineCopy: (l: (s: { state: string; reason: string | null }) => void) => { l({ state, reason }); return () => {}; },
    }));
    const { OfflineCopyStatus } = await import('@/components/BuildInfo');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(OfflineCopyStatus)); });
    const el = host.querySelector('[data-testid="offline-copy"]')!;
    const out = { text: el.textContent ?? '', state: el.getAttribute('data-state') };
    act(() => root.unmount());
    host.remove();
    vi.doUnmock('@/lib/swUpdate');
    return out;
  };

  it('ready, downloading, and NOT installed with the reason and the supported route', async () => {
    expect((await say('ready', null)).text).toMatch(/Offline copy: ready — the app opens with the network off/);
    expect((await say('installing', null)).text).toMatch(/downloading — keep the tablet online until this says ready/);
    const none = await say('none', 'the browser refused this site\'s certificate for the offline copy');
    expect(none.state).toBe('none');
    expect(none.text).toMatch(/NOT installed — the browser refused this site's certificate/);
    expect(none.text).toMatch(/open the study's HTTPS address \(DEPLOYMENT\.md\); the field server's self-signed HTTPS cannot install one/);
  });
});
