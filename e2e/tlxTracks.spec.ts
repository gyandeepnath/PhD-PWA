import { test, expect, type Page } from '@playwright/test';
import { startNewExperiment, driveUntil } from './helpers';
import { TAP_GUARD_MS } from '../src/lib/tapGuard';

/**
 * The six NASA-TLX scales can be seen before they are touched, and a fingertip near a track sets it
 * (audit 86 UI-10) — with nothing else on the screen moved.
 *
 * Until touched, the only visible part of a scale was its empty track: the ink at 13% alpha, 1.3:1
 * against the page, on a 6 px strip (the thumb is hidden until touched, deliberately, so that no
 * default position anchors the rating). A tap 12 to 22 px off the track's centre line set nothing, so
 * the band a finger had to find was about 24 CSS px, against the rating lines' 46. Each scale is now a
 * 44 px target with its 8 px track drawn in its middle, at 3:1 or more (tests/tlxTrack.test.ts). This
 * presses 16 px above and below the centre line. With the mouse, which lands exactly where it is aimed:
 * on a touch screen Chromium hands a tap that lands near a control to the control (touch adjustment),
 * which hid the old strip's size in a touch test here, and which the tablet may or may not do as well.
 *
 * What must NOT change is checked too: the screen still holds all six scales and Continue at 1152 x 720
 * without scrolling (a first version of the taller target pushed Continue below the fold), and a tap
 * on a track's line sets the value it set before (measured on the 6 px strip in Round 90: 25, 50 and 75
 * at a quarter, half and three quarters of the input's width).
 */
test.use({ viewport: { width: 1152, height: 720 } });

async function label(page: Page, key: string): Promise<string> {
  // The value readout beside the subscale's name: "not set" until the scale is touched.
  return page.getByTestId(`tlx-value-${key}`).innerText();
}

test('a tap 16 px above or below a scale\'s track sets it, and the screen is laid out as before', async ({ page }) => {
  test.setTimeout(240_000);
  await startNewExperiment(page);
  await driveUntil(page, 'NASA_TLX', 600);
  await page.waitForTimeout(TAP_GUARD_MS + 100);
  const keys = await page.locator('input[data-testid^=tlx-]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(4)));
  expect(keys).toHaveLength(6);

  // The layout: Continue is inside the screen's scroll box as it opens, as it was before the targets grew.
  const fold = await page.getByTestId('tlx-submit').evaluate((b) => {
    const box = b.closest('.screen')!;
    return { button: b.getBoundingClientRect().bottom, box: box.getBoundingClientRect().bottom, overflow: box.scrollHeight - box.clientHeight };
  });
  expect(fold.button, 'Continue is below the fold').toBeLessThanOrEqual(fold.box);
  expect(fold.overflow, 'the screen scrolls').toBeLessThanOrEqual(0);

  for (const [i, key] of keys.entries()) {
    const input = page.getByTestId(`tlx-${key}`);
    await input.scrollIntoViewIfNeeded();
    const box = (await input.boundingBox())!;
    expect(await label(page, key)).toBe('not set');
    const dy = i % 2 === 0 ? -16 : 16;
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2 + dy);
    await expect.poll(() => label(page, key), `a tap ${dy} px off the ${key} track set nothing`).not.toBe('not set');
  }

  // Where a tap on the line lands on the scale is unchanged.
  const first = page.getByTestId(`tlx-${keys[0]}`);
  const box = (await first.boundingBox())!;
  for (const [f, v] of [[0.25, '25'], [0.5, '50'], [0.75, '75']] as const) {
    await page.mouse.click(box.x + box.width * f, box.y + box.height / 2);
    await expect.poll(() => first.inputValue(), `a tap at ${f} of the width`).toBe(v);
  }
});
