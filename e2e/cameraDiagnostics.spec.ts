import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, stageNow, handleStage, throughCameraAndCalibration } from './helpers';

/*
 * The camera path, with Chromium's fake camera (round 75).
 *
 * The investigator's tablet failed the camera self-test on frame rate every time, and nothing on any
 * screen could say whether the camera, the tracker or the face was the limit. These drive the real
 * pipeline — getUserMedia, the face tracker the sitting uses, the frame meter — and check that every
 * place the operator reads it shows numbers: camera setup, the self-test result, and the researcher
 * card's live picture. The fake camera shows no face, so "face found" is 0 here by construction; what
 * is checked is that camera and tracker rates are measured and shown, and that the self-test names a
 * stage rather than giving one sentence for every cause.
 */

/** Through consent and the rest to camera setup, then enable the camera and wait out the measurement. */
async function toCameraRunning(page: Page) {
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByTestId('camera-diagnostics')).toBeVisible({ timeout: 60_000 });
  // First camera setup in a fresh browser: the trackers are measured once, then Continue is enabled.
  await expect(page.getByRole('button', { name: /My face is centred/ })).toBeEnabled({ timeout: 120_000 });
}

/** Every stored blink record (the ocular_events store, Round 78). */
async function ocularRecords(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('VisualErgonomicsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return new Promise<Record<string, unknown>[]>((res) => { const q = db.transaction('ocular_events').objectStore('ocular_events').getAll(); q.onsuccess = () => res(q.result as Record<string, unknown>[]); });
  });
}

/** Read the session record from IndexedDB. */
async function sessionRecord(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('VisualErgonomicsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise<unknown[]>((res) => { const q = db.transaction('sessions').objectStore('sessions').getAll(); q.onsuccess = () => res(q.result); });
    return all[all.length - 1] as Record<string, unknown>;
  });
}

