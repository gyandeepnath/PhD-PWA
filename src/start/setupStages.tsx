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
  illuminationLevel: 'low' | 'moderate' | 'high' | null;
  whiteLuminance: number | null;
  brightnessPercent: number | null;
  /** Conditions to run this sitting: 8 = single session, 4 = split into two shorter sittings. */
  conditionsPerSession: number;
}
export function SessionInit({ onSubmit }: { onSubmit: (d: SessionInitData) => void }) {
  const [pid, setPid] = useState('');
  const [lux, setLux] = useState('');
  const [level, setLevel] = useState<'low' | 'moderate' | 'high' | ''>('');
  const [lum, setLum] = useState('');
  const [bright, setBright] = useState('');
  const [sitting, setSitting] = useState<'single' | 'split'>('single');
  const [err, setErr] = useState('');
  const luxNum = Number(lux);
  const valid = /^[A-Za-z0-9_-]{1,20}$/.test(pid) && lux !== '' && luxNum >= 0 && luxNum <= 200000;

  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.06} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 560 }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">VisuLab · Research Console</p>
        <h1 className="mt-2 font-serif text-5xl font-light">New Session</h1>
        <div className="mt-8 space-y-4">
          <Field label="Participant ID (letters, digits, - or _, ≤20)">
            <input data-testid="pid" className="vl-input" value={pid} onChange={(e) => setPid(e.target.value)} placeholder="P001" />
          </Field>
          <Field label="Ambient illumination (lux, 0–200000) — measure with a lux meter">
            <input data-testid="lux" className="vl-input" inputMode="numeric" value={lux} onChange={(e) => setLux(e.target.value)} placeholder="350" />
          </Field>
          <Pick label="Ambient illumination level (study condition)" value={level} set={(v) => setLevel(v as 'low' | 'moderate' | 'high')} opts={['low', 'moderate', 'high']} />
          <Field label="Measured white-screen luminance (cd/m², optional)">
            <input className="vl-input" inputMode="numeric" value={lum} onChange={(e) => setLum(e.target.value)} placeholder="120" />
          </Field>
          <Field label="Locked display brightness (%, optional)">
            <input className="vl-input" inputMode="numeric" value={bright} onChange={(e) => setBright(e.target.value)} placeholder="80" />
          </Field>
          <Pick
            label="Session structure (split shortens each sitting to reduce fatigue/boredom)"
            value={sitting}
            set={(v) => setSitting(v as 'single' | 'split')}
            opts={['single', 'split']}
          />
          <p className="font-lab text-xs text-[#5a5a7a]" style={{ marginTop: -6 }}>
            {sitting === 'single'
              ? 'Single sitting: all 8 conditions (~60–90 min).'
              : 'Split: 4 conditions now, the remaining 4 in a later sitting (re-enter the same Participant ID; the condition order is preserved).'}
          </p>
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
              illuminationLevel: level === '' ? null : level,
              whiteLuminance: lum === '' ? null : Number(lum),
              brightnessPercent: bright === '' ? null : Number(bright),
              conditionsPerSession: sitting === 'split' ? 4 : 8,
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
      <div style={{ width: '100%', maxWidth: 640, margin: '0 auto' }}>
      <h1 className="font-serif text-4xl font-light">Participant profile</h1>
      <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Eligibility: ages 18–80.</p>
      <div className="mt-6 space-y-4" style={{ maxWidth: 640 }}>
        <Field label="Age (18–80)"><input data-testid="age" className="vl-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Pick label="Gender" value={gender} set={setGender} opts={['male', 'female', 'non-binary', 'prefer not to say']} />
        <Field label="Daily screen hours"><input data-testid="hours" className="vl-input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="6" /></Field>
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
      </div>
      <style>{`.vl-input{width:100%;padding:12px 14px;border:1px solid #d8d4cc;border-radius:10px;font-family:'DM Mono',monospace;font-size:15px;background:#fff;color:#1a1a2e}`}</style>
    </div>
  );
}

