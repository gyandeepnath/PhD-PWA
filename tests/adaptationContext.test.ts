/**
 * What the eye saw just before the grey field, recorded beside a rule that does not look at it
 * (Round 92, audit 86 P8).
 *
 * The grey field's maximum (60 s, or 120 s "when polarity switches") and polarity_switched both follow the
 * previous DISPLAY's polarity. After a break — a light screen — and before the first display, the eye comes
 * to the field light-adapted whatever the previous display was. Whether the maximum should follow that is
 * the investigator's decision (ANALYSIS_PLAN.md defines polarity_switched as a carryover code, for which the
 * present rule is right), so the behaviour is unchanged and pinned here; what changes is that each
 * condition now records which screen its grey field followed (adaptation_preceded_by), so either rule can
 * be applied in analysis. The counts quoted in the codebook and the documents are walked from the real
 * state machine over the ten Williams rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adaptationPrecededBy, greyFieldMaximum } from '@/experiment/adaptationContext';
import { nextState, type MachineState } from '@/experiment/stateMachine';
import { blockPlan } from '@/experiment/counterbalance';
import { CONDITIONS } from '@/experiment/conditions';
import { CONFIG } from '@/experiment/config';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles, CODEBOOK } from '@/storage/export';
import { buildAnalysisDataset, ANALYSIS_LONG_COLUMNS } from '@/storage/analysisExport';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';
import { splitCsvRow } from './helpers/csv';

describe('which screen a grey field followed', () => {
  it('the previous display\'s reaction task, a break, or a set-up or resume screen', () => {
    expect(adaptationPrecededBy('REACTION_TIME')).toBe('reaction_task');
    expect(adaptationPrecededBy('BREAK_SCREEN')).toBe('break');
    for (const s of ['INSTRUCTIONS', 'CALIBRATION', 'LAUNCH_CHECK', null]) expect(adaptationPrecededBy(s)).toBe('setup_or_resume');
  });

  it('the maximum still follows the previous display: unchanged', () => {
    expect(greyFieldMaximum(undefined, 'negative')).toEqual({ switched: false, maxMs: CONFIG.ADAPTATION_SAME_POLARITY_MS });
    expect(greyFieldMaximum('negative', 'negative')).toEqual({ switched: false, maxMs: CONFIG.ADAPTATION_SAME_POLARITY_MS });
    expect(greyFieldMaximum('negative', 'positive')).toEqual({ switched: true, maxMs: CONFIG.ADAPTATION_SWITCH_POLARITY_MS });
  });
});

describe('the post-break fields over the ten Williams rows (the open decision, counted)', () => {
  const walk = () => {
    const fields: { after: string; switched: boolean; next: string; prev: string | undefined }[] = [];
    for (let enrolment = 1; enrolment <= 10; enrolment++) {
      const plan = blockPlan(enrolment, 0);
      let st: MachineState = { stage: 'INSTRUCTIONS', stepIndex: 0 } as MachineState;
      for (let guard = 0; guard < 300 && st.stage !== 'CVSQ_END'; guard++) {
        const next = nextState(st, plan.length);
        if (next.stage === 'ADAPTATION') {
          const prev = next.stepIndex >= 0 ? plan[next.stepIndex] : undefined;
          const upcoming = plan[next.stepIndex + 1];
          const nextPolarity = CONDITIONS[upcoming.conditionIndex].polarity;
          const { switched } = greyFieldMaximum(prev && CONDITIONS[prev.conditionIndex].polarity, nextPolarity);
          fields.push({ after: adaptationPrecededBy(st.stage), switched, next: nextPolarity, prev: prev && CONDITIONS[prev.conditionIndex].polarity });
        }
        st = next;
      }
    }
    return fields;
  };

  it('100 fields: 10 after set-up, 40 after a break, 50 after a display', () => {
    const f = walk();
    expect(f).toHaveLength(100);
    expect(f.filter((x) => x.after === 'setup_or_resume')).toHaveLength(10);
    expect(f.filter((x) => x.after === 'break')).toHaveLength(40);
    expect(f.filter((x) => x.after === 'reaction_task')).toHaveLength(50);
  });

  it('after a break, 20 of 40 fields carry the opposite of the adaptation step the eye makes; 5 of 10 first displays are dark at 60 s', () => {
    const f = walk();
    // From a light screen the eye steps down only to a dark display.
    const opposite = f.filter((x) => x.after === 'break' && x.switched !== (x.next === 'negative'));
    expect(opposite).toHaveLength(20);
    // They are exactly the post-break fields whose previous display was dark, as the documents say: a dark
    // display after it (8: 60 s, FALSE) and a light one (12: 120 s, TRUE). After a light display the code
    // and the eye's step agree.
    expect(opposite.every((x) => x.prev === 'negative')).toBe(true);
    expect(f.filter((x) => x.after === 'break' && x.prev === 'negative')).toHaveLength(20);
    expect(opposite.filter((x) => x.next === 'negative' && !x.switched)).toHaveLength(8);
    expect(opposite.filter((x) => x.next === 'positive' && x.switched)).toHaveLength(12);
    const darkFirst = f.filter((x) => x.after === 'setup_or_resume' && x.next === 'negative');
    expect(darkFirst).toHaveLength(5);
    expect(darkFirst.every((x) => !x.switched)).toBe(true);
    // After a display the two codes agree by construction: the eye was on that display's background.
    expect(f.filter((x) => x.after === 'reaction_task').length).toBe(50);
  });
});

describe('exported and documented', () => {
  it('02 and analysis_long carry adaptation_preceded_by, blank where it was not recorded', () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => ({ ...c, adaptation_preceded_by: i === 0 ? 'setup_or_resume' : i === 1 ? 'reaction_task' : i === 2 ? 'break' : undefined }));
    const c02 = buildExportFiles(b).find((f) => f.filename === '02_conditions.csv')!.content.trim().split('\n');
    const col = splitCsvRow(c02[0]).indexOf('adaptation_preceded_by');
    expect(c02.slice(1, 5).map((l) => splitCsvRow(l)[col])).toEqual(['setup_or_resume', 'reaction_task', 'break', '']);
    expect(ANALYSIS_LONG_COLUMNS).toContain('adaptation_preceded_by');
    const long = buildAnalysisDataset([b]).files.find((f) => f.filename === 'analysis_long.csv')!.content.trim().split('\n');
    const lc = splitCsvRow(long[0]).indexOf('adaptation_preceded_by');
    expect(new Set(long.slice(1).map((l) => splitCsvRow(l)[lc]))).toEqual(new Set(['setup_or_resume', 'reaction_task', 'break', '']));
    expect(CODEBOOK.find((r) => r.file === '02_conditions.csv' && r.column === 'adaptation_preceded_by')).toBeTruthy();
    expect(CODEBOOK.find((r) => r.column === 'adaptation_ms_planned')!.description).toMatch(/investigator's open decision/);
    expect(ANALYSIS_CODEBOOK.find((r) => r.column === 'polarity_switched')!.description).toMatch(/not an adaptation-state code/);
  });

  it('the grey field records what it followed, from the stage shown before it, when it ends', () => {
    const src = readFileSync(resolve(__dirname, '../src/experiment/Experiment.tsx'), 'utf8');
    expect(src).toMatch(/adaptationAfter\.current = adaptationPrecededBy\(stageBefore\.current\);\s*advance\(\);/);
    expect(src).toMatch(/adaptation_preceded_by: adaptationFollowed,/);
    expect(src).toMatch(/const \{ maxMs: dur \} = greyFieldMaximum\(/);
  });
});
