/**
 * Display comfort + text clarity ratings (0-100). Shown on the active condition's colours so the
 * participant rates the display they're using. Touched-gated like the fatigue scale, and — like it —
 * with no thumb and no filled track until touched: this scale used to open with the track filled to
 * the midpoint while its label read "not set", an anchor at 50.
 */
import { useRef, useState } from 'react';
import { now } from '@/lib/timing';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { displayStepLabel, type DisplayPosition } from '@/experiment/taskSteps';
import { ActionRow, Eyebrow, LOOP_TEXT_MIN_PX, PrimaryButton } from '@/tasks/loopChrome';
import { ratingTrack } from './trackStyle';

export interface PerceptionResult {
  comfort: number;
  clarity: number;
  comfortTouched: boolean;
  clarityTouched: boolean;
  /** Time from mount to submit (ms) — engagement signal. */
  responseTimeMs: number;
}

interface Props {
  background: string;
  text: string;
  onComplete: (r: PerceptionResult) => void;
  /** Which display of the sitting this is, for the eyebrow. */
  display?: DisplayPosition;
}

/**
 * Every word on this screen at the condition-screen floor, 16 px in the stimulus face and full ink
 * (screen audit F9): the instruction was 12 px DM Mono and the anchors 14, which the tablet drew at
 * 10.3 and 12 CSS px at the old scale — in the condition's ink, so least legible in the lowest-contrast
 * conditions. The eyebrow says which display and step this is (taskSteps.tsx); the button is the shared
 * one, at the right-hand edge under the sliders (loopChrome.tsx).
 */
const label: React.CSSProperties = { fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX };

export function DisplayPerceptionRating({ background, text, onComplete, display }: Props) {
  const [comfort, setComfort] = useState(50);
  const [clarity, setClarity] = useState(50);
  const [comfortTouched, setComfortTouched] = useState(false);
  const [clarityTouched, setClarityTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());
  const ready = comfortTouched && clarityTouched && !sent;

  const slider = (name: string, low: string, high: string, value: number, touched: boolean,
    set: (v: number) => void, touch: () => void) => (
    <div>
      <div className="flex justify-between" style={{ ...label, marginBottom: 6 }}>
        <span>{low}</span>
        <span style={{ fontWeight: 700 }}>{touched ? value : 'not set'}</span>
        <span>{high}</span>
      </div>
      <input
        type="range" min={0} max={100} value={value}
        aria-label={name}
        className={touched ? undefined : 'vl-untouched'}
        // Untouched: a uniform track, no fill and no thumb — see .vl-untouched in theme.css.
        style={{ color: text, background: ratingTrack(text, touched, value) }}
        onPointerDown={touch}
        onChange={(e) => { set(Number(e.target.value)); touch(); }}
      />
    </div>
  );

  return (
    <div
      className="screen w-full font-sans"
      // Fixed vertical padding: a percentage is a share of the WIDTH, which the address bar changes.
      style={{ background, color: text, display: 'flex', flexDirection: 'column', padding: '40px 6%' }}
    >
      {/*
        Centred in the screen, not top-aligned: this block used to sit at the top with half the screen
        empty below it, which is the layout the investigator asked to be rid of. Auto margins, so a
        taller block collapses to the top instead of being clipped.
      */}
      <div style={{ width: '100%', maxWidth: 720, margin: 'auto' }}>
      <Eyebrow>{displayStepLabel('DISPLAY_PERCEPTION', display)}</Eyebrow>
      <h2 className="mt-2 font-serif text-3xl font-light">How did this display feel?</h2>
      <p className="mt-1" style={label}>Tap or drag each slider to rate this display.</p>
      <div className="mt-8 space-y-8">
        {slider('comfort', 'Very uncomfortable', 'Very comfortable', comfort, comfortTouched, setComfort, () => setComfortTouched(true))}
        {slider('clarity', 'Very unclear', 'Very clear', clarity, clarityTouched, setClarity, () => setClarityTouched(true))}
      </div>
      <ActionRow
        style={{ marginTop: 32 }}
        status={comfortTouched && clarityTouched ? 'Thank you — tap Continue.' : 'Set both sliders to continue.'}
      >
        <PrimaryButton
          ink={text} ground={background} enabled={ready}
          onClick={() => { if (!ready) return; setSent(true); onComplete({ comfort, clarity, comfortTouched, clarityTouched, responseTimeMs: now() - mountedAt.current }); }}
        >
          Continue →
        </PrimaryButton>
      </ActionRow>
      </div>
    </div>
  );
}
