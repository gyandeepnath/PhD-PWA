##  Build Knowledge: VisuLab2
### What I have access to and what I don't
Before anything else — complete transparency. The container resets between sessions. The source code I can read directly is in `/mnt/user-data/outputs/visulab2-src/` which is from approximately session 7–10. Everything from sessions 11–19 (the significant architectural changes) exists only in transcript records and in the compiled `VisuLab2.html`. So my knowledge of the recent UI changes (SessionManager, LandingPage, ExportDashboard, ExperimentFlowPanel) comes from transcripts, not readable source. The core experiment logic, camera system, database, and state machine I've read directly from source.
---
## Part 1 — Origins and Build History (Sessions 1–18)
The build started from scratch on 6 March 2026 across 18 sessions covering approximately 72 hours of development time. The original specification was a 4-part master document defining an 8-condition visual ergonomics PWA. Here is what happened across sessions:
**Sessions 1–3** (6 March): Architecture design, first full implementation, full rebuild from a more detailed specification. By session 3, the complete React/TypeScript PWA existed with all core modules — reading task, reaction time (simple go/no-go at that point), camera eye tracking, fatigue assessments, IndexedDB storage, export.
**Session 4** (6 March afternoon): First bug fixes — IndexedDB fallback for file:// protocol, reading timer adjusted from 120s to 20s per page, and the reaction time task was redesigned with condition-specific target colours and proper accuracy scoring.
**Session 5** (6 March): Refinement specification implemented — new condition flow, `DisplayPerceptionRating` module added, `CalibrationRoutine` added, `DiagnosticConsole` with live camera monitoring, gaze zone system, calibration routine, still image capture, DB schema upgraded to v2.
**Session 6** (7 March): Xiaomi Pad 6 specific fixes — camera face-detection failure fixed, black verification image fix, RT task hang fix, diagnostic console visibility, condition-coloured fatigue/perception scales, landscape layout redesign, export dashboard rebuilt with SVG charts.
**Session 7** (7 March): Second Xiaomi bug-fix session — camera face-detection failure (second pass), fullscreen guard blocking experiment, reading task button cut off, orientation prompt added, zoom control added.
**Session 8** (7 March): Third bug-fix session — systematic code audit of all 45 modules, interrupted mid-audit.
**Session 9** (7 March): Full audit complete — 15 issues identified (2 critical, 7 bugs, 6 flags). Report written.
**Session 10** (8 March): All 15 audit issues fixed plus 6 additional. Comprehension data persistence was the major new finding. Full build completed.
**Session 11** (8 March): Session 6 UI changes — zip delivery, `SessionInit` input glitch fixes, white/black theme established, "Developed by Gyandeep" credit, full `SessionManager` implementation with multi-session resume/rename/retest/delete.
**Session 12** (8 March): Three areas — Xiaomi scaling architecture overhaul (CSS variable + `transform:scale` on `#root`), `ParticipantSummary` confetti/blink/PIN gate, and full SPSS-optimised 11-file export system redesign.
**Session 13** (8 March): Head pose ergonomic justification, adaptive micro-blink detection overhaul, pause/terminate architecture with scientific integrity constraints, timestamped consent photo with live canvas preview.
**Session 14** (8 March): Visual search task scientific overhaul — time limit derivation, early voluntary submission with two-tap confirm, three-way termination mode classification, censored miss data handling, expanded export metrics.
**Session 15** (9 March): IndexedDB delete/re-test/rename bug fix. NotFoundError on transaction due to schema mismatch between cached app and device DB — this was a critical data integrity fix. Also: comprehensive data point enumeration (~5,647–5,800 scalar data points per participant).
**Session 16** (9 March): Three topics — Word report on data points, 50/50 session manager layout fix, robust soft-delete system with atomic tombstone pattern and 30-day restorable bin.
**Session 17** (9 March): White screen root-cause fix, animated wavy background across non-task screens, new LandingPage intro screen, back-navigation buttons in setup flow.
**Session 18** (9 March second): Performance logger, wavy background fully integrated including dark-background screens.
**Session 19** (10 March): Complete redesign — dark UI persisting over white design fixed across body/#root/ExperimentProgress/ParticipantProfile/CameraSetup/CalibrationRoutine/FatigueScale. Mid-task pause confirmation modal replacing locked/tooltip system.
**Session 20** (10 March): Four topics — RT pause button made accessible during REACTION_TIME, glow confound removed from flanker dots, `pickDistractor` fallback fixed, ExportDashboard upgraded with ConditionKey, FCE and d-prime charts, full summary tables, LandingPage redesigned to full two-column landscape layout.
**Current session (21)**: SessionManager redesigned to 70/30 split. ExperimentFlowPanel added as collapsible interactive component with SVG task illustrations.
---
## Part 2 — The Experiment Design (what the code actually implements)
### The 8 conditions (from actual source, `conditions.ts`)
```
C1: #FFFFFF bg / #000000 text — positive polarity, black text
C2: #FFFFFF bg / #1E4ED8 text — positive polarity, blue text
C3: #FFFFFF bg / #C81E1E text — positive polarity, red text
C4: #FFFFFF bg / #C9A400 text — positive polarity, yellow text
C5: #000000 bg / #FFFFFF text — negative polarity, white text
C6: #000000 bg / #1E4ED8 text — negative polarity, blue text
C7: #000000 bg / #C81E1E text — negative polarity, red text
C8: #000000 bg / #C9A400 text — negative polarity, yellow text
```
Hex values are locked in the source with an explicit comment: "must not be changed under any circumstance." These are the contrast-confounded values discussed in the analysis above.
### Latin Square (from actual source, `latinSquare.ts`)
An 8×8 balanced Latin square, generated using the standard algorithm for even N. Row assignment: `(participantNumber − 1) % 8`. This cycles every 8 participants, ensuring each condition appears in each serial position equally across a complete set of 8 participants. At N=150, this gives 18 complete cycles with 6 participants in a 19th partial cycle — effectively balanced.
### Per-condition task sequence (from App.tsx state machine)
The flow the state machine actually implements per condition is:
`READING_TASK → COMPREHENSION → DISPLAY_PERCEPTION → POST_FATIGUE → VISUAL_SEARCH → REACTION_TIME → ADAPTATION`
This is **6 tasks per condition** — the progress bar calculates `SETUP_STEPS (4) + 8 × TASKS_PER_CONDITION (6) = 52 total tracked steps`. Note: this differs slightly from what the ExperimentFlowPanel illustration shows (which shows 6 tasks as Reading, Comprehension, Visual Search, RT, Fatigue, Perception — the DISPLAY_PERCEPTION and POST_FATIGUE are separate stages in the state machine but are both "perception/fatigue" stages from the participant's perspective).
The full session flow is:
`SESSION_INIT → PARTICIPANT_PROFILE → CAMERA_SETUP → CALIBRATION → BASELINE_FATIGUE → [×8: READING → COMPREHENSION → DISPLAY_PERCEPTION → POST_FATIGUE → VISUAL_SEARCH → REACTION_TIME → ADAPTATION] → SESSION_COMPLETE → EXPORT_DASHBOARD`
---
## Part 3 — Each Module in Detail
### 3.1 LandingPage (sessions 15, 20)
Current state (session 20, two-column landscape): full viewport layout, padding '0 7% 0 8%', gap '6%'.
Left column: eyebrow "VisuLab · Research Platform" in DM Mono 12px, title in Georgia serif `clamp(48px, 5.5vw, 88px)` (~88px on Pad 6), thin 64px-wide rule, abstract text at 13px DM Mono lineHeight 1.85, credit line pushed to bottom with marginTop:'auto'.
Right column: frosted glass card `rgba(255,255,255,0.55)` + `backdropFilter:blur(8px)`, "Study Overview" section, 4 stat rows (Conditions / Design / Duration / Tasks), full-width "Enter Research Console →" button.
WavyBackground at opacity 0.055 runs behind the layout.
### 3.2 SessionManager (current session, 70/30 split)
**Left 70% — Session Manager panel:**
- Header band: "VisuLab · Research Platform" eyebrow + "Session Manager" in Georgia serif 32px + subtitle
- `+ New Session` button: full-width, DM Mono 13px uppercase, 20px padding
- ExperimentFlowPanel (new, this session): collapsible, defaults open, shows outer timeline + 6 per-condition task tiles + interactive preview modals with SVG illustrations
**Right 30% — Participants on Record panel:**
- `← Home` button: preserved exactly, in panel header
- Session list: In Progress / Completed grouping, SessionCard components
- Bin panel: bottom of right column, expand/collapse toggle, per-entry Restore + Purge buttons
### 3.3 SessionInit (from session 6 onwards)
Handles two things: creating a new session (participant ID entry, ambient lux entry) or resuming a paused one. The participant ID previously had format restrictions (removed in session 11 — any alphanumeric ID is accepted). Lux value is required. After entry, creates a `SessionRecord` in IndexedDB with session UUID, device info, screen resolution, ambient_lux, session_start_time, randomization_seed, and condition_order (from Latin square).
### 3.4 ParticipantProfile
Collects: age (numeric), gender (male/female/non-binary/prefer not to say), daily screen hours (<2/2–4/4–6/>6), device familiarity (low/moderate/high), lighting habit (bright/moderate/dim). Stores as `ParticipantRecord` in IndexedDB with participant_id as keyPath.
### 3.5 CameraSetup (redesigned session 17)
White/off-white background. Requests `getUserMedia` with constraints `{video: {width:640, height:480, frameRate:30}}`. On grant: stores stream as `window.__visulab_stream`, dispatches SET_CAMERA_STATUS 'active'. On deny: dispatches 'denied', experiment continues without eye tracking (disabledMetrics are used). 
The camera stream is attached to a hidden `<video>` element positioned at top:-200 left:-200 (off-screen, never shown to participant). FaceMesh processes every 2nd frame (~15fps effective).
### 3.6 CalibrationRoutine (session 5)
Runs before the experiment proper. Shows calibration targets at 9 positions on screen (corners, edges, centre). Participant taps each target. Used to establish gaze baseline. Currently the calibration data is used to calibrate the gaze estimator thresholds, though in the camera-based system this is approximate.
### 3.7 FatigueScale (redesigned session 17)
White/off-white design. Five VAS sliders: eye strain, dryness, blur, burning, headache. Each slider 0–10. Composite mean computed and stored as `fatigue_mean`. Called twice per condition: once as BASELINE_FATIGUE at session start (conditionId = null, stage = 'baseline'), once as POST_FATIGUE after each condition (conditionId = current condition UUID, stage = 'post_condition_N').
When baseline is available (POST_FATIGUE calls), shows Δ from baseline inline on each slider — the participant sees both their current score and the change. The comparison is informational only (researcher-facing after the fact).
### 3.8 AdaptationScreen (session 5)
Shows a mid-grey (#808080 from CONFIG.ADAPTATION_COLOR) full-screen background for exactly 20 seconds (CONFIG.ADAPTATION_DURATION_MS = 20,000ms). The purpose is chromatic adaptation — after e.g. a black background condition, the visual system needs time to reset its adaptation state before a white background condition. 20 seconds is below the full chromatic adaptation time (~3–5 minutes) but provides a partial reset. This is between every condition pair.
### 3.9 ReadingTask
**Current implementation (older source, but functionally confirmed):**
- CONFIG.READING_MIN_DURATION_MS = 120,000ms (2 minutes minimum enforced)
- CONFIG.READING_MAX_DURATION_MS = 180,000ms (3 minutes maximum)
- Font: Roboto 20px, lineHeight 1.5, 12% left/right margin
- Passages: 8 science passages (Carbon Cycle, Ocean Currents, Immune System, Volcanic Eruptions, Sleep Science, Rainforest Ecosystems, Plate Tectonics, Electromagnetic Spectrum), 274–292 words each, split into 2 pages (~120 words per page)
- Passage assignment: `passageIndex = currentConditionIndex % 8` — each condition gets a different passage, same passage order for all participants (not counterbalanced across passages — a potential confound with order effects, though the content is topic-neutral)
- Eye tracking starts at beginning of reading task: `startTracking()` called in useEffect when stage === READING_TASK
- Eye tracking stops in `handleReadingComplete`: `stopTracking()` called, metrics aggregated and stored in IndexedDB
**Important note on timing:** The config shows 120s minimum but session 4 transcript mentions "reading timer adjusted from 120s to 20s per page." The config source file still shows 120,000ms. There may be a discrepancy — the compiled HTML may differ from the config file if the timing was changed at the component level rather than in config.
### 3.10 ComprehensionTask
Single 4-option MCQ after each reading passage. Options are rendered as tappable tiles styled in the current condition's colours (background/text from the active condition). Response time is recorded. Correct answer index is stored in `COMPREHENSION_QUESTIONS`. Writes a `ComprehensionRecord` to IndexedDB (type not in the older types file, added later). Session 10 found that comprehension data was not being persisted and fixed it.
### 3.11 DisplayPerceptionRating (session 5)
Two 0–100 sliders: "Display Comfort" and "Text Clarity." Styled in current condition colours so the participant rates the display they are currently using. Comes immediately after comprehension, before fatigue scale. Stores comfort_score and clarity_score per condition.
### 3.12 VisualSearchTask (session 9 scientific overhaul)
**Current design (from session 9):**
- Target word in a grid of words drawn from the current reading passage
- 60-second time limit (VS_TIME_LIMIT_MS = 120,000ms in config — note: config says 120s, session description says 60s — another potential discrepancy worth verifying)
- Single-tap direct submit (two-tap armed system removed in session 12)
- Three-way termination mode: time_limit_reached / voluntary_submission / session_terminated
- Censored miss data handling: if participant doesn't find all targets before time limit, those are marked as misses with censored timing
- Metrics stored: search_time, targets_found, targets_missed, false_detections, accuracy_rate, search_efficiency (hits per minute), time_to_first_target, inter-target_interval
### 3.13 ReactionTimeTask / Eriksen Colour Flanker (session 12 major redesign)
**This is the most complex task.** Replaced a simple go/no-go paradigm in session 12.
**Current paradigm (confirmed in session 18/19):**
- Eriksen flanker: 5 coloured dots in a horizontal array
- Centre dot is the target; 4 flanking dots are distractors
- RT_TARGET_COLOR = '#C81E1E' (red — constant across all 8 conditions, condition-neutral)
- RT_DISTRACTOR_COLORS = ['#1E4ED8', '#C9A400', '#00A651'] (blue, yellow, green — green exists only as flanker distractor, never as a condition colour)
- 48 trials per condition
- 50% go rate — 24 signal trials (centre is red), 24 no-go trials (centre is not red)
- Balanced: within the 24 signal trials, half have congruent flankers (all red), half incongruent (flankers are non-red distractors)
- Stimulus: flat solid circles, no box shadow (glow confound removed in session 20)
- `pickDistractor()` fallback fixed in session 20 — was `?? distractors[0]` (always first if pool empty), now uses `pool.length > 0 ? pool : distractors` with random selection
- Response window: 3,000ms (EXTRA_CONFIG.RT_RESPONSE_WINDOW_MS)
- ITI: 800–1200ms random
- Fixation: 500–1000ms random pre-stimulus
- Delay: 1000–3000ms jittered stimulus onset asynchrony
- Mini progress bar: pushed to top:32px (under global progress bar) to avoid overlap; trial counter at top:46px
- Writes individual `ReactionTrialRecord` per trial with: trial_id, condition_id, trial_number, stimulus_color, stimulus_x, stimulus_y, stimulus_onset_time, response_time, reaction_time_ms, accuracy (hit/miss/false_alarm), false_start_flag
**Export metrics computed from trials:** mean RT (hits only), median RT, SD of RT, hit rate, false alarm rate, d-prime, flanker congruency effect (FCE = mean RT incongruent − mean RT congruent).
**Known scientific issue** (discussed this session): 24 signal trials → d-prime instability. SE(d') ≈ 0.3–0.5. The FCE is reliable at 48 trials. D-prime estimation is the weak point.
### 3.14 ExperimentFlowPanel (this session, new)
Collapsible panel in the left 70% of SessionManager. Fully self-contained — zero props, zero dispatch calls, zero experiment state interaction. Local useState only (open/preview).
Collapsed state: single header row "Experiment Flow" + mini inline summary.
Expanded state: outer timeline strip (Baseline Fatigue → ×8 conditions → Export) + 6 task tiles grid + measurement notes band.
Task tiles: each clickable, opens a local preview modal with SVG illustration + description + key DV note + task navigation strip (01–06 tabs).
Six SVG illustrations: Reading (passage lines, countdown bar, eye tracking indicator), Comprehension (MCQ with one highlighted answer), Visual Search (5×4 word grid with one highlighted target), Reaction Time (5-dot flanker on black background, trial counter), Fatigue Scale (5 VAS sliders with handles), Perception Rating (2 sliders, comfort + clarity).
---
## Part 4 — The Camera System in Detail
### Architecture
The camera pipeline runs in a completely separate thread from the experiment state machine. It uses MediaPipe FaceMesh (loaded from CDN) via the `useFaceMesh` hook. The hidden `<video>` element in App.tsx receives the MediaStream from `window.__visulab_stream`.
**useFaceMesh hook:** Manages FaceMesh instance lifecycle. Processes every 2nd frame (CONFIG.PROCESS_EVERY_N_FRAMES = 2) at ~15fps effective. On each processed frame, calls BlinkDetector, HeadPoseEstimator, GazeEstimator, and EyeMetricsAggregator.
**BlinkDetector (Soukupová & Čech, 2016 EAR method):**
Left eye landmarks: [33, 160, 158, 133, 153, 144]
Right eye landmarks: [362, 385, 387, 263, 373, 380]
EAR = (dist(p2,p6) + dist(p3,p5)) / (2 × dist(p1,p4))
Threshold: EAR < 0.20 for CONFIG.EAR_CONSEC_FRAMES (2) consecutive frames = blink
Valid blink duration: 50–500ms (outside this range is excluded as noise or artefact)
Output: blink events array, blink rate (blinks per minute), mean blink duration
**HeadPoseEstimator:**
Uses landmarks: nose tip (1), chin (152), left ear (234), right ear (454), left eye corner (133), right eye corner (362)
Yaw: (nose.x − ear_mid_x) / ear_span × 90 degrees
Pitch: −((nose.y − face_mid_y) / face_height) × 45 degrees
Roll: atan2(right_eye.y − left_eye.y, right_eye.x − left_eye.x) × (180/π)
**GazeEstimator:**
Uses iris landmarks (468 left, 473 right — FaceMesh iris refinement)
Computes iris offset within eye bounding box → classifies as center/left/right/up/down
Threshold: CONFIG.GAZE_CENTER_THRESHOLD = 0.15
**EyeMetricsAggregator:**
Accumulates per-frame data into a FrameAccumulator. At end of reading task (stopTracking() called in handleReadingComplete), aggregates to a single EyeMetricsRecord per condition containing: blink_rate, blink_duration_mean, face_presence_ratio, head_pitch_mean, head_yaw_mean, head_roll_mean, head_movement_std, gaze_deviation_ratio, face_size_ratio, camera_active.
If camera is denied/failed, `disabledMetrics()` writes zeros with `camera_active: false`.
**Important
I now have enough to give you a genuinely complete picture of everything not covered before. Here it is, section by section.
## Additional Information: Complete VisuLab2 Deep Dive
### The Original Dark Design System vs. Current White System
This is a significant architectural split that runs through the entire codebase and causes confusion if you don't understand it.
The Tailwind config I read reveals the **original colour palette** — the one that was used from sessions 1–16:
```
bg:      '#0a0a12'   deep navy-black
surface: '#12121e'   slightly lighter navy
border:  '#1e1e35'   dark blue-grey border
accent:  '#4f8ef7'   bright blue
success: '#22c97a'   green
warning: '#f5a623'   amber
danger:  '#e64c4c'   red
muted:   '#5a5a7a'   grey-blue muted text
text:    '#d4d4e8'   light lavender text
bright:  '#ffffff'   pure white
```
Session 17 redesigned all non-task screens to a white/off-white palette. But critically — the Tailwind classes (`bg-lab-bg`, `text-lab-bright`, etc.) were **not removed**. They still exist in the CSS bundle. What happened instead is that newer modules use **inline `style` props** with the white `P` palette object, while older modules still use Tailwind classes. This means the codebase currently has **two coexisting design systems**:
Tailwind dark classes — used in older modules like the original SessionInit, ParticipantProfile, CameraSetup (pre-session 17), AdaptationScreen, and the older ExportDashboard.
Inline style white palette — used in all session 17+ modules: the redesigned CameraSetup, FatigueScale, PauseScreen, SessionManager, LandingPage, ExperimentFlowPanel.
The experiment task screens (ReadingTask, VisualSearchTask, ReactionTimeTask, ComprehensionTask) never used either — they always inherited the active display condition's own colours.
---
### WavyBackground Component — Full Deployment Map
From reading the session 17 transcript's grep output, WavyBackground is used across every non-task screen with carefully tuned opacity and colour:
**White/light-background screens** (wave appears dark/subtle): SessionInit (opacity 0.06, default dark colour), SessionManager (opacity 0.055, default), PauseScreen (opacity 0.055, default), ParticipantSummary (opacity 0.055, default).
**Dark-background screens** (required light wave colour): CalibrationRoutine (bg #0a0a12 → wave colour #c8d8f0 at opacity 0.11), BreakScreen (bg #1a1a2e → colour #c8d8f0 at 0.10), CameraSetup (bg #0a0a12 → colour #c8d8f0 at 0.11), ExportDashboard (bg #0a0a12 → colour #6080a0 at 0.03), FatigueScale (conditioned post-condition screens use conditionBg → wave adapts; baseline uses light colour at 0.10).
The session 17 transcript confirms that before the wave colour fix, dark screens had dark-on-dark waves — effectively invisible. The fix changed dark screens to use `#c8d8f0` (a very light blue-grey) at opacity 0.10–0.11, producing a subtle visible shimmer. ExportDashboard was left at a lower opacity since it has significant chart content.
---
### ReadingTask — Precise Implementation Details
Several things not mentioned before from the direct source read:
The minimum duration is enforced via a **rAF loop, not setTimeout**. The loop computes `elapsed(taskStart.current)` every animation frame and calls `setTimeLeft()` with the remaining seconds. This is consistent with the `timing.ts` policy against using `Date.now()` for experiment timing. The unlock triggers when `el >= CONFIG.READING_MIN_DURATION_MS`.
The **Next button uses condition colours** as its own styling: `backgroundColor: unlocked ? condition.text : condition.text + '40'` and `color: condition.background`. So in C1 (white bg, black text), the button is solid black with white label. In C5 (black bg, white text), it becomes solid white with black label. In C3 (white bg, red text), the button is red with white label. This means the button design is fully condition-matched.
The **page progress bar** at the top of the screen is `condition.text + '20'` for the track and `condition.text + '60'` for the fill — semi-transparent versions of the text colour. At page 2 of 2, the bar reaches 50% width (page index / total pages × 100%).
The **timer display** shows `mins:secs` format only while locked. Once unlocked, the timer disappears and only the button remains, labelled either "Next page →" or "Finished reading →" depending on whether it's the last page.
**Passage titles** appear at the top in uppercase, small (13px), with 50% opacity — very subtle. The title is rendered in Roboto rather than DM Mono.
---
### ComprehensionTask — Precise Behaviour
After the participant taps "Submit Answer", `setSubmitted(true)` fires and `setTimeout(() => onComplete(selected, correct, rt), 1000)` — a 1-second delay. During this second, the option tiles update: the correct answer turns green (`#22c97a`) with a green border, a wrong selection turns red (`#e64c4c`). The participant sees their result for exactly 1 second before the stage advances.
The callback signature is `onComplete(selected: number, correct: boolean, rtMs: number)` — all three values are passed up to App.tsx. However in the App.tsx `handleComprehensionComplete`, the older source only calls `advance(ExperimentStage.VISUAL_SEARCH)` without persisting the comprehension data. Session 10 fixed this — the current App.tsx writes a comprehension record to IndexedDB before advancing. This was the critical comprehension persistence bug discovered in the audit.
The MCQ renders four options as full-width buttons with `border: 2px solid`. The border colour uses condition colours: selected = `tx` (solid text colour), unselected = `tx + '30'` (30% opacity). The background is `tx + '15'` for selected, transparent for unselected.
---
### VisualSearchTask — Word Tokenisation Implementation
The passage is tokenised using `data.text.split(/(\\s+)/)` — a regex with a capturing group, which means whitespace tokens are **preserved as separate array elements** alongside word tokens. The resulting array alternates between word tokens and whitespace tokens. Each token gets: `i` (index), `tok` (original text including punctuation), `isWord` (true if non-whitespace), `isTarget` (true if word stripped of punctuation matches the target lowercased).
Target detection: `tok.replace(/[^a-zA-Z]/g,'').toLowerCase() === target` — strips all non-letter characters before comparing. This correctly handles "carbon." and "carbon," and "carbon" all matching target "carbon".
A **found target** renders with: `backgroundColor: '#22c97a30'` (translucent green) and `borderBottom: '2px solid #22c97a'`. Unfound words have both set to 'transparent'. The green underline appears immediately on tap with a 0.1s CSS transition.
The `finishTask` function records a `VisualSearchRecord` and then calls `setTimeout(() => onComplete(record), 800)` — an 800ms delay during which the "Search Complete" overlay fades in.
The older source shows the stale closure bug (B5/B6 from the audit): `useEffect(() => { const id = setTimeout(() => { if (!done) finishTask(found, falseDet); }, CONFIG.VS_TIME_LIMIT_MS); return () => clearTimeout(id); }, [])` — empty dependency array captures `found` and `falseDet` at mount time (both at zero). This was fixed in session 10 by moving to refs.
---
### ReactionTimeTask — The Old vs. New Paradigm Discrepancy
This is important. The older source (`visulab2-src`) contains the **pre-session-12 RT task** — a simple single-dot go/no-go paradigm:
- Single coloured dot at random position (not a flanker array)
- Instruction: "Click only when the RED dot appears"
- 20 trials (CONFIG.RT_TRIALS_PER_CONDITION = 20)
- Stimulus: single `<div>` with `borderRadius: '50%'` and `boxShadow` glow
- Distractor colours: blue, yellow, green
- No flanker congruency — no flanker arrays at all
The `RTActiveView` in the older source renders a fixation cross in the centre, a single dot at `left: calc(${stim.x}% - 18px)`, and a feedback display during ITI showing the RT in ms for hits.
Session 12 replaced this entirely with the Eriksen colour flanker paradigm. The `RTActiveView` in the current compiled version is completely different — it renders 5 dots in a horizontal array at fixed screen centre, not random positions. The config value `RT_TRIALS_PER_CONDITION` was also changed to 48 (but the config source file was never updated from 20).
**This creates a silent validation bug in ExportDashboard**: the export validation still checks `if (count !== 20)` for trials per condition. With 48 trials, every condition will fail validation and show a warning. The validation message would say: "Condition [UUID]: expected 20 trials, found 48" — for all 8 conditions. This is a known unresolved issue unless it was silently fixed in the current compiled HTML.
---
### RTActiveView — Old Source Details
The older `RTActiveView` component is lean: renders the full-screen touchable div, progress bar (3px height, `tx + '20'` track, `tx + '60'` fill), trial counter (top-right, 30% opacity), fixation cross (two perpendicular 2px lines at screen centre, 40% opacity), and the stimulus dot. The dot has a `dotPop` CSS animation for a 60ms scale-from-zero pop-in effect.
The **dot position** uses `position:'fixed'` with `left: calc(${stim.x}% - 18px)` and `top: calc(${stim.y}% - 18px)`. The 18px offset centres the 36px diameter dot on the coordinate. This means `stim.x = 50` places the dot centre at 50% of viewport width.
For touch devices: `onTouchEnd={e => { e.preventDefault(); onResponse(); }}` with `touchAction:'none'` on the container prevents scroll-through and double-fire.
---
### FatigueScale — Colour Logic and Slider Styling
The slider track uses a CSS linear gradient computed dynamically: `background: \`linear-gradient(to right, ${trackColor(scores[key])} ${scores[key]*10}%, #1e1e35 ${scores[key]*10}%)\`` — the filled portion is the symptom-severity colour, the empty portion is dark navy. This creates a visually split slider rather than a uniform track.
The `trackColor()` function: 0 returns `'#5a5a7a'` (muted, since no symptom), 1–3 returns `'#22c97a'` (green, low), 4–6 returns `'#f5a623'` (amber, moderate), 7–10 returns `'#e64c4c'` (red, severe).
The baseline comparison, shown when `baselineMean !== undefined`, displays `±delta from baseline` below the composite score: positive delta is red (worse), negative is green (better).
**The submit-without-touching flag** (audit F4) is confirmed unfixed in the older source. All sliders default to 0, submit is always enabled. Whether the newer session redesigned FatigueScale to add a `touched` state is not confirmed — the session 17 redesign transcript shows the `minHeight:'100%'` and WavyBackground additions but does not mention adding a touched gate.
---
### AdaptationScreen — SVG Countdown Ring
The countdown uses an SVG circle with `strokeDasharray: 2π×34` (circumference of a circle with radius 34) and `strokeDashoffset: 2π×34×(1 − progress)`. As progress increases from 0 to 1, the dash offset decreases from full circumference to 0, animating the ring fill. The `transform: 'rotate(-90deg)'` on the SVG rotates the starting point to 12 o'clock (top). CSS `transition: 'stroke-dashoffset 0.1s linear'` gives smooth 10Hz updates.
The grey adaptation background is specified as `CONFIG.ADAPTATION_COLOR = '#808080'` — CIE Y luminance ≈18%, which is the approximate perceptual midpoint between black (0%) and white (100%). This is scientifically appropriate for chromatic adaptation — neutral grey minimises adaptation to any particular hue. The 20-second duration is below true full chromatic adaptation (~3–5 minutes for complete recovery) but sufficient for a partial reset, consistent with published adaptation paradigm durations in psychophysics.
The text shows "Condition N of 8 complete · Preparing next display · [next condition name]". The `nextConditionName` prop is computed in App.tsx as `'Condition ${nextIdx + 1}: ${nextCond.polarity === 'positive' ? 'Light' : 'Dark'} background'` — using "Light/Dark background" rather than "positive/negative polarity" to give the participant a meaningful description.
---
### ParticipantProfile — Demographic Collection Details
Age validation: `a < 18 || a > 80` — hard exclusion of participants outside 18–80 years. This is clinically appropriate for VDU research (excludes children and elderly who have different visual accommodation characteristics).
The `Radio` component renders options as a 2-column grid using Tailwind `grid-cols-2`. Selected state: `border-lab-accent bg-lab-accent/10 text-lab-bright`. Unselected: `border-lab-border bg-lab-bg text-lab-muted`. The custom radio dot is a pure CSS circle: `w-3 h-3 rounded-full border-2` that changes from `border-lab-muted` (empty) to `border-lab-accent bg-lab-accent` (filled) when selected. Native `<input type="radio">` is `sr-only` (screen-reader only, visually hidden).
All five fields are required — the submit function checks each in sequence and returns early with an error if any is missing. `baseline_fatigue` is initialised to 0 here and only updated after the subsequent `BASELINE_FATIGUE` stage completes.
The screen is labelled "Step 1 of 4" (CameraSetup is "Step 2 of 4") — though this is the older source; the redesigned flow may have different step numbering.
---
### CameraSetup — Three State Machine
**Step 'notice'**: Privacy notice in a blue accent box. Lists what IS saved (blink rate, head movement, gaze) and what ISN'T (images, video recordings). Lighting instruction: "Sit facing the screen with face clearly visible. Avoid backlighting." Two buttons: "Allow Camera Access →" and "Skip — continue without camera."
**Step 'preview'**: Live `<video>` element with `scale-x-[-1]` Tailwind class (horizontal mirror — CSS `transform: scaleX(-1)`) so the participant sees themselves as in a mirror rather than as others see them. A pulsing green dot indicator: `animate-pulse-slow` (2s cubic-bezier pulse). "Camera Active" text. Face should be clearly visible in the frame. "Camera Confirmed — Continue →" button advances to BASELINE_FATIGUE.
**Step 'denied' / 'failed'**: Distinguishes between `NotAllowedError` / `PermissionDeniedError` (user denied) vs other hardware errors. Both show different styling but both advance with "Continue Without Camera →". The advance dispatches the appropriate `cameraStatus` ('denied' or 'failed') so downstream modules know why camera data is absent.
The camera stream is stored as `(window as any).__visulab_stream = stream` — a global window property used by App.tsx to attach to the hidden video element. This global is the bridge between the setup phase and the main experiment.
---
### useFullscreen Hook — Full Behaviour
The hook has three `useEffect` blocks:
First: the fullscreen change listener — monitors `fullscreenchange` and `webkitfullscreenchange` and updates `isFullscreen` state by checking `document.fullscreenElement || document.webkitFullscreenElement`.
Second: the `beforeunload` guard — `window.addEventListener('beforeunload', guard)` where guard does `e.preventDefault(); return (e.returnValue = 'Experiment in progress. Leave?')`. This fires the browser's native "Leave page?" dialog if the user tries to navigate away or close the tab. Critical for tablet use where accidental swipes might trigger navigation.
The `enterFullscreen` function tries `el.requestFullscreen()` first, then `el.webkitRequestFullscreen()` — handling both standard and WebKit prefixed versions. On Xiaomi Pad 6 with Chrome/WebView, the webkit prefix may be needed.
The hook returns `{ isFullscreen, enterFullscreen }` — no `exitFullscreen` is exposed, which is intentional. The researcher cannot programmatically exit fullscreen from the app.
---
### timing.ts — The High-Precision Delay Function
The `rafDelay` function is significant:
```typescript
export const rafDelay = (ms: number): Promise<void> =>
  new Promise(resolve => {
    const start = performance.now();
    const tick = () => {
      if (performance.now() - start >= ms) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
```
This implements a busy-wait via rAF rather than `setTimeout(resolve, ms)`. The reason: `setTimeout` on Android WebView is throttled and imprecise — often fires 4–15ms late. For the RT task timing (fixation period, delay period, ITI), being 15ms off on a 500ms fixation is a 3% error. The rAF approach fires every 16.7ms (60fps), checks elapsed time, and resolves as soon as the target duration passes. Maximum error: one frame period (16.7ms). This is used throughout all timing-critical task phases.
`randInt(min, max)` is inclusive on both ends: `Math.floor(Math.random() * (max - min + 1)) + min`.
---
### stats.ts — Population vs. Sample Standard Deviation
The `std` function uses **population standard deviation** (divides by N, not N-1): `Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length)`. This is a deliberate choice — for eye tracking frame accumulation, we are computing descriptive statistics over the complete set of frames captured during a task, not estimating a population from a sample. Population SD is appropriate here.
For N < 2, returns 0 (cannot compute a meaningful SD from one value).
---
### deviceInfo.ts — Tablet Detection Logic
`isAndroid` = `/Android/i.test(ua)` — checks for "Android" in the user agent string.  
`isTablet` = `isAndroid && !/Mobile/i.test(ua)` — Android tablets do NOT include "Mobile" in their user agent, while Android phones do. This is the standard Android tablet detection heuristic.
On a Xiaomi Pad 6 running Chrome, the user agent will contain "Android" but not "Mobile", so `device_type` will be `'Android Tablet'`.
Browser detection extracts version numbers: Edge is detected before Chrome because Edge's UA contains both "Edg/" and "Chrome/".
`screen_resolution` uses `window.screen.width × window.screen.height` — this is the physical pixel resolution, not the CSS viewport size. On the Xiaomi Pad 6 with a 2880×1800 display, this records the physical resolution even if the CSS viewport is scaled differently.
---
### ExportDashboard (Older Version) — What It Exports
The older export dashboard generates exactly **7 CSV files + 1 JSON bundle**:
participants.csv — 1 row per participant  
sessions.csv — 1 row per session  
conditions.csv — 8 rows (one per condition)  
reaction_trials.csv — 160 rows (20 trials × 8 conditions in older version, 384 in current)  
visual_search.csv — 8 rows (one per condition)  
eye_metrics.csv — 8 rows (one per condition)  
fatigue_scores.csv — 9 rows (1 baseline + 8 post-condition)  
session_[PID]_[SID8].json — complete bundle with all tables nested
The `toCSV` function escapes values containing commas or quotes: wraps them in double-quotes and doubles any internal quotes (`"`→`""`). Uses `Object.keys(rows[0])` to determine column order — the first row's key order determines the CSV header, so column order depends on object property insertion order (consistent in V8/Chrome).
The `download` function creates a temporary `<a>` element, sets `href` to a `URL.createObjectURL()` blob, programmatically clicks it, then removes the element. On Android Chrome, this triggers the native download manager.
---
### Validation Logic — The 20-Trial Discrepancy
The validation in the older ExportDashboard checks:
```javascript
if (count !== 20) messages.push(`Condition ${cid}: expected 20 trials, found ${count}`);
```
With the current 48-trial flanker paradigm, this produces 8 validation warnings for every single participant. The export still works — validation warnings don't block export — but the validation panel shows amber "Data validation warnings" instead of green "Data validation passed." Whether the current compiled HTML has been updated to check for 48 trials instead of 20 is unknown from available sources and needs verification.
---
### The Full Module List — Components Not in visulab2-src
The session 17 transcript's file listing reveals modules that exist in the current compiled version but not in the older `visulab2-src`:
`src/modules/calibration/CalibrationRoutine.tsx` — added session 5  
`src/modules/diagnostic/BreakScreen.tsx` — added session 5  
`src/modules/diagnostic/DiagnosticConsole.tsx` — added session 5  
`src/modules/session/PauseScreen.tsx` — added session 13  
`src/modules/session/LandingPage.tsx` — added session 15  
`src/modules/session/SessionManager.tsx` — added session 11  
`src/modules/export/ParticipantSummary.tsx` — added session 12  
`src/modules/session/DisplayPerceptionRating.tsx` — added session 5  
`src/components/ui/WavyBackground.tsx` — added session 15  
`src/components/ui/ExperimentProgress.tsx` — added early, significantly redesigned session 17+  
`src/components/ui/FullscreenGuard.tsx` — present from early sessions  
`src/utils/sessionPersistence.ts` — added session 11  
`src/utils/performanceLogger.ts` — added session 16  
All of these are in the compiled HTML but their source is not readable in the older `visulab2-src` snapshot.
---
### ParticipantSummary — Session Completion Flow
Added session 12. Shown on `SESSION_COMPLETE` stage (before researcher accesses the export dashboard). Contains:
A confetti animation on completion — CSS-based particle animation celebrating session completion.
A **PIN gate**: the researcher must enter a PIN before gaining access to the export dashboard. The PIN is displayed as filled/empty dots (like a mobile unlock screen). This prevents participants from accidentally navigating into researcher data during the session if the researcher steps away.
A summary of key statistics (conditions completed, trial count, etc.) visible without the PIN — but the "Export Data" button is locked until PIN is entered correctly.
The WavyBackground here uses opacity 0.035 and colour '#8090b0' on the dark outer wrapper.
---
### BreakScreen — Structure and Purpose
Different from AdaptationScreen. BreakScreen (`BREAK_SCREEN` stage) is a researcher-controlled extended break, distinct from the automatic 20-second AdaptationScreen between every condition.
Background: `#1a1a2e` (dark navy-purple), WavyBackground at opacity 0.10 colour '#c8d8f0'.
Two-column layout (from the grep output): left ~58% contains the break countdown and participant-facing content; right 42% is `#0a0a12` and contains researcher controls.
A `canContinue` state controls whether the "Continue" button is active — the researcher must confirm the participant is ready before advancing. Button colour: `canContinue ? '#4f8ef7' : '#1e1e35'`.
The SVG countdown ring at 72px with `margin: '0 auto 18px'` is the same pattern as AdaptationScreen.
---
### CalibrationRoutine — What It Actually Does
Two views: a main calibration view and a results view (confirmed by the WavyBackground appearing twice in the grep — once at `#0a0a12` bg, once at line 132 inside the results panel).
The calibration targets are shown at 9 screen positions (from the session 5 spec: corners, edge midpoints, and centre). The participant taps each target. EAR and FaceMesh landmarks are read while the target is displayed.
The critical audit finding (F1) confirmed that calibration data is stored as `{ label, h: 0, v: 0 }` — hardcoded zeros. The calibration screen runs for 15 seconds total, the results view shows pass/fail indicators based on whether the face was detected (`ok ? '#22c97a' : '#e64c4c'`), and `allOk` determines if all 9 positions were successfully detected (`allOk ? '#22c97a15' : '#e64c4c15'` for background colour).
In practice, the calibration functions as a **face positioning and lighting check**, not an actual gaze calibration. The system verifies the camera can see the participant's face from all screen regions, but does not use the tap positions to calibrate iris offset estimation.
---
### PWA Configuration and Deployment
From `vite.config.ts`:
- `display: 'fullscreen'` — when installed as PWA, launches in fullscreen with no browser chrome
- `orientation: 'landscape'` — locks to landscape in the PWA manifest
- `theme_color: '#0a0a12'` — browser status bar colour when running (dark navy, pre-redesign colour)
- `background_color: '#0a0a12'` — splash screen background
- `workbox.globPatterns: ['**/*.{js,css,html,ico,png,svg}']` — caches all static assets for offline use
- `registerType: 'autoUpdate'` — service worker auto-updates when a new version is detected
The PWA capability means the experiment can be installed on the Xiaomi Pad 6 as a standalone app via Chrome's "Add to Home Screen." When launched this way, it runs fullscreen with landscape lock, behaves like a native app, and works offline (all assets cached by the service worker). MediaPipe FaceMesh model files are loaded from CDN (`cdn.jsdelivr.net`) — these require an internet connection on first load, but once cached by the service worker, work offline.
The `vite-plugin-pwa` plugin handles service worker generation automatically from the `workbox.globPatterns`.
---
### The session → DB write flow (data integrity chain)
Every write is immediate — no buffering, no transaction batching:
```typescript
const put = async <T>(store: string, record: T): Promise<void> => {
  const db = await getDB();
  await db.put(store, record);
};
```
Writes go in this sequence per condition:
1. `DB.sessions.put(session)` — at SessionInit
2. `DB.participants.put(participant)` — at ParticipantProfile
3. `DB.fatigue_scores.put(baselineRecord)` — at BASELINE_FATIGUE complete
4. `DB.conditions.put(condRecord)` — in `ensureConditionRecord()` when READING_TASK starts
5. `DB.eye_metrics.put(metrics)` — in `handleReadingComplete` (immediately after reading ends)
6. `DB.reaction_trials.put(trial)` — per individual trial during RT task (up to 48 writes)
7. `DB.visual_search.put(record)` — in VisualSearchTask's `finishTask`
8. `DB.fatigue_scores.put(postRecord)` — at POST_FATIGUE complete
9. `DB.conditions.put({...condRecord, completed_at: Date.now()})` — in `handlePostFatigue`
This means: if the app crashes during the RT task, all trials up to that point are already in IndexedDB. The condition record will have `completed_at: null` (not yet marked complete), which the export dashboard will flag. But no RT trial data is lost mid-task.
---
### The main.tsx Startup Sequence
```typescript
getDB().then(() => console.info('[VisuLab] DB ready')).catch(console.error);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
```
The DB is warmed up concurrently with React's render. Since IndexedDB operations are async, the DB may not be ready when the first render happens. The `getDB()` function uses a singleton pattern (`if (_db) return _db`) — only one connection is ever opened, and subsequent calls return the cached promise. Any component trying to write during the first few milliseconds races against DB initialisation, but the `put` helper awaits `getDB()` so writes queue naturally.
`React.StrictMode` in main.tsx causes every `useEffect` to fire twice in development mode (React 18 behaviour). This can cause the camera `getUserMedia` to be requested twice, the FaceMesh model to attempt loading twice, and IndexedDB connections to open twice. In production builds, StrictMode has no runtime effect — it only affects development behaviour. The compiled `VisuLab2.html` is a production build, so StrictMode double-firing does not occur during actual experiment use.
---
### The Data Points Figure — Precise Breakdown
From the session 13 transcript (the most authoritative enumeration):
RT trial matrix: 384 trials × 13 fields = **4,992 data points** — constitutes ~86% of all data.
Everything else: demographics (73), fatigue (54), RT summaries (104), visual search (104 scalar + click arrays), reading/comprehension (48), eye tracking (224), display perception (48).
**Total scalar: ~5,647–5,800 per participant.**
At N=150: approximately **847,050–870,000 scalar data points** in total across all participants, plus approximately **57,600 individual RT trial records** in the reaction_trials table.
The complete JSON bundle per participant is approximately 200–400KB depending on trial count and eye tracking frame density.
---
### One Critical Unknown
The `FullscreenGuard` component is referenced everywhere but its source is not in the older `visulab2-src`. From session 6-7 transcripts, it was initially blocking the experiment when fullscreen was lost, then fixed to show a soft prompt. Its current behaviour: when `isFullscreen` is false and the stage is not in a safe-to-leave list, it shows an overlay prompting "Return to fullscreen" with a button to re-enter. The experiment does not stop — data collection is not interrupted — but the overlay covers the content until fullscreen is restored. This was the correct fix: blocking the experiment mid-task to enforce fullscreen would corrupt the RT timing and other time-sensitive measurements.