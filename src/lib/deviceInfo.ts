/**
 * What this browser says about the screen it is drawing on — read back by the investigator.
 *
 * WHY. Rounds 63-66 built and measured every layout against a tablet viewport of 1152x720 CSS px
 * (device pixel ratio 2.5) that was ASSUMED and never read off the device. It was the wrong number,
 * or at least not the one the tablet reported: the investigator saw the tasks drawn in the middle of
 * the screen with a quarter of the width blank on each side. Nothing on any screen showed the
 * viewport, the pixel ratio or the scale, so the assumption could not be checked from the tablet
 * without developer tools. The pre-flight screen and the landing page now show all of it, and the
 * session records it (layout_viewport, screen_resolution, device_pixel_ratio, stimulus_scale).
 */
import {
  currentScale, displayMode, screenFill, screenFitScale, type DisplayMode,
} from './viewportScale';

export interface DeviceSnapshot {
  /** The visual viewport, "WxH" in CSS px: what the app is drawn into. */
  viewport: string;
  /** window.devicePixelRatio, or null where the browser does not report it. */
  devicePixelRatio: number | null;
  /** screen.width x screen.height, "WxH" in CSS px, or null. */
  screen: string | null;
  /** The display scale applied now (viewportScale.currentScale). */
  scale: number;
  /** The scale the whole screen would give, or null. */
  fullScreenScale: number | null;
  /** The applied scale as a fraction of the full screen's, or null. */
  fill: number | null;
  displayMode: DisplayMode | null;
}

const px = (n: number) => Math.round(n);

/** Read everything now. Pure apart from the reads; safe to call on every render. */
export function deviceSnapshot(): DeviceSnapshot {
  const w = typeof window !== 'undefined' ? window : null;
  const vv = w?.visualViewport;
  const vw = vv && vv.width > 0 ? vv.width : w?.innerWidth ?? 0;
  const vh = vv && vv.height > 0 ? vv.height : w?.innerHeight ?? 0;
  const dpr = w && Number.isFinite(w.devicePixelRatio) && w.devicePixelRatio > 0 ? w.devicePixelRatio : null;
  const scr = typeof screen !== 'undefined' && screen.width > 0 && screen.height > 0
    ? `${screen.width}x${screen.height}` : null;
  return {
    viewport: `${px(vw)}x${px(vh)}`,
    devicePixelRatio: dpr,
    screen: scr,
    scale: currentScale(),
    fullScreenScale: screenFitScale(),
    fill: screenFill(),
    displayMode: displayMode(),
  };
}
