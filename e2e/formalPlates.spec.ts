/**
 * The formal colour-vision plates are recorded on the notice that asks for them (audit 86 UI-7).
 *
 * When the app's own colour screen does not pass, a notice tells the operator to administer the formal
 * plates now, while the participant is there. It said to record the result "on the profile form", and
 * its only button was "Recorded — continue". The profile is BEFORE the colour screen and nothing in the
 * sitting returns to it: the next screen is camera set-up, whose Back goes to consent, and after a
 * re-consent the app jumps back to camera set-up. So a deficiency found on the plates could not be
 * entered — the audit's participant kept the profile's 'not done' and stayed eligible=TRUE.
 */
import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil, setInput, click, stageNow, waitStageChange, dbAll } from './helpers';

type Participant = { cvd_clinical: string; cvd_status: string; eligible: boolean; exclusion_reason: string | null };

test.use({ viewport: { width: 1152, height: 720 } });

test('a deficiency found on the formal plates after the colour screen is recorded, and excludes', async ({ page }) => {
  test.setTimeout(150_000);
  await startNewExperiment(page);
  await driveUntil(page, 'PARTICIPANT_PROFILE');
  // The profile as the audit filled it: the formal plates not done yet.
  await setInput(page, 'age', '30');
  await setInput(page, 'hours', '6');
  await click(page, /^female$/);
  await click(page, /^high$/);
  await click(page, /^dim$/);
  await click(page, /^glasses$/);
  await page.getByRole('button', { name: /^no$/ }).first().click({ force: true });
  await click(page, /^not done$/);
  await page.getByRole('button', { name: /^no$/ }).nth(1).click({ force: true });
  await setInput(page, 'since-sleep', '3');
  await click(page, /^Continue/);
  await waitStageChange(page, 'PARTICIPANT_PROFILE');
  await driveUntil(page, 'COLOR_VISION');

  // "Can't tell" on every plate: the control plate is missed, so the screen cannot pass.
  const record = page.getByTestId('formal-plates-record');
  for (let i = 0; i < 20 && !(await record.isVisible().catch(() => false)); i++) {
    await page.waitForTimeout(350); // past the screen-change tap guard (lib/tapGuard.ts)
    const cant = page.getByRole('button', { name: /Can't tell/ });
    if (await cant.isVisible().catch(() => false)) await cant.click();
  }
  await expect(record).toBeVisible();
  const notice = await page.locator('#root').innerText();
  expect(notice).not.toMatch(/record the result on the profile form/);
  expect(notice).toMatch(/record the result below/);
  expect(notice).toMatch(/on the profile form: not done/);

  // Continuing is a statement about the plates: nothing is chosen for the operator.
  await expect(record).toBeDisabled();
  await page.getByTestId('formal-plates-deficient').click();
  await expect(record).toBeEnabled();
  await record.click();
  await waitStageChange(page, 'COLOR_VISION');
  expect(await stageNow(page)).toBe('CAMERA_SETUP');

  const [p] = await dbAll<Participant>(page, 'participants');
  expect(p.cvd_clinical).toBe('deficient');
  expect(p.eligible, 'the participant stayed in the confirmatory sample').toBe(false);
  expect(p.exclusion_reason).toMatch(/formal plates/);
  // The app's own screen is still recorded beside it, as a covariate.
  expect(p.cvd_status).toMatch(/screen_(failed|inconclusive)/);
});
