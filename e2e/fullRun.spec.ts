import { test, expect } from '@playwright/test';
import { stageNow, handleStage, startNewExperiment, dbCounts } from './helpers';
import { N_CONDITIONS } from '../src/experiment/conditions';
import { QUESTIONS_PER_PASSAGE } from '../src/experiment/passages';

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

  const c = await dbCounts(page, ['sessions', 'participants', 'conditions', 'rt_summaries', 'cvsq_scores', 'fatigue_scores', 'nasa_tlx', 'comprehension_results', 'display_perception', 'visual_search']);
  expect(c.sessions).toBeGreaterThanOrEqual(1);
  expect(c.participants).toBeGreaterThanOrEqual(1);
  // One illumination block = all 10 polarity x colour conditions.
  expect(c.conditions).toBe(N_CONDITIONS);
  expect(c.rt_summaries).toBe(N_CONDITIONS);
  expect(c.cvsq_scores).toBe(2); // baseline + session end
  expect(c.fatigue_scores).toBe(N_CONDITIONS + 1); // baseline + one per condition
  expect(c.nasa_tlx).toBe(1); // once per session, at close
  expect(c.display_perception).toBe(N_CONDITIONS);
  expect(c.visual_search).toBe(N_CONDITIONS);
  // The store whose cardinality changed from one-per-condition to one-per-ITEM. The driver in
  // helpers.ts answers items until the submit button reads "Submit answer", and that loop would
  // terminate just as happily after one item, so without this assertion a regression that
  // administered or persisted only the first item would leave the whole suite green.
  expect(c.comprehension_results).toBe(N_CONDITIONS * QUESTIONS_PER_PASSAGE);
  expect(errors).toEqual([]);
});
