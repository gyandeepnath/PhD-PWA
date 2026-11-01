import { test, expect, type Page } from '@playwright/test';
import { stageNow, handleStage, dbAll, startNewExperiment, setInput, validLux, waitStageChange, driveUntil } from './helpers';
import { TAP_GUARD_MS, CONSENT_TAP_GUARD_MS, TAP_GUARD_VERSION } from '../src/lib/tapGuard';

/**
 * A DOUBLE TAP MOVES ONE SCREEN AND ANSWERS ONE THING (Round 86, audit 86).
 *
 * On the tablet a finger's double tap — two touches 100-200 ms apart — reached the app as two complete
 * taps. The second one either ran the first screen's completion handler again, after that handler had
 * already moved the sitting on, or landed on whatever the NEXT screen had drawn at the same place. The
 * audit found it skipping the baseline CVS-Q, ticking the camera consent, answering two colour-vision
 * plates, recording a word-search false alarm and scoring the first reaction trial as an anticipation.
 *
 * Two causes, two fixes. A completion handler run twice moved the sitting twice: stage moves are now
 * addressed to the screen they leave (experiment/useStageTransitions.ts). A tap carried onto the next
 * screen was taken by it: a touch that starts within TAP_GUARD_MS of a screen change is now dropped
 * (lib/tapGuard.ts).
 *
 * Every test here drives the screen with a TOUCH screen (hasTouch, touchscreen.tap) the way the audit's
 * reproductions did; the rest of the suite clicks with a mouse, which the tap guard leaves alone.
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

/** The centre of the first button named `name`. */
async function buttonBox(page: Page, name: RegExp) {
  const b = page.getByRole('button', { name }).first();
  await expect(b).toBeEnabled();
  return (await b.boundingBox())!;
}

/** Drive with the shared (mouse) driver until `stop` says so; counts the displays entered. */
async function driveTo(page: Page, stop: (stage: string, display: number) => Promise<boolean> | boolean) {
  let display = 0;
  let last = '';
  for (let i = 0; i < 800; i++) {
    const s = await stageNow(page);
    if (s === 'READING_TASK' && last !== 'READING_TASK') display += 1;
    last = s;
    if (await stop(s, display)) return;
    if (await handleStage(page, s)) throw new Error('the sitting ended first');
  }
  throw new Error('never got there');
}

