/**
 * Setup stages for the start of a session: session init (incl. photometry inputs + session
 * structure), participant profile, camera setup with live preview, calibration, pre-flight
 * checklist, consent, instructions, adaptation, and completion. Each collects its fields, writes
 * the relevant records, and preserves the cream theme. (Consent, colour-vision and the session
 * manager live in their own modules; the experiment wires them together in Experiment.tsx.)
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { assessStorageHealth, type StorageHealth } from '@/storage/storageHealth';
import { CONFIG } from '@/experiment/config';
import { ILLUMINATION, luxInRange, type IlluminationLevel, N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';
import type { MediaConsent } from '@/storage/media';
import { WavyBackground } from '@/components/WavyBackground';
import { now } from '@/lib/timing';
import { stimulusFontLoaded } from '@/lib/fonts';
import { startFaceProbe, type FaceProbeResult, type FaceProbeStatus } from '@/screening/faceProbe';
import type { CameraStatus } from '@/storage/types';

/**
 * The setup screens must SCROLL when they are taller than the viewport.
 *
 * `#root` is `overflow: hidden` and `body` carries `touch-action: none`, so anything below the fold
 * on a setup screen is not merely off-screen — it is unreachable by any gesture. Measured on the
 * participant profile at iPad 11" landscape (1194x834), the mandated orientation: content height
 * 1167 against a viewport of 834, with the caffeine yes/no buttons AND the Continue button both
 * past the bottom edge. The operator fills in the form and there is no way to submit it, and no way
 * to scroll to find one. iPad 10.2" landscape is the same. Portrait fits, which is why it was not
 * noticed.
 *
 * The E2E suite could not catch it either: every click in e2e/helpers.ts passes `force: true`,
 * which skips Playwright's actionability checks and dispatches the click wherever the element is,
 * so the full run passes on screens no finger can reach.
 *
 * min-h-0 is what lets the flex child actually shrink to its container instead of growing.
 */
const shell = 'h-full w-full bg-cream p-[6%] font-sans text-[#1a1a2e] animate-fade-in overflow-y-auto';
const btn = 'rounded-xl px-8 py-3 font-lab text-sm text-white transition active:scale-95';

// ---- SESSION INIT ----
export interface SessionInitData {
  participantId: string;
  ambientLux: number;
  /** Assigned by counterbalancing once the enrolment number is known; null only before lookup. */
  illuminationLevel: IlluminationLevel | null;
  whiteLuminance: number | null;
  brightnessPercent: number | null;
  /** Conditions this sitting: 10 = whole illumination block, 5 = split into two shorter sittings. */
  conditionsPerSession: number;
  /** Researcher acknowledged running outside the accepted lux range; free-text reason. */
  luxDeviationNote: string | null;
}
export interface IlluminationAssignment {
  level: IlluminationLevel;
  block: number;
  orderFirst: IlluminationLevel;
  enrolment: number;
  conditionsCompleted: number;
}

