import { useEffect, useRef, useState } from 'react';
import { now } from '@/lib/timing';
import { isE2ETimingActive } from '@/experiment/config';
import { SELF_TEST, scoreSelfTest, type SelfTestResult } from '@/tracking/selfTest';

/**
 * "Blink each time the dot flashes" — the camera self-test, run after calibration. See
 * tracking/selfTest.ts for why it exists and what a pass does and does not mean.
 *
 * Shown on the same dark ground as the calibration routine it follows, so it is part of setup rather
 * than of any condition. The result is stated in plain words with the reasons, and the operator
 * chooses: continue, try again, or continue anyway — the result is recorded in every case.
 */
export function CameraSelfTest({ begin, end, onDone }: {
  begin: () => void;
  end: () => { blinkOnsets: number[]; fps: number | null; facePresence: number | null };
  onDone: (result: SelfTestResult) => void;
}) {
  const [phase, setPhase] = useState<'intro' | 'running' | 'result'>('intro');
  const [flash, setFlash] = useState(false);
  const [cueCount, setCueCount] = useState(0);
  const [result, setResult] = useState<SelfTestResult | null>(null);
  const cues = useRef<number[]>([]);

  // Collapsed timings under the test harness, like every other protocol duration.
  const fast = isE2ETimingActive();
  const first = fast ? 150 : SELF_TEST.FIRST_CUE_MS;
  const every = fast ? 150 : SELF_TEST.CUE_EVERY_MS;

  useEffect(() => {
    if (phase !== 'running') return;
    cues.current = [];
    begin();
    const t0 = now();
    let raf = 0;
    let shown = -1;
    const tick = () => {
      const el = now() - t0;
      const k = Math.floor((el - first) / every);
      if (el >= first && k < SELF_TEST.CUES && k > shown) {
        shown = k;
        cues.current.push(now());
        setCueCount(k + 1);
        setFlash(true);
        window.setTimeout(() => setFlash(false), 350);
      }
      if (el >= first + SELF_TEST.CUES * every + (fast ? 150 : 1500)) {
        const seen = end();
        setResult(scoreSelfTest(cues.current, seen.blinkOnsets, seen));
        setPhase('result');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const shell: React.CSSProperties = {
    position: 'fixed', inset: 0, background: '#1a1a2e', color: '#fff', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32,
  };
  const btn: React.CSSProperties = { padding: '14px 26px', borderRadius: 12, fontSize: 16, cursor: 'pointer', fontFamily: '"DM Mono", monospace' };

  if (phase === 'intro') {
    return (
      <div style={shell} data-testid="camera-selftest">
        <h1 className="font-serif" style={{ fontSize: 34, fontWeight: 300 }}>Quick camera check</h1>
        <p className="font-lab" style={{ fontSize: 17, color: '#dbe6f7', maxWidth: 560, marginTop: 14, lineHeight: 1.6 }}>
          Look at the dot in the middle of the screen. Each time it flashes, blink once — a normal,
          firm blink. It flashes {SELF_TEST.CUES} times and takes about {Math.round((SELF_TEST.FIRST_CUE_MS + SELF_TEST.CUES * SELF_TEST.CUE_EVERY_MS) / 1000)} seconds.
        </p>
        <button type="button" data-testid="selftest-start" onClick={() => setPhase('running')}
          style={{ ...btn, marginTop: 26, background: '#fff', color: '#1a1a2e', border: 'none' }}>
          Start →
        </button>
      </div>
    );
  }

  if (phase === 'running') {
    return (
      <div style={shell} data-testid="camera-selftest">
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: flash ? '#ffffff' : '#5b6480', transform: flash ? 'scale(1.5)' : 'scale(1)', transition: 'transform 80ms, background 80ms' }} />
        <p className="font-lab" style={{ fontSize: 16, color: '#dbe6f7', marginTop: 26 }}>
          Blink when the dot flashes · {cueCount} of {SELF_TEST.CUES}
        </p>
      </div>
    );
  }

  const r = result!;
  return (
    <div style={shell} data-testid="camera-selftest">
      <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 300 }} data-testid="selftest-verdict">
        {r.pass ? 'The camera is working' : 'The camera check did not pass'}
      </h1>
      <p className="font-lab" style={{ fontSize: 17, color: '#dbe6f7', marginTop: 14 }}>
        Saw {r.detected} of {r.cued} blinks · {r.fps == null ? '—' : Math.round(r.fps)} frames per second ·
        face in view {r.facePresence == null ? '—' : Math.round(r.facePresence * 100)}% of the time
      </p>
      {!r.pass && (
        <ul className="font-lab" style={{ fontSize: 15, color: '#ffd9d6', maxWidth: 620, marginTop: 12, textAlign: 'left', lineHeight: 1.6 }}>
          {r.reasons.map((x) => <li key={x}>• {x}</li>)}
        </ul>
      )}
      <p className="font-lab" style={{ fontSize: 13, color: '#aab6d0', maxWidth: 560, marginTop: 10, lineHeight: 1.6 }}>
        Researcher: this checks the camera sees this person&apos;s blinks. It is recorded with the session.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap', justifyContent: 'center' }}>
        {r.pass ? (
          <button type="button" data-testid="selftest-continue" onClick={() => onDone(r)} style={{ ...btn, background: '#fff', color: '#1a1a2e', border: 'none' }}>
            Continue →
          </button>
        ) : (
          <>
            <button type="button" data-testid="selftest-retry" onClick={() => { setResult(null); setCueCount(0); setPhase('running'); }}
              style={{ ...btn, background: '#fff', color: '#1a1a2e', border: 'none' }}>
              Try again
            </button>
            <button type="button" data-testid="selftest-continue-anyway" onClick={() => onDone(r)}
              style={{ ...btn, background: 'transparent', color: '#dbe6f7', border: '1px solid #dbe6f7' }}>
              Continue anyway
            </button>
          </>
        )}
      </div>
    </div>
  );
}
