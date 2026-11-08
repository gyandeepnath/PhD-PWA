import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Whether the tablet holds an offline copy of the app is shown, and true (Round 92, audit 86 P4, P9).
 *
 * The production bundle, served the two ways the study serves it:
 *   - over plain http://localhost by the field server (a secure context): the service worker installs,
 *     the landing page says "Offline copy: ready", and the app then opens with the network off;
 *   - over the field server's own HTTPS (`serve.mjs --https`, a self-signed certificate, accepted as an
 *     operator accepts it on the tablet): Chrome refuses to fetch the worker's script over a certificate
 *     error, so no copy is ever made, and the landing page must say "NOT installed" rather than nothing.
 * Measured in desktop Chromium; on the tablet's Chrome the same refusal is expected, not tested.
 */

test('served over http://localhost: the copy installs, the page says ready, and the app opens offline', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const status = page.getByTestId('offline-copy');
  await expect(status).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  await expect(status).toHaveText(/Offline copy: ready — the app opens with the network off/);
  // The claim on screen is the thing itself: with the network cut, the app still loads, from the copy.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('build-stamp')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('offline-copy')).toHaveAttribute('data-state', 'ready');
  await context.setOffline(false);
});

test.describe('served by the field server over its self-signed HTTPS', () => {
  const PORT = 5186;
  let server: ChildProcess | null = null;

  test.beforeAll(async () => {
    // A copy of the field server in a scratch folder, so the certificate it writes stays out of the
    // repository; its app/ is this build's dist/.
    const dir = join(tmpdir(), 'visulab-e2e-https');
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(REPO, 'field', 'serve.mjs'), join(dir, 'serve.mjs'));
    if (!existsSync(join(dir, 'app'))) symlinkSync(join(REPO, 'dist'), join(dir, 'app'), 'dir');
    server = spawn(process.execPath, [join(dir, 'serve.mjs'), '--https', '--port', String(PORT)], { cwd: dir, stdio: 'pipe' });
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('the HTTPS field server did not start')), 30_000);
      server!.stdout!.on('data', (b: Buffer) => { if (/Ctrl-C to stop/.test(String(b))) { clearTimeout(t); res(); } });
      server!.on('exit', (code) => { clearTimeout(t); rej(new Error(`the HTTPS field server exited (${code})`)); });
    });
  });

  test.afterAll(() => { server?.kill(); });

  test('no copy can be installed, and the landing page says so with the supported route', async ({ browser }) => {
    test.setTimeout(90_000);
    // The certificate warning accepted, as the operator accepts it on the tablet.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`https://localhost:${PORT}/`);
    await expect(page.getByTestId('build-stamp')).toBeVisible();
    const status = page.getByTestId('offline-copy');
    await expect(status).toHaveAttribute('data-state', 'none', { timeout: 30_000 });
    await expect(status).toHaveText(/Offline copy: NOT installed/);
    await expect(status).toHaveText(/open the study's HTTPS address \(DEPLOYMENT\.md\); the field server's self-signed HTTPS cannot install one/);
    // And it really is none: no worker controls the page, and none is registered.
    expect(await page.evaluate(async () => !!navigator.serviceWorker.controller || !!(await navigator.serviceWorker.getRegistration()))).toBe(false);
    await context.close();
  });
});
