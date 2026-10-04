/**
 * How big things are on the glass: the ruler calibration, and the physical sizes derived from it.
 *
 * WHY THIS EXISTS. Every visual angle this study reports — the reading text's x-height, the go/no-go
 * dot's eccentricity — used to be computed from one constant, 0.2055 mm per CSS pixel: the study
 * tablet's panel (2880 px at 309 ppi, 236.7 mm across; manufacturer's figures) divided by 1152, the
 * width in CSS pixels it was ASSUMED to report, i.e. a device pixel ratio of 2.5. Nobody read the
 * pixel ratio off the tablet (Round 74), and a CSS pixel's size is exactly what the pixel ratio
 * decides: at 1.5 it is 0.123 mm, and every stimulus drawn at the capped scale of 1 was 40% smaller
 * than the documentation said, with the export printing the documented angles regardless.
 *
 * So the size is MEASURED. Pre-flight draws a bar CALIBRATION_BAR_DESIGN_PX long in design px; the
 * operator lays a ruler on it and types its length; with the scale it was drawn at, that gives the
 * millimetres per CSS pixel of this screen in this browser at this pixel ratio. Per condition, the
 * millimetres per design (layout) px are that times `stimulus_scale`, and every physical column in
 * the export follows from it and the tape-measured viewing distance.
 *
 * WHEN IT IS MISSING (skipped with an acknowledgement, or a sitting from before Round 74), the export
 * falls back to the study tablet's panel — the documented 236.7 mm across its long side — divided by
 * the long side of the screen the browser reported (`screen_resolution`), which is the documented
 * 0.2055 mm when that is 1152 and the right figure on the study tablet at any pixel ratio. Only where
 * no screen size was recorded does it fall back to the bare 0.2055 (pixel ratio 2.5 assumed). Every
 * physical column carries a source flag saying which of the three it used, and both fallbacks are
 * wrong on any other device.
 */

/** The bar pre-flight draws for the ruler check, in design px: about 103 mm on the study tablet. */
export const CALIBRATION_BAR_DESIGN_PX = 500;

/**
 * The study tablet's panel along its long side, in mm: 2880 px at 309 ppi (Xiaomi Pad 6, manufacturer's
 * specification, not measured here). The fallback when a sitting has no ruler measurement.
 */
export const STUDY_TABLET_PANEL_LONG_MM = (2880 / 309) * 25.4;

/** The figure every angle used to assume: the panel over 1152 CSS px, i.e. pixel ratio 2.5. */
export const DOCUMENTED_MM_PER_CSS_PX = 0.2055;

/**
 * Plausible millimetres per CSS pixel, for the sanity check on the operator's entry. A judgement, not a
 * standard: the study tablet runs from 0.082 mm at a pixel ratio of 1.0 to 0.247 mm at 3.0, and a
 * desktop monitor at 96 dpi is 0.265 mm. Outside this a reading is almost certainly a mistyped or
 * misread ruler (centimetres for millimetres, the wrong end of the bar).
 */
export const MM_PER_CSS_PX_RANGE = { min: 0.08, max: 0.4 } as const;

/** Viewing distance, eye to screen, in cm: the protocol's nominal 55, and the range the field accepts. */
export const VIEWING_DISTANCE_CM = { nominal: 55, min: 40, max: 80 } as const;

/**
 * Roboto's x-height as a fraction of the em: sxHeight 1082 / unitsPerEm 2048 in the OS/2 and head
 * tables of the vendored public/fonts/Roboto-400-normal-latin.woff2 (read from the file by
 * tests/physicalCalibration.test.ts, which fails if the font changes).
 */
export const ROBOTO_X_HEIGHT_EM = 1082 / 2048;

/** How a physical size was obtained. */
export type PhysicalSource =
  /** This sitting's ruler calibration. */
  | 'measured'
  /** No calibration: the study tablet's panel over the screen width the browser reported. */
  | 'assumed_study_tablet_panel'
  /** No calibration and no screen size recorded: the documented 0.2055 mm (pixel ratio 2.5). */
  | 'assumed_0.2055';

