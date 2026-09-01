import { expect, type Page } from '@playwright/test';

/** Shared E2E interaction helpers + a stage-keyed driver, reused by full-run and edge specs. */

export async function stageNow(page: Page): Promise<string> {
  return (await page.locator('[data-stage]').first().getAttribute('data-stage')) ?? '';
}

export async function waitStageChange(page: Page, from: string) {
  await page.waitForFunction(
    (f) => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== f,
    from,
    { timeout: 30_000 },
  );
}

export async function setInput(page: Page, testid: string, value: string) {
  await page.getByTestId(testid).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

export async function setAllRanges(page: Page, value: number) {
  for (const r of await page.locator('input[type=range]').all()) {
    await r.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
}

export async function checkAllBoxes(page: Page) {
  for (const box of await page.getByRole('checkbox').all()) await box.check({ force: true });
}

export async function click(page: Page, name: RegExp | string) {
  const btn = page.getByRole('button', { name }).first();
  await expect(btn).toBeEnabled({ timeout: 15_000 });
  await btn.click({ force: true });
}

/** Enter the console and start a fresh experiment (data-stage appears). */
export async function startNewExperiment(page: Page) {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click({ force: true });
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });
}

/** Perform the appropriate action for the current stage. Returns true if the run is complete. */
export async function handleStage(page: Page, stage: string, opts: { split?: boolean; participantId?: string } = {}): Promise<boolean> {
  if (stage === 'EXPORT_DASHBOARD') return true;
  await page.waitForTimeout(120);
  // Re-read the stage after settling. The caller sampled it before this await, and a stage whose
  // handler advances asynchronously can move on in between - leaving the driver acting on a screen
  // that is no longer rendered. Bailing out lets the loop re-dispatch against the current stage
  // instead of timing out on a control that has already gone.
  if ((await stageNow(page)) !== stage) return false;
  switch (stage) {
    case 'SESSION_INIT':
      await setInput(page, 'pid', opts.participantId ?? 'E2E01');
      // The illumination level is ASSIGNED by counterbalancing once the id is entered, and the lux
      // reading must land inside that level's accepted range. Read the assignment off the screen
      // and supply a matching value, rather than hard-coding one that only fits one level.
      await page.waitForTimeout(150);
      {
        const assignedDim = (await page.getByText(/Dim \(/).count()) > 0;
        await setInput(page, 'lux', assignedDim ? '10' : '150');
      }
      if (opts.split) await click(page, /^split$/);
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
      // Two no/yes groups: colour-vision self-report (first) and caffeine (second). Between them
      // sits the operator's formal colour-vision plate result, which is what actually excludes —
      // the app's own digital screen is a covariate only.
      await page.getByRole('button', { name: /^no$/ }).first().click({ force: true });
      await click(page, /^normal$/);
      await page.getByRole('button', { name: /^no$/ }).nth(1).click({ force: true });
      await setInput(page, 'since-sleep', '3');
      await click(page, /Continue/);
      await waitStageChange(page, stage);
      break;
    case 'COLOR_VISION':
      // One plate per dispatch: the screen shows five in sequence, so the driver loops back here
      // until the last is answered. The stale-stage guard at the top of handleStage is what stops
      // it from clicking into the NEXT screen once the final plate advances.
      await page.getByRole('button', { name: '8', exact: true }).first().click({ force: true });
      break;
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
      // The zero-frequency option is labelled per stage: "Never" at baseline, which carries the
      // validated habitual frame, and "Not at all" at the close, which is re-anchored to the
      // session just completed.
      {
        const zero = stage === 'CVSQ_BASELINE' ? 'Never' : 'Not at all';
        for (const b of await page.getByRole('button', { name: zero, exact: true }).all()) {
          await b.click({ force: true });
        }
      }
      await click(page, /Continue/);
      await waitStageChange(page, stage);
      break;
    case 'NASA_TLX':
      // Must differ from the component's 50 default: React suppresses onChange when the value is
      // unchanged, so the touched flags would never set and submit would stay disabled.
      await setAllRanges(page, 65);
      await click(page, /Continue/);
      await waitStageChange(page, stage);
      break;
    case 'BASELINE_FATIGUE':
    case 'POST_FATIGUE':
      await setAllRanges(page, 3);
      await click(page, /Continue/);
      await waitStageChange(page, stage);
      break;
    case 'INSTRUCTIONS':
      await click(page, /start the first display/);
      await waitStageChange(page, stage);
      break;
    case 'READING_TASK': {
      // Intro screen first, then the reading footer (button appears after the min-dwell countdown).
      const begin = page.getByRole('button', { name: /Begin reading/ });
      if (await begin.count()) {
        await begin.first().click({ force: true });
        await page.waitForTimeout(60);
      } else {
        await click(page, /Next page|finished reading/i);
        await page.waitForTimeout(80);
      }
      break;
    }
    case 'COMPREHENSION': {
      // Three items run inside this one stage. Only the last one advances the experiment, so the
      // intermediate submits must NOT wait for a stage change; answer until the final item, which
      // is the one whose button reads "Submit answer" rather than "Submit and continue".
      for (let guard = 0; guard < 8; guard++) {
        await page.getByTestId('mcq-option').first().click({ force: true });
        const isLast = await page.getByRole('button', { name: /Submit answer/ }).count() > 0;
        if (isLast) {
          await click(page, /Submit answer/);
          await waitStageChange(page, stage);
          break;
        }
        const q = await page.getByTestId('mcq-question').textContent();
        await click(page, /Submit and continue/);
        // Wait for the NEXT item to mount, identified by its text changing.
        await page.waitForFunction(
          (prev) => document.querySelector('[data-testid="mcq-question"]')?.textContent !== prev,
          q, { timeout: 15_000 },
        );
      }
      break;
    }
    case 'DISPLAY_PERCEPTION':
      await setAllRanges(page, 70);
      await click(page, /Continue/);
      await waitStageChange(page, stage);
      break;
    case 'VISUAL_SEARCH': {
      const beginSearch = page.getByRole('button', { name: /Begin search/ });
      if (await beginSearch.count()) {
        await beginSearch.first().click({ force: true });
        await page.waitForTimeout(60);
      } else {
        await click(page, /Done searching/);
        await waitStageChange(page, stage);
      }
      break;
    }
    case 'REACTION_TIME':
      await click(page, /Start/);
      await waitStageChange(page, stage);
      break;
    case 'ADAPTATION':
      await waitStageChange(page, stage);
      break;
    case 'BREAK_SCREEN':
      await click(page, /continue/i);
      await waitStageChange(page, stage);
      break;
    case 'SESSION_COMPLETE':
      await click(page, /view export dashboard|Continue/);
      await waitStageChange(page, stage);
      break;
    default:
      await page.waitForTimeout(100);
  }
  return false;
}

/** Drive the run until a target stage is reached (or completion). */
export async function driveUntil(page: Page, target: string, maxSteps = 500): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const stage = await stageNow(page);
    if (stage === target) return;
    if (await handleStage(page, stage)) throw new Error(`reached completion before ${target}`);
  }
  throw new Error(`did not reach ${target} within ${maxSteps} steps`);
}

/** Read IndexedDB store counts from the page. */
export async function dbCounts(page: Page, stores: string[]): Promise<Record<string, number>> {
  return page.evaluate(async (storeNames) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const out: Record<string, number> = {};
    for (const s of storeNames) {
      out[s] = await new Promise<number>((res, rej) => {
        const req = db.transaction(s).objectStore(s).count();
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    }
    return out;
  }, stores);
}
