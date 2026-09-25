import { useEffect, useRef, useState } from 'react';
import type { LiveTrackingStats } from '@/tracking/useTracking';
import { setMonitorOpen } from '@/lib/hiddenTime';

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
 * participant can see. So on condition screens:
 *   - the panel closes by itself when a condition screen starts, unless "Keep open during tasks" is on;
 *   - it is drawn in the screen's own ink on no background (as the Pause button is), so it adds no
 *     patch of a different luminance to the polarity manipulation, and it updates once a second;
 *   - on reading screens it opens as a compact two-line strip in the empty left half of the footer,
 *     below the passage, never over it;
 *   - during word search and the reaction task it stays collapsed and cannot be tapped: an open
 *     panel could cover a target;
 *   - every moment it is open is recorded (setMonitorOpen → condition_monitor_open_ms and
 *     reading_monitor_open_ms), so its effect can be modelled rather than assumed away.
 * Nulls render as "—", never 0.
 */
export interface ResearcherPanelProps {
  subscribe: (fn: (s: LiveTrackingStats) => void) => () => void;
  /** 'active' | 'failed' | 'denied' | 'unavailable' */
  cameraStatus: string;
  cameraBlocked: boolean;
  cameraLost: boolean;
  /** Below this the incomplete-blink ratio is not reliably measurable. */
  fpsFloor: number;
  /** Human label of the current stage. */
  stageLabel: string;
  /** A condition screen is showing (collapse by default, draw in ink). */
  onStimulus: boolean;
  /** Reading specifically: open as a compact strip in the footer. */
  onReading: boolean;
  /** Word search or reaction trials: stay collapsed and untappable. */
  locked: boolean;
  /** The condition's ink and ground while on a stimulus screen. */
  ink: { ink: string; ground: string } | null;
  /** When this sitting's screen time started (Date.now() ms), and the session's recorded start. */
  sittingStartedAt: number;
  sessionStartedAt: number | null;
  stageStartedAt: number;
  conditionsDone: number | null;
  conditionsTotal: number | null;
  minutesLeft: number | null;
}

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
  if (p.s.blinks == null) return { text: 'Face seen — blinks NOT counted (no eye baseline)', level: 'bad' };
  return { text: 'Working', level: 'ok' };
}


