import { useEffect, useRef, useState } from 'react';
import type { LiveTrackingStats } from '@/tracking/useTracking';
import { setMonitorOpen } from '@/lib/hiddenTime';
import { UI_TEXT } from '@/lib/uiPalette';
import { LiveFeed, EarTrace, PipelineReadout } from '@/components/LiveCamera';
import { FPS_TIER_WORD, fpsTier } from '@/tracking/frameRateGate';

/**
 * The researcher's corner panel: live camera readout and the session clock, collapsible.
 *
 * Replaces TrackingMonitor, which was a fixed chip that vanished during reading, the grey field and
 * both speeded tasks — exactly the stretches in which the camera matters — and gave no clock at all.
 * The investigator asked for one module that stays out of the way when collapsed and can be kept open
 * and live at any time.
 *
 *   COLLAPSED — a status dot and the sitting's elapsed time. Tap to open.
 *   OPEN      — camera: state in words, face in view, blinks this condition (incomplete in brackets),
 *               blinks this sitting, eye openness, gaze zone, frame rate, picture brightness;
 *               time: this sitting, since the session began (includes pauses), this screen,
 *               conditions done, and an estimate of time left.
 *
 * PROTECTING THE MEASUREMENT. A live number in the corner of a stimulus screen is something the
 * participant can see. So on condition screens and the grey field (`onStimulus`):
 *   - collapsed, the panel is a MONOCHROME INK INDICATOR: a small outline square in the screen's own
 *     ink with a dot in it — filled while the camera is fine or off, an empty ring while there is a
 *     SUSTAINED problem — and no text and no hue. It used to show the sitting clock, and turned amber
 *     or red, with words ("No face for 16 s"), whenever face detection faltered: a coloured patch in
 *     the periphery during reading and during the COLOUR go/no-go task, appearing for reasons
 *     unrelated to the condition (screen audit F10). The blocking camera-lost and camera-blocked
 *     notices are what the operator acts on, and they still fire;
 *   - the ring is for the 'bad' states only (camera stopped or black, no frames, no face for 8 s,
 *     blinks not being counted). A face lost for a moment — the participant looking down, leaning in
 *     — is 'warn', and turned the dot to a ring and back within seconds: a shape flickering in the
 *     periphery, about as often as the participant moved, which nobody could act on;
 *   - `hidden`: while the reaction-time trials run — from Start, through the practice and "Practice
 *     complete", to the last trial — it is NOT DRAWN AT ALL. The screen's ink is the condition's text
 *     colour, and that is the go-target's colour (conditions.ts, rtStimulusColours): the indicator was
 *     a small target-coloured dot in a target-coloured box, about 230 px from the nearest dot, for the
 *     whole of a colour go/no-go block (review of rounds 65-66; coverage research 3.3 asked for no hue
 *     here). The achromatic fixation ink is no way out: it is black on a light ground and white on a
 *     dark one, which are the P1 and N1 go-targets. It goes with the instruction card at Start, as
 *     Pause does, and is back with "Block complete", while the results save. Nothing about it could be
 *     acted on mid-block anyway: the camera notices wait for the trials to end (Experiment, `pausable`);
 *   - `still`: while another timed procedure runs (the calibration dots, the self-test, the
 *     colour-vision plates) the indicator does not change at all — it keeps the look it had when the
 *     procedure began. A dot changing shape in the corner of a dot-detection procedure is a distractor
 *     of the procedure's own kind;
 *   - it closes by itself when a condition screen starts, unless "Keep open during tasks" is on;
 *   - opened, it is the compact two-line strip, in the screen's ink on no ground, updated once a
 *     second — and it can be opened only on the reading task and the grey field, whose bottom-left
 *     corner nothing else uses (the reading footer's countdown and button sit at the right; see
 *     ReadingTask). Everywhere else in a display — the questions, the ratings, word search, the
 *     reaction task — it is LOCKED: collapsed and untappable, because an open panel there sat over
 *     the answers, the sliders, or where a target could be, and a tap near the left edge landed on it;
 *   - every moment it is open is recorded (setMonitorOpen → condition_monitor_open_ms and
 *     reading_monitor_open_ms), so its effect can be modelled rather than assumed away.
 * During the eye calibration, the camera self-test and the colour-vision plates (`locked`, not on a
 * condition screen) it is the same locked indicator, in that screen's ink.
 *
 * ON SET-UP AND CLOSING SCREENS the panel is the full card, and it RESERVES ITS FOOTPRINT: while it
 * is open it docks in a column at the left and sets --vl-panel-dock, by which Experiment pads the
 * screen, so the screen's own content moves over and nothing is ever under the card. Overlaid, it
 * covered "All checks pass — continue" on pre-flight at every viewport, and the sliders and Continue
 * of the baseline fatigue scale.
 *
 * THE CARD SHOWS THE CAMERA (round 75, investigator request). When the camera is running the card
 * opens with the live picture — a second <video> on the tracker's own stream, mirrored, with the face
 * box and the eyelid points the blink measure is computed from drawn over it — the last ten seconds of
 * eye openness against the 0.75 and 0.60 cuts, and the pipeline's three rates (camera delivers,
 * tracker processes, face found) with which one is short. See LiveCamera.tsx. ONLY THE CARD: on a
 * condition screen the panel is the ink indicator or the two-line strip above and never a picture —
 * a participant watching their own face is not reading, searching or responding to the dots — and it
 * is the card only where it can be opened at all (set-up screens, the break, the closing screens).
 * Nulls render as "—", never 0.
 */
