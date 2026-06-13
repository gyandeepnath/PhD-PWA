/**
 * Display comfort + text clarity ratings (0-100). Shown on the active condition's colours so the
 * participant rates the display they're using. Touched-gated like the fatigue scale.
 */
import { useState } from 'react';

export interface PerceptionResult {
  comfort: number;
  clarity: number;
  comfortTouched: boolean;
  clarityTouched: boolean;
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
  const ready = comfortTouched && clarityTouched;

  return (
    <div
      className="min-h-screen w-full p-[6%] font-sans animate-fade-in"
      style={{ background, color: text }}
    >
      <h2 className="font-serif text-3xl font-light">How did this display feel?</h2>
      <div className="mt-8 space-y-8" style={{ maxWidth: 720 }}>
        <div>
          <div className="flex justify-between font-lab text-sm">
            <span>Very uncomfortable</span>
            <span>{comfortTouched ? comfort : '–'}</span>
            <span>Very comfortable</span>
          </div>
          <input
            type="range" min={0} max={100} value={comfort} style={{ color: text }}
            onChange={(e) => { setComfort(Number(e.target.value)); setComfortTouched(true); }}
          />
        </div>
        <div>
          <div className="flex justify-between font-lab text-sm">
            <span>Very unclear</span>
            <span>{clarityTouched ? clarity : '–'}</span>
            <span>Very clear</span>
          </div>
          <input
            type="range" min={0} max={100} value={clarity} style={{ color: text }}
            onChange={(e) => { setClarity(Number(e.target.value)); setClarityTouched(true); }}
          />
        </div>
      </div>
      <button
        disabled={!ready}
        onClick={() => onComplete({ comfort, clarity, comfortTouched, clarityTouched })}
        className="mt-8 rounded-xl px-8 py-3 font-lab text-sm transition active:scale-95"
        style={{
          background: ready ? text : 'transparent',
          color: ready ? background : text,
          border: `2px solid ${text}`,
          opacity: ready ? 1 : 0.5,
          cursor: ready ? 'pointer' : 'not-allowed',
        }}
      >
        Continue →
      </button>
    </div>
  );
}
