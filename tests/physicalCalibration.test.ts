/**
 * The physical size of the stimulus is measured, and every angle in the export is computed from it.
 *
 * Rounds 63-73 printed visual angles from an ASSUMED 0.2055 mm per CSS pixel — the study tablet at a
 * device pixel ratio of 2.5, never read off the device — while the tablet in fact drew the layout in
 * the middle of a wider viewport (Round 74). Pre-flight now has the operator measure a 500 design-px
 * bar with a ruler; these tests hold the arithmetic, the fallbacks and their flags, the recomputation
 * of older rows, the export columns and the integrity report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import {
  CALIBRATION_BAR_DESIGN_PX, STUDY_TABLET_PANEL_LONG_MM, DOCUMENTED_MM_PER_CSS_PX, ROBOTO_X_HEIGHT_EM,
  mmPerCssPxFromBar, isPlausibleMmPerCssPx, sessionMmPerCssPx, sessionViewingDistanceMm, trialOnsetScale,
  conditionPhysical, trialEccentricity, studyTabletBarMm, plausibleBarMm, longSide,
} from '@/lib/physicalCalibration';
import { computeScale } from '@/lib/viewportScale';
import { CONFIG } from '@/experiment/config';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildExportFiles } from '@/storage/export';
import { auditBundle } from '@/storage/integrity';
import { splitCsvRow } from './helpers/csv';

/** sxHeight and unitsPerEm from a WOFF2 file's OS/2 and head tables (neither is transformed in WOFF2). */
function woff2XHeight(path: string): { sxHeight: number; unitsPerEm: number } {
  const buf = readFileSync(path);
  expect(buf.readUInt32BE(0)).toBe(0x774f4632); // 'wOF2'
  const numTables = buf.readUInt16BE(12);
  const totalCompressed = buf.readUInt32BE(20);
  let p = 48;
  const b128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[p++]; v = (v * 128) + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error('UIntBase128'); };
  const KNOWN: Record<number, string> = { 1: 'head', 6: 'OS/2', 10: 'glyf', 11: 'loca' };
  const tables: { tag: string; len: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p++];
    let tag = KNOWN[flags & 0x3f] ?? `#${flags & 0x3f}`;
    if ((flags & 0x3f) === 63) { tag = buf.toString('latin1', p, p + 4); p += 4; }
    const xform = (flags >> 6) & 3;
    const orig = b128();
    const transformed = (tag === 'glyf' || tag === 'loca') ? xform === 0 : xform !== 0;
    tables.push({ tag, len: transformed ? b128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(p, p + totalCompressed));
  let off = 0;
  const at: Record<string, Buffer> = {};
  for (const t of tables) { at[t.tag] = data.subarray(off, off + t.len); off += t.len; }
  return { unitsPerEm: at.head.readUInt16BE(18), sxHeight: at['OS/2'].readInt16BE(86) };
}

describe('the constants are what the files and the manufacturer say', () => {
  it("Roboto's x-height is read from the vendored font, not remembered", () => {
    for (const f of ['Roboto-400-normal-latin.woff2', 'Roboto-400-normal-latin-ext.woff2']) {
      const { sxHeight, unitsPerEm } = woff2XHeight(resolve(__dirname, '..', 'public/fonts', f));
      expect(sxHeight / unitsPerEm, f).toBe(ROBOTO_X_HEIGHT_EM);
    }
  });

  it('the panel is 2880 px at 309 ppi, and 0.2055 mm is that over 1152 — pixel ratio 2.5', () => {
    expect(STUDY_TABLET_PANEL_LONG_MM).toBeCloseTo(236.74, 2);
    expect(STUDY_TABLET_PANEL_LONG_MM / 1152).toBeCloseTo(DOCUMENTED_MM_PER_CSS_PX, 4);
    expect(CALIBRATION_BAR_DESIGN_PX).toBe(500);
  });
});

