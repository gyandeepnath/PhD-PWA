/**
 * Digital Ishihara screening UI. Renders each plate as a mosaic of coloured dots (figure dots form
 * the digit via the font mask); the participant taps the digit they see. Honest framing: this is a
 * screening aid, not a clinical diagnosis.
 */
import { useMemo, useState } from 'react';
import { makeRng } from '@/sim/rng';
import { PLATES, isFigurePixel, scoreIshihara, type Plate, type IshiharaResult } from './ishihara';

const D = 280;
const GLYPH_W_FRAC = 0.46; // glyph box width as fraction of disk diameter

interface Dot { x: number; y: number; r: number; color: string }

function generateDots(plate: Plate, seed: number): Dot[] {
  const rng = makeRng(seed);
  const cx = D / 2;
  const cy = D / 2;
  const radius = D / 2 - 6;
  const gw = D * GLYPH_W_FRAC;
  const gh = gw * (7 / 5);
  const dots: Dot[] = [];
  const step = 11;
  for (let y = 8; y < D - 8; y += step) {
    for (let x = 8; x < D - 8; x += step) {
      const jx = x + (rng() - 0.5) * step;
      const jy = y + (rng() - 0.5) * step;
      if (Math.hypot(jx - cx, jy - cy) > radius) continue;
      const nx = (jx - (cx - gw / 2)) / gw;
      const ny = (jy - (cy - gh / 2)) / gh;
      const figure = isFigurePixel(plate.digit, nx, ny);
      const palette = figure ? plate.figureColors : plate.backgroundColors;
      dots.push({
        x: jx, y: jy, r: 3.5 + rng() * 2.5,
        color: palette[Math.floor(rng() * palette.length)],
      });
    }
  }
  return dots;
}

function PlateSvg({ plate }: { plate: Plate }) {
  const dots = useMemo(() => generateDots(plate, plate.id * 1000 + 7), [plate]);
  return (
    <svg width={D} height={D} style={{ borderRadius: '50%', background: '#efece6' }} aria-label="colour vision plate">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} />
      ))}
    </svg>
  );
}

interface Props {
  onComplete: (r: IshiharaResult) => void;
}

export function IshiharaTest({ onComplete }: Props) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const plate = PLATES[idx];
  const isLast = idx === PLATES.length - 1;

  const answer = (val: string) => {
    const next = { ...answers, [plate.id]: val };
    setAnswers(next);
    if (isLast) onComplete(scoreIshihara(PLATES, next));
    else setIdx((i) => i + 1);
  };

  return (
    <div className="min-h-screen w-full bg-cream p-[5%] font-sans text-[#1a1a2e] animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">Colour-vision screening · {idx + 1}/{PLATES.length}</p>
        <h1 className="mt-2 font-serif text-3xl font-light">Which number do you see?</h1>
        <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Screening aid only — not a clinical diagnosis.</p>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
          <PlateSvg plate={plate} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => answer(d)} className="font-lab"
              style={{ width: 52, height: 52, borderRadius: 12, border: '1px solid #d8d4cc', background: '#fff', fontSize: 18, cursor: 'pointer' }}>
              {d}
            </button>
          ))}
          <button onClick={() => answer('')} className="font-lab text-sm"
            style={{ padding: '0 18px', height: 52, borderRadius: 12, border: '1px solid #d8d4cc', background: '#fff', color: '#5a5a7a', cursor: 'pointer' }}>
            Can't tell
          </button>
        </div>
      </div>
    </div>
  );
}
