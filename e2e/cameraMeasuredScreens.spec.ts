import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, stageNow, dbAll } from './helpers';

/*
 * The two screens camera setup measures the camera under — the bench check's white, grey and black
 * grounds and the exposure step's grey field — are what they say they are (audit 86 CAM-9).
 *
 * The researcher card, opened on camera setup as on any set-up screen, used to stay docked over both:
 * over the left of the "black" bench ground with the participant's bright live picture in it, and over
 * the left 30% of the grey field the sitting's exposure is fixed under (which itself began right of the
 * card). Both screens now report themselves as running procedures, so the card is closed over them and
 * comes back afterwards, and both cover the whole screen with nothing of the app's own on top.
 *
 * And they are measured in landscape (audit 86 CAM-10). Turned to portrait during the exposure step, the
 * tablet used to have the sitting's exposure fixed under the portrait block's dark screen with the camera
 * on its side; set-up moved on to calibration, and the block said "Nothing is lost". A rotation now stops
 * the step (and the bench check), keeps nothing, and the preview comes back to begin it again.
 */

/** Through consent and the rest to camera setup, then enable the camera and wait out the measurement. */
async function toCameraRunning(page: Page) {
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByTestId('camera-diagnostics')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /My face is centred/ })).toBeEnabled({ timeout: 120_000 });
}

/** What is drawn over the screen while `groundId` is up: its box, the card, and what is topmost where the card was. */
async function overGround(page: Page, groundId: string) {
  return page.evaluate((gid) => {
    const g = document.querySelector(`[data-testid="${gid}"]`) as HTMLElement | null;
    const r = g?.getBoundingClientRect();
    const owner = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return (el?.closest('[data-testid]') as HTMLElement | null)?.dataset.testid ?? el?.tagName ?? null;
    };
    return {
      ground: r ? { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      card: !!document.querySelector('[data-testid="researcher-panel"]'),
      // The column the docked card takes (theme.css defines it as 0px when no card is docked).
      dock: getComputedStyle(document.documentElement).getPropertyValue('--vl-panel-dock').trim() || '0px',
      // Where the docked card's live picture was, and the bottom-left corner the panel's indicator takes.
      atCard: owner(180, 300),
      atCorner: owner(24, window.innerHeight - 24),
    };
  }, groundId);
}

test('the researcher card is closed over the bench check and the exposure step, which fill the screen (CAM-9)', async ({ page }) => {
  test.setTimeout(400_000);
  await toCameraRunning(page);
  // The operator opens the card on camera setup.
  await page.getByTestId('researcher-panel-collapsed').click();
  await expect(page.getByTestId('researcher-panel')).toBeVisible();

  await page.getByTestId('camera-bench-run').click();
  await page.waitForSelector('[data-testid="camera-bench-ground"][data-ground="black"]', { timeout: 60_000 });
  const bench = await overGround(page, 'camera-bench-ground');
  expect(bench).toMatchObject({
    ground: { left: 0, top: 0, width: bench.viewport.width, height: bench.viewport.height },
    card: false, dock: '0px', atCard: 'camera-bench-ground', atCorner: 'camera-bench-ground',
  });
  // The card comes back when the bench check is over: it was the operator's choice to open it.
  await page.waitForSelector('[data-testid="camera-bench-results"]', { timeout: 120_000 });
  await expect(page.getByTestId('researcher-panel')).toBeVisible();

  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForSelector('[data-testid="camera-exposure-step"]', { timeout: 10_000 });
  const exposure = await overGround(page, 'camera-exposure-step');
  expect(exposure).toMatchObject({
    ground: { left: 0, top: 0, width: exposure.viewport.width, height: exposure.viewport.height },
    card: false, dock: '0px', atCard: 'camera-exposure-step', atCorner: 'camera-exposure-step',
  });
});

test('turning the tablet stops the bench check and the exposure step; nothing from them is kept (CAM-10)', async ({ page }) => {
  test.setTimeout(400_000);
  const landscape = { width: 1280, height: 800 };
  const portrait = { width: 800, height: 1280 };
  const block = page.getByTestId('portrait-block');
  await toCameraRunning(page);

  // The bench check, turned on its first ground.
  await page.getByTestId('camera-bench-run').click();
  await page.waitForSelector('[data-testid="camera-bench-ground"]', { timeout: 30_000 });
  await page.setViewportSize(portrait);
  await expect(block).toContainText('The bench check has to be taken in landscape, so the one that was running has been stopped');
  await expect(page.getByTestId('camera-bench-ground')).toHaveCount(0, { timeout: 15_000 });
  await page.setViewportSize(landscape);
  await expect(page.getByTestId('camera-step-stopped')).toContainText('bench check was stopped');
  await expect(page.getByTestId('camera-bench-results')).toHaveCount(0);

  // The exposure step, turned on the grey field and left in portrait past the step's own length.
  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForSelector('[data-testid="camera-exposure-step"]', { timeout: 10_000 });
  await page.setViewportSize(portrait);
  await expect(block).toContainText("The camera's exposure step has to be taken in landscape, so the one that was running has been stopped");
  await expect(block).not.toContainText('Nothing is lost');
  await page.waitForTimeout(10_000);
  expect(await stageNow(page)).toBe('CAMERA_SETUP');
  await page.setViewportSize(landscape);
  await expect(page.getByTestId('camera-step-stopped')).toContainText("exposure step was stopped");
  await expect(page.getByTestId('camera-exposure-step')).toHaveCount(0);

  // Begun again in landscape, it runs to its end, and only it is recorded.
  const againAt = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForSelector('[data-stage="CALIBRATION"]', { timeout: 60_000 });
  const [s] = await dbAll<{ camera_pipeline?: { camera_exposure?: { at: number } | null; camera_bench?: unknown } }>(page, 'sessions');
  expect(s.camera_pipeline?.camera_exposure?.at).toBeGreaterThanOrEqual(againAt);
  expect(s.camera_pipeline?.camera_bench ?? null).toBeNull();
});
