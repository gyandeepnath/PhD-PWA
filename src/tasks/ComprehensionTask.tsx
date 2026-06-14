/**
 * Single 4-option comprehension MCQ after the passage. Records selection, correctness and RT.
 * Shows 1 s of feedback (correct = green, wrong selection = red) before advancing.
 */
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { now } from '@/lib/timing';
import type { Passage } from '@/experiment/passages';

export interface ComprehensionResult {
  selectedIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  responseTimeMs: number;
}

interface Props {
  passage: Passage;
  background: string;
  text: string;
  onComplete: (r: ComprehensionResult) => void;
}

export function ComprehensionTask({ passage, background, text, onComplete }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const start = useRef(now());
  const q = passage.question;

  useEffect(() => {
    if (!submitted || selected == null) return;
    const rt = now() - start.current;
    const t = setTimeout(
      () =>
        onComplete({
          selectedIndex: selected,
          correctIndex: q.correctIndex,
          isCorrect: selected === q.correctIndex,
          responseTimeMs: rt,
        }),
      CONFIG.COMPREHENSION_FEEDBACK_MS,
    );
    return () => clearTimeout(t);
  }, [submitted, selected, onComplete, q.correctIndex]);

  const optionStyle = (i: number) => {
    if (submitted) {
      if (i === q.correctIndex) return { borderColor: '#22c97a', background: '#22c97a15' };
      if (i === selected) return { borderColor: '#e64c4c', background: '#e64c4c15' };
      return { borderColor: text + '30', background: 'transparent' };
    }
    return i === selected
      ? { borderColor: text, background: text + '15' }
      : { borderColor: text + '30', background: 'transparent' };
  };

  return (
    <div className="min-h-screen w-full p-[6%] font-sans animate-fade-in" style={{ background, color: text }}>
      <p style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.55, marginBottom: 14 }}>
        Task 2 of 4 · Comprehension — choose the best answer, then submit
      </p>
      <h2 style={{ fontSize: 22, fontFamily: 'Roboto', lineHeight: 1.4 }}>{q.text}</h2>
      <div className="mt-8 space-y-3" style={{ maxWidth: 760 }}>
        {q.options.map((opt, i) => (
          <button
            key={i}
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
              fontFamily: 'Roboto',
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
        Submit answer
      </button>
    </div>
  );
}
