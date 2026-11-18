# Is this build ready to collect thesis data?

Written in Round 97, from the repository as it stands. It is a go / no-go list, not a promise: every
statement about the study tablet below is a check still to be made, because **nothing in this
repository has been measured on the Xiaomi Pad 6**.

**The verdict.** The build is ready for a **bench test** on the study tablet now. It is **not ready for
a pilot** with participants until that bench test has passed and the open decisions that touch what a
participant sees or consents to are settled. It is **not ready for confirmatory collection** until the
pilot has been taken end to end through export and the analysis kit, the analysis decisions are written
down and dated, and one build is frozen for every participant.

## What the automated checks do and do not show

`npm run verify` runs lint, the type check, the unit tests (about two thousand), the corpus, codebook,
export and analysis gates; `npm run test:e2e` drives about 120 end-to-end scenarios in headless desktop
Chromium, with Chromium's fake camera (some with a drawn face); `npm run test:e2e:prod` checks the
production bundle. Together they are strong evidence that the software's **logic** is right: the
sitting's flow, what is recorded, what is exported, that the analysis templates run on the export and
recover simulated effects, and that the analysis kit's numbers are the template's.

They are **not** evidence about the tablet: its camera, its frame rates, its face tracker's speed, its
Chrome, its gestures, its screen and its storage. Rounds 86 to 94 of `docs/AUDIT_FINDINGS.md` each have a
section "Not measured on the Xiaomi Pad 6" (later rounds say it in "Not done"); the bench test below is
where those are measured.

## Gate 1. Bench test: the tablet, the build and the operator, without participants

Use test participant codes only (for example `BENCH01`, `BENCH02`), and delete those sittings afterwards:
they must never reach the analysis.

| Must be true | How to check | Where it is described |
|---|---|---|
| The build is served from the study's deployed **HTTPS** address and installed, and the landing page reads **Offline copy: ready** | Open the address once on the tablet with the network on; wait for the line | `docs/DEPLOYMENT.md` §4; `field/README.md` (the laptop field server's self-signed certificate gives **no** offline copy) |
| The pre-flight storage check reads ok and storage is persisted | Pre-flight; the export's `storage_verdict` and `storage_persisted` | `docs/DEPLOYMENT.md` §7; `docs/OPERATOR_MANUAL.md` §2 |
| The device settings hold for a whole sitting: brightness fixed, auto-brightness and blue-light filter off, screen timeout off, landscape, launched from the home-screen icon | The bench checklist, *Before* | `docs/OPERATOR_MANUAL.md` §9 |
| The camera works at a usable rate: camera, tracker and eye sampling rates; which face tracker the tablet measures fastest | Camera set-up's readout and **Measure trackers again**; the export's `tracker_*`, `selftest_*` and 07 `sampling_fps_observed` | `docs/OPERATOR_MANUAL.md` §4; `docs/FPS_GATE_SIMULATION.md` (tier A from 20 face-solved frames a second) |
| The exposure lock works on this camera | Camera set-up's box *Bench check (researcher, before the pilot)*: press **Run: white, grey, black (2 min)**; 01 `camera_exposure_policy` and `camera_bench` | `docs/OPERATOR_MANUAL.md` §4; AUDIT_FINDINGS Rounds 79–82 and 91 |
| The reaction-time onset behaves on the tablet as in desktop Chromium | A full bench sitting with the camera on; 08 `onset_paint_overrun_ms` and `onset_moved_ms` | `docs/ANALYSIS_PLAN.md` §5; AUDIT_FINDINGS Rounds 92–94 (the open confirmation of `rt-t3`) |
| A full sitting runs start to finish within the times the timing model predicts | A stopwatch over a whole bench sitting | `field/TIMING-SHEET.md`; `docs/PROTOCOL.md`, *Timing and the feasibility gate* (median about 102 minutes, 95th percentile about 126); `docs/TIMING_MODEL.md` |
| The gestures behave: the Back edge swipe opens the Pause box; a double tap on a button is taken as one; the tablet stays in landscape | Try each on the tablet | AUDIT_FINDINGS Rounds 86–87 |
| Every screen fits the tablet's screen and the text is legible at the viewing distance | Walk every screen; the ruler step in pre-flight (about 103 mm on the study tablet) | `docs/OPERATOR_MANUAL.md` §2 and §9 |
| The data path works: one `.zip` per sitting lands in Downloads and copies to the computer by cable; **Download everything** works; `run_analysis.R` runs on the copy | Complete bench sittings under two or more different test codes (the analysis needs at least two participants, not two sittings of one); follow `docs/ANALYSIS_GUIDE.md` Parts 1 and 2 | `docs/ANALYSIS_GUIDE.md`; `docs/OPERATOR_MANUAL.md` §7 |

