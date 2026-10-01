/**
 * One list of the steps of a display, and every place that names a step drawn from it.
 *
 * The instructions screen listed five numbered steps while the task screens said "Task 1 of 4" ...
 * "Task 4 of 4" and left the ratings unnumbered, so step 4 was announced as "Task 3" and step 5 as
 * "Task 4", ten times a sitting (screen audit F14). Each screen wrote its own label and nothing tied
 * them to the overview or to the state machine. experiment/taskSteps.tsx is now the only source; these
 * tests hold it to the state machine's own order and hold every screen to it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TASK_STEPS, taskStepOf, stepLabel, displayStepLabel } from '@/experiment/taskSteps';
import { LOOP_ORDER } from '@/experiment/stateMachine';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('TASK_STEPS is the state machine\'s own order of the measured stages', () => {
  it('covers every measured stage of a display exactly once, in LOOP_ORDER', () => {
    // ADAPTATION is the grey field between displays: a rest, not a step.
    const measured = LOOP_ORDER.filter((s) => s !== 'ADAPTATION');
    expect(TASK_STEPS.flatMap((s) => [...s.stages])).toEqual(measured);
  });

  it('has five steps, the two rating screens being one of them', () => {
    expect(TASK_STEPS).toHaveLength(5);
    expect(taskStepOf('DISPLAY_PERCEPTION')).toEqual(taskStepOf('POST_FATIGUE'));
    expect(taskStepOf('POST_FATIGUE')).toEqual({ number: 3, total: 5, name: 'Ratings' });
  });

  it('labels each stage by its place in the list', () => {
    expect(stepLabel('READING_TASK')).toBe('Step 1 of 5 · Reading');
    expect(stepLabel('COMPREHENSION')).toBe('Step 2 of 5 · Questions');
    expect(stepLabel('DISPLAY_PERCEPTION')).toBe('Step 3 of 5 · Ratings');
    expect(stepLabel('VISUAL_SEARCH')).toBe('Step 4 of 5 · Word search');
    expect(stepLabel('REACTION_TIME')).toBe('Step 5 of 5 · Reaction');
  });

  it('gives the grey field no step, and refuses to invent one', () => {
    expect(taskStepOf('ADAPTATION')).toBeNull();
    expect(() => stepLabel('ADAPTATION')).toThrow();
    expect(taskStepOf('BREAK_SCREEN')).toBeNull();
  });

  it('puts the display first: "Display 3 of 10 · Step 3 of 5 · Ratings"', () => {
    expect(displayStepLabel('POST_FATIGUE', { k: 3, n: 10 })).toBe('Display 3 of 10 · Step 3 of 5 · Ratings');
    // Without a position (a screen mounted outside the sitting's plan) it says the step alone.
    expect(displayStepLabel('POST_FATIGUE', undefined)).toBe('Step 3 of 5 · Ratings');
  });
});

describe('every screen names its step from TASK_STEPS, and no screen writes its own', () => {
  const LOOP_SOURCES = [
    'src/tasks/ReadingTask.tsx',
    'src/tasks/ComprehensionTask.tsx',
    'src/tasks/VisualSearchTask.tsx',
    'src/tasks/ReactionTimeTask.tsx',
    'src/tasks/TaskIntro.tsx',
    'src/scales/DisplayPerceptionRating.tsx',
    'src/scales/FatigueScale.tsx',
    'src/experiment/Experiment.tsx',
    'src/start/setupStages.tsx',
  ];

  it('no source writes a step or task number of its own', () => {
    for (const f of LOOP_SOURCES) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/Task \d of \d/);
      expect(code, f).not.toMatch(/['"`]Step \d/);
    }
  });

  it('the intro cards and the two rating screens carry "Display k of N" with the step', () => {
    // The intro cards of reading, word search and the reaction task, and both rating screens.
    expect(read('src/tasks/ReadingTask.tsx')).toMatch(/eyebrow=\{displayStepLabel\('READING_TASK', display\)\}/);
    expect(read('src/tasks/VisualSearchTask.tsx')).toMatch(/eyebrow=\{displayStepLabel\('VISUAL_SEARCH', display\)\}/);
    expect(read('src/tasks/ReactionTimeTask.tsx')).toMatch(/eyebrow=\{displayStepLabel\('REACTION_TIME', display\)\}/);
    expect(read('src/scales/DisplayPerceptionRating.tsx')).toMatch(/displayStepLabel\('DISPLAY_PERCEPTION', display\)/);
    expect(read('src/experiment/Experiment.tsx')).toMatch(/eyebrow=\{displayStepLabel\('POST_FATIGUE', displayPosition\)\}/);
  });

  it('the questions name their step alone: no display position on a screen in the condition\'s colours', () => {
    const src = read('src/tasks/ComprehensionTask.tsx');
    expect(src).toMatch(/stepLabel\('COMPREHENSION'\)/);
    expect(src).not.toMatch(/displayStepLabel/);
  });

  it('the instructions screen numbers its overview from the same list', () => {
    const src = read('src/start/setupStages.tsx');
    expect(src).toMatch(/TASK_STEPS\.map\(\(step\) =>/);
    // The overview's own five <li> lines are gone, so the list cannot drift from the eyebrows again.
    const instructions = src.slice(src.indexOf('export function Instructions'), src.indexOf('// ---- SESSION COMPLETE'));
    expect(instructions.match(/<li\b/g) ?? []).toHaveLength(1);
  });
});
