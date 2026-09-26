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
import { N_CONDITIONS } from '@/experiment/conditions';
import { PASSAGES, QUESTIONS_PER_PASSAGE } from '@/experiment/passages';
import { repeatRunAcknowledged, REPEAT_NOTE_MIN_CHARS, SPLIT_REASON_MIN_CHARS } from '@/experiment/participantProgress';
import { ILLUMINATION, luxInRange, type IlluminationLevel, N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';
import type { MediaConsent } from '@/storage/media';
import { ScrollCue } from '@/components/ScrollCue';
import { InfoTip } from '@/components/InfoTip';
import { UI_TEXT } from '@/lib/uiPalette';
import { now } from '@/lib/timing';
import { trackFieldBlockedTime, type HiddenTimeTracker } from '@/lib/hiddenTime';
import { stimulusFontLoaded } from '@/lib/fonts';
import { isBelowMinimum, currentScale, freshScale, refitScale } from '@/lib/viewportScale';
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
const shell = 'h-full w-full bg-cream px-[5%] py-10 font-sans text-[#1a1a2e] animate-fade-in overflow-y-auto';
const btn = 'rounded-xl px-8 py-3 font-sans text-base font-medium text-white transition active:scale-95';
/*
 * TYPE SCALE for these screens. The whole app is drawn on the 1194x834 design canvas and shrunk to
 * fit (viewportScale.ts): about 0.86 on a Xiaomi Pad 6, so a 12 px label arrived at the eye as about
 * 10 px — in DM Mono, a typewriter face that reads poorly as running text. The floor is now 15 px for
 * anything read as a sentence and 14 px for the small uppercase headings, in Roboto; DM Mono is kept
 * for what it is good at, the input fields where codes and numbers are typed. Colours are from
 * lib/uiPalette.ts, each at least 4.5:1 on these grounds (tests/contrast.test.ts).
 */
const eyebrow = 'font-sans text-sm font-medium uppercase tracking-wide text-[#4a4a60]';
const help = 'font-sans text-[15px] leading-relaxed text-[#4a4a60]';
const body = 'font-sans text-base leading-relaxed text-[#3a3a4a]';
/** A primary button's colours, enabled or not. Disabled was white on #cfcbc3, 1.6:1. */
const btnState = (ok: boolean) => ok
  ? { background: '#1a1a2e', cursor: 'pointer' }
  : { background: '#e8e6e1', color: UI_TEXT.muted, cursor: 'not-allowed' };
/** Inputs stay in DM Mono — codes and numbers are what is typed — at 17 px rather than 15. */
const VL_INPUT_CSS = `.vl-input{width:100%;padding:12px 14px;border:1px solid #bdb8ae;border-radius:10px;font-family:'DM Mono',monospace;font-size:17px;background:#fff;color:#1a1a2e}.vl-input::placeholder{color:#76747f}`;

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
  /** Researcher acknowledged re-running a participant who had already completed the protocol. */
  repeatRunNote: string | null;
  /**
   * Why this sitting was split, when it was. Null for a single sitting.
   *
   * The structure choice was a free per-participant toggle with nothing recording the grounds. If it
   * is ever made on how the participant LOOKS — tired, elderly, restless — then fatigue exposure
   * varies between people for a reason correlated with the outcome, and no column showed it. A
   * scheduling reason is harmless and a clinical one is a covariate; the difference is only
   * recoverable if it was written down at the moment of the decision.
   */
  sittingSplitReason: string | null;
}
export interface IlluminationAssignment {
  level: IlluminationLevel;
  block: number;
  orderFirst: IlluminationLevel;
  enrolment: number;
  conditionsCompleted: number;
  /** Complete passes through the ten conditions already finished. UNCLAMPED, unlike `block`. */
  priorPasses: number;
  /** Sittings already recorded for this participant, deleted ones excluded. */
  sittings: number;
  /** When this participant withdrew from the study, if they did (any sitting, the bin included). */
  withdrawnAt: number | null;
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
  const [repeatNote, setRepeatNote] = useState('');
  const [splitReason, setSplitReason] = useState('');
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
  /*
   * HAS THIS PARTICIPANT ALREADY FINISHED?
   *
   * resolveAssignment has always returned conditionsCompleted and this screen has never shown it.
   * A participant who had completed all ten conditions, re-entered at this console — a mistyped id
   * that collides with an existing one, a second visit, a researcher who does not remember — got
   * offset = completed % 10 = 0 and a full fresh plan of ten. The app started the entire protocol
   * again without a word, and every row of the replay was labelled exactly like a first run.
   *
   * So it is stated, and it is refused unless the researcher says why in writing — the same shape
   * as the lux deviation above, for the same reason: the decision belongs in the data.
   */
  const completedProtocol = assigned != null && assigned.priorPasses >= 1;
  const repeatAcknowledged = repeatRunAcknowledged(assigned?.priorPasses ?? 0, repeatNote);
  // Out-of-range is permitted only with an explicit written reason, so a deviation is recorded
  // as data rather than silently accepted or silently blocked.
  // A split is permitted only with an explicit written reason, on the same terms as an
  // out-of-range illuminance: recorded as data rather than silently accepted or silently blocked.
  const splitAcknowledged = sitting === 'single' || splitReason.trim().length >= SPLIT_REASON_MIN_CHARS;
  /*
   * A participant who withdrew cannot be run again under the same ID. Nothing stopped it: an RA typing
   * the ID on the scheduled day of sitting 2 created a sitting and collected it in full, and every row
   * was then dropped by the analysis — after the participant had given the time, and against their
   * instruction. Refused outright, not acknowledged: withdrawal is the participant's decision to make,
   * not the researcher's to override with a note.
   */
  const withdrawn = assigned?.withdrawnAt != null;
  const valid =
    /^[A-Za-z0-9_-]{1,20}$/.test(pid) && luxEntered && (inRange || deviation.trim().length >= 3)
    && repeatAcknowledged && splitAcknowledged && !withdrawn;

