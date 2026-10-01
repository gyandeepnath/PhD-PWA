import { test, expect, type Page } from '@playwright/test';
import { stageNow, startNewExperiment, driveUntil, handleStage, waitStageChange } from './helpers';
import { splitCsvRow } from '../tests/helpers/csv';

/**
 * The installed-app check: asked, gated, recorded — at pre-flight, and again on a resume.
 *
 * Round 63 added the check to pre-flight; its review found nothing tested it (the driver's
 * checkAllBoxes ticks the acknowledgement with every other box, so removing the gate, or dropping
 * display_mode / display_mode_acknowledged from any write or from the export, left everything green)
 * and that a resume skipped it altogether: a sitting checked as installed could be paused, reopened
 * in a Chrome tab and finished at scale 0.90 with nothing asked and the session still saying
 * fullscreen, unacknowledged.
 *
 * The browser reports its CSS display-mode through matchMedia; the stub below answers from
 * localStorage, so a reload can come back "in another launch". The test browser is really a tab.
 */
async function fakeDisplayMode(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    const listeners = new Set<() => void>();
    window.matchMedia = (q: string) => {
      const m = /\(display-mode:\s*([a-z-]+)\)/.exec(q);
      const fake = localStorage.getItem('e2eDisplayMode');
      if (!m || !fake) return real(q);
      return {
        matches: m[1] === fake, media: q, onchange: null,
        addEventListener(_t: string, l: () => void) { listeners.add(l); },
        removeEventListener(_t: string, l: () => void) { listeners.delete(l); },
        addListener() {}, removeListener() {},
        dispatchEvent() { return false; },
      } as unknown as MediaQueryList;
    };
    // The page leaving (or entering) full-screen under a running sitting, as Chrome reports it.
    (window as unknown as { __setDisplayMode: (m: string) => void }).__setDisplayMode = (mode: string) => {
      localStorage.setItem('e2eDisplayMode', mode);
      for (const l of [...listeners]) l();
    };
  });
}
async function launchAs(page: Page, mode: 'fullscreen' | 'browser') {
  await page.evaluate((m) => localStorage.setItem('e2eDisplayMode', m), mode);
}

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

