import { test, expect } from '@playwright/test';
import { startNewExperiment, driveUntil } from './helpers';

/**
 * A condition-coloured screen must fill the scaled root exactly.
 *
 * `min-h-screen` is `min-height: 100vh`, and `vh` measures the RAW viewport — but these screens sit
 * inside a `#root` whose height is `calc(100% / var(--vl-scale))`. Measured at 1152x650, where the
 * scale is 0.76: the fatigue and display-perception panels came out 650 CSS px inside an 855 px
 * root, leaving a 205 px strip of the cream app background visible below them.
 *
 * On a positive-polarity condition that strip is cream on near-cream and invisible. On a NEGATIVE-
 * polarity condition it is a bright band at the bottom of an otherwise black screen — an
 * uncontrolled luminance difference present in one level of the primary independent variable and
 * not the other. That is a confound, not a cosmetic defect, which is why it is tested rather than
 * left to review.
 */
const CONDITION_SCREENS = ['COMPREHENSION', 'POST_FATIGUE', 'DISPLAY_PERCEPTION', 'REACTION_TIME'];

for (const stage of CONDITION_SCREENS) {
  test(`${stage} fills the scaled root, leaving no app-background band`, async ({ page }) => {
    // A viewport that forces a scale below 1; at scale 1 the bug is invisible because 100vh and the
    // root height coincide, which is why every earlier test missed it.
    await page.setViewportSize({ width: 1152, height: 650 });
    await startNewExperiment(page);
    await driveUntil(page, stage);

    const m = await page.evaluate(() => {
      const root = document.getElementById('root')!;
      const scale = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--vl-scale')) || 1;
      const panels = ([...root.querySelectorAll('*')] as HTMLElement[])
        .filter((el) => {
          const bg = getComputedStyle(el).backgroundColor;
          return bg === 'rgb(255, 255, 255)' || bg === 'rgb(0, 0, 0)';
        })
        .map((el) => el.getBoundingClientRect().height / scale)
        .sort((a, b) => b - a);
      return { rootH: root.clientHeight, panelH: panels[0] ?? -1, scale };
    });

    expect(m.scale, 'this viewport must produce a scale below 1 or the test proves nothing')
      .toBeLessThan(1);
    expect(m.panelH, 'no condition-coloured panel was found').toBeGreaterThan(0);
    expect(
      m.rootH - m.panelH,
      `${stage} leaves a ${Math.round(m.rootH - m.panelH)}px band of app background below the stimulus`,
    ).toBeLessThanOrEqual(1);
  });
}
