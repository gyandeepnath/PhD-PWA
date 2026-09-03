/**
 * CVS-Q (Seguí 2015) questionnaire UI. For each of 16 symptoms: pick frequency; if not "never",
 * pick intensity. Scored live; submit enabled once every item has a frequency answer.
 */
import { useRef, useState } from 'react';
import { CVSQ_ITEMS, scoreCvsq } from './cvsq';
import { now } from '@/lib/timing';

export interface CvsqResult {
  frequency: number[];
  intensity: number[];
  total: number;
  symptomatic: boolean;
  /** Which recall frame the participant was given. See FREQ_BY_STAGE. */
  frame: 'habitual_computer_work' | 'this_session';
  /** Time from mount to submit (ms) — engagement signal. */
  responseTimeMs: number;
}

/**
 * The CVS-Q's frequency anchors are defined in EVENTS PER WEEK, and that is the whole problem with
 * administering it twice in one sitting.
 *
 * The published definitions are: never = "the symptom does not occur at all"; occasionally =
 * "sporadic episodes or once a week"; often or always = "2 or 3 times a week to almost every day".
 * The instrument's own case criterion is "occurrence of at least one symptom two or three times a
 * week", and its test-retest validations use a 7-15 day interval expressly to demonstrate that the
 * score does NOT move. It is a habitual measure, situationally anchored to computer work.
 *
 * The screen used to ask, at both administrations, "How often, and how strongly, have you felt each
 * symptom?" — with no period at all, which matches no validated version. A participant reading it
 * habitually answered the same thing twice and produced a change of zero; one reading it as
 * present-state produced a change of several points. Same person, same experience, different
 * number, and nothing in the export said which reading they had used.
 *
 * So the frame is now explicit and DIFFERENT by stage. Baseline keeps the validated habitual frame
 * and the per-week anchors. The closing administration is deliberately re-anchored to this session,
 * with anchors that make sense for ninety minutes — which is a documented DEVIATION from the
 * validated instrument, recorded as `frame` on the record so an analyst cannot mistake one for the
 * other. See docs/LITERATURE_VALIDATION.md.
 */
const FREQ_BY_STAGE = {
  baseline: [
    { label: 'Never', hint: 'does not occur at all', value: 0 },
    { label: 'Occasionally', hint: 'sporadic episodes, or about once a week', value: 1 },
    { label: 'Often / always', hint: '2-3 times a week, up to almost every day', value: 2 },
  ],
  session_end: [
    { label: 'Not at all', hint: 'did not happen during this session', value: 0 },
    { label: 'Occasionally', hint: 'once or twice during this session', value: 1 },
    { label: 'Often / constantly', hint: 'repeatedly, or for most of this session', value: 2 },
  ],
} as const;

const STEM_BY_STAGE = {
  baseline:
    'Thinking about the time you normally spend using a computer or tablet, how often and how strongly do you feel each of these?',
  session_end:
    'Thinking only about the session you have just completed, how often and how strongly did you feel each of these?',
} as const;

const INTEN = [
  { label: 'Moderate', value: 1 },
  { label: 'Intense', value: 2 },
];

interface Props {
  stage: 'baseline' | 'session_end';
  onComplete: (r: CvsqResult) => void;
}

export function Cvsq({ stage, onComplete }: Props) {
  const freqOptions = FREQ_BY_STAGE[stage];
  const [freq, setFreq] = useState<(number | null)[]>(Array(16).fill(null));
  const [inten, setInten] = useState<(number | null)[]>(Array(16).fill(null));
  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());

  const ready = freq.every((f, i) => f != null && (f === 0 || inten[i] != null)) && !sent;

  const submit = () => {
    if (!ready) return;
    setSent(true);
    const frequency = freq.map((f) => f ?? 0);
    const intensity = frequency.map((f, i) => (f === 0 ? 0 : inten[i] ?? 0));
    const score = scoreCvsq(frequency, intensity);
    onComplete({
      frequency, intensity, total: score.total, symptomatic: score.symptomatic,
      // Which frame the participant was asked to use. Baseline is the validated habitual frame;
      // session_end is a documented deviation and its score is not comparable to a published norm.
      frame: stage === 'baseline' ? 'habitual_computer_work' : 'this_session',
      responseTimeMs: now() - mountedAt.current,
    });
  };

  return (
    <div className="screen screen-col w-full bg-cream p-[4%] font-sans text-[#1a1a2e] animate-fade-in">
      <div className="screen-col" style={{ width: '100%', maxWidth: 760, margin: '0 auto', flex: '1 1 auto', minHeight: 0 }}>
      <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">
        Computer Vision Syndrome Questionnaire · {stage === 'baseline' ? 'baseline' : 'session end'}
      </p>
      <h1 className="mt-2 font-serif text-3xl font-light">{STEM_BY_STAGE[stage]}</h1>
      {/* The anchors are spelled out rather than left to the one-word labels: "occasionally" means
          different things over a week and over ninety minutes, and the participant has to be told
          which is meant. */}
      <p className="mt-2 font-lab text-xs text-[#5a5a7a]">
        {freqOptions.map((f) => `${f.label} — ${f.hint}`).join(' · ')}
      </p>

      {/* Flexes into whatever the header and the button leave, rather than claiming a guessed
          fraction of the viewport. The old `maxHeight: 64vh` overflowed the canvas on every device
          the study will use, and `vh` is the wrong unit inside the scaled root regardless. */}
      <div className="scrollable screen-grow" style={{ marginTop: 16, paddingRight: 8 }}>
        {CVSQ_ITEMS.map((item, i) => (
          <div key={item} style={{ padding: '12px 0', borderBottom: '1px solid #eceae4' }}>
            <div className="font-lab text-sm" style={{ marginBottom: 8 }}>{i + 1}. {item}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {freqOptions.map((f) => (
                <Chip key={f.value} label={f.label} title={f.hint} active={freq[i] === f.value}
                  onClick={() => { const n = [...freq]; n[i] = f.value; setFreq(n); if (f.value === 0) { const ni = [...inten]; ni[i] = null; setInten(ni); } }} />
              ))}
              {freq[i] != null && freq[i] !== 0 && (
                <>
                  <span style={{ width: 1, background: '#e5e2dc', margin: '0 6px' }} />
                  {INTEN.map((it) => (
                    <Chip key={it.value} label={it.label} active={inten[i] === it.value}
                      onClick={() => { const n = [...inten]; n[i] = it.value; setInten(n); }} />
                  ))}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      <button onClick={submit} disabled={!ready}
        className="mt-4 rounded-xl px-8 py-3 font-lab text-sm text-white transition active:scale-95"
        style={{ background: ready ? '#1a1a2e' : '#cfcbc3', cursor: ready ? 'pointer' : 'not-allowed',
          // Never allowed to be squeezed out by the list above it.
          flex: '0 0 auto', alignSelf: 'flex-start' }}>
        Continue →
      </button>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} className="font-lab text-sm"
      style={{ padding: '7px 13px', borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${active ? '#1a1a2e' : '#d8d4cc'}`, background: active ? '#1a1a2e' : '#fff', color: active ? '#fff' : '#5a5a7a' }}>
      {label}
    </button>
  );
}