test.describe('the setup screens (audit 86 F8, F11)', () => {
  test('a double tap on "Begin setup" ticks nothing on the consent screen', async ({ page }) => {
    test.setTimeout(300_000);
    await startNewExperiment(page);
    await setInput(page, 'pid', 'E2E01');
    await page.waitForTimeout(150);
    await setInput(page, 'lux', await validLux(page));
    await page.waitForTimeout(500);
    // The consent screen's camera option sat under "Begin setup", and arrived ticked.
    await doubleTapAt(page, await buttonBox(page, /Begin setup/), 130);
    await waitStageChange(page, 'SESSION_INIT');
    expect(await stageNow(page)).toBe('CONSENT');
    await page.waitForTimeout(CONSENT_TAP_GUARD_MS + 200);
    for (const id of ['consent-core', 'consent-camera', 'consent-photos', 'consent-video']) {
      const box = page.getByTestId(id);
      if (await box.count()) await expect(box, `${id} ticked by a carried tap`).not.toBeChecked();
    }
    // A touch after the screen has been read ticks what it touches.
    const core = (await page.getByTestId('consent-core').boundingBox())!;
    await page.touchscreen.tap(core.x + core.width / 2, core.y + core.height / 2);
    await expect(page.getByTestId('consent-core')).toBeChecked();
  });

  test('a double tap on a colour-vision digit answers one plate', async ({ page }) => {
    test.setTimeout(300_000);
    await startNewExperiment(page);
    // The digits are the same buttons in the same place on the next plate.
    await driveUntil(page, 'COLOR_VISION');
    const counter = page.getByText(/Colour-vision screening · \d+\/\d+/);
    await expect(counter).toHaveText(/· 1\//);
    await page.waitForTimeout(600);
    await doubleTapAt(page, await buttonBox(page, /^8$/), 140);
    await page.waitForTimeout(600);
    await expect(counter, 'the second tap answered the plate it landed on').toHaveText(/· 2\//);
    // And the plate now on screen takes a deliberate answer.
    const eight = await buttonBox(page, /^8$/);
    await page.touchscreen.tap(eight.x + eight.width / 2, eight.y + eight.height / 2);
    await expect(counter).toHaveText(/· 3\//);
  });
});

test.describe('the tasks (audit 86 M1, M2)', () => {
  /*
   * The search and the reaction task open on an instruction card whose button sits over the task: a
   * word of the passage, the reaction field (all of it is the response key). The second tap of a double
   * tap on the button was taken by the task — a false alarm; trial 1 an anticipation.
   */
  test('a double tap on "Begin search" records no false alarm', async ({ page }) => {
    test.setTimeout(500_000);
    await startNewExperiment(page);
    await driveTo(page, async (s) => s === 'VISUAL_SEARCH' && (await page.getByRole('button', { name: /Begin search/ }).count()) > 0);
    await page.waitForTimeout(500);
    await doubleTapAt(page, await buttonBox(page, /Begin search/), 130);
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Done searching/ }).click({ force: true });
    await waitStageChange(page, 'VISUAL_SEARCH');
    const search = await dbAll<{ false_detections: number; targets_found: number }>(page, 'visual_search');
    expect(search).toHaveLength(1);
    expect(search[0].false_detections, 'the second tap marked a word of the passage').toBe(0);
    expect(search[0].targets_found).toBe(0);
  });

  test('a double tap on the reaction task\'s "Start": trial 1 is not a response', async ({ page }) => {
    test.setTimeout(500_000);
    await startNewExperiment(page);
    // Display 2's block has no practice trials: trial 1 is scored.
    await driveTo(page, async (s, display) => s === 'REACTION_TIME' && display === 2 && (await page.getByRole('button', { name: /Start/ }).count()) > 0);
    await page.waitForTimeout(500);
    await doubleTapAt(page, await buttonBox(page, /Start/), 130);
    await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'REACTION_TIME', null, { timeout: 60_000 });
    const conditions = await dbAll<{ condition_id: string; session_position: number; tap_guard_version?: string }>(page, 'conditions');
    const second = conditions.find((c) => c.session_position === 1)!;
    // The row says which rule its touches were taken under.
    expect(second.tap_guard_version).toBe(TAP_GUARD_VERSION);
    const trials = (await dbAll<{ condition_id: string; trial_number: number; accuracy: string; false_start: boolean; response_time_ms: number | null }>(page, 'reaction_trials'))
      .filter((t) => t.condition_id === second.condition_id).sort((a, b) => a.trial_number - b.trial_number);
    expect(trials[0].trial_number).toBe(1);
    expect(trials[0].false_start, 'the second tap fell in trial 1\'s fixation').toBe(false);
    expect(trials[0].response_time_ms, 'the second tap was scored as a response to trial 1').toBeNull();
    expect(['miss', 'correct_rejection']).toContain(trials[0].accuracy);
  });

  /*
   * The guard drops events or lets them through untouched; it stamps nothing. Measured: taps on the
   * reaction field throughout a block, recorded as they reach the app, against what the block stored.
   * Every response time is exactly (the tap's own timestamp) - (the stored onset), as it was before the
   * guard, and every tap from 300 ms after "Start" reached the task.
   */
  test('taps on the reaction field after the guard reach the task with their own timestamps', async ({ page }) => {
    test.setTimeout(500_000);
    await startNewExperiment(page);
    await driveTo(page, async (s, display) => s === 'REACTION_TIME' && display === 2 && (await page.getByRole('button', { name: /Start/ }).count()) > 0);
    await page.evaluate(() => {
      const w = window as unknown as { __downs: number[] };
      w.__downs = [];
      // On the document, behind the guard's window listener: what reaches the app.
      document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') w.__downs.push(e.timeStamp); }, { capture: true });
    });
    await page.waitForTimeout(500);
    const start = await buttonBox(page, /Start/);
    const sent: number[] = [];
    await page.touchscreen.tap(start.x + start.width / 2, start.y + start.height / 2);
    const startedAt = await page.evaluate(() => performance.now());
    // Tap the field every 45 ms until the block is over: fixations, dots and gaps alike.
    for (let k = 0; k < 400 && (await stageNow(page)) === 'REACTION_TIME'; k++) {
      await page.touchscreen.tap(start.x + start.width / 2, start.y - 120);
      sent.push(await page.evaluate(() => performance.now()));
      await page.waitForTimeout(45);
      if ((await page.locator('[data-testid="rt-fixation"], [data-testid="rt-dot"]').count()) === 0 && k > 5) break;
    }
    await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'REACTION_TIME', null, { timeout: 60_000 });
    const downs = await page.evaluate(() => (window as unknown as { __downs: number[] }).__downs);
    // The Start tap itself, and every field tap sent after the guard had ended, reached the app.
    const afterGuard = sent.filter((t) => t - startedAt > TAP_GUARD_MS + 50);
    expect(afterGuard.length).toBeGreaterThan(10);
    expect(downs.length).toBeGreaterThanOrEqual(1 + afterGuard.length);
    const conditions = await dbAll<{ condition_id: string; session_position: number }>(page, 'conditions');
    const second = conditions.find((c) => c.session_position === 1)!;
    const trials = (await dbAll<{ condition_id: string; stimulus_onset_time: number; response_time_ms: number | null }>(page, 'reaction_trials'))
      .filter((t) => t.condition_id === second.condition_id);
    const responded = trials.filter((t) => t.response_time_ms != null);
    expect(responded.length).toBeGreaterThan(0);
    for (const t of responded) {
      const at = t.stimulus_onset_time + t.response_time_ms!;
      expect(downs.some((d) => Math.abs(d - at) < 1e-6), `response at ${at} is not a tap's own timestamp`).toBe(true);
    }
  });
});
