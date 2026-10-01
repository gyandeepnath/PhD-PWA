import { test, expect, type Page } from '@playwright/test';
import { stageNow, startNewExperiment, driveUntil, handleStage, setInput, click, waitStageChange, dbCounts } from './helpers';

/**
 * The operator's way back and way out of setup, and what each leaves in the database.
 *
 * Round 62: setup had no Back, no Cancel and no exit — a mistyped profile could not be corrected, the
 * camera grant could not be changed although CameraDeclined said that "means going back to consent",
 * and stopping meant closing the app. experiment/navigation.ts is the policy; these check that every
 * route it allows leaves the records a straight run would have left: no second session, no second
 * participant row, no questionnaire asked twice, and a changed consent kept on the record.
 *
 * Clicks here are NOT forced, unlike the full-run driver: every control must be reachable by a finger.
 */

type Row = Record<string, unknown>;
async function all(page: Page, store: string): Promise<Row[]> {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise<Record<string, unknown>[]>((res, rej) => {
      const q = db.transaction(name).objectStore(name).getAll();
      q.onsuccess = () => res(q.result as Record<string, unknown>[]);
      q.onerror = () => rej(q.error);
    });
  }, store);
}

/** Record every stage the app passes through from now on. */
async function recordStages(page: Page) {
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
}
const stagesSeen = (page: Page) => page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);

async function fillProfile(page: Page, opts: { age: string; cvd: 'no' | 'yes' }) {
  await setInput(page, 'age', opts.age);
  await setInput(page, 'hours', '6');
  await click(page, /^female$/);
  await click(page, /^high$/);
  await click(page, /^dim$/);
  await click(page, /^glasses$/);
  await page.getByRole('button', { name: new RegExp(`^${opts.cvd}$`) }).first().click();
  await click(page, /^normal$/);
  await page.getByRole('button', { name: /^no$/ }).nth(1).click();
  await setInput(page, 'since-sleep', '3');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1152, height: 720 });
});

test('Cancel on the session form writes nothing, and asks first only when something was typed', async ({ page }) => {
  await startNewExperiment(page);
  expect(await stageNow(page)).toBe('SESSION_INIT');
  const cancel = page.getByTestId('nav-cancel');
  await expect(cancel).toBeInViewport();
  // A 44 CSS px target on the device, whatever the display scale.
  const box = (await cancel.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(43.5);
  expect(box.x).toBeLessThan(20);
  expect(box.y).toBeLessThan(20);

  // Empty form: straight back to the manager.
  await cancel.click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();

  // Typed form: asks, and "Keep editing" keeps it.
  await page.getByRole('button', { name: /New Session/ }).click();
  await page.waitForSelector('[data-stage="SESSION_INIT"]');
  await page.getByTestId('pid').fill('CAN01');
  await page.getByTestId('nav-cancel').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Nothing has been saved yet');
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByTestId('pid')).toHaveValue('CAN01');
  await page.getByTestId('nav-cancel').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();

  expect((await dbCounts(page, ['sessions'])).sessions).toBe(0);
});

test('Back from pre-flight corrects the profile: the answers come back filled in, and the correction replaces them', async ({ page }) => {
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'BACK01' });
  await handleStage(page, 'CONSENT');
  expect(await stageNow(page)).toBe('PARTICIPANT_PROFILE');
  // A mistyped age and a mis-tapped colour-vision self-report.
  await fillProfile(page, { age: '34', cvd: 'yes' });
  await click(page, /^Continue/);
  await waitStageChange(page, 'PARTICIPANT_PROFILE');
  expect(await stageNow(page)).toBe('PREFLIGHT');
  let p = (await all(page, 'participants'))[0];
  expect(p.age).toBe(34);
  expect(p.cvd_status).toBe('self_reported_deficient');

  const back = page.getByTestId('back-to-profile');
  await back.scrollIntoViewIfNeeded();
  await back.click();
  await page.waitForSelector('[data-stage="PARTICIPANT_PROFILE"]');
  // Filled in with what was submitted, not blank.
  await expect(page.getByTestId('age')).toHaveValue('34');
  await setInput(page, 'age', '24');
  await page.getByRole('button', { name: /^no$/ }).first().click();
  await click(page, /^Continue/);
  await waitStageChange(page, 'PARTICIPANT_PROFILE');
  expect(await stageNow(page)).toBe('PREFLIGHT');

  const rows = await all(page, 'participants');
  expect(rows).toHaveLength(1);
  p = rows[0];
  expect(p.age).toBe(24);
  // The self-report is sticky ACROSS sittings; a correction within this one replaces it.
  expect(p.cvd_status).toBe('normal');
  expect((await dbCounts(page, ['sessions'])).sessions).toBe(1);
});

