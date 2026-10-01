/**
 * The words around the stimulus, inside a display: legible, in full ink, and the same on every screen.
 *
 * Every condition screen draws its chrome in the condition's own ink, so text set small or
 * translucent there is hardest to read in exactly the low-contrast conditions — instruction
 * legibility varying with the factor under test (screen audit F9). The eyebrows were 12 px DM Mono
 * (10.3 CSS px on the tablet at the old scale), the fatigue scale's "0" and "10" 11 px, the reading
 * page's counter 12 px over a page bar at 60% alpha, the reaction task's counter 12 px at half
 * opacity. Five primary-button styles sat in three positions (F17).
 *
 * The rules live in src/tasks/loopChrome.tsx; this file reads the condition-screen sources for them.
 * It is static — it proves what is written, not what renders. e2e/loopChrome.spec.ts measures the
 * rendered sizes, inks and positions on every screen of a display at the tablet's viewports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOOP_TEXT_MIN_PX } from '@/tasks/loopChrome';
import { FACE_PX } from '@/components/NavChip';
import { STIMULUS_PAGE_PAD_TOP_PX } from '@/tasks/stimulusPage';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');
/** The source with its comments removed: a rule quoted in a comment is not a violation. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** Every screen a participant meets inside a display, and the chrome they share. */
const LOOP_SCREENS = [
  'src/tasks/TaskIntro.tsx',
  'src/tasks/ReadingTask.tsx',
  'src/tasks/ComprehensionTask.tsx',
  'src/scales/DisplayPerceptionRating.tsx',
  'src/scales/FatigueScale.tsx',
  'src/tasks/VisualSearchTask.tsx',
  'src/tasks/ReactionTimeTask.tsx',
  'src/tasks/loopChrome.tsx',
];

describe('text on a condition screen is at least 16 design px, in the stimulus face', () => {
  it('the floor is 16', () => {
    expect(LOOP_TEXT_MIN_PX).toBe(16);
  });

  it('no literal font size below the floor', () => {
    for (const f of LOOP_SCREENS) {
      for (const m of code(f).matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)) {
        expect(Number(m[1]), `${f}: fontSize ${m[1]}`).toBeGreaterThanOrEqual(LOOP_TEXT_MIN_PX);
      }
    }
  });

  it('no small utility sizes and no monospace labels', () => {
    for (const f of LOOP_SCREENS) {
      const src = code(f);
      expect(src, f).not.toMatch(/\btext-(xs|sm)\b/);
      expect(src, f).not.toMatch(/\btext-\[(1[0-5]|[0-9])px\]/);
      // font-lab is the 12 px DM Mono face the old labels used.
      expect(src, f).not.toMatch(/\bfont-lab\b/);
      expect(src, f).not.toMatch(/DM Mono/);
    }
  });

  it('the in-loop Pause chip is the shared chip at 17 px in a 34 px face that clears the page header', () => {
    const src = code('src/components/NavChip.tsx');
    const face = src.slice(src.indexOf('-face`'), src.indexOf('{label}'));
    expect(face).toMatch(/fontSize: 17/);
    expect(face).toMatch(/height: FACE_PX/);
    // The target starts 1 px down and is centred on the face: at scale 1 the face ends 6 px above
    // the column's content.
    expect(1 + (44 - FACE_PX) / 2 + FACE_PX).toBeLessThanOrEqual(STIMULUS_PAGE_PAD_TOP_PX - 6);
  });
});

