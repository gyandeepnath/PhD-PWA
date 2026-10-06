import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil, handleStage, stageNow, waitStageChange, setInput, checkAllBoxes, measureScreen } from './helpers';
import { splitCsvRow } from '../tests/helpers/csv';

/**
 * Pre-flight's ruler check reaches the session record and the export — measured, and skipped.
 *
 * Round 74 added the check; its review found that nothing read it back. Changing the handler to save
 * `calibration_skipped: false` for every sitting (so skipped sittings look measured) left every test
 * green, and no spec looked at mm_per_css_px, calibration_bar_mm, viewing_distance_cm or the source
 * flag in the database or the export. So each test here completes pre-flight once, drives the first
 * display through its reaction-time block, and reads the session row and the 01, 02 and 08 files.
 *
 * The skipped sitting also changes the display-size setting between the profile and pre-flight (the
 * pixel ratio and the CSS screen move together, as on the tablet): the no-ruler fallback divides the
 * panel by the screen width and scales by the pixel ratio, so the two must be the pair pre-flight saw.
 * Builds 2.2.0 and 2.3.0 kept the creation-time screen beside pre-flight's ratio (Round 76).
 */

const PANEL_LONG_MM = (2880 / 309) * 25.4;

type Row = Record<string, unknown>;
async function sessionRow(page: Page): Promise<Row> {
  const rows = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('VisualErgonomicsDB');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise<Record<string, unknown>[]>((res, rej) => {
      const q = db.transaction('sessions').objectStore('sessions').getAll();
      q.onsuccess = () => res(q.result as Record<string, unknown>[]);
      q.onerror = () => rej(q.error);
    });
  });
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** The sitting's 01, 02 and 08 files as the export writes them, and the physical_calibration findings. */
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
    const findings = (auditBundle(bundle).findings as { check: string; detail: string }[])
      .filter((f) => f.check.startsWith('physical_'));
    return { s01: file('01_session_info.csv'), s02: file('02_conditions.csv'), s08: file('08_reaction_trials.csv'), findings };
  }, sessionId);
  const rows = (csv: string) => {
    const [head, ...lines] = csv.trim().split(/\r?\n/);
    const cols = splitCsvRow(head);
    return lines.map((l) => { const v = splitCsvRow(l); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
  };
  return { session: rows(out.s01)[0], conditions: rows(out.s02), trials: rows(out.s08), findings: out.findings };
}

/** Pre-flight's other boxes and its Continue, the calibration box already filled in. */
async function finishPreflight(page: Page) {
  await checkAllBoxes(page);
  await page.getByRole('button', { name: /All checks pass/ }).click({ force: true });
  await waitStageChange(page, 'PREFLIGHT');
}

/** On from pre-flight through the first display's reaction-time block. */
async function throughFirstDisplay(page: Page) {
  // Not "until ADAPTATION": the grey field also comes before the first display.
  await driveUntil(page, 'REACTION_TIME');
  await handleStage(page, 'REACTION_TIME');
}

test.describe('the study tablet at pixel ratio 1.5', () => {
  test.use({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 1.5, contextOptions: { screen: { width: 1920, height: 1200 } } });

  test('a ruler reading is saved and every physical column is computed from it', async ({ page }) => {
    test.setTimeout(300_000);
    await startNewExperiment(page);
    await driveUntil(page, 'PREFLIGHT');
    // The distance starts empty: Continue is not given on the nominal 55 nobody measured.
    await expect(page.getByTestId('viewing-distance')).toHaveValue('');
    await measureScreen(page, '62');
    await finishPreflight(page);
    await throughFirstDisplay(page);

    const s = await sessionRow(page);
    const scale = s.calibration_scale as number;
    expect(scale).toBeGreaterThan(1);
    expect(s).toMatchObject({
      preflight_complete: true, calibration_skipped: false, calibration_bar_design_px: 500,
      viewing_distance_cm: 62, device_pixel_ratio: 1.5, screen_resolution: '1920x1200',
    });
    // The driver read the bar as the study tablet's panel would show it: panel / 1920 per CSS px.
    expect(s.mm_per_css_px as number).toBeCloseTo(PANEL_LONG_MM / 1920, 4);
    expect(s.calibration_bar_mm as number).toBeCloseTo(500 * scale * (s.mm_per_css_px as number), 6);

    const x = await exported(page, s.session_id as string);
    expect(x.session).toMatchObject({
      calibration_skipped: 'false', viewing_distance_cm: '62', device_pixel_ratio: '1.5',
      physical_size_source: 'measured', calibration_bar_design_px: '500',
    });
    expect(Number(x.session.mm_per_css_px)).toBeCloseTo(PANEL_LONG_MM / 1920, 4);
    expect(Number(x.session.calibration_bar_mm)).toBeCloseTo(s.calibration_bar_mm as number, 2);
    const [c] = x.conditions;
    expect(c.physical_size_source).toBe('measured');
    expect(Number(c.mm_per_layout_px)).toBeCloseTo((s.mm_per_css_px as number) * Number(c.stimulus_scale), 5);
    expect(c.reading_x_height_arcmin).not.toBe('');
    expect(x.trials.length).toBeGreaterThan(0);
    for (const t of x.trials) {
      expect(t.stim_ecc_deg_source).toBe('measured');
      // At 62 cm the same offset subtends less than at the nominal 55.
      expect(Number(t.stim_ecc_deg_at_distance)).toBeLessThan(Number(t.stim_ecc_deg_55cm));
    }
    // Measured and on the panel: nothing for the audit to say.
    expect(x.findings).toEqual([]);
  });
});

test.describe('pixel ratio 2.0 at the profile, 1.5 by pre-flight', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, contextOptions: { screen: { width: 1440, height: 900 } } });

  test('a skipped ruler check is saved as skipped, and the fallback uses the screen pre-flight saw', async ({ page }) => {
    test.setTimeout(300_000);
    await startNewExperiment(page);
    expect(await page.evaluate(() => `${screen.width}x${screen.height}@${devicePixelRatio}`)).toBe('1440x900@2');
    await driveUntil(page, 'PREFLIGHT');
    // The display-size setting changes before pre-flight: the same panel, more and smaller CSS pixels.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1200, deviceScaleFactor: 1.5, mobile: false, screenWidth: 1920, screenHeight: 1200,
    });
    await expect.poll(() => page.evaluate(() => `${screen.width}x${screen.height}@${devicePixelRatio}`)).toBe('1920x1200@1.5');
    expect(await stageNow(page)).toBe('PREFLIGHT');

    await page.getByTestId('calibration-skip-ack').check({ force: true });
    await expect(page.getByTestId('preflight-continue')).toBeDisabled();   // no distance typed yet
    await setInput(page, 'viewing-distance', '57');
    await finishPreflight(page);
    await throughFirstDisplay(page);

    const s = await sessionRow(page);
    expect(s).toMatchObject({
      preflight_complete: true, calibration_skipped: true, mm_per_css_px: null, calibration_bar_mm: null,
      calibration_scale: null, viewing_distance_cm: 57, device_pixel_ratio: 1.5, screen_resolution: '1920x1200',
    });

    const x = await exported(page, s.session_id as string);
    expect(x.session).toMatchObject({
      calibration_skipped: 'true', mm_per_css_px: '', calibration_bar_mm: '', viewing_distance_cm: '57',
      physical_size_source: 'assumed_study_tablet_panel', screen_resolution: '1920x1200',
    });
    const [c] = x.conditions;
    expect(c.device_pixel_ratio).toBe('1.5');
    expect(c.physical_size_source).toBe('assumed_study_tablet_panel');
    // panel / 1920 — not panel / 1440, which the creation-time screen beside the 1.5 would have given.
    expect(Number(c.mm_per_layout_px)).toBeCloseTo((PANEL_LONG_MM / 1920) * Number(c.stimulus_scale), 5);
    for (const t of x.trials) expect(t.stim_ecc_deg_source).toBe('assumed_study_tablet_panel');
    expect(x.findings.map((f) => f.check)).toEqual(['physical_calibration']);
    expect(x.findings[0].detail).toMatch(/skipped at pre-flight/);
  });
});
