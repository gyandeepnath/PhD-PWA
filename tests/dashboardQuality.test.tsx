/**
 * The dashboard's Data Quality view and its shared pieces (Round 83), rendered for real in jsdom.
 *
 * What the investigator asked for, testing 2.3.1: "bad" only where the measurement really failed a
 * pre-registered check, and that check named; one compact line per condition instead of paragraphs; and
 * nothing that was on the page lost. Each describe below holds one of those.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildConditionSummaries, type ConditionSummary } from '@/dashboard/aggregate';
import { EyeDataPanel, EyeTables } from '@/dashboard/eyeData';
import { Caveat, countBySeverity } from '@/dashboard/parts';
import { sittingChecks } from '@/dashboard/sittingChecks';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { EyeMetricsRecord } from '@/storage/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
});
function render(el: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

/**
 * The export fixture's sitting with its ten eye records varied so every verdict appears: good, usable
 * for each pre-registered flag, not usable for each exclusion, and a good row with notes.
 */
function variedSummaries(): ConditionSummary[] {
  const b = buildFixtureBundle();
  const eye = b.eyeMetrics;
  const at = (i: number, fps: number) => { eye[i].ear_sample_count = Math.round(fps * (eye[i].observed_duration_ms! / 1000)) + 1; };
  at(1, 18.2); // tier B, and off the sitting's usual rate
  eye[2].face_presence_ratio = 0.84;
  Object.assign(eye[3], {
    camera_active: false, camera_inactive_reason: 'lost', blink_rate: null, blink_rate_full: null, incomplete_blink_ratio: null,
    blink_count_full: null, blink_count_micro: null, blink_count_incomplete: null, face_presence_ratio: null, off_axis_ratio: null,
    ear_sample_count: 0, observed_duration_ms: null, on_screen_ratio: null, lighting_quality: null, mean_face_luma: null,
  } satisfies Partial<EyeMetricsRecord>);
  Object.assign(eye[4], {
    ear_baseline: null, blink_rate: null, blink_rate_full: null, incomplete_blink_ratio: null,
    blink_count_full: null, blink_count_micro: null, blink_count_incomplete: null,
  } satisfies Partial<EyeMetricsRecord>);
  at(5, 12.4); // tier C
  Object.assign(eye[6], { blink_count_full: 6, blink_count_micro: 0, blink_count_incomplete: 2, incomplete_blink_ratio: 0.25, blink_rate: 2.7 } satisfies Partial<EyeMetricsRecord>);
  eye[7].off_axis_ratio = 0.27;
  Object.assign(eye[9], { lighting_quality: 'low' } satisfies Partial<EyeMetricsRecord>);
  return buildConditionSummaries(b);
}

const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-testid="camera-verdict"]'));

