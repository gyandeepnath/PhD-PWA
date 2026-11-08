/**
 * WHAT EACH INSTRUMENT VERSION MEANS — one list, for the export's codebook and the operator manual
 * (Round 92, audit 86 P2).
 *
 * package.json's version is bumped by hand when a round changes what a participant sees or what the
 * export means, and 01_session_info.csv carries it as app_version. Its codebook entry was a sentence
 * written by hand, and the bump to 2.4.0 updated the manual and not the sentence: a 2.4.0 export
 * described 2.1.0-2.3.0 and said nothing of 2.3.1 or 2.4.0. The codebook entry is now built from this
 * list, and tests/versionHistory.test.ts fails when package.json names a version that is not its last
 * entry, or when the manual does not mention one of them.
 */
export interface VersionEntry {
  version: string;
  /** Where it starts. */
  from: string;
  /** What it changed, for the reader of an export. */
  what: string;
}

export const VERSION_HISTORY: readonly VersionEntry[] = [
  {
    version: '2.1.0', from: 'the first commit to Round 73',
    what: 'every deployment in that span reads 2.1.0, so tell them apart by build_time and git_hash',
  },
  { version: '2.2.0', from: 'Round 74', what: 'fitted the layout to the screen and added the physical calibration' },
  {
    version: '2.3.0', from: 'Round 75',
    what: 'measured the camera pipeline, added the Face Landmarker tracker and took EAR in image-plane proportions (see tracker_backend and ear_baseline)',
  },
  {
    version: '2.3.1', from: 'Round 76',
    what: 'the viewing distance typed at every sitting, never prefilled (see viewing_distance_cm); the build the investigator tested',
  },
  {
    version: '2.4.0', from: 'Round 85 (commit 26e909c)',
    what: 'the 100 mm rating lines (slider_version), the grey-field calibration with the three-dot gaze check (calibration_rule_version, gaze_rule_version), '
      + 'the camera check that counts only blinks after a flash (selftest_rule), the fixed exposure kept on Android (camera_exposure_rule) and the per-blink '
      + 'files (07b, 07c). Builds deployed while these were being made still said 2.3.1, so on a sitting labelled 2.3.1 git_hash says which build it was. '
      + 'The fixes of audit 86 (Rounds 86-92) are still 2.4.0: each rule they changed says which version of it a row was recorded under in its own '
      + '*_version column, and git_hash names the build',
  },
];

/** The codebook's description of app_version, from the list. */
export function appVersionDescription(): string {
  const parts = VERSION_HISTORY.map((v) => `${v.version} from ${v.from}: ${v.what}`);
  return 'Instrument version (package.json) of the build that started this sitting. Bumped by hand when a round changes what a participant sees '
    + `or what the export means. ${parts.join('. ')}.`;
}
