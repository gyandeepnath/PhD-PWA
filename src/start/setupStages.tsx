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
import { TASK_STEPS } from '@/experiment/taskSteps';
import { repeatRunAcknowledged, REPEAT_NOTE_MIN_CHARS, SPLIT_REASON_MIN_CHARS } from '@/experiment/participantProgress';
import { ILLUMINATION, luxInRange, type IlluminationLevel, N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';
import type { MediaConsent } from '@/storage/media';
import { ScrollCue } from '@/components/ScrollCue';
import { InfoTip } from '@/components/InfoTip';
import { UI_TEXT } from '@/lib/uiPalette';
import { now } from '@/lib/timing';
import { trackFieldBlockedTime, type HiddenTimeTracker } from '@/lib/hiddenTime';
import { stimulusFontLoaded } from '@/lib/fonts';
import {
  isBelowMinimum, currentScale, freshScale, refitScale, displayMode, isInstalledDisplay, screenFitScale,
  screenFill, DESIGN_WIDTH, DESIGN_HEIGHT, type DisplayMode,
} from '@/lib/viewportScale';
import type { LiveTrackingStats } from '@/tracking/useTracking';
import type { TrackerTrial } from '@/tracking/trackerChoice';
import { TRACKER_LABEL, type TrackerBackend } from '@/tracking/trackers';
import { FPS_TIER_THRESHOLD } from '@/tracking/blink';
import { LiveFeed, EarTrace, PipelineReadout } from '@/components/LiveCamera';
import { DeviceBox } from '@/components/DeviceBox';
import { ScreenCalibration, type ScreenCalibrationResult } from './ScreenCalibration';
import { BuildInfo, useUpdateWaiting } from '@/components/BuildInfo';
import type { CameraStatus, CameraPipelineRecord } from '@/storage/types';

/**
 * The setup screens must SCROLL when they are taller than the viewport.
 *
 * `#root` is `overflow: hidden` and `body` carries `touch-action: none`, so anything below the fold
 * on a setup screen is not merely off-screen — it is unreachable by any gesture. Measured on the
 * participant profile at iPad 11" landscape (1194x834, then the design canvas), the mandated
 * orientation: content height 1167 against a viewport of 834, with the caffeine yes/no buttons AND
 * the Continue button both past the bottom edge. The operator fills in the form and there is no way
 * to submit it, and no way to scroll to find one. iPad 10.2" landscape is the same. Portrait fits, which is why it was not
 * noticed.
 *
 * The E2E suite could not catch it either: every click in e2e/helpers.ts passes `force: true`,
 * which skips Playwright's actionability checks and dispatches the click wherever the element is,
 * so the full run passes on screens no finger can reach.
 *
 * min-h-0 is what lets the flex child actually shrink to its container instead of growing.
 *
 * `nav-band` keeps the top band clear for the operator's navigation chip ("Exit — resume later",
 * top left) and the progress label, so neither sits on a heading or a field; `panel-band` keeps the
 * bottom-left corner clear of the collapsed researcher panel, so it never sits on a button when the
 * form is scrolled to its end (theme.css).
 */
const shell = 'h-full w-full bg-cream px-[5%] nav-band panel-band font-sans text-[#1a1a2e] animate-fade-in overflow-y-auto';
/*
 * Both buttons are at least --vl-nav-chip-h tall: 44 CSS px on the device whenever the display is
 * scaled down, 44 design px when it is scaled up (theme.css). Sized in design px alone they arrive
 * smaller under a finger whenever the screen is scaled down — at 0.90, py-3 text-base comes to 43 px.
 */
const btn = 'min-h-[var(--vl-nav-chip-h)] rounded-xl px-8 py-3 font-sans text-base font-medium text-white transition active:scale-95';
/*
 * Back, on the few screens where going back is allowed (experiment/navigation.ts has the policy).
 * An outline button in the row of primary actions, first in the row, saying where it goes — so it is
 * never mistaken for the way forward, and never needs the operator to guess what it undoes.
 */
const btnBack = 'min-h-[var(--vl-nav-chip-h)] rounded-xl border border-[#bdb8ae] bg-white px-6 py-3 font-sans text-base text-[#3a3a4a] transition active:scale-95';
/*
 * TYPE SCALE for these screens. The app used to be drawn on a 1194x834 design canvas and shrunk to
 * fit (viewportScale.ts): about 0.86 on a Xiaomi Pad 6, so a 12 px label arrived at the eye as about
 * 10 px — in DM Mono, a typewriter face that reads poorly as running text. The floor is now 15 px for
 * anything read as a sentence and 14 px for the small uppercase headings, in Roboto; DM Mono is kept
 * for what it is good at, the input fields where codes and numbers are typed. Since Round 74 the canvas
 * is fitted to the screen in both directions, so those floors are design px — a fixed fraction of the
 * screen's width — at whatever pixel ratio the tablet reports, and never shrunk in the installed app.
 * Colours are from lib/uiPalette.ts, each at least 4.5:1 on these grounds (tests/contrast.test.ts).
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
  onDirty,
}: {
  onSubmit: (d: SessionInitData) => void;
  /** Looks up this participant's counterbalanced assignment from their enrolment history. */
  resolveAssignment: (participantId: string) => Promise<IlluminationAssignment>;
  /** Whether anything has been typed, so Cancel asks before throwing it away (and only then). */
  onDirty?: (dirty: boolean) => void;
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
  const dirty = [pid, lux, deviation, repeatNote, splitReason, lum, bright].some((v) => v.trim() !== '') || sitting !== 'single';
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

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
      {/* With the deviation and split-reason fields open the form runs about 200 px past the bottom
          of the tablet, and nothing said so. */}
      <ScrollCue />
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
export function ParticipantProfile({ onSubmit, initial, onBack }: {
  onSubmit: (d: ProfileData) => void;
  /**
   * The answers already submitted in this sitting, when the operator has come BACK to correct one.
   * Without them a single mistyped field meant re-entering all ten.
   */
  initial?: ProfileData | null;
  /** Back to consent — offered only while nothing has been measured under the grants (see Experiment). */
  onBack?: () => void;
}) {
  const [age, setAge] = useState(initial ? String(initial.age) : '');
  const [gender, setGender] = useState(initial?.gender ?? '');
  const [hours, setHours] = useState(initial ? String(initial.dailyScreenHours) : '');
  const [fam, setFam] = useState<ProfileData['deviceFamiliarity'] | ''>(initial?.deviceFamiliarity ?? '');
  const [light, setLight] = useState<ProfileData['lightingHabit'] | ''>(initial?.lightingHabit ?? '');
  const [corr, setCorr] = useState<ProfileData['correctionType'] | ''>(initial?.correctionType ?? '');
  const [cvd, setCvd] = useState<boolean | null>(initial ? initial.cvdSelfReport : null);
  const [caffeine, setCaffeine] = useState<boolean | null>(initial ? initial.caffeineToday : null);
  const [clinicalCvd, setClinicalCvd] = useState(initial ? (initial.cvdClinical === 'not_done' ? 'not done' : initial.cvdClinical) : '');
  const [sinceSleep, setSinceSleep] = useState(initial ? String(initial.hoursSinceSleep) : '');
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
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
      {onBack && <button type="button" className={btnBack} data-testid="back-to-consent" onClick={onBack}>← Back to consent</button>}
      <button
        className={btn}
        style={btnState(!!valid)}
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
      </div>
      <style>{VL_INPUT_CSS}</style>
      <ScrollCue />
    </div>
  );
}

