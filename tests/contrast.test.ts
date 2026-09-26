import { describe, it, expect } from 'vitest';
import { fixationInkFor } from '@/tasks/ReactionTimeTask';
import { readFileSync } from 'node:fs';
import { wcagContrastRatio, michelsonContrast, relativeLuminance, wcagLevel } from '@/lib/contrast';
import { CONDITIONS, conditionDefinitionHash, rtStimulusColours } from '@/experiment/conditions';
import { UI_TEXT, UI_GROUNDS, UI_FILLS_WITH_WHITE_TEXT, RETIRED_TEXT_COLOURS } from '@/lib/uiPalette';

describe('WCAG relative luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
  });
});

describe('WCAG contrast ratio', () => {
  it('black/white is 21:1', () => {
    expect(wcagContrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
  });

  // Synopsis Table 3.4 — the audit values that justify treating contrast as a covariate.
  const expected: Record<string, number> = {
    P1: 21.0, P2: 6.7, P3: 5.74, P4: 2.39, P5: 3.19,
    N1: 21.0, N2: 3.14, N3: 3.66, N4: 8.79, N5: 6.57,
  };

  for (const c of CONDITIONS) {
    it(`${c.label} contrast ratio ~= ${expected[c.label]}:1`, () => {
      expect(c.wcag_contrast_ratio).toBeCloseTo(expected[c.label], 1);
    });
  }

  it('flags P4 (yellow-on-white) as below WCAG AA', () => {
    const p4 = CONDITIONS.find((c) => c.label === 'P4')!;
    expect(p4.below_wcag_aa).toBe(true);
    expect(p4.wcag_level).toBe('Fail');
  });

  it('balances sub-AA conditions two per polarity (this is why green was added)', () => {
    const below = CONDITIONS.filter((c) => c.below_wcag_aa);
    expect(below.map((c) => c.label).sort()).toEqual(['N2', 'N3', 'P4', 'P5']);
    expect(below.filter((c) => c.polarity === 'positive')).toHaveLength(2);
    expect(below.filter((c) => c.polarity === 'negative')).toHaveLength(2);
  });

  it('holds the achromatic pair at 21:1 in BOTH polarities (the contrast-matched anchor)', () => {
    const ach = CONDITIONS.filter((c) => c.colorName === 'achromatic');
    expect(ach).toHaveLength(2);
    expect(ach.map((c) => c.polarity).sort()).toEqual(['negative', 'positive']);
    for (const c of ach) expect(c.wcag_contrast_ratio).toBeCloseTo(21.0, 1);
  });

  it('reverses the chromatic contrast ordering between polarities (rho = -1, arithmetic)', () => {
    const rank = (pol: string) =>
      CONDITIONS.filter((c) => c.polarity === pol && c.colorName !== 'achromatic')
        .sort((a, b) => a.wcag_contrast_ratio - b.wcag_contrast_ratio)
        .map((c) => c.colorName);
    expect(rank('positive')).toEqual([...rank('negative')].reverse());
  });

  /**
   * The one design claim in conditions.ts that was NOT pinned, and the one it has already been
   * wrong about: the docstring used to read "+0.11" without stating the polarity coding, so the
   * sign could not be checked against it. The figure is the argument that polarity and luminance
   * contrast can enter the same model without collinearity — if a hex value or the colour set ever
   * changes, this is the number that has to be recomputed, and a prose figure will not notice.
   */
  it('keeps polarity very nearly uncorrelated with log contrast (r = -0.113, positive coded 1)', () => {
    const x = CONDITIONS.map((c) => (c.polarity === 'positive' ? 1 : 0));
    const y = CONDITIONS.map((c) => Math.log(c.wcag_contrast_ratio));
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const sd = (a: number[], m: number) => Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
    const mx = mean(x);
    const my = mean(y);
    const r = mean(x.map((v, i) => (v - mx) * (y[i] - my))) / (sd(x, mx) * sd(y, my));
    expect(r).toBeCloseTo(-0.113, 3);
    // The claim the design rests on is not the exact value but that it is near zero.
    expect(Math.abs(r)).toBeLessThan(0.2);
  });

  it('exposes the same five colour levels in both polarities (factorial crossing)', () => {
    const lv = (pol: string) => CONDITIONS.filter((c) => c.polarity === pol).map((c) => c.colorName).sort();
    expect(lv('positive')).toEqual(lv('negative'));
    expect(new Set(lv('positive')).size).toBe(5);
  });

  it('saturates Michelson contrast at 1.000 under negative polarity (metric is uninformative there)', () => {
    const neg = CONDITIONS.filter((c) => c.polarity === 'negative');
    for (const c of neg) expect(c.michelson_contrast).toBeCloseTo(1.0, 3);
  });
});

describe('Michelson contrast', () => {
  it('is 1 for black/white and in [0,1] for all conditions', () => {
    expect(michelsonContrast('#000000', '#FFFFFF')).toBeCloseTo(1, 6);
    for (const c of CONDITIONS) {
      expect(c.michelson_contrast).toBeGreaterThanOrEqual(0);
      expect(c.michelson_contrast).toBeLessThanOrEqual(1);
    }
  });
});

describe('wcagLevel banding', () => {
  it('bands correctly', () => {
    expect(wcagLevel(21)).toBe('AAA');
    expect(wcagLevel(7)).toBe('AAA');
    expect(wcagLevel(4.5)).toBe('AA');
    expect(wcagLevel(3)).toBe('AA Large');
    expect(wcagLevel(2.39)).toBe('Fail');
  });
});

describe('condition definition hash', () => {
  it('is stable and 8 hex chars', () => {
    const h = conditionDefinitionHash();
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(conditionDefinitionHash()).toBe(h);
  });
});

/**
 * The reaction-time block runs IN the condition's display: the go-target is the condition's own
 * text colour, and the no-go dots are the other text colours of the same polarity.
 *
 * This replaced an achromatic target (black on light, white on dark) after the investigator saw a
 * blue-text condition followed by a reaction block tapping for a BLACK dot, and chose to have every
 * task of a condition-run performed in that condition's colours. The earlier tests here pinned the
 * achromatic design; these pin the one chosen, so a well-meant "fix" back to constant salience fails
 * loudly instead of silently undoing an investigator decision.
 */
describe('reaction-time stimulus colours are the condition\'s own', () => {
  it('draws the go-target in the condition\'s text colour, for every condition', () => {
    for (const c of CONDITIONS) {
      const s = rtStimulusColours(c);
      expect(s.target, c.label).toBe(c.text);
      expect(s.targetName, c.label).toBe(c.inkName);
    }
  });

  it('uses the other four text colours of the SAME polarity as the no-go dots', () => {
    for (const c of CONDITIONS) {
      const s = rtStimulusColours(c);
      const samePolarity = CONDITIONS.filter((x) => x.polarity === c.polarity);
      expect(s.distractors, c.label).toHaveLength(samePolarity.length - 1);
      // Never the target itself — a no-go dot in the go colour would make the rule unanswerable.
      expect(s.distractors.map((d) => d.toUpperCase()), c.label).not.toContain(c.text.toUpperCase());
      // Distinct, and together with the target exactly the palette of that polarity.
      expect(new Set(s.distractors).size, c.label).toBe(s.distractors.length);
      expect(new Set([s.target, ...s.distractors]), c.label)
        .toEqual(new Set(samePolarity.map((x) => x.text)));
    }
  });

  it('keeps the RULE constant while the colour changes', () => {
    // Every block asks the same question — does the dot match the text? — so the task does not
    // turn into a new rule to learn in every condition. The instruction card has to say so.
    const src = readFileSync('src/tasks/ReactionTimeTask.tsx', 'utf8');
    expect(src).toMatch(/the same\s+colour as the text you have just read/);
  });

  it('keeps the fixation cross achromatic and at 21:1, since it is not the stimulus', () => {
    // A cross in the condition ink would be 2.39:1 in P4 (yellow on white): one the participant
    // cannot hold, so the dot arrives further into the periphery and the delay is blamed on the
    // display.
    for (const c of CONDITIONS) {
      const ink = fixationInkFor(c.background);
      expect(ink, c.label).toBe(c.polarity === 'positive' ? '#000000' : '#FFFFFF');
      expect(wcagContrastRatio(c.background, ink), c.label).toBeCloseTo(21.0, 1);
    }
  });

  it('makes the target visibility vary with condition — the stated cost, measured', () => {
    // Recorded, not hidden: this is what "RT partly reflects how visible the colour is" means in
    // numbers. If a future palette change moves these, the protocol text describing the cost is
    // out of date and this test is where that is noticed.
    const ratio = (label: string) => {
      const c = CONDITIONS.find((x) => x.label === label)!;
      return wcagContrastRatio(c.background, rtStimulusColours(c).target);
    };
    expect(ratio('P1')).toBeCloseTo(21.0, 1);
    expect(ratio('P4')).toBeLessThan(2.5);   // yellow on white: the hardest go-target to see
    expect(ratio('N1')).toBeCloseTo(21.0, 1);
  });
});

/*
 * OPERATOR AND SETUP SCREENS. Nothing above constrains them — they are not conditions — and they
 * drifted: help text in #9a968e (2.8:1 on cream), empty-list notes in #b8b4ac (2.0:1), warnings in
 * the bright status hues, most of it at 11-12 px on a canvas the tablet draws at 86%. The palette in
 * lib/uiPalette.ts is the fix; these hold it, and hold the screens to it.
 */
describe('operator-screen text colours meet WCAG AA', () => {
  it('every operator text colour is at least 4.5:1 on every operator ground', () => {
    for (const [fgName, fg] of Object.entries(UI_TEXT)) {
      for (const [bgName, bg] of Object.entries(UI_GROUNDS)) {
        expect(wcagContrastRatio(fg, bg), `${fgName} ${fg} on ${bgName} ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('white button text is at least 4.5:1 on every filled button colour', () => {
    for (const [name, fill] of Object.entries(UI_FILLS_WITH_WHITE_TEXT)) {
      expect(wcagContrastRatio('#FFFFFF', fill), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the progress label is legible on the dark calibration and camera self-test screens too', () => {
    // It sits above both overlays; in #4a4a60 it was about 2:1 there. It takes #c8d8f0 on them.
    expect(wcagContrastRatio('#c8d8f0', '#0a0a12')).toBeGreaterThanOrEqual(4.5);
    expect(wcagContrastRatio('#c8d8f0', '#1a1a2e')).toBeGreaterThanOrEqual(4.5);
    expect(readFileSync('src/components/ExperimentProgress.tsx', 'utf8')).toMatch(/onDark \? '#c8d8f0' : '#4a4a60'/);
  });

  it('a disabled button is still legible (muted text on the disabled grey)', () => {
    // Disabled was white on #cfcbc3: 1.6:1.
    expect(wcagContrastRatio(UI_TEXT.muted, '#E8E6E1')).toBeGreaterThanOrEqual(4.5);
  });

  it('the retired colours really were below AA as text on cream, which is why they are retired', () => {
    for (const c of RETIRED_TEXT_COLOURS) {
      expect(wcagContrastRatio(c, UI_GROUNDS.cream), c).toBeLessThan(4.5);
    }
  });

  /*
   * The retired hues are still fine as FILLS — status dots, chart bars, borders, tints — so they are
   * not banned outright. What is checked is their use as a text colour: a Tailwind text-[#…] class,
   * or a `color` property / prop whose value is one of them. charts.tsx is left out: every colour in
   * it is a bar, line or dot fill.
   */
  const OPERATOR_FILES = [
    'src/App.tsx',
    'src/start/SessionManager.tsx', 'src/start/LandingPage.tsx', 'src/start/setupStages.tsx',
    'src/start/LuxCheckpoint.tsx', 'src/start/CalibrationRoutine.tsx', 'src/start/BreakScreen.tsx',
    'src/start/CameraSelfTest.tsx',
    'src/components/ResearcherPanel.tsx', 'src/components/UpdateBanner.tsx',
    'src/components/ErrorBoundary.tsx', 'src/components/ScrollCue.tsx', 'src/components/InfoTip.tsx',
    'src/components/VisuLabLogo.tsx', 'src/components/ExperimentProgress.tsx',
    'src/screening/IshiharaTest.tsx', 'src/dashboard/Dashboard.tsx', 'src/dashboard/LazyDashboard.tsx',
  ];

  it('no operator screen sets a retired colour as a text colour', () => {
    const hits: string[] = [];
    for (const f of OPERATOR_FILES) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // A chart's `color` prop is its bar or line fill, not text.
        if (/<(?:BarPanel|LinePanel)\b/.test(line)) return;
        for (const c of RETIRED_TEXT_COLOURS) {
          let at = line.toLowerCase().indexOf(c);
          while (at !== -1) {
            // The property this value belongs to: the text since the last `{` or `,` before it.
            const prop = line.slice(0, at).split(/[{,]/).pop() ?? '';
            if (/text-\[$/.test(line.slice(0, at)) || /\bcolor\b/.test(prop)) hits.push(`${f}:${i + 1} ${c}`);
            at = line.toLowerCase().indexOf(c, at + 1);
          }
        }
      });
    }
    expect(hits).toEqual([]);
  });

  /*
   * The type floor: 14 px for any text on these screens (running text is 15-17 px), 13 px for a
   * dashboard table. Caught: text-xs, a Tailwind text-[Npx], and a literal fontSize (number or
   * string). A size chosen by a variable is not seen here; ResearcherPanel picks its setup-screen
   * sizes that way, keeping its compact in-loop sizes on condition screens.
   *
   * Exempt, because they are drawn during a condition or the measurement procedure and keep their
   * original size: the researcher strip under the reading passage and the calibration step counter.
   */
  const SIZE_EXEMPT: Array<[string, RegExp]> = [
    ['src/components/ResearcherPanel.tsx', /researcher-panel-strip/],
    ['src/start/CalibrationRoutine.tsx', /\{idx \+ 1\} \/ \{STEPS\.length\}|textAlign: 'center', color: '#c8d8f0', fontFamily: '"DM Mono", monospace', fontSize: 12 \}/],
  ];
  const sizesOn = (line: string): number[] => {
    const out: number[] = [];
    if (/\btext-xs\b/.test(line)) out.push(12);
    for (const m of line.matchAll(/\btext-\[(\d+(?:\.\d+)?)px\]/g)) out.push(Number(m[1]));
    for (const m of line.matchAll(/fontSize:\s*['"]?(\d+(?:\.\d+)?)(?:px)?['"]?/g)) out.push(Number(m[1]));
    return out;
  };

  it('no operator screen sets text below 14 px (13 px in a dashboard table)', () => {
    const hits: string[] = [];
    for (const f of OPERATOR_FILES) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (SIZE_EXEMPT.some(([file, re]) => file === f && re.test(line))) return;
        const floor = f === 'src/dashboard/Dashboard.tsx' && /<table\b/.test(line) ? 13 : 14;
        for (const px of sizesOn(line)) if (px < floor) hits.push(`${f}:${i + 1} ${px}px`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the size scan sees the forms it is meant to catch', () => {
    expect(sizesOn('className="text-xs"')).toEqual([12]);
    expect(sizesOn('className="text-[13px] font-sans"')).toEqual([13]);
    expect(sizesOn("style={{ fontSize: '12px' }}")).toEqual([12]);
    expect(sizesOn('style={{ fontSize: 13.5 }}')).toEqual([13.5]);
    expect(sizesOn('style={{ fontSize: fsText }}')).toEqual([]);
  });

  it('no text-heavy screen draws the wave backdrop behind its words', () => {
    // It crossed the consent text, the session form and the session list. The component is kept.
    const users = OPERATOR_FILES.filter((f) => /<WavyBackground\b/.test(readFileSync(f, 'utf8')));
    expect(users).toEqual([]);
  });
});
