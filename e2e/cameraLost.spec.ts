import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, stageNow, handleStage, throughCameraAndCalibration } from './helpers';

/*
 * A camera lost mid-sitting must stop the sitting, not fail silently.
 *
 * Uses Chromium's fake camera, so the camera path really runs: getUserMedia, the face tracker, the
 * calibration routine. The loss is the track's own `ended` event, which is what an incoming call or
 * another app taking the camera produces. Before the fix nothing read that event: the tracking monitor
 * disappeared and every remaining condition was written with no ocular data and no cause.
 */

async function intoReadingWithCamera(page: Page) {
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await throughCameraAndCalibration(page);
  // One stage read per step (driveUntil): a loop that tested the stage and then read it again could be
  // handed a READING_TASK it had not tested for, and act on it.
  await driveUntil(page, 'READING_TASK', 200);
  expect(await stageNow(page)).toBe('READING_TASK');
}

async function endCameraTrack(page: Page): Promise<number> {
  return page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => (x as HTMLVideoElement).srcObject) as HTMLVideoElement | undefined;
    const tracks = (v?.srcObject as MediaStream | null)?.getVideoTracks() ?? [];
    tracks.forEach((t) => t.dispatchEvent(new Event('ended')));
    return tracks.length;
  });
}

test('the camera stopping mid-condition stops the sitting, and Pause is the way back', async ({ page }) => {
  test.setTimeout(240_000);
  await intoReadingWithCamera(page);
  expect(await endCameraTrack(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('camera-lost')).toBeVisible();
  /*
   * The notice is set in the operator type (audit 86 UI-3, UI-9): every line at 14 px or more, none in the
   * monospace face. The sentence saying what "Continue without the camera" costs was 12 px DM Mono in a
   * faded blue, the smallest text on the one screen whose job is that choice.
   */
  const type = await page.getByTestId('camera-lost').evaluate((el) => [...el.querySelectorAll('h1, p, button')].map((e) => {
    const cs = getComputedStyle(e);
    return { text: (e.textContent ?? '').slice(0, 48), px: parseFloat(cs.fontSize), face: cs.fontFamily };
  }));
  expect(type.length).toBeGreaterThanOrEqual(6);
  for (const t of type) {
    expect(t.px, t.text).toBeGreaterThanOrEqual(14);
    expect(t.face, t.text).not.toMatch(/DM Mono|monospace/);
  }
  await expect(page.getByTestId('camera-lost-cost')).toContainText('every remaining condition is recorded with no eye measurements');
  await page.getByRole('button', { name: 'Pause and restart the camera' }).click();
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Resume/ }).first()).toBeVisible();
});

test('continuing without the camera records the rows as camera lost', async ({ page }) => {
  test.setTimeout(240_000);
  await intoReadingWithCamera(page);
  const conditionId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('VisualErgonomicsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rows = await new Promise<{ condition_id: string; completed_at: number | null }[]>((res) => { const q = db.transaction('conditions').objectStore('conditions').getAll(); q.onsuccess = () => res(q.result); });
    return rows.find((r) => r.completed_at == null)?.condition_id ?? null;
  });
  expect(await endCameraTrack(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('camera-lost')).toBeVisible();
  await page.getByRole('button', { name: 'Continue without the camera' }).click();
  await expect(page.getByTestId('camera-lost')).toHaveCount(0);
  await driveUntil(page, 'COMPREHENSION');
  const reason = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('VisualErgonomicsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const row = await new Promise<{ camera_active: boolean; camera_inactive_reason?: string } | undefined>((res) => { const q = db.transaction('eye_metrics').objectStore('eye_metrics').get(id!); q.onsuccess = () => res(q.result); });
    return row ? { active: row.camera_active, reason: row.camera_inactive_reason } : null;
  }, conditionId);
  expect(reason).toEqual({ active: false, reason: 'lost' });
});

test('the camera self-test runs after calibration and its result is saved with the session', async ({ page }) => {
  test.setTimeout(240_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await throughCameraAndCalibration(page);
  const st = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('VisualErgonomicsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rows = await new Promise<{ camera_selftest?: { cued: number; pass: boolean } }[]>((res) => { const q = db.transaction('sessions').objectStore('sessions').getAll(); q.onsuccess = () => res(q.result); });
    return rows[0]?.camera_selftest ?? null;
  });
  expect(st?.cued).toBe(5);
  // The fake camera shows no face, so the test must NOT pass — a pass here would mean it checks nothing.
  expect(st?.pass).toBe(false);
});

/*
 * The camera lost on a SET-UP screen after camera set-up (audit 86 F7). The notice was raised only where
 * a pause is allowed, so a camera lost during the calibration showed the no-camera wording ("Camera not
 * active — this step is skipped") and offered to skip, and on the baseline questionnaires nothing was
 * said until the first grey field.
 */
async function intoCalibration(page: Page) {
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await page.getByRole('button', { name: /My face is centred/ }).click({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CALIBRATION', null, { timeout: 30_000 });
}

test('the camera stopping during the calibration is called lost, and Continue says so', async ({ page }) => {
  test.setTimeout(240_000);
  await intoCalibration(page);
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForTimeout(150);
  expect(await endCameraTrack(page)).toBeGreaterThan(0);
  const notice = page.getByTestId('camera-lost');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('The camera has stopped');
  await expect(notice.getByRole('button', { name: /Exit — resume later/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continue without the camera' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('calibration-fallback-text')).toContainText('The camera has stopped');
  await expect(page.getByTestId('calibration-fallback-text')).not.toContainText('Camera not active');
});

test('the camera stopping on the baseline questionnaire stops the sitting there, and Exit is the way back', async ({ page }) => {
  test.setTimeout(240_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await throughCameraAndCalibration(page);
  await driveUntil(page, 'CVSQ_BASELINE', 50);
  expect(await endCameraTrack(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('camera-lost')).toBeVisible();
  await page.getByTestId('camera-lost').getByRole('button', { name: /Exit — resume later/ }).click();
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
  await page.getByRole('button', { name: /^Resume/ }).first().click();
  await page.waitForFunction(() => {
    const st = document.querySelector('[data-stage]')?.getAttribute('data-stage');
    return st && st !== 'SESSION_INIT';
  });
  // The resume sets the camera up again (after the launch check a tab is given) before anything else.
  if (await stageNow(page) === 'LAUNCH_CHECK') await handleStage(page, 'LAUNCH_CHECK');
  expect(await stageNow(page)).toBe('CAMERA_SETUP');
});
