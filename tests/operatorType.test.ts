/**
 * Sentences and buttons on the set-up screens and the sitting's notices are set in Roboto, at 14 px
 * or more; the monospace face is kept for what is typed and for codes and numbers (audit 86 UI-3, UI-9).
 *
 * The rule has stood since Round 61 ("sentences in Roboto, monospace kept for inputs, codes and
 * numbers"), but nothing held a file to it: tests/contrast.test.ts checks these files' colours and
 * sizes, and tests/loopText.test.ts bans the monospace face on the condition screens only. So the
 * participant's calibration instructions, the "No eye baseline" explanation, the camera check's intro,
 * result and buttons, the colour screen's answer buttons' neighbours and the "camera has stopped"
 * notice were all set in DM Mono; and on that notice the sentence saying what "Continue without the
 * camera" costs was 12 px, the smallest text on the screen, because the notice was written inline in
 * Experiment.tsx, outside every size check.
 *
 * Every monospace use left in these files is counted here with the reason it is allowed. A new one
 * fails this test until it is given a reason or set in Roboto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wcagContrastRatio } from '@/lib/contrast';
import { CAMERA_NOTICE_COLOURS } from '@/experiment/CameraLostNotice';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
/** The source with its comments removed: a rule quoted in a comment is not a use. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
/** A line that sets the monospace face, by class or by name. */
const MONO = /\bfont-lab\b|DM Mono|\bfont-mono\b|monospace/;

/** The monospace uses each file may keep, and why. Anything else in it is a sentence or a button. */
const ALLOWED: Record<string, { n: number; why: string }> = {
  'src/start/setupStages.tsx': {
    n: 4,
    why: 'the input fields (VL_INPUT_CSS: codes and numbers are typed), and the grey adaptation field\'s '
      + 'three lines (AdaptationScreen): a screen of the display sequence, before every display, left as it '
      + 'is — changing what the participant sees there is the investigator\'s decision (Round 90)',
  },
  'src/start/CalibrationRoutine.tsx': {
    n: 3,
    why: 'the three lines drawn WHILE the eye is measured (the status under the centre dot, "Once more — look '
      + 'at the dot", the step row): changing them changes the screen the baseline is taken on',
  },
  'src/start/CameraSelfTest.tsx': {
    n: 1,
    why: 'the line drawn while the flashes run and the blinks are measured ("Blink when the dot flashes · 2 of 5")',
  },
  'src/screening/IshiharaTest.tsx': { n: 1, why: 'the plate answer buttons: digits' },
  'src/experiment/CameraLostNotice.tsx': { n: 0, why: '' },
  'src/experiment/Experiment.tsx': { n: 0, why: '' },
  'src/start/BreakScreen.tsx': { n: 0, why: '' },
  'src/start/LuxCheckpoint.tsx': { n: 1, why: 'the lux input field' },
  'src/start/ScreenCalibration.tsx': { n: 1, why: 'the ruler and distance input fields (one shared style)' },
  'src/components/ConfirmDialog.tsx': { n: 1, why: 'the typed-confirmation input field' },
  'src/components/ErrorBoundary.tsx': { n: 0, why: '' },
  'src/scales/Cvsq.tsx': { n: 0, why: '' },
  'src/scales/NasaTlx.tsx': { n: 0, why: '' },
};

describe('the operator type: sentences and buttons in Roboto', () => {
  for (const [f, { n, why }] of Object.entries(ALLOWED)) {
    it(`${f}: ${n} monospace use${n === 1 ? '' : 's'}${why ? ` — ${why.split(':')[0]}` : ''}`, () => {
      const uses = code(f).split('\n').filter((l) => MONO.test(l));
      expect(uses.map((l) => l.trim().slice(0, 120)), f).toHaveLength(n);
    });
  }
});

describe('the camera notice is held to the operator floor', () => {
  it('lives in its own file, which the size and colour checks read', () => {
    const contrast = read('tests/contrast.test.ts');
    expect(contrast).toMatch(/'src\/experiment\/CameraLostNotice\.tsx'/);
    expect(read('src/experiment/Experiment.tsx')).not.toMatch(/data-testid="camera-lost"/);
  });

  it('every text colour on it is at least 4.5:1 on its ground (the consequence sentence was #8fa0c0)', () => {
    const { ground, ...inks } = CAMERA_NOTICE_COLOURS;
    for (const [name, ink] of Object.entries(inks)) expect(wcagContrastRatio(ink, ground), name).toBeGreaterThanOrEqual(4.5);
    expect(code('src/experiment/CameraLostNotice.tsx')).not.toMatch(/#8fa0c0/i);
  });

  it('sets nothing below 14 px, the consequence sentence included', () => {
    const src = code('src/experiment/CameraLostNotice.tsx');
    for (const m of src.matchAll(/fontSize:\s*(\d+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14);
    expect(src).not.toMatch(/\btext-xs\b/);
    expect(src).not.toMatch(/opacity:\s*0?\.\d/);
  });
});