describe('each condition is one line: the verdict, a status per check, and the reason', () => {
  it('shows the reliability verdict of rule rel-r1 on every row, and counts them', () => {
    const s = variedSummaries();
    const el = render(createElement(EyeDataPanel, { summaries: s }));
    expect(rows(el).map((r) => r.dataset.reliability)).toEqual(s.map((x) => x.camera_verdict.reliability));
    const counts = { good: 0, usable: 0, not_usable: 0 };
    for (const x of s) counts[x.camera_verdict.reliability]++;
    expect(el.querySelector('[data-testid="reliability-counts"]')!.textContent)
      .toBe(`✓ ${counts.good} good · ! ${counts.usable} usable · ✕ ${counts.not_usable} not usable · rule rel-r1`);
    // Every verdict appears in the varied sitting, so each kind of row below is really exercised.
    expect(counts.good).toBeGreaterThan(0);
    expect(counts.usable).toBeGreaterThan(0);
    expect(counts.not_usable).toBeGreaterThan(0);
  });

  it('names the failed or flagged check under the verdict, and says nothing under a clean good row', () => {
    const s = variedSummaries();
    const el = render(createElement(EyeDataPanel, { summaries: s }));
    rows(el).forEach((r, i) => {
      const v = s[i].camera_verdict;
      const reason = r.querySelector('[data-testid="verdict-reason"]');
      if (v.reliability === 'good') expect(reason).toBeNull();
      else expect(reason!.textContent!.toLowerCase()).toBe(v.reason!.toLowerCase());
      if (v.reliability === 'good' && v.notes.length === 0) expect(r.querySelectorAll(':scope > tr:not([hidden])').length).toBe(1);
    });
    const tierC = rows(el)[5];
    expect(tierC.dataset.reliability).toBe('not_usable');
    expect(tierC.textContent).toMatch(/Eye sampling rate too slow \(12\.4 a second; 15 needed\)/);
    expect(tierC.textContent).toMatch(/12\.4 · too slow, off usual/);
  });

  it('keeps a note beside the verdict, never as a flag: few blinks leaves the blink check ✓ and the row good', () => {
    const s = variedSummaries();
    const el = render(createElement(EyeDataPanel, { summaries: s }));
    const few = rows(el)[6];
    expect(few.dataset.reliability).toBe('good');
    expect(few.querySelector('[data-testid="verdict-notes"]')!.textContent).toBe('Note: few blinks (8)');
    const cells = Array.from(few.querySelectorAll<HTMLElement>('[data-testid="quality-cell"]'));
    expect(cells.map((c) => c.dataset.status)).not.toContain('warn');
    const dim = rows(el)[9];
    expect(dim.querySelector('[data-testid="verdict-notes"]')!.textContent).toMatch(/face dimly lit/);
  });

  it('keeps every check, its rule and what the analysis does behind Details, one tap away', () => {
    const s = variedSummaries();
    const el = render(createElement(EyeDataPanel, { summaries: s }));
    const r = rows(el)[1];
    const details = r.querySelector<HTMLElement>('[data-testid="condition-details"]')!;
    expect(details.closest('tr')!.hidden).toBe(true);
    const button = Array.from(r.querySelectorAll('button')).find((b) => b.textContent === 'Details ▾')!;
    act(() => button.click());
    expect(details.closest('tr')!.hidden).toBe(false);
    for (const c of s[1].camera_verdict.checks) {
      expect(details.textContent).toContain(c.gate);
      expect(details.textContent).toContain(c.needed);
    }
    expect(details.textContent).toContain('Kept; left out of the tier-A-only re-check.');
  });
});

