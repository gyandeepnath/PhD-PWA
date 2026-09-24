/**
 * Display comfort + text clarity ratings (0-100). Shown on the active condition's colours so the
 * participant rates the display they're using. Touched-gated like the fatigue scale, and — like it —
 * with no thumb and no filled track until touched: this scale used to open with the track filled to
 * the midpoint while its label read "not set", an anchor at 50.
 */
import { useRef, useState } from 'react';
import { now } from '@/lib/timing';
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
}

export function DisplayPerceptionRating({ background, text, onComplete }: Props) {
  const [comfort, setComfort] = useState(50);
  const [clarity, setClarity] = useState(50);
  const [comfortTouched, setComfortTouched] = useState(false);
  const [clarityTouched, setClarityTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());
  const ready = comfortTouched && clarityTouched && !sent;

  return (
    <div
      className="screen w-full p-[6%] font-sans"
      style={{ background, color: text, display: 'flex', flexDirection: 'column' }}
    >
      {/*
        Centred in the screen, not top-aligned: this block used to sit at the top with half the screen
        empty below it, which is the layout the investigator asked to be rid of. Auto margins, so a
        taller block collapses to the top instead of being clipped.
      */}
      <div style={{ width: '100%', maxWidth: 720, margin: 'auto' }}>
      <h2 className="font-serif text-3xl font-light">How did this display feel?</h2>
      {/* Full ink: at 70% this line fell to ~1.7:1 in the low-contrast conditions. */}
      <p className="mt-1 font-lab text-xs">Tap or drag each slider to rate this display.</p>
      <div className="mt-8 space-y-8">
        <div>
          <div className="flex justify-between font-lab text-sm" style={{ marginBottom: 4 }}>
            <span>Very uncomfortable</span>
            <span style={{ fontWeight: 700 }}>{comfortTouched ? comfort : 'not set'}</span>
            <span>Very comfortable</span>
          </div>
          <input
            type="range" min={0} max={100} value={comfort}
            aria-label="comfort"
            className={comfortTouched ? undefined : 'vl-untouched'}
            // Untouched: a uniform track, no fill and no thumb — see .vl-untouched in theme.css.
            style={{ color: text, background: ratingTrack(text, comfortTouched, comfort) }}
            onPointerDown={() => setComfortTouched(true)}
            onChange={(e) => { setComfort(Number(e.target.value)); setComfortTouched(true); }}
          />
        </div>
        <div>
          <div className="flex justify-between font-lab text-sm" style={{ marginBottom: 4 }}>
            <span>Very unclear</span>
            <span style={{ fontWeight: 700 }}>{clarityTouched ? clarity : 'not set'}</span>
            <span>Very clear</span>
          </div>
          <input
            type="range" min={0} max={100} value={clarity}
            aria-label="clarity"
            className={clarityTouched ? undefined : 'vl-untouched'}
            // Untouched: a uniform track, no fill and no thumb — see .vl-untouched in theme.css.
            style={{ color: text, background: ratingTrack(text, clarityTouched, clarity) }}
            onPointerDown={() => setClarityTouched(true)}
            onChange={(e) => { setClarity(Number(e.target.value)); setClarityTouched(true); }}
          />
        </div>
      </div>
      <button
        disabled={!ready}
        onClick={() => { if (!ready) return; setSent(true); onComplete({ comfort, clarity, comfortTouched, clarityTouched, responseTimeMs: now() - mountedAt.current }); }}
        className="mt-8 rounded-xl px-8 py-3 font-lab text-sm transition active:scale-95"
        style={{
          background: ready ? text : 'transparent',
          color: ready ? background : text,
          // Not-yet-available is a dashed outline, not a faded (1.5:1 in P4) label.
          border: ready ? `2px solid ${text}` : `2px dashed ${text}`,
          cursor: ready ? 'pointer' : 'not-allowed',
        }}
      >
        Continue →
      </button>
      </div>
    </div>
  );
}
