import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, driveUntil, dbAll } from './helpers';

/**
 * A restarted condition counts as a second exposure only if its passage had been shown (Round 87,
 * audit 86 F12).
 *
 * The condition row is written when the reading screen mounts, while its instruction card ("Read the
 * passage … Begin reading") is still up. A pause there — or the camera-lost notice's pause, or a
 * reload — used to make the next run attempt 2, which the codebook defines as "the participant had
 * already read this passage": a clean first reading was flagged condition_redone and dropped by the
 * "without restarted runs" sensitivity. A pause after "Begin reading" is a second exposure, and must
 * still say so.
 */

test.use({ viewport: { width: 1152, height: 720 } });

type Row = { session_position: number; attempt_number?: number; attempt_rule_version?: string; passage_shown_at?: number | null; completed_at: number | null };

async function rowAt(page: Page, position: number): Promise<Row> {
  const rows = (await dbAll<Row>(page, 'conditions')).filter((c) => c.session_position === position);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function pauseAndResume(page: Page) {
  await page.getByTestId('pause-chip').click();
  await expect(page.getByTestId('pause-dialog')).toContainText('This condition will be restarted on resume.');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();
  await page.getByRole('button', { name: /^Resume/ }).first().click({ force: true });
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
    return !!s && s !== 'SESSION_INIT';
  }, null, { timeout: 20_000 });
}

/** On the first display's reading screen, its instruction card up. */
async function toReadingCard(page: Page) {
  await driveUntil(page, 'READING_TASK');
  await expect(page.getByRole('button', { name: /Begin reading/ })).toBeVisible();
  await expect(page.getByTestId('reading-text')).toHaveCount(0);
}

test('pauses on the reading instruction card are not exposures; a pause on a page is', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startNewExperiment(page);

  // Twice on the card, passage never shown: still the first exposure.
  for (let i = 0; i < 2; i++) {
    await toReadingCard(page);
    const onCard = await rowAt(page, 0);
    expect(onCard.attempt_number).toBe(1);
    expect(onCard.attempt_rule_version).toBe('at-v2');
    expect(onCard.passage_shown_at ?? null).toBeNull();
    await pauseAndResume(page);
  }

  // Now the passage is shown, and the pause comes on page 2.
  await toReadingCard(page);
  expect((await rowAt(page, 0)).attempt_number).toBe(1);
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  await expect(page.getByTestId('reading-text')).toBeVisible();
  await expect.poll(async () => (await rowAt(page, 0)).passage_shown_at ?? null).not.toBeNull();
  const next = page.getByRole('button', { name: /Next page/ });
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click({ force: true });
  await pauseAndResume(page);

  // The restart after it is the second exposure, and the run that finishes says so.
  await toReadingCard(page);
  expect((await rowAt(page, 0)).attempt_number).toBe(2);
  expect((await rowAt(page, 0)).passage_shown_at ?? null).toBeNull();
  await driveUntil(page, 'BREAK_SCREEN');
  const done = await rowAt(page, 0);
  expect(done.completed_at).not.toBeNull();
  expect(done.attempt_number).toBe(2);
  expect(done.passage_shown_at).not.toBeNull();
  // The next display was never interrupted: attempt 1.
  expect((await rowAt(page, 1)).attempt_number).toBe(1);
  expect(await stageNow(page)).toBe('BREAK_SCREEN');
  expect(errors).toEqual([]);
});
