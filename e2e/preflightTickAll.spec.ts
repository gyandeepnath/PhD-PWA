import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, waitStageChange, measureScreen, checkAllBoxes } from './helpers';
import { splitCsvRow } from '../tests/helpers/csv';

/**
 * "Tick all" on the pre-flight room-and-device list (Round 78, the investigator's request): one
 * confirmation ticks the seven researcher checks, and the sitting records that the list was ticked in
 * one step (preflight_bulk_ticked, in the session row and in 01_session_info.csv). Ticking one by one
 * still works and is recorded as such. The consent screen and the single acknowledgements on this
 * screen (display mode, skipping the ruler check) are not part of it.
 */

async function sessionRow(page: Page): Promise<Record<string, unknown>> {
  const rows = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise<Record<string, unknown>[]>((res, rej) => {
      const q = db.transaction('sessions').objectStore('sessions').getAll();
      q.onsuccess = () => res(q.result as Record<string, unknown>[]);
      q.onerror = () => rej(q.error);
    });
  });
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function exportedCell(page: Page, sessionId: string, column: string): Promise<string> {
  const csv = await page.evaluate(async (id) => {
    const gatherUrl = '/src/storage/gather.ts';
    const exportUrl = '/src/storage/export.ts';
    const { gatherSession } = await import(/* @vite-ignore */ gatherUrl);
    const { buildExportFiles } = await import(/* @vite-ignore */ exportUrl);
    const files = buildExportFiles(await gatherSession(id)) as { filename: string; content: string }[];
    return files.find((f) => f.filename === '01_session_info.csv')!.content;
  }, sessionId);
  const [head, row] = csv.trim().split(/\r?\n/);
  return splitCsvRow(row)[splitCsvRow(head).indexOf(column)];
}

/** The seven list items, by their own labels (not the display-mode or ruler acknowledgements). */
const LIST = /auto-brightness OFF|Night Shift OFF|Screen cleaned|Ambient illumination measured|photochromic lenses|no backlight|viewing distance, landscape/;
const listBoxes = (page: Page) => page.locator('label').filter({ hasText: LIST });

test('Tick all ticks the list after one confirmation, and the sitting records it', async ({ page }) => {
  test.setTimeout(180_000);
  await startNewExperiment(page);
  await driveUntil(page, 'PREFLIGHT');
  await measureScreen(page);

  const tickAll = page.getByTestId('preflight-tick-all');
  await expect(tickAll).toHaveText('Tick all');
  // Going back from the question leaves the list as it was.
  await tickAll.click();
  await expect(page.getByTestId('preflight-tick-all-dialog')).toContainText('Only if you have checked each of the 7 items');
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('preflight-tick-all-dialog')).toHaveCount(0);
  await expect(listBoxes(page).locator('input:checked')).toHaveCount(0);

  await tickAll.click();
  await page.getByTestId('confirm-ok').click();
  await expect(listBoxes(page).locator('input:checked')).toHaveCount(7);
  await expect(tickAll).toHaveText('All ticked');
  await expect(tickAll).toBeDisabled();

  // The rest of the screen as usual: the display-mode acknowledgement is still ticked on its own.
  await checkAllBoxes(page);
  await page.getByRole('button', { name: /All checks pass/ }).click({ force: true });
  await waitStageChange(page, 'PREFLIGHT');

  const s = await sessionRow(page);
  expect(s).toMatchObject({ preflight_complete: true, preflight_bulk_ticked: true });
  expect(await exportedCell(page, s.session_id as string, 'preflight_bulk_ticked')).toBe('true');
});

test('ticking one by one still works, and is recorded as not bulk-ticked', async ({ page }) => {
  test.setTimeout(180_000);
  await startNewExperiment(page);
  await driveUntil(page, 'PREFLIGHT');
  await measureScreen(page);
  await checkAllBoxes(page);
  await expect(page.getByTestId('preflight-tick-all')).toBeDisabled();
  await page.getByRole('button', { name: /All checks pass/ }).click({ force: true });
  await waitStageChange(page, 'PREFLIGHT');
  const s = await sessionRow(page);
  expect(s).toMatchObject({ preflight_complete: true, preflight_bulk_ticked: false });
  expect(await exportedCell(page, s.session_id as string, 'preflight_bulk_ticked')).toBe('false');
});