// ---- CAMERA SETUP (with live preview) ----
export function CameraSetup({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<'notice' | 'preview' | 'denied'>('notice');
  const [errMsg, setErrMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopPreview = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopPreview(), []);

  const requestCamera = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrMsg('No camera API is available on this device/browser.');
      setStep('denied');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 } });
      streamRef.current = stream;
      setStep('preview');
      // Attach after the <video> mounts.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 30);
    } catch (e) {
      const name = (e as { name?: string })?.name ?? '';
      setErrMsg(name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Camera permission was denied. You can retry, or continue without the camera.'
        : 'The camera could not be started. You can continue without it.');
      setStep('denied');
    }
  };

  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 620 }}>
        <h1 className="font-serif text-4xl font-light">Camera setup</h1>

        {step === 'notice' && (
          <>
            <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-[#eef3ff] p-4 font-lab text-sm">
              <strong>Privacy:</strong> no video or images are recorded or stored. The camera only
              estimates blink rate, head position and gaze zone — and only those numbers are saved.
            </div>
            <p className="mt-4 font-lab text-sm text-[#5a5a7a]">
              Sit directly facing the screen, ~50–60 cm away, with your face clearly visible and
              well-lit. Avoid strong light behind you. The browser will ask for camera permission —
              please tap “Allow”.
            </p>
            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={requestCamera}>Enable camera →</button>
              <button className="rounded-xl border border-[#d8d4cc] px-8 py-3 font-lab text-sm text-[#5a5a7a]" onClick={onSkip}>
                Continue without camera
              </button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <p className="mt-3 font-lab text-sm text-[#5a5a7a]">
              Check the preview: your whole face should be centred, in frame, and well-lit.
            </p>
            <div style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden', background: '#000', width: 'min(480px, 70vw)', aspectRatio: '4 / 3', position: 'relative' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: '4px 10px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c97a' }} />
                <span style={{ color: '#fff', fontFamily: '"DM Mono", monospace', fontSize: 11 }}>Camera active</span>
              </div>
            </div>
            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={() => { stopPreview(); onAllow(); }}>
                My face is centred — continue →
              </button>
              <button className="rounded-xl border border-[#d8d4cc] px-8 py-3 font-lab text-sm text-[#5a5a7a]" onClick={() => { stopPreview(); onSkip(); }}>
                Continue without camera
              </button>
            </div>
          </>
        )}

        {step === 'denied' && (
          <>
            <div className="mt-4 rounded-xl border border-[#f5a62366] bg-[#fff8ec] p-4 font-lab text-sm" style={{ color: '#8a6d2f' }}>
              {errMsg}
            </div>
            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={() => { setErrMsg(''); setStep('notice'); }}>Retry</button>
              <button className="rounded-xl border border-[#d8d4cc] px-8 py-3 font-lab text-sm text-[#5a5a7a]" onClick={onSkip}>
                Continue without camera
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- CALIBRATION ----
export function Calibration({ cameraStatus, onDone }: { cameraStatus: CameraStatus; onDone: () => void }) {
  const [counting, setCounting] = useState(false);
  return (
    <div className={shell}>
      <div style={{ width: '100%', maxWidth: 560, margin: '0 auto' }}>
      <h1 className="font-serif text-4xl font-light">Positioning check</h1>
      <p className="mt-2 font-lab text-sm text-[#5a5a7a]">
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

// ---- INSTRUCTIONS (participant overview, shown once before the conditions) ----
export function Instructions({ onContinue }: { onContinue: () => void }) {
  return (
    <div className={shell} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 640 }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">Before you begin</p>
        <h1 className="mt-2 font-serif text-4xl font-light">What you’ll be doing</h1>
        <p className="mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]">
          You’ll see <strong>8 different screen displays</strong> (different background and text
          colours). For <strong>each</strong> display you’ll complete the same four short tasks, then
          two quick ratings:
        </p>
        <ol className="mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]" style={{ paddingLeft: 18, listStyle: 'decimal' }}>
          <li><strong>Read</strong> a short passage.</li>
          <li>Answer <strong>one question</strong> about it.</li>
          <li><strong>Find &amp; tap</strong> every occurrence of a target word, as fast as you can.</li>
          <li><strong>Tap</strong> when a centre dot turns the target colour (a quick reaction game).</li>
          <li>Rate the display’s <strong>comfort &amp; clarity</strong>, and how your <strong>eyes feel</strong>.</li>
        </ol>
        <p className="mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]">
          Between displays there’s a short rest with a grey screen. Each task shows its own
          instructions and a “Begin” button, so just follow the prompts. The whole session takes
          about <strong>60–90 minutes</strong>. You may tell the researcher if you need to stop.
        </p>
        <button className={btn} style={{ marginTop: 22, background: '#1a1a2e' }} onClick={onContinue}>
          I understand — start the first display →
        </button>
      </div>
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

// ---- CONSENT ----
export function Consent({ onConsent }: { onConsent: () => void }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 640 }}>
        <h1 className="font-serif text-4xl font-light">Informed consent</h1>
        <div className="scrollable mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]" style={{ maxHeight: '52vh', paddingRight: 8 }}>
          <p>You are invited to take part in a study on visual ergonomics — how display colour and
            background affect reading, attention and eye comfort. The session takes roughly 60–90
            minutes and involves reading passages, short attention tasks, and brief questionnaires.</p>
          <p style={{ marginTop: 12 }}><strong>Camera:</strong> if you allow it, the front camera
            estimates blink rate, head position and gaze zone in real time. <strong>No image or video
            is ever recorded or stored</strong> — only those numeric measures are saved.</p>
          <p style={{ marginTop: 12 }}><strong>Data:</strong> responses are stored on this device under
            a participant code (no name). You may stop at any time without penalty; tell the researcher
            to withdraw and your data for this session can be deleted.</p>
          <p style={{ marginTop: 12 }}>Taking part is voluntary. By continuing you confirm you have read
            and understood this information and agree to participate.</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 20, height: 20 }} />
          <span className="font-lab text-sm">I have read the above and consent to participate.</span>
        </label>
        <button className={btn} disabled={!agreed}
          style={{ marginTop: 18, background: agreed ? '#1a1a2e' : '#cfcbc3', cursor: agreed ? 'pointer' : 'not-allowed' }}
          onClick={() => agreed && onConsent()}>
          I consent — continue →
        </button>
      </div>
    </div>
  );
}

// ---- PRE-FLIGHT CHECKLIST (researcher) ----
const PREFLIGHT_ITEMS = [
  'Screen brightness set to a fixed level; auto-brightness OFF',
  'Blue-light filter / Night Shift OFF',
  'Screen cleaned (no smudges or glare)',
  'Ambient illumination measured and lux entered',
  'Participant not wearing tinted/photochromic lenses',
  'No strong light source behind the participant (no backlight)',
  'Device on a stand at ~50–60 cm viewing distance, landscape',
];
export function Preflight({ onDone }: { onDone: () => void }) {
  const [checked, setChecked] = useState<boolean[]>(Array(PREFLIGHT_ITEMS.length).fill(false));
  const all = checked.every(Boolean);
  return (
    <div className={shell}>
      <h1 className="font-serif text-4xl font-light">Pre-flight checklist</h1>
      <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Researcher: confirm each item before starting.</p>
      <div className="mt-5 space-y-2" style={{ maxWidth: 640 }}>
        {PREFLIGHT_ITEMS.map((item, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e2dc', background: '#fff', cursor: 'pointer' }}>
            <input type="checkbox" checked={checked[i]} onChange={(e) => { const n = [...checked]; n[i] = e.target.checked; setChecked(n); }} style={{ width: 20, height: 20 }} />
            <span className="font-lab text-sm">{item}</span>
          </label>
        ))}
      </div>
      <button className={btn} disabled={!all}
        style={{ marginTop: 18, background: all ? '#1a1a2e' : '#cfcbc3', cursor: all ? 'pointer' : 'not-allowed' }}
        onClick={() => all && onDone()}>
        All checks pass — continue →
      </button>
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