describe('the checks before the readings: each under its own rule, in its own verdict', () => {
  const byKey = (b: ReturnType<typeof buildFixtureBundle>) => Object.fromEntries(sittingChecks(b).map((c) => [c.key, c]));

  it('reads the baseline, the camera check and the gaze check as 01_session_info.csv does', () => {
    const c = byKey(buildFixtureBundle());
    expect(c.baseline).toMatchObject({ status: 'good', value: 'measured', rule: 'cal-r2' });
    expect(c.baseline.detail).toBe('Baseline 0.312 from 141 usable frames in 6.0 s.');
    expect(c.camera_check).toMatchObject({ status: 'good', value: 'working, 5 of 5 flashes', rule: 'st-r2' });
    expect(c.camera_check.detail).toBe('5 of 5 flashes · eye sampled 29.4 a second · face in view 100% · 1 extra blink.');
    expect(c.gaze_check).toMatchObject({ status: 'good', value: 'passed', rule: 'gaze-r2' });
  });

  it('says why a baseline is missing, and that no blink is then counted', () => {
    const b = buildFixtureBundle();
    Object.assign(b.calibration[0], { ear_baseline: null, ear_baseline_reason: 'eyes_not_measured', ear_baseline_attempts: 3 });
    const c = byKey(b).baseline;
    expect(c).toMatchObject({ status: 'bad', value: 'not measured: eyes not measured' });
    expect(c.detail).toMatch(/no blink is counted in the readings it governed/);
    expect(c.detail).toMatch(/3 tries/);
  });

  it('gives the camera check the verdict its screen gave: reduced is flagged, failed is a fail, st-r1 by its pass', () => {
    const b = buildFixtureBundle();
    b.session.camera_selftest = { ...b.session.camera_selftest!, verdict: 'reduced', tier: 'B', samplingFps: 17.3 };
    expect(byKey(b).camera_check).toMatchObject({ status: 'warn', value: 'reduced, 5 of 5 flashes' });
    b.session.camera_selftest = { ...b.session.camera_selftest!, verdict: 'failed', pass: false, detected: 2 };
    expect(byKey(b).camera_check).toMatchObject({ status: 'bad', value: 'did not pass, 2 of 5 flashes' });
    expect(byKey(b).camera_check.detail).toMatch(/continued anyway/);
    const old = { ...b.session.camera_selftest!, pass: true };
    delete (old as { verdict?: unknown }).verdict; delete (old as { rule?: unknown }).rule;
    b.session.camera_selftest = old;
    expect(byKey(b).camera_check).toMatchObject({ status: 'good', rule: 'st-r1' });
    b.session.camera_selftest = null;
    expect(byKey(b).camera_check).toMatchObject({ status: 'none', value: 'not run', rule: null });
  });

  it('calls a gaze check that did not pass "not measured", never a fault: nothing but the on-screen ratio rests on it', () => {
    const b = buildFixtureBundle();
    b.calibration[0].is_real_calibration = false;
    b.calibration[0].gaze_check = { ...b.calibration[0].gaze_check!, reason: 'not_separable' };
    expect(byKey(b).gaze_check).toMatchObject({ status: 'none', value: 'not passed: the dots did not separate' });
  });

  it('takes the LAST calibration, as 01 does, and says how many there were', () => {
    const b = buildFixtureBundle();
    b.calibration.push({ ...b.calibration[0], calibration_id: 'cal-2', calibrated_at: (b.calibration[0].calibrated_at ?? 0) + 1000, ear_baseline: 0.3 });
    const c = byKey(b).baseline;
    expect(c.detail).toMatch(/^Baseline 0\.300 /);
    expect(c.detail).toMatch(/The latest of 2 calibrations/);
  });

  it('shows them as one line of chips above the conditions, with the numbers behind More', () => {
    const el = render(createElement(EyeDataPanel, { summaries: variedSummaries(), sitting: sittingChecks(buildFixtureBundle()) }));
    const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="sitting-check"]'));
    expect(chips.map((c) => c.textContent)).toEqual([
      '✓ Open-eye baseline: measured · cal-r2', '✓ Camera check: working, 5 of 5 flashes · st-r2', '✓ Gaze check: passed · gaze-r2',
    ]);
    const more = el.querySelector<HTMLElement>('[data-testid="sitting-checks-more"]')!;
    expect(more.querySelector('[hidden]')!.textContent).toContain('Baseline 0.312 from 141 usable frames in 6.0 s.');
  });
});

