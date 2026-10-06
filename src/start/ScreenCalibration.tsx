/**
 * Pre-flight's ruler check: how large this screen's pixels are, and how far away the eye is.
 *
 * WHY. Every visual angle the study reports was computed from 0.2055 mm per CSS pixel, a figure that
 * assumed the study tablet reports 1152 CSS px across (pixel ratio 2.5). That was never read off the
 * device, and on the tablet the layout sat in the middle of a wider viewport (Round 74). The layout now
 * fills the screen, and the physical size is MEASURED here instead of assumed: a bar of fixed design
 * length, a ruler, a number. With the tape-measured viewing distance it turns every stimulus size in
 * the export into millimetres and minutes of arc (lib/physicalCalibration.ts).
 *
 * Skipping is allowed — a missing ruler must not cost a participant who is sitting in the chair — but
 * only with a written acknowledgement, recorded on the session (calibration_skipped), and the export
 * then flags every physical column as assumed. The same rule pre-flight applies to the display mode.
 */
import { useEffect, useState } from 'react';
import {
  CALIBRATION_BAR_DESIGN_PX, VIEWING_DISTANCE_CM, ROBOTO_X_HEIGHT_EM, isPlausibleMmPerCssPx,
  isPlausibleViewingDistanceCm, mmPerCssPxFromBar, plausibleBarMm, studyTabletBarMm, extentDeg,
} from '@/lib/physicalCalibration';
import { CONFIG } from '@/experiment/config';
import { UI_TEXT } from '@/lib/uiPalette';

export interface ScreenCalibrationResult {
  /** True when Continue may be given: a plausible measurement, or the skip acknowledged; and a distance. */
  ok: boolean;
  /** The accepted measurement, or null when skipped or not (yet) plausible. */
  calibration: { barDesignPx: number; barMm: number; scale: number; mmPerCssPx: number } | null;
  /** The skip was acknowledged AND no plausible measurement was given. */
  skipped: boolean;
  viewingDistanceCm: number | null;
}

