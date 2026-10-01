/**
 * The five steps of every display, in the order the participant meets them — the ONE list the
 * instructions screen numbers and every in-loop eyebrow names.
 *
 * WHY ONE LIST. The instructions screen listed five numbered steps (read, answer, rate, find, tap),
 * while the task screens said "Task 1 of 4 · Reading", "Task 2 of 4 · Comprehension", then nothing on
 * the two rating screens, then "Task 3 of 4 · Visual search" and "Task 4 of 4 · Reaction" (screen
 * audit F14). So the participant was told five steps and then shown four, with step 4 announced as
 * "Task 3" and step 5 as "Task 4" — ten times a sitting. Each screen wrote its own label; nothing tied
 * them to the overview or to each other. Now both are drawn from here, and tests/taskSteps.test.ts
 * holds this list to the state machine's own order of the measured stages (LOOP_ORDER).
 *
 * The ratings are ONE step of two screens (comfort and clarity, then how the eyes feel), which is how
 * the overview has always described them.
 */
import type { ReactNode } from 'react';
import type { Stage } from '@/storage/types';

export interface TaskStep {
  /** The step's name in an eyebrow: "Step 3 of 5 · Ratings". */
  name: string;
  /** The stages this step is made of, in order. */
  stages: readonly Stage[];
  /** Its line on the instructions screen. */
  overview: (ctx: { pages: number; questions: number }) => ReactNode;
}

export const TASK_STEPS: readonly TaskStep[] = [
  {
    name: 'Reading',
    stages: ['READING_TASK'],
    overview: ({ pages }) => <><strong>Read</strong> a passage of {pages} short pages.</>,
  },
  {
    name: 'Questions',
    stages: ['COMPREHENSION'],
    overview: ({ questions }) => <>Answer <strong>{questions} questions</strong> about it.</>,
  },
  {
    name: 'Ratings',
    stages: ['DISPLAY_PERCEPTION', 'POST_FATIGUE'],
    overview: () => <>Rate the display’s <strong>comfort &amp; clarity</strong>, and how your <strong>eyes feel</strong>.</>,
  },
  {
    name: 'Word search',
    stages: ['VISUAL_SEARCH'],
    overview: () => <><strong>Find &amp; tap</strong> every occurrence of a target word, as fast as you can.</>,
  },
  {
    name: 'Reaction',
    stages: ['REACTION_TIME'],
    overview: () => (
      <><strong>Tap</strong> when a dot appears in the <strong>same colour as the text you have
        just read</strong>, and not when it is any other colour (a quick reaction game).</>
    ),
  },
];

/** Which step a stage belongs to (1-based), or null for a stage that is not one (the grey field). */
export function taskStepOf(stage: Stage): { number: number; total: number; name: string } | null {
  const i = TASK_STEPS.findIndex((s) => s.stages.includes(stage));
  return i < 0 ? null : { number: i + 1, total: TASK_STEPS.length, name: TASK_STEPS[i].name };
}

/** "Step 3 of 5 · Ratings". */
export function stepLabel(stage: Stage): string {
  const s = taskStepOf(stage);
  if (!s) throw new Error(`${stage} is not one of the task steps`);
  return `Step ${s.number} of ${s.total} · ${s.name}`;
}

/** Which display of the sitting is running: the k-th of n (1-based). */
export interface DisplayPosition { k: number; n: number }

/**
 * "Display 3 of 10 · Step 3 of 5 · Ratings" — where the participant is in the sitting and in the
 * display. On the task intro cards and the two rating screens ONLY: those are the screens between the
 * measured exposures. Never on a reading page, the search excerpt or the reaction-time field, which
 * carry no progress chrome (see showProgress in Experiment.tsx); the questions show their step alone.
 */
export function displayStepLabel(stage: Stage, display: DisplayPosition | undefined): string {
  return display ? `Display ${display.k} of ${display.n} · ${stepLabel(stage)}` : stepLabel(stage);
}