export interface ResearcherPanelProps {
  subscribe: (fn: (s: LiveTrackingStats) => void) => () => void;
  /** 'active' | 'failed' | 'denied' | 'unavailable' */
  cameraStatus: string;
  cameraBlocked: boolean;
  cameraLost: boolean;
  /** The frame-rate gate's adequate floor (frameRateGate.ts FPS_GATE.ADEQUATE): the last reading is amber below it. */
  fpsFloor: number;
  /** Human label of the current stage. */
  stageLabel: string;
  /** A condition screen or the grey field is showing (collapse by default, draw in ink, strip when open). */
  onStimulus: boolean;
  /**
   * Stay collapsed and untappable, as the monochrome indicator: every display screen but reading and
   * the grey field, and the measured procedures in set-up (calibration, self-test, colour-vision plates).
   */
  locked: boolean;
  /** The screen's own ink and ground, wherever the panel is drawn as the indicator or the strip. */
  ink: { ink: string; ground: string } | null;
  /** A timed procedure is running: the indicator holds the look it had when it began. */
  still?: boolean;
  /**
   * Draw nothing: the reaction-time trials are running, and any ink this panel could use matches a
   * go-target in some condition (see `hidden` above). The component stays mounted, so its state —
   * open or not, the live readout — is what it was when the block began.
   */
  hidden?: boolean;
  /**
   * The tracker's MediaStream, for the card's live picture; null when the camera is not running. A
   * getter, read on every readout, so a camera restarted mid-sitting is picked up.
   */
  getStream?: () => MediaStream | null;
  /** When this sitting's screen time started (Date.now() ms), and the session's recorded start. */
  sittingStartedAt: number;
  sessionStartedAt: number | null;
  stageStartedAt: number;
  conditionsDone: number | null;
  conditionsTotal: number | null;
  minutesLeft: number | null;
}

/** The card's width, and the column a set-up screen gives up while it is open: card + 10 px each side + 4. */
const PANEL_CARD_PX = 320;
export const PANEL_DOCK_PX = 10 + PANEL_CARD_PX + 14;
/** The strip's widest. ReadingTask's countdown starts 420 px from the column's right end, clear of it. */
export const PANEL_STRIP_MAX_PX = 440;

const KEEP_OPEN_KEY = 'visulab.panel.keepOpen';
const readKeepOpen = () => { try { return localStorage.getItem(KEEP_OPEN_KEY) === '1'; } catch { return false; } };
const writeKeepOpen = (v: boolean) => { try { localStorage.setItem(KEEP_OPEN_KEY, v ? '1' : '0'); } catch { /* private mode */ } };