/** Parse a typed number, accepting a decimal comma. */
function parseNum(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** The setup screens' input look (setupStages VL_INPUT_CSS), inline: pre-flight has no form styles. */
const INPUT_STYLE = {
  display: 'block', width: '100%', marginTop: 6, padding: '12px 14px', border: '1px solid #bdb8ae', borderRadius: 10,
  fontFamily: "'DM Mono', monospace", fontSize: 17, background: '#fff', color: '#1a1a2e',
} as const;

export function ScreenCalibration({ scale, screen, onChange }: {
  /** The display scale applied now: the bar is drawn at it. */
  scale: number;
  /** screen.width x screen.height, "WxH", for the study-tablet cross-check; null if not reported. */
  screen: string | null;
  onChange: (r: ScreenCalibrationResult) => void;
}) {
  const [barText, setBarText] = useState('');
  const [scaleAtEntry, setScaleAtEntry] = useState(scale);
  /*
   * Empty, not the nominal 55. A prefilled field let an operator who never took the tape out press
   * Continue and have 55 saved as the participant's MEASURED distance, indistinguishable in the record
   * and the export from a real reading — the very substitution sessionViewingDistanceMm promises never
   * to make. A distance has to be typed to be recorded.
   */
  const [distText, setDistText] = useState('');
  const [skipAck, setSkipAck] = useState(false);

  const barMm = parseNum(barText);
  // A reading taken at one scale says nothing about the bar once it is redrawn at another.
  const stale = barText.trim() !== '' && Math.abs(scaleAtEntry - scale) > 1e-9;
  const mm = barMm == null || stale ? null : mmPerCssPxFromBar(barMm, scaleAtEntry);
  const plausible = isPlausibleMmPerCssPx(mm);
  const distance = parseNum(distText);
  const distanceOk = isPlausibleViewingDistanceCm(distance);
  const range = plausibleBarMm(scale);
  const tablet = studyTabletBarMm(scale, screen);
  const offTablet = plausible && tablet != null && barMm != null ? barMm / tablet - 1 : null;
  const skipped = !plausible && skipAck;
  const ok = distanceOk && (plausible || skipAck);

  useEffect(() => {
    onChange({
      ok,
      calibration: plausible && barMm != null && mm != null
        ? { barDesignPx: CALIBRATION_BAR_DESIGN_PX, barMm, scale: scaleAtEntry, mmPerCssPx: mm }
        : null,
      skipped,
      viewingDistanceCm: distanceOk ? distance : null,
    });
    // onChange is the parent's setter; the result is a function of the values listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, plausible, barMm, mm, scaleAtEntry, skipped, distanceOk, distance]);

  const boxText = 'font-sans text-[15px] leading-relaxed text-[#3a3a4a]';
  const xh = mm != null && plausible ? CONFIG.READING_FONT_SIZE_PX * ROBOTO_X_HEIGHT_EM * mm * scale : null;
  const warn = '#c98a22';
  const border = ok ? '#d8d4cc' : warn;
  return (
    <div data-testid="calibration-box"
      style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, border: `1px solid ${border}`, background: ok ? '#fff' : `${warn}12` }}>
      <p className="font-sans text-sm font-medium uppercase tracking-wide" style={{ color: ok ? '#4a4a60' : UI_TEXT.amber }}>
        Screen size — measure the bar with a ruler
      </p>
      <p className={boxText} style={{ marginTop: 6 }}>
        Lay a ruler along the black bar with its <strong>zero exactly at the bar&apos;s left end</strong>, read
        where the bar ends, and type that length in <strong>millimetres</strong> (to the nearest half
        millimetre). This is what turns every stimulus size in the export into millimetres and degrees,
        so measure it on the screen the participant will use, as it will be used.
      </p>
      {/* Exactly CALIBRATION_BAR_DESIGN_PX design px from edge to edge; drawn at the applied scale. */}
      {/* Never clipped: a bar whose end is hidden would be measured short. */}
      <div style={{ margin: '14px 0 6px', padding: '10px 0' }}>
        <div data-testid="calibration-bar"
          style={{ width: CALIBRATION_BAR_DESIGN_PX, height: 14, background: '#000', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, top: -8, width: 2, height: 30, background: '#000' }} />
          <span style={{ position: 'absolute', right: 0, top: -8, width: 2, height: 30, background: '#000' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 8 }}>
        <label style={{ display: 'block', flex: '1 1 260px' }}>
          <span className="font-sans text-[15px] font-medium text-[#3a3a4a]" style={{ display: 'block' }}>Bar length (mm)</span>
          <input data-testid="calibration-bar-mm" inputMode="decimal" value={barText}
            placeholder="e.g. 102.5"
            onChange={(e) => { setBarText(e.target.value); setScaleAtEntry(scale); }}
            style={INPUT_STYLE} />
          <span className={boxText} style={{ display: 'block', marginTop: 4 }}>
            Accepted: {range.min.toFixed(0)}–{range.max.toFixed(0)} mm.
            {tablet != null && ` On the study tablet at this screen size it should be about ${tablet.toFixed(1)} mm.`}
          </span>
        </label>
        <label style={{ display: 'block', flex: '1 1 260px' }}>
          <span className="font-sans text-[15px] font-medium text-[#3a3a4a]" style={{ display: 'block' }}>Viewing distance, eye to screen (cm)</span>
          <input data-testid="viewing-distance" inputMode="decimal" value={distText}
            placeholder={`e.g. ${VIEWING_DISTANCE_CM.nominal}`}
            onChange={(e) => setDistText(e.target.value)} style={INPUT_STYLE} />
          <span className={boxText}
            style={{ display: 'block', marginTop: 4, color: distanceOk || distText.trim() === '' ? undefined : '#8a1c14' }}>
            Tape-measure from the participant&apos;s eye to the centre of the screen, seated as they will
            read. {VIEWING_DISTANCE_CM.min}–{VIEWING_DISTANCE_CM.max} cm; the protocol&apos;s nominal
            distance is {VIEWING_DISTANCE_CM.nominal}, but type what you measure.
          </span>
        </label>
      </div>
      {stale && (
        <p data-testid="calibration-stale" className={boxText} style={{ marginTop: 8, color: '#8a1c14' }}>
          The display size changed after this was measured, so the bar is now drawn at a different length.
          Measure it again and re-type the length.
        </p>
      )}
      {!stale && barMm != null && !plausible && (
        <p data-testid="calibration-range-error" className={boxText} style={{ marginTop: 8, color: '#8a1c14' }}>
          {barMm} mm is outside the accepted range. Check that the ruler reads millimetres (not
          centimetres) and that its zero is at the bar&apos;s left end, then measure again.
        </p>
      )}
      {plausible && mm != null && (
        <p data-testid="calibration-result" className={boxText} style={{ marginTop: 8 }}>
          <strong>Measured:</strong> {mm.toFixed(4)} mm per CSS pixel, {(mm * scale).toFixed(4)} mm per layout
          pixel. The reading text&apos;s x-height is {xh!.toFixed(2)} mm
          {distanceOk && distance != null && `, ${(extentDeg(xh!, distance * 10) * 60).toFixed(1)}′ of arc at ${distance} cm`}.
        </p>
      )}
      {offTablet != null && Math.abs(offTablet) > 0.1 && (
        <p data-testid="calibration-panel-note" className={boxText} style={{ marginTop: 6, color: UI_TEXT.amber }}>
          That is {Math.round(Math.abs(offTablet) * 100)}% {offTablet > 0 ? 'longer' : 'shorter'} than the study
          tablet&apos;s screen would measure ({tablet!.toFixed(1)} mm). Measure again; if it is right, this is
          not the study tablet, and the sitting will record it as measured.
        </p>
      )}
      {!plausible && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 10, cursor: 'pointer' }}>
          <input type="checkbox" data-testid="calibration-skip-ack" checked={skipAck}
            onChange={(e) => setSkipAck(e.target.checked)} style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2 }} />
          <span className="font-sans text-base text-[#1a1a2e]">
            No ruler: run without the measurement. I understand this is recorded as a deviation, and that
            every physical size in this sitting&apos;s export will be marked as assumed, not measured.
          </span>
        </label>
      )}
    </div>
  );
}
