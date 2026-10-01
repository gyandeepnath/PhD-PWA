import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, handleStage } from './helpers';

/**
 * The session manager with a real study's worth of sittings, and the update banner over it.
 *
 * Round 62: the list did not scroll. With ten sittings on the tablet, rows six to ten, the Completed
 * list and the recycle bin — with their Open, Export, Withdrew and Delete buttons — were clipped by up
 * to 408 CSS px inside a root that no gesture can scroll, and the fixed update banner covered the last
 * two rows that were left. In a study the list grows by one sitting per participant, and it is the
 * only route to export and to recording a withdrawal.
 *
 * The manager's own controls are clicked NOT forced: each must be reachable by a finger. (The one
 * sitting started through the app to seed the list goes through helpers.ts's handleStage, which
 * forces its click on "Begin setup"; that screen is not what this spec tests.)
 */

const VIEWPORTS = [
  { name: 'Xiaomi Pad 6, address bar hidden', width: 1152, height: 720 },
  { name: 'Xiaomi Pad 6, address bar showing', width: 1152, height: 650 },
];

/** One real sitting through SESSION_INIT, then cloned: 8 in progress, 4 complete, 2 in the bin. */
async function seedSittings(page: Page) {
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'MS00' });
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const [first] = await new Promise<Record<string, unknown>[]>((res, rej) => {
      const q = db.transaction('sessions').objectStore('sessions').getAll();
      q.onsuccess = () => res(q.result as Record<string, unknown>[]);
      q.onerror = () => rej(q.error);
    });
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const t0 = Date.now();
    for (let i = 1; i < 14; i++) {
      const complete = i >= 8 && i < 12;
      const binned = i >= 12;
      store.put({
        ...first,
        session_id: `seed-${i}`,
        participant_id: `MS${String(i).padStart(2, '0')}`,
        enrolment_number: 100 + i,
        session_start_time: t0 - i * 3_600_000,
        status: complete ? 'complete' : 'in_progress',
        session_end_time: complete ? t0 - i * 3_600_000 + 5_400_000 : null,
        deleted_at: binned ? t0 - 86_400_000 : null,
      });
    }
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  });
}

async function openManager(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await expect(page.getByTestId('manager-scroll')).toBeVisible();
}

/** The point at the centre of `sel` is `sel` itself, or inside it: nothing is drawn over it. */
async function uncovered(page: Page, sel: string, nth = 0): Promise<boolean> {
  return page.evaluate(({ s, n }) => {
    const el = document.querySelectorAll(s)[n] as HTMLElement | undefined;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, { s: sel, n: nth });
}

for (const vp of VIEWPORTS) {
  test(`fourteen sittings: every row, the Completed list and the bin are reachable at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await seedSittings(page);
    await openManager(page);

    const root = await page.evaluate(() => {
      const el = document.getElementById('root')!;
      return { over: el.scrollHeight - el.clientHeight };
    });
    expect(root.over, 'the manager overflows the clipped root').toBeLessThanOrEqual(1);
    await expect(page.getByText(/In progress \(8\)/)).toBeVisible();

    // The way back is the shared chip, top left, a 44 CSS px target.
    const home = page.getByTestId('nav-home');
    await expect(home).toHaveText('← Back to home');
    const hb = (await home.boundingBox())!;
    expect(hb.height).toBeGreaterThanOrEqual(43.5);
    expect(hb.x).toBeLessThan(20);

    // Completed is folded away, with its count.
    const completed = page.getByTestId('completed-toggle');
    await completed.scrollIntoViewIfNeeded();
    await expect(completed).toContainText('Completed (4)');
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
    await completed.click();
    await expect(page.getByRole('button', { name: 'Open', exact: true })).toHaveCount(4);

    // The LAST in-progress row's Delete, then the bin and its last Purge, reached by scrolling.
    const deletes = page.getByRole('button', { name: 'Delete', exact: true });
    const lastDelete = deletes.nth((await deletes.count()) - 1);
    await lastDelete.scrollIntoViewIfNeeded();
    await expect(lastDelete).toBeInViewport();
    const bin = page.getByTestId('bin-toggle');
    await bin.scrollIntoViewIfNeeded();
    await bin.click();
    const purge = page.getByRole('button', { name: 'Purge', exact: true }).last();
    await purge.scrollIntoViewIfNeeded();
    await expect(purge).toBeInViewport();

    // Destructive actions ask in the app's own dialog, with buttons that say what they do.
    await purge.click();
    await expect(page.getByTestId('confirm-dialog')).toContainText('Permanently delete');
    await expect(page.getByTestId('confirm-ok')).toHaveText('Delete permanently');
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
    await expect(page.getByText(/Recycle bin \(2\)/)).toBeVisible();
  });
}

test('the update banner covers nothing: not the build stamp, not the last session row', async ({ page }) => {
  await page.setViewportSize({ width: 1152, height: 720 });
  await seedSittings(page);
  // A waiting build, as the service-worker module reports one.
  await page.route('**/@vite-plugin-pwa/virtual:pwa-register*', (route) => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'export function registerSW(o){ setTimeout(()=>{ o && o.onNeedRefresh && o.onNeedRefresh(); }, 50); return async()=>{}; }',
  }));
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('update-banner')).toBeVisible();
  // Landing: the build stamp sits above the banner, not under it.
  const stamp = (await page.getByTestId('build-stamp').boundingBox())!;
  const banner = (await page.getByTestId('update-banner').boundingBox())!;
  expect(stamp.y + stamp.height, 'the build stamp runs under the banner').toBeLessThanOrEqual(banner.y + 1);

  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await expect(page.getByTestId('update-banner')).toBeVisible();
  // Scrolled to the very bottom, the last control on the page is clear of the banner.
  await page.getByTestId('manager-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(150);
  const binBox = (await page.getByTestId('bin-toggle').boundingBox())!;
  const bannerNow = (await page.getByTestId('update-banner').boundingBox())!;
  expect(binBox.y + binBox.height, 'the last control is under the banner').toBeLessThanOrEqual(bannerNow.y + 1);
  expect(await uncovered(page, '[data-testid="bin-toggle"]')).toBe(true);
});
