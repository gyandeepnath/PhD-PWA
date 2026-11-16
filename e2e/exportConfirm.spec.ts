import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startNewExperiment, handleStage } from './helpers';
import { readZip } from '../src/lib/zipArchive';

/**
 * "Did every file arrive?" after a bundle export (audit 86 UI-11).
 *
 * It asked the operator to check "the receiving computer" while the files sat in the tablet's own
 * Downloads folder, and confirming is what later lets a deleted session be purged from the recycle
 * bin (storage/gather.ts purgeExpired). While it was open, "Download analysis dataset" read
 * "Building…" although nothing was being built: the export buttons shared one busy flag. This drives
 * the real dialog: what it says, the other button's label while it is open, and that only the
 * confirming answer records export_confirmed_at.
 *
 * ONE SITTING, ONE FILE (Round 97). The export is one archive named for the participant and the
 * sitting, holding the sitting's files in a folder of its own; "Download everything" is one archive of
 * every sitting, the pooled dataset and the analysis scripts. Both are opened here, as downloaded.
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

  const sent = page.waitForEvent('download');
  await bundle.click();
  const file = await sent;
  expect(file.suggestedFilename()).toMatch(/^visulab_XC01_[0-9a-f-]{8}\.zip$/);
  const inside = await readZip(new Uint8Array(readFileSync(await file.path())));
  const folder = file.suggestedFilename().replace(/^visulab_|\.zip$/g, '');
  expect(inside.length).toBe(23);
  expect(inside.every((e) => e.path.startsWith(`${folder}/`))).toBe(true);
  for (const name of ['01_session_info.csv', '02_conditions.csv', '00_CODEBOOK.csv', 'export_manifest.json']) {
    expect(inside.map((e) => e.path)).toContain(`${folder}/${name}`);
  }
  expect(new TextDecoder().decode(inside.find((e) => e.path.endsWith('/01_session_info.csv'))!.bytes)).toContain('XC01');

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("One file was sent to this tablet's Downloads folder");
  await expect(dialog).toContainText(file.suggestedFilename());
  await expect(dialog).toContainText("It holds this sitting's 23 files");
  // The sitting's integrity verdict, from the report inside the file just written.
  await expect(dialog).toContainText('Integrity check of this sitting:');
  await expect(page.getByTestId('export-integrity')).toContainText('Integrity check of this sitting:');
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

test('Download everything is one archive: every sitting, the pooled dataset and the analysis scripts', async ({ page }) => {
  test.setTimeout(120_000);
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'XE01' });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await expect(page.getByText('Analysis Dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();

  const sent = page.waitForEvent('download');
  await page.getByTestId('export-everything').click();
  const file = await sent;
  expect(file.suggestedFilename()).toMatch(/^visulab_everything_1sittings_[0-9a-f]{8}\.zip$/);
  await expect(page.getByTestId('export-everything-summary')).toContainText('1 sitting ·');
  await expect(page.getByTestId('export-everything')).toHaveText(/Download everything/);

  const paths = (await readZip(new Uint8Array(readFileSync(await file.path())))).map((e) => e.path);
  const sitting = paths.find((p) => /^data\/XE01_[0-9a-f-]{8}\/02_conditions\.csv$/.test(p));
  expect(sitting, 'the sitting is in data/<code>_<session>/').toBeTruthy();
  expect(paths.filter((p) => p.startsWith(sitting!.replace('02_conditions.csv', ''))).length).toBe(23);
  for (const p of ['START_HERE.txt', 'data/_pooled/analysis_long.csv', 'data/_pooled/analysis_join_report.csv',
    'analysis/READ_ME_FIRST.txt', 'analysis/run_analysis.R', 'analysis/analysis_template.R',
    'analysis/analysis_template.py', 'analysis/ANALYSIS_GUIDE.md']) {
    expect(paths).toContain(p);
  }
  // It marks nothing exported: the per-sitting question is what releases a sitting.
  expect(await confirmedAt(page, 'XE01')).toBeNull();
});

test('the separate files are still there for whoever wants them', async ({ page }) => {
  test.setTimeout(120_000);
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'XL01' });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await page.getByTestId('export-loose').click();
  const dialog = page.getByTestId('export-confirm-dialog');
  await expect(dialog).toContainText("23 files were sent to this tablet's Downloads folder");
  await expect.poll(() => names.length).toBe(23);
  expect(names).toContain('01_session_info.csv');
  expect(names.some((n) => n.endsWith('.zip'))).toBe(false);
  await dialog.getByTestId('confirm-cancel').click();
});
