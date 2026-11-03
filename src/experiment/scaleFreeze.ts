/**
 * When the display scale is frozen: for ONE display's stimulus, from "Begin reading" to the end of its
 * reaction block (Round 87, audit 86 F5). See lib/viewportScale.ts for what freezing does — the scale
 * may shrink, if the screen genuinely shrinks, so content stays reachable, and never grows.
 *
 * It used to be frozen on every stage of the condition loop, and the loop includes the grey field
 * between displays (ADAPTATION) and the reading screen's instruction card. A freeze cannot lapse into
 * another freeze, so a shrink taken in one display — a turn to portrait and back, a system bar, a
 * floating window — stayed for every display until the next break. In the audit a 0.6 s turn during
 * display 1 drew the whole of display 2 at 62% of its size (text 13.6 px instead of 22), with
 * stimulus_scale_changes 0 on display 2's row: nothing on it said the shrink was inherited.
 *
 * Now the scale is re-measured from scratch (refitScale) on the grey field and on the reading screen
 * while its instruction card is up — screens with no stimulus on them — and frozen when the passage is
 * shown. Every display's stimulus therefore starts at the full fitted size the sitting was calibrated
 * at, and only a shrink DURING that display's own stimulus can make it smaller, which its row counts.
 * Inside a display nothing is re-fitted: the questions are set at the passage's size, and a scale that
 * grew between the passage and its questions would be another stimulus.
 *
 * Versioned (scale_freeze_version in 02_conditions.csv): 'sf-v2' from this round; 'sf-v1' for rows
 * without it, whose stimulus_scale was read when the reading screen mounted and could carry an earlier
 * display's shrink, and whose stimulus_scale_changes counted from that mount.
 */
import type { Stage } from '@/storage/types';
import { isInLoop } from './stateMachine';

export const SCALE_FREEZE_VERSION = 'sf-v2';
/** Rows without a version: frozen across the whole condition loop, the grey field included. */
export const SCALE_FREEZE_VERSION_V1 = 'sf-v1';

/**
 * Whether the scale is frozen on `stage`. On READING_TASK it depends on whether the passage is up:
 * the instruction card is not a stimulus, the passage is. Calibration is frozen too, for its own
 * reason: its targets are placed on the scaled canvas.
 */
export function scaleFrozenOn(stage: Stage, passageShown: boolean): boolean {
  if (stage === 'CALIBRATION') return true;
  if (!isInLoop(stage) || stage === 'ADAPTATION') return false;
  if (stage === 'READING_TASK') return passageShown;
  return true;
}