test('camera setup measures the trackers and shows what the camera and the tracker do', async ({ page }) => {
  test.setTimeout(240_000);
  await toCameraRunning(page);

  // The three rates and the tracker, from the running pipeline.
  await expect(page.getByTestId('diag-camera')).toHaveText(/Camera delivers\s*\d+ fps · \d+×\d+/);
  await expect(page.getByTestId('diag-tracker')).toHaveText(/Tracker processes\s*\d+ fps · \d+ ms/);
  await expect(page.getByTestId('diag-backend')).toHaveText(/Face Landmarker \((GPU|CPU)\)|FaceMesh \(legacy\)/);
  /*
   * Asked for a 30-fps mode (Round 79). Chromium's fake camera runs at 20 at most, so it refuses the
   * floor and the request is repeated without it — the screen says so, and what the camera is SET to.
   */
  await expect(page.getByTestId('camera-mode')).toHaveText(/Asked for 1280×720 at 30 fps — the camera has no mode that fast, so any rate was accepted; the camera is set to \d+×\d+/);
  // The comparison: one row per backend, each measured or saying why it could not start.
  for (const b of ['tasks-gpu', 'tasks-cpu', 'legacy']) {
    await expect(page.getByTestId(`trial-${b}`)).toHaveText(/\d|could not start/);
  }
  /*
   * The fake camera shows no face, so no trial measured TRACKING, only each model's face detector
   * (round 77): nothing is chosen or stored, the screen says to measure again with a face in view, and
   * the tracker stays 'not measured' so the next camera setup measures again.
   */
  await expect(page.getByTestId('tracker-no-face')).toBeVisible();
  await expect(page.getByTestId('camera-mode')).toHaveText(/not measured on this tablet yet/);
  expect(await page.evaluate(() => localStorage.getItem('visulab.tracker.choice.v1'))).toBeNull();
  // The picture is the tracker's own stream, not a second camera.
  const sameStream = await page.evaluate(() => {
    const hidden = document.querySelector('video[aria-hidden="true"]') as HTMLVideoElement | null;
    const shown = document.querySelector('[data-testid="setup-feed-video"]') as HTMLVideoElement | null;
    return !!hidden && !!shown && (hidden.srcObject as MediaStream).id === (shown.srcObject as MediaStream).id;
  });
  expect(sameStream).toBe(true);

  await page.getByRole('button', { name: /My face is centred/ }).click();
  // The exposure is set on the grey field first (Round 79), then calibration starts.
  await expect(page.getByTestId('camera-exposure-step')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CALIBRATION', null, { timeout: 30_000 });
  // Kept with the sitting: which tracker, how chosen, what the camera was asked for and gave.
  const s = await sessionRecord(page);
  const p = s.camera_pipeline as Record<string, unknown>;
  /*
   * What the exposure step did. Chromium's fake camera offers a manual exposure mode, so the step runs
   * for real; whether it is kept depends on two short measurements of a 20-fps fake, so either verdict
   * is accepted — but it must be recorded, with the frame rate measured under auto, and a reason when
   * the camera was left on auto.
   */
  const ex = p.camera_exposure as Record<string, unknown>;
  expect(ex.rule).toBe('exp-r1');
  expect(['locked-v1', 'compensated-v1', 'auto']).toContain(ex.policy);
  expect(Number(ex.auto_fps)).toBeGreaterThan(0);
  if (ex.policy === 'auto') expect(String(ex.reason)).not.toBe('');
  expect((p.camera_capabilities as Record<string, unknown>).exposure_modes).toContain('manual');
  expect(['tasks-gpu', 'tasks-cpu', 'legacy']).toContain(p.tracker_backend);
  // No face, so no comparison was adopted: the sitting records none rather than one of nothing.
  expect(p.tracker_selection).toBe('default');
  expect(p.tracker_trials).toBeNull();
  expect((p.camera_settings as { width: number }).width).toBeGreaterThan(0);
  expect(p.camera_requested).toEqual({ width: 1280, height: 720, frameRate: 30, frameRateMin: null, facingMode: 'user' });
  expect(p.camera_request_fallback).toMatch(/OverconstrainedError/);
});

test('the self-test result shows the pipeline and names the stage that was short', async ({ page }) => {
  test.setTimeout(300_000);
  await toCameraRunning(page);
  await page.getByRole('button', { name: /My face is centred/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CALIBRATION');
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForFunction(() =>
    !!document.querySelector('[data-testid="calibration-accept-thin"], [data-testid="calibration-continue-anyway"], [data-testid="selftest-start"]'),
  null, { timeout: 120_000 });
  for (const id of ['calibration-accept-thin', 'calibration-continue-anyway']) {
    const b = page.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await page.getByTestId('selftest-start').click();
  await page.waitForSelector('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]', { timeout: 90_000 });

  await expect(page.getByTestId('selftest-pipeline')).toHaveText(/Camera delivered \d+ fps at \d+×\d+ · tracker processed \d+ fps, \d+ ms a frame/);
  const verdict = await page.getByTestId('selftest-verdict').innerText();
  if (/did not pass/.test(verdict)) {
    // The fake camera has no face, so the test fails — and the frame-rate reason must say which stage.
    const body = await page.getByTestId('camera-selftest').innerText();
    expect(body).toMatch(/CAMERA delivered only|TRACKER processed only|found the face in only some|cannot be told apart/);
    expect(body).not.toMatch(/below 25 — close other apps and check the light/); // the old one-size sentence
  }
  const pass = page.getByTestId('selftest-continue');
  if (await pass.isVisible().catch(() => false)) await pass.click();
  else await page.getByTestId('selftest-continue-anyway').click();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });

  const st = (await sessionRecord(page)).camera_selftest as Record<string, unknown>;
  const pipe = st.pipeline as Record<string, number | string>;
  expect(Number(pipe.camera_fps_delivered)).toBeGreaterThan(0);
  expect(Number(pipe.frames_processed)).toBeGreaterThan(0);
  expect(['tasks-gpu', 'tasks-cpu', 'legacy']).toContain(pipe.tracker_backend);
  if (st.pass === false) expect(['camera', 'camera_and_tracker', 'tracker', 'face', 'undetermined']).toContain(st.limit);

  /*
   * The accepted attempt's blinks and trace, kept as the sitting's self-test record (Round 78): filed
   * under the session, in no condition, with the five cue times and one trace row per processed
   * frame. Its blinks are the ones the test scored (cued + extra).
   */
  const s = await sessionRecord(page);
  const rec = (await ocularRecords(page)).find((r) => r.window === 'selftest');
  expect(rec).toMatchObject({ record_id: `selftest:${String(s.session_id)}`, condition_id: null, session_id: s.session_id });
  expect((rec!.cues as number[]).length).toBe(Number(st.cued));
  expect((rec!.events as unknown[]).length).toBe(Number(st.detected) + Number(st.extra));
  expect((rec!.trace as { frames: number }).frames).toBeGreaterThan(0);
});

test('the researcher card shows the live picture on set-up screens and never on a condition screen', async ({ page }) => {
  test.setTimeout(360_000);
  await startNewExperiment(page);
  await driveUntil(page, 'CAMERA_SETUP');
  // Camera setup (with its tracker measurement), calibration and the self-test, as every camera spec drives them.
  await throughCameraAndCalibration(page);
  expect(await stageNow(page)).toBe('CVSQ_BASELINE');

  // A set-up screen: the operator opens the card, and it shows the camera.
  await page.getByTestId('researcher-panel-collapsed').click();
  await expect(page.getByTestId('researcher-feed')).toBeVisible();
  await expect(page.getByTestId('ear-trace')).toBeVisible();
  await expect(page.getByTestId('diag-camera')).toHaveText(/\d+ fps · \d+×\d+/, { timeout: 10_000 });
  const feed = await page.evaluate(() => {
    const v = document.querySelector('[data-testid="researcher-feed-video"]') as HTMLVideoElement;
    const hidden = document.querySelector('video[aria-hidden="true"]') as HTMLVideoElement;
    return { playing: v.readyState >= 2 && v.videoWidth > 0, same: (v.srcObject as MediaStream).id === (hidden.srcObject as MediaStream).id };
  });
  expect(feed).toEqual({ playing: true, same: true });

  // Into the first condition: no picture of the participant, whatever the card's state was.
  for (let i = 0; i < 40 && (await stageNow(page)) !== 'READING_TASK'; i++) await handleStage(page, await stageNow(page));
  expect(await stageNow(page)).toBe('READING_TASK');
  const visibleVideos = await page.evaluate(() => [...document.querySelectorAll('video')]
    .filter((v) => { const r = v.getBoundingClientRect(); return r.width > 1 && r.height > 1; }).length);
  expect(visibleVideos).toBe(0);
  await expect(page.getByTestId('researcher-feed')).toHaveCount(0);

  /*
   * Read the page through: the reading window's blink record and trace are written with the
   * condition's eye-metrics row (Round 78), under the condition, with a trace row per processed frame.
   */
  // Turn pages while a reading control is on screen; the stage attribute can trail the last tap while
  // the condition's records are written, so the screen, not the attribute, says when reading is over.
  const readingControl = page.getByRole('button', { name: /Begin reading|Next page|finished reading/i });
  for (let i = 0; i < 20 && (await readingControl.count()) > 0; i++) {
    await handleStage(page, 'READING_TASK');
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await ocularRecords(page)).filter((r) => r.window === 'reading').length, { timeout: 30_000 }).toBe(1);
  const reading = (await ocularRecords(page)).find((r) => r.window === 'reading')!;
  expect(reading.record_id).toBe(reading.condition_id);
  expect((reading.trace as { frames: number }).frames).toBeGreaterThan(0);
  expect(reading.pages as unknown[]).not.toHaveLength(0);
});
