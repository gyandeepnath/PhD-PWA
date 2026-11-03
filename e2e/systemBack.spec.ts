import { test, expect, type Page } from '@playwright/test';
import { stageNow, handleStage, driveUntil, waitStageChange, dbAll } from './helpers';

/**
 * The system Back gesture is the top-left chip of the screen it is made on, never a way out of the app
 * (lib/systemBack.ts; Round 87, audit 86 F6).
 *
 * The app kept no history entry of its own. Back on page 2 of a display unloaded it — in this browser to
 * about:blank; on the tablet, in the installed app, the window closed — and the sitting came back under
 * Resume with that display to run again as a second exposure of its passage. Nothing asked first.
 *
 * page.goBack() is the browser's Back. The installed app is emulated as far as a headless browser allows:
 * the display mode reads full screen, and the page is opened on a fresh tab whose only history entry is
 * the app itself, as the installed app's window is — the case where Back with nothing to go back to
 * closes the window. A marker set on the page before each Back must survive it: the same document, not
 * a reload or another page.
 */

test.use({ viewport: { width: 1152, height: 720 } });

/** The installed app's launch: CSS display-mode full screen, as the home-screen icon opens it. */
async function launchInstalled(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => {
      const m = /\(display-mode:\s*([a-z-]+)\)/.exec(q);
      if (!m) return real(q);
      return {
        matches: m[1] === 'fullscreen', media: q, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent() { return false; },
      } as unknown as MediaQueryList;
    };
  });
}

/**
 * Open the app as the home-screen icon does: a window whose ONLY history entry is the app. A test page
 * starts on about:blank, which page.goto would leave behind as an entry to go back to; replacing it
 * leaves the app alone in the window's history, where Back with nothing of the app's own closes it.
 */
async function openAsInstalled(page: Page) {
  await launchInstalled(page);
  const url = new URL('/?e2e=1', test.info().project.use.baseURL).href;
  await page.evaluate((u) => { location.replace(u); }, url);
  await page.waitForURL(url);
  await page.getByRole('button', { name: /Enter Research Console/ }).waitFor();
  expect(await page.evaluate(() => history.length), 'the launch is the window\'s only entry').toBe(1);
}

/** Into a new session's form, as startNewExperiment, from a window opened by openAsInstalled. */
async function newSession(page: Page) {
  await page.getByRole('button', { name: /Enter Research Console/ }).click({ force: true });
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });
}

/**
 * Back, as the gesture makes it; then the page must still be the one it was, and — except on the landing
 * page, which leaves Back to the browser — the app's own entry must be back on top for the next Back.
 */
async function systemBack(page: Page, { kept = true } = {}) {
  const url = page.url();
  await page.evaluate(() => { (window as unknown as { __sameDocument: boolean }).__sameDocument = true; });
  await page.goBack();
  await page.waitForTimeout(200);
  expect(page.url(), 'Back changed the address').toBe(url);
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument),
    'Back unloaded the app').toBe(true);
  const state = await page.evaluate(() => history.state as unknown);
  if (kept) expect(state, 'the app\'s own entry was not put back: the next Back leaves the app').not.toBeNull();
  else expect(state, 'the landing page kept Back from the browser').toBeNull();
}

