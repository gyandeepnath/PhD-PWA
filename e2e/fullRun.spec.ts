import { test, expect } from '@playwright/test';
import { stageNow, handleStage, startNewExperiment, dbCounts } from './helpers';

/**
 * Full end-to-end run on the no-camera path (?e2e=1 fast timings). Drives every stage and asserts
 * the data landed in IndexedDB and the dashboard renders.
 */
test('full experiment run writes data and reaches the dashboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startNewExperiment(page);

  let guard = 0;
  for (;;) {
    if (guard++ > 500) throw new Error('stage loop did not terminate');
    const stage = await stageNow(page);
    if (await handleStage(page, stage)) break;
  }

  await expect(page.getByText('Analysis Dashboard')).toBeVisible();

  const c = await dbCounts(page, ['sessions', 'participants', 'conditions', 'rt_summaries', 'cvsq_scores', 'fatigue_scores']);
  expect(c.sessions).toBeGreaterThanOrEqual(1);
  expect(c.participants).toBeGreaterThanOrEqual(1);
  expect(c.conditions).toBe(8);
  expect(c.rt_summaries).toBe(8);
  expect(c.cvsq_scores).toBe(2);
  expect(c.fatigue_scores).toBe(9);
  expect(errors).toEqual([]);
});
