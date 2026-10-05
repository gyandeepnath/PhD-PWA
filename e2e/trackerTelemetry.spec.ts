import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil } from './helpers';

/*
 * @mediapipe/tasks-vision posts usage metrics to Google (https://odml.pa.googleapis.com/v1/log). Its
 * README says so and makes the app responsible for consent; the participants consented to numeric
 * measures kept on this device. index.html's Content-Security-Policy (connect-src 'self') is what
 * refuses the request. This proves the block in a real browser: the library does try — on closing a
 * tracker, which the camera-setup measurement does for every backend it is not keeping — the policy
 * refuses it, and no request to any other origin leaves the page.
 */
test('the face tracker\'s usage metrics never leave the tablet', async ({ page }) => {
  test.setTimeout(240_000);
  const external: string[] = [];
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await startNewExperiment(page);
  // The policy is in force on the app's own page: a direct attempt is refused before it is sent.
  const direct = await page.evaluate(async () => {
    try { await fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'x' }); return 'sent'; } catch (e) { return `refused: ${(e as Error).name}`; }
  });
  expect(direct).toBe('refused: TypeError');
  // The violation event is dispatched after the refusal; wait for it, so that every violation counted
  // from here on is the library's own and not the probe above.
  await page.waitForFunction(() => (window as unknown as { __csp: string[] }).__csp.length > 0);
  const probeViolations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.length);

  await driveUntil(page, 'CAMERA_SETUP');
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await expect(page.getByRole('button', { name: /My face is centred/ })).toBeEnabled({ timeout: 120_000 });
  // The measurement started and closed the Face Landmarker backends; closing flushes their metrics.
  const trials = await page.getByTestId('tracker-trials').innerText();
  const tasksRan = /Face Landmarker \((GPU|CPU)\)[^\n]*\t\d/.test(trials);
  const csp = (await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).slice(probeViolations);
  if (tasksRan) expect(csp.some((v) => /connect-src/.test(v) && /odml\.pa\.googleapis\.com/.test(v))).toBe(true);
  expect(external).toEqual([]);
});