/** The sitting's 01 and 02 files as the export writes them, and the integrity audit's verdict. */
async function exported(page: Page, sessionId: string) {
  const out = await page.evaluate(async (id) => {
    // Non-literal specifiers: the dev server serves the app's own modules, the same instances.
    const gatherUrl = '/src/storage/gather.ts';
    const exportUrl = '/src/storage/export.ts';
    const integrityUrl = '/src/storage/integrity.ts';
    const { gatherSession } = await import(/* @vite-ignore */ gatherUrl);
    const { buildExportFiles } = await import(/* @vite-ignore */ exportUrl);
    const { auditBundle } = await import(/* @vite-ignore */ integrityUrl);
    const bundle = await gatherSession(id);
    const files = buildExportFiles(bundle) as { filename: string; content: string }[];
    const file = (n: string) => files.find((f) => f.filename.endsWith(n))!.content;
    const findings = (auditBundle(bundle).findings as { check: string; detail: string; refs: string[] }[])
      .filter((f) => f.check === 'display_mode_installed');
    return { s01: file('01_session_info.csv'), s02: file('02_conditions.csv'), findings };
  }, sessionId);
  const rows = (csv: string) => {
    const [head, ...lines] = csv.trim().split(/\r?\n/);
    const cols = splitCsvRow(head);
    return lines.map((l) => { const v = splitCsvRow(l); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
  };
  return { session: rows(out.s01)[0], conditions: rows(out.s02), findings: out.findings };
}

/** Pre-flight, with every box ticked but the acknowledgement. */
async function tickAllButAck(page: Page) {
  for (const box of await page.getByRole('checkbox').all()) {
    if ((await box.getAttribute('data-testid')) === 'display-mode-ack') continue;
    await box.check({ force: true });
  }
}

test('a browser launch must be acknowledged at pre-flight, and is recorded and exported', async ({ page }) => {
  await fakeDisplayMode(page);
  await page.setViewportSize({ width: 1152, height: 650 });
  await page.goto('/?e2e=1');
  await launchAs(page, 'browser');
  await startNewExperiment(page);
  await driveUntil(page, 'PREFLIGHT');
  await expect(page.getByTestId('display-mode-check')).toContainText('display mode: browser');
  // At 0.90 the size sentence says the stimuli are smaller — and by how much.
  await expect(page.getByTestId('display-mode-check')).toContainText('drawn smaller than the protocol size (90%)');
  await tickAllButAck(page);
  const go = page.getByTestId('preflight-continue');
  const ack = page.getByTestId('display-mode-ack');
  // Ticked, every other condition met (storage, typeface): Continue is given …
  await ack.check({ force: true });
  await expect(go).toBeEnabled();
  // … and the acknowledgement alone takes it away again.
  await ack.uncheck({ force: true });
  await expect(go).toBeDisabled();
  await ack.check({ force: true });
  await go.click();
  await waitStageChange(page, 'PREFLIGHT');
  await driveUntil(page, 'READING_TASK');

  const [s] = await all(page, 'sessions');
  expect(s.display_mode).toBe('browser');
  expect(s.display_mode_acknowledged).toBe(true);
  await expect.poll(async () => (await all(page, 'conditions')).length).toBe(1);
  const [c] = await all(page, 'conditions');
  expect(c.display_mode).toBe('browser');
  expect(c.display_mode_acknowledged).toBe(true);
  expect(c.stimulus_scale).toBe(0.9);

  const x = await exported(page, s.session_id as string);
  expect(x.session.display_mode).toBe('browser');
  expect(x.session.display_mode_acknowledged).toBe('true');
  expect(x.conditions[0].display_mode).toBe('browser');
  expect(x.conditions[0].display_mode_acknowledged).toBe('true');
  expect(x.findings).toHaveLength(1);
  expect(x.findings[0].detail).not.toMatch(/NOT acknowledged/);
});

test('the installed app is told so, asks for nothing, and is recorded as such', async ({ page }) => {
  await fakeDisplayMode(page);
  await page.setViewportSize({ width: 1152, height: 720 });
  await page.goto('/?e2e=1');
  await launchAs(page, 'fullscreen');
  await startNewExperiment(page);
  await driveUntil(page, 'PREFLIGHT');
  await expect(page.getByTestId('display-mode-check')).toContainText('installed, full-screen — correct');
  await expect(page.getByTestId('display-mode-ack')).toHaveCount(0);
  await handleStage(page, 'PREFLIGHT');
  await driveUntil(page, 'READING_TASK');

  const [s] = await all(page, 'sessions');
  expect(s.display_mode).toBe('fullscreen');
  expect(s.display_mode_acknowledged).toBe(false);
  await expect.poll(async () => (await all(page, 'conditions')).length).toBe(1);
  const [c] = await all(page, 'conditions');
  expect(c.display_mode).toBe('fullscreen');
  expect(c.display_mode_acknowledged).toBe(false);
  expect(c.stimulus_scale).toBe(1);

  const x = await exported(page, s.session_id as string);
  expect(x.session.display_mode).toBe('fullscreen');
  expect(x.session.display_mode_acknowledged).toBe('false');
  expect(x.conditions[0].display_mode).toBe('fullscreen');
  expect(x.conditions[0].display_mode_acknowledged).toBe('false');
  expect(x.findings).toHaveLength(0);
});

test('a sitting checked as installed and resumed in a tab is checked again, before anything else', async ({ page }) => {
  test.setTimeout(400_000);
  await fakeDisplayMode(page);
  await page.setViewportSize({ width: 1152, height: 720 });
  await page.goto('/?e2e=1');
  await launchAs(page, 'fullscreen');
  await startNewExperiment(page);
  // Installed at pre-flight; condition 1 finished; paused in condition 2's reading.
  for (let g = 0; ; g++) {
    if (g > 300) throw new Error('did not reach the second condition');
    const st = await stageNow(page);
    if (st === 'READING_TASK' && (await all(page, 'conditions')).length >= 2) break;
    await handleStage(page, st);
  }
  await page.getByTestId('pause-chip').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();

  // Reopened in a Chrome tab: the address bar takes ~70 px.
  await page.setViewportSize({ width: 1152, height: 650 });
  await launchAs(page, 'browser');
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /Enter Research Console/ }).click();
  const resume = async () => {
    await page.getByRole('button', { name: /^Resume →/ }).click();
    await page.waitForFunction(() => {
      const st = document.querySelector('[data-stage]')?.getAttribute('data-stage');
      return st && st !== 'SESSION_INIT';
    });
  };
  await resume();
  // First, before the camera path or the grey field — so the operator can relaunch before anything.
  expect(await stageNow(page)).toBe('LAUNCH_CHECK');
  await expect(page.getByTestId('display-mode-check')).toContainText('display mode: browser');
  await expect(page.getByTestId('launch-check-continue')).toBeDisabled();
  // The way out it recommends leaves the sitting as it was.
  await page.getByTestId('nav-exit').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Nothing has changed since Resume');
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText(/In progress \(1\)/)).toBeVisible();
  expect((await all(page, 'conditions')).length).toBe(2);
  // Resumed again, in the same tab: asked again, and this time ticked.
  await resume();
  expect(await stageNow(page)).toBe('LAUNCH_CHECK');
  await page.getByTestId('display-mode-ack').check();
  await page.getByTestId('launch-check-continue').click();
  await waitStageChange(page, 'LAUNCH_CHECK');
  await driveUntil(page, 'READING_TASK');
  await expect.poll(async () => (await all(page, 'conditions')).find((r) => r.session_position === 1)?.attempt_number).toBe(2);

  const [s] = await all(page, 'sessions');
  // Pre-flight's answer, unchanged …
  expect(s.display_mode).toBe('fullscreen');
  expect(s.display_mode_acknowledged).toBe(false);
  // … and the launch the resumed condition really ran in, acknowledged.
  const conds = await all(page, 'conditions');
  const first = conds.find((r) => r.session_position === 0)!;
  const resumed = conds.find((r) => r.session_position === 1)!;
  expect(first).toMatchObject({ display_mode: 'fullscreen', display_mode_acknowledged: false, stimulus_scale: 1 });
  expect(resumed).toMatchObject({ display_mode: 'browser', display_mode_acknowledged: true, stimulus_scale: 0.9 });

  const x = await exported(page, s.session_id as string);
  expect(x.session.display_mode).toBe('fullscreen');
  expect(x.session.display_mode_acknowledged).toBe('false');
  const row = (pos: string) => x.conditions.find((r) => r.session_position === pos)!;
  expect(row('1').display_mode).toBe('browser');
  expect(row('1').display_mode_acknowledged).toBe('true');
  expect(row('0').display_mode_acknowledged).toBe('false');
  // The audit names the condition run in the tab.
  expect(x.findings).toHaveLength(1);
  expect(x.findings[0].refs).toEqual([resumed.condition_id]);
});

