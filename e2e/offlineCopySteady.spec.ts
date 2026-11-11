import { test, expect, type Page, type Locator } from '@playwright/test';

/**
 * The offline-copy line never moves the controls around it (Round 92, follows audit 86 P4, P9).
 *
 * The line under the build says whether the tablet holds an offline copy of the app. It starts as
 * "Offline copy: checking…", one short line, and settles seconds later. On a server that registers no
 * service worker (the development server here, the field server's self-signed HTTPS on the tablet) it
 * settles as "NOT installed" with its reason and the supported route, three lines at pre-flight's width.
 * Grown in place, that pushed down every control under it on the session manager and pre-flight, and on
 * the landing page, whose content is centred, moved the Enter button. Here the development server
 * settles after swUpdate's OFFLINE_SETTLE_MS (8 s), so each test takes the boxes while the line still
 * says "checking", waits for "NOT installed", and takes them again: nothing may have moved.
 */

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box on screen');
  return b;
}

async function steadyAcrossSettling(page: Page, controls: Locator[]) {
  const status = page.getByTestId('offline-copy').first();
  await expect(status).toBeVisible();
  // The boxes before the state settles; if this ever fails, the page took 8 s to load and proves nothing.
  await expect(status).toHaveAttribute('data-state', 'checking');
  const slot = page.getByTestId('offline-copy-slot').first();
  const before = [await box(slot), ...(await Promise.all(controls.map(box)))];
  await expect(status).toHaveAttribute('data-state', 'none', { timeout: 30_000 });
  await expect(status).toHaveText(/Offline copy: NOT installed/);
  const after = [await box(slot), ...(await Promise.all(controls.map(box)))];
  for (let i = 0; i < before.length; i++) {
    expect(after[i].y, `box ${i} moved`).toBeCloseTo(before[i].y, 0);
    expect(after[i].height, `box ${i} changed height`).toBeCloseTo(before[i].height, 0);
  }
}

test('the landing page: the Enter button stays put when the line settles', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?e2e=1');
  await steadyAcrossSettling(page, [page.getByRole('button', { name: /Enter Research Console/ })]);
});

test('the session manager: New Session stays put when the line settles', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click({ force: true });
  await steadyAcrossSettling(page, [page.getByRole('button', { name: /New Session/ })]);
});