Write down what each check showed, with the date and the build line from the landing page.

## Gate 2. Pilot: a few participants, the whole procedure

| Must be true | How to check | Where it is described |
|---|---|---|
| Gate 1 passed, and anything it found is fixed or recorded | Your bench notes | above |
| The consent text is the approved one, and its stated duration and camera wording are settled with the ethics committee | Compare the consent screen with the approved form | AUDIT_FINDINGS Round 90 §9 item 1 and Round 92 §9 item 4 |
| The decisions that change the app before collection are made: which display follows a break (P8, what the participant sees) and the comprehension threshold of the engagement flag (what is recorded) | Write each down, dated | `docs/ANALYSIS_GUIDE.md` Part 5 |
| Each pilot sitting is exported, copied off the same day and confirmed (*exported, copy checked*) | The Session Manager's row statuses | `docs/ANALYSIS_GUIDE.md` Part 1 |
| The dashboard's Data Quality tab shows usable blink data for most conditions | Dashboard → Data Quality / QC after each sitting | `docs/OPERATOR_MANUAL.md` §7 (Reading the dashboard) |
| The pilot export goes through the analysis kit and its report is read | **Download everything**, then `run_analysis.R`; open `00_START_HERE.html` | `docs/ANALYSIS_GUIDE.md` Parts 2 and 3 |
| The sitting's real length is compared with the consent's stated duration | Session durations in 01 `session_duration_min` | `docs/TIMING_MODEL.md` |

Pilot data are not confirmatory data. Keep them apart, and do not let them into the confirmatory
analysis unless the plan says so before you look at them.

## Gate 3. Confirmatory collection

| Must be true | How to check | Where it is described |
|---|---|---|
| The pilot was analysed end to end and nothing in it calls for a change to the app or the protocol | The pilot's `00_START_HERE.html` and `analysis_log.txt` | `docs/ANALYSIS_GUIDE.md` |
| Every analysis decision in `docs/ANALYSIS_GUIDE.md` Part 5 is written down and dated, before any confirmatory result is opened | Your decision record | `docs/ANALYSIS_GUIDE.md` Part 5; `docs/ANALYSIS_PLAN.md` |
| One build for every participant: the version decided (2.4.0 or 2.5.0), the build deployed and then not updated during collection | The landing page's build line on every session sheet; the export's `git_hash` | `docs/OPERATOR_MANUAL.md` §2 and §8; `docs/DEPLOYMENT.md` §5 |
| The procedure is fixed: the bench checklist printed and used at every sitting | `docs/OPERATOR_MANUAL.md` §9 | there |
| The data are protected: a study folder with a second copy off the computer, photographs and video kept apart under their consent | Your storage arrangement | `docs/ANALYSIS_GUIDE.md` Part 1 |

## What the software cannot settle

- Agreement of the automated blink classification with manual annotation of video (Objective 4) is not
  computed by the analysis templates; it needs the annotated video and its own analysis.
- When the camera is lost while the camera set-up screen is showing, that screen does not show it; the
  next screen does. A reason value for that case in the export is an open decision (AUDIT_FINDINGS
  Round 96, Not done).
- The synopsis (`synopsis/`) still quotes some figures the app has since changed; they are listed in
  AUDIT_FINDINGS Round 95, *For the investigator*.
