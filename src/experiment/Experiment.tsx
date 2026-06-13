/**
 * Experiment orchestrator. Owns the stage machine, the session/participant/plan, the tracking
 * lifecycle, and all IndexedDB writes. Renders the component for the current stage and advances on
 * completion. The full researcher dashboard/export is a later phase — EXPORT_DASHBOARD is a stub.
 */
import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CONDITIONS, conditionDefinitionHash } from './conditions';
import { PASSAGES } from './passages';
import { sessionPlan, type PlannedStep } from './counterbalance';
import { CONFIG } from './config';
import { initialState, nextState, progressPercent, type MachineState } from './stateMachine';
import { APP_VERSION, GIT_HASH, BUILD_TIME } from '@/lib/env';
import { put, get, nextEnrolmentNumber } from '@/storage/db';
import { DB_VERSION } from '@/storage/schemaEnums';
import type { Provenance, SessionRecord } from '@/storage/types';
import { useTracking } from '@/tracking/useTracking';
import { ExperimentProgress } from '@/components/ExperimentProgress';
import { FatigueScale } from '@/scales/FatigueScale';
import { DisplayPerceptionRating } from '@/scales/DisplayPerceptionRating';
import { ReadingTask } from '@/tasks/ReadingTask';
import { ComprehensionTask } from '@/tasks/ComprehensionTask';
import { VisualSearchTask } from '@/tasks/VisualSearchTask';
import { ReactionTimeTask } from '@/tasks/ReactionTimeTask';
import {
  SessionInit, ParticipantProfile, CameraSetup, Calibration, AdaptationScreen, SessionComplete,
  type SessionInitData, type ProfileData,
} from '@/start/setupStages';

function provenance(): Provenance {
  return {
    app_version: APP_VERSION, git_hash: GIT_HASH, build_time: BUILD_TIME,
    condition_def_hash: conditionDefinitionHash(), schema_version: DB_VERSION,
  };
}

