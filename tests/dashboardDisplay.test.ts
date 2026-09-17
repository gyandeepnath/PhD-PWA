/**
 * The numbers the operator reads off the dashboard.
 *
 * This screen is where a researcher decides whether a sitting worked and whether to re-run a
 * participant, so a plausible-looking wrong number here gets acted on. Three of the defects below
 * were of that kind, and none of them had a test: the aggregation was covered, the DISPLAY was not.
 *
 * Where a tile is JSX rather than a function, the assertion is static over the source — the technique
 * tests/pwaPolicy.test.ts uses against vite.config.ts. It proves the arithmetic is written correctly.
 * It does not prove the tile renders; the full-run end-to-end spec covers that the dashboard mounts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { buildFixtureBundle } from '@/sim/bundleFixture';

const dashboardSource = () => readFileSync(resolve(__dirname, '..', 'src/dashboard/Dashboard.tsx'), 'utf8');

describe('a measurement that was never taken is not displayed as zero', () => {
  it('lets a null comprehension average reach the formatter instead of becoming 0%', () => {
    /*
     * The `?? 0` used to sit inside the multiplication, so `100 * (null ?? 0)` gave 0 and the tile
     * read "0%" — which an operator reads as "answered every question wrong", a strong reason to
     * exclude or re-run, when nothing had been asked. The aggregator deliberately keeps this null.
     */
    const src = dashboardSource();
    expect(src).not.toMatch(/100 \* \(avg\([^)]*comprehension_correct[^)]*\) \?\? 0\)/);
    // The null has to be tested for before the percentage is applied.
    expect(src).toMatch(/acc == null \? fmt\(null\)/);
  });

  it("keeps the aggregator's own null, so the display cannot invent a zero", () => {
    // Guards the layer beneath: if comprehension_correct ever became 0-for-absent, the tile would be
    // correct and the number still wrong.
    const b = buildFixtureBundle();
    b.comprehension = [];
    for (const s of buildConditionSummaries(b)) expect(s.comprehension_correct).toBeNull();
  });
});

describe('conditions completed counts blocks that ran, not blocks that scored', () => {
  it('counts on hit_rate rather than on the mean hit reaction time', () => {
    /*
     * mean_rt_hits_ms is null when there were no valid non-anticipatory hits — exactly what a
     * participant who stopped responding produces. That condition ran, and produced a damning
     * result, and the tile called it not completed: the operator re-runs a condition that did happen.
     */
    const src = dashboardSource();
    expect(src).toMatch(/Conditions completed[\s\S]{0,400}s\.hit_rate != null/);
    expect(src).not.toMatch(/Conditions completed[\s\S]{0,200}s\.mean_rt_hits_ms != null/);
  });

  it('separates "never responded" from "no signal trials" in the data it counts on', () => {
    // The distinction the tile now relies on: a hit rate of 0 is a measurement, null is absence.
    const b = buildFixtureBundle();
    const s = buildConditionSummaries(b);
    expect(s.every((x) => x.hit_rate != null)).toBe(true);
  });
});

describe('the selected participant cannot show another participant\'s numbers', () => {
  it('clears the bundle and guards the gather against a race', () => {
    /*
     * The header re-renders with the new participant at once while the gather is still in flight. No
     * clear meant the previous participant's numbers sat under the new name until IndexedDB answered;
     * no cancellation meant that switching A -> B -> C left whichever gather resolved LAST in
     * control, so B's data could sit under C's name indefinitely.
     */
    const src = dashboardSource();
    const effect = src.slice(src.indexOf('useEffect(() => {\n    if (!sessionId)'));
    expect(effect).toMatch(/setBundle\(null\)/);
    expect(effect).toMatch(/let cancelled = false/);
    expect(effect).toMatch(/if \(!cancelled\) setBundle\(b\)/);
    expect(effect).toMatch(/return \(\) => \{ cancelled = true; \}/);
  });
});

describe('ocular metrics are not reported for a camera that was not running', () => {
  it('nulls the blink metrics when camera_active is false', () => {
    // These three — including the primary outcome — escaped the camera_active gate that their eight
    // neighbours already had. A zero incomplete-blink ratio reads as the cleanest possible result.
    const b = buildFixtureBundle();
    b.eyeMetrics[0] = {
      ...b.eyeMetrics[0],
      camera_active: false,
      blink_rate: 0,
      blink_rate_full: 0,
      incomplete_blink_ratio: 0,
    };
    const s = buildConditionSummaries(b)[0];
    expect(s.camera_active).toBe(false);
    expect(s.blink_rate).toBeNull();
    expect(s.blink_rate_full).toBeNull();
    expect(s.incomplete_blink_ratio).toBeNull();
  });
});
