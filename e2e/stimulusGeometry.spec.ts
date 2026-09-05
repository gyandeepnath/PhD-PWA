import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil } from './helpers';

/**
 * The reading column must be the same width, in root pixels, on every device.
 *
 * `tests/stimulusGeometry.test.ts` proves the arithmetic. This proves the WIRING — that the rendered
 * DOM actually lays the passage out in a fixed column rather than a percentage of a root box that
 * takes the device's aspect ratio.
 *
 * The measurement is deliberately in ROOT pixels (dividing out `--vl-scale`), because root pixels
 * are the units the layout is authored in and the units line length is determined in. In CSS pixels
 * the column SHOULD differ between devices — that difference is the uniform magnification
 * `stimulus_scale` records and the study accepts. What must not differ is the number of characters
 * on a line, and that is a root-pixel quantity.
 *
 * Two viewports with deliberately different aspect ratios: 1152x720 is 1.60, 1024x768 is 1.33, and
 * the design canvas is 1.4317 — so a percentage column lands on three different widths and a fixed
 * one does not.
 */
const VIEWPORTS = [
  { name: 'Xiaomi Pad 6 landscape', width: 1152, height: 720 },
  { name: 'iPad 9.7 landscape', width: 1024, height: 768 },
];

async function columnWidthInRootPx(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scale = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
    const root = document.getElementById('root')!;
    // The passage itself: the element whose width decides how many characters fit on a line.
    const para = root.querySelector('p.scrollable') as HTMLElement | null;
    return {
      scale,
      rootW: root.clientHeight > 0 ? root.clientWidth : -1,
      columnW: para ? para.getBoundingClientRect().width / scale : -1,
    };
  });
}

test('the reading column is the same width in root pixels on differently-shaped devices', async ({ page }) => {
  const measured: { name: string; scale: number; rootW: number; columnW: number }[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await startNewExperiment(page);
    await driveUntil(page, 'READING_TASK');
    // READING_TASK opens on its intro card; the passage itself is behind "Begin reading".
    const begin = page.getByRole('button', { name: /Begin reading/ });
    if (await begin.count()) await begin.first().click({ force: true });
    await page.locator('#root p.scrollable').first().waitFor({ state: 'visible' });
    const m = await columnWidthInRootPx(page);
    expect(m.columnW, `no reading passage found at ${vp.name}`).toBeGreaterThan(0);
    measured.push({ name: vp.name, ...m });
  }

  // The premise: these two devices really do give differently-shaped root boxes, or the test is
  // asserting something that was never at risk.
  const shapes = measured.map((m) => (m.rootW / m.scale).toFixed(0));
  expect(new Set(shapes).size,
    'both viewports produced the same root box, so this test proves nothing').toBeGreaterThan(1);

  const [a, b] = measured;
  expect(
    Math.abs(a.columnW - b.columnW),
    `the passage is ${a.columnW.toFixed(0)} root px on ${a.name} but ${b.columnW.toFixed(0)} on `
    + `${b.name} — line length, and so reading rate, differs by device`,
  ).toBeLessThanOrEqual(1);
});
