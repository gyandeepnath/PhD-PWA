import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startNewExperiment } from './helpers';

/**
 * The All Participants tab with several participants (Round 98): averages by condition across
 * participants, the positive-minus-negative difference, and its trend as participants completed.
 *
 * Six simulated participants are written as the app's own backup files and restored through Session
 * Manager → Restore session from backup file, the path a lost tablet's data comes back by; then the
 * tab must show the three sections and update when a seventh participant is restored.
 */
const ROOT = process.cwd();

function writeBackups(dir: string, n: number): string[] {
  const script = join(dir, 'make.ts');
  writeFileSync(script, `
import { writeFileSync } from 'node:fs';
import { simulateCohort } from ${JSON.stringify(join(ROOT, 'src/sim/analysisCohort.ts'))};
import { backupExportFile } from ${JSON.stringify(join(ROOT, 'src/storage/export.ts'))};
for (const b of simulateCohort({ n: ${n}, seed: 9898, polarityEffectOnIncomplete: 0.4 })) {
  const f = backupExportFile(b);
  writeFileSync(${JSON.stringify(dir)} + '/' + f.filename, f.content);
}
`);
  execFileSync('npx', ['tsx', script], { cwd: ROOT, stdio: 'pipe' });
  return readdirSync(dir).filter((f) => f.startsWith('backup_')).sort().map((f) => join(dir, f));
}

test('All Participants: averages by condition, the polarity difference and its trend, updating with each participant', async ({ page }) => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(join(tmpdir(), 'visulab-cohort-'));
  try {
    const files = writeBackups(dir, 7);
    expect(files.length).toBe(7);
    await startNewExperiment(page);
    await page.goto('/?e2e=1');
    await page.getByRole('button', { name: /Enter Research Console/ }).click();
    await expect(page.getByTestId('manager-scroll')).toBeVisible();

    const restore = async (file: string) => {
      await page.getByTestId('import-backup-input').setInputFiles(file);
      const done = page.getByTestId('confirm-ok');
      await expect(done).toBeVisible({ timeout: 30_000 });
      await done.click();
    };
    for (const f of files.slice(0, 6)) await restore(f);

    const openCohort = async () => {
      await page.getByRole('button', { name: 'Completed', exact: false }).first().click().catch(() => {});
      await page.getByRole('button', { name: 'Open', exact: true }).first().click();
      await expect(page.getByText('Analysis Dashboard')).toBeVisible();
      await page.getByRole('button', { name: 'All Participants', exact: true }).click();
    };
    await openCohort();
    const section = page.getByTestId('cohort-outcomes');
    await expect(section).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('cohort-by-condition').locator('tbody tr')).toHaveCount(10);
    await expect(page.getByTestId('cohort-polarity').locator('tbody tr')).toHaveCount(7);
    await expect(section).toContainText('6 participants of the analysis set');
    // Every cell reads "mean [low, high] (n k)" or a dash; the primary's difference rests on six.
    await expect(page.getByTestId('cohort-polarity')).toContainText(/\[-?[\d.]+, -?[\d.]+\] \(n 6\)/);
    expect(await page.getByTestId('cohort-trend').count()).toBeGreaterThanOrEqual(5);
    await page.screenshot({ path: test.info().outputPath('cohort-6.png'), fullPage: false });

    // A seventh participant: back to the manager, restore, and the tab counts seven.
    await page.getByTestId('nav-sessions').click();
    await expect(page.getByTestId('manager-scroll')).toBeVisible();
    await restore(files[6]);
    await openCohort();
    await expect(page.getByTestId('cohort-outcomes')).toContainText('7 participants of the analysis set', { timeout: 60_000 });
    await expect(page.getByTestId('cohort-polarity')).toContainText(/\(n 7\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