/** Millimetres per CSS px from a ruler reading of the bar drawn at `scale`. Null for nonsense input. */
export function mmPerCssPxFromBar(barMm: number, scale: number, barDesignPx = CALIBRATION_BAR_DESIGN_PX): number | null {
  if (!(Number.isFinite(barMm) && barMm > 0 && Number.isFinite(scale) && scale > 0 && barDesignPx > 0)) return null;
  return barMm / (barDesignPx * scale);
}

export function isPlausibleMmPerCssPx(v: number | null | undefined): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= MM_PER_CSS_PX_RANGE.min && v <= MM_PER_CSS_PX_RANGE.max;
}

export function isPlausibleViewingDistanceCm(v: number | null | undefined): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= VIEWING_DISTANCE_CM.min && v <= VIEWING_DISTANCE_CM.max;
}

/** The plausible range of the bar's length in mm at `scale`, for the operator's prompt. */
export function plausibleBarMm(scale: number, barDesignPx = CALIBRATION_BAR_DESIGN_PX): { min: number; max: number } {
  return { min: MM_PER_CSS_PX_RANGE.min * barDesignPx * scale, max: MM_PER_CSS_PX_RANGE.max * barDesignPx * scale };
}

/** The long side of a "WxH" string, or null. */
export function longSide(wxh: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*$/.exec(wxh ?? '');
  if (!m) return null;
  const v = Math.max(Number(m[1]), Number(m[2]));
  return v > 0 ? v : null;
}

/**
 * What the bar would measure on the study tablet's panel, given the screen the browser reports — a
 * cross-check shown beside the field, not a substitute for the ruler. Null where no screen size.
 */
export function studyTabletBarMm(scale: number, screenWxH: string | null, barDesignPx = CALIBRATION_BAR_DESIGN_PX): number | null {
  const long = longSide(screenWxH);
  if (long == null || !(scale > 0)) return null;
  return barDesignPx * scale * (STUDY_TABLET_PANEL_LONG_MM / long);
}

/** The sitting's calibration as the export needs it. */
export interface SessionPhysical {
  mm_per_css_px?: number | null;
  calibration_skipped?: boolean | null;
  viewing_distance_cm?: number | null;
  screen_resolution?: string | null;
  /** The pixel ratio pre-flight saw, where the calibration was taken. */
  device_pixel_ratio?: number | null;
}

/**
 * Millimetres per CSS px for a sitting, and where the figure came from: the measurement when there is
 * a plausible one, else the panel fallback, else the documented constant. An implausible measurement
 * is not used — the integrity audit reports it — and the fallback is flagged as such.
 *
 * `conditionDpr` is the pixel ratio a condition ran at. A CSS pixel is `ratio` device pixels, so if the
 * ratio changed after pre-flight (a display-size change before a resume), the CSS pixel changed size
 * in the same proportion and the figure is scaled by it — exactly, since the panel's pixels did not
 * change. Where either ratio is unknown, nothing is scaled; the integrity audit reports a change.
 */
export function sessionMmPerCssPx(s: SessionPhysical, conditionDpr?: number | null): { mm: number; source: PhysicalSource } {
  const ratio = (typeof conditionDpr === 'number' && conditionDpr > 0
    && typeof s.device_pixel_ratio === 'number' && s.device_pixel_ratio > 0)
    ? conditionDpr / s.device_pixel_ratio : 1;
  if (isPlausibleMmPerCssPx(s.mm_per_css_px)) return { mm: (s.mm_per_css_px as number) * ratio, source: 'measured' };
  const long = longSide(s.screen_resolution);
  if (long != null) return { mm: (STUDY_TABLET_PANEL_LONG_MM / long) * ratio, source: 'assumed_study_tablet_panel' };
  return { mm: DOCUMENTED_MM_PER_CSS_PX, source: 'assumed_0.2055' };
}

/** The recorded viewing distance in mm, or null — never the nominal 55 cm standing in for it. */
export function sessionViewingDistanceMm(s: SessionPhysical): number | null {
  return isPlausibleViewingDistanceCm(s.viewing_distance_cm) ? (s.viewing_distance_cm as number) * 10 : null;
}

