/**
 * Comprehension check after the passage.
 *
 * The synopsis specifies items assessing gist, inference and detail, so each passage carries three
 * 4-option items and they are administered here in sequence. The component owns the sequence and
 * reports every result in one call, which keeps COMPREHENSION a single stage in the state machine
 * and leaves resume-after-reload semantics unchanged: a session interrupted part-way through the
 * items re-enters at the start of the stage rather than in an undefined half-answered position.
 *
 * Each item is timed from its own mount, not from the start of the stage, so response_time_ms
 * remains a per-item measure and is not inflated by the items preceding it.
 */
import { useEffect, useRef, useState } from 'react';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import type { Passage, QuestionKind } from '@/experiment/passages';
import { STIMULUS_COLUMN_PX } from '@/lib/viewportScale';
import { stepLabel } from '@/experiment/taskSteps';
import { ActionRow, Counter, Eyebrow, PrimaryButton } from './loopChrome';

/**
 * Vertical padding of the item's screen, in root px. The block is centred in what is left, so this
 * is only the least margin a long item can have; measured over all thirty items at 1152x720 the
 * block runs about 440-575 px, leaving at least ~95 px of the 672 px box free.
 */
const MCQ_PAD_Y_PX = 24;

export interface ComprehensionResult {
  questionIndex: number;
  questionKind: QuestionKind;
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  responseTimeMs: number;
}

interface Props {
  passage: Passage;
  background: string;
  text: string;
  onComplete: (results: ComprehensionResult[]) => void;
}

