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
   */
  const optionStyle = (i: number) => (
    i === selected
      ? { borderColor: text, background: text + '15' }
      : { borderColor: text + '30', background: 'transparent' }
  );

  return (
    <div className="screen w-full p-[6%] font-sans animate-fade-in" style={{ background, color: text }}>
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
      <p style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.55, marginBottom: 14 }}>
        Task 2 of 4 · Comprehension {index + 1} of {questions.length} — choose the best answer, then submit
      </p>
      <h2 data-testid="mcq-question" style={{ fontSize: 22, fontFamily: STIMULUS_FONT_STACK, lineHeight: 1.4 }}>{q.text}</h2>
      <div className="mt-8 space-y-3">
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
              padding: '16px 18px',
              borderRadius: 12,
              border: '2px solid',
              color: text,
              fontFamily: STIMULUS_FONT_STACK,
              fontSize: 17,
              cursor: submitted ? 'default' : 'pointer',
              ...optionStyle(i),
            }}
          >
            {opt}
          </button>
        ))}
      </div>
      <button
        data-testid="mcq-submit"
        disabled={selected == null || submitted}
        onClick={() => setSubmitted(true)}
        className="mt-8 rounded-xl px-8 py-3 font-lab text-sm transition active:scale-95"
        style={{
          background: selected != null && !submitted ? text : 'transparent',
          color: selected != null && !submitted ? background : text,
          border: `2px solid ${text}`,
          opacity: selected != null && !submitted ? 1 : 0.5,
        }}
      >
        {isLast ? 'Submit answer' : 'Submit and continue'}
      </button>
      </div>
    </div>
  );
}