// ---- CAMERA SETUP (with live preview) ----
/**
 * What camera setup needs from the tracker (tracking/useTracking.ts). Narrow, so the screen can be
 * rendered in a test without a camera.
 */
export interface CameraSetupTracking {
  status: CameraStatus;
  start: () => Promise<CameraStatus>;
  stop: () => void;
  startError: string | null;
  subscribeLive: (fn: (s: LiveTrackingStats) => void) => () => void;
  stream: () => MediaStream | null;
  pipelineInfo: () => CameraPipelineRecord | null;
  compareTrackers: (onProgress?: (p: { backend: TrackerBackend; index: number; total: number }) => void) => Promise<TrackerTrial[] | null>;
}

type FaceStatus = 'loading' | 'searching' | 'detected';
const FACE_LABEL: Record<FaceStatus, string> = {
  loading: 'Loading face tracking…',
  searching: 'No face detected yet',
  detected: 'Face detected',
};
const FACE_TONE: Record<FaceStatus, string> = {
  loading: '#c98a22',
  searching: '#c98a22',
  detected: '#22c97a',
};

/**
 * Camera setup, run on THE tracker the sitting will use.
 *
 * The preview used to be a separate camera: its own getUserMedia stream (1280x720 at 30 fps) and its
 * own FaceMesh "probe", pumped on requestAnimationFrame, never closed, and torn down before the real
 * tracker started on a second stream with different settings. So the face box an operator checked
 * here said nothing about the pipeline that then measured the participant — and the two models were
 * left running side by side for the rest of the sitting (round 74, R1 D4). Now "Enable camera" starts
 * the tracking pipeline itself, the preview is a second <video> on its stream, the face box and the
 * eyelid points are the tracker's own, and the numbers below the picture are the pipeline's: what the
 * camera delivers, what the tracker processes, in how many frames it finds the face, and which of
 * those is the limit. "Continue" hands the running camera to calibration; nothing restarts.
 *
 * The tracker is chosen by measurement on this device the first time (tracking/trackerChoice.ts):
 * each backend runs for a few seconds on this picture and the fastest is kept. The operator can
 * measure again; the comparison is recorded with the sitting. When CONFIG.TRACKER_BACKEND freezes the
 * tracker, there is nothing to measure and the screen says which one is fixed.
 */
