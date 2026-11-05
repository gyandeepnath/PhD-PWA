/**
 * Researcher-facing illuminance checkpoint.
 *
 * Rendered at the mid-session break and at session completion so the room is re-measured with the
 * calibrated meter rather than assumed to have held its setting for 60-120 minutes (§3.4).
 * Deliberately dismissible: a missed reading is recorded as absent, which is honest, whereas
 * blocking the participant's progress on a researcher action would strand the session.
 *
 * A reading TYPED but not logged is the exception (Round 89, audit 86 F10). It lived only in this
 * panel's state, the Log button was its only way to the record, and leaving the screen discarded it
 * without a word: the operator who typed 310 and tapped Continue believed it logged. The panel now
 * says so while a typed value waits (`onPendingChange`), and the screen's way on waits with it until
 * the reading is logged or the box is cleared. It is never logged for the operator: a half-typed
 * "3" is not a reading.
 */
import { useEffect, useState } from 'react';
import { ILLUMINATION, luxInRange, parseLuxEntry, type IlluminationLevel, type LuxCheckpoint as Cp } from '@/experiment/illumination';
import { UI_TEXT } from '@/lib/uiPalette';

interface Props {
  checkpoint: Cp;
  level: IlluminationLevel | null;
  /** Already-logged reading for this checkpoint, if any. */
  existing?: number | null;
  onSubmit: (lux: number) => void;
  /** True while a value is typed and not logged; false when it is logged or cleared, and on unmount. */
  onPendingChange?: (pending: boolean) => void;
  accent?: string;
  text?: string;
}

export function LuxCheckpointPanel({ checkpoint, level, existing, onSubmit, onPendingChange, accent = UI_TEXT.blue, text = UI_TEXT.ink }: Props) {
  const [val, setVal] = useState('');
  const [done, setDone] = useState(existing != null);
  const pending = !done && val.trim() !== '';
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const spec = level ? ILLUMINATION[level] : null;
  const parsed = parseLuxEntry(val);
  const valid = parsed != null;
  const num = parsed ?? NaN;
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
      {pending && (
        <p data-testid={`lux-${checkpoint}-pending`} className="font-sans text-[15px] leading-relaxed" style={{ color: UI_TEXT.amber, marginTop: 8 }}>
          Not logged yet. Tap Log to keep this reading, or clear the box; the screen waits until you do.
        </p>
      )}
    </div>
  );
}
