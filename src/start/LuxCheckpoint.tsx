/**
 * Researcher-facing illuminance checkpoint.
 *
 * Rendered at the mid-session break and at session completion so the room is re-measured with the
 * calibrated meter rather than assumed to have held its setting for 60-120 minutes (§3.4).
 * Deliberately dismissible: a missed reading is recorded as absent, which is honest, whereas
 * blocking the participant's progress on a researcher action would strand the session.
 */
import { useState } from 'react';
import { ILLUMINATION, luxInRange, type IlluminationLevel, type LuxCheckpoint as Cp } from '@/experiment/illumination';

interface Props {
  checkpoint: Cp;
  level: IlluminationLevel | null;
  /** Already-logged reading for this checkpoint, if any. */
  existing?: number | null;
  onSubmit: (lux: number) => void;
  accent?: string;
  text?: string;
}

export function LuxCheckpointPanel({ checkpoint, level, existing, onSubmit, accent = '#4f8ef7', text = '#1a1a2e' }: Props) {
  const [val, setVal] = useState('');
  const [done, setDone] = useState(existing != null);
  const spec = level ? ILLUMINATION[level] : null;
  const num = Number(val);
  const valid = val !== '' && Number.isFinite(num) && num >= 0 && num <= 200000;
  const inRange = spec != null && valid && luxInRange(level!, num);
  const muted = text + '99';

  if (done) {
    return (
      <p className="font-lab text-xs" style={{ color: muted }}>
        ✓ {checkpoint} illuminance logged{existing != null ? `: ${existing} lux` : ''}.
      </p>
    );
  }

  return (
    <div style={{ border: `1px solid ${text}22`, borderRadius: 10, padding: '12px 14px', marginTop: 16 }}>
      <p className="font-lab text-xs uppercase tracking-wide" style={{ color: accent }}>
        Researcher · {checkpoint}-of-session illuminance
      </p>
      <p className="font-lab text-xs" style={{ color: muted, marginTop: 4 }}>
        Measure at the participant&apos;s eye position with the lux meter.
        {spec ? ` Assigned level ${spec.label} — expected ${spec.min}–${spec.max}.` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input
          data-testid={`lux-${checkpoint}`}
          className="vl-input"
          inputMode="numeric"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={spec ? String(spec.target) : 'lux'}
          style={{ maxWidth: 140, padding: '8px 10px', border: `1px solid ${text}33`, borderRadius: 8, fontFamily: "'DM Mono', monospace" }}
        />
        <button
          data-testid={`lux-${checkpoint}-save`}
          disabled={!valid}
          onClick={() => { if (valid) { onSubmit(num); setDone(true); } }}
          className="rounded-lg px-4 py-2 font-lab text-xs transition active:scale-95"
          style={{ background: valid ? accent : text + '22', color: valid ? '#fff' : muted, cursor: valid ? 'pointer' : 'not-allowed' }}
        >
          Log
        </button>
        {valid && spec && !inRange && (
          <span className="font-lab text-xs" style={{ color: '#c9701e' }}>
            outside {spec.min}–{spec.max} — will be flagged
          </span>
        )}
      </div>
    </div>
  );
}
