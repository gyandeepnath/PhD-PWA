/**
 * The enrolment number is spent when the participant consents, not at "Begin setup" (audit 86 F17).
 *
 * The number fixes the condition order (the Williams row), the passage rotation and the annotation-video
 * subsample, and the device's counter only goes up. It was allocated at Begin setup, so a code typed
 * wrong and noticed on the consent screen — the audit typed "P0O1" for "P001" — or a person who declined
 * consent spent a number nobody would use: a permanent gap in the counterbalancing sequence.
 */
import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, handleStage, stageNow, dbAll } from './helpers';

type Sitting = { participant_id: string; enrolment_number: number; consent_given: boolean; deleted_at: number | null };

async function counter(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('VisualErgonomicsDB'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return new Promise<number | null>((res) => {
      const q = db.transaction('meta').objectStore('meta').get('enrolment_counter');
      q.onsuccess = () => res((q.result as { value: number } | undefined)?.value ?? null);
    });
  });
}

test('a code typed wrong and left at the consent screen spends no enrolment number', async ({ page }) => {
  test.setTimeout(120_000);
  await startNewExperiment(page);
  await handleStage(page, 'SESSION_INIT', { participantId: 'P0O1' });
  expect(await stageNow(page)).toBe('CONSENT');
  // The sitting carries the number it will take, provisionally; nothing is spent yet.
  expect((await dbAll<Sitting>(page, 'sessions')).map((s) => [s.participant_id, s.enrolment_number, s.consent_given])).toEqual([['P0O1', 1, false]]);
  expect(await counter(page)).toBeNull();

  // Noticed on the consent screen: out, and the sitting deleted.
  await page.getByTestId('nav-exit').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByRole('button', { name: /New Session/ })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByTestId('confirm-ok').click();

  // The right code: the participant is enrolment 1, spent at consent.
  await page.getByRole('button', { name: /New Session/ }).click({ force: true });
  await page.waitForSelector('[data-stage]');
  await handleStage(page, 'SESSION_INIT', { participantId: 'P001' });
  expect(await stageNow(page)).toBe('CONSENT');
  expect(await counter(page)).toBeNull();
  await handleStage(page, 'CONSENT');
  const live = (await dbAll<Sitting>(page, 'sessions')).filter((s) => s.deleted_at == null);
  expect(live.map((s) => [s.participant_id, s.enrolment_number, s.consent_given])).toEqual([['P001', 1, true]]);
  expect(await counter(page)).toBe(1);
});