export function ComprehensionTask({ passage, background, text, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const start = useRef(now());
  /** Results accumulate in a ref: a state update would re-render mid-advance and lose the last item. */
  const results = useRef<ComprehensionResult[]>([]);
  /**
   * Which items have been recorded, and whether the task has already reported.
   *
   * THE LAST ITEM COULD BE WRITTEN TWICE. `onComplete` is in the effect's dependency array and the
   * parent passes a fresh inline arrow on every render. On the final item the effect takes the
   * isLast branch and returns WITHOUT clearing `submitted`/`selected`, so the component stays
   * mounted in that state until the parent's async writes finish and the stage advances. Any parent
   * re-render inside that window — an orientation or resize event, a camera-status change — gave
   * `onComplete` a new identity, re-ran the effect, and pushed a second copy of the last item.
   *
   * In the export that is four rows for a three-item passage, with question_index 0, 1, 2, 2. The
   * duplicate's response time is inflated by the write latency, comprehension_items reads 4, and
   * the proportion correct is scored over 4 — so one condition is silently weighted 4/3 in a
   * binomial model whose denominator the codebook promises is the items actually administered. It
   * looks exactly like a legitimately interrupted condition.
   *
   * A per-index latch rather than a single flag, because the same race can catch a middle item
   * between the push and the state reset.
   */
  const recorded = useRef<Set<number>>(new Set());
  const reported = useRef(false);

  const questions = passage.questions;
  const q = questions[index];
  const isLast = index === questions.length - 1;

  useEffect(() => {
    if (!submitted || selected == null) return;
    const responseTimeMs = now() - start.current;
    const t = setTimeout(() => {
      if (!recorded.current.has(index)) {
        recorded.current.add(index);
        results.current.push({
          questionIndex: index,
          questionKind: q.kind,
          selectedIndex: selected,
          correctIndex: q.correctIndex,
          isCorrect: selected === q.correctIndex,
          responseTimeMs,
        });
      }
      if (isLast) {
        if (reported.current) return;
        reported.current = true;
        onComplete(results.current);
        return;
      }
      // Reset for the next item and restart its clock.
      setIndex((i) => i + 1);
      setSelected(null);
      setSubmitted(false);
      start.current = now();
    }, CONFIG.COMPREHENSION_FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [submitted, selected, onComplete, q.correctIndex, q.kind, index, isLast]);

  /**
   * No correctness feedback, ever.
   *
   * This used to outline the correct option green and the chosen one red for a second after each
   * answer. The protocol forbids performance feedback in five places, and the design's own
   * rationale — that effort is not differentially modulated across conditions — depends on its
   * absence. Thirty verdicts a sitting is enough to change how hard a participant works in the
   * conditions that follow, correlated with their earlier luck rather than with the display.
   *
   * The marker colours were also hard-coded, which made them a colour-factor confound in their own
   * right: #22c97a is 2.16:1 against the light backgrounds and 9.70:1 against the dark ones, and
   * 1.48:1 against the green ink — invisible in exactly the condition it marked.
   *
   * The selection highlight below is drawn from the condition's own ink, so it says only "this is
   * what you chose", equally legibly in every condition.
   *
   * IN FULL INK, reversed — the option filled with the ink and its words in the ground — not a tint.
   * It was the ink at 8% alpha (text + '15') with the same border as every other option: the tint
   * stood 1.20:1 off the ground on P1 and 1.15:1 on N1, but 1.04-1.14:1 on the coloured conditions
   * (1.04 on N2, blue on black; 1.035 on N3) — there the chosen answer could not be told from the
   * other three — and it also cut the chosen answer's own contrast (21 to 17.5:1 on P1). So whether a
   * participant could see which answer they had chosen before submitting varied with the very factor
   * under test (screen audit F9's rule: no alpha on anything the participant must read). Reversed, the
   * marker has exactly the condition's own contrast, and the chosen answer's words keep it too (ground
   * on ink is the same pair). The box, border, padding and type are unchanged, so nothing moves.
   */
  const optionStyle = (i: number) => (
    i === selected
      ? { borderColor: text, background: text, color: background }
      // Full-ink outline: at 30% alpha the unselected options' borders were ~1.1:1 on the dark
      // backgrounds — four answers with no visible edges.
      : { borderColor: text, background: 'transparent' }
  );

  return (
    /*
     * THE PASSAGE'S GEOMETRY, not a smaller one of its own (screen audit F5; research round 62, 3.2).
     *
     * The item used to sit in a 760 px block with the options at 17 px — 14.6 CSS px on the study
     * tablet at the old 0.86 scale, an x-height of 9.9 arcmin at 55 cm, below the 12 arcmin critical
     * print size and below the passage the questions are about. The options are drawn in the
     * condition's own ink, and low contrast raises the critical print size (Ohnishi et al. 2020,
     * Vision Res 166:52, abstract), so in the low-contrast conditions a comprehension score partly
     * measured whether the ANSWERS could be read: a legibility effect entangled with the colour factor
     * under test. Now the question and every option are set exactly like the passage — the reading
     * size and line height, in Roboto, in the reading column — so their legibility is the passage's.
     *
     * One stacked, left-aligned column (not justified: an option is one or two lines, and justifying
     * it would stretch the spaces). A 2x2 grid was measured and rejected: option heights ranged from
     * 59 to 172 px within one item and the reading order became two-dimensional. Layout details are a
     * judgement; no verified study compares MCQ layouts on tablets.
     */
    <div className="screen w-full" style={{ background, color: text, display: 'flex', justifyContent: 'center' }}>
      {/*
        Centred in the screen, not top-aligned: this block used to sit at the top with half the screen
        empty below it, which is the layout the investigator asked to be rid of. Auto margins, so a
        taller block collapses to the top instead of being clipped; and the box scrolls as a last
        resort only — an item that did not fit would otherwise lose its Submit button to the clipped
        root. The stimulus-fit end-to-end guard holds every item to fitting without it.
      */}
      <div
        data-testid="mcq-box"
        className="scrollable"
        style={{ width: STIMULUS_COLUMN_PX, maxWidth: '100%', height: '100%', padding: `${MCQ_PAD_Y_PX}px 0`, display: 'flex', flexDirection: 'column' }}
      >
      <div data-testid="mcq-block" style={{ margin: 'auto 0' }}>
      {/* The shared eyebrow and counter, at 16 px in full ink: at 12 px mono the eyebrow arrived at
          10.3 CSS px on the tablet, in the condition's ink, so the instruction was hardest to read
          where contrast was lowest. The step comes from experiment/taskSteps.tsx (it said "Task 2 of
          4" while the instructions list five steps); "Question 1 of 3" moved out of the sentence into
          the counter, where every task keeps its count. The row is exactly as tall as the eyebrow it
          replaced, so the item's block is unchanged. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24, marginBottom: 14 }}>
        <Eyebrow>{stepLabel('COMPREHENSION')} — choose the best answer, then submit</Eyebrow>
        <Counter testId="mcq-counter">Question {index + 1} of {questions.length}</Counter>
      </div>
      <h2 data-testid="mcq-question" style={{ fontSize: CONFIG.READING_FONT_SIZE_PX, fontFamily: STIMULUS_FONT_STACK, lineHeight: CONFIG.READING_LINE_HEIGHT, fontWeight: 400 }}>{q.text}</h2>
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {q.options.map((opt, i) => (
          <button
            // Keyed by item as well as position so React replaces the buttons between items
            // rather than reusing them, which would carry the previous item's focus state over.
            key={`${index}-${i}`}
            data-testid="mcq-option"
            disabled={submitted}
            onClick={() => setSelected(i)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '12px 18px',
              borderRadius: 12,
              border: '2px solid',
              color: text,
              fontFamily: STIMULUS_FONT_STACK,
              fontSize: CONFIG.READING_FONT_SIZE_PX,
              lineHeight: CONFIG.READING_LINE_HEIGHT,
              cursor: submitted ? 'default' : 'pointer',
              ...optionStyle(i),
            }}
          >
            {opt}
          </button>
        ))}
      </div>
      {/* The shared primary button, at the right-hand edge under the options: it sat at the left in
          DM Mono 14, where four other loop screens put theirs somewhere else (screen audit F17). Same
          height and margin as before, so the block does not change. */}
      <ActionRow style={{ marginTop: 24 }}>
        <PrimaryButton ink={text} ground={background} enabled={selected != null && !submitted}
          onClick={() => setSubmitted(true)} testId="mcq-submit">
          {isLast ? 'Submit answer' : 'Submit and continue'}
        </PrimaryButton>
      </ActionRow>
      </div>
      </div>
    </div>
  );
}