  return (
    <div className={shell}>
      {/* Two columns: who and where on the left, the display and the sitting on the right. As one
          560 px column the form ran well past the bottom of a tablet screen with most of the width
          empty, and the operator had to scroll to find what they had just typed. */}
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 1040 }}>
        <p className={eyebrow}>VisuLab · Research Console</p>
        <h1 className="mt-2 font-serif text-5xl font-light">New Session</h1>
        <div className="mt-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px 40px', alignItems: 'start' }}>
        <div className="space-y-5">
          <Field label="Participant ID — a CODE, not a name (letters, digits, - or _, ≤20)">
            <input data-testid="pid" className="vl-input" value={pid} onChange={(e) => setPid(e.target.value)} placeholder="P001" />
          </Field>
          {withdrawn && (
            <div data-testid="participant-withdrawn" className="font-sans text-base"
              style={{ border: '1px solid #b83a3a', background: '#fdeeee', color: '#5a1414', borderRadius: 10, padding: 12 }}>
              <strong>Participant {pid} withdrew from the study</strong> on{' '}
              {new Date(assigned!.withdrawnAt as number).toLocaleDateString()}. A new sitting cannot be
              started under this ID.
            </div>
          )}
          {assigned && assigned.conditionsCompleted > 0 && (
            <div
              data-testid="prior-progress"
              style={{
                border: `1px solid ${completedProtocol ? '#e0a33c' : '#d8d4cc'}`,
                borderRadius: 10, padding: '14px 16px',
                background: completedProtocol ? '#fdf6e8' : '#fbf9f5',
              }}
            >
              <p className={eyebrow}>Existing record for this ID</p>
              <p className="mt-1 font-serif text-xl">
                {assigned.conditionsCompleted} of {N_CONDITIONS} conditions completed
                {' · '}{assigned.sittings} sitting{assigned.sittings === 1 ? '' : 's'}
                {' · '}enrolment {assigned.enrolment}
              </p>
              <p className={help} style={{ marginTop: 6 }}>
                {completedProtocol
                  ? 'This participant has already been through the whole protocol. Starting now runs '
                    + 'all ten conditions AGAIN: they will re-read every passage, repeat every search '
                    + 'and see every comprehension question a second time. If this ID was a typo, '
                    + 'correct it. If the earlier sitting is to be discarded, delete it in the '
                    + 'dashboard first.'
                  : 'This sitting continues where they stopped — the condition order and enrolment '
                    + 'number are preserved.'}
              </p>
            </div>
          )}
          {completedProtocol && (
            <Field label={`⚠ Why is this participant being run again? (≥${REPEAT_NOTE_MIN_CHARS} chars — recorded with the session)`}>
              <input data-testid="repeat-run-note" className="vl-input" value={repeatNote} onChange={(e) => setRepeatNote(e.target.value)} placeholder="e.g. first sitting voided — camera failed throughout" />
            </Field>
          )}
          {assigned && spec && (
            <div style={{ border: '1px solid #d8d4cc', borderRadius: 10, padding: '14px 16px', background: '#fbf9f5' }}>
              <p className={eyebrow}>
                {N_ILLUMINATION_BLOCKS > 1
                  ? `Assigned illumination — block ${assigned.block + 1} of ${N_ILLUMINATION_BLOCKS}`
                  : 'Room illumination — single level for the whole study'}
              </p>
              <p className="mt-1 font-serif text-2xl">{spec.label}</p>
              <p className={help} style={{ marginTop: 4 }}>{spec.description}</p>
              <p className={help} style={{ marginTop: 6 }}>
                Set the room to <strong>{spec.target} lux</strong> (accept {spec.min}–{spec.max}) before measuring.
                {N_ILLUMINATION_BLOCKS > 1
                  ? ` Order for this participant: ${ILLUMINATION[assigned.orderFirst].label} first — assigned by counterbalancing, not chosen.`
                  : ' The same level is used for every participant and every sitting.'}
              </p>
            </div>
          )}
        </div>
        <div className="space-y-5">
          {/* The lux field, its verdict and any deviation note are one block, so the verdict line
              sits under the box with its own clear gap. It used to be a separate item in the form's
              spacing with a hand-set margin, and on the tablet it rode up against the input. */}
          <div data-testid="lux-block">
            <Field
              label={`Measured illuminance at the eye (lux) — ${spec ? `target ${spec.target}, accept ${spec.min}–${spec.max}` : 'measure with a lux meter'}`}
              info={<>
                Hold the lux meter at the participant&apos;s eye position, facing the screen, and type
                the reading. The app compares it with the accepted range for this study&apos;s
                illumination level. Outside the range you can still continue, but only with a written
                reason, which is saved with the session. The room is measured again at the
                mid-session break and at the end.
              </>}
            >
              <input data-testid="lux" className="vl-input" inputMode="numeric" value={lux} onChange={(e) => setLux(e.target.value)} placeholder={spec ? String(spec.target) : String(ILLUMINATION.moderate.target)} />
            </Field>
            {luxEntered && inRange && (
              <p data-testid="lux-in-range" role="status" className="font-sans text-[15px] font-medium"
                style={{ color: UI_TEXT.green, marginTop: 12, lineHeight: 1.45 }}>
                ✓ Within the accepted range for {spec!.label}.
              </p>
            )}
            {luxEntered && spec && !inRange && (
              <div style={{ marginTop: 14 }}>
                <Field label={`⚠ ${luxNum} lux is outside ${spec.min}–${spec.max}. Adjust the room, or record why you are proceeding (≥3 chars).`}>
                  <input data-testid="lux-deviation" className="vl-input" value={deviation} onChange={(e) => setDeviation(e.target.value)} placeholder="Reason for protocol deviation" />
                </Field>
              </div>
            )}
          </div>
          <Field
            label="Measured white-screen luminance (cd/m², optional)"
            info={<>
              Optional. Show a full white screen at the brightness used for the session and measure it
              with a luminance meter. The number is saved with the session as a record of how bright
              the display actually was; the app does not change anything because of it.
            </>}
          >
            <input className="vl-input" inputMode="numeric" value={lum} onChange={(e) => setLum(e.target.value)} placeholder="120" />
          </Field>
          <Field
            label="Locked display brightness (%, optional)"
            info={<>
              Optional. The brightness setting the tablet is fixed at for the session, with
              auto-brightness off. A web app cannot read or set the brightness itself, so it is typed
              here and saved with the session, which makes a change between sittings visible later.
            </>}
          >
            <input className="vl-input" inputMode="numeric" value={bright} onChange={(e) => setBright(e.target.value)} placeholder="80" />
          </Field>
          <div>
          <Pick
            label="Session structure (split shortens each sitting to reduce fatigue/boredom)"
            value={sitting}
            set={(v) => setSitting(v as 'single' | 'split')}
            opts={['single', 'split']}
          />
          <p className={help} style={{ marginTop: 10 }}>
            {sitting === 'single'
              ? `Single sitting: all ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT} conditions (${CONFIG.SINGLE_SITTING_DURATION}).`
              : `Split: ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2} conditions now, the remaining ${CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2} in a later sitting (re-enter the same Participant ID; the condition order is preserved). Both halves export as ONE participant.`}
          </p>
          </div>
          {sitting === 'split' && (
            <div style={{ marginTop: 12 }}>
              <Field label={`⚠ Why is this sitting being split? (≥${SPLIT_REASON_MIN_CHARS} chars — recorded with the session)`}>
                <input
                  data-testid="split-reason"
                  className="vl-input"
                  value={splitReason}
                  onChange={(e) => setSplitReason(e.target.value)}
                  placeholder="e.g. room booked for 1 h only — scheduling, not participant state"
                />
              </Field>
              <p className={help} style={{ marginTop: 8 }}>
                Say whether the reason is logistical or about this participant. A scheduling reason is
                harmless; splitting because someone looks tired makes fatigue exposure depend on how
                they presented, which is a covariate the analysis has to know about.
              </p>
            </div>
          )}
        </div>
        </div>
        {err && <p className="mt-3 font-sans text-[15px]" style={{ color: UI_TEXT.red }}>{err}</p>}
        <button
          className={btn}
          style={{ marginTop: 28, ...btnState(valid) }}
          disabled={!valid}
          onClick={() => {
            if (!valid) {
              setErr(
                !repeatAcknowledged
                  ? 'This participant has already completed all ten conditions. Record why they are being run again, correct the ID, or delete the earlier sitting in the dashboard.'
                  : !splitAcknowledged
                    ? `A split sitting needs a reason of at least ${SPLIT_REASON_MIN_CHARS} characters, so that a clinical judgement is not indistinguishable from a scheduling one later.`
                    : luxEntered && spec && !inRange
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
              repeatRunNote: completedProtocol ? repeatNote.trim() : null,
              sittingSplitReason: sitting === 'split' ? splitReason.trim() : null,
              conditionsPerSession: sitting === 'split' ? CONFIG.CONDITIONS_PER_SESSION_DEFAULT / 2 : CONFIG.CONDITIONS_PER_SESSION_DEFAULT,
              luxDeviationNote: inRange ? null : deviation.trim(),
            });
          }}
        >
          Begin setup →
        </button>
      </div>
      <style>{VL_INPUT_CSS}</style>
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
   * This, not the app's own digital colour-vision screen, is the basis for exclusion. The digital
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
      {/* Two columns: ten questions in one 640 px column ran far below the fold. The no/yes groups
          stay in the same document order (colour-vision self-report, then caffeine). */}
      <div style={{ width: '100%', maxWidth: 1040, margin: '0 auto' }}>
      <h1 className="font-serif text-4xl font-light">Participant profile</h1>
      <p className={`mt-2 ${help}`}>Eligibility: ages {CONFIG.MIN_AGE}–{CONFIG.MAX_AGE}. Contact-lens wear on a test day and colour-vision deficiency are exclusions.</p>
      <div className="mt-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px 40px', alignItems: 'start' }}>
      <div className="space-y-5">
        <Field label={`Age (${CONFIG.MIN_AGE}–${CONFIG.MAX_AGE})`}><input data-testid="age" className="vl-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        <Pick label="Gender" value={gender} set={setGender} opts={['male', 'female', 'non-binary', 'prefer not to say']} />
        <Field label="Daily screen hours"><input data-testid="hours" className="vl-input" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="6" /></Field>
        <Pick label="Device familiarity" value={fam} set={(v) => setFam(v as ProfileData['deviceFamiliarity'])} opts={['low', 'moderate', 'high']} />
        <Pick label="Typical lighting" value={light} set={(v) => setLight(v as ProfileData['lightingHabit'])} opts={['bright', 'moderate', 'dim']} />
      </div>
      <div className="space-y-5">
        <Pick label="Vision correction" value={corr} set={(v) => setCorr(v as ProfileData['correctionType'])} opts={['none', 'glasses', 'contacts']} />
        <Pick label="Any colour-vision deficiency? (self-report; the colour-vision plates follow)" value={cvd == null ? '' : cvd ? 'yes' : 'no'} set={(v) => setCvd(v === 'yes')} opts={['no', 'yes']} />
        <Pick
          label="Formal colour-vision plates (operator's clinical screening)"
          value={clinicalCvd}
          set={setClinicalCvd}
          opts={['normal', 'deficient', 'not done']}
        />
        <Pick label="Caffeine in the last ~4 hours?" value={caffeine == null ? '' : caffeine ? 'yes' : 'no'} set={(v) => setCaffeine(v === 'yes')} opts={['no', 'yes']} />
        <Field label="Hours since you woke up today"><input data-testid="since-sleep" className="vl-input" inputMode="numeric" value={sinceSleep} onChange={(e) => setSinceSleep(e.target.value)} placeholder="3" /></Field>
      </div>
      </div>
      <button
        className={btn}
        style={{ marginTop: 28, ...btnState(!!valid) }}
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
      <style>{VL_INPUT_CSS}</style>
      <ScrollCue />
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
    <div className={shell}>
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 760 }}>
        <h1 className="font-serif text-4xl font-light">Camera setup</h1>

        {step === 'notice' && (
          <>
            {/* Conditional, because the unconditional version was false for anyone who had ticked
                a retention grant on the immediately preceding screen: they were told in writing
                that nothing was kept, while two photographs of them were written to storage. In a
                consent record for an ethics-approved protocol that is not a wording problem. */}
            <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-[#eef3ff] p-4 font-sans text-base leading-relaxed">
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
            <p className={`mt-4 ${help}`}>
              Sit directly facing the screen, ~50–60 cm away, with your face clearly visible and
              well-lit. Avoid strong light behind you. The browser will ask for camera permission —
              please tap “Allow”.
            </p>
            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={requestCamera}>Enable camera →</button>
              <button className="rounded-xl border border-[#bdb8ae] bg-white px-8 py-3 font-sans text-base text-[#3a3a4a]" onClick={onSkip}>
                Continue without camera
              </button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <p className={`mt-3 ${help}`}>
              Check the preview: your whole face should be centred, in frame, and well-lit.
            </p>
            {/*
              A REAL face box, drawn from FaceMesh, not a hard-coded "Camera active" chip.
              Three documents tell the operator to check for a face box before starting; there was
              none, and no detection at all. This also probes MediaPipe itself — the model is not
              otherwise loaded until after the preview closes, so a device whose model files did not
              precache passed every documented check and then collected a study with no ocular data.
            */}
            <div style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden', background: '#000', width: 480, maxWidth: '100%', aspectRatio: '4 / 3', position: 'relative' }}>
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
                <span data-testid="face-status" style={{ color: '#fff', fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 15 }}>
                  {FACE_LABEL[face.status]}
                </span>
              </div>
            </div>
            {face.status === 'unavailable' && (
              <div className="mt-3 rounded-xl border border-[#e64c4c] bg-[#fff0f0] p-3 font-sans text-base leading-relaxed" style={{ color: '#7a1010' }}>
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
              <button className="rounded-xl border border-[#bdb8ae] bg-white px-8 py-3 font-sans text-base text-[#3a3a4a]" onClick={() => { stopPreview(); onSkip(); }}>
                Continue without camera
              </button>
            </div>
          </>
        )}

        {step === 'denied' && (
          <>
            <div className="mt-4 rounded-xl border border-[#f5a62366] bg-[#fff8ec] p-4 font-sans text-base leading-relaxed" style={{ color: UI_TEXT.amber }}>
              {errMsg}
            </div>
            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={() => { setErrMsg(''); setStep('notice'); }}>Retry</button>
              <button className="rounded-xl border border-[#bdb8ae] bg-white px-8 py-3 font-sans text-base text-[#3a3a4a]" onClick={onSkip}>
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
    <div className={shell}>
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 760 }}>
        <h1 className="font-serif text-4xl font-light">Camera measurement declined</h1>
        <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-[#eef3ff] p-4 font-sans text-base leading-relaxed">
          This participant did not consent to camera measurement, so the camera will not be used at
          any point in this session and no blink, gaze or head-position data will be collected.
        </div>
        <p className={`mt-4 ${help}`}>
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
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
      <h1 className="font-serif text-4xl font-light">Positioning check</h1>
      <p className={`mt-2 ${help}`}>
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
/**
 * The grey adaptation field, which reports how much of itself the participant actually saw.
 *
 * `onDone` took no argument, so the caller recorded the PLANNED duration under a comment saying it
 * recorded what was delivered. The countdown is driven by requestAnimationFrame, which stops when
 * the document is hidden — a tablet auto-locking sixty seconds into a 120 s polarity-switch field
 * freezes it, and on waking `now() - start` already exceeds `durationMs`, so progress clamps to 1
 * and the screen advances at once. The participant saw a minute of grey and four minutes of a dark
 * screen; the export certified a full polarity-switch control that did not happen.
 *
 * Time while the document was hidden is not adaptation, so it is measured and subtracted, the same
 * treatment the reading task already gives `reading_hidden_ms`.
 */
export interface AdaptationResult {
  /** Grey field actually in front of the participant (hidden, portrait and notice time excluded). */
  visibleMs: number;
  hiddenMs: number;
  /** Who ended it: the participant tapping Continue after the minimum, or the timer at the maximum. */
  endedBy: 'participant' | 'timer';
}

/*
 * The grey field: at least `minMs`, then the participant may tap Continue; it moves on by itself at
 * `maxMs`. Both are VISIBLE time — a tablet that sleeps or is rotated does not count towards either.
 *
 * Text is black on the grey (5.3:1): white at 90% and 60% opacity was 3.5:1 and 2.5:1, below the
 * contrast floor for small text. The Continue button is grey-on-grey with a black outline, identical
 * in every condition, so it cannot differ by polarity; it is a small area, so it barely moves the
 * field's luminance.
 */
export function AdaptationScreen({ minMs, maxMs, nextLabel, onDone }: {
  minMs: number;
  maxMs: number;
  nextLabel: string;
  onDone: (result: AdaptationResult) => void;
}) {
  const [visible, setVisible] = useState(0);
  const start = useRef(now());
  // Shared implementation — this screen's copy was the correct one and the reading task's was not,
  // which is the reason there is now only one. Hidden OR portrait: either way the grey field is not
  // what the participant is looking at. See lib/hiddenTime.ts.
  // Created ONCE, lazily. `useRef(trackFieldBlockedTime())` evaluates its argument on every render,
  // and this screen re-renders on every animation frame: each render built a fresh tracker — a media
  // query and listeners on the document — that nothing ever detached, tens of thousands per sitting.
  const [hiddenTracker] = useState<HiddenTimeTracker>(() => trackFieldBlockedTime());
  const hidden = useRef<HiddenTimeTracker>(hiddenTracker);
  const done = useRef(false);

  useEffect(() => {
    const t = hidden.current;
    return () => { t.stop(); };
  }, []);

  const finish = (endedBy: AdaptationResult['endedBy']) => {
    if (done.current) return;
    done.current = true;
    const hiddenNow = hidden.current.read().hiddenMs;
    const v = Math.max(0, now() - start.current - hiddenNow);
    onDone({ visibleMs: Math.round(v), hiddenMs: Math.round(hiddenNow), endedBy });
  };

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (done.current) return;
      const hiddenNow = hidden.current.read().hiddenMs;
      const v = Math.max(0, now() - start.current - hiddenNow);
      setVisible(v);
      if (v >= maxMs) finish('timer');
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minMs, maxMs]);

  const canContinue = visible >= minMs;
  const r = 34;
  const circ = 2 * Math.PI * r;
  // The ring fills over the MINIMUM: it says "not yet", then gives way to the Continue button.
  const progress = Math.min(1, visible / Math.max(1, minMs));
  return (
    <div data-testid="adaptation" style={{ position: 'fixed', inset: 0, background: CONFIG.ADAPTATION_COLOR, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
      {!canContinue ? (
        <svg width={88} height={88} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={44} cy={44} r={r} fill="none" stroke="#00000030" strokeWidth={6} />
          <circle cx={44} cy={44} r={r} fill="none" stroke="#000" strokeWidth={6}
            strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)} style={{ transition: 'stroke-dashoffset 0.1s linear' }} />
        </svg>
      ) : (
        <button type="button" data-testid="adaptation-continue" onClick={() => finish('participant')}
          style={{ fontFamily: '"DM Mono", monospace', fontSize: 20, padding: '14px 34px', borderRadius: 14, border: '2px solid #000', background: 'transparent', color: '#000', cursor: 'pointer' }}>
          Continue →
        </button>
      )}
      <p style={{ marginTop: 18, fontFamily: '"DM Mono", monospace', fontSize: 18 }}>
        {canContinue
          ? `Continue when you are ready · moves on by itself in ${Math.max(0, Math.ceil((maxMs - visible) / 1000))}s`
          : `Rest your eyes · you can continue in ${Math.max(0, Math.ceil((minMs - visible) / 1000))}s`}
      </p>
      <p style={{ marginTop: 6, fontFamily: '"DM Mono", monospace', fontSize: 16 }}>{nextLabel}</p>
    </div>
  );
}

// ---- INSTRUCTIONS (participant overview, shown once before the conditions) ----
/*
 * Every count on this screen is derived, not written in. It said "10 different screen displays" to
 * a participant in a five-condition split sitting, "about four short pages" after passages became
 * three, and "tap when a plain black or white dot appears, and not when it is coloured" after the
 * reaction task changed to the opposite rule — tap the dot in the colour of the text just read. A
 * participant who remembered this overview would have started every reaction block with the wrong
 * rule. It also quoted "90 minutes to two hours", a figure this screen cannot know (it depends on the
 * sitting's size and reading rate); the researcher states the expected duration at consent.
 */
export function Instructions({ conditions, onContinue }: { conditions: number; onContinue: () => void }) {
  const pages = Math.max(...PASSAGES.map((p) => p.pages.length));
  const breakEvery = CONFIG.BREAK_EVERY_N_CONDITIONS;
  return (
    <div className={shell} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 800 }}>
        <p className={eyebrow}>Before you begin</p>
        <h1 className="mt-2 font-serif text-4xl font-light">What you’ll be doing</h1>
        <p className="mt-4 font-sans text-[17px] leading-relaxed text-[#3a3a4a]" data-testid="instructions-count">
          In this sitting you’ll see <strong>{conditions} different screen displays</strong> (different
          background and text colours). For <strong>each</strong> display you’ll complete the same short
          tasks in the same order:
        </p>
        <ol className="mt-4 font-sans text-[17px] leading-relaxed text-[#3a3a4a]" style={{ paddingLeft: 18, listStyle: 'decimal' }}>
          <li><strong>Read</strong> a passage of {pages} short pages.</li>
          <li>Answer <strong>{QUESTIONS_PER_PASSAGE} questions</strong> about it.</li>
          <li>Rate the display’s <strong>comfort &amp; clarity</strong>, and how your <strong>eyes feel</strong>.</li>
          <li><strong>Find &amp; tap</strong> every occurrence of a target word, as fast as you can.</li>
          <li><strong>Tap</strong> when a dot appears in the <strong>same colour as the text you have
            just read</strong>, and not when it is any other colour (a quick reaction game).</li>
        </ol>
        <p className="mt-4 font-sans text-[17px] leading-relaxed text-[#3a3a4a]">
          Between displays there’s a short rest with a grey screen, and a longer break after
          every {breakEvery === 1 ? 'display' : `${breakEvery} displays`}. Each task shows its own
          instructions and a “Begin” button, so just follow the prompts. You may tell the researcher
          if you need to stop, at any point.
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
    <div className={shell} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      {/* Centred, and in reading order: the participant's message first, then — set apart — what
          the researcher does next. The end-of-session lux panel used to sit between the heading and
          the thank-you, on a left-aligned column with the right half of the screen empty. */}
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
        <h1 className="font-serif text-5xl font-light">Thank you</h1>
        <p className={`mt-3 ${body}`} style={{ fontSize: 17 }}>
          Your responses have been recorded and will contribute to research on visual ergonomics.
          Please inform the researcher that you have finished.
        </p>
        <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid #e5e2dc' }}>
          {luxPanel}
          <button className={btn} style={{ marginTop: 18, background: '#1a1a2e' }} onClick={onExport}>
            Researcher: view export dashboard →
          </button>
        </div>
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

  /*
   * Each option is a checkbox row with its explanation beside it. No "i" notes here: anything shown
   * to the participant on this screen is consent wording, and the approved wording is the text
   * below and the option notes. Plain-language detail on what each option does belongs in the
   * operator manual, not in an extra sentence the ethics committee has not seen.
   */
  const Opt = ({ checked, set, title, note, testid }: {
    checked: boolean; set: (v: boolean) => void; title: string; note: string; testid: string;
  }) => (
    <label style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'flex-start', marginTop: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid #e5e2dc', background: '#fff' }}>
      <input
        type="checkbox" data-testid={testid} checked={checked}
        onChange={(e) => set(e.target.checked)}
        style={{ width: 24, height: 24, marginTop: 2, flexShrink: 0 }}
      />
      <span>
        <span className="font-sans text-[17px]" style={{ fontWeight: 500, color: UI_TEXT.ink }}>{title}</span>
        <span className={help} style={{ display: 'block', marginTop: 4 }}>{note}</span>
      </span>
    </label>
  );

  return (
    <div className={shell}>
      {/* A readable column across the screen, not a strip down its middle. The consent text is set at
          17 px with generous leading and scrolls inside its own box, so the choices and the button
          stay on screen. The decorative wave lines that used to run behind it are gone: they crossed
          the words. */}
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 880 }}>
        <h1 className="font-serif text-4xl font-light">Informed consent</h1>
        <div data-testid="consent-text" className="scrollable mt-4 font-sans text-[#2a2a3a]"
          style={{ fontSize: 17, lineHeight: 1.6, maxHeight: 360, padding: '16px 20px', borderRadius: 12, border: '1px solid #e5e2dc', background: '#fff' }}>
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

        <label style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, cursor: 'pointer' }}>
          <input type="checkbox" data-testid="consent-core" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 24, height: 24 }} />
          <span className="font-sans text-[17px]" style={{ fontWeight: 500 }}>I have read the above and consent to participate.</span>
        </label>

        <p className={eyebrow} style={{ marginTop: 22 }}>
          Optional — each is a separate choice
        </p>
        <Opt
          testid="consent-camera" checked={cameraMetrics} set={setCameraMetrics}
          title="Use the camera for blink and head-position measures"
          note="Numbers only. No image or video is saved. Declining means the eye measures are not collected for you; everything else runs as normal."
        />
        <Opt
          testid="consent-photos" checked={setupPhotos} set={setSetupPhotos}
          title="Keep two photographs of me at the device"
          note="One at the start and one at the end, to document seating distance and room lighting. Stored on this device with your participant code, used only as a record that the setup was correct."
        />
        {askAnnotationVideo && (
          <Opt
            testid="consent-video" checked={annotationVideo} set={setAnnotationVideo}
            title="Keep short video clips of my eyes while I read"
            note="A few minutes in total. A trained assessor watches them frame by frame to check the automatic blink measurement is accurate. This is what allows the method to be validated; it is optional and you can take part fully without it."
          />
        )}

        <button className={btn} disabled={!agreed}
          style={{ marginTop: 22, ...btnState(agreed) }}
          onClick={() => agreed && onConsent({
            camera_metrics: cameraMetrics,
            setup_photos: setupPhotos,
            annotation_video: askAnnotationVideo && annotationVideo,
            granted_at: Date.now(),
          })}>
          I consent — continue →
        </button>
        <p className={help} style={{ marginTop: 10 }}>
          Unticked boxes are recorded as a refusal, not left blank.
        </p>
      </div>
      <ScrollCue gutter />
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

  /**
   * Is the screen too small for the design canvas even at the smallest scale the study allows?
   *
   * `isBelowMinimum()` existed with a comment saying "the operator needs to know rather than
   * discover it as a missing button" — and had no caller anywhere in the app, so nobody was told
   * anything. Content past the edge is not merely off-screen: #root sets overflow:hidden so a
   * stimulus cannot be scrolled mid-exposure, and body sets touch-action:none, so it is unreachable
   * by any gesture. The way that presents is a Continue button that does not exist.
   *
   * Re-checked on resize, because the pre-flight screen is where an operator would rotate the
   * tablet or dismiss the address bar in response to being told.
   */
  const [clipped, setClipped] = useState(false);
  /*
   * The scale actually applied, beside the one this screen supports if measured fresh. A lock (see
   * viewportScale.ts) was invisible: the check above reads the live screen, so a tablet stuck at half
   * size on a full-size screen passed silently. Now it is shown, and one tap re-fits it.
   */
  const [scale, setScale] = useState(() => ({ applied: currentScale(), fresh: freshScale() }));
  useEffect(() => {
    const check = () => {
      setClipped(isBelowMinimum());
      setScale({ applied: currentScale(), fresh: freshScale() });
    };
    check();
    const late = window.setTimeout(check, 400);
    window.addEventListener('resize', check);
    return () => { window.clearTimeout(late); window.removeEventListener('resize', check); };
  }, []);
  const scaleLocked = scale.applied < scale.fresh - 0.02;
  const refit = () => {
    refitScale();
    window.setTimeout(() => setScale({ applied: currentScale(), fresh: freshScale() }), 100);
  };

  const storageBlocks = storage?.verdict === 'blocked';
  const all = checked.every(Boolean) && !!storage && !storageBlocks && fontOk !== undefined;
  // Bright hues for borders and tints; the dark ones, each ≥4.5:1, for the words.
  const tone = { ok: '#22c97a', warn: '#c98a22', blocked: '#e64c4c', unknown: '#5a5a7a' } as const;
  const toneText = { ok: UI_TEXT.green, warn: UI_TEXT.amber, blocked: UI_TEXT.red, unknown: UI_TEXT.muted } as const;
  const boxText = 'font-sans text-[15px] leading-relaxed text-[#3a3a4a]';
  return (
    <div className={shell}>
      {/* Two columns: what the app checked on the left, what the researcher confirms on the right.
          One 640 px column put the checklist and the Continue button below the fold. */}
      <div style={{ width: '100%', maxWidth: 1040, margin: '0 auto' }}>
      <h1 className="font-serif text-4xl font-light">Pre-flight checklist</h1>
      <p className={`mt-2 ${help}`}>Researcher: confirm each item before starting.</p>

      <div className="mt-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '12px 32px', alignItems: 'start' }}>
      <div>
      <div
        data-testid="storage-health"
        style={{
          padding: '12px 14px', borderRadius: 10,
          border: `1px solid ${storage ? tone[storage.verdict] : '#e5e2dc'}`,
          background: storage && storage.verdict !== 'ok' ? `${tone[storage.verdict]}12` : '#fff',
        }}
      >
        <p className={eyebrow} style={{ color: storage ? toneText[storage.verdict] : UI_TEXT.muted }}>
          Device storage {storage ? `— ${storage.verdict}` : '— checking…'}
        </p>
        {storage?.messages.map((m, i) => (
          <p key={i} className={boxText} style={{ marginTop: 6 }}>{m}</p>
        ))}
      </div>
      <div data-testid="scale-check"
        style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${scaleLocked ? '#b3261e' : '#d8d4cc'}`, background: scaleLocked ? '#fdeeee' : '#fff' }}>
        <p className={boxText} style={{ color: scaleLocked ? '#8a1c14' : '#3a3a4a' }}>
          <strong>Display size:</strong> {Math.round(scale.applied * 100)}% of design size
          {scaleLocked ? ` — this screen supports ${Math.round(scale.fresh * 100)}%.` : ' — correct for this screen.'}
          {' '}
          <InfoTip label="display size">
            Every screen is drawn at a fixed design size (1194 × 834) and shrunk to fit this tablet.
            The percentage is how much it is shrunk. It shrinks the reading text too, so it is saved
            with every condition. It should match what this screen supports; if it is lower, tap
            Re-fit.
          </InfoTip>
        </p>
        {scaleLocked && (
          <>
            <p className={boxText} style={{ marginTop: 6 }}>
              The app is drawing everything smaller than it should, so the reading text would be too
              small. This happens after the app was opened in a floating or split window. Tap Re-fit;
              if it does not change, close the app from recent apps and reopen it full-screen.
            </p>
            <button type="button" data-testid="scale-refit" onClick={refit} className="font-sans text-base"
              style={{ marginTop: 10, padding: '10px 16px', borderRadius: 10, border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff', cursor: 'pointer' }}>
              Re-fit screen
            </button>
          </>
        )}
      </div>
      {clipped && (
        <div data-testid="layout-warning" style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid #c98a22', background: '#c98a2212' }}>
          <p className={eyebrow} style={{ color: UI_TEXT.amber }}>Screen too small — content is being clipped</p>
          <p className={boxText} style={{ marginTop: 6 }}>
            This viewport is smaller than the app can scale down to, so parts of some screens are
            past the edge — and they cannot be scrolled to, because a stimulus screen must not
            scroll mid-exposure. Buttons may simply be absent. Rotate to landscape, launch from the
            home-screen icon so the address bar is gone, and close any split-screen or floating
            window. If you run anyway, these rows carry <code>stimulus_scale=0.5</code>, which is
            the value that means the layout did not fit.
          </p>
        </div>
      )}
      {fontOk === false && (
        <div data-testid="font-warning" style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid #c98a22', background: '#c98a2212' }}>
          <p className={eyebrow} style={{ color: UI_TEXT.amber }}>Stimulus typeface — not loaded</p>
          <p className={boxText} style={{ marginTop: 6 }}>
            The reading passage will be rendered in a fallback face. The session can still be run
            and this is recorded in the export as <code>stimulus_font_ok=false</code>, but the
            stimulus will not match the other sessions. Reload the app from the home-screen icon
            before starting if you can.
          </p>
        </div>
      )}
      </div>
      <div className="space-y-2">
        {PREFLIGHT_ITEMS.map((item, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', minHeight: 48, borderRadius: 10, border: '1px solid #e5e2dc', background: '#fff', cursor: 'pointer' }}>
            <input type="checkbox" checked={checked[i]} onChange={(e) => { const n = [...checked]; n[i] = e.target.checked; setChecked(n); }} style={{ width: 22, height: 22, flexShrink: 0 }} />
            <span className="font-sans text-base text-[#1a1a2e]">{item}</span>
          </label>
        ))}
      </div>
      </div>
      <button className={btn} disabled={!all} data-testid="preflight-continue"
        style={{ marginTop: 20, ...btnState(all) }}
        onClick={() => all && onDone(fontOk ?? null)}>
        {storageBlocks ? 'Storage problem — cannot start' : 'All checks pass — continue →'}
      </button>
      </div>
      <ScrollCue />
    </div>
  );
}

// ---- helpers ----
/**
 * A labelled input. The "i" sits OUTSIDE the <label>, top right: a button inside a label is the
 * label's first labelable element, so tapping the field's wording would open the note rather than
 * focus the input.
 */
function Field({ label, info, children }: { label: string; info?: ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block' }}>
        <span className="font-sans text-[15px] font-medium text-[#3a3a4a]" style={{ display: 'block', lineHeight: 1.4, paddingRight: info ? 36 : 0 }}>{label}</span>
        <div style={{ marginTop: 8 }}>{children}</div>
      </label>
      {info && (
        <span style={{ position: 'absolute', top: -4, right: 0 }}>
          <InfoTip label={label.split(' (')[0]} align="right">{info}</InfoTip>
        </span>
      )}
    </div>
  );
}
function Pick({ label, value, set, opts }: { label: string; value: string; set: (v: string) => void; opts: string[] }) {
  return (
    <div>
      <span className="font-sans text-[15px] font-medium text-[#3a3a4a]" style={{ display: 'block', lineHeight: 1.4 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {opts.map((o) => (
          <button
            key={o}
            onClick={() => set(o)}
            className="font-sans text-base"
            style={{
              padding: '10px 16px', borderRadius: 10, textTransform: 'capitalize', minHeight: 44,
              border: `1px solid ${value === o ? '#1a1a2e' : '#bdb8ae'}`,
              background: value === o ? '#1a1a2e' : '#fff',
              color: value === o ? '#fff' : '#3a3a4a', cursor: 'pointer',
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
