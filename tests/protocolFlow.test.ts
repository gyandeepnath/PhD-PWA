/**
 * PROTOCOL.md's "Session flow (as implemented)" is the state machine's flow (audit 86 UI-12).
 *
 * The block went "→ CVSQ_END … → SESSION_COMPLETE thank-you; session marked complete" and left out the
 * NASA-TLX screen the app runs between them, and said completion was recorded on the thank-you screen
 * when it is recorded at the last NASA-TLX submit (OPERATOR_MANUAL). A stage list written by hand
 * drifts; this test parses the stage names out of the block and holds them to SETUP_ORDER, LOOP_ORDER
 * and the closing transitions of experiment/stateMachine.ts, as taskSteps.test.ts does for the steps.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SETUP_ORDER, LOOP_ORDER, nextState } from '@/experiment/stateMachine';
import type { Stage } from '@/storage/types';

const protocol = readFileSync(resolve(__dirname, '..', 'docs/PROTOCOL.md'), 'utf8');

/** The fenced block under "## 2. Session flow (as implemented)". */
function flowBlock(): string {
  const at = protocol.indexOf('## 2. Session flow (as implemented)');
  expect(at, 'PROTOCOL.md has no "Session flow (as implemented)" section').toBeGreaterThan(-1);
  const open = protocol.indexOf('```', at);
  const close = protocol.indexOf('```', open + 3);
  return protocol.slice(open + 3, close);
}

/**
 * Every stage name the block names, in order: the word that starts a stage's line, at the left (setup)
 * or indented once (the loop). Continuation lines are indented to the description column, past that.
 */
function stagesInBlock(): string[] {
  const out: string[] = [];
  for (const line of flowBlock().split('\n')) {
    const m = /^ {0,8}(?:→\s*)?([A-Z][A-Z_]{3,})\b/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The stages after the condition loop, from the machine's own transitions. */
function closingStages(): Stage[] {
  const out: Stage[] = [];
  let s: Stage = 'CVSQ_END';
  for (let i = 0; i < 10; i++) {
    out.push(s);
    if (s === 'EXPORT_DASHBOARD') break;
    s = nextState({ stage: s, stepIndex: 0 }, 10).stage;
  }
  return out;
}

describe('PROTOCOL.md session flow', () => {
  it('names every stage the app runs, in the order it runs them', () => {
    // The loop as the block draws it: the break sits before the grey field (stateMachine: BREAK_SCREEN →
    // ADAPTATION), every CONFIG.BREAK_EVERY_N_CONDITIONS conditions.
    const loop = LOOP_ORDER.flatMap((s) => (s === 'ADAPTATION' ? ['BREAK_SCREEN', s] : [s]));
    expect(stagesInBlock()).toEqual([...SETUP_ORDER, ...loop, ...closingStages()]);
  });

  it('includes the NASA-TLX, between the closing CVS-Q and the thank-you screen', () => {
    const s = stagesInBlock();
    expect(s.indexOf('NASA_TLX')).toBe(s.indexOf('CVSQ_END') + 1);
    expect(s.indexOf('SESSION_COMPLETE')).toBe(s.indexOf('NASA_TLX') + 1);
  });

  it('says completion is recorded at the NASA-TLX, not on the thank-you screen', () => {
    const block = flowBlock();
    expect(block).not.toMatch(/SESSION_COMPLETE[^\n]*session marked complete/);
    // Within the NASA_TLX entry, which may run over two lines.
    expect(block).toMatch(/→ NASA_TLX(?:(?!→)[\s\S])*marked complete/);
  });

  it('calls the camera the tablet\'s front camera, not a webcam', () => {
    expect(flowBlock()).not.toMatch(/webcam/i);
  });
});