test('Back to consent from the camera screen changes the grant, keeps the old one on record, and returns straight to the camera', async ({ page }) => {
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'CONS01' });
  // Participation only: the camera is declined.
  await page.getByTestId('consent-core').check();
  await click(page, /I consent/);
  await waitStageChange(page, 'CONSENT');
  await driveUntil(page, 'CAMERA_SETUP');
  await expect(page.getByRole('heading', { name: 'Camera measurement declined' })).toBeVisible();
  await recordStages(page);

  await page.getByTestId('back-to-consent').click();
  await page.waitForSelector('[data-stage="CONSENT"]');
  // Re-presented afresh: every option unticked, as the first time.
  await expect(page.getByTestId('consent-camera')).not.toBeChecked();
  await page.getByTestId('consent-core').check();
  await page.getByTestId('consent-camera').check();
  await click(page, /I consent/);
  await waitStageChange(page, 'CONSENT');

  // Straight back to the camera screen — now the real one, since the grant is given.
  expect(await stageNow(page)).toBe('CAMERA_SETUP');
  await expect(page.getByRole('button', { name: /Enable camera/ })).toBeVisible();
  const seen = await stagesSeen(page);
  expect(seen, seen.join(' > ')).toEqual(['CAMERA_SETUP', 'CONSENT', 'CAMERA_SETUP']);

  const [s] = await all(page, 'sessions');
  expect((s.media_consent as Row).camera_metrics).toBe(true);
  const revisions = s.consent_revisions as Row[];
  expect(revisions).toHaveLength(1);
  expect((revisions[0].media_consent as Row).camera_metrics).toBe(false);
  expect(typeof revisions[0].superseded_at).toBe('number');
  // Nothing duplicated: one sitting, one participant, and the colour-vision screen ran once.
  expect((await dbCounts(page, ['sessions', 'participants'])).sessions).toBe(1);
  expect((await all(page, 'participants'))).toHaveLength(1);
});

test('no Exit while a colour-vision plate is showing; it returns on the next screen', async ({ page }) => {
  await startNewExperiment(page);
  await driveUntil(page, 'COLOR_VISION');
  await expect(page.getByTestId('cv-digits')).toBeVisible();
  await expect(page.getByTestId('nav-exit')).toHaveCount(0);
  await driveUntil(page, 'CAMERA_SETUP');
  await expect(page.getByTestId('nav-exit')).toBeVisible();
});

test('Exit — resume later from setup leaves one resumable sitting, and the resume shows the instructions before the first display', async ({ page }) => {
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'EXIT01' });
  await driveUntil(page, 'CVSQ_BASELINE');
  const exit = page.getByTestId('nav-exit');
  await expect(exit).toHaveText('Exit — resume later');
  await exit.click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Everything completed so far is saved');
  // Staying costs nothing.
  await page.getByTestId('confirm-cancel').click();
  expect(await stageNow(page)).toBe('CVSQ_BASELINE');
  await exit.click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();

  await page.getByRole('button', { name: /^Resume →/ }).click();
  await page.waitForSelector('[data-stage]');
  await page.waitForFunction(() => document.querySelector('[data-stage]')?.getAttribute('data-stage') !== 'SESSION_INIT');
  await recordStages(page);
  await driveUntil(page, 'READING_TASK');
  const seen = await stagesSeen(page);
  // The camera path is re-run (consented), then the questionnaires still owed, then the overview.
  expect(seen, seen.join(' > ')).toContain('CVSQ_BASELINE');
  expect(seen.indexOf('INSTRUCTIONS'), seen.join(' > ')).toBeGreaterThan(seen.indexOf('BASELINE_FATIGUE'));
  expect(seen.indexOf('ADAPTATION'), seen.join(' > ')).toBeGreaterThan(seen.indexOf('INSTRUCTIONS'));
  // Nothing set up twice: the consent, profile and screening screens are not in the walk.
  for (const s of ['CONSENT', 'PARTICIPANT_PROFILE', 'PREFLIGHT', 'COLOR_VISION']) expect(seen, s).not.toContain(s);
  const c = await dbCounts(page, ['sessions', 'participants', 'cvsq_scores', 'fatigue_scores']);
  expect(c).toEqual({ sessions: 1, participants: 1, cvsq_scores: 1, fatigue_scores: 1 });
});

