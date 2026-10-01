/**
 * CVS-Q (Seguí 2015) questionnaire UI. For each of 16 symptoms: pick frequency; if not "never",
 * pick intensity. Scored live; submit enabled once every item has a frequency answer.
 */
import { useRef, useState } from 'react';
import { CVSQ_ITEMS, scoreCvsq } from './cvsq';
import { now } from '@/lib/timing';
import { ScrollCue } from '@/components/ScrollCue';
import { UI_TEXT } from '@/lib/uiPalette';

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

/**
 * LAYOUT. Every word on this screen belongs to the instrument — the item names, the anchors and
 * their definitions — and none of it was legible: the anchor definitions were 12 design px grey DM
 * Mono (10 CSS px on the tablet, 9 with the address bar), the items and buttons 14 px mono, and the
 * sixteen items scrolled about 940 px in a box that showed five of them with nothing saying there
 * were more. Now:
 *   - items, answers and anchor definitions are Roboto at 16-17 design px, in colours at least
 *     4.5:1 on the ground (lib/uiPalette.ts);
 *   - each item is ONE row, name on the left and answers on the right, which roughly halves the
 *     scroll. The intensity answers have a fixed slot, so they appear in place when a frequency other
 *     than the first is chosen instead of pushing every item below them down the screen;
 *   - the list says when there is more below it (ScrollCue), and "Answered k of 16" sits beside
 *     Continue, so a skipped item is found without scrolling back through the list.
 * Two columns of eight were tried on paper and do not fit the tablet's screen (834 design px then,
 * 720 now) without shrinking the text or the tap targets, which is what this change exists to undo.
 *
 * The item wording, their order, the anchors and the scoring are unchanged: it is a validated
 * instrument, and only its presentation is touched here.
 */
/** Width of the text-and-answers column, and of the cue gutter beside the list, in root px. */
const CVSQ_COLUMN_PX = 920;
const CUE_GUTTER_PX = 136;

export function Cvsq({ stage, onComplete }: Props) {
  const freqOptions = FREQ_BY_STAGE[stage];
  const [freq, setFreq] = useState<(number | null)[]>(Array(16).fill(null));
  const [inten, setInten] = useState<(number | null)[]>(Array(16).fill(null));
  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());

  const itemDone = (i: number) => freq[i] != null && (freq[i] === 0 || inten[i] != null);
  const answered = CVSQ_ITEMS.filter((_, i) => itemDone(i)).length;
  const ready = answered === CVSQ_ITEMS.length && !sent;

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
    <div className="screen screen-col nav-band panel-band w-full bg-cream px-[4%] font-sans text-[#1a1a2e] animate-fade-in">
      {/* The column is the 920 px of text and answers PLUS the list's cue gutter to its right, and it
          is the whole that is centred. The gutter used to hang 136 px outside a centred 920 px
          column, into the page margin — which on the 1152 px canvas is only 116 px wide, so the list
          ran 20 px past the clipped root. */}
      <div className="screen-col" style={{ width: '100%', maxWidth: CVSQ_COLUMN_PX + CUE_GUTTER_PX, margin: '0 auto', flex: '1 1 auto', minHeight: 0 }}>
      <div style={{ maxWidth: CVSQ_COLUMN_PX }}>
      <p className="font-sans text-[15px] font-medium uppercase tracking-wide" style={{ color: UI_TEXT.muted }}>
        Computer Vision Syndrome Questionnaire · {stage === 'baseline' ? 'baseline' : 'session end'}
      </p>
      <h1 className="mt-2 font-serif font-light" style={{ fontSize: 28, lineHeight: 1.3 }}>{STEM_BY_STAGE[stage]}</h1>
      {/* The anchors are spelled out rather than left to the one-word labels: "occasionally" means
          different things over a week and over ninety minutes, and the participant has to be told
          which is meant. */}
      <dl data-testid="cvsq-anchors" className="mt-3 font-sans" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '4px 20px', fontSize: 16, lineHeight: 1.4, color: UI_TEXT.body }}>
        {freqOptions.map((f) => (
          <div key={f.value}>
            <dt style={{ fontWeight: 600, color: UI_TEXT.ink, display: 'inline' }}>{f.label}</dt>
            <dd style={{ display: 'inline' }}> — {f.hint}</dd>
          </div>
        ))}
      </dl>

      </div>
      {/* Flexes into whatever the header and the button leave, rather than claiming a guessed
          fraction of the viewport. The old `maxHeight: 64vh` overflowed the canvas on every device
          the study will use, and `vh` is the wrong unit inside the scaled root regardless. */}
      {/* The list's rows are the column's 920 px; its "More below" cue sits in the gutter to their
          right: centred, the cue covered the answers of whichever row was last on screen. */}
      <div data-testid="cvsq-list" className="scrollable screen-grow" style={{ marginTop: 14, paddingRight: CUE_GUTTER_PX }}>
        {CVSQ_ITEMS.map((item, i) => (
          <div key={item} data-testid="cvsq-item" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid #eceae4', borderTop: i === 0 ? '1px solid #e5e2dc' : undefined }}>
            <div className="font-sans" style={{ flex: '1 1 230px', minWidth: 0, fontSize: 17, lineHeight: 1.3, color: UI_TEXT.ink }}>
              <span style={{ color: UI_TEXT.muted, display: 'inline-block', minWidth: 28 }}>{i + 1}.</span>{item}
            </div>
            <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
              {freqOptions.map((f) => (
                <Chip key={f.value} label={f.label} active={freq[i] === f.value}
                  onClick={() => { const n = [...freq]; n[i] = f.value; setFreq(n); if (f.value === 0) { const ni = [...inten]; ni[i] = null; setInten(ni); } }} />
              ))}
            </div>
            {/* A fixed slot: intensity appears here, in place, only when the symptom occurs. */}
            <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', width: 204, paddingLeft: 12, borderLeft: '1px solid #e5e2dc', minHeight: 44 }}>
              {freq[i] != null && freq[i] !== 0 && INTEN.map((it) => (
                <Chip key={it.value} label={it.label} active={inten[i] === it.value}
                  onClick={() => { const n = [...inten]; n[i] = it.value; setInten(n); }} />
              ))}
            </div>
          </div>
        ))}
        <ScrollCue gutter={128} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 14, flex: '0 0 auto', flexWrap: 'wrap', maxWidth: CVSQ_COLUMN_PX }}>
        <button onClick={submit} disabled={!ready}
          className="rounded-xl px-8 py-3 font-sans text-base font-medium transition active:scale-95"
          style={ready
            ? { background: UI_TEXT.ink, color: '#ffffff', cursor: 'pointer' }
            : { background: '#e8e6e1', color: UI_TEXT.muted, cursor: 'not-allowed' }}>
          Continue →
        </button>
        <span data-testid="cvsq-answered" role="status" className="font-sans" style={{ fontSize: 16, color: answered === CVSQ_ITEMS.length ? UI_TEXT.green : UI_TEXT.muted }}>
          Answered {answered} of {CVSQ_ITEMS.length}
        </span>
      </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="font-sans"
      style={{ minHeight: 44, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 16, whiteSpace: 'nowrap',
        border: `1px solid ${active ? UI_TEXT.ink : '#bdb8ae'}`, background: active ? UI_TEXT.ink : '#ffffff', color: active ? '#ffffff' : UI_TEXT.body }}>
      {label}
    </button>
  );
}
