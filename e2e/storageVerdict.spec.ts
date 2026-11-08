import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, waitStageChange, measureScreen, checkAllBoxes, dbAll } from './helpers';
import { splitCsvRow } from '../tests/helpers/csv';

/**
 * The pre-flight storage check is kept with the sitting (Round 92, audit 86 P5).
 *
 * The check was shown and dropped: a sitting run after 'warn' (the browser did not grant durable storage,
 * so it may clear the data before an export) or 'unknown' exported exactly like one on durable storage.
 * The browser's storage API is replaced before the app loads, so the verdict is known; the screen shows
 * it, and the session row and 01_session_info.csv must say the same.
 */

async function exported(page: Page, sessionId: string, columns: string[]): Promise<string[]> {
  const csv = await page.evaluate(async (id) => {
    const gatherUrl = '/src/storage/gather.ts';
    const exportUrl = '/src/storage/export.ts';
    const { gatherSession } = await import(/* @vite-ignore */ gatherUrl);
    const { buildExportFiles } = await import(/* @vite-ignore */ exportUrl);
    const files = buildExportFiles(await gatherSession(id)) as { filename: string; content: string }[];
    return files.find((f) => f.filename === '01_session_info.csv')!.content;
  }, sessionId);
  const [head, row] = csv.trim().split(/\r?\n/);
  const h = splitCsvRow(head);
  const r = splitCsvRow(row);
  return columns.map((c) => r[h.indexOf(c)]);
}

async function throughPreflight(page: Page): Promise<string> {
  await startNewExperiment(page);
  await driveUntil(page, 'PREFLIGHT');
  await measureScreen(page);
  const shown = page.getByTestId('storage-health');
  await expect(shown).not.toContainText('checking');
  const text = await shown.innerText();
  await checkAllBoxes(page);
  await page.getByRole('button', { name: /All checks pass/ }).click({ force: true });
  await waitStageChange(page, 'PREFLIGHT');
  return text;
}

test('durable storage refused: the sitting is stamped "warn", not persisted, with its free space', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const s = navigator.storage as unknown as Record<string, unknown>;
    s.persisted = async () => false;
    s.persist = async () => false;
    s.estimate = async () => ({ usage: 10 * 1024 * 1024, quota: 2058 * 1024 * 1024 });
  });
  const shown = await throughPreflight(page);
  expect(shown).toMatch(/Device storage\s*— warn/i);
  const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
  expect(s).toMatchObject({ storage_verdict: 'warn', storage_persisted: false, storage_free_mb: 2048 });
  expect(await exported(page, s.session_id as string, ['storage_verdict', 'storage_persisted', 'storage_free_mb'])).toEqual(['warn', 'false', '2048']);
});

test('a browser that cannot say: the sitting is stamped "unknown", with no grant and no free space', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const s = navigator.storage as unknown as Record<string, unknown>;
    s.persisted = undefined;
    s.persist = undefined;
    s.estimate = undefined;
  });
  const shown = await throughPreflight(page);
  expect(shown).toMatch(/Device storage\s*— unknown/i);
  const [s] = await dbAll<Record<string, unknown>>(page, 'sessions');
  expect(s).toMatchObject({ storage_verdict: 'unknown', storage_persisted: null, storage_free_mb: null });
  expect(await exported(page, s.session_id as string, ['storage_verdict', 'storage_persisted', 'storage_free_mb'])).toEqual(['unknown', '', '']);
});