test('a launch that changes under a running sitting is recorded, and asked at the next break', async ({ page }) => {
  /*
   * A run of the app does not normally change launch — a tab stays a tab — but a page can leave
   * full-screen under the sitting. Between two displays nothing interrupts the participant: the
   * condition records the launch and that nobody acknowledged it, and the audit says so. At the next
   * break, with the operator there, the same check is asked before the next display.
   */
  test.setTimeout(400_000);
  await fakeDisplayMode(page);
  await page.setViewportSize({ width: 1152, height: 720 });
  await page.goto('/?e2e=1');
  await launchAs(page, 'fullscreen');
  await startNewExperiment(page);
  for (let g = 0; ; g++) {
    if (g > 300) throw new Error('did not reach the first condition');
    const st = await stageNow(page);
    if (st === 'READING_TASK' && (await all(page, 'conditions')).length >= 1) break;
    await handleStage(page, st);
  }
  // Condition 1 is under way in the installed app; the page now leaves full-screen.
  await page.evaluate(() => (window as unknown as { __setDisplayMode: (m: string) => void }).__setDisplayMode('browser'));
  await driveUntil(page, 'BREAK_SCREEN');
  await expect(page.getByTestId('display-mode-check')).toContainText('display mode: browser');
  const go = page.getByRole('button', { name: /I’m ready — continue/ });
  await expect(go).toBeDisabled();
  await page.getByTestId('display-mode-ack').check();
  await expect(go).toBeEnabled();
  await go.click();
  await waitStageChange(page, 'BREAK_SCREEN');
  for (let g = 0; ; g++) {
    if (g > 100) throw new Error('did not reach the third condition');
    const st = await stageNow(page);
    if (st === 'READING_TASK' && (await all(page, 'conditions')).length >= 3) break;
    await handleStage(page, st);
  }
  const conds = await all(page, 'conditions');
  const at = (pos: number) => conds.find((r) => r.session_position === pos)!;
  expect(at(0)).toMatchObject({ display_mode: 'fullscreen', display_mode_acknowledged: false });
  // Started after the change, before any break: recorded, not acknowledged.
  expect(at(1)).toMatchObject({ display_mode: 'browser', display_mode_acknowledged: false });
  // After the break's tick.
  expect(at(2)).toMatchObject({ display_mode: 'browser', display_mode_acknowledged: true });
  const [s] = await all(page, 'sessions');
  const x = await exported(page, s.session_id as string);
  expect(x.findings).toHaveLength(1);
  expect(x.findings[0].detail).toMatch(/^2 condition\(s\) ran outside/);
  expect(x.findings[0].detail).toMatch(/1 of them started in a launch the operator had NOT acknowledged/);
});
