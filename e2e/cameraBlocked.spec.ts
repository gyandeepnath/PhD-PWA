import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Same browser the shared config picks; overriding launchOptions replaces it wholesale.
const CHROME = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', process.env.CHROME_PATH ?? ''].find((p) => p && existsSync(p));
import { startNewExperiment, driveUntil, stageNow, handleStage } from './helpers';

/*
 * The investigator "closed the camera" mid-task and nothing happened. Covering the lens, or the
 * Android camera-privacy switch, gives a BLACK picture rather than stopping the camera, so the old
 * watchdog (which waits for frames to stop) never fired. Here the fake camera is fed an all-black
 * video: the sitting must stop with the blocked-camera notice within a few seconds of reading.
 */
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${resolve(process.cwd(), 'e2e/fixtures/black.y4m')}`,
    ],
    ...(CHROME ? { executablePath: CHROME } : {}),
  },
});

test('a black camera picture during reading stops the sitting with a notice', async ({ page }) => {
  test.setTimeout(240_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await page.getByRole('button', { name: /My face is centred/ }).click({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CALIBRATION', null, { timeout: 30_000 });
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION'
    || !!document.querySelector('[data-testid="calibration-accept-thin"], [data-testid="calibration-continue-anyway"]'),
  null, { timeout: 120_000 });
  for (const id of ['calibration-accept-thin', 'calibration-continue-anyway']) {
    const b = page.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });
  for (let i = 0; i < 200 && (await stageNow(page)) !== 'READING_TASK'; i++) {
    if (await page.getByTestId('camera-blocked').isVisible().catch(() => false)) break;
    await handleStage(page, await stageNow(page));
  }
  await expect(page.getByTestId('camera-blocked')).toBeVisible({ timeout: 15_000 });
});
