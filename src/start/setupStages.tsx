/**
 * Minimal-but-functional setup stages so the experiment runs end-to-end. The full researcher
 * panel (consent, colour-vision, pre-flight, photometry, session manager) is a later phase; these
 * collect the essential fields, write the records, and preserve the cream theme.
 */
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@/experiment/config';
import { WavyBackground } from '@/components/WavyBackground';
import { now } from '@/lib/timing';
import type { CameraStatus } from '@/storage/types';

const shell = 'min-h-screen w-full bg-cream p-[6%] font-sans text-[#1a1a2e] animate-fade-in';
const btn = 'rounded-xl px-8 py-3 font-lab text-sm text-white transition active:scale-95';

// ---- SESSION INIT ----
export interface SessionInitData {
  participantId: string;
  ambientLux: number;
  whiteLuminance: number | null;
  brightnessPercent: number | null;
}
export function SessionInit({ onSubmit }: { onSubmit: (d: SessionInitData) => void }) {
  const [pid, setPid] = useState('');
  const [lux, setLux] = useState('');
  const [lum, setLum] = useState('');
  const [bright, setBright] = useState('');
  const [err, setErr] = useState('');
  const luxNum = Number(lux);
  const valid = /^[A-Za-z0-9_-]{1,20}$/.test(pid) && lux !== '' && luxNum >= 0 && luxNum <= 200000;

  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.06} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 560 }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">VisuLab · Research Console</p>
        <h1 className="mt-2 font-serif text-5xl font-light">New Session</h1>
        <div className="mt-8 space-y-4">
          <Field label="Participant ID (letters, digits, - or _, ≤20)">
            <input className="vl-input" value={pid} onChange={(e) => setPid(e.target.value)} placeholder="P001" />
          </Field>
          <Field label="Ambient illumination (lux, 0–200000) — measure with a lux meter">
            <input className="vl-input" inputMode="numeric" value={lux} onChange={(e) => setLux(e.target.value)} placeholder="350" />
          </Field>
          <Field label="Measured white-screen luminance (cd/m², optional)">
            <input className="vl-input" inputMode="numeric" value={lum} onChange={(e) => setLum(e.target.value)} placeholder="120" />
          </Field>
          <Field label="Locked display brightness (%, optional)">
            <input className="vl-input" inputMode="numeric" value={bright} onChange={(e) => setBright(e.target.value)} placeholder="80" />
          </Field>
        </div>
        {err && <p className="mt-3 font-lab text-xs text-[#e64c4c]">{err}</p>}
        <button
          className={btn}
          style={{ marginTop: 24, background: valid ? '#1a1a2e' : '#cfcbc3', cursor: valid ? 'pointer' : 'not-allowed' }}
          disabled={!valid}
          onClick={() => {
            if (!valid) { setErr('Enter a valid ID and a lux value between 0 and 200000.'); return; }
            onSubmit({
              participantId: pid,
              ambientLux: luxNum,
              whiteLuminance: lum === '' ? null : Number(lum),
              brightnessPercent: bright === '' ? null : Number(bright),
            });
          }}
        >
          Begin setup →
        </button>
      </div>
      <style>{`.vl-input{width:100%;padding:12px 14px;border:1px solid #d8d4cc;border-radius:10px;font-family:'DM Mono',monospace;font-size:15px;background:#fff;color:#1a1a2e}`}</style>
    </div>
  );
}

// ---- PARTICIPANT PROFILE ----
export interface ProfileData {
  age: number;
  gender: string;
  dailyScreenHours: number;
  deviceFamiliarity: 'low' | 'moderate' | 'high';
  lightingHabit: 'bright' | 'moderate' | 'dim';
  correctionType: 'none' | 'glasses' | 'contacts';
  cvdSelfReport: boolean;
}
export function ParticipantProfile({ onSubmit }: { onSubmit: (d: ProfileData) => void }) {
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [hours, setHours] = useState('');
  const [fam, setFam] = useState<ProfileData['deviceFamiliarity'] | ''>('');
  const [light, setLight] = useState<ProfileData['lightingHabit'] | ''>('');
  const [corr, setCorr] = useState<ProfileData['correctionType'] | ''>('');
  const [cvd, setCvd] = useState<boolean | null>(null);
  const ageN = Number(age);
  const valid = ageN >= 18 && ageN <= 80 && gender && hours !== '' && fam && light && corr && cvd != null;

  return (
    <div className={shell}>
      <h1 className="font-serif text-4xl font-light">Participant profile</h1>
      <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Eligibility: ages 18–80.</p>
      <div className="mt-6 space-y-4" style={{ maxWidth: 640 }}>
        <Field label="Age (18–80)"><input className="vl-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Pick label="Gender" value={gender} set={setGender} opts={['male', 'female', 'non-binary', 'prefer not to say']} />
        <Field label="Daily screen hours"><input className="vl-input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="6" /></Field>
        <Pick label="Device familiarity" value={fam} set={(v) => setFam(v as ProfileData['deviceFamiliarity'])} opts={['low', 'moderate', 'high']} />
        <Pick label="Typical lighting" value={light} set={(v) => setLight(v as ProfileData['lightingHabit'])} opts={['bright', 'moderate', 'dim']} />
        <Pick label="Vision correction" value={corr} set={(v) => setCorr(v as ProfileData['correctionType'])} opts={['none', 'glasses', 'contacts']} />
        <Pick label="Any colour-vision deficiency? (self-report; full screening added later)" value={cvd == null ? '' : cvd ? 'yes' : 'no'} set={(v) => setCvd(v === 'yes')} opts={['no', 'yes']} />
      </div>
      <button
        className={btn}
        style={{ marginTop: 24, background: valid ? '#1a1a2e' : '#cfcbc3', cursor: valid ? 'pointer' : 'not-allowed' }}
        disabled={!valid}
        onClick={() => valid && onSubmit({
          age: ageN, gender, dailyScreenHours: Number(hours),
          deviceFamiliarity: fam as ProfileData['deviceFamiliarity'],
          lightingHabit: light as ProfileData['lightingHabit'],
          correctionType: corr as ProfileData['correctionType'],
          cvdSelfReport: !!cvd,
        })}
      >
        Continue →
      </button>
      <style>{`.vl-input{width:100%;padding:12px 14px;border:1px solid #d8d4cc;border-radius:10px;font-family:'DM Mono',monospace;font-size:15px;background:#fff;color:#1a1a2e}`}</style>
    </div>
  );
}

