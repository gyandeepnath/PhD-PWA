import { useEffect, useRef } from 'react';
import type { LiveTrackingStats } from '@/tracking/useTracking';
import { EAR_TIERS, FPS_RATIO_THRESHOLD } from '@/tracking/blink';
import { TRACKER_LABEL } from '@/tracking/trackers';
import { pipelineLimit } from '@/tracking/pipelineStats';

/**
 * The live camera picture and what the tracker makes of it — for the operator, on set-up screens only.
 *
 * WHY. The investigator asked to SEE the camera beside the live blink, face and gaze readout: the
 * numbers said "no face" or "18 fps" and nothing showed whether the participant had leaned out of
 * frame, the room had gone dim, or the eyes were in a spectacle reflection.
 *
 * THE SAME STREAM, NOT A SECOND CAMERA. The picture is a second <video> element on the tracker's own
 * MediaStream. A second getUserMedia call can fail or take the camera from the tracker on Android
 * tablets. Two elements on one stream share the camera's frames; the tracker still reads its own
 * hidden element, and nothing here touches it. The effect of the visible picture on the tracker's
 * throughput was measured (round 75, docs/AUDIT_FINDINGS.md).
 *
 * NEVER ON A CONDITION SCREEN. These components are mounted by the researcher CARD and the camera-setup
 * screen, which are only drawn on set-up and closing screens (ResearcherPanel.tsx). A participant who
 * can see their own face during reading, word search or the go/no-go task is no longer doing the task.
 *
 * The overlay and the trace redraw when the readout updates (LIVE_HZ, 4 times a second), not per
 * frame: drawing on every frame would take main-thread time from the tracker.
 */

/** The mirrored live picture with the face box and the six EAR points of each eye drawn over it. */
export function LiveFeed({ stream, stats, width, testid = 'live-feed' }: {
  stream: MediaStream | null;
  stats: LiveTrackingStats | null;
  width: number;
  testid?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const aspect = stats?.captureWidth && stats?.captureHeight ? stats.captureWidth / stats.captureHeight : 16 / 9;
  const height = Math.round(width / aspect);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.srcObject !== stream) {
      v.srcObject = stream;
      // play() returns a promise in browsers and nothing in some test environments.
      if (stream) Promise.resolve(v.play?.()).catch(() => { /* autoplay muted: retried on the next stream */ });
    }
  }, [stream]);
  // Detach on unmount only. The stream belongs to the tracker: stopping its tracks here would stop
  // the measurement.
  useEffect(() => () => { if (videoRef.current) videoRef.current.srcObject = null; }, []);

  useEffect(() => {
    const c = canvasRef.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!stats?.facePresent) return;
    // Landmarks are in the camera's own (unmirrored) coordinates; the picture is mirrored, so x flips.
    const X = (x: number) => (1 - x) * c.width;
    const Y = (y: number) => y * c.height;
    if (stats.faceBox) {
      const b = stats.faceBox;
      g.strokeStyle = 'rgba(34,201,122,0.9)';
      g.lineWidth = 2;
      g.strokeRect(X(b.x + b.w), Y(b.y), b.w * c.width, b.h * c.height);
    }
    if (stats.eyes) {
      // p1..p6 in EAR order: corner, two upper-lid points, corner, two lower-lid points.
      g.strokeStyle = '#ffd27a';
      g.fillStyle = '#ffd27a';
      g.lineWidth = 1.5;
      for (const eye of [stats.eyes.left, stats.eyes.right]) {
        if (eye.length < 6) continue;
        const order = [0, 1, 2, 3, 4, 5, 0];
        g.beginPath();
        order.forEach((k, i) => { const p = eye[k]; if (i === 0) g.moveTo(X(p.x), Y(p.y)); else g.lineTo(X(p.x), Y(p.y)); });
        g.stroke();
        for (const p of eye) { g.beginPath(); g.arc(X(p.x), Y(p.y), 1.6, 0, Math.PI * 2); g.fill(); }
      }
    }
  }, [stats, width, height]);

  return (
    <div data-testid={testid} style={{ position: 'relative', width, height, borderRadius: 8, overflow: 'hidden', background: '#000' }}>
      <video ref={videoRef} muted playsInline autoPlay data-testid={`${testid}-video`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
      <canvas ref={canvasRef} width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {!stream && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dbe6f7', fontSize: 14, textAlign: 'center', padding: 8 }}>
          Camera not running
        </div>
      )}
    </div>
  );
}

/**
 * The last ten seconds of eye openness, one point per processed frame, against the two cuts that define
 * the primary outcome: a blink registers below 0.75 of the participant's open-eye baseline, and counts
 * as complete below 0.60. Gaps are frames without a face. Before calibration there is no baseline and
 * so no cut lines — and no blink is being counted.
 */