export function clock(ms: number | null, withSeconds = true): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}`;
  return withSeconds ? `${mm}:${String(s).padStart(2, '0')}` : `${h > 0 ? mm : m} min`;
}

/** The camera's state in plain words, and whether it is a problem. */
export function cameraState(p: {
  cameraStatus: string; cameraBlocked: boolean; cameraLost: boolean; stale: boolean; s: LiveTrackingStats | null;
}): { text: string; level: 'ok' | 'warn' | 'bad' | 'off' } {
  if (p.cameraLost) return { text: 'Camera stopped', level: 'bad' };
  if (p.cameraStatus !== 'active') return { text: 'Camera off', level: 'off' };
  if (p.cameraBlocked || p.s?.blocked) return { text: 'Picture black — covered or switched off?', level: 'bad' };
  if (p.stale) return { text: 'No frames arriving', level: 'bad' };
  if (!p.s) return { text: 'Starting…', level: 'warn' };
  if (!p.s.facePresent) {
    const secs = Math.round((p.s.noFaceForMs ?? 0) / 1000);
    return { text: secs >= 2 ? `No face for ${secs} s` : 'No face', level: secs >= 8 ? 'bad' : 'warn' };
  }
  /*
   * No blink count. `blinks` is null whenever no reading exposure has run yet, so on its own it cannot
   * say whether anything is wrong, and it used to be read as "no baseline" in red on every set-up
   * screen: before calibration, where no baseline is expected yet (and, from round 75, the camera
   * already runs at camera setup), and after a SUCCESSFUL calibration until the first reading — a
   * false alarm on exactly the screens where the operator is deciding whether to go on. The baseline
   * itself now travels with the readout, so the three cases are told apart; only the third is a
   * problem.
   */
  if (p.s.blinks == null) {
    if (p.s.baselineEar != null) return { text: 'Working — blinks are counted from the first reading', level: 'ok' };
    if (!p.s.baselineMeasured) return { text: 'Face seen — eye baseline is measured at calibration', level: 'ok' };
    return { text: 'Face seen — blinks NOT counted (no eye baseline)', level: 'bad' };
  }
  return { text: 'Working', level: 'ok' };
}


export function ResearcherPanel(p: ResearcherPanelProps) {
  const [s, setS] = useState<LiveTrackingStats | null>(null);
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [keepOpen, setKeepOpen] = useState(readKeepOpen);
  const [open, setOpen] = useState(false);
  const lastEmit = useRef(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const { subscribe, onStimulus, getStream } = p;
  useEffect(() => subscribe((next) => {
    // Once a second on a stimulus screen; the tracker's 4 Hz elsewhere.
    const t = Date.now();
    if (onStimulus && t - lastEmit.current < 1000) return;
    lastEmit.current = t;
    setS(next);
    setAt(t);
    // Never on a stimulus screen: the picture is the card's alone (see the header).
    if (!onStimulus) setStream(getStream?.() ?? null);
  }), [subscribe, onStimulus, getStream]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), p.onStimulus ? 1000 : 500);
    return () => clearInterval(id);
  }, [p.onStimulus]);

  // A condition screen starting closes the panel unless the researcher chose to keep it open.
  useEffect(() => {
    if (p.onStimulus && !keepOpen) setOpen(false);
  }, [p.onStimulus, p.stageStartedAt, keepOpen]);

  const shown = open && !p.locked && !p.hidden;
  useEffect(() => {
    setMonitorOpen(shown && p.onStimulus);
    return () => setMonitorOpen(false);
  }, [shown, p.onStimulus]);

  /** Drawn as the indicator or the strip, in the screen's ink: on a display, or locked over a procedure. */
  const quiet = p.onStimulus || p.locked;
  /*
   * The card, open on a set-up or closing screen, reserves its column: Experiment pads the screen by
   * --vl-panel-dock, so the content moves over instead of lying under the card. Cleared the moment it
   * closes or the screen becomes one where the card is not drawn.
   */
  const docked = shown && !quiet;
  useEffect(() => {
    const root = document.documentElement;
    if (docked) root.style.setProperty('--vl-panel-dock', `${PANEL_DOCK_PX}px`);
    else root.style.removeProperty('--vl-panel-dock');
    return () => { root.style.removeProperty('--vl-panel-dock'); };
  }, [docked]);

  const stale = p.cameraStatus === 'active' && at > 0 && now - at > 2500;
  const cam = cameraState({ cameraStatus: p.cameraStatus, cameraBlocked: p.cameraBlocked, cameraLost: p.cameraLost, stale, s });
  const sittingMs = now - p.sittingStartedAt;
  const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

  // The ink of a quiet panel: the screen's own. Never a hue of the panel's own choosing.
  const ink = quiet ? (p.ink?.ink ?? UI_TEXT.ink) : null;
  /*
   * The quiet dot's one bit: a sustained problem, held unchanged while a timed procedure runs (see
   * `still` above). The ref is the look at the last moment the panel was not held.
   */
  const problemNow = cam.level === 'bad';
  const heldProblem = useRef(problemNow);
  if (!p.still) heldProblem.current = problemNow;
  const problem = p.still ? heldProblem.current : problemNow;
  // On set-up screens a problem is shown in colour: the alert the researcher asked for.
  const dotColour = cam.level === 'ok' ? '#22c97a' : cam.level === 'off' ? '#9aa0b4' : cam.level === 'warn' ? '#e0a33c' : '#e5484d';
  /** The quiet dot: filled while all is well (or the camera is simply off), an empty ring on a problem. */
  const quietDot = (size: number): React.CSSProperties => ({
    display: 'inline-block', width: size, height: size, borderRadius: '50%', flex: '0 0 auto', boxSizing: 'border-box',
    background: problem ? 'transparent' : ink!, border: `2px solid ${ink}`,
  });

  // After every hook, so hiding and showing again keeps the hooks in order.
  if (p.hidden) return null;

  const base: React.CSSProperties = {
    position: 'fixed', left: 10, bottom: 10, zIndex: 45,
    fontFamily: '"DM Mono", ui-monospace, monospace', borderRadius: 12,
    pointerEvents: p.locked ? 'none' : 'auto',
  };

  if (!shown && quiet) {
    // The monochrome indicator: no text, no hue, one look on every display screen and procedure.
    return (
      <button
        type="button"
        data-testid="researcher-panel-collapsed"
        data-quiet="true"
        aria-label={`Researcher panel: ${cam.text}. Sitting time ${clock(sittingMs)}.${p.locked ? '' : ' Tap to open.'}`}
        onClick={() => setOpen(true)}
        style={{
          ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          width: 'var(--vl-nav-chip-h)', height: 'var(--vl-nav-chip-h)',
          background: 'transparent', border: `1px solid ${ink}`, cursor: p.locked ? 'default' : 'pointer',
        }}
      >
        <span style={quietDot(12)} />
      </button>
    );
  }

  const card: React.CSSProperties = { background: 'rgba(26,26,46,0.94)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 16px rgba(0,0,0,.25)' };

  if (!shown) {
    return (
      <button
        type="button"
        data-testid="researcher-panel-collapsed"
        aria-label={`Researcher panel: ${cam.text}. Sitting time ${clock(sittingMs)}. Tap to open.`}
        onClick={() => setOpen(true)}
        // 44 CSS px at any display scale, like every other operator control (theme.css).
        style={{ ...base, ...card, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', fontSize: 15, cursor: 'pointer', minHeight: 'var(--vl-nav-chip-h)' }}
      >
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: dotColour, flex: '0 0 auto' }} />
        <span>{clock(sittingMs)}</span>
        {cam.level === 'bad' && <span style={{ fontSize: 15 }}>{cam.text}</span>}
      </button>
    );
  }

  if (quiet) {
    /*
     * Two lines in the bottom-left corner — on reading, below the passage's rule, in the left of the
     * footer row, whose countdown and button sit at the right — in the screen's ink on no ground.
     *
     * EXACTLY TWO LINES, never wrapped: 2 x 13 px x 1.45 + 12 + 2 = 52 px, inside the footer's 56 px
     * row (stimulusPage.ts), which the strip shares with nothing. Wrapped, the longest camera state
     * ("Face seen — blinks NOT counted (no eye baseline)" with the counts after it) made the first
     * line two, and a 71 px strip rose over the footer's rule into the bottom of the passage's text
     * box. A line too long for PANEL_STRIP_MAX_PX is cut with an ellipsis; the full card on the
     * set-up screens and the break says it in full.
     */
    const line: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
    return (
      <div data-testid="researcher-panel-strip" style={{ ...base, color: ink!, background: 'transparent', border: `1px solid ${ink}`, padding: '6px 12px', fontSize: 13, lineHeight: 1.45, maxWidth: PANEL_STRIP_MAX_PX, boxSizing: 'border-box', cursor: 'pointer' }}
        onClick={() => setOpen(false)} role="button" aria-label="Close researcher panel">
        <div style={line}>
          <span style={{ ...quietDot(9), marginRight: 6 }} />
          {cam.text} · blinks {num(s?.blinks)} ({num(s?.incomplete)} inc) · {num(s?.faceFps)} fps
        </div>
        <div style={line}>sitting {clock(sittingMs, false)} · condition {p.conditionsDone ?? '—'}/{p.conditionsTotal ?? '—'} · ~{p.minutesLeft ?? '—'} min left</div>
      </div>
    );
  }

  const row = (k: string, v: React.ReactNode, testid?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }} data-testid={testid}>
      <span style={{ opacity: 0.78 }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
  return (
    <div
      data-testid="researcher-panel"
      style={{
        ...base, ...card, padding: '10px 12px', fontSize: 15, lineHeight: 1.5, width: PANEL_CARD_PX,
        // Docked in the column the screen has given up to it (--vl-panel-dock), below the Exit chip's band.
        maxHeight: 'calc(100% - var(--vl-nav-band) - 10px)', overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 14, letterSpacing: 0.5 }}>RESEARCHER</strong>
        <button type="button" data-testid="researcher-panel-close" onClick={() => setOpen(false)}
          style={{ background: 'transparent', color: '#fff', border: '1px solid #fff', borderRadius: 8, padding: '4px 10px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          Hide
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: cam.level === 'ok' || cam.level === 'off' ? '#fff' : dotColour }} data-testid="researcher-camera-state">
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: dotColour }} />{cam.text}
      </div>
      {p.cameraStatus === 'active' && (
        <div style={{ marginTop: 8 }} data-testid="researcher-camera">
          <LiveFeed stream={stream} stats={s} width={PANEL_CARD_PX - 24} testid="researcher-feed" />
          <div style={{ marginTop: 6 }}><EarTrace stats={s} width={PANEL_CARD_PX - 24} height={56} /></div>
          <div style={{ marginTop: 6 }}><PipelineReadout stats={s} compact /></div>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        {row('Blinks (condition)', <>{num(s?.blinks)} <span style={{ opacity: 0.85 }}>· {num(s?.incomplete)} inc.</span></>)}
        {row('Blinks (sitting)', num(s?.sessionBlinks))}
        {row('Eye open', s?.earRatio != null ? `${Math.round(s.earRatio * 100)}% of baseline` : '—')}
        {row('Gaze', s?.gazeZone ? (s.gazeZone === 'cc' ? 'centre' : s.gazeZone) : '—')}
        {/* The frame-rate gate fps-g2 on the last reading (frameRateGate.ts): its rate and tier, amber below tier A. */}
        {row('Last reading', <span data-testid="researcher-last-fps" style={{ color: s?.exposureFps != null && s.exposureFps < p.fpsFloor ? '#ffd27a' : undefined }}>{s?.exposureFps != null ? `${num(s.exposureFps)} a second · ${FPS_TIER_WORD[fpsTier(s.exposureFps)!].toLowerCase()}` : '—'}</span>)}
        {row('Brightness', s?.luma != null ? `${s.luma}/255` : '—')}
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.18)' }}>
        {row('This sitting', clock(sittingMs), 'researcher-clock')}
        {row('Since start', clock(p.sessionStartedAt != null ? now - p.sessionStartedAt : null))}
        {row('This screen', clock(now - p.stageStartedAt))}
        {row('Conditions', p.conditionsTotal != null ? `${p.conditionsDone ?? 0} of ${p.conditionsTotal}` : '—')}
        {row('Time left', p.minutesLeft != null ? `about ${p.minutesLeft} min` : '—')}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 15, cursor: 'pointer' }}>
        <input type="checkbox" checked={keepOpen} onChange={(e) => { setKeepOpen(e.target.checked); writeKeepOpen(e.target.checked); }} style={{ width: 18, height: 18 }} />
        Keep open during tasks (recorded)
      </label>
    </div>
  );
}