describe('the measurement', () => {
  it('is the bar length over the bar as drawn, in CSS px', () => {
    // 500 design px at scale 1.66 is 830 CSS px; a ruler reading of 102.3 mm gives 0.1233 mm each.
    expect(mmPerCssPxFromBar(102.3, 1.66)).toBeCloseTo(102.3 / 830, 9);
    expect(mmPerCssPxFromBar(0, 1)).toBeNull();
    expect(mmPerCssPxFromBar(100, 0)).toBeNull();
    expect(mmPerCssPxFromBar(NaN, 1)).toBeNull();
  });

  it('rejects a misread ruler: centimetres for millimetres, or the wrong end', () => {
    expect(isPlausibleMmPerCssPx(mmPerCssPxFromBar(102.75, 1))).toBe(true);
    expect(isPlausibleMmPerCssPx(mmPerCssPxFromBar(10.3, 1))).toBe(false);   // cm typed as mm
    expect(isPlausibleMmPerCssPx(mmPerCssPxFromBar(1027, 1))).toBe(false);
    const r = plausibleBarMm(1);
    expect(r.min).toBeCloseTo(40, 6);
    expect(r.max).toBeCloseTo(200, 6);
  });

  it('on the study tablet the bar reads about 103 mm in the installed app at ANY pixel ratio', () => {
    // The point of fitting the canvas to the screen: the stimulus is the same size on the glass
    // whatever CSS pixel size the browser picked.
    for (const dpr of [1.25, 1.5, 2, 2.5, 3]) {
      const w = 2880 / dpr;
      const scale = computeScale(w, 1800 / dpr);
      expect(studyTabletBarMm(scale, `${w}x${1800 / dpr}`)!, `dpr ${dpr}`).toBeGreaterThan(100.6);
      expect(studyTabletBarMm(scale, `${w}x${1800 / dpr}`)!, `dpr ${dpr}`).toBeLessThan(104.9);
    }
    expect(longSide('720x1152')).toBe(1152);
    expect(longSide('garbage')).toBeNull();
  });
});

describe('the fallbacks, and the flag that says which was used', () => {
  it('uses the measurement when there is a plausible one', () => {
    expect(sessionMmPerCssPx({ mm_per_css_px: 0.1233, screen_resolution: '1920x1200' }))
      .toEqual({ mm: 0.1233, source: 'measured' });
  });

  it('falls back to the panel over the REPORTED screen width, which is 0.2055 only at 1152', () => {
    const at1920 = sessionMmPerCssPx({ calibration_skipped: true, screen_resolution: '1920x1200' });
    expect(at1920.source).toBe('assumed_study_tablet_panel');
    expect(at1920.mm).toBeCloseTo(0.1233, 4);
    expect(sessionMmPerCssPx({ screen_resolution: '1152x720' }).mm).toBeCloseTo(0.2055, 4);
    // An implausible measurement is not used.
    expect(sessionMmPerCssPx({ mm_per_css_px: 2.055, screen_resolution: '1152x720' }).source).toBe('assumed_study_tablet_panel');
  });

  it('uses the bare documented figure only when nothing else was recorded, and says so', () => {
    expect(sessionMmPerCssPx({})).toEqual({ mm: DOCUMENTED_MM_PER_CSS_PX, source: 'assumed_0.2055' });
  });

  it('never stands the nominal 55 cm in for a distance that was not recorded', () => {
    expect(sessionViewingDistanceMm({ viewing_distance_cm: 58 })).toBe(580);
    expect(sessionViewingDistanceMm({})).toBeNull();
    expect(sessionViewingDistanceMm({ viewing_distance_cm: 5.8 })).toBeNull();
  });
});