export function EarTrace({ stats, width, height = 64, windowMs = 10_000 }: {
  stats: LiveTrackingStats | null;
  width: number;
  height?: number;
  windowMs?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, 0, c.width, c.height);
    const trace = stats?.earTrace ?? [];
    const base = stats?.baselineEar ?? null;
    const vals = trace.map(([, e]) => e).filter((e): e is number => e != null);
    const top = Math.max(base != null ? base * 1.3 : 0, vals.length ? Math.max(...vals) * 1.1 : 0, 0.05);
    const X = (dt: number) => c.width * (1 + dt / windowMs);
    const Y = (e: number) => c.height * (1 - e / top);
    if (base != null) {
      for (const [frac, colour] of [[EAR_TIERS.partial, '#ffd27a'], [EAR_TIERS.full, '#ff8f8a']] as const) {
        g.strokeStyle = colour;
        g.setLineDash([4, 3]);
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, Y(base * frac)); g.lineTo(c.width, Y(base * frac)); g.stroke();
      }
      g.setLineDash([]);
    }
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.4;
    g.beginPath();
    let pen = false;
    for (const [dt, e] of trace) {
      if (e == null || dt < -windowMs) { pen = false; continue; }
      if (!pen) { g.moveTo(X(dt), Y(e)); pen = true; } else g.lineTo(X(dt), Y(e));
    }
    g.stroke();
  }, [stats, width, height, windowMs]);
  return (
    <div>
      <canvas ref={ref} width={width} height={height} data-testid="ear-trace" style={{ display: 'block', width, height, borderRadius: 6 }} />
      <div style={{ fontSize: 14, display: 'flex', flexWrap: 'wrap', columnGap: 10, marginTop: 2, color: '#dbe6f7' }}>
        <span>eye openness, last {Math.round(windowMs / 1000)} s</span>
        {stats?.baselineEar != null
          ? (<><span style={{ color: '#ffd27a' }}>— 0.75 blink</span><span style={{ color: '#ff8f8a' }}>— 0.60 complete</span></>)
          : <span>no baseline yet: no blink lines</span>}
      </div>
    </div>
  );
}

const r0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)));

/**
 * The pipeline in three numbers and a sentence: what the camera delivers, what the tracker processes,
 * in how many frames it finds the face — and which of the three is short of `floor`.
 */
export function PipelineReadout({ stats, floor, compact = false }: {
  stats: LiveTrackingStats | null;
  floor: number;
  compact?: boolean;
}) {
  const s = stats;
  const limit = s ? pipelineLimit({ cameraFps: s.cameraFps, trackerFps: s.trackerFps, faceFps: s.faceFps, deliveredSource: s.frameCountSource }, floor) : null;
  /*
   * Met `floor` (the camera check's 25) but not FPS_RATIO_THRESHOLD (30), below which every reading
   * row's incomplete-blink ratio is flagged fps_adequate_for_ratio = false. This used to say "enough"
   * here, which a 27 fps reading was not for the primary outcome. A 30 fps camera can rarely clear 30
   * face frames a second (round 74, R1 D1), so on the tablet this line will often say so; the gate is
   * a protocol decision, not something this screen may lower.
   */
  const ratioShort = s?.faceFps != null && s.faceFps >= floor && s.faceFps < FPS_RATIO_THRESHOLD;
  const verdict = !s ? '—'
    : limit == null ? (s.faceFps == null ? '—'
      : ratioShort ? `face found ${s.faceFps.toFixed(1)} times a second: at least ${floor}, but below the ${FPS_RATIO_THRESHOLD} the incomplete-blink ratio is flagged under`
        : `face found ${r0(s.faceFps)} times a second: at or above ${Math.max(floor, FPS_RATIO_THRESHOLD)}`)
      : limit === 'camera' ? `the CAMERA is the limit: it delivers ${r0(s.cameraFps)} frames a second (below ${floor}) — more light on the face`
        : limit === 'camera_and_tracker' ? `the camera AND the tracker are short: ${r0(s.cameraFps)} delivered, ${r0(s.trackerFps)} processed at ${r0(s.processMsP50)} ms — close other apps, charge the tablet, and more light`
        : limit === 'tracker' ? `the TRACKER is the limit: ${r0(s.processMsP50)} ms a frame — close other apps, charge the tablet`
          : limit === 'undetermined' ? `below ${floor} a second; this browser does not say whether the camera or the tracker is short`
            : `the face is found in only ${r0(s.faceFps)} frames a second — seating, framing, light`;
  const row = (k: string, v: React.ReactNode, testid?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }} data-testid={testid}>
      <span style={{ opacity: 0.78 }}>{k}</span><span style={{ textAlign: 'right' }}>{v}</span>
    </div>
  );
  return (
    <div data-testid="pipeline-readout" style={{ fontSize: compact ? 14 : 15, lineHeight: 1.45 }}>
      {row('Camera delivers', <>{r0(s?.cameraFps)} fps{s?.captureWidth ? ` · ${s.captureWidth}×${s.captureHeight}` : ''}</>, 'diag-camera')}
      {row('Tracker processes', <>{r0(s?.trackerFps)} fps · {r0(s?.processMsP50)} ms{!compact && <> (95%: {r0(s?.processMsP95)} ms)</>}</>, 'diag-tracker')}
      {row('Face found', <span style={{ color: s?.faceFps != null && s.faceFps < floor ? '#ffd27a' : undefined }}>{r0(s?.faceFps)} fps</span>, 'diag-face')}
      {!compact && row('Face width', s?.faceWidthPx != null ? `${s.faceWidthPx} px of the camera picture` : '—', 'diag-face-width')}
      {row('Tracker', s?.backend ? TRACKER_LABEL[s.backend] : '—', 'diag-backend')}
      <div data-testid="diag-verdict" style={{ marginTop: 4, fontSize: 14, color: limit || ratioShort ? '#ffd27a' : '#bfe8cf' }}>{verdict}</div>
    </div>
  );
}
