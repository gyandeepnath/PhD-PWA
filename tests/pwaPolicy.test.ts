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

describe('the Face Landmarker tracker is offline and keeps its data on the device (round 75)', () => {
  const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
  const copy = readFileSync(resolve(__dirname, '..', 'scripts', 'copy-mediapipe.mjs'), 'utf8');

  it('precaches the model bundle and the tasks-vision wasm', () => {
    const glob = /globPatterns:\s*\[([^\]]+)\]/.exec(config)?.[1] ?? '';
    expect(glob).toContain('task');
    expect(config).toMatch(/includeAssets:\s*\[[^\]]*'tasks-vision\/\*\*\/\*'/);
    // The largest file (the SIMD wasm, ~11.8 MB) must fit under the per-file precache limit.
    expect(config).toMatch(/maximumFileSizeToCacheInBytes:\s*12 \* 1024 \* 1024/);
  });

  it('refuses every connection that is not to its own origin', () => {
    /*
     * @mediapipe/tasks-vision posts usage metrics to https://odml.pa.googleapis.com/v1/log. The
     * participants consented to numeric measures kept on the device. A connect-src of 'self' alone is
     * what refuses that request; anything wider (a host, https:, *) would let it through.
     */
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toMatch(/(^|;\s*)connect-src 'self'(\s*;|$)/);
    expect(csp).not.toMatch(/googleapis|https:|\*/);
  });

  it('fetches the model at build time only, from a versioned URL, against a pinned checksum', () => {
    expect(copy).toMatch(/face_landmarker\/float16\/1\/face_landmarker\.task/);
    expect(copy).not.toMatch(/float16\/latest\//);
    expect(copy).toMatch(/MODEL_SHA256 = '[0-9a-f]{64}'/);
  });

  it('nothing in the app itself names a Google host', async () => {
    const { execFileSync } = await import('node:child_process');
    const { existsSync } = await import('node:fs');
    const files = execFileSync('git', ['ls-files', 'src'], { cwd: resolve(__dirname, '..') }).toString().split('\n').filter(Boolean)
      .filter((f) => existsSync(resolve(__dirname, '..', f))); // a tracked file deleted in the working tree
    const hits = files.filter((f) => /googleapis\.com|storage\.googleapis/.test(readFileSync(resolve(__dirname, '..', f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