// ---- CAMERA SETUP ----
export function CameraSetup({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 560 }}>
        <h1 className="font-serif text-4xl font-light">Camera setup</h1>
        <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-[#eef3ff] p-4 font-lab text-sm">
          <strong>Privacy:</strong> no video or images are recorded. The camera estimates blink rate,
          head pose and gaze zone only — and only those metrics are saved.
        </div>
        <p className="mt-4 font-lab text-sm text-[#5a5a7a]">
          Sit facing the screen with your face clearly visible and well-lit. Avoid backlighting.
        </p>
        <div className="mt-6" style={{ display: 'flex', gap: 12 }}>
          <button className={btn} style={{ background: '#1a1a2e' }} onClick={onAllow}>Allow camera access →</button>
          <button className="rounded-xl border border-[#d8d4cc] px-8 py-3 font-lab text-sm text-[#5a5a7a]" onClick={onSkip}>
            Continue without camera
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- CALIBRATION ----
export function Calibration({ cameraStatus, onDone }: { cameraStatus: CameraStatus; onDone: () => void }) {
  const [counting, setCounting] = useState(false);
  return (
    <div className={shell}>
      <h1 className="font-serif text-4xl font-light">Positioning check</h1>
      <p className="mt-2 font-lab text-sm text-[#5a5a7a]" style={{ maxWidth: 560 }}>
        {cameraStatus === 'active'
          ? 'Keep your eyes open and look at the centre of the screen for a few seconds while we record a baseline.'
          : 'Camera not active — this step is skipped. The experiment continues without eye tracking.'}
      </p>
      <button
        className={btn}
        style={{ marginTop: 24, background: '#1a1a2e' }}
        disabled={counting}
        onClick={() => { setCounting(true); onDone(); }}
      >
        {cameraStatus === 'active' ? 'Record baseline →' : 'Continue →'}
      </button>
    </div>
  );
}

// ---- ADAPTATION ----
export function AdaptationScreen({ durationMs, nextLabel, onDone }: { durationMs: number; nextLabel: string; onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const start = useRef(now());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (now() - start.current) / durationMs);
      setProgress(p);
      if (p >= 1) onDone();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, onDone]);

  const r = 34;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: 'fixed', inset: 0, background: CONFIG.ADAPTATION_COLOR, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
      <svg width={88} height={88} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={44} cy={44} r={r} fill="none" stroke="#ffffff40" strokeWidth={6} />
        <circle cx={44} cy={44} r={r} fill="none" stroke="#fff" strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)} style={{ transition: 'stroke-dashoffset 0.1s linear' }} />
      </svg>
      <p style={{ marginTop: 18, fontFamily: '"DM Mono", monospace', fontSize: 14, opacity: 0.9 }}>
        Rest your eyes · {Math.ceil((durationMs * (1 - progress)) / 1000)}s
      </p>
      <p style={{ marginTop: 6, fontFamily: '"DM Mono", monospace', fontSize: 12, opacity: 0.6 }}>{nextLabel}</p>
    </div>
  );
}

// ---- SESSION COMPLETE ----
export function SessionComplete({ onExport }: { onExport: () => void }) {
  return (
    <div className={shell} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1 className="font-serif text-5xl font-light">Thank you</h1>
        <p className="mt-3 font-lab text-sm text-[#5a5a7a]" style={{ maxWidth: 560 }}>
          Your responses have been recorded and will contribute to research on visual ergonomics.
          Please inform the researcher that you have finished.
        </p>
        <button className={btn} style={{ marginTop: 24, background: '#1a1a2e' }} onClick={onExport}>
          Researcher: view export dashboard →
        </button>
      </div>
    </div>
  );
}

// ---- helpers ----
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="font-lab text-xs text-[#5a5a7a]">{label}</span>
      <div style={{ marginTop: 6 }}>{children}</div>
    </label>
  );
}
function Pick({ label, value, set, opts }: { label: string; value: string; set: (v: string) => void; opts: string[] }) {
  return (
    <div>
      <span className="font-lab text-xs text-[#5a5a7a]">{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {opts.map((o) => (
          <button
            key={o}
            onClick={() => set(o)}
            className="font-lab text-sm"
            style={{
              padding: '8px 14px', borderRadius: 10, textTransform: 'capitalize',
              border: `1px solid ${value === o ? '#1a1a2e' : '#d8d4cc'}`,
              background: value === o ? '#1a1a2e' : '#fff',
              color: value === o ? '#fff' : '#5a5a7a', cursor: 'pointer',
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