test('Back inside a display raises the Pause confirmation, can only decline it, and is nothing during the reaction trials', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openAsInstalled(page);
  await newSession(page);
  // The launch, and the app's own entry kept on top of it.
  expect(await page.evaluate(() => history.length)).toBe(2);

  // Page 2 of the first display's passage: where the audit's Back closed the app.
  await driveUntil(page, 'READING_TASK');
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  await page.getByRole('button', { name: /Next page/ }).click({ force: true, timeout: 30_000 });
  const counter = page.getByTestId('reading-page-counter');
  const pageShown = await counter.innerText();

  await systemBack(page);
  expect(await stageNow(page)).toBe('READING_TASK');
  // The chip's own confirmation, drawn in the display's ink, over the passage still on its page.
  await expect(page.getByTestId('pause-dialog')).toBeVisible();
  await expect(page.getByTestId('pause-dialog')).toContainText('This condition will be restarted on resume.');
  await expect(counter).toHaveText(pageShown);
  // A second Back declines it — as Escape does — and never confirms leaving.
  await systemBack(page);
  await expect(page.getByTestId('pause-dialog')).toHaveCount(0);
  expect(await stageNow(page)).toBe('READING_TASK');
  await expect(counter).toHaveText(pageShown);
  // Back again, and "Keep going": the reading carries on where it was.
  await systemBack(page);
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('pause-dialog')).toHaveCount(0);
  await expect(counter).toHaveText(pageShown);

  // A turn to portrait: the block over everything says what to do, and Back under it does nothing — no
  // confirmation left waiting behind it for when the tablet is turned back.
  await page.setViewportSize({ width: 720, height: 1152 });
  await expect(page.getByTestId('portrait-block')).toBeVisible();
  await systemBack(page);
  await page.setViewportSize({ width: 1152, height: 720 });
  await expect(page.getByTestId('portrait-block')).toHaveCount(0);
  await expect(page.getByTestId('pause-dialog')).toHaveCount(0);
  await expect(counter).toHaveText(pageShown);
  expect(await page.evaluate(() => history.length)).toBe(2);

  // Through the rest of the display; Back while the reaction trials run does nothing at all.
  let backDuringTrials = false;
  for (let i = 0; i < 200; i++) {
    const s = await stageNow(page);
    if (s === 'ADAPTATION' || s === 'BREAK_SCREEN') break;
    if (s === 'REACTION_TIME' && !backDuringTrials) {
      await page.getByRole('button', { name: /Start/ }).click({ force: true });
      await expect(page.getByTestId('rt-fixation')).toBeVisible();
      await systemBack(page);
      expect(await stageNow(page)).toBe('REACTION_TIME');
      await expect(page.getByTestId('pause-dialog')).toHaveCount(0);
      await expect(page.getByTestId('pause-chip')).toHaveCount(0);
      backDuringTrials = true;
      await waitStageChange(page, 'REACTION_TIME');
      continue;
    }
    await handleStage(page, s);
  }
  expect(backDuringTrials).toBe(true);
  // The display finished as a first reading, and the confirmation Back raised over it is timed as a
  // notice, exactly as the chip's is.
  const [row] = await dbAll<{ session_position: number; attempt_number: number; completed_at: number | null; condition_notice_ms: number | null }>(page, 'conditions');
  expect(row.session_position).toBe(0);
  expect(row.attempt_number).toBe(1);
  expect(row.completed_at).not.toBeNull();
  expect(row.condition_notice_ms ?? 0).toBeGreaterThan(0);

  // The next display's instruction card: Back is the Pause chip there too, and confirming it is the
  // chip's own pause — the finished display kept, the sitting resumable at the next one.
  await driveUntil(page, 'READING_TASK');
  await systemBack(page);
  await expect(page.getByTestId('pause-dialog')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();
  await expect(page.getByText(/next condition 2\/10/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Back on the set-up screens is their Cancel or Exit, is nothing while the colour-vision plates run, and is the browser’s on the landing page', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The session form with nothing typed: Cancel, straight back to the session manager.
  await openAsInstalled(page);
  await newSession(page);
  expect(await stageNow(page)).toBe('SESSION_INIT');
  await systemBack(page);
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();
  // The session manager: its chip, back to the landing page.
  await systemBack(page);
  await expect(page.getByRole('button', { name: /Enter Research Console/ })).toBeVisible();
  // The landing page claims nothing: Back takes the app's own entry and puts nothing back, so the next
  // Back is the browser's — on the tablet, closing the app as any Android app closes from its first screen.
  await systemBack(page, { kept: false });
  await expect(page.getByRole('button', { name: /Enter Research Console/ })).toBeVisible();

  // Consent: "Exit — resume later" and its confirmation; a second Back declines it.
  await newSession(page);
  await driveUntil(page, 'CONSENT', 50, { participantId: 'BACK1' });
  await systemBack(page);
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Exit this sitting for now?');
  await systemBack(page);
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  expect(await stageNow(page)).toBe('CONSENT');

  // The colour-vision plates: no chip while they run, and Back does nothing — the plate stays.
  await driveUntil(page, 'COLOR_VISION', 50, { participantId: 'BACK1' });
  const plateNo = page.getByText(/Colour-vision screening · \d+\/\d+/);
  const before = (await plateNo.textContent()) ?? '';
  await systemBack(page);
  expect(await stageNow(page)).toBe('COLOR_VISION');
  await expect(plateNo).toHaveText(before);
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);

  // Past the plates, the next set-up screen's Exit, confirmed: the sitting is under In progress.
  await driveUntil(page, 'CAMERA_SETUP', 50, { participantId: 'BACK1' });
  await systemBack(page);
  await expect(page.getByTestId('confirm-dialog')).toContainText('Exit this sitting for now?');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();
  await expect(page.getByText(/Resume BACK1/)).toBeVisible();
  expect(errors).toEqual([]);
});
