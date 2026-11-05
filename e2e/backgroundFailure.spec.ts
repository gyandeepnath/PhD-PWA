/**
 * The "Something failed in the background" alert is read, then put away, and never covers a set-up
 * screen's buttons while it is up (audit 86 M1, UI-4).
 *
 * It was fixed over the bottom of the screen and could not be dismissed: on pre-flight scrolled to its
 * end it covered "← Back to the profile" and "All checks pass — continue", and on a reading page a
 * one-line failure covered the whole "Next page" button. It lived on document.body, so Exit and Resume
 * kept it; only a reload cleared it. Its instruction line was 12 px monospace at 85% opacity.
 */
import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil } from './helpers';

test.use({ viewport: { width: 1152, height: 720 } });

/** storage/db.ts STORAGE_FULL_MESSAGE, verbatim: four lines in the alert, which is what covered the buttons. */
const STORAGE_FULL =
  'This device has run out of storage and VisuLab can no longer save anything. STOP THE SITTING NOW '
  + '— from this point on nothing the participant does is being recorded. Sessions already saved are '
  + 'safe. Export them, copy the files off the tablet, then in the Session Manager Delete those '
  + 'sessions and Purge them from the recycle bin — Delete alone does not free space, Purge does — '
  + 'before running anyone else.';

/** An unhandled rejection, as a failed write in an event handler produces one. */
async function failInTheBackground(page: Page, message: string) {
  await page.evaluate((m) => { void Promise.reject(new Error(m)); }, message);
  await page.waitForSelector('#visulab-async-error');
  await page.waitForTimeout(250); // the screens re-lay out around it
}

/** Whether a finger at the centre, top and bottom of a button touches the button. */
async function reachable(page: Page, name: RegExp): Promise<boolean[]> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const b = Array.from(document.querySelectorAll('button')).find((x) => re.test(x.textContent ?? ''))!;
    const r = b.getBoundingClientRect();
    return [0.5, 0.15, 0.85].map((fy) => {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + fy * r.height);
      return !!hit && (hit === b || b.contains(hit));
    });
  }, name.source);
}

test('on a set-up screen the alert covers no button, says what to do in the operator type, and hides', async ({ page }) => {
  test.setTimeout(120_000);
  await startNewExperiment(page);
  await driveUntil(page, 'PREFLIGHT');
  // The longest message the app raises: the full-device instruction (storage/db.ts STORAGE_FULL_MESSAGE).
  await failInTheBackground(page, `StorageFullError: ${STORAGE_FULL}`);

  // Scrolled to its end, where the buttons are: both still under a finger, not under the alert.
  await page.evaluate(() => { for (const e of Array.from(document.querySelectorAll('#root *')) as HTMLElement[]) e.scrollTop = e.scrollHeight; });
  await page.waitForTimeout(150);
  expect(await reachable(page, /All checks pass/)).toEqual([true, true, true]);
  expect(await reachable(page, /Back to the profile/)).toEqual([true, true, true]);

  // The instruction is operator type: 14 px or more, not monospace, at full opacity.
  const type = await page.evaluate(() => {
    const d = document.querySelector('#visulab-async-error [data-detail]') as HTMLElement;
    let o = 1;
    for (let e: HTMLElement | null = d; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    const cs = getComputedStyle(d);
    return { px: parseFloat(cs.fontSize), family: cs.fontFamily, opacity: o };
  });
  expect(type.px).toBeGreaterThanOrEqual(14);
  expect(type.family).not.toMatch(/mono/i);
  expect(type.opacity).toBe(1);
  await expect(page.locator('#visulab-async-error')).toContainText(/at \d\d:\d\d:\d\d/);

  // Read, noted, hidden: gone, and the screen has its room back.
  await page.getByTestId('async-error-hide').click();
  await expect(page.locator('#visulab-async-error')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--vl-alert-h'))).toBe('');
  // A later failure raises it again.
  await failInTheBackground(page, 'Error: a second failure');
  await expect(page.locator('#visulab-async-error')).toContainText('a second failure');
});

test('on a reading page the alert stops the participant until the researcher hides it, and the page is unchanged', async ({ page }) => {
  test.setTimeout(150_000);
  await startNewExperiment(page);
  await driveUntil(page, 'READING_TASK');
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  const next = page.getByRole('button', { name: /Next page|finished reading/i });
  await next.waitFor();
  const before = await page.getByTestId('reading-text').boundingBox();
  await failInTheBackground(page, 'InvalidStateError: The database connection is closing.');
  // The passage's geometry is the stimulus: the alert does not move it.
  expect(await page.getByTestId('reading-text').boundingBox()).toEqual(before);
  await page.getByTestId('async-error-hide').click();
  await expect(page.locator('#visulab-async-error')).toHaveCount(0);
  expect(await reachable(page, /Next page|finished reading/)).toEqual([true, true, true]);
});
