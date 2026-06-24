import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { stageNow, handleStage } from './helpers';

/** Capture a screenshot of every distinct screen for a manual UI/UX review. Not an assertion test. */
test('capture screens', async ({ page }) => {
  const dir = '/tmp/shots';
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async (name: string) => {
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/${String(n).padStart(2, '0')}_${name}.png` });
    n++;
  };

  await page.goto('/?e2e=1');
  await shot('landing');
  await page.getByRole('button', { name: /Enter Research Console/ }).click({ force: true });
  await shot('manager');
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });

  const seen = new Set<string>();
  let guard = 0;
  for (;;) {
    if (guard++ > 120) break;
    const stage = await stageNow(page);
    if (stage === 'EXPORT_DASHBOARD') {
      await shot('EXPORT_DASHBOARD');
      break;
    }
    // Screenshot first visit of each stage (and the reading page, captured on 2nd reading visit).
    const key = stage + (stage === 'READING_TASK' && seen.has('READING_TASK') ? '_page' : '');
    if (!seen.has(key)) {
      await shot(key);
      seen.add(key);
    }
    seen.add(stage);
    await handleStage(page, stage);
  }
});
