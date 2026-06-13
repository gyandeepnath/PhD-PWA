/**
 * CVS-Q (Seguí 2015) questionnaire UI. For each of 16 symptoms: pick frequency; if not "never",
 * pick intensity. Scored live; submit enabled once every item has a frequency answer.
 */
import { useState } from 'react';
import { CVSQ_ITEMS, scoreCvsq } from './cvsq';

export interface CvsqResult {
  frequency: number[];
  intensity: number[];
  total: number;
  symptomatic: boolean;
}

const FREQ = [
  { label: 'Never', value: 0 },
  { label: 'Occasionally', value: 1 },
  { label: 'Often / always', value: 2 },
];
const INTEN = [
  { label: 'Moderate', value: 1 },
  { label: 'Intense', value: 2 },
];

interface Props {
  stage: 'baseline' | 'session_end';
  onComplete: (r: CvsqResult) => void;
}

export function Cvsq({ stage, onComplete }: Props) {
  const [freq, setFreq] = useState<(number | null)[]>(Array(16).fill(null));
  const [inten, setInten] = useState<(number | null)[]>(Array(16).fill(null));

  const ready = freq.every((f, i) => f != null && (f === 0 || inten[i] != null));

  const submit = () => {
    if (!ready) return;
    const frequency = freq.map((f) => f ?? 0);
    const intensity = frequency.map((f, i) => (f === 0 ? 0 : inten[i] ?? 0));
    const score = scoreCvsq(frequency, intensity);
    onComplete({ frequency, intensity, total: score.total, symptomatic: score.symptomatic });
  };

  return (
    <div className="min-h-screen w-full bg-cream p-[4%] font-sans text-[#1a1a2e] animate-fade-in">
      <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">
        Computer Vision Syndrome Questionnaire · {stage === 'baseline' ? 'baseline' : 'session end'}
      </p>
      <h1 className="mt-2 font-serif text-3xl font-light">How often, and how strongly, have you felt each symptom?</h1>

      <div className="scrollable" style={{ maxHeight: '64vh', marginTop: 16, paddingRight: 8 }}>
        {CVSQ_ITEMS.map((item, i) => (
          <div key={item} style={{ padding: '12px 0', borderBottom: '1px solid #eceae4' }}>
            <div className="font-lab text-sm" style={{ marginBottom: 8 }}>{i + 1}. {item}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FREQ.map((f) => (
                <Chip key={f.value} label={f.label} active={freq[i] === f.value}
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
        style={{ background: ready ? '#1a1a2e' : '#cfcbc3', cursor: ready ? 'pointer' : 'not-allowed' }}>
        Continue →
      </button>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="font-lab text-sm"
      style={{ padding: '7px 13px', borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${active ? '#1a1a2e' : '#d8d4cc'}`, background: active ? '#1a1a2e' : '#fff', color: active ? '#fff' : '#5a5a7a' }}>
      {label}
    </button>
  );
}
