import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, stageNow, handleStage, setInput, validLux, dbAll } from './helpers';

/**
 * A participant's sitting that is still in progress is resumed, not started again (Round 87, audit 86
 * F3 and F2).
 *
 * The session form used to tell the operator "This sitting continues where they stopped" for a
 * participant whose sitting was paused, and let a NEW sitting begin — after their last completed
 * display. The paused sitting kept its Resume button, and resuming it ran the same displays again:
 * in the audit, positions 2-9 twice, eight passages read a second time and recorded as first readings.
 * The code is typed here as the tablet's keyboard tends to produce it — lower case, with the space a
 * suggestion leaves — because before audit 86 F2 that was a second participant, which no refusal for
 * "the same participant" could catch.
 */

test.use({ viewport: { width: 1152, height: 720 } });

async function driveTo(page: Page, target: string, participantId: string) {
  for (let i = 0; i < 600; i++) {
    const s = await stageNow(page);
    if (s === target) return;
    if (await handleStage(page, s, { participantId })) throw new Error(`completed before ${target}`);
  }
  throw new Error(`did not reach ${target}`);
}

test('a new sitting is refused while the participant’s earlier sitting is in progress; Resume carries it on', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Sitting 1 stopped at the first break, displays finished in it.
  await startNewExperiment(page);
  await driveTo(page, 'BREAK_SCREEN', 'DUP1');
  const doneBefore = (await dbAll<{ completed_at: number | null }>(page, 'conditions')).filter((c) => c.completed_at != null).length;
  expect(doneBefore).toBeGreaterThan(0);
  await page.getByTestId('nav-exit').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();

  // The same participant, typed as a keyboard types it.
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage="SESSION_INIT"]');
  await setInput(page, 'pid', 'dup1 ');
  await expect(page.getByTestId('pid')).toHaveValue('DUP1');
  const panel = page.getByTestId('sitting-in-progress');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(`${doneBefore} of 10 displays finished in it`);
  await setInput(page, 'lux', await validLux(page));
  await expect(page.getByRole('button', { name: /Begin setup/ })).toBeDisabled();
  await expect(page.getByTestId('begin-blocked')).toContainText(/cannot be started/);
  // The invitation that started the second sitting is gone.
  await expect(page.locator('#root')).not.toContainText(/continues where they stopped/);

  // The way back is the way to Resume it. (The form had something typed in it, so Cancel asks first.)
  await page.getByTestId('back-to-resume').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();
  expect((await dbAll(page, 'sessions')).length).toBe(1);

  await page.getByRole('button', { name: /^Resume/ }).first().click({ force: true });
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-stage]')?.getAttribute('data-stage');
    return !!s && s !== 'SESSION_INIT';
  }, null, { timeout: 20_000 });
  // The resumed sitting carries on: the next display is the first one not yet finished.
  await driveTo(page, 'READING_TASK', 'DUP1');
  await page.getByRole('button', { name: /Begin reading/ }).click({ force: true });
  await expect(page.getByTestId('reading-text')).toBeVisible();
  const conds = await dbAll<{ session_position: number; completed_at: number | null }>(page, 'conditions');
  const open = conds.filter((c) => c.completed_at == null).map((c) => c.session_position);
  expect(open).toEqual([doneBefore]);
  expect((await dbAll(page, 'sessions')).length).toBe(1);
  expect(errors).toEqual([]);
});

test('a sitting a later sitting of the same participant superseded is listed but not offered for resuming', async ({ page }) => {
  // The state F3 left on a device (or a restore from the bin can make): two sittings of one
  // participant in progress, the later started after the earlier one's last finished display.
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'DUP2' });
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const [first] = await new Promise<Record<string, unknown>[]>((res, rej) => {
      const q = db.transaction('sessions').objectStore('sessions').getAll();
      q.onsuccess = () => res(q.result as Record<string, unknown>[]);
      q.onerror = () => rej(q.error);
    });
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({
      ...first, session_id: 'later-sitting', session_index: 2,
      session_start_time: (first.session_start_time as number) + 60_000,
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  });
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  await expect(page.getByTestId('manager-scroll')).toBeVisible();
  // Two rows in progress; one Resume on the rows, and the earlier row says why it has none.
  await expect(page.getByTestId('row-note')).toHaveCount(1);
  await expect(page.getByTestId('row-note')).toContainText(/not resumable: sitting 2 of this participant/);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(1);
});