test('a second sitting stopped on its profile resumes ON the profile, and records that sitting\'s own answers', async ({ page }) => {
  /*
   * The profile used to count as done once a participant record existed — and the record is created
   * by the FIRST sitting and shared by the second. So sitting 2, left on its profile with "Exit —
   * resume later", resumed at pre-flight and never recorded its own caffeine, hours since waking,
   * correction or colour-vision answers. The colour-vision plates had the same flaw.
   */
  test.setTimeout(400_000);
  const PID = 'SPLITX';
  await startNewExperiment(page);
  // Sitting 1 of a split, driven to its end.
  for (let guard = 0; ; guard++) {
    if (guard > 600) throw new Error('sitting 1 did not finish');
    if (await handleStage(page, await stageNow(page), { split: true, participantId: PID })) break;
  }
  const [one] = await all(page, 'sessions');
  expect(one.status).toBe('complete');

  // Sitting 2, same participant: consent, then stopped on the profile.
  await page.getByTestId('nav-sessions').click();
  await page.getByRole('button', { name: /New Session/ }).click();
  await page.waitForSelector('[data-stage="SESSION_INIT"]');
  await handleStage(page, 'SESSION_INIT', { split: true, participantId: PID });
  await handleStage(page, 'CONSENT');
  expect(await stageNow(page)).toBe('PARTICIPANT_PROFILE');
  await page.getByTestId('nav-exit').click();
  await page.getByTestId('confirm-ok').click();
  await page.getByRole('button', { name: /^Resume →/ }).click();
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
    return s && s !== 'SESSION_INIT';
  });
  // The first setup screen this sitting has not completed — the profile, not pre-flight.
  expect(await stageNow(page)).toBe('PARTICIPANT_PROFILE');
  await recordStages(page);

  // This sitting's answers, chosen to differ from sitting 1's (glasses, no caffeine, 3 h awake).
  await setInput(page, 'age', '30');
  await setInput(page, 'hours', '6');
  for (const name of ['female', 'high', 'dim', 'none', 'normal']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByRole('button', { name: 'no', exact: true }).first().click();
  await page.getByRole('button', { name: 'yes', exact: true }).nth(1).click();
  await setInput(page, 'since-sleep', '9');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await waitStageChange(page, 'PARTICIPANT_PROFILE');
  await driveUntil(page, 'CAMERA_SETUP');
  const seen = await stagesSeen(page);
  // And this sitting's own colour-vision plates, which sitting 1's result no longer stands in for.
  expect(seen, seen.join(' > ')).toEqual(['PARTICIPANT_PROFILE', 'PREFLIGHT', 'COLOR_VISION', 'CAMERA_SETUP']);

  const sittings = await all(page, 'sessions');
  expect(sittings).toHaveLength(2);
  const two = sittings.find((s) => s.session_index === 2)!;
  expect(two.caffeine_today).toBe(true);
  expect(two.hours_since_sleep).toBe(9);
  expect(two.colour_vision_screened).toBe(true);
  // Sitting 1 keeps its own state pair.
  expect(sittings.find((s) => s.session_index === 1)!.caffeine_today).toBe(false);
  const people = await all(page, 'participants');
  expect(people).toHaveLength(1);
  expect(people[0].correction_type).toBe('none');
});

test('Pause inside a condition confirms in the condition\'s own ink; Keep going carries on, Pause and exit leaves', async ({ page }) => {
  await startNewExperiment(page);
  await driveUntil(page, 'READING_TASK');
  await page.getByRole('button', { name: /Begin reading/ }).click();
  // The in-loop Pause keeps its original look and place.
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeVisible();
  await pause.click();
  const dialog = page.getByTestId('pause-dialog');
  await expect(dialog).toContainText('This condition will be restarted on resume');
  const colours = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="pause-dialog"] > div') as HTMLElement;
    const text = document.querySelector('[data-testid="reading-text"]') as HTMLElement;
    const overlay = document.querySelector('[data-testid="pause-dialog"]') as HTMLElement;
    return {
      card: getComputedStyle(card).backgroundColor, cardInk: getComputedStyle(card).color,
      page: getComputedStyle(text.closest('.screen') as HTMLElement).backgroundColor,
      pageInk: getComputedStyle(text).color, scrim: getComputedStyle(overlay).backgroundColor,
    };
  });
  // No colour the condition does not already have, and no dimming scrim over the stimulus.
  expect(colours.card).toBe(colours.page);
  expect(colours.cardInk).toBe(colours.pageInk);
  expect(colours.scrim).toBe('rgba(0, 0, 0, 0)');
  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(await stageNow(page)).toBe('READING_TASK');

  await pause.click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
});

test('a sitting left on the NASA-TLX resumes on the NASA-TLX: the closing CVS-Q is not asked twice', async ({ page }) => {
  test.setTimeout(300_000);
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'TLX01', split: true });
  await driveUntil(page, 'NASA_TLX', 800);
  expect((await all(page, 'cvsq_scores')).filter((r) => r.stage === 'session_end')).toHaveLength(1);
  await page.getByTestId('nav-exit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('closing questionnaire not yet answered');
  await page.getByTestId('confirm-ok').click();
  await page.getByRole('button', { name: /^Resume →/ }).click();
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
    return s && s !== 'SESSION_INIT';
  });
  expect(await stageNow(page)).toBe('NASA_TLX');
  await handleStage(page, 'NASA_TLX');
  expect((await all(page, 'cvsq_scores')).filter((r) => r.stage === 'session_end')).toHaveLength(1);
  const [s] = await all(page, 'sessions');
  expect(s.status).toBe('complete');
});

test('the break names the display that comes next, and its way out is the shared chip', async ({ page }) => {
  await startNewExperiment(page);
  await driveUntil(page, 'BREAK_SCREEN');
  const label = page.getByTestId('progress-label');
  await expect(label).toContainText('Break · Next: Display 3 of 10');
  await expect(page.locator('p', { hasText: /completed 2 of 10/ })).toBeVisible();
  await expect(page.getByTestId('nav-exit')).toBeVisible();
  // The old white Pause chip is gone from the break.
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.getByTestId('nav-exit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('The display just finished is saved');
  await page.getByTestId('confirm-cancel').click();
  expect(await stageNow(page)).toBe('BREAK_SCREEN');
});
