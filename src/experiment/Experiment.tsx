/**
 * Experiment orchestrator. Owns the stage machine, the session/participant/plan, the tracking
 * lifecycle, and all IndexedDB writes. Renders the component for the current stage and advances on
 * completion. EXPORT_DASHBOARD renders the full researcher dashboard + CSV/JSON export.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CONDITIONS, conditionDefinitionHash, N_CONDITIONS } from './conditions';
import {
  illuminationForBlock, illuminationOrderFor, luxInRange, summariseLux,
  N_ILLUMINATION_BLOCKS,
} from '@/experiment/illumination';
import { PASSAGES } from './passages';
import { blockPlan, isAnnotationSubsample, type PlannedStep } from './counterbalance';
import { CONFIG, isE2ETimingActive } from './config';
import { initialState, nextState, progressPercent, firstUnsatisfiedSetupStage, type MachineState } from './stateMachine';
import { APP_VERSION, GIT_HASH, BUILD_TIME } from '@/lib/env';
import { put, get, getAllByIndex, nextEnrolmentNumber, peekNextEnrolmentNumber, clearConditionRows, clearSessionStageRows } from '@/storage/db';
import {
  noMediaConsent, mayCapture, capturePhoto, recordSegment, checksumOfBlob,
} from '@/storage/media';
import { priorParticipantProgress } from '@/storage/gather';
import { saveResume, clearResume } from '@/storage/sessionPersistence';
import { isInLoop } from './stateMachine';
import { BreakScreen } from '@/start/BreakScreen';
import { DB_VERSION } from '@/storage/schemaEnums';
import type { Provenance, SessionRecord } from '@/storage/types';
import { useTracking } from '@/tracking/useTracking';
import { LazyDashboard as Dashboard } from '@/dashboard/LazyDashboard';
import { ExperimentProgress } from '@/components/ExperimentProgress';
import { FatigueScale } from '@/scales/FatigueScale';
import { DisplayPerceptionRating } from '@/scales/DisplayPerceptionRating';
import { ReadingTask } from '@/tasks/ReadingTask';
import { ComprehensionTask } from '@/tasks/ComprehensionTask';
import { VisualSearchTask } from '@/tasks/VisualSearchTask';
import { ReactionTimeTask } from '@/tasks/ReactionTimeTask';
import { IshiharaTest } from '@/screening/IshiharaTest';
import { Cvsq } from '@/scales/Cvsq';
import { NasaTlx } from '@/scales/NasaTlx';
import { LuxCheckpointPanel } from '@/start/LuxCheckpoint';
import {
  SessionInit, ParticipantProfile, CameraSetup, CameraDeclined, Calibration, AdaptationScreen, SessionComplete,
  Consent, Preflight, Instructions, type SessionInitData, type ProfileData,
} from '@/start/setupStages';
import { CalibrationRoutine } from '@/start/CalibrationRoutine';

function provenance(): Provenance {
  return {
    app_version: APP_VERSION, git_hash: GIT_HASH, build_time: BUILD_TIME,
    condition_def_hash: conditionDefinitionHash(), schema_version: DB_VERSION,
  };
}

interface ExperimentProps {
  /** When set, rehydrate and resume an in-progress session at the given condition index. */
  resume?: { sessionId: string; nextStepIndex: number; reachedLoop?: boolean };
  /** Return to the session manager (pause/exit or after completion). */
  onExit: () => void;
}

