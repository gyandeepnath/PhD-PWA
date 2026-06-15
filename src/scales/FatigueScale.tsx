/**
 * 5-item visual-analogue fatigue scale (0-10). Composite = mean of items.
 *
 * Audit fix: each slider has a `touched` flag and submit is disabled until all five are touched,
 * so an untouched all-zero record can't be silently submitted (the original defaulted every
 * slider to 0 with submit always enabled).
 */
import { useState } from 'react';
import { mean } from '@/lib/stats';

export interface FatigueResult {
  items: { eye_strain: number; dryness: number; blur: number; burning: number; headache: number };
  mean: number;
  touched: { eye_strain: boolean; dryness: boolean; blur: boolean; burning: boolean; headache: boolean };
}

const ITEMS = [
  { key: 'eye_strain', label: 'Tired or aching eyes' },
  { key: 'dryness', label: 'Dry or irritated feeling' },
  { key: 'blur', label: 'Difficulty focusing / blur' },
  { key: 'burning', label: 'Burning or stinging' },
  { key: 'headache', label: 'Head pain or pressure' },
] as const;

type Key = (typeof ITEMS)[number]['key'];

interface Props {
  prompt: string;
  baselineMean?: number;
  accent?: string;
  onComplete: (r: FatigueResult) => void;
}

export function FatigueScale({ prompt, baselineMean, accent = '#4f8ef7', onComplete }: Props) {
  const [values, setValues] = useState<Record<Key, number>>({
    eye_strain: 0, dryness: 0, blur: 0, burning: 0, headache: 0,
  });
  const [touched, setTouched] = useState<Record<Key, boolean>>({
    eye_strain: false, dryness: false, blur: false, burning: false, headache: false,
  });

  const [sent, setSent] = useState(false);
  const allTouched = ITEMS.every((it) => touched[it.key]);
  const composite = mean(ITEMS.map((it) => values[it.key]));

  return (
    <div className="min-h-screen w-full bg-cream p-[5%] font-sans text-[#1a1a2e] animate-fade-in">
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
      <h2 className="font-serif text-3xl font-light">{prompt}</h2>
      <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Drag each slider. 0 = none, 10 = severe.</p>

      <div className="mt-6 space-y-6">
        {ITEMS.map((it) => (
          <div key={it.key}>
            <div className="flex justify-between font-lab text-sm" style={{ marginBottom: 4 }}>
              <span>{it.label}</span>
              <span style={{ fontWeight: 700, color: touched[it.key] ? accent : '#b8b4ac' }}>
                {touched[it.key] ? `${values[it.key]} / 10` : 'not set'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="font-lab" style={{ fontSize: 11, color: '#9a968e', width: 14, textAlign: 'right' }}>0</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={values[it.key]}
                style={{
                  flex: 1,
                  color: accent,
                  // Visible filled track up to the thumb (works on Android Chrome).
                  background: `linear-gradient(to right, ${touched[it.key] ? accent : '#cfcbc3'} ${values[it.key] * 10}%, #e2ded6 ${values[it.key] * 10}%)`,
                }}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [it.key]: Number(e.target.value) }));
                  setTouched((t) => ({ ...t, [it.key]: true }));
                }}
              />
              <span className="font-lab" style={{ fontSize: 11, color: '#9a968e', width: 14 }}>10</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 font-lab text-sm">
        Composite: <strong>{allTouched ? composite.toFixed(1) : 'Set all sliders to see score'}</strong>
        {baselineMean != null && allTouched && (
          <span style={{ marginLeft: 12, color: composite - baselineMean > 0 ? '#e64c4c' : '#22c97a' }}>
            Δ {(composite - baselineMean >= 0 ? '+' : '') + (composite - baselineMean).toFixed(1)} vs baseline
          </span>
        )}
      </div>

      <button
        disabled={!allTouched || sent}
        onClick={() => {
          if (!allTouched || sent) return;
          setSent(true);
          onComplete({ items: { ...values }, mean: composite, touched: { ...touched } });
        }}
        className="mt-6 rounded-xl px-8 py-3 font-lab text-sm text-white transition active:scale-95"
        style={{ background: allTouched ? accent : '#cfcbc3', cursor: allTouched ? 'pointer' : 'not-allowed' }}
      >
        Continue →
      </button>
      </div>
    </div>
  );
}
