/**
 * Every move of the stage machine is made FROM a named screen, and only while that screen is on show.
 *
 * WHY (Round 86, audit 86 F14). Experiment's advance() used to move the machine on from wherever it
 * then was, behind one lock: a ref set by the first call and cleared when the stage changed. That
 * stops a second call made BEFORE the change, and nothing after it — and the calls that come late are
 * the completion handlers, which await their writes before they advance. A double tap on the camera
 * check's Continue ran its handler twice: the first copy moved on to the baseline CVS-Q, the second
 * found the lock released and moved on from THAT, so the sitting's pre-exposure CVS-Q (the reference
 * for the change score, which cannot be taken afterwards) was never shown. On a resume, the same second
 * call skipped the break and its illuminance reading.
 *
 * So a move names the screen it leaves — the stage and the condition (stepIndex) it belongs to, which
 * is what the render that drew the screen holds — and is refused once that screen has gone. It is
 * checked twice: against the screen last COMMITTED (so a call from a screen already replaced is a
 * no-op), and inside the state update (so two calls queued in one tick cannot both apply). The lock
 * still refuses a second call from the same screen before the first has committed.
 */
import { useCallback, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { MachineState } from './stateMachine';

/** The same screen: the same stage of the same condition. */
export function sameScreen(a: MachineState, b: MachineState): boolean {
  return a.stage === b.stage && a.stepIndex === b.stepIndex;
}

export interface StageTransitions {
  /** `from` is the screen on show. */
  isShown: (from: MachineState) => boolean;
  /**
   * Move from `from` to the screen `decide` returns, if `from` is still on show and no move from it is
   * under way. `decide` runs only when the move is accepted, so it may carry the move's own side effects
   * (popping the Back stack, consuming a resume jump). True when the move was made. A `decide` that
   * names the screen already on show moves nothing and leaves no lock behind: there is no commit to
   * release one (the launch check's own successor in nextState is itself).
   */
  move: (from: MachineState, decide: () => MachineState) => boolean;
  /**
   * A screen's completion handler, made safe to call twice: a call is ignored while the same handler on
   * the same screen is still running (a double tap during its writes), while a move from that screen is
   * under way, or once the screen has gone. Released when the handler settles, so one that fails, or
   * that returns without moving on, can be run again. `key` names the handler among the screen's own.
   */
  once: <A extends unknown[], R>(from: MachineState, key: string, fn: (...args: A) => R) => (...args: A) => R | undefined;
}

export function useStageTransitions(
  machine: MachineState,
  setMachine: Dispatch<SetStateAction<MachineState>>,
): StageTransitions {
  const shown = useRef(machine);
  const moving = useRef(false);
  /** Completion handlers running now, as `stage#stepIndex#key`. */
  const running = useRef(new Set<string>());
  // In the commit that changes the screen, before anything on the new screen can be tapped. A child's
  // layout effects run before this one, so no screen may complete from its own layout effect; none does
  // (their completion handlers run from taps, timers and passive effects, all after this).
  useLayoutEffect(() => {
    shown.current = machine;
    moving.current = false;
  }, [machine]);

  const isShown = useCallback((from: MachineState) => sameScreen(shown.current, from), []);

  const move = useCallback((from: MachineState, decide: () => MachineState) => {
    if (!sameScreen(shown.current, from) || moving.current) return false;
    // Decided from `from`, which is the state the update below applies to: a machine state is its
    // stage and condition, and the update applies only when both are still `from`'s.
    const to = decide();
    if (sameScreen(to, from)) return false;
    moving.current = true;
    setMachine((m) => (sameScreen(m, from) ? to : m));
    return true;
  }, [setMachine]);

  /*
   * Why handlers too, and not only the move: a handler writes before it moves on — the CVS-Q clears this
   * sitting's baseline row and writes one, the workload questionnaire appends its row, the thank-you
   * button takes the closing photograph — so a second copy started during those writes doubles them
   * (two baseline rows, two workload rows, two closing photographs) even though its move is refused.
   */
  const once = useCallback(<A extends unknown[], R>(from: MachineState, key: string, fn: (...args: A) => R) =>
    (...args: A): R | undefined => {
      const k = `${from.stage}#${from.stepIndex}#${key}`;
      if (!sameScreen(shown.current, from) || moving.current || running.current.has(k)) return undefined;
      running.current.add(k);
      const release = () => { running.current.delete(k); };
      let out: R;
      try { out = fn(...args); } catch (err) { release(); throw err; }
      if (out instanceof Promise) {
        // Released either way, and handed back, so a caller that awaits the handler (the colour-vision
        // screen persists before its notice) still does; a failure still rejects, as it did unwrapped.
        return out.then((v: unknown) => { release(); return v; }, (err: unknown) => { release(); throw err; }) as R;
      }
      release();
      return out;
    }, []);

  return { isShown, move, once };
}
