import { test, expect } from '@playwright/test';
import { stageNow, startNewExperiment, driveUntil, dbCounts, click, validLux } from './helpers';

/** Edge / "unnatural scenario" E2E checks: invalid input gating, double-submit, reload + resume. */

test('SESSION_INIT gates on invalid input', async ({ page }) => {
  await startNewExperiment(page);
  expect(await stageNow(page)).toBe('SESSION_INIT');
  // Empty fields → Begin setup disabled.
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeDisabled();
  // Out-of-range lux → still disabled.
  await page.getByTestId('pid').fill('P9');
  await page.getByTestId('lux').fill('999999');
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeDisabled();
  // Valid → enabled. Taken from the assigned level's spec, never a literal: see validLux.
  await page.getByTestId('lux').fill(await validLux(page));
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeEnabled();
});

test('rapid double-click on Begin setup creates only one session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startNewExperiment(page);
  await page.getByTestId('pid').fill('DBL01');
  await page.getByTestId('lux').fill(await validLux(page));
  const btn = page.getByRole('button', { name: /Begin setup/ });
  await expect(btn).toBeEnabled();
  // Fire several clicks before the async session-create completes.
  await Promise.all([btn.click({ force: true }), btn.click({ force: true }), btn.click({ force: true })]);
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') === 'CONSENT', null, { timeout: 15_000 });
  const c = await dbCounts(page, ['sessions']);
  expect(c.sessions).toBe(1);
  expect(errors).toEqual([]);
});

test('reload mid-session offers resume and continues at a condition', async ({ page }) => {
  await startNewExperiment(page);
  // Drive setup until the first reading task of the first condition.
  await driveUntil(page, 'READING_TASK');
  expect(await stageNow(page)).toBe('READING_TASK');

  // Hard reload mid-session.
  await page.reload();

  // Shell restarts at the landing page; the in-progress session must be resumable.
  await click(page, /Enter Research Console/);
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
  await page.getByRole('button', { name: /Resume/ }).first().click({ force: true });

  // A resume re-enters the CAMERA path first, by design: the app remounts, so the participant's
  // own open-eye EAR baseline — which every blink threshold is a fraction of — is gone. Jumping
  // straight back into the reading task, as this used to, meant every condition after an
  // interruption was recorded with the camera off and no ocular data at all.
  await page.waitForSelector('[data-stage]', { timeout: 20_000 });
  await page.waitForFunction(
    () => {
      const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
      return s && s !== 'SESSION_INIT';
    },
    null,
    { timeout: 20_000 },
  );
  expect(await stageNow(page)).toBe('CAMERA_SETUP');

  // Record every stage the resume passes through. Sampling the landing stage cannot tell a resume
  // that went through the grey field from one that jumped straight into reading: under ?e2e the
  // field lasts milliseconds, so both are found at READING_TASK a moment later.
  await page.evaluate(() => {
    const w = window as unknown as { __stages: string[] };
    w.__stages = [];
    const rec = () => {
      const st = document.querySelector('[data-stage]')?.getAttribute('data-stage');
      if (st && w.__stages[w.__stages.length - 1] !== st) w.__stages.push(st);
    };
    new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage'] });
    rec();
  });

  // Through camera setup and calibration, the run must land back in the CONDITION LOOP — not at
  // the baseline questionnaires, and not at condition 1 of a session already under way.
  await click(page, /Continue without camera/);
  await page.waitForFunction(
    () => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CAMERA_SETUP',
    null,
    { timeout: 20_000 },
  );
  if (await stageNow(page) === 'CALIBRATION') {
    await click(page, /Continue|Record baseline/);
    await page.waitForFunction(
      () => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'CALIBRATION',
      null,
      { timeout: 20_000 },
    );
  }
  const stage = await stageNow(page);
  // ADAPTATION is the expected landing stage, not an alternative to tolerate: a resume now
  // re-enters the loop through the grey field so the resumed condition gets the same controlled
  // adaptation every other condition gets, instead of starting from whatever the participant was
  // looking at across the interruption. The measured stages stay in the list because this
  // assertion is about being back in the LOOP, and a slower machine may already have advanced.
  expect(['ADAPTATION', 'READING_TASK', 'COMPREHENSION', 'DISPLAY_PERCEPTION']).toContain(stage);
  // Specifically NOT back into setup: re-administering the baseline CVS-Q and baseline fatigue
  // would destroy the two measurements every change score is computed FROM.
  expect(['CVSQ_BASELINE', 'BASELINE_FATIGUE', 'INSTRUCTIONS']).not.toContain(stage);

  // And the resumed condition was preceded by the grey field. The camera-path resume used to jump
  // from calibration straight to READING_TASK; see loopEntry in stateMachine.ts.
  await page.waitForFunction(() => {
    const st = (window as unknown as { __stages: string[] }).__stages;
    return st.includes('READING_TASK');
  }, null, { timeout: 20_000 });
  const stages = await page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);
  const reading = stages.indexOf('READING_TASK');
  expect(stages.slice(0, reading), `stages before the resumed condition: ${stages.join(' > ')}`).toContain('ADAPTATION');
  expect(stages[reading - 1]).toBe('ADAPTATION');

  // The session remains a single in-progress record (no duplicate from resume).
  const c = await dbCounts(page, ['sessions']);
  expect(c.sessions).toBe(1);
});

test('a withdrawn sitting is no longer resumable and says so on the dashboard', async ({ page }) => {
  await startNewExperiment(page);
  await driveUntil(page, 'READING_TASK');
  await page.reload();
  await click(page, /Enter Research Console/);
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Resume/ }).first()).toBeVisible();

  // Accept the confirmation, then the report alert.
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Withdrew' }).first().click();

  // Resuming a withdrawn sitting used to be offered and collected data after consent was withdrawn.
  await expect(page.getByText(/Withdrawn \(1\)/)).toBeVisible();
  await expect(page.getByText(/In progress \(0\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Resume/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Export' }).first().click();
  await expect(page.getByTestId('withdrawn-banner')).toBeVisible();
});

test('a resume between the two baselines does not re-administer the CVS-Q', async ({ page }) => {
  await startNewExperiment(page);
  // The baseline CVS-Q is saved; the baseline fatigue scale is on screen and not yet answered.
  await driveUntil(page, 'BASELINE_FATIGUE');
  await page.reload();
  await click(page, /Enter Research Console/);
  await page.getByRole('button', { name: /^Resume/ }).first().click({ force: true });
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
    return s && s !== 'SESSION_INIT';
  }, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __stages: string[] };
    w.__stages = [];
    const rec = () => {
      const st = document.querySelector('[data-stage]')?.getAttribute('data-stage');
      if (st && w.__stages[w.__stages.length - 1] !== st) w.__stages.push(st);
    };
    new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage'] });
    rec();
  });
  await driveUntil(page, 'READING_TASK');
  const stages = await page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);
  // It walked the camera path and took the fatigue baseline it owed — and not the CVS-Q it held.
  expect(stages, stages.join(' > ')).toContain('BASELINE_FATIGUE');
  expect(stages, stages.join(' > ')).not.toContain('CVSQ_BASELINE');
  const baselines = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = (store: string) => new Promise<{ stage: string; condition_id?: string | null }[]>((res, rej) => {
      const q = db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    return {
      cvsq: (await all('cvsq_scores')).filter((r) => r.stage === 'baseline').length,
      fatigue: (await all('fatigue_scores')).filter((r) => r.stage === 'baseline' && r.condition_id == null).length,
    };
  });
  expect(baselines).toEqual({ cvsq: 1, fatigue: 1 });
});
