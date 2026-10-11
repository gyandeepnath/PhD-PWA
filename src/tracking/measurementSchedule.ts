/**
 * WHAT IS MEASURED, WHEN, AND WHERE IT IS KEPT — as data, so the app, the operator manual and the
 * protocol say the same thing (Round 80, investigator instruction 5).
 *
 * The investigator asked "when blinks are measured, what is measured, what is continuously measured,
 * what is measured time to time". The answer was spread over a dozen files, and the researcher card
 * did not say whether what it showed was being recorded: its blink count read the same during a reading
 * (recorded) and on the questions after it (a finished count, nothing recorded), and the ten-second
 * graph looked the same on camera setup, where nothing is kept, as anywhere else.
 *
 * Three things live here:
 *
 *   - MEASURE: one name for each measure, used by the researcher panel, the dashboard and the docs, with
 *     the export column it is stored in. The same quantity used to be "Face found", "FPS", "effective
 *     fps" and "eye sampled" depending on the screen.
 *   - RecordingWindow and RECORDING_LABEL: what the camera's frames are going into right now. The tracker
 *     runs on every screen from camera setup to the end; its frames are KEPT only inside these windows.
 *     useTracking reports which one is open (LiveTrackingStats.recording) from the same references that
 *     decide where a frame goes, and the panel prints the label.
 *   - MEASUREMENT_SCHEDULE: the one table, rendered by scheduleMarkdown() into docs/OPERATOR_MANUAL.md and
 *     docs/PROTOCOL.md. tests/measurementSchedule.test.ts fails if either document's copy differs from
 *     this, or if a recording window the code can open has no row here.
 */
import { CONFIG } from '@/experiment/config';
import { MIN_EAR_BASELINE_SAMPLES } from './blink';
import { GAZE_DOTS, GAZE_DOT_ATTEMPTS, GAZE_DOT_SAMPLE_MS, GAZE_DOT_SETTLE_MS } from './calibrationSequence';
import { SELF_TEST } from './selfTest';

/**
 * How often the researcher's live readout updates, in hertz (useTracking.ts emitLive). Here, not in the
 * hook, because the schedule states it.
 */
export const LIVE_READOUT_HZ = 4;

/** One name per measure, and where it is stored. Panel, dashboard and docs use `name`. */
export const MEASURE = {
  eyeOpenness: { name: 'Eye openness', column: 'ear (07c); ear_baseline (07)', note: 'eye-aspect ratio (EAR); live as % of the open-eye baseline' },
  blinks: { name: 'Blinks', column: 'blink_count_full + blink_count_micro + blink_count_incomplete (07); one row each in 07b', note: 'blink-r1' },
  incompleteBlinks: { name: 'Incomplete blinks', column: 'blink_count_incomplete (07)', note: 'the lid did not reach the complete line' },
  incompleteRatio: { name: 'Incomplete-blink ratio', column: 'incomplete_blink_ratio (07)', note: 'primary outcome' },
  blinkRate: { name: 'Blink rate', column: 'blink_rate (07)', note: 'blinks a minute of observed time' },
  interBlinkInterval: { name: 'Inter-blink interval', column: 'mean_inter_blink_interval_ms (07)', note: '' },
  perclos: { name: 'PERCLOS', column: 'perclos_p80 (07)', note: 'share of time with the eye 80% or more closed' },
  longClosures: { name: 'Long closures', column: 'long_closure_count (07)', note: 'closed for more than 0.5 s' },
  samplingRate: { name: 'Eye sampling rate', column: 'sampling_fps_observed, fps_tier (07)', note: 'face frames a second while the face was seen; gate fps-g2' },
  faceInView: { name: 'Face in view', column: 'face_presence_ratio (07)', note: 'share of frames with a face' },
  onScreen: { name: 'On-screen ratio', column: 'on_screen_ratio (07)', note: 'quality check only: share of open-eye frames looking at the tablet' },
  headPosition: { name: 'Head position', column: 'head_pitch_mean, head_yaw_mean, off_axis_ratio (07)', note: '' },
  headTurnedAway: { name: 'Head turned away', column: 'off_axis_ratio (07)', note: 'share of face frames with the head beyond 20 degrees pitch or 15 yaw' },
  lighting: { name: 'Lighting', column: 'lighting_quality (07)', note: 'picture brightness sorted into low, good, overexposed' },
  pictureBrightness: { name: 'Picture brightness', column: 'mean_face_luma (07)', note: '0-255' },
  cameraHealth: { name: 'Camera health', column: 'camera_blocked_ms, camera_muted_ms, no_face_longest_ms, no_face_episodes (07)', note: 'covered, muted or no face' },
  openEyeBaseline: { name: 'Open-eye baseline', column: 'calibration_ear_baseline (01); ear_baseline (07)', note: 'every blink line is a fraction of it' },
  gazeCheck: { name: 'Gaze check', column: 'gaze_calibration_valid, gaze_trust (01)', note: 'three dots; for the on-screen ratio only' },
  cameraCheck: { name: 'Camera check', column: 'selftest_* (01); window = selftest (07b, 07c)', note: 'five flashes' },
} as const;

