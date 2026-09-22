/**
 * Digital Ishihara screening UI. Renders each plate as a mosaic of coloured dots (figure dots form
 * the digit via the font mask); the participant taps the digit they see. Honest framing: this is a
 * screening aid, not a clinical diagnosis.
 */
import { useMemo, useRef, useState } from 'react';
import { makeRng } from '@/sim/rng';
import { buildScreeningPlates, isFigurePixel, scoreIshihara, type Plate, type IshiharaResult } from './ishihara';

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
  // Seeded by the plate's digit as well as its id, so the dot mosaic differs between
  // administrations along with everything else.
  const dots = useMemo(() => generateDots(plate, plate.id * 1000 + plate.digit.charCodeAt(0) * 31 + 7), [plate]);
  return (
    <svg width={D} height={D} style={{ borderRadius: '50%', background: '#efece6' }} aria-label="colour vision plate">
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} />
      ))}
    </svg>
  );
}

interface Props {
  /**
   * Persist the result. Awaited, so the record is written before the operator notice — which is
   * shown only for a non-passing screen — can be dismissed.
   */
  onComplete: (r: IshiharaResult) => void | Promise<void>;
  /** Leave the stage. Called immediately on a pass; on anything else, when the operator taps on. */
  onDone: () => void;
  /**
   * Per-administration seed. The digits, plate order and luminance polarity all derive from it, so
   * a participant's second sitting is not the same seven plates in the same order — which would make
   * the retest a memory test rather than a colour-vision one.
   */
  seed: number;
}

export function IshiharaTest({ onComplete, onDone, seed }: Props) {
  const plates = useMemo(() => buildScreeningPlates(seed), [seed]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<IshiharaResult['status'] | null>(null);
  const busy = useRef(false); // guard against double-taps advancing or completing twice
  const plate = plates[idx];
  const isLast = idx === plates.length - 1;

  const answer = (val: string) => {
    if (busy.current) return;
    busy.current = true;
    const next = { ...answers, [plate.id]: val };
    setAnswers(next);
    if (isLast) {
      const result = scoreIshihara(plates, next);
      /*
       * Persist FIRST, then decide whether to stop. The notice is an operator instruction, not a
       * confirmation step: the result is already recorded when it appears, so a tablet that dies
       * while the notice is up loses nothing.
       */
      void Promise.resolve(onComplete(result)).then(() => {
        if (result.status === 'normal') onDone();
        else setNotice(result.status);
      });
    } else {
      setIdx((i) => i + 1);
      busy.current = false; // allow the next plate's answer
    }
  };

  if (notice) return <OperatorNotice status={notice} onDone={onDone} />;

  return (
    <div className="min-h-screen w-full bg-cream p-[5%] font-sans text-[#1a1a2e] animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">Colour-vision screening · {idx + 1}/{plates.length}</p>
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

/**
 * Shown to the OPERATOR when the app's screen does not pass — and only then.
 *
 * This screen does not exclude anyone; the operator's formal plates do. That made a non-passing
 * result a fact the app recorded and nobody ever saw: the dashboard shows no colour-vision status
 * at all, so the first reader of `cvd_status = screen_failed` was the analyst, months later, with
 * `cvd_clinical = not_done` beside it and no participant left to screen.
 *
 * The formal plates are the only thing that can resolve it, and they have to be administered while
 * the participant is in the room. So the app says so, at the one moment it is still actionable, and
 * says plainly what it is NOT: a diagnosis, and not a reason to send anyone home.
 *
 * `screen_inconclusive` gets the same notice for a different reason. It means the greyscale control
 * plate was missed, so the attempt measured nothing — one mis-tap on the first of six screens does
 * it — and the setup state machine will not re-present the stage, because a total was recorded.
 * The formal plates are the remedy there too.
 */
function OperatorNotice({ status, onDone }: { status: IshiharaResult['status']; onDone: () => void }) {
  const failed = status === 'screen_failed';
  return (
    <div className="min-h-screen w-full bg-cream p-[5%] font-sans text-[#1a1a2e] animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">For the researcher</p>
        <h1 className="mt-2 font-serif text-3xl font-light">
          {failed ? 'The app’s colour screen did not pass' : 'The app’s colour screen gave no result'}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed">
          {failed
            ? 'This participant did not reach the pass mark on the app’s own colour-vision screen.'
            : 'The greyscale control plate was missed, so this attempt measured nothing. It is not a pass and not a failure.'}
          {' '}It has been recorded. <strong>It does not exclude anyone and it is not a diagnosis</strong> —
          the screen is a home-made aid with no published sensitivity or specificity.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed">
          <strong>Administer the formal plates</strong> (Ishihara or Farnsworth) now, while the
          participant is here, and record the result on the profile form as normal or deficient. That
          result is what the analysis uses, and it is the only thing that can settle this. If you
          cannot do it now, record <em>not done</em> honestly — it is not a pass.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-[#5a5a7a]">
          Do not tell the participant they have a colour-vision deficiency. If the formal plates show
          one, follow the incidental-findings steps in the operator manual.
        </p>
        <button onClick={onDone} className="font-lab mt-8"
          style={{ padding: '14px 28px', borderRadius: 12, border: '1px solid #d8d4cc', background: '#fff', fontSize: 15, cursor: 'pointer' }}>
          Recorded — continue
        </button>
      </div>
    </div>
  );
}
