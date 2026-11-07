import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, handleStage } from './helpers';

/**
 * "Did every file arrive?" after a bundle export (audit 86 UI-11).
 *
 * It asked the operator to check "the receiving computer" while the files sat in the tablet's own
 * Downloads folder, and confirming is what later lets a deleted session be purged from the recycle
 * bin (storage/gather.ts purgeExpired). While it was open, "Download analysis dataset" read
 * "Building…" although nothing was being built: the export buttons shared one busy flag. This drives
 * the real dialog: what it says, the other button's label while it is open, and that only the
 * confirming answer records export_confirmed_at.
 */
async function confirmedAt(page: Page, participant: string): Promise<number | null> {
  return page.evaluate(async (pid) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise<Record<string, unknown>[]>((res, rej) => {
      const q = db.transaction('sessions').objectStore('sessions').getAll();
      q.onsuccess = () => res(q.result as Record<string, unknown>[]);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return (rows.find((r) => r.participant_id === pid)?.export_confirmed_at as number | null | undefined) ?? null;
  }, participant);
}

test('the export question asks about the files copied off the tablet, and only its yes is recorded', async ({ page }) => {
  test.setTimeout(120_000);
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'XC01' });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await expect(page.getByTestId('manager-scroll')).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.getByText('Analysis Dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();

  const bundle = page.locator('button', { hasText: /Download data bundle|Exporting/ });
  const analysis = page.locator('button', { hasText: /Download analysis dataset|Building/ });
  const dialog = page.getByTestId('export-confirm-dialog');

  await bundle.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("files were sent to this tablet's Downloads folder");
  await expect(dialog).toContainText('copied off this tablet');
  await expect(dialog).toContainText('purged 30 days later only if its export was confirmed here');
  await expect(dialog).not.toContainText('receiving computer');
  // The bundle's button says what it is doing; the analysis button, which is doing nothing, does not.
  await expect(bundle).toHaveText(/Exporting/);
  await expect(analysis).toHaveText(/Download analysis dataset/);
  await expect(analysis).toBeDisabled();

  await dialog.getByTestId('confirm-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(bundle).toHaveText(/Download data bundle/);
  expect(await confirmedAt(page, 'XC01')).toBeNull();

  await bundle.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('confirm-ok')).toHaveText('Copied off and checked');
  await dialog.getByTestId('confirm-ok').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => confirmedAt(page, 'XC01')).not.toBeNull();
});
