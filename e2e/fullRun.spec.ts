import { test, expect, type Page } from '@playwright/test';

/**
 * Full end-to-end run of the experiment on the no-camera path (?e2e=1 fast timings).
 * Drives every stage via a stage-keyed loop and waits for each transition, then asserts the data
 * landed in IndexedDB and the dashboard renders. Proves the stage machine, task UIs, scales,
 * screening and storage work together in a real browser.
 */

async function stageNow(page: Page): Promise<string> {
  return (await page.locator('[data-stage]').first().getAttribute('data-stage')) ?? '';
}

async function waitStageChange(page: Page, from: string) {
  await page.waitForFunction(
    (f) => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== f,
    from,
    { timeout: 30_000 },
  );
}

/** Set a text input (located by testid) and fire React's onChange — element-bound, never null. */
async function setInput(page: Page, testid: string, value: string) {
  await page.getByTestId(testid).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Set every range slider on screen to a value and fire React's onChange. */
async function setAllRanges(page: Page, value: number) {
  for (const r of await page.locator('input[type=range]').all()) {
    await r.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
}

async function checkAllBoxes(page: Page) {
  for (const box of await page.getByRole('checkbox').all()) await box.check({ force: true });
}

async function click(page: Page, name: RegExp | string) {
  const btn = page.getByRole('button', { name }).first();
  await expect(btn).toBeEnabled({ timeout: 15_000 });
  await btn.click({ force: true });
}

test('full experiment run writes data and reaches the dashboard', async ({ page }) => {
  const logs: string[] = [];
  page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));
  await page.goto('/?e2e=1');
  // Shell: Landing → Session Manager → New Session → experiment (data-stage appears).
  await page.getByRole('button', { name: /Enter Research Console/ }).click({ force: true });
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });

  let guard = 0;
  try {
    for (;;) {
      if (guard++ > 500) throw new Error('stage loop did not terminate');
      const stage = await stageNow(page);
      if (stage === 'EXPORT_DASHBOARD') break;
      await page.waitForTimeout(120); // let the just-mounted stage settle

      switch (stage) {
        case 'SESSION_INIT':
          await setInput(page, 'pid', 'E2E01');
          await setInput(page, 'lux', '350');
          await click(page, /Begin setup/);
          await waitStageChange(page, stage);
          break;
        case 'CONSENT':
          await checkAllBoxes(page);
          await click(page, /I consent/);
          await waitStageChange(page, stage);
          break;
        case 'PARTICIPANT_PROFILE':
          await setInput(page, 'age', '30');
          await setInput(page, 'hours', '6');
          await click(page, /^female$/);
          await click(page, /^high$/);
          await click(page, /^dim$/);
          await click(page, /^glasses$/);
          await click(page, /^no$/);
          await click(page, /Continue/);
          await waitStageChange(page, stage);
          break;
        case 'COLOR_VISION': {
          // One plate per click; loop until the stage changes.
          await page.getByRole('button', { name: '8', exact: true }).first().click({ force: true });
          break;
        }
        case 'PREFLIGHT':
          await checkAllBoxes(page);
          await click(page, /All checks pass/);
          await waitStageChange(page, stage);
          break;
        case 'CAMERA_SETUP':
          await click(page, /Continue without camera/);
          await waitStageChange(page, stage);
          break;
        case 'CALIBRATION':
          await click(page, /Continue|Record baseline/);
          await waitStageChange(page, stage);
          break;
        case 'CVSQ_BASELINE':
        case 'CVSQ_END':
          for (const b of await page.getByRole('button', { name: 'Never' }).all()) await b.click({ force: true });
          await click(page, /Continue/);
          await waitStageChange(page, stage);
          break;
        case 'BASELINE_FATIGUE':
        case 'POST_FATIGUE':
          await setAllRanges(page, 3);
          await click(page, /Continue/);
          await waitStageChange(page, stage);
          break;
        case 'READING_TASK':
          // Two pages; button unlocks after the short floor and the stage stays READING_TASK
          // until the last page, so don't wait for a stage change here.
          await click(page, /Next page|Finished reading/);
          await page.waitForTimeout(80);
          break;
        case 'COMPREHENSION':
          await page.getByTestId('mcq-option').first().click({ force: true });
          await click(page, /Submit answer/);
          await waitStageChange(page, stage);
          break;
        case 'DISPLAY_PERCEPTION':
          await setAllRanges(page, 70);
          await click(page, /Continue/);
          await waitStageChange(page, stage);
          break;
        case 'VISUAL_SEARCH':
          await click(page, /Done searching/);
          await waitStageChange(page, stage);
          break;
        case 'REACTION_TIME':
          await click(page, /Start/);
          await waitStageChange(page, stage);
          break;
        case 'ADAPTATION':
          await waitStageChange(page, stage);
          break;
        case 'SESSION_COMPLETE':
          await click(page, /view export dashboard|Continue/);
          await waitStageChange(page, stage);
          break;
        default:
          await page.waitForTimeout(100);
      }
    }
  } catch (err) {
    const stage = await stageNow(page).catch(() => 'NONE');
    const buttons = await page
      .evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => `[${(b as HTMLButtonElement).disabled ? 'D' : 'E'}] ${b.textContent?.trim()}`))
      .catch(() => []);
    console.log(`DIAG-FAIL guard=${guard} stage=${stage} buttons=${JSON.stringify(buttons)}`);
    console.log('LOGS:\n' + logs.slice(-12).join('\n'));
    throw err;
  }

  await expect(page.getByText('Analysis Dashboard')).toBeVisible();

  const counts = await page.evaluate(async () => {
    const open = () =>
      new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('VisualErgonomicsDB');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const db = await open();
    const count = (store: string) =>
      new Promise<number>((res, rej) => {
        const req = db.transaction(store).objectStore(store).count();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    return {
      sessions: await count('sessions'),
      participants: await count('participants'),
      conditions: await count('conditions'),
      rt: await count('rt_summaries'),
      cvsq: await count('cvsq_scores'),
      fatigue: await count('fatigue_scores'),
    };
  });

  expect(counts.sessions).toBeGreaterThanOrEqual(1);
  expect(counts.participants).toBeGreaterThanOrEqual(1);
  expect(counts.conditions).toBe(8);
  expect(counts.rt).toBe(8);
  expect(counts.cvsq).toBe(2);
  expect(counts.fatigue).toBe(9);
});
