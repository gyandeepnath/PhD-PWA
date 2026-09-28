/**
 * The operator's way back and way out, stage by stage — experiment/navigation.ts holds the policy,
 * and this holds every stage to it.
 *
 * Round 62 found setup with no Back, no Cancel and no exit at all, four differently styled "back"
 * controls elsewhere, and every confirmation a native window.confirm/alert/prompt. The controls were
 * added; what must not happen next is a Back appearing on a screen where going back changes a
 * measurement — a colour-vision plate, a calibration, anything inside a condition, a questionnaire
 * after it is submitted.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { backTarget, operatorExitFor } from '@/experiment/navigation';
import { SETUP_ORDER, LOOP_ORDER } from '@/experiment/stateMachine';
import type { Stage } from '@/storage/types';
import { buildExportFiles } from '@/storage/export';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { singleRow } from './helpers/csv';

const CLOSING: Stage[] = ['CVSQ_END', 'NASA_TLX', 'SESSION_COMPLETE', 'EXPORT_DASHBOARD'];
const ALL: Stage[] = [...SETUP_ORDER, ...LOOP_ORDER, 'BREAK_SCREEN', ...CLOSING];

describe('Back exists only where the screen before can be corrected without touching a measurement', () => {
  it('is offered on exactly the profile, pre-flight and camera screens', () => {
    const withBack = ALL.filter((s) => backTarget(s) != null);
    expect(withBack.sort()).toEqual(['CAMERA_SETUP', 'PARTICIPANT_PROFILE', 'PREFLIGHT']);
    expect(backTarget('PARTICIPANT_PROFILE')).toBe('CONSENT');
    expect(backTarget('PREFLIGHT')).toBe('PARTICIPANT_PROFILE');
    // The camera grant is changed on the consent screen, and nowhere else.
    expect(backTarget('CAMERA_SETUP')).toBe('CONSENT');
  });

  it('never on a colour-vision plate, a calibration, a submitted questionnaire, the break or the close', () => {
    for (const s of ['COLOR_VISION', 'CALIBRATION', 'CVSQ_BASELINE', 'BASELINE_FATIGUE', 'INSTRUCTIONS',
      'BREAK_SCREEN', 'CVSQ_END', 'NASA_TLX', 'SESSION_COMPLETE', 'EXPORT_DASHBOARD', 'CONSENT', 'SESSION_INIT'] as Stage[]) {
      expect(backTarget(s), s).toBeNull();
    }
  });

  it('never anywhere inside a condition, from the grey field to the last reaction trial', () => {
    for (const s of LOOP_ORDER) expect(backTarget(s), s).toBeNull();
  });

  it('only ever goes to an EARLIER setup screen', () => {
    for (const s of ALL) {
      const t = backTarget(s);
      if (t == null) continue;
      expect(SETUP_ORDER.indexOf(t), `${s} -> ${t}`).toBeLessThan(SETUP_ORDER.indexOf(s));
      expect(SETUP_ORDER.indexOf(t), `${s} -> ${t}`).toBeGreaterThan(0);   // never back into SESSION_INIT
    }
  });
});

describe('the operator chip: one way out, everywhere a sitting can be left', () => {
  it('cancels the session form, which has written nothing', () => {
    expect(operatorExitFor('SESSION_INIT')).toBe('cancel');
  });
  it('exits, resumably, from every other setup screen, the break and both closing questionnaires', () => {
    for (const s of SETUP_ORDER.slice(1)) expect(operatorExitFor(s), s).toBe('exit');
    for (const s of ['BREAK_SCREEN', 'CVSQ_END', 'NASA_TLX'] as Stage[]) expect(operatorExitFor(s), s).toBe('exit');
  });
  it('is the existing Pause inside the condition-run', () => {
    for (const s of LOOP_ORDER) expect(operatorExitFor(s), s).toBe('pause');
  });
  it('is absent once the sitting is complete', () => {
    expect(operatorExitFor('SESSION_COMPLETE')).toBeNull();
    // The dashboard has its own chip, "Back to sessions", drawn by LazyDashboard.
    expect(operatorExitFor('EXPORT_DASHBOARD')).toBeNull();
  });
});

describe('no native dialog is left in the app', () => {
  /*
   * window.confirm, alert and prompt cannot be styled, say only "OK"/"Cancel", carry the site address
   * in a Chrome tab, and FREEZE the page — timers, animation frames, the camera pump. Every one was
   * replaced by the in-app dialog (components/ConfirmDialog.tsx). Comments are stripped: several
   * files explain what the old dialog did.
   */
  const root = resolve(__dirname, '..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
  it('src/ calls none of window.confirm, window.alert or window.prompt', () => {
    const hits = walk(join(root, 'src'))
      .map((p) => [relative(root, p), readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')] as const)
      .filter(([, code]) => /\bwindow\.(confirm|alert|prompt)\s*\(|(?<![.\w])(confirm|alert|prompt)\s*\(\s*[`'"]/.test(code))
      .map(([rel]) => rel);
    expect(hits).toEqual([]);
  });
});

describe('a consent given again after Back is recorded, not just overwritten', () => {
  const info = (b: ReturnType<typeof buildFixtureBundle>) =>
    singleRow(buildExportFiles(b).find((x) => x.filename === '01_session_info.csv')!.content);

  it('exports how many times consent was revisited: 0 in the ordinary case', () => {
    expect(info(buildFixtureBundle()).consent_revisions).toBe('0');
  });

  it('counts each superseded consent record, which the session JSON keeps in full', () => {
    const b = buildFixtureBundle();
    b.session = {
      ...b.session,
      consent_revisions: [{ superseded_at: 1, consent_time: 0, media_consent: { ...b.session.media_consent, camera_metrics: false } }],
    };
    expect(info(b).consent_revisions).toBe('1');
    const json = buildExportFiles(b).find((x) => /^session_.*\.json$/.test(x.filename));
    if (json) expect(json.content).toMatch(/"consent_revisions"/);
  });

  it('the Consent handler appends the superseded record rather than replacing consent silently', () => {
    const experiment = readFileSync(resolve(__dirname, '..', 'src/experiment/Experiment.tsx'), 'utf8');
    expect(experiment).toMatch(/\.\.\.\(current\.consent_given \? \{\s*consent_revisions: \[\s*\.\.\.\(current\.consent_revisions \?\? \[\]\),/);
  });
});

describe('the in-loop Pause keeps its look; the chip everywhere else is the shared one', () => {
  const experiment = readFileSync(resolve(__dirname, '..', 'src/experiment/Experiment.tsx'), 'utf8');
  it('draws the in-loop Pause only for the pause kind, and the NavChip for the rest', () => {
    expect(experiment).toMatch(/\{canPause && exitKind === 'pause' && \(/);
    expect(experiment).toMatch(/<NavChip\s+label=\{EXIT_LABEL\[exitKind\]\}/);
  });
  it('confirms Pause in the screen\'s own ink, with no scrim', () => {
    expect(experiment).toMatch(/ink: stageInk,\s*testId: 'pause-dialog'/);
    const dialog = readFileSync(resolve(__dirname, '..', 'src/components/ConfirmDialog.tsx'), 'utf8');
    expect(dialog).toMatch(/background: ink \? 'transparent' : 'rgba\(26,26,46,0\.45\)'/);
  });
  it('the dashboard has one way back, drawn in one place for both routes into it', () => {
    const lazy = readFileSync(resolve(__dirname, '..', 'src/dashboard/LazyDashboard.tsx'), 'utf8');
    expect(lazy).toMatch(/<NavChip label="← Back to sessions"/);
    const app = readFileSync(resolve(__dirname, '..', 'src/App.tsx'), 'utf8');
    expect(app).not.toMatch(/← Sessions/);
    expect(experiment).not.toMatch(/← Sessions/);
  });
});