export default function Experiment({ resume, onExit }: ExperimentProps) {
  const tracking = useTracking();
  const [machine, setMachine] = useState<MachineState>(initialState());
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [enrolment, setEnrolment] = useState(0);
  const [plan, setPlan] = useState<PlannedStep[]>([]);
  const [baselineFatigue, setBaselineFatigue] = useState<number | null>(null);
  const [resuming, setResuming] = useState<boolean>(!!resume);
  const conditionIds = useRef<string[]>([]);
  const writtenConditions = useRef<Set<number>>(new Set());
  const conditionStarted = useRef<Record<number, number>>({});
  const creatingSession = useRef(false);
  // Conditions run in THIS sitting (8 single, 4 split). Drives the loop length + break insertion.
  const nConditionsRef = useRef<number>(N_CONDITIONS);
  // Transition lock: ignore re-entrant advance() calls (e.g. accidental double-taps on a tablet)
  // until the machine actually changes — prevents skipping a stage. Reset on every stage change.
  const transitioning = useRef(false);

  const advance = useCallback(() => {
    if (transitioning.current) return;
    transitioning.current = true;
    setMachine((m) => nextState(m, nConditionsRef.current));
  }, []);

  /**
   * Where the loop should re-enter after a resumed session has re-run camera setup and calibration.
   *
   * A resume cannot simply advance() out of CALIBRATION: the setup sequence continues into the
   * baseline CVS-Q and baseline fatigue, which would re-administer the two instruments the change
   * scores are measured FROM, and then start the condition loop at zero. This ref is the landing
   * point, set by the resume effect and consumed once.
   */
  const resumeJumpTo = useRef<number | null>(null);

  /**
   * Milliseconds of grey-field adaptation actually delivered before the NEXT condition. Written by
   * the ADAPTATION screen, consumed by ensureCondition. Zero on a cold entry — the first condition
   * of a sitting, or one reached through the resume path, which shows no adaptation screen.
   */
  const adaptationDelivered = useRef(0);

  /** advance(), unless a resume is waiting to re-enter the loop at a specific condition. */
  const advanceOrResume = useCallback(() => {
    const target = resumeJumpTo.current;
    if (target == null) { advance(); return; }
    resumeJumpTo.current = null;
    transitioning.current = true;
    setMachine({ stage: 'READING_TASK', stepIndex: target });
  }, [advance]);

  useEffect(() => {
    transitioning.current = false;
  }, [machine]);

  // --- RESUME: rehydrate an interrupted session at the next condition ---
  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    (async () => {
      const s = await get('sessions', resume.sessionId);
      const baseline = (await getAllByIndex('fatigue_scores', 'by_session', resume.sessionId)).find(
        (f) => f.stage === 'baseline',
      );
      if (cancelled || !s) {
        setResuming(false);
        return;
      }
      // Rebuild THIS sitting's slice of the full counterbalanced plan (offset/cps default to a
      // single full session for legacy records written before split-session support).
      const offset = s.condition_offset ?? 0;
      const cps = s.conditions_per_session ?? (s.condition_order?.length || N_CONDITIONS);
      // Resume must rebuild from the SAME illumination block the session was created under,
      // otherwise a resumed second-block session would replay the first block's condition order.
      const sittingPlan = blockPlan(s.enrolment_number, s.illumination_block ?? 0).slice(offset, offset + cps);
      nConditionsRef.current = sittingPlan.length;
      // Reuse the stored condition_id for any slot already written (keyed by global session_position),
      // and mint fresh ids only for not-yet-started slots. This makes a redo of the interrupted
      // condition OVERWRITE its existing row rather than create a duplicate, orphaned row.
      const existing = await getAllByIndex('conditions', 'by_session', s.session_id);
      const idByPosition = new Map(existing.map((c) => [c.session_position, c.condition_id]));
      conditionIds.current = sittingPlan.map((st) => idByPosition.get(st.position) ?? uuidv4());
      writtenConditions.current = new Set();
      setSession(s);
      setEnrolment(s.enrolment_number);
      setPlan(sittingPlan);
      setBaselineFatigue(baseline ? baseline.fatigue_mean : null);
      const idx = resume.nextStepIndex;

      /**
       * Re-enter the SETUP chain at the first stage whose product is missing, and only then the
       * condition loop.
       *
       * This used to jump straight to READING_TASK, which was safe only while a resume pointer
       * existed exclusively for sessions that had already reached the loop. Once every in-progress
       * session became resumable — which it had to be, so a second participant could not strand the
       * first — a session interrupted during setup was offered as "Resume (next condition 1/10)"
       * and dropped the participant into the reading task with no consent record, no participant
       * row, no screening, no calibration and neither baseline instrument. Ten conditions later it
       * exported with session_complete=TRUE and the codebook's own filter admitted it.
       *
       * Camera setup and calibration are re-run on every resume even when they were completed:
       * App.tsx remounts Experiment, so useTracking() comes back at status 'unavailable' with the
       * EAR and gaze baselines — which live in refs — cleared. Those thresholds are fractions of
       * this participant's own open-eye baseline, so they cannot be inherited.
       */
      const participantRow = await get('participants', s.participant_id);
      const cvsqRows = await getAllByIndex('cvsq_scores', 'by_session', s.session_id);
      const wantsCamera = s.media_consent?.camera_metrics === true;
      const owed = firstUnsatisfiedSetupStage({
        consentGiven: s.consent_given === true,
        hasParticipantRecord: !!participantRow,
        preflightComplete: s.preflight_complete === true,
        colourVisionScreened: participantRow?.ishihara_total != null,
        hasBaselineCvsq: cvsqRows.some((c) => c.stage === 'baseline'),
        hasBaselineFatigue: !!baseline,
        wantsCamera,
      });

      // Where the loop should pick up once setup is satisfied. reachedLoop distinguishes a genuine
      // condition pointer from the default 0 given to a session that never got that far.
      const loopTarget = resume.reachedLoop ? idx : 0;

      if (idx >= sittingPlan.length && resume.reachedLoop) {
        // Every condition ran; only the closing instruments remain.
        resumeJumpTo.current = null;
        setMachine({ stage: 'CVSQ_END', stepIndex: sittingPlan.length - 1 });
      } else if (owed) {
        resumeJumpTo.current = loopTarget;
        setMachine({ stage: owed, stepIndex: loopTarget });
      } else {
        resumeJumpTo.current = null;
        setMachine({ stage: 'READING_TASK', stepIndex: loopTarget });
      }
      setResuming(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [resume]);

  const step = plan[machine.stepIndex];
  const cond = step ? CONDITIONS[step.conditionIndex] : null;
  const passage = step ? PASSAGES[step.passageIndex] : null;
  const conditionId = conditionIds.current[machine.stepIndex];

  /**
   * Resolve the counterbalanced illumination assignment for a participant id. Runs as soon as the
   * researcher has typed a valid id, so the room can be set BEFORE the lux reading is taken — the
   * level is derived from the enrolment number, never chosen.
   */
  const resolveAssignment = useCallback(async (participantId: string) => {
    const prior = await priorParticipantProgress(participantId);
    const enrol = prior.enrolment ?? (await peekNextEnrolmentNumber());
    const block = Math.min(
      Math.floor(prior.conditionsCompleted / N_CONDITIONS),
      N_ILLUMINATION_BLOCKS - 1,
    );
    return {
      level: illuminationForBlock(enrol, block),
      block,
      orderFirst: illuminationOrderFor(enrol)[0],
      enrolment: enrol,
      conditionsCompleted: prior.conditionsCompleted,
    };
  }, []);

  /**
   * Append a researcher-measured illuminance reading to the session record.
   *
   * Three readings are taken per session — start (at session init), middle (at the mid-session
   * break) and end (at completion). Recording all three means drift across a 60-120 minute
   * sitting is reportable rather than assumed away, which matters because the literature
   * disagreement over whether illumination interacts with polarity points to a threshold-like
   * relationship: the exact illuminance is the thing under test.
   *
   * The value must come from the calibrated lux meter at the participant's eye position. The
   * camera's frame luminance is NOT used as a substitute: auto-exposure makes it a poor proxy for
   * absolute illuminance, and a derived number here would look like a measurement without being one.
   */
  const logLuxCheckpoint = useCallback(async (checkpoint: 'middle' | 'end', lux: number) => {
    if (!session || !Number.isFinite(lux)) return;
    const fresh = await get('sessions', session.session_id);
    if (!fresh) return;
    // Never duplicate a checkpoint — a resumed session may revisit the same screen.
    const readings = [
      ...(fresh.lux_readings ?? []).filter((r) => r.checkpoint !== checkpoint),
      { checkpoint, lux, at: Date.now() },
    ];
    const updated = {
      ...fresh,
      lux_readings: readings,
      lux_all_in_range: summariseLux(fresh.ambient_illumination_level, readings).all_in_range,
    };
    await put('sessions', updated);
    setSession(updated);
  }, [session]);

  /**
   * Capture one consented media item.
   *
   * Consent is re-read from the PERSISTED session record rather than trusted from component state,
   * so a capture cannot slip through after a grant was withdrawn. A refusal is a silent no-op: the
   * participant is not told a capture was skipped, because that would pressure them about a choice
   * they already made.
   */
  const captureMedia = useCallback(async (
    checkpoint: 'session_start' | 'session_end' | 'reading_segment',
    conditionLabel: string | null = null,
  ) => {
    if (!session) return;
    const fresh = await get('sessions', session.session_id);
    if (!mayCapture(fresh?.media_consent, checkpoint)) return;
    const src = tracking.mediaSource();
    if (!src) return;
    try {
      let blob: Blob;
      let width: number | null = null;
      let height: number | null = null;
      let duration: number | null = null;
      let mime: string;
      if (checkpoint === 'reading_segment') {
        const seg = await recordSegment(src.stream, CONFIG.ANNOTATION_SEGMENT_MS);
        if (!seg) return;
        blob = seg.blob; mime = seg.mime; duration = seg.duration_ms;
      } else {
        const shot = await capturePhoto(src.video);
        if (!shot) return;   // no frame yet — never store a black placeholder as "proof"
        blob = shot.blob; mime = 'image/jpeg'; width = shot.width; height = shot.height;
      }
      await put('media_captures', {
        media_id: uuidv4(),
        session_id: session.session_id,
        participant_id: session.participant_id,
        kind: checkpoint === 'reading_segment' ? 'video' : 'photo',
        checkpoint,
        condition_label: conditionLabel,
        captured_at: Date.now(),
        mime,
        bytes: blob.size,
        width,
        height,
        duration_ms: duration,
        checksum_fnv1a: await checksumOfBlob(blob),
        consent_snapshot: fresh!.media_consent,
        blob,
      });
    } catch {
      // A failed capture must never abort the session: the numeric data is the study.
    }
  }, [session, tracking]);

  // --- SESSION INIT ---
  const beginSession = useCallback(async (d: SessionInitData) => {
    if (creatingSession.current) return; // guard against double-submit creating duplicate sessions
    creatingSession.current = true;
    // Split-session continuity: reuse this participant's prior enrolment number (so the Williams
    // condition order is identical across sittings) and resume at the global serial position where
    // their last sitting stopped. A brand-new participant gets a fresh sequential enrolment number.
    const prior = await priorParticipantProgress(d.participantId);
    const enrol = prior.enrolment ?? await nextEnrolmentNumber();
    // Which illumination block is this participant on, and how far into it? Each block is a full
    // pass through the ten conditions, so completed / 10 gives the block and completed % 10 the
    // offset within it. A block may itself be run as one sitting of ten or two sittings of five.
    const block = Math.min(Math.floor(prior.conditionsCompleted / N_CONDITIONS), N_ILLUMINATION_BLOCKS - 1);
    const offset = prior.conditionsCompleted % N_CONDITIONS;
    const level = illuminationForBlock(enrol, block);
    const fullPlan = blockPlan(enrol, block);
    const cps = Math.min(d.conditionsPerSession, N_CONDITIONS - offset);
    const sittingPlan = fullPlan.slice(offset, offset + cps);
    nConditionsRef.current = sittingPlan.length;
    conditionIds.current = sittingPlan.map(() => uuidv4());
    writtenConditions.current = new Set();
    const sid = uuidv4();
    const rec: SessionRecord = {
      session_id: sid,
      participant_id: d.participantId,
      enrolment_number: enrol,
      status: 'in_progress',
      deleted_at: null,
      display_label: null,
      ambient_lux: d.ambientLux,
      ambient_illumination_level: level,
      illumination_block: block,
      illumination_order_first: illuminationOrderFor(enrol)[0],
      lux_readings: [{ checkpoint: 'start', lux: d.ambientLux, at: Date.now() }],
      lux_all_in_range: luxInRange(level, d.ambientLux),
      lux_deviation_note: d.luxDeviationNote,
      screen_white_luminance_cd_m2: d.whiteLuminance,
      brightness_percent: d.brightnessPercent,
      session_start_time: Date.now(),
      session_end_time: null,
      randomisation_seed: enrol,
      condition_order: sittingPlan.map((s) => s.conditionIndex),
      preflight_complete: false,
      // Stamped at creation, so a session run on a bookmarked ?e2e URL can never be mistaken for
      // real data: every protocol duration in it was a token value.
      e2e_timing: isE2ETimingActive(),
      // Consent is captured at the CONSENT stage (below), not pre-emptively at session creation.
      consent_given: false,
      consent_time: null,
      media_consent: noMediaConsent(),
      provenance: provenance(),
      device_type: navigator.userAgent.includes('Android') ? 'Android' : 'Other',
      browser: navigator.userAgent.slice(0, 60),
      screen_resolution: `${screen.width}x${screen.height}`,
      conditions_per_session: sittingPlan.length,
      condition_offset: offset,
      session_index: prior.sittings + 1,
    };
    await put('sessions', rec);
    setSession(rec);
    setEnrolment(enrol);
    setPlan(sittingPlan);
    advance();
  }, [advance]);

  // --- PARTICIPANT PROFILE ---
  const saveProfile = useCallback(async (d: ProfileData) => {
    if (!session) return;
    /**
     * Eligibility encodes the PROTOCOL's criteria, not just a sanity check on age.
     *
     * It used to be `age >= 18 && age <= 80`, while the synopsis specifies 18 to 35 and lists
     * colour-vision deficiency and contact-lens wear on test days as exclusions — and the exported
     * codebook says so in the same repository ("The sample is delimited to 18 to 35"; "Contact-lens
     * wear on test days is an exclusion"; "Rows with false must be excluded from the confirmatory
     * analysis"). So a 52-year-old contact-lens wearer who failed the Ishihara screen was written
     * out as eligible=TRUE with an empty exclusion_reason, and an analyst following the codebook's
     * own instruction would keep them in the confirmatory analysis of a text-colour factor they
     * cannot perceive normally.
     *
     * Reasons accumulate rather than short-circuit: an excluded participant's record should say
     * everything that excluded them, not only the first thing checked. Colour vision is re-evaluated
     * after the Ishihara stage, which runs later — see the COLOR_VISION handler.
     */
    const reasons: string[] = [];
    if (d.age < CONFIG.MIN_AGE || d.age > CONFIG.MAX_AGE) {
      reasons.push(`age ${d.age} outside the ${CONFIG.MIN_AGE}–${CONFIG.MAX_AGE} inclusion range`);
    }
    if (d.correctionType === 'contacts') {
      reasons.push('contact-lens wear on a test day is an exclusion');
    }
    if (d.cvdSelfReport) {
      reasons.push('self-reported colour-vision deficiency');
    }
    const eligible = reasons.length === 0;

    /**
     * The participant record is created once and SHARED across a participant's two sittings, so
     * sitting 2 runs this stage against a row that already holds sitting 1's screening. Writing a
     * fresh object destroyed it: the Ishihara result reverted to null, a screen_failed colour-vision
     * status reverted to the self-report, and the measured baseline_fatigue reverted to 0 — for
     * BOTH sittings, because there is only one row. None of it was recoverable and nothing reported
     * it, because a row with ishihara_correct=null is exactly what a participant who was never
     * screened looks like.
     *
     * So: merge. Traits the profile stage actually asks about are taken from this sitting's answers
     * (a participant may have changed correction between sittings, and should be recorded as such).
     * Everything measured elsewhere is preserved unless this sitting has something better.
     */
    const prior = await get('participants', session.participant_id);

    await put('participants', {
      ...(prior ?? {}),
      participant_id: session.participant_id,
      // The enrolment number is fixed at first enrolment: it is the sole input to the Williams
      // condition order, so re-deriving it at sitting 2 would give the participant two orders.
      enrolment_number: prior?.enrolment_number ?? enrolment,
      age: d.age, gender: d.gender, daily_screen_hours: d.dailyScreenHours,
      device_familiarity: d.deviceFamiliarity, lighting_habit: d.lightingHabit,
      correction_type: d.correctionType,
      // A failed screening outranks a self-report and must not be undone by re-answering the
      // self-report question at sitting 2.
      cvd_status: prior?.cvd_status === 'screen_failed'
        ? 'screen_failed'
        : d.cvdSelfReport ? 'self_reported_deficient' : (prior?.cvd_status ?? 'normal'),
      ishihara_correct: prior?.ishihara_correct ?? null,
      ishihara_total: prior?.ishihara_total ?? null,
      // First-sitting values, kept for continuity; the per-sitting values go on the session below.
      caffeine_today: prior?.caffeine_today ?? d.caffeineToday,
      hours_since_sleep: prior?.hours_since_sleep ?? d.hoursSinceSleep,
      eligible,
      exclusion_reason: eligible ? null : reasons.join('; '),
      baseline_fatigue: prior?.baseline_fatigue ?? 0,
      // Points at the sitting that created the record, not the most recent one to touch it.
      session_id: prior?.session_id ?? session.session_id,
    });

    // Caffeine and sleep are STATE, not trait: they are asked at every sitting because they differ
    // between them. Recorded on the session so both sittings' values survive.
    const fresh = { ...session, caffeine_today: d.caffeineToday, hours_since_sleep: d.hoursSinceSleep };
    await put('sessions', fresh);
    setSession(fresh);

    advance();
  }, [session, enrolment, advance]);

  // --- condition record (lazy, on entering reading) ---
  const ensureCondition = useCallback(async () => {
    if (!session || !cond || !step) return;
    if (writtenConditions.current.has(machine.stepIndex)) return;
    writtenConditions.current.add(machine.stepIndex);
    /**
     * What the grey field ACTUALLY delivered, not what the plan intended.
     *
     * This used to be derived from the plan alone, so a condition entered through the resume path —
     * which shows no adaptation screen at all — recorded a full 60 s or 120 s of grey-field
     * adaptation that never happened. The column exists to verify the polarity-switch after-effect
     * control, and to covary it out; a value that describes the protocol rather than the run is
     * worse than no column, because it cannot be distinguished from a real one.
     *
     * adaptationDelivered is set by the ADAPTATION screen when it completes and consumed here. Zero
     * when this condition was entered cold: the first of a sitting, or a resume.
     */
    const adaptationBefore = adaptationDelivered.current;
    adaptationDelivered.current = 0;
    await put('conditions', {
      condition_id: conditionId, session_id: session.session_id,
      // Global serial position (offset + local index) so split sittings keep a 0..9 covariate.
      session_position: step.position, condition_label: cond.label,
      polarity: cond.polarity, background_color: cond.background, text_color: cond.text,
      color_name: cond.colorName, ink_name: cond.inkName, passage_id: step.passageIndex,
      wcag_contrast_ratio: cond.wcag_contrast_ratio, wcag_level: cond.wcag_level,
      michelson_contrast: cond.michelson_contrast, below_wcag_aa: cond.below_wcag_aa,
      started_at: Date.now(), completed_at: null, condition_duration_sec: null,
      adaptation_ms_before: adaptationBefore, reading_time_ms: null,
      // Block 0 is the participant's first exposure to every passage, block 1 the second.
      passage_repeat_number: (session.illumination_block ?? 0) + 1,
    });
    conditionStarted.current[machine.stepIndex] = Date.now();
    // Coarse resume pointer: an interruption during this condition resumes by redoing it.
    saveResume(session.session_id, machine.stepIndex);
    // NOTE: tracking.beginCondition() is deliberately NOT called here. See the ReadingTask
    // onBegin handler — the exposure window has to start when the participant starts reading.
    // Annotation video for the validation sub-study: one segment per session, taken during the
    // first condition's reading so it always lands inside a real exposure window. Fire-and-forget —
    // recording must never delay stimulus onset, and mayCapture() gates it on the video grant.
    if (machine.stepIndex === 0) void captureMedia('reading_segment', cond?.label ?? null);
  }, [session, cond, step, conditionId, machine.stepIndex, captureMedia]);

  // ===== RENDER =====
  const nConditions = plan.length || N_CONDITIONS;
  const percent = progressPercent(machine, nConditions);
  const showProgress = machine.stage !== 'SESSION_INIT' && machine.stage !== 'EXPORT_DASHBOARD';
  // Neutral "Condition X of N" + a rough time estimate (≈9 min/condition incl. rest), shown only
  // inside the per-condition loop and the break — never any performance information.
  const inLoopish = isInLoop(machine.stage) || machine.stage === 'BREAK_SCREEN';
  const conditionCurrent = inLoopish ? machine.stepIndex + 1 : undefined;
  const conditionTotal = inLoopish ? nConditions : undefined;
  const timeRemainingMin = inLoopish ? Math.max(0, Math.round((nConditions - machine.stepIndex) * 9)) : null;

  let view: React.ReactNode = null;
  switch (machine.stage) {
    case 'SESSION_INIT':
      view = <SessionInit resolveAssignment={resolveAssignment} onSubmit={beginSession} />;
      break;
    case 'CONSENT':
      /**
       * The annotation-video grant is offered only to the pre-specified validation subsample — and
       * it IS now offered. The prop defaults to false and no caller ever passed it, so the checkbox
       * was unreachable, media_consent.annotation_video was false for every session ever recorded,
       * and mayCapture() turned back every reading-segment capture. Objective 4 depends entirely on
       * that video: without it there is no material from which a human can code blinks frame by
       * frame, and so no criterion validity for the automated incomplete-blink classifier that
       * produces the primary outcome. The sub-study could not have collected a single segment.
       */
      view = <Consent askAnnotationVideo={isAnnotationSubsample(enrolment)} onConsent={async (media) => {
        if (session) {
          // Persist the media grants alongside the participation consent, in one write, so a
          // capture can never find consent_given=true with the grants still unset.
          const fresh = { ...session, consent_given: true, consent_time: Date.now(), media_consent: media };
          await put('sessions', fresh);
          setSession(fresh);
        }
        advance();
      }} />;
      break;
    case 'PARTICIPANT_PROFILE':
      view = <ParticipantProfile onSubmit={saveProfile} />;
      break;
    case 'COLOR_VISION':
      view = (
        <IshiharaTest
          onComplete={async (r) => {
            if (session) {
              const p = await get('participants', session.participant_id);
              if (p) {
                /**
                 * A failed screen has to reach `eligible`, and must not be undone at sitting 2.
                 *
                 * Two faults sat here. The handler wrote cvd_status and nothing else, so a
                 * participant who failed the plates was exported as eligible=TRUE with an empty
                 * exclusion_reason — while the codebook instructs the analyst to drop rows where
                 * eligible is false, and the protocol excludes colour-vision deficiency outright.
                 * The confirmatory analysis of the TEXT-COLOUR factor would then have included a
                 * participant who cannot perceive those colours normally. And because the
                 * participant record is shared across sittings and the plate set is identical and
                 * deterministically seeded, a pass at sitting 2 overwrote a sitting-1
                 * `screen_failed` with `normal`, erasing the exclusion entirely.
                 *
                 * A failure is therefore sticky, and it propagates into eligibility.
                 */
                const status = p.cvd_status === 'screen_failed'
                  ? 'screen_failed'
                  : r.status === 'screen_failed' ? 'screen_failed'
                    : r.status === 'normal' ? 'normal' : p.cvd_status;

                const failsColourVision = status === 'screen_failed' || status === 'self_reported_deficient';
                const priorReasons = (p.exclusion_reason ?? '')
                  .split(';').map((x) => x.trim()).filter(Boolean)
                  .filter((x) => !/colour-vision|colour vision/i.test(x));
                if (failsColourVision) {
                  priorReasons.push(status === 'screen_failed'
                    ? 'failed the colour-vision screening'
                    : 'self-reported colour-vision deficiency');
                }
                await put('participants', {
                  ...p,
                  ishihara_correct: r.testCorrect, ishihara_total: r.testTotal, cvd_status: status,
                  eligible: p.eligible && !failsColourVision,
                  exclusion_reason: priorReasons.length ? priorReasons.join('; ') : null,
                });
              }
            }
            advance();
          }}
        />
      );
      break;
    case 'PREFLIGHT':
      view = (
        <Preflight onDone={async (fontOk) => {
          if (session) {
            const fresh = { ...session, preflight_complete: true, stimulus_font_ok: fontOk };
            await put('sessions', fresh);
            setSession(fresh);
          }
          advance();
        }} />
      );
      break;
    case 'CVSQ_BASELINE':
      view = (
        <Cvsq stage="baseline" onComplete={async (r) => {
          if (session) await put('cvsq_scores', {
            cvsq_id: uuidv4(), session_id: session.session_id, stage: 'baseline',
            frequency: r.frequency, intensity: r.intensity, total_score: r.total, symptomatic: r.symptomatic,
            response_time_ms: r.responseTimeMs,
          });
          advance();
        }} />
      );
      break;
    case 'CVSQ_END':
      view = (
        <Cvsq stage="session_end" onComplete={async (r) => {
          if (session) {
            // Replace any prior attempt. A crash between here and the NASA-TLX leaves the resume
            // pointer past the last condition, which resumes at this stage — so without this the
            // session ships two session_end rows with different totals and the CVS-Q change score
            // is ambiguous for that participant.
            await clearSessionStageRows('cvsq_scores', session.session_id, 'session_end');
            await put('cvsq_scores', {
              cvsq_id: uuidv4(), session_id: session.session_id, stage: 'session_end',
              frequency: r.frequency, intensity: r.intensity, total_score: r.total, symptomatic: r.symptomatic,
              response_time_ms: r.responseTimeMs,
            });
          }
          advance();
        }} />
      );
      break;
    case 'NASA_TLX':
      view = (
        <NasaTlx onComplete={async (r) => {
          if (session) {
            await put('nasa_tlx', {
              tlx_id: uuidv4(), session_id: session.session_id,
              mental_demand: r.ratings.mental_demand,
              physical_demand: r.ratings.physical_demand,
              temporal_demand: r.ratings.temporal_demand,
              performance: r.ratings.performance,
              effort: r.ratings.effort,
              frustration: r.ratings.frustration,
              performance_load: r.contributions.performance,
              raw_tlx: r.raw_tlx,
              all_touched: Object.values(r.touched).every(Boolean),
              response_time_ms: r.responseTimeMs,
            });
            /**
             * The sitting is complete HERE, when the last instrument is submitted — not when the
             * operator taps the researcher button on the thank-you screen.
             *
             * That button was the only place status became 'complete'. A sitting whose participant
             * had answered everything, and whose operator simply closed the app or let the tablet
             * sleep, stayed `in_progress` with a null end time and a live resume pointer: it
             * exported as session_complete=false and would be excluded as truncated, and tapping
             * Resume to "finish it off" re-administered the closing CVS-Q and TLX with nobody left
             * to answer them.
             */
            await put('sessions', { ...session, status: 'complete', session_end_time: Date.now() });
            clearResume(session.session_id);
          }
          advance();
        }} />
      );
      break;
    case 'CAMERA_SETUP':
      /**
       * The grant is ENFORCED here, not merely recorded.
       *
       * Consent offers "Use the camera for blink and head-position measures" as a separate,
       * default-off grant, and tells the participant that declining means the eye measures are not
       * collected for them. That flag was written to the session and exported as
       * consent_camera_metrics — and read by nothing. The very next screen offered "Enable camera",
       * the operator tapped it because the manual says to, and FaceMesh ran for the whole sitting.
       * The export then carried consent_camera_metrics=false beside ten rows of real blink data:
       * the study's primary outcome, measured on a participant who refused that measurement.
       *
       * A refusal now skips the camera path outright. It cannot be undone by an operator tapping
       * the wrong button, because the button is not there.
       */
      view = session?.media_consent?.camera_metrics === true ? (
        <CameraSetup
          onAllow={async () => { await tracking.start(); advance(); }}
          onSkip={() => advanceOrResume()}
          retains={{
            setupPhotos: session?.media_consent?.setup_photos === true,
            annotationVideo: session?.media_consent?.annotation_video === true,
          }}
        />
      ) : (
        <CameraDeclined onContinue={() => advanceOrResume()} />
      );
      break;
    case 'CALIBRATION':
      view = tracking.status === 'active' && session ? (
        <CalibrationRoutine
          sessionId={session.session_id}
          beginGazeCalibration={tracking.beginGazeCalibration}
          sampleGazeTarget={tracking.sampleGazeTarget}
          endGazeCalibration={tracking.endGazeCalibration}
          onDone={() => { void captureMedia('session_start').then(advanceOrResume); }}
        />
      ) : (
        <Calibration cameraStatus={tracking.status} onDone={advanceOrResume} />
      );
      break;
    case 'BASELINE_FATIGUE':
      view = (
        <FatigueScale
          prompt="How are your eyes feeling right now, before we begin?"
          onComplete={async (r) => {
            if (session) {
              await put('fatigue_scores', {
                fatigue_id: uuidv4(), session_id: session.session_id, condition_id: null,
                stage: 'baseline', ...r.items, fatigue_mean: r.mean, touched: r.touched, all_touched: true,
                response_time_ms: r.responseTimeMs,
              });
              // Propagate the measured baseline into the participant record (was hard-wired to 0).
              const p = await get('participants', session.participant_id);
              if (p) await put('participants', { ...p, baseline_fatigue: r.mean });
            }
            setBaselineFatigue(r.mean);
            advance();
          }}
        />
      );
      break;
    case 'INSTRUCTIONS':
      view = <Instructions onContinue={advance} />;
      break;
    case 'READING_TASK':
      if (cond && passage) {
        // Side-effect on first render of this stage: write condition + start tracking.
        void ensureCondition();
        view = (
          <ReadingTask
            passage={passage} background={cond.background} text={cond.text}
            /**
             * The ocular exposure window opens when the participant taps "Begin reading", not when
             * the stage mounts.
             *
             * It used to open on mount, while ReadingTask was still showing its instruction card.
             * The aggregator's denominator is the span of its own samples, so blink_rate and every
             * PERCLOS proportion were computed over instruction-dwell plus reading, while
             * reading_time_ms covered reading alone — and the codebook asserted the two were the
             * same window. Worse, the first/second-half bins were split at the midpoint of the
             * inflated window, so a participant who paused 40 s on the card had that low-demand
             * period charged to the first-half bin, manufacturing an apparent within-task decline
             * in blink rate out of nothing. Instruction dwell is self-paced, so it varied by
             * condition and by participant: uncontrolled noise injected straight into the primary
             * outcome.
             */
            onBegin={() => tracking.beginCondition()}
            onComplete={async (readingTimeMs) => {
              if (session) {
                await tracking.endCondition(conditionId, session.session_id);
                const existing = await get('conditions', conditionId);
                if (existing) await put('conditions', { ...existing, reading_time_ms: Math.round(readingTimeMs) });
              }
              advance();
            }}
          />
        );
      }
      break;
    case 'COMPREHENSION':
      if (cond && passage) view = (
        <ComprehensionTask
          passage={passage} background={cond.background} text={cond.text}
          onComplete={async (results) => {
            // One row per item. Written sequentially so a failure part-way through leaves the
            // rows that did land intact and identifiable, rather than a partial batch.
            if (session) {
              // A redo of this condition must REPLACE its previous attempt, not sit beside it.
              // These rows are keyed by uuid, so reusing the condition_id is not enough.
              await clearConditionRows('comprehension_results', conditionId);
              for (const r of results) {
                await put('comprehension_results', {
                  comprehension_id: uuidv4(), session_id: session.session_id, condition_id: conditionId,
                  passage_id: passage.id, question_index: r.questionIndex, question_kind: r.questionKind,
                  selected_index: r.selectedIndex, correct_index: r.correctIndex,
                  is_correct: r.isCorrect, response_time_ms: r.responseTimeMs,
                });
              }
            }
            advance();
          }}
        />
      );
      break;
    case 'DISPLAY_PERCEPTION':
      if (cond) view = (
        <DisplayPerceptionRating
          background={cond.background} text={cond.text}
          onComplete={async (r) => {
            if (session) await clearConditionRows('display_perception', conditionId);
            if (session) await put('display_perception', {
              perception_id: uuidv4(), session_id: session.session_id, condition_id: conditionId,
              display_comfort_score: r.comfort, text_clarity_score: r.clarity,
              comfort_touched: r.comfortTouched, clarity_touched: r.clarityTouched,
              response_time_ms: r.responseTimeMs,
            });
            advance();
          }}
        />
      );
      break;
    case 'POST_FATIGUE':
      view = (
        <FatigueScale
          prompt="How are your eyes feeling after this display condition?"
          baselineMean={baselineFatigue ?? undefined}
          background={cond?.background ?? '#F8F7F5'}
          text={cond?.text ?? '#1a1a2e'}
          accent={cond?.text ?? '#1a1a2e'}
          onComplete={async (r) => {
            if (session) await clearConditionRows('fatigue_scores', conditionId);
            if (session) await put('fatigue_scores', {
              fatigue_id: uuidv4(), session_id: session.session_id, condition_id: conditionId,
              stage: 'post_condition', ...r.items, fatigue_mean: r.mean, touched: r.touched, all_touched: true,
              response_time_ms: r.responseTimeMs,
            });
            advance();
          }}
        />
      );
      break;
    case 'VISUAL_SEARCH':
      if (cond && passage) view = (
        <VisualSearchTask
          passage={passage} background={cond.background} text={cond.text}
          onComplete={async (r) => {
            if (session) await put('visual_search', {
              condition_id: conditionId, session_id: session.session_id, passage_id: passage.id,
              search_target: passage.searchTarget, targets_in_set: passage.searchTargetCount,
              search_time_ms: r.searchTimeMs, time_to_first_target_ms: r.timeToFirstTargetMs,
              targets_found: r.targetsFound, targets_missed: r.targetsMissed,
              false_detections: r.falseDetections, accuracy_rate: r.accuracyRate,
              search_efficiency: r.searchEfficiency, mean_inter_target_interval_ms: r.meanInterTargetIntervalMs,
              termination_mode: r.terminationMode,
            });
            advance();
          }}
        />
      );
      break;
    case 'REACTION_TIME':
      view = (
        <ReactionTimeTask
          background={cond?.background ?? '#F8F7F5'}
          text={cond?.text ?? '#1a1a2e'}
          practiceTrials={machine.stepIndex === 0 && (session?.condition_offset ?? 0) === 0 ? CONFIG.RT_PRACTICE_TRIALS : 0}
          onComplete={async (res) => {
            if (session) {
              // Replace, do not append. Every other per-condition store either replaces (keyed by
              // condition_id) or is cleared first; reaction_trials is keyed by a fresh uuid per row
              // and was neither, so a condition that ran twice — a redo after an interruption —
              // left 64 rows under one condition_id, numbered 1..32 twice, while rt_summaries still
              // reported 32. Every rate re-derived from the trial file was then over a doubled
              // denominator, and nothing in the export looked wrong.
              await clearConditionRows('reaction_trials', conditionId);
              for (const t of res.trials) {
                await put('reaction_trials', {
                  trial_id: uuidv4(), condition_id: conditionId, session_id: session.session_id, ...t,
                });
              }
              await put('rt_summaries', { condition_id: conditionId, session_id: session.session_id, ...res.summary });
              // Reaction time is the final task of the condition — mark it complete and advance the
              // resume pointer past it (an interruption now resumes at the next condition).
              const existing = await get('conditions', conditionId);
              if (existing) {
                const started = conditionStarted.current[machine.stepIndex] ?? existing.started_at;
                await put('conditions', {
                  ...existing,
                  completed_at: Date.now(),
                  condition_duration_sec: (Date.now() - started) / 1000,
                });
              }
              saveResume(session.session_id, machine.stepIndex + 1);
            }
            advance();
          }}
        />
      );
      break;
    case 'ADAPTATION': {
      // stepIndex -1 is the grey field BEFORE the first condition: there is no previous condition,
      // so it is never a "switch", and the next step is condition 0.
      const prev = machine.stepIndex >= 0 ? plan[machine.stepIndex] : undefined;
      const nextStep = plan[machine.stepIndex + 1];
      const switched = prev && nextStep && CONDITIONS[prev.conditionIndex].polarity !== CONDITIONS[nextStep.conditionIndex].polarity;
      const dur = switched ? CONFIG.ADAPTATION_SWITCH_POLARITY_MS : CONFIG.ADAPTATION_SAME_POLARITY_MS;
      const label = nextStep ? `Next: ${CONDITIONS[nextStep.conditionIndex].polarity === 'positive' ? 'Light' : 'Dark'} background` : '';
      view = <AdaptationScreen durationMs={dur} nextLabel={label} onDone={() => {
        // Record what was actually delivered, for the next condition's adaptation_ms_before.
        adaptationDelivered.current = dur;
        advance();
      }} />;
      break;
    }
    case 'BREAK_SCREEN':
      view = (
        <BreakScreen completed={machine.stepIndex + 1} total={plan.length} onContinue={advance}>
          {/*
            Show the mid-session illuminance prompt at the break NEAREST the sitting's midpoint,
            not at every break. Rendering it on all of them meant the "middle" reading was taken at
            the FIRST break — after 2 of 10 conditions, 20% in — which is not the middle of
            anything. If that break is missed the prompt reappears at the next one, so a skipped
            reading is still recoverable.
          */}
          {machine.stepIndex + 1 >= Math.floor(plan.length / 2) && (
            <LuxCheckpointPanel
              checkpoint="middle"
              level={session?.ambient_illumination_level ?? null}
              existing={session?.lux_readings?.find((r) => r.checkpoint === 'middle')?.lux ?? null}
              onSubmit={(lux) => void logLuxCheckpoint('middle', lux)}
            />
          )}
        </BreakScreen>
      );
      break;
    case 'SESSION_COMPLETE':
      view = <SessionComplete
        luxPanel={(
          <LuxCheckpointPanel
            checkpoint="end"
            level={session?.ambient_illumination_level ?? null}
            existing={session?.lux_readings?.find((r) => r.checkpoint === 'end')?.lux ?? null}
            onSubmit={(lux) => void logLuxCheckpoint('end', lux)}
          />
        )}
        onExport={async () => {
        // Final setup-proof still, before the record is closed. Ordered before the status write so a
        // capture failure cannot leave the session marked complete without its end photo attempted.
        await captureMedia('session_end');
        if (session) {
          // Completion is already recorded at NASA_TLX; this only attaches the closing photograph
          // and keeps an end time for a session that somehow reached here without one.
          const fresh = await get('sessions', session.session_id);
          await put('sessions', {
            ...(fresh ?? session),
            status: 'complete',
            session_end_time: fresh?.session_end_time ?? Date.now(),
          });
          clearResume(session.session_id);
        }
        tracking.stop();
        advance();
      }} />;
      break;
    case 'EXPORT_DASHBOARD':
      view = (
        <div style={{ height: '100%' }}>
          <Dashboard initialSessionId={session?.session_id} />
          <button
            onClick={onExit}
            className="font-lab text-sm"
            style={{ position: 'fixed', top: 10, left: 12, zIndex: 50, padding: '6px 12px', borderRadius: 8, border: '1px solid #d8d4cc', background: '#fff', cursor: 'pointer' }}
          >
            ← Sessions
          </button>
        </div>
      );
      break;
  }

  if (resuming) {
    return (
      <div className="min-h-screen w-full bg-cream font-sans text-[#1a1a2e]" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p className="font-lab text-sm text-[#5a5a7a]">Resuming session…</p>
      </div>
    );
  }

  // Pause control: available during the per-condition loop. Exits to the manager; the session
  // remains in-progress and can be resumed from the start of the current condition.
  const canPause = isInLoop(machine.stage) && machine.stage !== 'REACTION_TIME' && !!session;

  return (
    <div data-stage={machine.stage} style={{ height: '100%' }}>
      {showProgress && (
        <ExperimentProgress
          percent={percent}
          label={machine.stage.replace(/_/g, ' ').toLowerCase()}
          conditionCurrent={conditionCurrent}
          conditionTotal={conditionTotal}
          timeRemainingMin={timeRemainingMin}
        />
      )}
      {canPause && (
        <button
          onClick={() => {
            if (!session) return;
            /**
             * A pause during ADAPTATION comes AFTER the condition is finished — the grey field is a
             * rest, not part of the run. Saving machine.stepIndex there rewound the pointer over a
             * completed condition, so the resume replayed a passage the participant had just read
             * (inflating comprehension and reading speed through prior exposure) and appended a
             * second set of reaction trials under the same condition_id.
             */
            const done = machine.stage === 'ADAPTATION';
            const target = done ? machine.stepIndex + 1 : machine.stepIndex;
            const msg = done
              ? 'Pause and exit to the session manager? This condition is complete; the session will resume at the next one.'
              : 'Pause and exit to the session manager? This condition will be restarted on resume.';
            if (window.confirm(msg)) {
              saveResume(session.session_id, target);
              tracking.stop();
              onExit();
            }
          }}
          className="font-lab text-xs"
          style={{ position: 'fixed', top: 10, left: 12, zIndex: 45, padding: '5px 10px', borderRadius: 8, border: '1px solid #d8d4cc', background: 'rgba(255,255,255,0.85)', cursor: 'pointer' }}
        >
          ⏸ Pause
        </button>
      )}
      {view}
    </div>
  );
}
