/**
 * 5-item visual-analogue fatigue scale (0-10). Composite = mean of items.
 *
 * Audit fix: each slider has a `touched` flag and submit is disabled until all five are touched,
 * so an untouched all-zero record can't be silently submitted (the original defaulted every
 * slider to 0 with submit always enabled).
 */
import { useRef, useState } from 'react';
import { mean } from '@/lib/stats';
import { now } from '@/lib/timing';

export interface FatigueResult {
  items: { eye_strain: number; dryness: number; blur: number; burning: number; headache: number };
  mean: number;
  touched: { eye_strain: boolean; dryness: boolean; blur: boolean; burning: boolean; headache: boolean };
  /** Time from mount to submit (ms) — engagement/careless-responding signal. */
  responseTimeMs: number;
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
  /** No longer used: the participant is shown neither a score nor a delta. See the note in the
   *  render body — feeding a comparative judgement back into a repeated self-report outcome is
   *  the same feedback the operator manual forbids the operator from giving. */
  baselineMean?: number;
  accent?: string;
  /** Condition colours (post-condition rating runs under the active display); default = neutral cream. */
  background?: string;
  text?: string;
  onComplete: (r: FatigueResult) => void;
}

export function FatigueScale({ prompt, accent = '#4f8ef7', background = '#F8F7F5', text = '#1a1a2e', onComplete }: Props) {
  const muted = text + '99';
  const trackEmpty = text + '22';
  const [values, setValues] = useState<Record<Key, number>>({
    eye_strain: 0, dryness: 0, blur: 0, burning: 0, headache: 0,
  });
  const [touched, setTouched] = useState<Record<Key, boolean>>({
    eye_strain: false, dryness: false, blur: false, burning: false, headache: false,
  });

  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());
  const allTouched = ITEMS.every((it) => touched[it.key]);
  const composite = mean(ITEMS.map((it) => values[it.key]));

  return (
    <div className="min-h-screen w-full p-[5%] font-sans animate-fade-in" style={{ background, color: text }}>
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
      <h2 className="font-serif text-3xl font-light">{prompt}</h2>
      <p className="mt-1 font-lab text-xs" style={{ color: muted }}>Drag each slider. 0 = none, 10 = severe.</p>

      <div className="mt-6 space-y-6">
        {ITEMS.map((it) => (
          <div key={it.key}>
            <div className="flex justify-between font-lab text-sm" style={{ marginBottom: 4 }}>
              <span>{it.label}</span>
              <span style={{ fontWeight: 700, color: touched[it.key] ? accent : muted }}>
                {touched[it.key] ? `${values[it.key]} / 10` : 'not set'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="font-lab" style={{ fontSize: 11, color: muted, width: 14, textAlign: 'right' }}>0</span>
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
                  background: `linear-gradient(to right, ${touched[it.key] ? accent : trackEmpty} ${values[it.key] * 10}%, ${trackEmpty} ${values[it.key] * 10}%)`,
                }}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [it.key]: Number(e.target.value) }));
                  setTouched((t) => ({ ...t, [it.key]: true }));
                }}
              />
              <span className="font-lab" style={{ fontSize: 11, color: muted, width: 14 }}>10</span>
            </div>
          </div>
        ))}
      </div>

      {/*
        No score and no delta are shown to the participant.
        This screen used to display the composite and, beside it, a colour-coded
        "Δ +2.3 vs baseline" — red when worse, green when better — after every one of the ten
        conditions. That is performance feedback on a repeated self-report outcome, and it is the
        strongest kind: a comparative judgement against the participant's own earlier state,
        colour-coded for valence. It feeds each rating back into the next one, invites consistency
        or contrast effects, and makes the fatigue trajectory partly a report of what the
        participant was just told about themselves.
        The operator manual forbids the operator from giving feedback of any kind, for exactly this
        reason. The instrument should not do what the operator is instructed not to do. The
        composite and the delta are both computed and exported; they belong in the dashboard, which
        is researcher-facing, not here.
      */}
      <div className="mt-6 font-lab text-sm text-[#5a5a7a]">
        {allTouched ? 'Thank you — tap Continue.' : 'Set all sliders to continue.'}
      </div>

      <button
        disabled={!allTouched || sent}
        onClick={() => {
          if (!allTouched || sent) return;
          setSent(true);
          onComplete({ items: { ...values }, mean: composite, touched: { ...touched }, responseTimeMs: now() - mountedAt.current });
        }}
        className="mt-6 rounded-xl px-8 py-3 font-lab text-sm transition active:scale-95"
        style={{ background: allTouched ? accent : trackEmpty, color: allTouched ? background : muted, cursor: allTouched ? 'pointer' : 'not-allowed' }}
      >
        Continue →
      </button>
      </div>
    </div>
  );
}
