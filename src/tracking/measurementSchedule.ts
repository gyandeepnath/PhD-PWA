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
  pictureBrightness: { name: 'Picture brightness', column: 'mean_face_luma (07)', note: '0-255' },
  cameraHealth: { name: 'Camera health', column: 'camera_blocked_ms, camera_muted_ms, no_face_longest_ms, no_face_episodes (07)', note: 'covered, muted or no face' },
  openEyeBaseline: { name: 'Open-eye baseline', column: 'calibration_ear_baseline (01); ear_baseline (07)', note: 'every blink line is a fraction of it' },
  gazeCheck: { name: 'Gaze check', column: 'gaze_calibration_valid, gaze_trust (01)', note: 'three dots; for the on-screen ratio only' },
  cameraCheck: { name: 'Camera check', column: 'selftest_* (01); window = selftest (07b, 07c)', note: 'five flashes' },
} as const;

export type MeasureKey = keyof typeof MEASURE;

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