const DEG = 180 / Math.PI;

/** Visual angle in degrees of an extent `mm` long, centred on the line of sight, at `distanceMm`. */
export function extentDeg(mm: number, distanceMm: number): number {
  return 2 * Math.atan(mm / (2 * distanceMm)) * DEG;
}

/** Angle in degrees from the line of sight of a point `mm` off it, at `distanceMm`. */
export function eccentricityDegAt(mm: number, distanceMm: number): number {
  return Math.atan(mm / distanceMm) * DEG;
}

/** The reading text's x-height in mm, at `fontPx` design px and `mmPerLayoutPx`. */
export function xHeightMm(fontPx: number, mmPerLayoutPx: number): number {
  return fontPx * ROBOTO_X_HEIGHT_EM * mmPerLayoutPx;
}

/**
 * The display scale an RT dot was drawn at: stored on the trial since Round 74; before that, recovered
 * from the angle those builds stored, atan(px x scale x 0.2055 / 550), which is exact. Null where the
 * row has no location (before Round 66) or neither field.
 */
export function trialOnsetScale(t: { stim_scale_at_onset?: number | null; stim_ecc_deg_55cm?: number | null; stim_ecc_px?: number | null }): number | null {
  if (typeof t.stim_scale_at_onset === 'number' && t.stim_scale_at_onset > 0) return t.stim_scale_at_onset;
  const deg = t.stim_ecc_deg_55cm;
  const px = t.stim_ecc_px;
  if (typeof deg !== 'number' || typeof px !== 'number' || !(px > 0)) return null;
  const scale = (Math.tan(deg / DEG) * 550) / (px * DOCUMENTED_MM_PER_CSS_PX);
  return Number.isFinite(scale) && scale > 0 ? Number(scale.toFixed(4)) : null;
}

/** Every physical figure the export prints for one condition, or nulls where it cannot say. */
export interface ConditionPhysical {
  mm_per_layout_px: number | null;
  reading_x_height_mm: number | null;
  reading_x_height_arcmin: number | null;
  physical_size_source: PhysicalSource | null;
}

/** The physical size of a condition's layout px and its reading text, from the sitting and the scale. */
export function conditionPhysical(
  s: SessionPhysical, stimulusScale: number | null | undefined, readingFontPx: number, conditionDpr?: number | null,
): ConditionPhysical {
  if (!(typeof stimulusScale === 'number' && stimulusScale > 0)) {
    return { mm_per_layout_px: null, reading_x_height_mm: null, reading_x_height_arcmin: null, physical_size_source: null };
  }
  const { mm, source } = sessionMmPerCssPx(s, conditionDpr);
  const perLayout = mm * stimulusScale;
  const xh = xHeightMm(readingFontPx, perLayout);
  const d = sessionViewingDistanceMm(s);
  return {
    mm_per_layout_px: perLayout,
    reading_x_height_mm: xh,
    reading_x_height_arcmin: d == null ? null : extentDeg(xh, d) * 60,
    physical_size_source: source,
  };
}

/** An RT dot's eccentricity in degrees at 55 cm and at the recorded distance, and the size's source. */
export function trialEccentricity(s: SessionPhysical, t: Parameters<typeof trialOnsetScale>[0], conditionDpr?: number | null): {
  deg55: number | null; degAtDistance: number | null; source: PhysicalSource | null; scale: number | null;
} {
  const scale = trialOnsetScale(t);
  const px = t.stim_ecc_px;
  if (scale == null || typeof px !== 'number') return { deg55: null, degAtDistance: null, source: null, scale };
  const { mm, source } = sessionMmPerCssPx(s, conditionDpr);
  const off = px * scale * mm;
  const d = sessionViewingDistanceMm(s);
  return {
    deg55: eccentricityDegAt(off, VIEWING_DISTANCE_CM.nominal * 10),
    degAtDistance: d == null ? null : eccentricityDegAt(off, d),
    source,
    scale,
  };
}