export function SessionInit({
  onSubmit,
  resolveAssignment,
}: {
  onSubmit: (d: SessionInitData) => void;
  /** Looks up this participant's counterbalanced assignment from their enrolment history. */
  resolveAssignment: (participantId: string) => Promise<IlluminationAssignment>;
}) {
  const [pid, setPid] = useState('');
  const [lux, setLux] = useState('');
  const [deviation, setDeviation] = useState('');
  const [assigned, setAssigned] = useState<IlluminationAssignment | null>(null);
  const [lum, setLum] = useState('');
  const [bright, setBright] = useState('');
  const [sitting, setSitting] = useState<'single' | 'split'>('single');
  const [err, setErr] = useState('');

  // Resolve the counterbalanced assignment as soon as the id is well-formed, so the researcher
  // sets the room to the ASSIGNED level before measuring rather than measuring whatever it was.
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(pid)) { setAssigned(null); return; }
    let cancelled = false;
    void resolveAssignment(pid).then((a) => { if (!cancelled) setAssigned(a); });
    return () => { cancelled = true; };
  }, [pid, resolveAssignment]);

  const luxNum = Number(lux);
  const spec = assigned ? ILLUMINATION[assigned.level] : null;
  const inRange = spec != null && luxInRange(assigned!.level, luxNum);
  const luxEntered = lux !== '' && luxNum >= 0 && luxNum <= 200000;
  // Out-of-range is permitted only with an explicit written reason, so a deviation is recorded
  // as data rather than silently accepted or silently blocked.
  const valid =
    /^[A-Za-z0-9_-]{1,20}$/.test(pid) && luxEntered && (inRange || deviation.trim().length >= 3);

  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.06} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 560 }}>
        <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">VisuLab · Research Console</p>
        <h1 className="mt-2 font-serif text-5xl font-light">New Session</h1>
        <div className="mt-8 space-y-4">
          <Field label="Participant ID — a CODE, not a name (letters, digits, - or _, ≤20)">
            <input data-testid="pid" className="vl-input" value={pid} onChange={(e) => setPid(e.target.value)} placeholder="P001" />
          </Field>
          {assigned && spec && (
            <div style={{ border: '1px solid #d8d4cc', borderRadius: 10, padding: '14px 16px', background: '#fbf9f5' }}>
              <p className="font-lab text-xs uppercase tracking-wide text-[#5a5a7a]">
                {N_ILLUMINATION_BLOCKS > 1
                  ? `Assigned illumination — block ${assigned.block + 1} of ${N_ILLUMINATION_BLOCKS}`
                  : 'Room illumination — single level for the whole study'}
              </p>
              <p className="mt-1 font-serif text-2xl">{spec.label}</p>
              <p className="font-lab text-xs text-[#5a5a7a]" style={{ marginTop: 4 }}>{spec.description}</p>
              <p className="font-lab text-xs text-[#5a5a7a]" style={{ marginTop: 6 }}>
                Set the room to <strong>{spec.target} lux</strong> (accept {spec.min}–{spec.max}) before measuring.
                {N_ILLUMINATION_BLOCKS > 1
                  ? ` Order for this participant: ${ILLUMINATION[assigned.orderFirst].label} first — assigned by counterbalancing, not chosen.`
                  : ' The same level is used for every participant and every sitting.'}
              </p>
            </div>
          )}
          <Field label={`Measured illuminance at the eye (lux) — ${spec ? `target ${spec.target}, accept ${spec.min}–${spec.max}` : 'measure with a lux meter'}`}>
            <input data-testid="lux" className="vl-input" inputMode="numeric" value={lux} onChange={(e) => setLux(e.target.value)} placeholder={spec ? String(spec.target) : String(ILLUMINATION.moderate.target)} />
          </Field>
          {luxEntered && spec && !inRange && (
            <Field label={`⚠ ${luxNum} lux is outside ${spec.min}–${spec.max}. Adjust the room, or record why you are proceeding (≥3 chars).`}>
              <input data-testid="lux-deviation" className="vl-input" value={deviation} onChange={(e) => setDeviation(e.target.value)} placeholder="Reason for protocol deviation" />
            </Field>
          )}
          {luxEntered && inRange && (
            <p className="font-lab text-xs" style={{ color: '#2e7d46', marginTop: -6 }}>✓ Within the accepted range for {spec!.label}.</p>
          )}
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
              ? `Single sitting: all ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT} conditions (about 90 min to 2 h).`
              : `Split: ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2} conditions now, the remaining ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2} in a later sitting (re-enter the same Participant ID; the condition order is preserved).`}
          </p>
        </div>
        {err && <p className="mt-3 font-lab text-xs text-[#e64c4c]">{err}</p>}
        <button
          className={btn}
          style={{ marginTop: 24, background: valid ? '#1a1a2e' : '#cfcbc3', cursor: valid ? 'pointer' : 'not-allowed' }}
          disabled={!valid}
          onClick={() => {
            if (!valid) {
              setErr(
                luxEntered && spec && !inRange
                  ? `Illuminance is outside ${spec.min}–${spec.max} lux. Adjust the room, or record a reason for the deviation.`
                  : 'Enter a valid Participant ID and a measured lux value.',
              );
              return;
            }
            onSubmit({
              participantId: pid,
              ambientLux: luxNum,
              illuminationLevel: assigned ? assigned.level : null,
              whiteLuminance: lum === '' ? null : Number(lum),
              brightnessPercent: bright === '' ? null : Number(bright),
              conditionsPerSession: sitting === 'split' ? CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2 : CONFIG.CONDITIONS_PER_SESSION_DEFAULT,
              luxDeviationNote: inRange ? null : deviation.trim(),
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
  /**
   * The FORMAL colour-vision result from the operator's clinical screening (Ishihara or Farnsworth
   * plates), which the operator manual already requires alongside the app.
   *
   * This, not the app's own six-plate digital screen, is the basis for exclusion. The digital
   * screen has no published operating characteristics, and using it to exclude contradicted its own
   * module header, which names formal plates as the standard. 'not_done' is recorded honestly
   * rather than being treated as a pass.
   */
  cvdClinical: 'normal' | 'deficient' | 'not_done';
  /** Fatigue/alertness covariates captured at intake. */
  caffeineToday: boolean;
  hoursSinceSleep: number;
}
export function ParticipantProfile({ onSubmit }: { onSubmit: (d: ProfileData) => void }) {
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [hours, setHours] = useState('');
  const [fam, setFam] = useState<ProfileData['deviceFamiliarity'] | ''>('');
  const [light, setLight] = useState<ProfileData['lightingHabit'] | ''>('');
  const [corr, setCorr] = useState<ProfileData['correctionType'] | ''>('');
  const [cvd, setCvd] = useState<boolean | null>(null);
  const [caffeine, setCaffeine] = useState<boolean | null>(null);
  const [clinicalCvd, setClinicalCvd] = useState('');
  const [sinceSleep, setSinceSleep] = useState('');
  const ageN = Number(age);
  const valid = ageN >= CONFIG.MIN_AGE && ageN <= CONFIG.MAX_AGE && gender && hours !== '' && fam && light && corr && cvd != null && clinicalCvd !== ''
    && caffeine != null && sinceSleep !== '' && Number.isFinite(Number(sinceSleep));

  return (
    <div className={shell}>
      <div style={{ width: '100%', maxWidth: 640, margin: '0 auto' }}>
      <h1 className="font-serif text-4xl font-light">Participant profile</h1>
      <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Eligibility: ages {CONFIG.MIN_AGE}–{CONFIG.MAX_AGE}. Contact-lens wear on a test day and colour-vision deficiency are exclusions.</p>
      <div className="mt-6 space-y-4" style={{ maxWidth: 640 }}>
        <Field label={`Age (${CONFIG.MIN_AGE}–${CONFIG.MAX_AGE})`}><input data-testid="age" className="vl-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Pick label="Gender" value={gender} set={setGender} opts={['male', 'female', 'non-binary', 'prefer not to say']} />
        <Field label="Daily screen hours"><input data-testid="hours" className="vl-input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="6" /></Field>
        <Pick label="Device familiarity" value={fam} set={(v) => setFam(v as ProfileData['deviceFamiliarity'])} opts={['low', 'moderate', 'high']} />
        <Pick label="Typical lighting" value={light} set={(v) => setLight(v as ProfileData['lightingHabit'])} opts={['bright', 'moderate', 'dim']} />
        <Pick label="Vision correction" value={corr} set={(v) => setCorr(v as ProfileData['correctionType'])} opts={['none', 'glasses', 'contacts']} />
        <Pick label="Any colour-vision deficiency? (self-report; full screening added later)" value={cvd == null ? '' : cvd ? 'yes' : 'no'} set={(v) => setCvd(v === 'yes')} opts={['no', 'yes']} />
        <Pick
          label="Formal colour-vision plates (operator's clinical screening)"
          value={clinicalCvd}
          set={setClinicalCvd}
          opts={['normal', 'deficient', 'not done']}
        />
        <Pick label="Caffeine in the last ~4 hours?" value={caffeine == null ? '' : caffeine ? 'yes' : 'no'} set={(v) => setCaffeine(v === 'yes')} opts={['no', 'yes']} />
        <Field label="Hours since you woke up today"><input data-testid="since-sleep" className="vl-input" inputMode="numeric" value={sinceSleep} onChange={(e) => setSinceSleep(e.target.value)} placeholder="3" /></Field>
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
          cvdClinical: (clinicalCvd === 'not done' ? 'not_done' : clinicalCvd) as ProfileData['cvdClinical'],
          caffeineToday: !!caffeine,
          hoursSinceSleep: Number(sinceSleep),
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
const FACE_LABEL: Record<FaceProbeStatus, string> = {
  loading: 'Loading face tracking…',
  searching: 'No face detected yet',
  detected: 'Face detected',
  unavailable: 'Face tracking UNAVAILABLE',
};
const FACE_TONE: Record<FaceProbeStatus, string> = {
  loading: '#c98a22',
  searching: '#c98a22',
  detected: '#22c97a',
  unavailable: '#e64c4c',
};

export function CameraSetup({ onAllow, onSkip, retains }: {
  onAllow: () => void;
  onSkip: () => void;
  /** The photo/video grants actually in force, so the privacy notice can tell the truth. */
  retains?: { setupPhotos: boolean; annotationVideo: boolean };
}) {
  const [step, setStep] = useState<'notice' | 'preview' | 'denied'>('notice');
  /** Live face detection in the preview — see startFaceProbe for why this is not cosmetic. */
  const [face, setFace] = useState<FaceProbeResult>({ status: 'loading', box: null, ear: null, error: null });

  useEffect(() => {
    if (step !== 'preview' || !videoRef.current) return;
    const probe = startFaceProbe(videoRef.current, setFace);
    return () => probe.stop();
  }, [step]);
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
            {/* Conditional, because the unconditional version was false for anyone who had ticked
                a retention grant on the immediately preceding screen: they were told in writing
                that nothing was kept, while two photographs of them were written to storage. In a
                consent record for an ethics-approved protocol that is not a wording problem. */}
            <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-[#eef3ff] p-4 font-lab text-sm">
              {!retains?.setupPhotos && !retains?.annotationVideo ? (
                <>
                  <strong>Privacy:</strong> no video or images are recorded or stored. The camera only
                  estimates blink rate, head position and gaze zone — and only those numbers are saved.
                </>
              ) : (
                <>
                  <strong>Privacy:</strong> the camera estimates blink rate, head position and gaze
                  zone, and those numbers are saved. In addition, you agreed that we may keep
                  {retains.setupPhotos && ' two photographs of you at the device (one now, one at the end)'}
                  {retains.setupPhotos && retains.annotationVideo && ' and'}
                  {retains.annotationVideo && ' a short video segment of you reading, for a person to code frame by frame'}
                  . Nothing else is recorded, and you can change your mind at any time.
                </>
              )}
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
            {/*
              A REAL face box, drawn from FaceMesh, not a hard-coded "Camera active" chip.
              Three documents tell the operator to check for a face box before starting; there was
              none, and no detection at all. This also probes MediaPipe itself — the model is not
              otherwise loaded until after the preview closes, so a device whose model files did not
              precache passed every documented check and then collected a study with no ocular data.
            */}
            <div style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden', background: '#000', width: 'min(480px, 70vw)', aspectRatio: '4 / 3', position: 'relative' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              {face.box && (
                <div
                  data-testid="face-box"
                  style={{
                    position: 'absolute',
                    // Mirrored to match the preview's scaleX(-1).
                    left: `${(1 - face.box.x - face.box.w) * 100}%`,
                    top: `${face.box.y * 100}%`,
                    width: `${face.box.w * 100}%`,
                    height: `${face.box.h * 100}%`,
                    border: '2px solid #22c97a',
                    borderRadius: 8,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.12)',
                  }}
                />
              )}
              <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '4px 10px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: FACE_TONE[face.status] }} />
                <span data-testid="face-status" style={{ color: '#fff', fontFamily: '"DM Mono", monospace', fontSize: 11 }}>
                  {FACE_LABEL[face.status]}
                </span>
              </div>
            </div>
            {face.status === 'unavailable' && (
              <div className="mt-3 rounded-xl border border-[#e64c4c] bg-[#fff0f0] p-3 font-lab text-sm" style={{ color: '#7a1010' }}>
                The face-tracking model could not be loaded on this device, so no blink, gaze or
                head-position data can be collected in this session — the primary outcome would be
                empty for every condition. Check the device is fully set up (see DEPLOYMENT.md
                section 4) before running a participant.{face.error ? ` Details: ${face.error}` : ''}
              </div>
            )}
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
/**
 * Shown in place of camera setup when the participant declined the camera-measurement grant.
 *
 * There is deliberately no way to enable the camera from here. The grant was refused on a screen
 * that promised the refusal would be honoured, and an "are you sure?" affordance next to that
 * promise invites an operator to talk a participant round — which the manual explicitly forbids.
 * Changing it means going back to consent.
 */
export function CameraDeclined({ onContinue }: { onContinue: () => void }) {
  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 620 }}>
        <h1 className="font-serif text-4xl font-light">Camera measurement declined</h1>
        <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-[#eef3ff] p-4 font-lab text-sm">
          This participant did not consent to camera measurement, so the camera will not be used at
          any point in this session and no blink, gaze or head-position data will be collected.
        </div>
        <p className="mt-4 font-lab text-sm text-[#5a5a7a]">
          Everything else runs exactly as normal: every questionnaire, the reading and comprehension
          tasks, visual search and the reaction-time blocks. The session is complete and fully
          usable without the ocular measures — do not try to persuade the participant otherwise.
        </p>
        <div className="mt-6">
          <button className={btn} style={{ background: '#1a1a2e' }} data-testid="camera-declined-continue" onClick={onContinue}>
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}

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
          You’ll see <strong>10 different screen displays</strong> (different background and text
          colours). For <strong>each</strong> display you’ll complete the same short tasks in the
          same order:
        </p>
        <ol className="mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]" style={{ paddingLeft: 18, listStyle: 'decimal' }}>
          <li><strong>Read</strong> a passage of about four short pages.</li>
          <li>Answer <strong>three questions</strong> about it.</li>
          <li>Rate the display’s <strong>comfort &amp; clarity</strong>, and how your <strong>eyes feel</strong>.</li>
          <li><strong>Find &amp; tap</strong> every occurrence of a target word, as fast as you can.</li>
          <li><strong>Tap</strong> when a plain black or white dot appears, and not when it is
            coloured (a quick reaction game).</li>
        </ol>
        <p className="mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]">
          Between displays there’s a short rest with a grey screen. Each task shows its own
          instructions and a “Begin” button, so just follow the prompts. The whole session usually
          takes about <strong>90 minutes to two hours</strong>, and there is a rest break after every
          two displays. You may tell the researcher if you need to stop, at any point.
        </p>
        <button className={btn} style={{ marginTop: 22, background: '#1a1a2e' }} onClick={onContinue}>
          I understand — start the first display →
        </button>
      </div>
    </div>
  );
}

// ---- SESSION COMPLETE ----
export function SessionComplete({ onExport, luxPanel }: { onExport: () => void; luxPanel?: ReactNode }) {
  return (
    <div className={shell} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1 className="font-serif text-5xl font-light">Thank you</h1>
        {luxPanel}
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
/**
 * Informed consent, with GRANULAR media permissions.
 *
 * Participation is one decision; retaining pixels is three more. §3.10 requires camera-based
 * measurement to be "consented separately and refusable without affecting participation", and
 * keeping photographs or video is a strictly stronger ask than deriving numbers from frames that
 * are immediately discarded. Each is therefore its own checkbox, each defaults to OFF, and only
 * the first is required to continue — so a participant who declines all three is still fully
 * enrolled and contributes every non-camera measure.
 */
export function Consent({
  onConsent,
  askAnnotationVideo = false,
}: {
  onConsent: (media: MediaConsent) => void;
  /** True for the pre-specified validation subsample, who are additionally asked about video. */
  askAnnotationVideo?: boolean;
}) {
  const [agreed, setAgreed] = useState(false);
  const [cameraMetrics, setCameraMetrics] = useState(false);
  const [setupPhotos, setSetupPhotos] = useState(false);
  const [annotationVideo, setAnnotationVideo] = useState(false);

  const Opt = ({ checked, set, title, body, testid }: {
    checked: boolean; set: (v: boolean) => void; title: string; body: string; testid: string;
  }) => (
    <label style={{ display: 'flex', gap: 10, marginTop: 12, cursor: 'pointer', alignItems: 'flex-start' }}>
      <input
        type="checkbox" data-testid={testid} checked={checked}
        onChange={(e) => set(e.target.checked)}
        style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
      />
      <span>
        <span className="font-lab text-sm" style={{ fontWeight: 650 }}>{title}</span>
        <span className="font-lab text-xs" style={{ display: 'block', color: '#5a5a7a', marginTop: 2 }}>{body}</span>
      </span>
    </label>
  );

  return (
    <div className={shell} style={{ position: 'relative' }}>
      <WavyBackground opacity={0.05} />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', margin: '0 auto', maxWidth: 640 }}>
        <h1 className="font-serif text-4xl font-light">Informed consent</h1>
        <div className="scrollable mt-4 font-lab text-sm leading-relaxed text-[#3a3a4a]" style={{ maxHeight: '38vh', paddingRight: 8 }}>
          {/*
            * PARTICIPANT-FACING CONSENT TEXT. Two statements here became FALSE when the dim
            * illumination level was withdrawn, and both were material:
            *
            *   - it named room lighting as something the study varies. It no longer does; the room
            *     is held constant at 300 lux.
            *   - it told the participant to attend TWICE, 48-72 hours apart. There is one visit.
            *
            * Misstating a participant's time commitment is a defect in the consent process, not a
            * wording nit, so it is corrected here rather than left for the amendment. The split
            * option is a live operator control, so the second visit is described as a possibility
            * rather than dropped outright.
            *
            * The amendment was cleared with the supervisor and the ethics committee before any data
            * collection began, so this wording is the approved one rather than a pending change.
          */}
          <p>You are invited to take part in a study on visual ergonomics — how display polarity
            and text colour affect reading, attention and eye comfort. The session takes roughly
            75–120 minutes and involves reading passages, short attention tasks and brief
            questionnaires. It is normally a single visit; if it suits you better it can be split
            across two shorter visits, which the researcher will arrange with you.</p>
          <p style={{ marginTop: 12 }}><strong>Data:</strong> responses are stored on this device
            under a participant code, not your name. You may stop at any time without penalty; tell
            the researcher to withdraw and your data for this session can be deleted.</p>
          <p style={{ marginTop: 12 }}><strong>Camera:</strong> by default the front camera is used
            only to compute numbers — how often you blink, how fully your eyelids close, head
            position — and <strong>the images themselves are discarded immediately and never
            stored</strong>. The options below are separate and entirely optional.</p>
          <p style={{ marginTop: 12 }}>Taking part is voluntary. Declining any option below does not
            affect your participation or anything else about the session.</p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, cursor: 'pointer' }}>
          <input type="checkbox" data-testid="consent-core" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 20, height: 20 }} />
          <span className="font-lab text-sm" style={{ fontWeight: 650 }}>I have read the above and consent to participate.</span>
        </label>

        <p className="font-lab text-xs uppercase tracking-wide" style={{ color: '#5a5a7a', marginTop: 20 }}>
          Optional — each is a separate choice
        </p>
        <Opt
          testid="consent-camera" checked={cameraMetrics} set={setCameraMetrics}
          title="Use the camera for blink and head-position measures"
          body="Numbers only. No image or video is saved. Declining means the eye measures are not collected for you; everything else runs as normal."
        />
        <Opt
          testid="consent-photos" checked={setupPhotos} set={setSetupPhotos}
          title="Keep two photographs of me at the device"
          body="One at the start and one at the end, to document seating distance and room lighting. Stored on this device with your participant code, used only as a record that the setup was correct."
        />
        {askAnnotationVideo && (
          <Opt
            testid="consent-video" checked={annotationVideo} set={setAnnotationVideo}
            title="Keep short video clips of my eyes while I read"
            body="A few minutes in total. A trained assessor watches them frame by frame to check the automatic blink measurement is accurate. This is what allows the method to be validated; it is optional and you can take part fully without it."
          />
        )}

        <button className={btn} disabled={!agreed}
          style={{ marginTop: 22, background: agreed ? '#1a1a2e' : '#cfcbc3', cursor: agreed ? 'pointer' : 'not-allowed' }}
          onClick={() => agreed && onConsent({
            camera_metrics: cameraMetrics,
            setup_photos: setupPhotos,
            annotation_video: askAnnotationVideo && annotationVideo,
            granted_at: Date.now(),
          })}>
          I consent — continue →
        </button>
        <p className="font-lab text-xs" style={{ color: '#5a5a7a', marginTop: 10 }}>
          Unticked boxes are recorded as a refusal, not left blank.
        </p>
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
export function Preflight({ onDone }: { onDone: (fontOk: boolean | null) => void }) {
  const [checked, setChecked] = useState<boolean[]>(Array(PREFLIGHT_ITEMS.length).fill(false));
  /**
   * Storage durability is checked here rather than left to the operator's judgement, because the
   * failure it guards against is invisible: in a private window every write succeeds and the whole
   * session is discarded when the tab closes. A machine check is the only thing that catches it.
   */
  const [storage, setStorage] = useState<StorageHealth | null>(null);
  useEffect(() => { void assessStorageHealth().then(setStorage); }, []);

  /**
   * The stimulus typeface is part of the display condition. Checked by machine, for the same
   * reason storage is: a fallback face looks like a slightly different font, not like a fault, so
   * an operator would never catch it. Reported and recorded rather than blocking — the session is
   * still worth running, but the analysis has to know the stimulus was not the intended one.
   */
  const [fontOk, setFontOk] = useState<boolean | null | undefined>(undefined);
  useEffect(() => { void stimulusFontLoaded().then(setFontOk); }, []);

  const storageBlocks = storage?.verdict === 'blocked';
  const all = checked.every(Boolean) && !!storage && !storageBlocks && fontOk !== undefined;
  const tone = { ok: '#22c97a', warn: '#c98a22', blocked: '#e64c4c', unknown: '#5a5a7a' } as const;
  return (
    <div className={shell}>
      <h1 className="font-serif text-4xl font-light">Pre-flight checklist</h1>
      <p className="mt-1 font-lab text-xs text-[#5a5a7a]">Researcher: confirm each item before starting.</p>

      <div
        data-testid="storage-health"
        style={{
          marginTop: 16, maxWidth: 640, padding: '12px 14px', borderRadius: 10,
          border: `1px solid ${storage ? tone[storage.verdict] : '#e5e2dc'}`,
          background: storage && storage.verdict !== 'ok' ? `${tone[storage.verdict]}12` : '#fff',
        }}
      >
        <p className="font-lab text-xs uppercase tracking-wide" style={{ color: storage ? tone[storage.verdict] : '#5a5a7a' }}>
          Device storage {storage ? `— ${storage.verdict}` : '— checking…'}
        </p>
        {storage?.messages.map((m, i) => (
          <p key={i} className="font-lab text-sm" style={{ marginTop: 6, color: '#3a3a4a' }}>{m}</p>
        ))}
      </div>
      {fontOk === false && (
        <div data-testid="font-warning" style={{ marginTop: 12, maxWidth: 640, padding: '12px 14px', borderRadius: 10, border: '1px solid #c98a22', background: '#c98a2212' }}>
          <p className="font-lab text-xs uppercase tracking-wide" style={{ color: '#c98a22' }}>Stimulus typeface — not loaded</p>
          <p className="font-lab text-sm" style={{ marginTop: 6, color: '#3a3a4a' }}>
            The reading passage will be rendered in a fallback face. The session can still be run
            and this is recorded in the export as <code>stimulus_font_ok=false</code>, but the
            stimulus will not match the other sessions. Reload the app from the home-screen icon
            before starting if you can.
          </p>
        </div>
      )}
      <div className="mt-5 space-y-2" style={{ maxWidth: 640 }}>
        {PREFLIGHT_ITEMS.map((item, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e2dc', background: '#fff', cursor: 'pointer' }}>
            <input type="checkbox" checked={checked[i]} onChange={(e) => { const n = [...checked]; n[i] = e.target.checked; setChecked(n); }} style={{ width: 20, height: 20 }} />
            <span className="font-lab text-sm">{item}</span>
          </label>
        ))}
      </div>
      <button className={btn} disabled={!all} data-testid="preflight-continue"
        style={{ marginTop: 18, background: all ? '#1a1a2e' : '#cfcbc3', cursor: all ? 'pointer' : 'not-allowed' }}
        onClick={() => all && onDone(fontOk ?? null)}>
        {storageBlocks ? 'Storage problem — cannot start' : 'All checks pass — continue →'}
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
