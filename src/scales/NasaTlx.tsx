/**
 * NASA-TLX administration screen — once per session, at close (synopsis Table 3.5).
 *
 * Follows the same integrity rule as FatigueScale: every slider carries a `touched` flag and
 * submit stays disabled until all six have been moved, so an untouched all-midpoint record can
 * never be silently submitted as data.
 */
import { useRef, useState } from 'react';
import { now } from '@/lib/timing';
import { ScrollCue } from '@/components/ScrollCue';
import {
  TLX_DIMENSIONS,
  TLX_MAX,
  TLX_MIN,
  TLX_STEP,
  defaultTlxRatings,
  scoreTlx,
  type TlxKey,
  type TlxRatings,
} from './nasaTlx';

export interface TlxResult {
  ratings: TlxRatings;
  contributions: TlxRatings;
  raw_tlx: number;
  touched: Record<TlxKey, boolean>;
  responseTimeMs: number;
}

interface Props {
  accent?: string;
  background?: string;
  text?: string;
  onComplete: (r: TlxResult) => void;
}

/*
 * LEGIBILITY. The subscale questions are the instrument's definitions, and they were 11 design px in
 * DM Mono at 60% opacity — 9.5 px on the tablet, 8.4 px with the address bar showing — as were the
 * endpoint anchors; the introduction was 12 px. Now the subscale names are 18 px, the questions 16 px
 * and the anchors 15 px, in Roboto, all in full ink (the 60% tint put the questions near 4:1 on the
 * cream). Six items at that size do not fit one column of the 834 px canvas, so they sit in two
 * columns of three, which do; on a screen too narrow for two the grid falls back to one column and
 * the screen scrolls, with the "More below" cue. The wording of every question and anchor is
 * unchanged. The value readout was in #4f8ef7, 3.2:1 on the cream; the accent is now #1f5fbf.
 */
export function NasaTlx({
  accent = '#1f5fbf',
  background = '#F8F7F5',
  text = '#1a1a2e',
  onComplete,
}: Props) {
  const trackEmpty = text + '22';
  const [values, setValues] = useState<TlxRatings>(defaultTlxRatings());
  const [touched, setTouched] = useState<Record<TlxKey, boolean>>(
    () => Object.fromEntries(TLX_DIMENSIONS.map((d) => [d.key, false])) as Record<TlxKey, boolean>,
  );
  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());

  const allTouched = TLX_DIMENSIONS.every((d) => touched[d.key]);
  const score = scoreTlx(values);

  return (
    <div className="screen scrollable nav-band w-full px-[5%] pb-[4%] font-sans" style={{ background, color: text }}>
      <div style={{ width: '100%', maxWidth: 1060, margin: '0 auto' }}>
        <h2 className="font-serif text-3xl font-light">Workload over the whole session</h2>
        <p className="mt-2 font-sans" style={{ fontSize: 17, lineHeight: 1.45 }}>
          Think about the session as a whole, not any single screen. Drag every slider.
        </p>

        <div data-testid="tlx-grid" className="mt-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '26px 48px' }}>
          {TLX_DIMENSIONS.map((d) => (
            <div key={d.key}>
              <div className="flex justify-between font-sans" style={{ marginBottom: 4, fontSize: 18, fontWeight: 600 }}>
                <span>{d.label}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: touched[d.key] ? accent : text }}>
                  {touched[d.key] ? values[d.key] : 'not set'}
                </span>
              </div>
              <p className="font-sans" style={{ fontSize: 16, lineHeight: 1.4, marginBottom: 8 }}>{d.question}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="font-sans" style={{ fontSize: 15, width: 72, textAlign: 'right' }}>{d.low}</span>
                <input
                  type="range"
                  data-testid={`tlx-${d.key}`}
                  min={TLX_MIN}
                  max={TLX_MAX}
                  step={TLX_STEP}
                  value={values[d.key]}
                  aria-label={d.key}
                  className={touched[d.key] ? undefined : 'vl-untouched'}
                  onPointerDown={() => setTouched((t) => ({ ...t, [d.key]: true }))}
                  style={{
                    flex: 1,
                    color: accent,
                    background: `linear-gradient(to right, ${touched[d.key] ? accent : trackEmpty} ${values[d.key]}%, ${trackEmpty} ${values[d.key]}%)`,
                  }}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setValues((prev) => ({ ...prev, [d.key]: v }));
                    setTouched((t) => ({ ...t, [d.key]: true }));
                  }}
                />
                <span className="font-sans" style={{ fontSize: 15, width: 72 }}>{d.high}</span>
              </div>
            </div>
          ))}
        </div>

        {/*
          No score readout. The same argument as the fatigue scale: this is the only instrument
          administered at BOTH sittings, and the between-sitting illumination contrast is the one
          comparison it is claimed to support. Showing "Raw TLX: 62.5" at sitting 1 gives the
          participant a number to anchor on 48-72 hours later, so part of the contrast becomes a
          report of what they were told about themselves. Within the screen it also lets them tune
          the composite — nudging Frustration until the displayed figure looks right is one visible
          action. The score is computed and exported; it belongs in the researcher-facing dashboard.
        */}
        <div className="mt-6 font-sans" style={{ fontSize: 16 }}>
          {allTouched ? 'Thank you — tap Continue.' : 'Set all six sliders to continue.'}
        </div>

        <button
          data-testid="tlx-submit"
          disabled={!allTouched || sent}
          onClick={() => {
            if (!allTouched || sent) return;
            setSent(true);
            onComplete({
              ratings: { ...values },
              contributions: score.contributions,
              raw_tlx: score.raw_tlx,
              touched: { ...touched },
              responseTimeMs: now() - mountedAt.current,
            });
          }}
          className="mt-4 rounded-xl px-8 py-3 font-sans text-base font-medium transition active:scale-95"
          style={{
            background: allTouched ? accent : 'transparent',
            color: allTouched ? background : text,
            border: allTouched ? `2px solid ${accent}` : `2px dashed ${text}`,
            cursor: allTouched ? 'pointer' : 'not-allowed',
          }}
        >
          Continue →
        </button>
      </div>
      <ScrollCue />
    </div>
  );
}
