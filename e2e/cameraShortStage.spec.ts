import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil, dbAll } from './helpers';
import { faceCameraLaunchOptions } from './fixtures/syntheticFace';

/*
 * A CAMERA THAT IS THE STAGE THAT IS SHORT, ON SCREEN (Round 93, review R5).
 *
 * When the camera-check tests moved to faceCamera.spec.ts (c66fee3) the drawn face made the check fail on
 * blinks, not on rate, so the assertion that the reason names the short stage was dropped, and naming the
 * stage on screen was exercised by unit tests only. Here Chromium's fake camera plays the same drawn face
 * at 10 frames a second — under the gate's 15 — so the tracker keeps up with every frame and the camera is
 * the limit: the camera set-up readout and the camera check's reason must both say so, with the camera's
 * own rate, never rounded onto 15 (review R2). Its own file because the fake camera's rate is a launch
 * option, which Playwright sets per file.
 */
test.use({ launchOptions: faceCameraLaunchOptions({ fps: 10 }) });

test('camera set-up and the camera check both name the CAMERA as the stage that was short', async ({ page }) => {
  test.setTimeout(300_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByTestId('camera-diagnostics')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /My face is centred/ })).toBeEnabled({ timeout: 120_000 });
  // The live readout's limit branch (PipelineReadout), with the camera's rate.
  await expect(page.getByTestId('diag-verdict')).toHaveText(/^Too slow \(under 15\)\. The CAMERA is the limit: it delivers \d+(\.\d+)? frames a second — more light on the face/, { timeout: 20_000 });
  const camRow = await page.getByTestId('diag-camera').innerText();
  expect(Number(/(\d+(?:\.\d+)?) fps/.exec(camRow)?.[1])).toBeLessThan(15);

  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForSelector('[data-stage="CALIBRATION"]', { timeout: 30_000 });
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForSelector('[data-testid="calibration-no-baseline"], [data-testid="calibration-gaze-incomplete"], [data-testid="selftest-start"]', { timeout: 120_000 });
  // The face is found at 10 a second too: a baseline, so the check runs (audit 86 CAM-2).
  await expect(page.getByTestId('calibration-no-baseline')).toHaveCount(0);
  const thin = page.getByTestId('calibration-accept-thin');
  if (await thin.isVisible().catch(() => false)) await thin.click();
  await page.getByTestId('selftest-start').click();
  await page.waitForSelector('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]', { timeout: 90_000 });

  await expect(page.getByTestId('selftest-verdict')).toHaveText(/did not pass/);
  // The reason on screen names the camera, with its rate and the light advice — not the processor's.
  // (The harness's check lasts about a second, too short for the eye's own rate to be judged, so the
  // sentence before it is the no-rate one; the stage is named all the same, from the camera's count.)
  const reasons = await page.getByTestId('selftest-reasons').innerText();
  const m = /: the CAMERA delivered only (\d+(?:\.\d+)?) frames per second at \d+×\d+, and the tracker kept up with them \((\d+(?:\.\d+)?) processed\) — the camera is the limit/.exec(reasons);
  expect(m, `the reason did not name the camera: ${reasons}`).not.toBeNull();
  expect(Number(m![1])).toBeLessThan(15);
  expect(reasons).toMatch(/more light/);
  expect(reasons).not.toMatch(/battery saver/);
  await page.getByTestId('selftest-continue-anyway').click();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });
  const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
  const st = s.camera_selftest as Record<string, unknown>;
  expect(st.limit).toBe('camera');
  expect(Number((st.pipeline as Record<string, number>).camera_fps_delivered)).toBeLessThan(15);
});
