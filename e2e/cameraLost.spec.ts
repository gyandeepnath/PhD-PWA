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
  for (let i = 0; i < 200 && (await stageNow(page)) !== 'READING_TASK'; i++) await handleStage(page, await stageNow(page));
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
