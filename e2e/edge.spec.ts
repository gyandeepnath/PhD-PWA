import { test, expect } from '@playwright/test';
import { stageNow, startNewExperiment, driveUntil, dbCounts, click } from './helpers';

/** Edge / "unnatural scenario" E2E checks: invalid input gating, double-submit, reload + resume. */

test('SESSION_INIT gates on invalid input', async ({ page }) => {
  await startNewExperiment(page);
  expect(await stageNow(page)).toBe('SESSION_INIT');
  // Empty fields → Begin setup disabled.
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeDisabled();
  // Out-of-range lux → still disabled.
  await page.getByTestId('pid').fill('P9');
  await page.getByTestId('lux').fill('999999');
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeDisabled();
  // Valid → enabled.
  await page.getByTestId('lux').fill('350');
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeEnabled();
});

test('rapid double-click on Begin setup creates only one session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startNewExperiment(page);
  await page.getByTestId('pid').fill('DBL01');
  await page.getByTestId('lux').fill('350');
  const btn = page.getByRole('button', { name: /Begin setup/ });
  await expect(btn).toBeEnabled();
  // Fire several clicks before the async session-create completes.
  await Promise.all([btn.click({ force: true }), btn.click({ force: true }), btn.click({ force: true })]);
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CONSENT', null, { timeout: 15_000 });
  const c = await dbCounts(page, ['sessions']);
  expect(c.sessions).toBe(1);
  expect(errors).toEqual([]);
});

test('reload mid-session offers resume and continues at a condition', async ({ page }) => {
  await startNewExperiment(page);
  // Drive setup until the first reading task of the first condition.
  await driveUntil(page, 'READING_TASK');
  expect(await stageNow(page)).toBe('READING_TASK');

  // Hard reload mid-session.
  await page.reload();

  // Shell restarts at the landing page; the in-progress session must be resumable.
  await click(page, /Enter Research Console/);
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
  await page.getByRole('button', { name: /Resume/ }).first().click({ force: true });

  // Resumes into the experiment at the (restarted) condition.
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
      return s && s !== 'SESSION_INIT';
    },
    null,
    { timeout: 20_000 },
  );
  const stage = await stageNow(page);
  expect(['READING_TASK', 'COMPREHENSION', 'DISPLAY_PERCEPTION']).toContain(stage);

  // The session remains a single in-progress record (no duplicate from resume).
  const c = await dbCounts(page, ['sessions']);
  expect(c.sessions).toBe(1);
});
