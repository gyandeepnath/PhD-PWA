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
import { ratingTrack } from '@/scales/trackStyle';

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
    // Now counted on completion itself: `summaries` holds finished runs only.
    expect(src).toMatch(/<Stat label="Conditions completed" value=\{`\$\{summaries\.length\}\/\$\{plannedConditions\}`\} \/>/);
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

/**
 * Nothing inside the condition-run may flash, or sit on the stimulus, in a colour that is not the
 * condition's own. Static assertions over the source, with the caveat this file states at the top:
 * they prove the rule is written, not that the component renders. Both defects were found by
 * rendering the app and photographing it, and `scripts/platePreview.ts`-style rendering is how the
 * next one will be found too.
 */
describe('the condition-run carries no polarity-correlated flash or chrome', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const CONDITION_SCREENS = [
    'src/tasks/ReadingTask.tsx', 'src/tasks/TaskIntro.tsx', 'src/tasks/ComprehensionTask.tsx',
    'src/tasks/VisualSearchTask.tsx', 'src/scales/FatigueScale.tsx',
    'src/scales/DisplayPerceptionRating.tsx', 'src/scales/NasaTlx.tsx',
  ];

  it('does not fade condition screens in from the page colour', () => {
    // Fading from opacity 0 over cream was a near-white flash on every black-background condition —
    // 30 ms after "Begin reading" in N5 the display was #D6D5D3 — and invisible on every white one:
    // a blink-triggering transient on one level of the polarity factor, at the onset of the
    // primary outcome's window.
    for (const f of CONDITION_SCREENS) expect(read(f), f).not.toMatch(/animate-fade-in/);
  });

  it('paints the page itself in the condition background during the run', () => {
    const css = read('src/styles/theme.css');
    expect(css).toMatch(/body \{[^}]*background: var\(--vl-page-bg\)/);
    expect(css).toMatch(/#root \{[^}]*background: var\(--vl-page-bg\)/);
    expect(read('src/experiment/Experiment.tsx')).toMatch(/setProperty\('--vl-page-bg', pageGround\)/);
  });

  it('keeps the progress chrome off every condition screen, and draws Pause in the screen\'s own ink', () => {
    const src = read('src/experiment/Experiment.tsx');
    expect(src).toMatch(/const showProgress = [^;]*&& !isInLoop\(machine\.stage\)/);
    expect(src).toMatch(/border: `1px solid \$\{stageInk\.ink\}`, background: 'transparent', color: stageInk\.ink/);
  });
});

/**
 * A paused condition must not appear on the dashboard as a measurement.
 *
 * Reported by the investigator: pause a sitting part-way through a condition, open the dashboard,
 * and the paused condition's data is there — averaged into the charts as though it had finished.
 */
describe('a paused condition is left out of every figure and named instead', () => {
  it('marks a condition without completed_at as not complete, and one with it as complete', () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => (i === 9 ? { ...c, completed_at: null } : c));
    const s = buildConditionSummaries(b);
    expect(s.filter((x) => x.condition_complete)).toHaveLength(9);
    expect(s[9].condition_complete).toBe(false);
  });

  it('draws every figure from finished runs only, at the source', () => {
    const src = dashboardSource();
    expect(src).toMatch(/const summaries = useMemo\(\(\) => allSummaries\.filter\(\(s\) => s\.condition_complete\)/);
    // And the unfinished ones are shown by name, not silently dropped.
    expect(src).toMatch(/data-testid="unfinished-conditions"/);
  });
});

/**
 * On a condition screen, text the participant must read is drawn in FULL INK.
 *
 * Translucency multiplies the condition's own contrast. In P4 (yellow on white, 2.39:1) a 60% line
 * falls to about 1.67:1 and a disabled button label to 1.5:1 — so instructions were least legible in
 * exactly the low-contrast conditions, which makes whether they were understood a function of the
 * factor under test. Found by photographing every screen in every condition.
 */
describe('instruction text on condition screens is never faded', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
  const SCREENS = [
    'src/tasks/ReadingTask.tsx', 'src/tasks/TaskIntro.tsx', 'src/tasks/ComprehensionTask.tsx',
    'src/tasks/VisualSearchTask.tsx', 'src/scales/FatigueScale.tsx', 'src/scales/DisplayPerceptionRating.tsx',
  ];

  it('uses no opacity on text, and no fixed slate colour, on any condition screen', () => {
    for (const f of SCREENS) {
      const src = read(f);
      expect(src, f).not.toMatch(/opacity: 0\.\d/);
      expect(src, f).not.toMatch(/text-\[#5a5a7a\]/i);
    }
    // The one exception, documented: the RT trial counter is not instructional text.
    expect(read('src/tasks/ReactionTimeTask.tsx').match(/opacity: 0\.\d/g) ?? []).toHaveLength(1);
  });

  it('opens every rating slider with no visible anchor, and counts a tap as an answer', () => {
    // A visible default thumb (50 on perception and NASA-TLX, 0 on fatigue) is an anchor that pulls
    // ratings toward it. `vl-untouched` hides it; pointer-down marks the answer, so a tap landing
    // exactly on the hidden default still registers.
    for (const f of ['src/scales/DisplayPerceptionRating.tsx', 'src/scales/FatigueScale.tsx', 'src/scales/NasaTlx.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/'vl-untouched'/);
      expect(src, f).toMatch(/onPointerDown=/);
    }
    expect(read('src/styles/theme.css')).toMatch(/\.vl-untouched::-webkit-slider-thumb \{\s*opacity: 0;/);
    // And neither condition-coloured scale paints its track before it is touched.
    expect(read('src/scales/DisplayPerceptionRating.tsx')).toMatch(/ratingTrack\(text, comfortTouched, comfort\)/);
    expect(read('src/scales/FatigueScale.tsx')).toMatch(/ratingTrack\(accent, touched\[it\.key\]/);
  });

  it('draws the empty track visibly, in full ink, and fills only what was answered', () => {
    // The empty track was ink at 13-19% alpha: ~1.1:1 in P4, a line the participant could barely see
    // and had to tap. It is full ink, dashed, so it carries the condition's own contrast.
    const untouched = ratingTrack('#C9A400', false, 50);
    expect(untouched).toMatch(/repeating-linear-gradient/);
    expect(untouched).not.toMatch(/#C9A400[0-9a-f]{2}\b/i);   // no alpha suffix on the ink
    expect(untouched).not.toMatch(/ 50%/);                      // no fill before an answer
    const touched = ratingTrack('#C9A400', true, 73);
    expect(touched).toMatch(/#C9A400 73%, transparent 73%/);
  });
});
