/**
 * Service-worker update policy.
 *
 * The build used `registerType: 'autoUpdate'`, which lets a newly deployed service worker take
 * control of a page that is already open. On a study tablet that page is a participant sitting the
 * protocol: the new worker replaces the precache, the previous build's content-hashed chunks stop
 * resolving, and the two things this app loads lazily are the dashboard — the only export path —
 * and MediaPipe, which produces the primary outcome. A session lost that way cannot be re-run.
 *
 * This asserts against the config rather than the behaviour because the behaviour only appears on
 * a live redeploy, which is exactly the situation nobody will be testing in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = readFileSync(resolve(__dirname, '..', 'vite.config.ts'), 'utf8');

describe('a new build cannot take over a running session', () => {
  it('does not register the worker in auto-update mode', () => {
    expect(config).toMatch(/registerType:\s*'prompt'/);
    expect(config).not.toMatch(/registerType:\s*'autoUpdate'/);
  });

  it('leaves skipWaiting and clientsClaim off', () => {
    // Both default to true. Either one alone is enough to swap the precache under a live page.
    expect(config).toMatch(/skipWaiting:\s*false/);
    expect(config).toMatch(/clientsClaim:\s*false/);
  });
});

describe('offline precaching covers the stimulus typeface', () => {
  it('includes woff2 in the precache glob', () => {
    // Every session runs in aeroplane mode. A font left out of the precache is a reading passage
    // rendered in a fallback face, which is a change to the display condition.
    const glob = /globPatterns:\s*\[([^\]]+)\]/.exec(config)?.[1] ?? '';
    expect(glob).toContain('woff2');
    expect(glob).toContain('wasm');
    expect(glob).toContain('tflite');
  });
});
