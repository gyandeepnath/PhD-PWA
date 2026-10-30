/**
 * A move of the stage machine is made FROM a named screen, and only while that screen is on show
 * (Round 86, audit 86 F14). Rendered for real in jsdom: the hook Experiment uses, driven the way a double
 * tap drove it — a completion handler created on one screen, run twice, the second copy finishing after
 * the first has already moved the machine on.
 */
import { describe, it, expect } from 'vitest';
import { createElement, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStageTransitions, sameScreen, type StageTransitions } from '@/experiment/useStageTransitions';
import { nextState, type MachineState } from '@/experiment/stateMachine';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Experiment's advance(), reduced to what matters here: bound to the screen its render shows. */
function harness(start: MachineState) {
  const seen: { machine: MachineState; advance: () => void; t: StageTransitions }[] = [];
  let effects = 0;
  function Host() {
    const [machine, setMachine] = useState(start);
    const t = useStageTransitions(machine, setMachine);
    const advance = () => { t.move(machine, () => { effects += 1; return nextState(machine, 10); }); };
    seen.push({ machine, advance, t });
    return null;
  }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => { root.render(createElement(Host)); });
  return {
    /** The latest render: what is on show, and the advance() a handler created now would hold. */
    now: () => seen[seen.length - 1],
    effects: () => effects,
    unmount: () => act(() => root.unmount()),
  };
}

const CALIBRATION: MachineState = { stage: 'CALIBRATION', stepIndex: 0 };

describe('a stage move is addressed to the screen it leaves', () => {
  it('a late second call from a screen already left moves nothing (the camera check double tap)', () => {
    const h = harness(CALIBRATION);
    const onCalibration = h.now().advance; // the self-test's handler, created on CALIBRATION
    act(() => { onCalibration(); });
    expect(h.now().machine.stage).toBe('CVSQ_BASELINE');
    // The second tap's copy of the handler finishes its writes and advances — from CALIBRATION.
    act(() => { onCalibration(); });
    expect(h.now().machine.stage).toBe('CVSQ_BASELINE'); // it used to reach BASELINE_FATIGUE
    expect(h.effects()).toBe(1); // and its side effects (a Back-stack pop, a resume jump) never ran
    h.unmount();
  });

  it('two calls from the same screen in one tick make one move', () => {
    const h = harness(CALIBRATION);
    const a = h.now().advance;
    act(() => { a(); a(); });
    expect(h.now().machine.stage).toBe('CVSQ_BASELINE');
    expect(h.effects()).toBe(1);
    h.unmount();
  });

  it('the screen now on show moves normally, and a loop stage is told apart by its condition', () => {
    const h = harness(CALIBRATION);
    act(() => { h.now().advance(); });
    act(() => { h.now().advance(); });
    expect(h.now().machine.stage).toBe('BASELINE_FATIGUE');
    expect(sameScreen({ stage: 'READING_TASK', stepIndex: 2 }, { stage: 'READING_TASK', stepIndex: 3 })).toBe(false);
    expect(h.now().t.isShown(CALIBRATION)).toBe(false);
    expect(h.now().t.isShown(h.now().machine)).toBe(true);
    h.unmount();
  });

  it('a move to the screen already on show leaves no lock behind (the launch check names itself)', () => {
    const h = harness({ stage: 'LAUNCH_CHECK', stepIndex: 3 });
    // nextState(LAUNCH_CHECK) is LAUNCH_CHECK: nothing commits, so nothing would ever release a lock.
    act(() => { h.now().advance(); });
    expect(h.now().machine).toEqual({ stage: 'LAUNCH_CHECK', stepIndex: 3 });
    // The screen's own hand-over still works afterwards.
    act(() => { h.now().t.move(h.now().machine, () => ({ stage: 'ADAPTATION', stepIndex: 2 })); });
    expect(h.now().machine).toEqual({ stage: 'ADAPTATION', stepIndex: 2 });
    h.unmount();
  });
});

describe('a completion handler runs once per screen', () => {
  it('a second call while the first is still writing is ignored; once it settles, the screen has gone', async () => {
    const h = harness({ stage: 'CVSQ_BASELINE', stepIndex: 0 });
    let writes = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const screen = h.now();
    const onComplete = screen.t.once(screen.machine, 'cvsq', async () => { writes += 1; await gate; screen.advance(); });
    let first!: Promise<void> | undefined;
    act(() => { first = onComplete(); });
    expect(onComplete()).toBeUndefined(); // the double tap, during the write
    await act(async () => { release(); await first; });
    expect(h.now().machine.stage).toBe('BASELINE_FATIGUE');
    expect(onComplete()).toBeUndefined(); // a third, late copy: its screen is gone
    expect(writes).toBe(1);
    h.unmount();
  });

  it('a handler that fails is released, so the operator can try again', async () => {
    const h = harness({ stage: 'NASA_TLX', stepIndex: 9 });
    const screen = h.now();
    let tries = 0;
    const onComplete = screen.t.once(screen.machine, 'tlx', async () => { tries += 1; if (tries === 1) throw new Error('quota'); });
    await expect(onComplete()).rejects.toThrow('quota');
    await onComplete();
    expect(tries).toBe(2);
    h.unmount();
  });
});

describe('Experiment moves its machine only through the screen-addressed move', () => {
  it('has no other route to a new stage than move(), apart from the resume landing', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/experiment/Experiment.tsx', 'utf8');
    expect(src).toMatch(/useStageTransitions\(machine, setMachine\)/);
    // The resume effect's two landings (LAUNCH_CHECK, or the stage the resume owes) set the machine
    // before any screen of this mount has been on show; every other change is a move from a screen.
    expect(src.match(/\bsetMachine\(/g) ?? []).toHaveLength(2);
    expect(src).not.toMatch(/transitioning\.current/);
  });
});
