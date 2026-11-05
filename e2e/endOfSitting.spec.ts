/**
 * The end of a sitting (audit 86 F4, F9, F10, F13).
 *
 * - A lux reading typed and not logged held nothing: leaving the screen discarded it without a word
 *   (F10). The screen now waits, and says why, until it is logged or cleared.
 * - The end-of-sitting reading and the closing photograph existed only on the thank-you screen, after
 *   the sitting was already complete, so a lost thank-you screen lost both for good (F4). The reading
 *   can now be logged from the session manager (here); the photograph is taken at the last
 *   questionnaire (tests/endOfSitting.test.tsx, with the one-photograph-per-checkpoint rule of F9: the
 *   fake camera's drive through a whole sitting is too slow and uneven for this suite).
 * - On a full device the thank-you screen's only button did nothing (F13).
 */
import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, dbAll, driveUntil, validLux } from './helpers';

test.use({ viewport: { width: 1152, height: 720 } });

type Session = { status: string; lux_readings: { checkpoint: string; lux: number; at: number }[]; session_end_time: number | null };

async function sessionRow(page: Page): Promise<Session> {
  return (await dbAll<Session>(page, 'sessions'))[0];
}

test('a typed lux reading holds the screen until it is logged; a lost thank-you screen\'s end reading is logged from the manager', async ({ page }) => {
  test.setTimeout(300_000);
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'LUX01', split: true });

  // To the break that asks for the middle reading.
  for (let i = 0; i < 800; i++) {
    const st = await stageNow(page);
    if (st === 'BREAK_SCREEN' && await page.getByTestId('lux-middle').isVisible().catch(() => false)) break;
    if (await handleStage(page, st, { split: true })) throw new Error('finished before the middle reading');
  }
  const cont = page.getByRole('button', { name: /I’m ready — continue/ });
  await expect(cont).toBeEnabled();
  await page.getByTestId('lux-middle').fill(await validLux(page));
  await expect(page.getByTestId('lux-middle-pending')).toBeVisible();
  await expect(cont).toBeDisabled();
  // Cleared: the way on opens again, and nothing is stored.
  await page.getByTestId('lux-middle').fill('');
  await expect(cont).toBeEnabled();
  await page.getByTestId('lux-middle').fill('310');
  await expect(cont).toBeDisabled();
  await page.getByTestId('lux-middle-save').click();
  await expect(cont).toBeEnabled();
  await expect.poll(async () => (await sessionRow(page)).lux_readings.find((r) => r.checkpoint === 'middle')?.lux).toBe(310);

  await driveUntil(page, 'SESSION_COMPLETE', 800, { split: true });
  const out = page.getByRole('button', { name: /view export dashboard/ });
  await page.getByTestId('lux-end').fill('305');
  await expect(page.getByTestId('lux-end-pending')).toBeVisible();
  await expect(out).toBeDisabled();

  // The thank-you screen is lost before the reading is logged.
  const before = await sessionRow(page);
  expect(before.status).toBe('complete');
  expect(before.lux_readings.some((r) => r.checkpoint === 'end')).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: /Enter Research Console/ }).click({ force: true });
  await page.getByTestId('completed-toggle').click();
  await page.getByTestId('log-end-lux').click();
  await expect(page.getByTestId('end-lux-dialog')).toContainText('finished without its end reading');
  await page.getByTestId('confirm-input').fill('305');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('log-end-lux')).toHaveCount(0);
  const after = await sessionRow(page);
  const end = after.lux_readings.find((r) => r.checkpoint === 'end')!;
  expect(end.lux).toBe(305);
  expect(end.at).toBeGreaterThanOrEqual(after.session_end_time!);
  expect(after.lux_readings.map((r) => r.checkpoint).sort()).toEqual(['end', 'middle', 'start']);
});

test('on a full device the thank-you screen still opens the dashboard', async ({ page }) => {
  test.setTimeout(300_000);
  // Every IndexedDB put throws QuotaExceededError once window.__full is set (the audit's reproduction).
  await page.addInitScript(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof orig>) {
      if ((window as unknown as { __full?: boolean }).__full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return orig.apply(this, args);
    } as typeof orig;
  });
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'FULL01', split: true });
  await driveUntil(page, 'SESSION_COMPLETE', 800, { split: true });
  await page.evaluate(() => { (window as unknown as { __full: boolean }).__full = true; });
  await page.getByRole('button', { name: /view export dashboard/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'EXPORT_DASHBOARD', null, { timeout: 15_000 });
  expect((await sessionRow(page)).status).toBe('complete');
});