export function CameraSetup({ camera, onContinue, onSkip, retains, onBack }: {
  camera: CameraSetupTracking;
  /** The face is centred: go on, with the camera running. */
  onContinue: () => void;
  /** Continue without the camera. The camera is stopped first. */
  onSkip: () => void;
  /** The photo/video grants actually in force, so the privacy notice can tell the truth. */
  retains?: { setupPhotos: boolean; annotationVideo: boolean };
  /**
   * Back to consent, to change the camera grant. Offered only while nothing has yet been captured
   * or measured under it (see Experiment.tsx); not while the preview is running.
   */
  onBack?: () => void;
}) {
  const [step, setStep] = useState<'notice' | 'starting' | 'preview' | 'denied'>(
    camera.status === 'active' ? 'preview' : 'notice');
  const [errMsg, setErrMsg] = useState('');
  /*
   * Whether the failure screen shows the library's own reason. The reason itself is read from the
   * CURRENT props when rendering, never inside requestCamera(): there `camera` is the object captured
   * at the render that started the request, whose startError is still the old (null) value, so the
   * Details line never appeared (round 77) — on exactly the tablet whose tracker cannot start.
   */
  const [showDetails, setShowDetails] = useState(false);
  const [live, setLive] = useState<LiveTrackingStats | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [comparing, setComparing] = useState<{ backend: TrackerBackend; index: number; total: number } | null>(null);
  const [trials, setTrials] = useState<TrackerTrial[] | null>(null);
  const [info, setInfo] = useState<CameraPipelineRecord | null>(null);
  const autoMeasured = useRef(false);

  useEffect(() => {
    if (step !== 'preview') return;
    setStream(camera.stream());
    setInfo(camera.pipelineInfo());
    return camera.subscribeLive((s) => setLive(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const measure = async () => {
    setComparing({ backend: 'tasks-gpu', index: 0, total: 3 });
    try {
      const t = await camera.compareTrackers((p) => setComparing(p));
      if (t) setTrials(t);
    } finally {
      setComparing(null);
      setInfo(camera.pipelineInfo());
    }
  };

  /*
   * First camera setup on this device, tracker not frozen: measure straight away, once. The choice is
   * kept on the device (trackerChoice.ts), so later sittings start with it and this does not repeat.
   */
  useEffect(() => {
    if (step !== 'preview' || autoMeasured.current) return;
    const i = camera.pipelineInfo();
    if (CONFIG.TRACKER_BACKEND === 'auto' && i?.tracker_selection === 'default') {
      autoMeasured.current = true;
      void measure();
    } else if (i?.tracker_trials) {
      setTrials(i.tracker_trials as TrackerTrial[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const requestCamera = async () => {
    setStep('starting');
    const st = await camera.start();
    if (st === 'active') { setStep('preview'); return; }
    setErrMsg(st === 'denied'
      ? 'Camera permission was denied. You can retry, or continue without the camera.'
      : st === 'unavailable'
        ? 'No camera API is available on this device/browser.'
        : `The camera or the face tracker could not be started, so no blink, gaze or head-position data `
          + `can be collected — the primary outcome would be empty for every condition. Check the device is `
          + `fully set up (see DEPLOYMENT.md section 4) before running a participant.`);
    setShowDetails(st === 'error');
    setStep('denied');
  };

  const faceStatus: FaceStatus = !live ? 'loading' : live.facePresent ? 'detected' : 'searching';
  const r0 = (x: number | null | undefined) => (x == null ? '—' : String(Math.round(x)));
  const selectionText: Record<CameraPipelineRecord['tracker_selection'], string> = {
    config: 'fixed for the study (CONFIG.TRACKER_BACKEND)',
    measured: 'measured on this tablet just now',
    stored: 'measured on this tablet earlier',
    default: 'not measured on this tablet yet',
  };

  return (
    <div className={shell}>
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 880 }}>
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
              {onBack && <button type="button" className={btnBack} data-testid="back-to-consent" onClick={onBack}>← Back to consent</button>}
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={requestCamera}>Enable camera →</button>
              <button className="rounded-xl border border-[#bdb8ae] bg-white px-8 py-3 font-sans text-base text-[#3a3a4a]" onClick={onSkip}>
                Continue without camera
              </button>
            </div>
          </>
        )}

        {step === 'starting' && (
          <p className={`mt-4 ${help}`} data-testid="camera-starting">Starting the camera and the face tracker…</p>
        )}

        {step === 'preview' && (
          <>
            <p className={`mt-3 ${help}`}>
              Check the preview: your whole face should be centred, in frame, and well-lit. The yellow
              points on the eyelids are what the blink measure is computed from.
            </p>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 12 }}>
              <div style={{ position: 'relative', width: 480, maxWidth: '100%' }}>
                <LiveFeed stream={stream} stats={live} width={480} testid="setup-feed" />
                {/* The face box is drawn on the picture by LiveFeed; this element states it for tests
                    and screen readers, from the tracker's own result. */}
                {live?.faceBox && <span data-testid="face-box" style={{ display: 'none' }} />}
                <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: '4px 10px' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: FACE_TONE[faceStatus] }} />
                  <span data-testid="face-status" style={{ color: '#fff', fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 15 }}>
                    {FACE_LABEL[faceStatus]}
                  </span>
                </div>
              </div>
              <div data-testid="camera-diagnostics" style={{ flex: '1 1 300px', minWidth: 280, background: '#1a1a2e', color: '#fff', borderRadius: 12, padding: '12px 14px' }}>
                <strong style={{ fontSize: 14, letterSpacing: 0.5 }}>CAMERA AND TRACKER</strong>
                <div style={{ marginTop: 6 }}><PipelineReadout stats={live} floor={FPS_TIER_THRESHOLD} /></div>
                <div style={{ marginTop: 6 }}><EarTrace stats={live} width={260} height={48} /></div>
                <div style={{ marginTop: 8, fontSize: 14, opacity: 0.85, lineHeight: 1.5 }} data-testid="camera-mode">
                  Asked for {info ? `${info.camera_requested.width}×${info.camera_requested.height} at ${info.camera_requested.frameRate} fps` : '—'};
                  the camera gave {info?.camera_settings.width ? `${info.camera_settings.width}×${info.camera_settings.height}` : '—'}
                  {info?.camera_settings.frameRate ? ` at ${info.camera_settings.frameRate} fps` : ''}
                  {info?.camera_capabilities?.frame_rate_max ? ` (its maximum: ${info.camera_capabilities.frame_rate_max} fps)` : ''}.
                  {' '}Tracker {selectionText[info?.tracker_selection ?? 'default']}.
                  {info?.tracker_failures.length ? ` Passed over: ${info.tracker_failures.map((f) => `${TRACKER_LABEL[f.backend as TrackerBackend] ?? f.backend} (${f.error})`).join('; ')}.` : ''}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[#cdd8f0] bg-white p-4 font-sans text-base" data-testid="tracker-choice">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong>Face tracker on this tablet</strong>
                {CONFIG.TRACKER_BACKEND === 'auto' ? (
                  <button type="button" data-testid="tracker-measure" disabled={comparing != null}
                    className="rounded-xl border border-[#1a1a2e] bg-white px-5 py-2 font-sans text-base text-[#1a1a2e] disabled:opacity-50"
                    onClick={() => void measure()}>
                    {comparing ? `Measuring ${comparing.index + 1} of ${comparing.total}: ${TRACKER_LABEL[comparing.backend]}…` : 'Measure trackers again'}
                  </button>
                ) : (
                  <span data-testid="tracker-frozen">Fixed: {TRACKER_LABEL[CONFIG.TRACKER_BACKEND]}</span>
                )}
              </div>
              {comparing && (
                <p className={`mt-2 ${help}`}>Keep the face in view: each tracker runs for a few seconds on this picture.</p>
              )}
              {trials && (
                <table data-testid="tracker-trials" style={{ width: '100%', marginTop: 8, fontSize: 15, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', opacity: 0.75 }}>
                      <th>Tracker</th><th>face fps</th><th>processed fps</th><th>ms / frame</th><th>95% ms</th><th>face in view</th><th>EAR noise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trials.map((t) => (
                      <tr key={t.backend} data-testid={`trial-${t.backend}`} style={{ fontWeight: info?.tracker_backend === t.backend ? 700 : 400 }}>
                        <td>{TRACKER_LABEL[t.backend]}{info?.tracker_backend === t.backend ? ' — in use' : ''}</td>
                        {t.ok ? (
                          <>
                            <td>{r0(t.faceFps)}</td><td>{r0(t.trackerFps)}</td><td>{r0(t.processMsP50)}</td><td>{r0(t.processMsP95)}</td>
                            <td>{t.faceShare == null ? '—' : `${Math.round(t.faceShare * 100)}%`}</td>
                            <td>{t.earNoise == null ? '—' : `${(t.earNoise * 100).toFixed(1)}%`}</td>
                          </>
                        ) : <td colSpan={6}>could not start: {t.error}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className={btn} style={{ background: '#1a1a2e' }} disabled={comparing != null} onClick={() => onContinue()}>
                My face is centred — continue →
              </button>
              <button className="rounded-xl border border-[#bdb8ae] bg-white px-8 py-3 font-sans text-base text-[#3a3a4a]" disabled={comparing != null}
                onClick={() => { camera.stop(); onSkip(); }}>
                Continue without camera
              </button>
            </div>
          </>
        )}

        {step === 'denied' && (
          <>
            <div data-testid="camera-start-error" className="mt-4 rounded-xl border border-[#f5a62366] bg-[#fff8ec] p-4 font-sans text-base leading-relaxed" style={{ color: UI_TEXT.amber }}>
              {errMsg}
              {showDetails && camera.startError && <span data-testid="camera-start-details">{` Details: ${camera.startError}`}</span>}
            </div>
            <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {onBack && <button type="button" className={btnBack} data-testid="back-to-consent" onClick={onBack}>← Back to consent</button>}
              <button className={btn} style={{ background: '#1a1a2e' }} onClick={() => { setErrMsg(''); setShowDetails(false); setStep('notice'); }}>Retry</button>
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
 * Changing it means going back to consent, and that route now exists: "Back to consent" re-presents
 * the whole consent screen with every option unticked, exactly as the first time, so the participant
 * decides again rather than being asked to reverse one answer. The superseded consent is kept on the
 * session record (consent_revisions).
 */
export function CameraDeclined({ onContinue, onBack }: { onContinue: () => void; onBack?: () => void }) {
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
        <div className="mt-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {onBack && <button type="button" className={btnBack} data-testid="back-to-consent" onClick={onBack}>← Back to consent</button>}
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
    <div data-testid="adaptation" style={{ position: 'fixed', inset: 0, background: CONFIG.ADAPTATION_COLOR, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: CONFIG.ADAPTATION_INK }}>
      {!canContinue ? (
        <svg width={88} height={88} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={44} cy={44} r={r} fill="none" stroke="#00000030" strokeWidth={6} />
          <circle cx={44} cy={44} r={r} fill="none" stroke={CONFIG.ADAPTATION_INK} strokeWidth={6}
            strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)} style={{ transition: 'stroke-dashoffset 0.1s linear' }} />
        </svg>
      ) : (
        /* An outline, not the loop's shared filled button (tasks/loopChrome.tsx): this field is the
           adaptation stimulus, and a filled black button would lower its mean luminance. */
        <button type="button" data-testid="adaptation-continue" onClick={() => finish('participant')}
          style={{ fontFamily: '"DM Mono", monospace', fontSize: 20, padding: '14px 34px', borderRadius: 14, border: `2px solid ${CONFIG.ADAPTATION_INK}`, background: 'transparent', color: CONFIG.ADAPTATION_INK, cursor: 'pointer' }}>
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
    /* Centred with margin:auto rather than align-items:center: in a scroll container the latter
       pushes an overflowing top edge out of reach, where no scroll can bring it back. */
    <div className={shell} style={{ display: 'flex' }}>
      <div style={{ width: '100%', margin: 'auto', maxWidth: 800 }}>
        <p className={eyebrow}>Before you begin</p>
        <h1 className="mt-2 font-serif text-4xl font-light">What you’ll be doing</h1>
        <p className="mt-4 font-sans text-[17px] leading-relaxed text-[#3a3a4a]" data-testid="instructions-count">
          In this sitting you’ll see <strong>{conditions} different screen displays</strong> (different
          background and text colours). For <strong>each</strong> display you’ll complete the same short
          tasks in the same order:
        </p>
        {/* The steps are TASK_STEPS (experiment/taskSteps.tsx), the same list every task screen's
            eyebrow is numbered from — they said "Task N of 4" against these five. */}
        <ol data-testid="instructions-steps" className="mt-4 font-sans text-[17px] leading-relaxed text-[#3a3a4a]" style={{ paddingLeft: 18, listStyle: 'decimal' }}>
          {TASK_STEPS.map((step) => (
            <li key={step.name}>{step.overview({ pages, questions: QUESTIONS_PER_PASSAGE })}</li>
          ))}
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
    <div className={shell} style={{ display: 'flex' }}>
      {/* Centred, and in reading order: the participant's message first, then — set apart — what
          the researcher does next. The end-of-session lux panel used to sit between the heading and
          the thank-you, on a left-aligned column with the right half of the screen empty. Centred by
          margin:auto so a tall lux panel scrolls instead of losing its top edge. */}
      <div style={{ width: '100%', maxWidth: 720, margin: 'auto' }}>
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
          17 px with generous leading. It used to scroll inside its own 360 px box, inside a screen
          that itself scrolls: the box overflowed by 9 px, and a drag on the words moved the wrong
          one of the two. The page is the only scroller now, with the "More below" cue. The
          decorative wave lines that used to run behind it are gone: they crossed the words. */}
      <div style={{ width: '100%', margin: '0 auto', maxWidth: 880 }}>
        <h1 className="font-serif text-4xl font-light">Informed consent</h1>
        <div data-testid="consent-text" className="mt-4 font-sans text-[#2a2a3a]"
          style={{ fontSize: 17, lineHeight: 1.6, padding: '16px 20px', borderRadius: 12, border: '1px solid #e5e2dc', background: '#fff' }}>
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
            *
            * The duration is the one string every screen uses (CONFIG.SINGLE_SITTING_DURATION), and
            * it is THIS text's figure, "75–120 minutes", verbatim: the landing page and the session
            * form said "about 90 min to 2 h", and where two figures disagree the approved consent
            * wording is the one that stands. The words the participant reads are unchanged.
          */}
          <p>You are invited to take part in a study on visual ergonomics — how display polarity
            and text colour affect reading, attention and eye comfort. The session takes roughly
            {' '}{CONFIG.SINGLE_SITTING_DURATION} and involves reading passages, short attention tasks and brief
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

        {/* Read BEFORE the choice is confirmed, not after: it used to sit under the button. */}
        <p className={help} style={{ marginTop: 18 }}>
          Unticked boxes are recorded as a refusal, not left blank.
        </p>
        <button className={btn} disabled={!agreed}
          style={{ marginTop: 12, ...btnState(agreed) }}
          onClick={() => agreed && onConsent({
            camera_metrics: cameraMetrics,
            setup_photos: setupPhotos,
            annotation_video: askAnnotationVideo && annotationVideo,
            granted_at: Date.now(),
          })}>
          I consent — continue →
        </button>
      </div>
      <ScrollCue gutter />
    </div>
  );
}

// ---- PRE-FLIGHT CHECKLIST (researcher) ----
/** The scale applied, the one this window supports measured fresh, and the full screen's. */
function readScale() {
  return { applied: currentScale(), fresh: freshScale(), full: screenFitScale() };
}

const PREFLIGHT_ITEMS = [
  'Screen brightness set to a fixed level; auto-brightness OFF',
  'Blue-light filter / Night Shift OFF',
  'Screen cleaned (no smudges or glare)',
  'Ambient illumination measured and lux entered',
  'Participant not wearing tinted/photochromic lenses',
  'No strong light source behind the participant (no backlight)',
  'Device on a stand at ~50–60 cm viewing distance, landscape',
];
/** What the pre-flight screen measured and the operator acknowledged, stored on the session. */
export interface PreflightResult {
  /** Whether the stimulus typeface loaded; null where the browser gave no answer. */
  fontOk: boolean | null;
  /** The CSS display mode the app was running in; null where the browser gave no answer. */
  displayMode: DisplayMode | null;
  /**
   * True when the app was NOT the installed full-screen launch and the operator ticked the warning to
   * run anyway. False when no acknowledgement was needed.
   */
  displayModeAcknowledged: boolean;
  /** The ruler check and the viewing distance (ScreenCalibration). */
  screen: ScreenCalibrationResult;
}

export function Preflight({ onDone, onBack }: {
  onDone: (result: PreflightResult) => void;
  /** Back to the profile to correct an answer. Offered when this sitting's own profile can be replaced. */
  onBack?: () => void;
}) {
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
  const [scale, setScale] = useState(readScale);
  useEffect(() => {
    const check = () => {
      setClipped(isBelowMinimum());
      setScale(readScale());
    };
    check();
    const late = window.setTimeout(check, 400);
    window.addEventListener('resize', check);
    return () => { window.clearTimeout(late); window.removeEventListener('resize', check); };
  }, []);
  const scaleLocked = scale.applied < scale.fresh - 0.02;
  const refit = () => {
    refitScale();
    window.setTimeout(() => setScale(readScale()), 100);
  };
  /*
   * How much of the full screen the canvas gets. Before Round 74 this was `applied >= 1`, against a
   * 1152x720 viewport nobody had measured on the tablet: on a screen with more CSS pixels than that
   * the box said "full size (100%)" while the canvas sat in the middle with a quarter of the width
   * blank either side. Now the yardstick is this screen's own full-screen fit (screenFitScale).
   */
  const fill = screenFill(scale.applied, scale.full);

  /*
   * Is this the installed app, full-screen? The canvas is fitted to the viewport, and the installed
   * app's viewport is the whole screen, so that is the one launch at which every stimulus is drawn at
   * its protocol size. In a browser tab the address bar takes part of the height and every stimulus
   * shrinks with the canvas — and the bar can hide and reappear, so two sittings run in tabs need not
   * even match each other. Nothing on the screen shows it; an operator in a hurry would never notice. So it is
   * checked by machine, like storage and the typeface, and anything other than the installed launch
   * has to be acknowledged in writing before the sitting can go on — the choice is the operator's,
   * but it is made knowingly and recorded (display_mode, display_mode_acknowledged). The same check
   * is asked again when a sitting is resumed and at a break (LaunchCheck, below; Experiment.tsx).
   */
  const mode = useDisplayMode();
  const installed = isInstalledDisplay(mode);
  const [modeAck, setModeAck] = useState(false);
  const updateWaiting = useUpdateWaiting();
  const [cal, setCal] = useState<ScreenCalibrationResult>({ ok: false, calibration: null, skipped: false, viewingDistanceCm: null });
  const modeOk = installed || modeAck;
  const fullSize = fill === 1;

  const storageBlocks = storage?.verdict === 'blocked';
  const all = checked.every(Boolean) && !!storage && !storageBlocks && fontOk !== undefined && modeOk && cal.ok;
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
      {/*
        A NEWER BUILD IS WAITING — at the top, where it cannot be missed. It used to sit inside the
        device box, half-way down the left column and below the fold at 1152 x 720, so an operator who
        had not looked at the landing page could run a whole sitting without seeing it (Round 74). It
        offers no Update button, and cannot: applying an update reloads the app in every window, and
        this sitting is open (UpdateBanner's gate). It says so, and says which build the sitting runs on.
      */}
      {updateWaiting && (
        <div data-testid="preflight-update-waiting" role="status"
          style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12, background: '#1a1a2e', color: '#fff' }}>
          <p className="font-sans text-base" style={{ fontWeight: 600 }}>A newer build of VisuLab is installed and waiting</p>
          <p className="font-sans text-[15px] leading-relaxed" style={{ marginTop: 4, color: '#dcdcea' }}>
            It cannot be applied while a sitting is open — this one included — because applying it reloads
            the app in every window. This sitting runs, and is recorded, on the build named in the
            device box below. Apply the update from the landing page (<strong>Update now</strong>) once
            the sitting is finished, before the next participant.
          </p>
        </div>
      )}

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
      <DisplayModeCheck mode={mode} fill={fill} acknowledged={modeAck} onAcknowledge={setModeAck} />

      <div data-testid="scale-check"
        style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${scaleLocked ? '#b3261e' : fullSize ? '#d8d4cc' : tone.warn}`, background: scaleLocked ? '#fdeeee' : fullSize ? '#fff' : `${tone.warn}12` }}>
        {/*
          This used to print "76% of design size — correct for this screen" on the study tablet in a
          browser tab: correct only in the sense that the arithmetic fitted the screen. Then, after
          Round 63, "full size (100%)" whenever the scale reached 1 — which on a screen with more CSS
          pixels than the 1152 x 720 canvas meant the canvas in the middle of the screen. Now it is
          measured against this screen's own full-screen fit, and the scale itself is shown.
        */}
        <p className={boxText} style={{ color: scaleLocked ? '#8a1c14' : '#3a3a4a' }}>
          <strong>Display size:</strong>{' '}
          {fullSize
            ? `fills the screen — the ${DESIGN_WIDTH} × ${DESIGN_HEIGHT} layout is drawn at ×${scale.applied.toFixed(2)}, as the installed app draws it.`
            : fill == null
              ? `the ${DESIGN_WIDTH} × ${DESIGN_HEIGHT} layout is drawn at ×${scale.applied.toFixed(2)}; this browser does not report the screen size, so whether that fills the screen cannot be said.`
              : `${Math.round(fill * 100)}% of full-screen size (×${scale.applied.toFixed(2)} where the full screen would give ×${(scale.full ?? 0).toFixed(2)})`}
          {!fullSize && fill != null && (scaleLocked
            ? ` — this window supports ×${scale.fresh.toFixed(2)}.`
            : ' — every stimulus, the reading text included, is drawn that much smaller than in the installed app. '
              + (installed
                ? 'The app is not getting the whole screen: a split-screen or floating window.'
                : mode
                  ? 'The browser\'s address bar is taking part of the screen; see above.'
                  // Not "the address bar": with no mode reported, the cause is not known.
                  : 'The display mode is not reported (see above), so the cause is not known.'))}
          {' '}
          <InfoTip label="display size">
            Every screen is laid out on a {DESIGN_WIDTH} × {DESIGN_HEIGHT} canvas (the tablet&apos;s
            16:10 shape) and fitted to the screen, enlarged or shrunk, so it fills it. ×1.00 means drawn
            at the browser&apos;s own pixel size; the number differs between devices and display-size
            settings, and it is saved with every condition. What matters for the study is the PHYSICAL
            size, which the ruler measurement on this screen gives. Launched from the home-screen icon
            the layout fills the screen; in a browser tab the address bar makes it smaller. If it is
            lower than this screen supports, tap Re-fit.
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
      {/*
        THIS DEVICE (Round 74). Every layout from Round 63 to Round 73 was measured against a viewport
        assumed for the tablet and never read off it. The numbers the browser reports are shown here so
        the investigator can read them back, and the build is named, so a sitting's data can be matched
        to the code that collected it.
      */}
      <DeviceBox mmPerCssPx={cal.calibration?.mmPerCssPx ?? null}>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e2dc' }}>
          <BuildInfo testId="preflight-build" />
        </div>
      </DeviceBox>
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
      {/*
        Full width, below the two columns: the bar is 500 design px, wider than either column, and a
        bar whose end is hidden would be measured short.
      */}
      <ScreenCalibration scale={scale.applied} screen={typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : null} onChange={setCal} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
        {onBack && <button type="button" className={btnBack} data-testid="back-to-profile" onClick={onBack}>← Back to the profile</button>}
        <button className={btn} disabled={!all} data-testid="preflight-continue"
          style={btnState(all)}
          onClick={() => all && onDone({ fontOk: fontOk ?? null, displayMode: mode, displayModeAcknowledged: !installed && modeAck, screen: cal })}>
          {storageBlocks ? 'Storage problem — cannot start' : 'All checks pass — continue →'}
        </button>
      </div>
      </div>
      <ScrollCue />
    </div>
  );
}

/**
 * The CSS display mode, kept live: Chrome can move a page into or out of full-screen under it, so it
 * is re-read whenever the browser reports a change rather than once on mount.
 */
export function useDisplayMode(): DisplayMode | null {
  const [mode, setMode] = useState<DisplayMode | null>(() => displayMode());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const queries = (['fullscreen', 'standalone', 'minimal-ui', 'browser'] as const)
      .map((m) => window.matchMedia(`(display-mode: ${m})`));
    const update = () => setMode(displayMode());
    for (const q of queries) q.addEventListener?.('change', update);
    return () => { for (const q of queries) q.removeEventListener?.('change', update); };
  }, []);
  return mode;
}

/**
 * Is this the installed app? The verdict, and — when it is not — the acknowledgement that lets the
 * sitting go on anyway. One component, so pre-flight, the resume check and the break say the same
 * thing and record the same tick.
 *
 * WHAT IT MAY CLAIM. It used to say, whenever the mode was not fullscreen or standalone, that "every
 * stimulus is drawn smaller than the protocol size" — directly above the scale box saying "full size
 * (100%) — every stimulus is drawn at its protocol size", in a tab whose address bar happened to be
 * hidden (review of Round 63). The size sentence now follows the size actually applied — since Round 74
 * as a fraction of this screen's full-screen size (viewportScale.screenFill), because the scale alone
 * says nothing once the canvas is fitted up as well as down. And where the browser reports no mode at
 * all it no longer says "the app is open in a browser tab": the code does not know that, only that the
 * installed launch cannot be confirmed. The acknowledgement is required in every case that is not
 * confirmed installed — at full size too, because the bar can come back — and says "may not be at
 * their protocol size", which is true in all of them.
 */
export function DisplayModeCheck({ mode, fill, acknowledged, onAcknowledge }: {
  mode: DisplayMode | null;
  /**
   * The applied scale as a fraction of the full screen's (viewportScale.screenFill): 1 when the canvas
   * fills the screen, null where the browser does not report the screen.
   */
  fill: number | null;
  acknowledged: boolean;
  onAcknowledge: (ticked: boolean) => void;
}) {
  const installed = isInstalledDisplay(mode);
  const warn = '#c98a22';
  const boxText = 'font-sans text-[15px] leading-relaxed text-[#3a3a4a]';
  const smaller = fill != null && fill < 1;
  const pct = fill == null ? null : Math.round(fill * 100);
  return (
    <div data-testid="display-mode-check"
      style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${installed ? '#d8d4cc' : warn}`, background: installed ? '#fff' : `${warn}12` }}>
      {installed ? (
        <p className={boxText}>
          <strong>App display:</strong> installed, full-screen — correct.
        </p>
      ) : (
        <>
          <p className={eyebrow} style={{ color: UI_TEXT.amber }}>
            {mode ? `Not running as the installed app (display mode: ${mode})` : 'Display mode not reported'}
          </p>
          <p className={boxText} style={{ marginTop: 6 }} data-testid="display-mode-text">
            {mode
              ? 'The app is open in a browser tab or window, not from its home-screen icon. '
              : 'The browser did not say how the app is being displayed, so it cannot be confirmed that '
                + 'it was opened from its home-screen icon. '}
            {fill == null
              ? 'The browser does not report the screen size, so whether every stimulus is drawn at its full-screen size cannot be said. '
              : mode
                ? (smaller
                  ? `The address bar takes part of the screen, so every stimulus is drawn smaller than in the installed app (${pct}% of full-screen size), and the size can change if the bar hides or reappears. `
                  : 'Every stimulus is at its full-screen size on this screen at the moment, but the address bar can appear at any time, and every stimulus is then drawn smaller. ')
                : (smaller
                  ? `Every stimulus is drawn at ${pct}% of its full-screen size on this screen. `
                  : 'Every stimulus is at its full-screen size on this screen at the moment. ')}
            {mode ? 'To fix it: tap ' : 'If it was not opened from the icon: tap '}
            <strong>Exit — resume later</strong>, close this {mode ? 'tab' : 'tab or window'}, open
            VisuLab from the home-screen icon and resume this sitting from the Session Manager.
          </p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" data-testid="display-mode-ack" checked={acknowledged}
              onChange={(e) => onAcknowledge(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2 }} />
            <span className="font-sans text-base text-[#1a1a2e]">
              Run it like this anyway. I understand the stimuli may not be at their protocol size, and
              that this sitting is recorded as {mode ? 'run outside the installed app' : 'not confirmed to be the installed app'}.
            </span>
          </label>
        </>
      )}
    </div>
  );
}

/**
 * The applied scale as a fraction of the full screen's (screenFill), re-read when the viewport changes
 * (the scale settles a frame later).
 */
export function useScreenFill(): number | null {
  const [fill, setFill] = useState(() => screenFill());
  useEffect(() => {
    const check = () => setFill(screenFill());
    const late = window.setTimeout(check, 400);
    const onResize = () => { window.setTimeout(check, 100); };
    window.addEventListener('resize', onResize);
    return () => { window.clearTimeout(late); window.removeEventListener('resize', onResize); };
  }, []);
  return fill;
}

/**
 * A resumed sitting's launch check (stage LAUNCH_CHECK): the first screen of a resume that is not in
 * the installed app, before camera set-up or anything else (stateMachine.resumeOwesLaunchCheck).
 *
 * The same DisplayModeCheck pre-flight shows, and the same tick, because the question is the same one:
 * the launch belongs to this run of the app, and a resume is a new run. The way out is the operator
 * chip, "Exit — resume later", which leaves the sitting exactly as it was. `onContinue` is given the
 * mode that was acknowledged, so it can be recorded against the conditions that follow.
 */
export function LaunchCheck({ onContinue }: { onContinue: (acknowledged: DisplayMode | null) => void }) {
  const mode = useDisplayMode();
  const fill = useScreenFill();
  const [ack, setAck] = useState(false);
  // The mode can change under the screen; if it becomes the installed launch there is nothing to tick.
  const ok = isInstalledDisplay(mode) || ack;
  return (
    <div className={shell} data-testid="launch-check">
      <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
        <h1 className="font-serif text-4xl font-light">Before this sitting continues</h1>
        <p className={`mt-3 ${body}`}>
          Researcher: the sitting is being resumed, so the way the app was opened is checked again.
          Pre-flight checked it for the launch the sitting started in; a resume is a new launch, and the
          displays still to come are drawn at the size this one allows.
        </p>
        <DisplayModeCheck mode={mode} fill={fill} acknowledged={ack} onAcknowledge={setAck} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
          <button type="button" className={btn} disabled={!ok} data-testid="launch-check-continue"
            style={btnState(ok)}
            onClick={() => ok && onContinue(mode)}>
            Continue the sitting →
          </button>
        </div>
      </div>
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
