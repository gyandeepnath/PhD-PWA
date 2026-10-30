import { test, expect, type Page } from '@playwright/test';
import { stageNow, handleStage, dbAll, startNewExperiment } from './helpers';

/**
 * A DOUBLE TAP MOVES ONE SCREEN AND ANSWERS ONE THING (Round 86, audit 86).
 *
 * On the tablet a finger's double tap — two touches 100-200 ms apart — reached the app as two complete
 * taps. The second one either ran the first screen's completion handler again, after that handler had
 * already moved the sitting on, or landed on whatever the NEXT screen had drawn at the same place. The
 * audit found it skipping the baseline CVS-Q, ticking the camera consent, answering two colour-vision
 * plates, recording a word-search false alarm and scoring the first reaction trial as an anticipation.
 *
 * Every test here drives the screen with a TOUCH screen (hasTouch, touchscreen.tap) the way the audit's
 * reproductions did; the rest of the suite clicks with a mouse.
 */
test.use({ viewport: { width: 1152, height: 720 }, hasTouch: true });

/** Two touches `gap` ms apart at the centre of `box`. */
async function doubleTapAt(page: Page, box: { x: number; y: number; width: number; height: number }, gap: number) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(gap);
  await page.touchscreen.tap(x, y);
}

/** Every distinct data-stage from now on, in order. */
async function recordStages(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __stages: string[] };
    w.__stages = [];
    const rec = () => {
      const st = document.querySelector('[data-stage]')?.getAttribute('data-stage');
      if (st && w.__stages[w.__stages.length - 1] !== st) w.__stages.push(st);
    };
    new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage'] });
    rec();
  });
}
const stagesSeen = (page: Page) => page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);

/** Consent to the camera and the two photographs, then through camera setup and calibration to the camera check's result. */
async function toCameraCheckResult(page: Page) {
  for (let i = 0; i < 300 && (await stageNow(page)) !== 'CAMERA_SETUP'; i++) {
    const s = await stageNow(page);
    if (s === 'CONSENT') {
      await page.getByTestId('consent-core').check();
      await page.getByTestId('consent-camera').check();
      await page.getByTestId('consent-photos').check();
      await page.getByRole('button', { name: /I consent/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CONSENT');
      continue;
    }
    await handleStage(page, s);
  }
  await page.getByRole('button', { name: /Enable camera/ }).click();
  await page.getByRole('button', { name: /My face is centred/ }).click({ timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CALIBRATION', null, { timeout: 60_000 });
  await page.getByRole('button', { name: /Begin calibration/ }).click();
  await page.waitForFunction(() =>
    !!document.querySelector('[data-testid="calibration-accept-thin"], [data-testid="calibration-continue-anyway"], [data-testid="selftest-start"]'),
  null, { timeout: 120_000 });
  for (const id of ['calibration-accept-thin', 'calibration-continue-anyway']) {
    const b = page.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await page.getByTestId('selftest-start').click({ timeout: 20_000 });
  await page.waitForSelector('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]', { timeout: 90_000 });
}

test.describe('the camera check (audit 86 F14, M3)', () => {
  /*
   * Its handler writes the result, the check's blinks and the start photograph before it moves on. A
   * second tap during those writes ran the handler again; the second copy's advance came after the first
   * had moved to the baseline CVS-Q, and moved on from THAT — the CVS-Q, the reference for the sitting's
   * change score, was never shown — and a second start photograph was stored. Reproduced by the audit
   * at 120-150 ms between the taps, with the CPU slowed as the tablet's is under FaceMesh.
   */
  test('a double tap on Continue anyway reaches the baseline CVS-Q, stays there, and takes one start photograph', async ({ page }) => {
    test.setTimeout(400_000);
    await startNewExperiment(page);
    await toCameraCheckResult(page);
    await recordStages(page);
    const button = page.locator('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]').first();
    const box = (await button.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await doubleTapAt(page, box, 150);
    await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION', null, { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(await stagesSeen(page)).toEqual(['CALIBRATION', 'CVSQ_BASELINE']);
    expect(await stageNow(page)).toBe('CVSQ_BASELINE');
    const media = await dbAll<{ checkpoint: string }>(page, 'media_captures');
    expect(media.filter((m) => m.checkpoint === 'session_start')).toHaveLength(1);
  });

  /*
   * The handler used to put the calibration routine back on screen while the photograph was taken: for
   * 1-2.5 s after Continue the stage read CALIBRATION with no check, so the routine's start screen came
   * back, live, and a tap on Begin calibration started a calibration the app abandoned when it moved on.
   * The check's result now stays up (saying it is saving) until the stage changes.
   */
  test('after Continue the calibration start screen never comes back before the baseline CVS-Q', async ({ page }) => {
    test.setTimeout(400_000);
    await startNewExperiment(page);
    await toCameraCheckResult(page);
    await page.evaluate(() => {
      const w = window as unknown as { __calibrationBack: boolean };
      w.__calibrationBack = false;
      const look = () => {
        if ([...document.querySelectorAll('button')].some((b) => /Begin calibration/.test(b.textContent ?? ''))) w.__calibrationBack = true;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await page.locator('[data-testid="selftest-continue"], [data-testid="selftest-continue-anyway"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CVSQ_BASELINE', null, { timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __calibrationBack: boolean }).__calibrationBack)).toBe(false);
  });
});