export type MeasureKey = keyof typeof MEASURE;

/**
 * The export columns each name belongs to, as "file:column", one name per column. The codebook
 * (storage/export.ts) adds the name to each of these columns' descriptions, so an analyst reading
 * 07_eye_metrics.csv knows which column the panel's "Eye sampling rate" or the dashboard's "Face in
 * view" is. tests/measurementSchedule.test.ts checks every one is a documented column.
 */
export const MEASURE_COLUMNS: Partial<Record<MeasureKey, string[]>> = {
  eyeOpenness: ['07c_ear_trace.csv:ear'],
  incompleteBlinks: ['07_eye_metrics.csv:blink_count_incomplete'],
  incompleteRatio: ['07_eye_metrics.csv:incomplete_blink_ratio'],
  blinkRate: ['07_eye_metrics.csv:blink_rate'],
  interBlinkInterval: ['07_eye_metrics.csv:mean_inter_blink_interval_ms'],
  perclos: ['07_eye_metrics.csv:perclos_p80', '07_eye_metrics.csv:perclos_p70'],
  longClosures: ['07_eye_metrics.csv:long_closure_count'],
  samplingRate: ['07_eye_metrics.csv:sampling_fps_observed', '07_eye_metrics.csv:fps_tier', '01_session_info.csv:selftest_sampling_fps'],
  faceInView: ['07_eye_metrics.csv:face_presence_ratio'],
  onScreen: ['07_eye_metrics.csv:on_screen_ratio'],
  headPosition: ['07_eye_metrics.csv:head_pitch_mean', '07_eye_metrics.csv:head_yaw_mean'],
  headTurnedAway: ['07_eye_metrics.csv:off_axis_ratio'],
  lighting: ['07_eye_metrics.csv:lighting_quality'],
  pictureBrightness: ['07_eye_metrics.csv:mean_face_luma'],
  cameraHealth: ['07_eye_metrics.csv:camera_blocked_ms', '07_eye_metrics.csv:camera_muted_ms', '07_eye_metrics.csv:no_face_longest_ms', '07_eye_metrics.csv:no_face_episodes'],
  openEyeBaseline: ['01_session_info.csv:calibration_ear_baseline', '07_eye_metrics.csv:ear_baseline'],
  gazeCheck: ['01_session_info.csv:gaze_calibration_valid'],
  cameraCheck: ['01_session_info.csv:selftest_verdict'],
};

/** The on-screen name of an export column, or null when MEASURE does not name it. */
export function screenName(file: string, column: string): string | null {
  const key = `${file}:${column}`;
  for (const [k, cols] of Object.entries(MEASURE_COLUMNS) as Array<[MeasureKey, string[]]>) {
    if (cols.includes(key)) return MEASURE[k].name;
  }
  return null;
}