export function ResearcherPanel(p: ResearcherPanelProps) {
  const [s, setS] = useState<LiveTrackingStats | null>(null);
  const [at, setAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [keepOpen, setKeepOpen] = useState(readKeepOpen);
  const [open, setOpen] = useState(false);
  const lastEmit = useRef(0);

  const { subscribe, onStimulus } = p;
  useEffect(() => subscribe((next) => {
    // Once a second on a stimulus screen; the tracker's 4 Hz elsewhere.
    const t = Date.now();
    if (onStimulus && t - lastEmit.current < 1000) return;
    lastEmit.current = t;
    setS(next);
    setAt(t);
  }), [subscribe, onStimulus]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), p.onStimulus ? 1000 : 500);
    return () => clearInterval(id);
  }, [p.onStimulus]);

  // A condition screen starting closes the panel unless the researcher chose to keep it open.
  useEffect(() => {
    if (p.onStimulus && !keepOpen) setOpen(false);
  }, [p.onStimulus, p.stageStartedAt, keepOpen]);

  const shown = open && !p.locked;
  useEffect(() => {
    setMonitorOpen(shown && p.onStimulus);
    return () => setMonitorOpen(false);
  }, [shown, p.onStimulus]);

  const stale = p.cameraStatus === 'active' && at > 0 && now - at > 2500;
  const cam = cameraState({ cameraStatus: p.cameraStatus, cameraBlocked: p.cameraBlocked, cameraLost: p.cameraLost, stale, s });
  const sittingMs = now - p.sittingStartedAt;
  const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

  // On a stimulus screen: the condition's own ink, no background. Elsewhere: a legible dark card.
  const ink = p.onStimulus && p.ink ? p.ink.ink : null;
  const fg = ink ?? '#ffffff';
  const card: React.CSSProperties = ink
    ? { background: 'transparent', color: ink, border: `1px solid ${ink}` }
    : { background: 'rgba(26,26,46,0.94)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 4px 16px rgba(0,0,0,.25)' };
  // A problem is always shown in colour, even in ink mode: it is the alert the researcher asked for.
  const dotColour = cam.level === 'ok' ? (ink ?? '#22c97a') : cam.level === 'off' ? (ink ?? '#9aa0b4') : cam.level === 'warn' ? '#e0a33c' : '#e5484d';

  const base: React.CSSProperties = {
    position: 'fixed', left: 10, bottom: 10, zIndex: 45,
    fontFamily: '"DM Mono", ui-monospace, monospace', borderRadius: 12,
    pointerEvents: p.locked ? 'none' : 'auto',
  };

  if (!shown) {
    return (
      <button
        type="button"
        data-testid="researcher-panel-collapsed"
        aria-label={`Researcher panel: ${cam.text}. Sitting time ${clock(sittingMs)}. Tap to open.`}
        onClick={() => setOpen(true)}
        style={{ ...base, ...card, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 15, cursor: 'pointer', minHeight: 40 }}
      >
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: dotColour, flex: '0 0 auto' }} />
        <span>{clock(sittingMs, !p.onStimulus)}</span>
        {cam.level === 'bad' && <span style={{ fontSize: 13 }}>{cam.text}</span>}
      </button>
    );
  }

  if (p.onReading) {
    // Two lines in the empty left of the reading footer, below the passage.
    return (
      <div data-testid="researcher-panel-strip" style={{ ...base, ...card, padding: '6px 12px', fontSize: 13, lineHeight: 1.45, maxWidth: 440, cursor: 'pointer' }}
        onClick={() => setOpen(false)} role="button" aria-label="Close researcher panel">
        <div>
          <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: dotColour, marginRight: 6 }} />
          {cam.text} · blinks {num(s?.blinks)} ({num(s?.incomplete)} inc) · {num(s?.fps)} fps
        </div>
        <div>sitting {clock(sittingMs, false)} · condition {p.conditionsDone ?? '—'}/{p.conditionsTotal ?? '—'} · ~{p.minutesLeft ?? '—'} min left</div>
      </div>
    );
  }

  const row = (k: string, v: React.ReactNode, testid?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }} data-testid={testid}>
      <span style={{ opacity: ink ? 1 : 0.78 }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
  return (
    <div data-testid="researcher-panel" style={{ ...base, ...card, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.5, width: 290 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 13, letterSpacing: 0.5 }}>RESEARCHER</strong>
        <button type="button" data-testid="researcher-panel-close" onClick={() => setOpen(false)}
          style={{ background: 'transparent', color: fg, border: `1px solid ${fg}`, borderRadius: 8, padding: '4px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          Hide
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: cam.level === 'ok' || cam.level === 'off' ? fg : dotColour }} data-testid="researcher-camera-state">
        <span style={{ width: 11, height: 11, borderRadius: '50%', background: dotColour }} />{cam.text}
      </div>
      <div style={{ marginTop: 6 }}>
        {row('Blinks (condition)', <>{num(s?.blinks)} <span style={{ opacity: 0.85 }}>· {num(s?.incomplete)} inc.</span></>)}
        {row('Blinks (sitting)', num(s?.sessionBlinks))}
        {row('Eye open', s?.earRatio != null ? `${Math.round(s.earRatio * 100)}% of baseline` : '—')}
        {row('Gaze', s?.gazeZone ? (s.gazeZone === 'cc' ? 'centre' : s.gazeZone) : '—')}
        {row('Frame rate', <span style={{ color: s?.fps != null && s.fps < p.fpsFloor && !ink ? '#ffd27a' : undefined }}>{num(s?.fps)} fps{s?.exposureFps != null ? ` · last ${num(s.exposureFps)}` : ''}</span>)}
        {row('Brightness', s?.luma != null ? `${s.luma}/255` : '—')}
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${ink ?? 'rgba(255,255,255,0.18)'}` }}>
        {row('This sitting', clock(sittingMs), 'researcher-clock')}
        {row('Since start', clock(p.sessionStartedAt != null ? now - p.sessionStartedAt : null))}
        {row('This screen', clock(now - p.stageStartedAt))}
        {row('Conditions', p.conditionsTotal != null ? `${p.conditionsDone ?? 0} of ${p.conditionsTotal}` : '—')}
        {row('Time left', p.minutesLeft != null ? `about ${p.minutesLeft} min` : '—')}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={keepOpen} onChange={(e) => { setKeepOpen(e.target.checked); writeKeepOpen(e.target.checked); }} style={{ width: 18, height: 18 }} />
        Keep open during tasks (recorded)
      </label>
    </div>
  );
}