describe('physical sizes per condition and per trial', () => {
  const tablet = { mm_per_css_px: 0.2055, viewing_distance_cm: 55, screen_resolution: '1152x720' };

  it("the protocol's reading text on the study tablet: x-height 2.39 mm, 14.9 arcmin at 55 cm", () => {
    const p = conditionPhysical(tablet, 1, CONFIG.READING_FONT_SIZE_PX);
    expect(p.mm_per_layout_px).toBeCloseTo(0.2055, 6);
    expect(p.reading_x_height_mm!).toBeCloseTo(2.389, 3);
    expect(p.reading_x_height_arcmin!).toBeCloseTo(14.93, 2);
    expect(p.physical_size_source).toBe('measured');
    // The same glass at pixel ratio 1.5 and scale 1.66: the same size within a step.
    const dpr15 = conditionPhysical({ ...tablet, mm_per_css_px: STUDY_TABLET_PANEL_LONG_MM / 1920, screen_resolution: '1920x1200' }, 1.66, 22);
    expect(Math.abs(dpr15.reading_x_height_arcmin! - 14.93)).toBeLessThan(0.2);
  });

  it('is blank, not invented, where the condition has no scale or the sitting no distance', () => {
    expect(conditionPhysical(tablet, undefined, 22)).toEqual({ mm_per_layout_px: null, reading_x_height_mm: null, reading_x_height_arcmin: null, physical_size_source: null });
    expect(conditionPhysical({ mm_per_css_px: 0.2055 }, 1, 22).reading_x_height_arcmin).toBeNull();
  });

  it('a dot on the inner ring is 4 deg on the study tablet and smaller further away', () => {
    const t = { stim_ecc_px: 186.68, stim_scale_at_onset: 1 };
    const e = trialEccentricity(tablet, t);
    expect(e.deg55!).toBeCloseTo(3.99, 2);
    expect(trialEccentricity({ ...tablet, viewing_distance_cm: 65 }, t).degAtDistance!).toBeLessThan(e.deg55!);
    expect(e.source).toBe('measured');
  });

  it('recovers an older row\'s onset scale EXACTLY from the angle it stored, and recomputes its angle', () => {
    // A pre-Round-74 row stored atan(px x scale x 0.2055 / 550) at the scale it was drawn at.
    const stored = (px: number, scale: number) => (Math.atan((px * scale * 0.2055) / 550) * 180) / Math.PI;
    for (const scale of [1, 0.9, 0.86, 0.5]) {
      expect(trialOnsetScale({ stim_ecc_px: 376.18, stim_ecc_deg_55cm: stored(376.18, scale) })).toBe(scale);
    }
    // On a tablet that reported 1920 CSS px across, the stored 8.00 deg was 4.82 deg on the glass.
    const legacy = { stim_ecc_px: 376.18, stim_ecc_deg_55cm: stored(376.18, 1) };
    const e = trialEccentricity({ screen_resolution: '1920x1200' }, legacy);
    expect(e.source).toBe('assumed_study_tablet_panel');
    expect(e.deg55!).toBeCloseTo(4.82, 2);
    expect(e.degAtDistance).toBeNull();
    // No location at all (before Round 66): nothing.
    expect(trialEccentricity(tablet, {})).toEqual({ deg55: null, degAtDistance: null, source: null, scale: null });
  });
});

