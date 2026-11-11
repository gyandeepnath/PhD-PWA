import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, dbAll, throughCameraAndCalibration } from './helpers';
import { faceCameraLaunchOptions } from './fixtures/syntheticFace';

/*
 * The camera path with a face the tracker finds: Chromium's fake camera shows a drawn face
 * (fixtures/syntheticFace.ts). Its eyes are open in every frame, so calibration fits an open-eye
 * baseline and the camera check runs — and, since the face never blinks, does not pass.
 *
 * The check runs only after a calibration that fitted a baseline (audit 86 CAM-2): it counts blinks,
 * and without a baseline it counts none. With Chromium's own camera, which shows no face, it is no
 * longer offered (cameraCheckNeedsBaseline.spec.ts), so the tests of the check itself are here.
 */
test.use({ launchOptions: faceCameraLaunchOptions() });

/** Through consent and the rest to camera setup, then enable the camera and wait out the measurement. */
async function toCameraRunning(page: Page) {
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByTestId('camera-diagnostics')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /My face is centred/ })).toBeEnabled({ timeout: 120_000 });
}

/** Camera running, then the calibration routine through to the camera check's start screen. */
async function toCameraCheck(page: Page) {
  await toCameraRunning(page);
  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForSelector('[data-stage="CALIBRATION"]', { timeout: 30_000 });
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForSelector('[data-testid="calibration-no-baseline"], [data-testid="calibration-gaze-incomplete"], [data-testid="selftest-start"]', { timeout: 120_000 });
  // The face is found and its eyes are open: a baseline, never the no-baseline screen.
  await expect(page.getByTestId('calibration-no-baseline')).toHaveCount(0);
  // The gaze check may fall short (it is a quality index only); go on.
  const thin = page.getByTestId('calibration-accept-thin');
  if (await thin.isVisible().catch(() => false)) await thin.click();
  await expect(page.getByTestId('selftest-start')).toBeVisible({ timeout: 20_000 });
}

test('after a calibration that fitted a baseline the camera check is run, and no skip is recorded (CAM-2)', async ({ page }) => {
  test.setTimeout(300_000);
  await toCameraCheck(page);
  const [cal] = await dbAll<Record<string, unknown>>(page, 'calibration_data');
  expect(Number(cal.ear_baseline)).toBeGreaterThan(0);
  await page.getByTestId('selftest-start').click();
  await page.waitForSelector('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]', { timeout: 90_000 });
  await page.locator('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });
  const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
  expect(s.camera_selftest).toBeTruthy();
  expect(s.camera_selftest_skipped ?? null).toBeNull();
});

// What the result shows when the rate is not short (the drawn face at 30 a second): the pipeline line,
// the verdict, and the attempt's record. Naming the short stage on screen is cameraShortStage.spec.ts's,
// with a camera slow enough to be short (Round 93, review R5).
test('the self-test result shows the pipeline, and the attempt\'s blinks and trace are kept', async ({ page }) => {
  test.setTimeout(300_000);
  await toCameraCheck(page);
  await page.getByTestId('selftest-start').click();
  await page.waitForSelector('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]', { timeout: 90_000 });

  await expect(page.getByTestId('selftest-pipeline')).toHaveText(/Camera delivered \d+(\.\d+)? fps at \d+×\d+ · tracker processed \d+(\.\d+)? fps, \d+ ms a frame/);
  const verdict = await page.getByTestId('selftest-verdict').innerText();
  // The drawn face never blinks, so the check does not pass: a pass here would mean it checks nothing.
  expect(verdict).toMatch(/did not pass/);
  const body = await page.getByTestId('camera-selftest').innerText();
  expect(body).not.toMatch(/below 25 — close other apps and check the light/); // the old one-size sentence
  await page.getByTestId('selftest-continue-anyway').click();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });

  const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
  const st = s.camera_selftest as Record<string, unknown>;
  const pipe = st.pipeline as Record<string, number | string>;
  expect(Number(pipe.camera_fps_delivered)).toBeGreaterThan(0);
  expect(Number(pipe.frames_processed)).toBeGreaterThan(0);
  expect(['tasks-gpu', 'tasks-cpu', 'legacy']).toContain(pipe.tracker_backend);
  expect(st.pass).toBe(false);
  if (st.limit != null) expect(['camera', 'camera_and_tracker', 'tracker', 'face', 'undetermined']).toContain(st.limit);

  /*
   * The accepted attempt's blinks and trace, kept as the sitting's self-test record (Round 78): filed
   * under the session, in no condition, with the five cue times and one trace row per processed
   * frame. Its blinks are the ones the test scored (cued + extra).
   */
  const rec = (await dbAll<Record<string, unknown>>(page, 'ocular_events')).find((r) => r.window === 'selftest');
  expect(rec).toMatchObject({ record_id: `selftest:${String(s.session_id)}`, condition_id: null, session_id: s.session_id });
  expect((rec!.cues as number[]).length).toBe(Number(st.cued));
  expect((rec!.events as unknown[]).length).toBe(Number(st.detected) + Number(st.extra));
  expect((rec!.trace as { frames: number }).frames).toBeGreaterThan(0);
});

test('the camera self-test runs after calibration and its result is saved with the session', async ({ page }) => {
  test.setTimeout(240_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await throughCameraAndCalibration(page);
  const [s] = await dbAll<{ camera_selftest?: { cued: number; pass: boolean } }>(page, 'sessions');
  expect(s.camera_selftest?.cued).toBe(5);
  // The drawn face never blinks, so the check must NOT pass — a pass here would mean it checks nothing.
  expect(s.camera_selftest?.pass).toBe(false);
});
