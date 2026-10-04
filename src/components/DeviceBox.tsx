/**
 * "This device": the viewport, pixel ratio, screen, scale and display mode this browser reports, the
 * physical size of its CSS pixel once the ruler check has measured it, and the build.
 *
 * Shown in full on the pre-flight screen and as one line on the landing page, so the investigator can
 * read the numbers back from the tablet itself. See lib/deviceInfo.ts for why: the viewport every
 * layout was measured against from Round 63 to Round 73 was assumed, and nothing on screen could show
 * that it was not the tablet's.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { deviceSnapshot, type DeviceSnapshot } from '@/lib/deviceInfo';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '@/lib/viewportScale';

/** The snapshot, re-read on resize and orientation change (the scale settles a frame later). */
export function useDeviceSnapshot(): DeviceSnapshot {
  const [snap, setSnap] = useState(deviceSnapshot);
  useEffect(() => {
    const later = () => { window.setTimeout(() => setSnap(deviceSnapshot()), 120); };
    const first = window.setTimeout(() => setSnap(deviceSnapshot()), 400);
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
      window.removeEventListener('orientationchange', later);
    };
  }, []);
  return snap;
}

const times = (wxh: string) => wxh.replace('x', ' × ');

function fillText(s: DeviceSnapshot): string {
  if (s.fill == null) return 'screen size not reported';
  if (s.fill === 1) return 'fills the screen';
  return `${Math.round(s.fill * 100)}% of full-screen size`;
}

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '3px 0' }}>
      <span className="font-sans text-[15px]" style={{ color: '#4a4a60', flex: '0 0 150px' }}>{label}</span>
      <span data-testid={testId} className="font-sans text-[15px]" style={{ color: '#1a1a2e' }}>{children}</span>
    </div>
  );
}

export function DeviceBox({ compact = false, mmPerCssPx = null, children }: {
  compact?: boolean;
  /** This screen's measured millimetres per CSS px (lib/physicalCalibration.ts), or null. */
  mmPerCssPx?: number | null;
  /** Extra rows, e.g. the build line on pre-flight. */
  children?: ReactNode;
}) {
  const s = useDeviceSnapshot();
  const dpr = s.devicePixelRatio == null ? 'not reported' : s.devicePixelRatio.toFixed(2);
  if (compact) {
    return (
      <p data-testid="device-line" className="font-sans text-[15px]" style={{ color: '#4a4a60' }}>
        This device: viewport {times(s.viewport)} CSS px · pixel ratio {dpr}
        {' '}· screen {s.screen ? times(s.screen) : 'not reported'} · layout ×{s.scale.toFixed(2)} ({fillText(s)})
        {' '}· display {s.displayMode ?? 'not reported'}
      </p>
    );
  }
  return (
    <div data-testid="device-box"
      style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid #d8d4cc', background: '#fff' }}>
      <p className="font-sans text-sm font-medium uppercase tracking-wide" style={{ color: '#4a4a60', marginBottom: 6 }}>
        This device
      </p>
      <Row label="Viewport" testId="device-viewport">{times(s.viewport)} CSS px</Row>
      <Row label="Pixel ratio" testId="device-dpr">
        {dpr}
        {s.devicePixelRatio != null && s.screen && (() => {
          const [w, h] = s.screen.split('x').map(Number);
          return ` (screen ${Math.round(w * s.devicePixelRatio)} × ${Math.round(h * s.devicePixelRatio)} device px)`;
        })()}
      </Row>
      <Row label="Screen" testId="device-screen">{s.screen ? `${times(s.screen)} CSS px` : 'not reported'}</Row>
      <Row label="Layout scale" testId="device-scale">
        ×{s.scale.toFixed(2)} — the {DESIGN_WIDTH} × {DESIGN_HEIGHT} layout {fillText(s)}
        {s.fullScreenScale != null && s.fill !== 1 ? ` (full screen: ×${s.fullScreenScale.toFixed(2)})` : ''}
      </Row>
      <Row label="Display mode" testId="device-mode">{s.displayMode ?? 'not reported'}</Row>
      <Row label="Physical size" testId="device-mm">
        {mmPerCssPx == null
          ? 'not measured yet — measure the bar below with a ruler'
          : `${mmPerCssPx.toFixed(4)} mm per CSS px, so ${(mmPerCssPx * s.scale).toFixed(4)} mm per layout px (measured)`}
      </Row>
      {children}
    </div>
  );
}