/**
 * A stretch in which the tracker's frames are KEPT. Outside all of them the frames are shown live and
 * discarded. 'baseline' and 'gaze_check' are calibration's two steps; what they keep is the calibration
 * record, not a time series.
 */
export type RecordingWindow = 'reading' | 'selftest' | 'baseline' | 'gaze_check';

/** What the panel prints for the window open now; `none` when nothing is being kept. */
export const RECORDING_LABEL: Record<RecordingWindow | 'none', string> = {
  reading: 'Recording: reading window',
  selftest: 'Recording: camera check',
  baseline: 'Recording: open-eye baseline',
  gaze_check: 'Recording: gaze check',
  none: 'Live only — not recorded',
};

export function recordingLabel(w: RecordingWindow | null | undefined): string {
  return RECORDING_LABEL[w ?? 'none'];
}

/**
 * The same, in the two words the researcher strip has room for. The strip is drawn only on the reading
 * pages and the grey field (ResearcherPanel.tsx), so "Recording" there can only mean the reading window.
 */
export function recordingShort(w: RecordingWindow | null | undefined): string {
  return w ? 'Recording' : 'Not recorded';
}

/** How often, in the schedule's words. */
export type Cadence = 'Continuously' | 'Each blink' | 'Each reading window' | 'Once per sitting' | 'Live only' | 'Not measured';

export interface ScheduleRow {
  measure: string;
  cadence: Cadence;
  /** When exactly, in a few words. */
  when: string;
  /** Where it is kept; "Not kept" when it is not. */
  kept: string;
  /** What the researcher sees of it while it happens. */
  live: string;
  /** The recording window(s) that keep it, for the test that ties the code's windows to this table. */
  windows?: RecordingWindow[];
}

const s1 = (ms: number) => `${Math.round(ms / 100) / 10} s`;
/** How many windows keep frames: every RECORDING_LABEL but 'none'. */
const RECORDING_WINDOWS = Object.keys(RECORDING_LABEL).length - 1;

/**
 * The schedule, in the order a sitting meets it. Every number is read from the code that applies it.
 * It is rendered into the docs by the unit tests, where CONFIG has the protocol's timings (the e2e
 * harness's shortened ones apply only under ?e2e in a browser).
 */