export default function Experiment() {
  const tracking = useTracking();
  const [machine, setMachine] = useState<MachineState>(initialState());
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [enrolment, setEnrolment] = useState(0);
  const [plan, setPlan] = useState<PlannedStep[]>([]);
  const [baselineFatigue, setBaselineFatigue] = useState<number | null>(null);
  const conditionIds = useRef<string[]>([]);
  const writtenConditions = useRef<Set<number>>(new Set());
  const conditionStarted = useRef<Record<number, number>>({});

  const advance = useCallback(() => setMachine((m) => nextState(m)), []);

  const step = plan[machine.stepIndex];
  const cond = step ? CONDITIONS[step.conditionIndex] : null;
  const passage = step ? PASSAGES[step.passageIndex] : null;
  const conditionId = conditionIds.current[machine.stepIndex];

  // --- SESSION INIT ---
  const beginSession = useCallback(async (d: SessionInitData) => {
    const enrol = await nextEnrolmentNumber();
    const thePlan = sessionPlan(enrol);
    conditionIds.current = thePlan.map(() => uuidv4());
    writtenConditions.current = new Set();
    const sid = uuidv4();
    const rec: SessionRecord = {
      session_id: sid,
      participant_id: d.participantId,
      enrolment_number: enrol,
      ambient_lux: d.ambientLux,
      screen_white_luminance_cd_m2: d.whiteLuminance,
      brightness_percent: d.brightnessPercent,
      session_start_time: Date.now(),
      session_end_time: null,
      randomisation_seed: enrol,
      condition_order: thePlan.map((s) => s.conditionIndex),
      preflight_complete: true,
      consent_given: true,
      consent_time: Date.now(),
      provenance: provenance(),
      device_type: navigator.userAgent.includes('Android') ? 'Android' : 'Other',
      browser: navigator.userAgent.slice(0, 60),
      screen_resolution: `${screen.width}x${screen.height}`,
    };
    await put('sessions', rec);
    setSession(rec);
    setEnrolment(enrol);
    setPlan(thePlan);
    advance();
  }, [advance]);

  // --- PARTICIPANT PROFILE ---
  const saveProfile = useCallback(async (d: ProfileData) => {
    if (!session) return;
    await put('participants', {
      participant_id: session.participant_id,
      enrolment_number: enrolment,
      age: d.age, gender: d.gender, daily_screen_hours: d.dailyScreenHours,
      device_familiarity: d.deviceFamiliarity, lighting_habit: d.lightingHabit,
      correction_type: d.correctionType,
      cvd_status: d.cvdSelfReport ? 'self_reported_deficient' : 'normal',
      ishihara_correct: null, ishihara_total: null,
      caffeine_today: null, hours_since_sleep: null,
      eligible: d.age >= 18 && d.age <= 80, exclusion_reason: null,
      baseline_fatigue: 0, session_id: session.session_id,
    });
    advance();
  }, [session, enrolment, advance]);

  // --- condition record (lazy, on entering reading) ---
  const ensureCondition = useCallback(async () => {
    if (!session || !cond || !step) return;
    if (writtenConditions.current.has(machine.stepIndex)) return;
    writtenConditions.current.add(machine.stepIndex);
    const prev = plan[machine.stepIndex - 1];
    const switched = prev && CONDITIONS[prev.conditionIndex].polarity !== cond.polarity;
    const adaptationBefore = machine.stepIndex === 0 ? 0
      : switched ? CONFIG.ADAPTATION_SWITCH_POLARITY_MS : CONFIG.ADAPTATION_SAME_POLARITY_MS;
    await put('conditions', {
      condition_id: conditionId, session_id: session.session_id,
      session_position: machine.stepIndex, condition_label: cond.label,
      polarity: cond.polarity, background_color: cond.background, text_color: cond.text,
      color_name: cond.colorName, passage_id: step.passageIndex,
      wcag_contrast_ratio: cond.wcag_contrast_ratio, wcag_level: cond.wcag_level,
      michelson_contrast: cond.michelson_contrast, below_wcag_aa: cond.below_wcag_aa,
      started_at: Date.now(), completed_at: null, condition_duration_sec: null,
      adaptation_ms_before: adaptationBefore,
    });
    conditionStarted.current[machine.stepIndex] = Date.now();
    // Eye-tracking window spans the reading task (begins here, ends at reading complete).
    tracking.beginCondition();
  }, [session, cond, step, conditionId, machine.stepIndex, plan, tracking]);

  // ===== RENDER =====
  const percent = progressPercent(machine);
  const showProgress = machine.stage !== 'SESSION_INIT' && machine.stage !== 'EXPORT_DASHBOARD';

  let view: React.ReactNode = null;
  switch (machine.stage) {
    case 'SESSION_INIT':
      view = <SessionInit onSubmit={beginSession} />;
      break;
    case 'PARTICIPANT_PROFILE':
      view = <ParticipantProfile onSubmit={saveProfile} />;
      break;
    case 'CAMERA_SETUP':
      view = (
        <CameraSetup
          onAllow={async () => { await tracking.start(); advance(); }}
          onSkip={() => advance()}
        />
      );
      break;
    case 'CALIBRATION':
      view = (
        <Calibration
          cameraStatus={tracking.status}
          onDone={async () => { if (tracking.status === 'active') await tracking.calibrate(5000); advance(); }}
        />
      );
      break;
    case 'BASELINE_FATIGUE':
      view = (
        <FatigueScale
          prompt="How are your eyes feeling right now, before we begin?"
          onComplete={async (r) => {
            if (session) await put('fatigue_scores', {
              fatigue_id: uuidv4(), session_id: session.session_id, condition_id: null,
              stage: 'baseline', ...r.items, fatigue_mean: r.mean, touched: r.touched, all_touched: true,
            });
            setBaselineFatigue(r.mean);
            advance();
          }}
        />
      );
      break;
    case 'READING_TASK':
      if (cond && passage) {
        // Side-effect on first render of this stage: write condition + start tracking.
        void ensureCondition();
        view = (
          <ReadingTask
            passage={passage} background={cond.background} text={cond.text}
            onComplete={async () => {
              if (session) await tracking.endCondition(conditionId, session.session_id);
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
          onComplete={async (r) => {
            if (session) await put('comprehension_results', {
              comprehension_id: uuidv4(), session_id: session.session_id, condition_id: conditionId,
              passage_id: passage.id, selected_index: r.selectedIndex, correct_index: r.correctIndex,
              is_correct: r.isCorrect, response_time_ms: r.responseTimeMs,
            });
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
            if (session) await put('display_perception', {
              perception_id: uuidv4(), session_id: session.session_id, condition_id: conditionId,
              display_comfort_score: r.comfort, text_clarity_score: r.clarity,
              comfort_touched: r.comfortTouched, clarity_touched: r.clarityTouched,
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
          accent={cond?.polarity === 'negative' ? '#4f8ef7' : '#1a1a2e'}
          onComplete={async (r) => {
            if (session) await put('fatigue_scores', {
              fatigue_id: uuidv4(), session_id: session.session_id, condition_id: conditionId,
              stage: 'post_condition', ...r.items, fatigue_mean: r.mean, touched: r.touched, all_touched: true,
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
          onComplete={async (res) => {
            if (session) {
              for (const t of res.trials) {
                await put('reaction_trials', {
                  trial_id: uuidv4(), condition_id: conditionId, session_id: session.session_id, ...t,
                });
              }
              await put('rt_summaries', { condition_id: conditionId, session_id: session.session_id, ...res.summary });
              // Mark the condition complete (tracking already ended after reading).
              const existing = await get('conditions', conditionId);
              if (existing) {
                const started = conditionStarted.current[machine.stepIndex] ?? existing.started_at;
                await put('conditions', {
                  ...existing,
                  completed_at: Date.now(),
                  condition_duration_sec: (Date.now() - started) / 1000,
                });
              }
            }
            advance();
          }}
        />
      );
      break;
    case 'ADAPTATION': {
      const prev = plan[machine.stepIndex];
      const nextStep = plan[machine.stepIndex + 1];
      const switched = prev && nextStep && CONDITIONS[prev.conditionIndex].polarity !== CONDITIONS[nextStep.conditionIndex].polarity;
      const dur = switched ? CONFIG.ADAPTATION_SWITCH_POLARITY_MS : CONFIG.ADAPTATION_SAME_POLARITY_MS;
      const label = nextStep ? `Next: ${CONDITIONS[nextStep.conditionIndex].polarity === 'positive' ? 'Light' : 'Dark'} background` : '';
      view = <AdaptationScreen durationMs={dur} nextLabel={label} onDone={advance} />;
      break;
    }
    case 'SESSION_COMPLETE':
      view = <SessionComplete onExport={async () => {
        if (session) await put('sessions', { ...session, session_end_time: Date.now() });
        tracking.stop();
        advance();
      }} />;
      break;
    case 'EXPORT_DASHBOARD':
      view = (
        <div className="min-h-screen w-full bg-cream p-[6%] font-sans text-[#1a1a2e]">
          <h1 className="font-serif text-4xl font-light">Export dashboard</h1>
          <p className="mt-2 font-lab text-sm text-[#5a5a7a]">
            Data captured to IndexedDB. The full dashboard + CSV/JSON export is the next phase.
          </p>
        </div>
      );
      break;
  }

  return (
    <>
      {showProgress && <ExperimentProgress percent={percent} label={machine.stage.replace(/_/g, ' ').toLowerCase()} />}
      {view}
    </>
  );
}