describe('nothing a participant reads is translucent', () => {
  it('no opacity below 1 on any condition screen', () => {
    for (const f of LOOP_SCREENS) expect(code(f), f).not.toMatch(/opacity:\s*0?\.\d/);
  });

  /*
   * The ink with an alpha suffix (text + '20', `${text}40`) is allowed ONLY on decoration nobody has
   * to read, each listed here with its reason. Anything else — a text colour, a selection marker, a
   * counter — is a violation.
   */
  const DECORATION: Record<string, RegExp[]> = {
    // The 1 px rule above the footer row.
    'src/tasks/ReadingTask.tsx': [/borderTop: `1px solid \$\{text\}20`/],
    'src/tasks/VisualSearchTask.tsx': [
      /borderTop: `1px solid \$\{text\}20`/,
      // The 1 px rule under the search header.
      /height: 1, background: text \+ '40'/,
      // A found word's tint, under its full-ink 2 px underline, which is the marker that carries it.
      /backgroundColor: foundIdx\.has\(tok\.i\) \? text \+ '30' : 'transparent',\s*borderBottom: foundIdx\.has\(tok\.i\) \? `2px solid \$\{text\}`/,
    ],
  };

  it('ink with alpha appears only on the listed decoration', () => {
    for (const f of LOOP_SCREENS) {
      let src = code(f);
      for (const ok of DECORATION[f] ?? []) {
        expect(src, `${f}: expected decoration ${ok}`).toMatch(ok);
        src = src.replace(ok, '');
      }
      expect(src, f).not.toMatch(/\btext \+ '[0-9a-f]{2}'|\$\{text\}[0-9a-f]{2}\b/i);
    }
  });

  it('the chosen answer is marked in full ink, reversed, not by a tint', () => {
    const src = code('src/tasks/ComprehensionTask.tsx');
    expect(src).toMatch(/i === selected\s*\?\s*\{ borderColor: text, background: text, color: background \}/);
  });

  it('the reaction task has no trial counter at all, at any opacity', () => {
    const src = code('src/tasks/ReactionTimeTask.tsx');
    expect(src).not.toMatch(/\/\$\{totalScored\}|trialNum/);
  });
});

describe('one eyebrow, one counter, one primary button', () => {
  it('every condition screen draws its eyebrow and counter with the shared components', () => {
    for (const f of ['src/tasks/TaskIntro.tsx', 'src/tasks/ComprehensionTask.tsx', 'src/scales/DisplayPerceptionRating.tsx', 'src/scales/FatigueScale.tsx']) {
      expect(code(f), f).toMatch(/<Eyebrow\b/);
    }
    for (const f of ['src/tasks/ReadingTask.tsx', 'src/tasks/ComprehensionTask.tsx', 'src/tasks/VisualSearchTask.tsx']) {
      expect(code(f), f).toMatch(/<Counter\b/);
    }
  });

  it('no condition screen rolls its own button: the primary action is PrimaryButton', () => {
    // The intro card (reading, search and the reaction task's), the reading and search footers, the
    // questions, the two rating screens.
    for (const f of ['src/tasks/TaskIntro.tsx', 'src/tasks/ReadingTask.tsx', 'src/tasks/VisualSearchTask.tsx',
      'src/tasks/ComprehensionTask.tsx', 'src/scales/DisplayPerceptionRating.tsx', 'src/scales/FatigueScale.tsx']) {
      expect(code(f), f).toMatch(/<PrimaryButton\b/);
    }
    // The only other <button> inside a display is an answer option.
    for (const f of ['src/tasks/TaskIntro.tsx', 'src/tasks/ReadingTask.tsx', 'src/tasks/VisualSearchTask.tsx',
      'src/scales/DisplayPerceptionRating.tsx', 'src/scales/FatigueScale.tsx', 'src/tasks/ReactionTimeTask.tsx']) {
      expect(code(f), f).not.toMatch(/<button\b/);
    }
    expect(code('src/tasks/ComprehensionTask.tsx').match(/<button\b/g) ?? []).toHaveLength(1);
  });

  it('the reaction task\'s instructions are the shared intro card', () => {
    expect(code('src/tasks/ReactionTimeTask.tsx')).toMatch(/<TaskIntro\b/);
  });
});

describe('no fixed-colour chrome over a display', () => {
  it('the wake-lock warning is not drawn inside the condition-run', () => {
    expect(read('src/experiment/Experiment.tsx')).toMatch(/\{wakeLockUnsupported && !isInLoop\(machine\.stage\) && \(/);
  });
});