describe('nothing that was on the page is lost', () => {
  it('still has the three tables, every column of them, under "Every number, as tables"', () => {
    const s = variedSummaries();
    const el = render(createElement(EyeTables, { summaries: s }));
    const heads = Array.from(el.querySelectorAll('table')).map((t) => Array.from(t.querySelectorAll('th')).map((h) => h.textContent));
    expect(heads[0]).toEqual(['Cond', 'Blinks', 'Minutes seen', 'Blink rate /min', 'Incomplete-blink ratio', 'Inter-blink interval ms', 'PERCLOS P80', 'PERCLOS P70', 'Long closures', 'Eye sampling rate (tier)']);
    expect(heads[1]).toEqual(['Cond', 'Engagement', 'Quality', 'Read ms', 'Fatigue ms', 'Flags']);
    // "Overall" (qc_overall, the superseded flags) is now the verdict; "Reading seen" is the §5.4 check.
    expect(heads[2]).toEqual(['Cond', 'Camera', 'Eye sampling rate (tier)', 'Face in view', 'Head turned away', 'Reading seen', 'On-screen ratio', 'Lighting', 'Reliability']);
    // And the full sentences of every flag, as 12_quality_flags.csv writes them.
    for (const x of s) for (const reason of x.engagement_reasons) expect(el.textContent).toContain(reason);
  });

  it('keeps each caveat\'s full text in the page, behind More', () => {
    const el = render(createElement(Caveat, { short: 'Short.', more: 'The whole caveat, word for word.' }));
    const full = Array.from(el.querySelectorAll('p')).find((p) => p.textContent === 'The whole caveat, word for word.')!;
    expect(full.closest('[hidden]')).not.toBeNull();
    act(() => el.querySelector('button')!.click());
    expect(full.closest('[hidden]')).toBeNull();
  });

  it('keeps the dashboard\'s three caveats word for word as they were before Round 83', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/dashboard/Dashboard.tsx'), 'utf8');
    for (const text of [
      "Pure colour go/no-go (~20 go trials per condition). Per-condition d′ is small-N (SE often > 0.3), so for inference aggregate d′ across conditions per participant (see the R/Python templates). RT runs in the condition's own display: the go-dot is the condition's text colour on its background, so go-target visibility varies with condition by design (yellow on white is 2.39:1). Misses therefore partly reflect the display; only commission errors (tapping no-go dots) count toward the disengagement flag.",
      'Visual-search target counts differ across passages (recorded per condition); passage↔condition decoupling makes this orthogonal to condition. WCAG ⚠ marks conditions below AA (4.5:1) — include contrast as a covariate.',
      "What these numbers mean. For visual fatigue (this study) the markers used are a LOWER blink rate and a HIGHER share of incomplete blinks (Portello, Rosenfield & Chu 2013), read with the first/second-half bins and the gap between blinks. PERCLOS counts time with the eyes mostly closed; it tracks drowsiness, so in an awake participant it is small and a value near zero is not a fault (PERCLOS: Dinges & Grace 1998, FHWA tech brief — metadata only, not yet read at source). Blink rate goes DOWN with concentrated reading and UP with sleepiness, so never read 'higher = more tired' on its own. Blink duration and the micro-blink count need 25 frames a second or more; the blink counts and the incomplete-blink ratio follow the eye sampling rate's tiers (adequate from 20). The on-screen ratio is a quality check of whether the participant looked at the tablet, and needs a passed gaze check. A webcam is a screening-grade measure; an infrared eye-tracker is the reference standard.",
    ]) expect(src).toContain(text);
  });
});

describe('one meaning for a status, on every tab', () => {
  it('counts and colours the join check by its own words: blocking is red, a warning amber', () => {
    expect(countBySeverity([{ severity: 'blocking' }, { severity: 'warning' }, { severity: 'blocking' }])).toBe('2 blocking · 1 warning');
    expect(countBySeverity([{ severity: 'warning' }])).toBe('1 warning');
    // The list tested for 'error', which storage/joinIntegrity.ts never writes: a blocking issue read amber.
    const src = readFileSync(resolve(__dirname, '..', 'src/dashboard/Dashboard.tsx'), 'utf8');
    expect(src).not.toMatch(/severity === 'error'/);
    expect(readFileSync(resolve(__dirname, '..', 'src/storage/joinIntegrity.ts'), 'utf8')).toMatch(/severity: 'blocking' \| 'warning';/);
  });


  it('opens every tab with "How to read this page", and judges eye data only by the reliability verdict', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src/dashboard/Dashboard.tsx'), 'utf8');
    expect(src).toMatch(/<HowToRead lines=\{HOW_TO_READ\[tab\]\} \/>/);
    for (const tab of ['overview', 'cohort', 'reaction', 'fatigue', 'search', 'eye', 'export']) expect(src).toMatch(new RegExp(`\\n  ${tab}: \\[\\n`));
    // The superseded per-signal flags (qc_overall) are written to the export and shown nowhere here.
    for (const f of ['src/dashboard/Dashboard.tsx', 'src/dashboard/eyeData.tsx']) {
      expect(readFileSync(resolve(__dirname, '..', f), 'utf8'), f).not.toMatch(/\.qc\.(overall|fps|facePresence|offAxis|lighting)\b/);
    }
    // The eye charts grey the bars of not-usable conditions.
    expect(src).toMatch(/dim: c\.camera_verdict\.reliability === 'not_usable'/);
  });
});