/** One CSV of a bundle's export as row objects. */
function rows(files: { filename: string; content: string }[], name: string): Record<string, string>[] {
  const [head, ...lines] = files.find((f) => f.filename.endsWith(name))!.content.trim().split(/\r?\n/);
  const cols = splitCsvRow(head);
  return lines.map((l) => { const v = splitCsvRow(l); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
}

describe('a display-size change between pre-flight and a condition', () => {
  it('scales the CSS pixel by the ratio of the pixel ratios, exactly', () => {
    // Calibrated at 2.5 (0.2055 mm per CSS px); a condition at 1.5 has CSS pixels 1.5/2.5 the size.
    const s = { mm_per_css_px: 0.2055, device_pixel_ratio: 2.5, screen_resolution: '1152x720', viewing_distance_cm: 55 };
    expect(sessionMmPerCssPx(s, 1.5).mm).toBeCloseTo(0.1233, 6);
    expect(sessionMmPerCssPx(s, 2.5).mm).toBe(0.2055);
    expect(sessionMmPerCssPx(s, null).mm).toBe(0.2055);
    // At 1.5 the layout is fitted at 1.66, so the stimulus on the glass is the same size again.
    expect(conditionPhysical(s, 1.66, 22, 1.5).mm_per_layout_px!).toBeCloseTo(0.2047, 4);
  });

  it('is reported by the integrity audit, naming the conditions', () => {
    const b = buildFixtureBundle();
    b.conditions = b.conditions.map((c, i) => ({ ...c, device_pixel_ratio: i === 3 ? 1.5 : 2.5 }));
    const f = auditBundle(b).findings.filter((x) => x.check === 'physical_calibration_pixel_ratio');
    expect(f).toHaveLength(1);
    expect(f[0].refs).toEqual([b.conditions[3].condition_id]);
    const c3 = rows(buildExportFiles(b), '02_conditions.csv')[3];
    expect(c3.device_pixel_ratio).toBe('1.5');
    expect(Number(c3.mm_per_layout_px)).toBeCloseTo(0.1233, 4);
  });
});

describe('the export carries the calibration and computes from it', () => {
  it('a measured sitting: the measurement, measured sizes, and no calibration finding', () => {
    const b = buildFixtureBundle();
    const files = buildExportFiles(b);
    const s01 = rows(files, '01_session_info.csv')[0];
    expect(s01).toMatchObject({
      viewing_distance_cm: '55', calibration_bar_design_px: '500', calibration_bar_mm: '102.75',
      calibration_scale: '1', mm_per_css_px: '0.2055', calibration_skipped: 'false', physical_size_source: 'measured',
      device_pixel_ratio: '2.5',
    });
    const c = rows(files, '02_conditions.csv')[0];
    expect(c.physical_size_source).toBe('measured');
    expect(Number(c.reading_x_height_arcmin)).toBeCloseTo(14.93, 2);
    const t = rows(files, '08_reaction_trials.csv')[0];
    expect(t.stim_ecc_deg_source).toBe('measured');
    expect(Number(t.stim_ecc_deg_at_distance)).toBeCloseTo(Number(t.stim_ecc_deg_55cm), 6);
    expect(auditBundle(b).findings.filter((f) => f.check.startsWith('physical_calibration'))).toHaveLength(0);
  });

  it('a skipped calibration: blank measurement, assumed sizes, flagged, and reported', () => {
    const b = buildFixtureBundle();
    b.session = {
      ...b.session, calibration_skipped: true, calibration_bar_design_px: null, calibration_bar_mm: null,
      calibration_scale: null, mm_per_css_px: null,
    };
    const files = buildExportFiles(b);
    const s01 = rows(files, '01_session_info.csv')[0];
    expect(s01).toMatchObject({ mm_per_css_px: '', calibration_skipped: 'true', physical_size_source: 'assumed_study_tablet_panel' });
    expect(rows(files, '02_conditions.csv')[0].physical_size_source).toBe('assumed_study_tablet_panel');
    expect(rows(files, '08_reaction_trials.csv')[0].stim_ecc_deg_source).toBe('assumed_study_tablet_panel');
    const f = auditBundle(b).findings.filter((x) => x.check === 'physical_calibration');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warning');
    expect(f[0].detail).toMatch(/skipped/);
  });

  it('a sitting from before the check is reported as unmeasured, with no distance', () => {
    const b = buildFixtureBundle();
    const { calibration_skipped: _a, mm_per_css_px: _b, viewing_distance_cm: _c, ...legacy } = b.session;
    b.session = legacy as typeof b.session;
    const f = auditBundle(b).findings.filter((x) => x.check === 'physical_calibration');
    expect(f).toHaveLength(1);
    expect(f[0].detail).toMatch(/predates/);
    expect(rows(buildExportFiles(b), '02_conditions.csv')[0].reading_x_height_arcmin).toBe('');
  });

  it('an implausible reading is reported and not used; one off the panel is reported and used', () => {
    const b = buildFixtureBundle();
    b.session = { ...b.session, mm_per_css_px: 2.055, calibration_bar_mm: 1027.5 };
    expect(auditBundle(b).findings.find((x) => x.check === 'physical_calibration')!.detail).toMatch(/outside the plausible/);
    expect(rows(buildExportFiles(b), '01_session_info.csv')[0].physical_size_source).toBe('assumed_study_tablet_panel');
    const off = buildFixtureBundle();
    off.session = { ...off.session, mm_per_css_px: 0.25 };
    expect(auditBundle(off).findings.find((x) => x.check === 'physical_calibration_matches_panel')).toBeDefined();
    expect(rows(buildExportFiles(off), '01_session_info.csv')[0].physical_size_source).toBe('measured');
  });
});
