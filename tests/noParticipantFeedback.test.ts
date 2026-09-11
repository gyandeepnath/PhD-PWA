/**
 * The instruments must not tell the participant how they are doing.
 *
 * The protocol forbids performance feedback in five places, and the operator manual forbids the
 * OPERATOR from giving any. Two screens gave it anyway, and both have been changed — but a removal
 * that leaves the wiring in place is one line from being undone, so this is the test that keeps
 * them changed.
 *
 *   THE FATIGUE SCALE showed the composite and, beside it, a colour-coded "Δ +2.3 vs baseline",
 *   red when worse and green when better, after every one of the ten conditions. That is the
 *   strongest form of feedback there is on a repeated self-report outcome: a comparative judgement
 *   against the participant's own earlier state, coded for valence. It feeds each rating into the
 *   next and makes the fatigue trajectory partly a report of what the participant was just told
 *   about themselves — on a dependent variable.
 *
 *   THE COMPREHENSION SCREEN held for a second after each answer, outlining the correct option
 *   green and a wrong choice red. Thirty of those across a sitting, and the synopsis rests its
 *   whole no-differential-effort argument on their absence. The marker colours were hard-coded, so
 *   they were also far more visible in one polarity than the other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONFIG } from '@/experiment/config';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the fatigue scale is not given the participant’s baseline', () => {
  const scale = read('src/scales/FatigueScale.tsx');
  const experiment = read('src/experiment/Experiment.tsx');

  it('does not accept it as a prop', () => {
    // It survived the first removal as a parameter the experiment passed and the component
    // accepted and ignored, under a comment reading "no longer used". A comment does not stop the
    // next edit; not having the value here does.
    const props = scale.slice(scale.indexOf('interface Props'), scale.indexOf('}', scale.indexOf('interface Props')));
    expect(props).not.toMatch(/baseline/i);
  });

  it('is not passed it', () => {
    expect(experiment).not.toMatch(/baselineMean=/);
  });

  it('shows neither a composite nor a delta', () => {
    // The render body may DISCUSS the removed readout at length, so strip comments before matching.
    const code = scale.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/vs baseline/i);
    expect(code).not.toMatch(/Δ/);
  });
});

describe('the comprehension screen does not mark answers', () => {
  it('holds for zero milliseconds after an answer', () => {
    // Kept as a named constant at 0 rather than deleted, so the intent is explicit and a future
    // edit cannot reintroduce the dwell by accident.
    expect(CONFIG.COMPREHENSION_FEEDBACK_MS).toBe(0);
  });

  it('renders no correct/incorrect colouring', () => {
    const code = read('src/tasks/ComprehensionTask.tsx')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // The hard-coded markers were a green outline on the correct option and a red one on the
    // chosen wrong answer — 4.5x more visible in negative polarity than positive.
    expect(code).not.toMatch(/#2e7d46|#22c97a|#e64c4c|'green'|'red'/);
  });
});
