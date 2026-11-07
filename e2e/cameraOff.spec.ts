import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil, stageNow, handleStage, dbAll } from './helpers';

/*
 * Going on without the camera puts the sitting in the camera-off state, and the data says so.
 *
 * Audit 86 CAM-3: "Continue without camera" on camera set-up's RUNNING preview released the camera
 * and left the tracker reporting 'active'. Calibration then ran its eye routine on no frames, the
 * camera check followed and failed on "No frames arriving", and every reading row was written
 * camera_active TRUE with no samples and no reason. Now the camera is off — the plain positioning
 * screen, no camera check, camera-off rows — and the sitting records why (camera_off).
 */

test('"Continue without camera" on the running preview switches the camera off for the sitting', async ({ page }) => {
  test.setTimeout(300_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByTestId('camera-diagnostics')).toBeVisible({ timeout: 60_000 });
  // First camera set-up in a fresh browser measures the trackers; the way on is offered after it.
  const skip = page.getByTestId('camera-skip');
  await expect(skip).toBeEnabled({ timeout: 120_000 });
  await skip.click();

  // Calibration is the camera-off screen: no eye routine, no camera running behind it.
  await page.waitForSelector('[data-stage="CALIBRATION"]', { timeout: 30_000 });
  await expect(page.getByTestId('calibration-fallback-text')).toContainText('Camera not active');
  await expect(page.getByTestId('calibration-routine')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)).toBe(0);
  const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
  expect(s.camera_off).toMatchObject({ reason: 'skipped_after_start', error: null });

  // No camera check, and the first reading row is a camera-off row.
  await page.getByRole('button', { name: 'Continue →' }).click();
  expect(await stageNow(page)).not.toBe('CALIBRATION');
  await expect(page.getByTestId('selftest-start')).toHaveCount(0);
  for (let i = 0; i < 200 && (await dbAll(page, 'eye_metrics')).length === 0; i++) {
    await handleStage(page, await stageNow(page));
  }
  const [row] = await dbAll<Record<string, unknown>>(page, 'eye_metrics');
  expect(row).toMatchObject({ camera_active: false, camera_inactive_reason: 'not_running' });
  const [after] = await dbAll<Record<string, unknown>>(page, 'sessions');
  expect(after.camera_selftest ?? null).toBeNull();
});
