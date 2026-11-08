import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, stageNow, dbAll } from './helpers';

/*
 * The camera check runs only when calibration left an open-eye baseline to count blinks against
 * (audit 86 CAM-2).
 *
 * After "Continue without blink measures" the participant used to be put through the camera check all
 * the same. It counts blinks, and without a baseline it counts none: "Blinks seen: 0 of 5 flashes",
 * "The camera check did not pass", and a reason that blamed the lighting — and the sitting was recorded
 * as a failed check of a camera that may have been fine. Now the check is not run, the sitting records
 * why (camera_selftest_skipped; 01 selftest_not_run_reason), and set-up goes on.
 *
 * Chromium's own fake camera shows no face, so calibration fits no baseline. The other side — a face the
 * tracker finds, a baseline, and the check offered as before — is in faceCamera.spec.ts, which gives the
 * fake camera a drawn face (a launch option, so a file of its own).
 */

/** Camera set-up with the camera running, through to the calibration routine's result. */
async function calibrate(page: Page) {
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByRole('button', { name: /My face is centred/ })).toBeEnabled({ timeout: 120_000 });
  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForSelector('[data-stage="CALIBRATION"]', { timeout: 30_000 });
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForSelector('[data-testid="calibration-no-baseline"], [data-testid="calibration-gaze-incomplete"], [data-testid="selftest-start"]', { timeout: 120_000 });
}

test.describe('no face, so no baseline', () => {
  test('"Continue without blink measures" goes on without the camera check, and says why', async ({ page }) => {
    test.setTimeout(300_000);
    await calibrate(page);
    await expect(page.getByTestId('calibration-no-baseline')).toBeVisible();
    await page.getByTestId('calibration-continue-anyway').click();
    await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });
    await expect(page.getByTestId('selftest-start')).toHaveCount(0);
    expect(await stageNow(page)).toBe('CVSQ_BASELINE');
    const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
    expect(s.camera_selftest ?? null).toBeNull();
    expect(s.camera_selftest_skipped).toMatchObject({ reason: 'no_baseline' });
  });
});
