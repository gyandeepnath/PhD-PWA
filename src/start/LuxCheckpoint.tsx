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
import { UI_TEXT } from '@/lib/uiPalette';

interface Props {
  checkpoint: Cp;
  level: IlluminationLevel | null;
  /** Already-logged reading for this checkpoint, if any. */
  existing?: number | null;
  onSubmit: (lux: number) => void;
  accent?: string;
  text?: string;
}

export function LuxCheckpointPanel({ checkpoint, level, existing, onSubmit, accent = UI_TEXT.blue, text = UI_TEXT.ink }: Props) {
  const [val, setVal] = useState('');
  const [done, setDone] = useState(existing != null);
  const spec = level ? ILLUMINATION[level] : null;
  const num = Number(val);
  const valid = val !== '' && Number.isFinite(num) && num >= 0 && num <= 200000;
  const inRange = spec != null && valid && luxInRange(level!, num);
  // Was `text + '99'`: 60% ink on cream, about 4:1 — under the floor for text this small.
  const muted = text === UI_TEXT.ink ? UI_TEXT.muted : text + 'cc';

  if (done) {
    return (
      <p className="font-sans text-[15px]" style={{ color: muted, marginTop: 12 }}>
        ✓ {checkpoint} illuminance logged{existing != null ? `: ${existing} lux` : ''}.
      </p>
    );
  }

  return (
    <div style={{ border: `1px solid ${text}22`, borderRadius: 10, padding: '12px 14px', marginTop: 16 }}>
      <p className="font-sans text-sm font-medium uppercase tracking-wide" style={{ color: accent }}>
        Researcher · {checkpoint}-of-session illuminance
      </p>
      <p className="font-sans text-[15px] leading-relaxed" style={{ color: muted, marginTop: 4 }}>
        Measure at the participant&apos;s eye position with the lux meter.
        {spec ? ` Assigned level ${spec.label} — expected ${spec.min}–${spec.max}.` : ''}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          data-testid={`lux-${checkpoint}`}
          className="vl-input"
          inputMode="numeric"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={spec ? String(spec.target) : 'lux'}
          style={{ maxWidth: 160, padding: '10px 12px', border: `1px solid ${text}55`, borderRadius: 8, fontFamily: "'DM Mono', monospace", fontSize: 17, background: '#fff' }}
        />
        <button
          data-testid={`lux-${checkpoint}-save`}
          disabled={!valid}
          onClick={() => { if (valid) { onSubmit(num); setDone(true); } }}
          className="rounded-lg px-5 py-2 font-sans text-base font-medium transition active:scale-95"
          style={{ minHeight: 44, background: valid ? accent : '#e8e6e1', color: valid ? '#fff' : muted, cursor: valid ? 'pointer' : 'not-allowed' }}
        >
          Log
        </button>
        {valid && spec && !inRange && (
          <span className="font-sans text-[15px]" style={{ color: UI_TEXT.amber }}>
            outside {spec.min}–{spec.max} — will be flagged
          </span>
        )}
      </div>
    </div>
  );
}
