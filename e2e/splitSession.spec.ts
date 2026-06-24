import { test, expect } from '@playwright/test';
import { stageNow, handleStage, startNewExperiment, dbCounts } from './helpers';

/**
 * Split-session run: two sittings of 4 conditions for ONE participant complete all 8 conditions.
 * Verifies the enrolment-reuse + condition-offset logic — sitting 2 (re-entered with the same
 * participant ID) picks up where sitting 1 left off, so the participant runs each condition once.
 */
test('split session: two sittings of 4 cover all 8 conditions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const PID = 'SPLIT1';

  const drive = async () => {
    let guard = 0;
    for (;;) {
      if (guard++ > 500) throw new Error('stage loop did not terminate');
      const stage = await stageNow(page);
      if (await handleStage(page, stage, { split: true, participantId: PID })) break;
    }
  };

  // --- Sitting 1: conditions 1-4 ---
  await startNewExperiment(page);
  await drive();
  await expect(page.getByText('Analysis Dashboard')).toBeVisible();
  let c = await dbCounts(page, ['sessions', 'conditions']);
  expect(c.sessions).toBe(1);
  expect(c.conditions).toBe(4);

  // --- Back to the manager, start sitting 2 with the SAME participant id ---
  await page.getByRole('button', { name: /Sessions/ }).click({ force: true });
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });
  await drive();
  await expect(page.getByText('Analysis Dashboard')).toBeVisible();

  // Two sittings, eight conditions total (4 + 4), no duplicates.
  c = await dbCounts(page, ['sessions', 'conditions', 'cvsq_scores']);
  expect(c.sessions).toBe(2);
  expect(c.conditions).toBe(8);
  expect(c.cvsq_scores).toBe(4); // baseline + end per sitting
  expect(errors).toEqual([]);
});
