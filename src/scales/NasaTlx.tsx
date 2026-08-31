/**
 * NASA-TLX administration screen — once per session, at close (synopsis Table 3.5).
 *
 * Follows the same integrity rule as FatigueScale: every slider carries a `touched` flag and
 * submit stays disabled until all six have been moved, so an untouched all-midpoint record can
 * never be silently submitted as data.
 */
import { useRef, useState } from 'react';
import { now } from '@/lib/timing';
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

export function NasaTlx({
  accent = '#4f8ef7',
  background = '#F8F7F5',
  text = '#1a1a2e',
  onComplete,
}: Props) {
  const muted = text + '99';
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
    <div className="min-h-screen w-full p-[5%] font-sans animate-fade-in" style={{ background, color: text }}>
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
        <h2 className="font-serif text-3xl font-light">Workload over the whole session</h2>
        <p className="mt-1 font-lab text-xs" style={{ color: muted }}>
          Think about the session as a whole, not any single screen. Drag every slider.
        </p>

        <div className="mt-6 space-y-6">
          {TLX_DIMENSIONS.map((d) => (
            <div key={d.key}>
              <div className="flex justify-between font-lab text-sm" style={{ marginBottom: 2 }}>
                <span>{d.label}</span>
                <span style={{ fontWeight: 700, color: touched[d.key] ? accent : muted }}>
                  {touched[d.key] ? values[d.key] : 'not set'}
                </span>
              </div>
              <p className="font-lab" style={{ fontSize: 11, color: muted, marginBottom: 6 }}>{d.question}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="font-lab" style={{ fontSize: 11, color: muted, width: 62, textAlign: 'right' }}>{d.low}</span>
                <input
                  type="range"
                  data-testid={`tlx-${d.key}`}
                  min={TLX_MIN}
                  max={TLX_MAX}
                  step={TLX_STEP}
                  value={values[d.key]}
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
                <span className="font-lab" style={{ fontSize: 11, color: muted, width: 62 }}>{d.high}</span>
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
        <div className="mt-6 font-lab text-sm" style={{ color: muted }}>
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
          className="mt-6 rounded-xl px-8 py-3 font-lab text-sm transition active:scale-95"
          style={{
            background: allTouched ? accent : trackEmpty,
            color: allTouched ? background : muted,
            cursor: allTouched ? 'pointer' : 'not-allowed',
          }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
