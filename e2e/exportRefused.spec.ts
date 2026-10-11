import { test, expect } from '@playwright/test';
import { startNewExperiment, handleStage } from './helpers';

/**
 * A sitting whose participant code the app could not have issued (Round 81).
 *
 * The export refuses such a sitting by name (storage/export.ts DamagedParticipantCodeError). Before
 * this round the refusal escaped onExport as an uncaught error: the operator saw only the red
 * "Something failed in the background" banner, the message asked them to keep a backup file that
 * nothing had written, and the sitting could be neither exported nor backed up from the app. Now the
 * dashboard says what happened in its own dialog and offers the backup file on its own.
 */
test('a damaged participant code: a plain dialog, and the backup file is still saved', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'XR00' });
  const sessionId = await page.evaluate(async () => {
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
    const s = rows.find((r) => r.participant_id === 'XR00')!;
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({ ...s, participant_id: 'X'.repeat(25) });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
    return s.session_id as string;
  });

  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await expect(page.getByTestId('manager-scroll')).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.getByText('Analysis Dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Download data bundle/ }).click();

  const dialog = page.getByTestId('export-refused-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('The data files were not written');
  await expect(dialog).toContainText('25 characters long');
  await expect(dialog).toContainText('You can still save the backup file');
  await expect(page.getByText('Something failed in the background')).toHaveCount(0);

  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save the backup file' }).click();
  expect((await download).suggestedFilename()).toMatch(/^backup_X+_[0-9a-f-]{8}\.json$/);
  await expect(page.getByText('Backup file sent to your downloads')).toBeVisible();

  // Not marked exported: the sitting stays protected from the automatic purge.
  const exportedAt = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const s = await new Promise<Record<string, unknown>>((res, rej) => {
      const q = db.transaction('sessions').objectStore('sessions').get(id);
      q.onsuccess = () => res(q.result as Record<string, unknown>);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return s.exported_at ?? null;
  }, sessionId);
  expect(exportedAt).toBeNull();
  expect(errors).toEqual([]);
});