export function measurementSchedule(): ScheduleRow[] {
  const selfTestS = Math.round((SELF_TEST.FIRST_CUE_MS + SELF_TEST.CUES * SELF_TEST.CUE_EVERY_MS) / 1000);
  return [
    {
      measure: `${MEASURE.eyeOpenness.name}, face found, head position, iris position`,
      cadence: 'Continuously',
      when: 'Every frame the tracker processes, from camera setup to the end of the sitting',
      kept: `Only in the ${RECORDING_WINDOWS} windows below that the panel marks "Recording"; on every other screen shown live and discarded`,
      live: `Card: picture, last-10-s graph, eye openness, on screen now; panel says "${RECORDING_LABEL.none}" outside them`,
    },
    {
      measure: MEASURE.pictureBrightness.name,
      cadence: 'Continuously',
      when: `${CONFIG.LUMA_SAMPLE_HZ} times a second`,
      kept: 'Mean per reading window (07 mean_face_luma)',
      live: 'Card',
      windows: ['reading'],
    },
    {
      measure: MEASURE.cameraHealth.name,
      cadence: 'Continuously',
      when: 'Every frame: picture black or covered, camera muted, no face',
      kept: 'Totals per reading window (07)',
      live: 'Panel dot and words; notices that stop the sitting',
      windows: ['reading'],
    },
    {
      measure: 'Ruler, viewing distance, camera mode, fixed exposure, tracker, bench check (if run)',
      cadence: 'Once per sitting',
      when: 'Pre-flight and camera setup',
      kept: '01_session_info',
      live: 'On those screens',
    },
    {
      measure: `${MEASURE.openEyeBaseline.name} and head-pitch zero`,
      cadence: 'Once per sitting',
      when: `Calibration, centre dot on the grey field: at least ${s1(CONFIG.EAR_BASELINE_MS)}, on until ${MIN_EAR_BASELINE_SAMPLES} usable frames, at most ${s1(CONFIG.EAR_BASELINE_MAX_MS)}; again on a retry or a resume`,
      kept: 'Calibration record; 01 calibration_ear_baseline',
      live: `Panel: "${RECORDING_LABEL.baseline}"; calibration screen: eyes found / steady / done`,
      windows: ['baseline'],
    },
    {
      measure: MEASURE.gazeCheck.name,
      cadence: 'Once per sitting',
      when: `After the baseline: ${GAZE_DOTS.length} dots across a reading line, each sampled ${s1(GAZE_DOT_SAMPLE_MS)} after ${s1(GAZE_DOT_SETTLE_MS)} to settle; a short dot is shown again (up to ${GAZE_DOT_ATTEMPTS} times in all)`,
      kept: 'Calibration record; 01 gaze_calibration_valid',
      live: `Panel: "${RECORDING_LABEL.gaze_check}"; calibration screen: a tick per dot`,
      windows: ['gaze_check'],
    },
    {
      measure: MEASURE.cameraCheck.name,
      cadence: 'Once per sitting',
      when: `After calibration: about ${selfTestS} s, ${SELF_TEST.CUES} flashes on the grey field`,
      kept: '01 selftest_*; its blinks and frames in 07b and 07c (window = selftest)',
      live: `Panel: "${RECORDING_LABEL.selftest}"; result screen: each flash, the trace`,
      windows: ['selftest'],
    },
    {
      measure: `${MEASURE.blinks.name} (start, end, depth, complete or incomplete, page)`,
      cadence: 'Each blink',
      when: 'The reading window only: from the "Begin reading" tap to the last page\'s Next',
      kept: '07b, one row per blink; 07c, every frame\'s eye openness',
      live: `Panel: "${RECORDING_LABEL.reading}"; blinks this reading, incomplete beside (a blink is counted when the eye reopens)`,
      windows: ['reading'],
    },
    {
      measure: [
        MEASURE.incompleteRatio.name, MEASURE.blinkRate.name, MEASURE.interBlinkInterval.name, MEASURE.perclos.name,
        MEASURE.longClosures.name, MEASURE.samplingRate.name, MEASURE.faceInView.name, MEASURE.onScreen.name,
        MEASURE.headPosition.name,
      ].join(', '),
      cadence: 'Each reading window',
      when: 'Summarised when the last page is turned',
      kept: '07_eye_metrics, one row per condition',
      live: 'Panel "last reading" on the screens after it',
      windows: ['reading'],
    },
    {
      measure: 'Questions, ratings, fatigue scale, word search, reaction task, grey field, breaks',
      cadence: 'Not measured',
      when: 'The camera keeps running',
      kept: 'Not kept',
      live: `Panel: "${RECORDING_LABEL.none}"`,
    },
    {
      measure: 'Live picture, last-10-s graph and its blink marks, live frame rates',
      cadence: 'Live only',
      when: `While the researcher card is open (${LIVE_READOUT_HZ} updates a second)`,
      kept: 'Never kept',
      live: 'Card',
    },
  ];
}

/** The schedule as the Markdown table both documents carry, verbatim. */
export function scheduleMarkdown(rows: ScheduleRow[] = measurementSchedule()): string {
  const cell = (x: string) => x.replace(/\|/g, '\\|');
  return [
    '| Measure | How often | When | Kept in | Shown live |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.measure)} | ${r.cadence} | ${cell(r.when)} | ${cell(r.kept)} | ${cell(r.live)} |`),
  ].join('\n');
}
