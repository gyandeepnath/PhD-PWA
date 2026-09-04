# Audit round 2 — raw findings

Six dimensions over the recently-changed code. **The verification pass did not complete:** 158 of
168 agents failed on a session rate limit, so only ONE finding below carries independent
adversarial verification. Everything else is an auditor's claim that I have not yet checked, and
must be treated as a lead rather than a fact. Five have since been verified by hand and fixed;
they are marked. The rest are open.

Total findings: 54

## [critical] resetRtTargetMemory() is never called on the RESUME path, so the 'target colour CHANGED' banner is suppressed exactly when the rule inverts — or fires spuriously from the previous participant

**STATUS: VERIFIED (3/3 verifiers), NOT YET FIXED.** All three verifiers confirmed the mechanism and independently argued severity is medium, not critical: the instruction screen always names the target colour and shows the real dot, so the rule is stated even when the emphasis banner is wrong; exposure is one block per resume.

`src/experiment/Experiment.tsx`:428

**Evidence claimed:** grep over the whole tree: `resetRtTargetMemory` has exactly ONE call site — Experiment.tsx:428, inside `beginSession`. The resume effect (Experiment.tsx:187-282) rehydrates the session from IndexedDB, rebuilds `sittingPlan`, and sets the machine straight to READING_TASK / a setup stage; it never calls `beginSession` and never touches the module state. App.tsx:44-52 remounts `Experiment` on a key change but never reloads the page, so `let lastTargetColor` (ReactionTimeTask.tsx:98) is app-lifetime state, not session state.

**Failure scenario:** Two concrete failures. (a) Page-reload resume: participant's Williams order runs conditions 1-5 positive (black target), the tablet reloads during condition 6 (first negative, white target), the operator taps Resume. Module state is gone, so `lastTargetColor === null` and `targetChanged` (ReactionTimeTask.tsx:148) is false — NO banner at the one transition the banner exists for. (b) In-tab resume: participant A finishes a sitting ending on a negative block (lastTargetColor='#FFFFFF'), the operator returns to the manager (onExit -> toManager, no reload) and hits Resume for participant B, whose next condition is positive. B sees 'The target colour has CHANGED for this block' on their FIRST resumed block, when nothing changed for them. The reverse pairing suppresses a genuine change.

**Impact:** The comment at Experiment.tsx:421-427 asserts precisely this safeguard ('without this a fresh participant could be shown "the target colour has CHANGED" on their very first block, or - worse - have a genuine change suppressed because the previous participant happened to end on the same polarity'). The safeguard exists only on the new-session path; on resume the comment is false. A missed go-rule switch does not look like an error in the data — as the file's own comment says at ReactionTimeTask.tsx:400-405, it looks like a polarity effect on d-prime and hit rate, which is the study's primary display contrast. Resumes are not rare: the code says camera setup and calibration are re-run on every resume because remounting clears the EAR baselines, i.e. resume is a designed, expected path.

**Proposed fix:** In the resume effect (after `setPlan(sittingPlan)`), seed the memory from the plan instead of leaving it stale: if `loopTarget > 0`, compute the previous condition's background from `CONDITIONS[sittingPlan[loopTarget-1].conditionIndex]` and call a new `setRtTargetMemory(goTargetColor(prevBackground))`; if `loopTarget === 0`, call `resetRtTargetMemory()`. That makes the banner correct on resume rather than merely absent. Belt and braces: also call `resetRtTargetMemory()` unconditionally at the top of the resume effect so a cross-participant carry-over can never survive, and consider moving the memory out of module scope into the Experiment-level ref that already tracks per-sitting state.

## [critical] comprehension_correct exports a PROPORTION but is documented and denominated as a COUNT out of 3

**STATUS: VERIFIED BY HAND AND FIXED.** buildConditionSummaries returns 0, 1/3, 2/3 or 1; the codebook called it a count out of 3 and told the analyst to model it binomially. Now counted from the item records as a true integer, with the denominator counted rather than assumed.

`src/storage/analysisExport.ts`:210

**Evidence claimed:** analysisExport.ts:210-211 writes `comprehension_correct: sum.comprehension_correct,` and `comprehension_items: QUESTIONS_PER_PASSAGE,` (=3). But src/dashboard/aggregate.ts:401 defines that field as a RATE, not a count: `comprehension_correct: comp.length ? comp.filter((x) => x.is_correct).length / comp.length : null,`. Running the exporter on the repo's own fixture gives the column values `0 | 0 | 0.3333333333333333 | 0.3333333333333333 | 0 | 1 | 0 | 0.3333...` beside comprehension_items = 3. The codebook (analysisCodebook.ts:132-135) declares unit 'count' and instructs 'Correct items out of comprehension_items. Model binomially against that denominator rather than as a proportion.'

**Failure scenario:** A participant answers 1 of 3 comprehension items correctly. The exported row is comprehension_correct=0.3333333333333333, comprehension_items=3. An analyst following the codebook fits `cbind(comprehension_correct, comprehension_items - comprehension_correct)` in a binomial GLMM, i.e. 0.33 successes out of 3 instead of 1 out of 3. Every non-zero, non-perfect score is shrunk by a factor of 3; 2/3 correct is reported as 0.667/3.

**Impact:** The task-performance outcome (reading comprehension, one of the three outcome families in the title) is systematically wrong. Binomial weights are wrong for every row, non-integer 'successes' will make lme4/glmer warn or silently round, and the comprehension means reported in the thesis are ~1/3 of the true accuracy for any row that is not 0 or 1. Also the denominator is a constant 3 even when fewer items were administered, so a condition with 2 recorded items is modelled against 3.

**Proposed fix:** Export the raw count and the real denominator: build them from the bundle's comprehension records for this condition (`const comp = b.comprehension.filter(x => x.condition_id === sum.condition_id)`), writing `comprehension_correct: comp.length ? comp.filter(x => x.is_correct).length : null` and `comprehension_items: comp.length || null`. If the proportion is wanted too, add a separately named `comprehension_accuracy` column and document it. Do not leave a column named '_correct' with unit 'count' holding a rate.

## [critical] The monitor's blink count is structurally always "—": the aggregator exists only during READING_TASK, and the monitor is hidden during READING_TASK

**STATUS: VERIFIED BY HAND AND FIXED.** beginCondition/endCondition bracket READING_TASK only, and the monitor is hidden during READING_TASK, so the live count was never available on any screen the monitor appears on. It now reports the counts the last exposure finished with, labelled 'last' rather than 'blinks'.

`src/tracking/useTracking.ts`:225

**Evidence claimed:** useTracking.ts:211,225 — `const agg = aggRef.current;` … `const live = agg?.liveCounts(baselineEarRef.current);` then `blinks: live?.blinks ?? null`.
Aggregator lifetime (only two call sites in the whole repo, confirmed by grep): Experiment.tsx:903 `tracking.beginCondition()` inside `<ReadingTask onBegin=…>`, and Experiment.tsx:925 `await tracking.endCondition(...)` inside `onComplete`. useTracking.ts:435 then sets `aggRef.current = null`.
Monitor visibility (Experiment.tsx:1182-1187): `tracking.status === 'active' && isInLoop(machine.stage) && machine.stage !== 'READING_TASK' && machine.stage !== 'ADAPTATION'`.
The two windows are exact complements. In every stage where the monitor renders (COMPREHENSION, DISPLAY_PERCEPTION, POST_FATIGUE, VISUAL_SEARCH, REACTION_TIME) `aggRef.current` is null, so `agg?.liveCounts(...)` short-circuits to `undefined`.

**Failure scenario:** Operator runs a real sitting with a working camera, a valid EAR baseline and a face in frame. The monitor renders `face  blinks — (— inc)  31 fps  open 0.98` with a green dot, for every visible stage, for all ten conditions of both sittings. The blink count never shows a number and never climbs — not because tracking failed, but because the counter is only alive on the one screen where the panel is suppressed.

**Impact:** The component's stated purpose is defeated end-to-end. TrackingMonitor.tsx:15-16 says the readout shows "the blink count, which IS the primary outcome accumulating, and which must keep climbing" and "the incomplete count within it, the numerator of the outcome itself". Neither can ever be non-null. The operator gets a green light plus two em-dashes and, per the file's own framing, goes on running ninety minutes on trust — the exact failure the component was written to end. No data is corrupted, but the only mid-session safeguard on the primary outcome does not exist.

**Proposed fix:** Decouple live counting from the export aggregator's lifetime. Either (a) keep the aggregator alive across the whole condition — call `beginCondition()` at condition entry and `endCondition()` at condition exit, and have `finalize()` slice to the reading window using the recorded begin/end timestamps — or (b) give useTracking a separate long-lived `liveAggRef` that spans the condition and is reset in the ADAPTATION→READING transition, and drive `liveCounts` from that. Then add a test that renders TrackingMonitor at stage REACTION_TIME with a fitted baseline and asserts `blinks` is a number, not null. Note there is currently no test anywhere that touches subscribeLive/liveCounts (grep over src+tests returns only the definitions).

## [critical] Face loss is never reported while the monitor is visible — the no-face emit is gated on the aggregator, so the readout freezes showing a green dot and "face"

**STATUS: VERIFIED BY HAND AND FIXED.** The no-face emit was gated on the aggregator, which exists only during reading, so losing the face outside reading emitted nothing and the readout froze green. The branch is now unconditional.

`src/tracking/useTracking.ts`:235

**Evidence claimed:** useTracking.ts:235 `} else if (aggRef.current) {` — the entire no-face branch, including its `emitLive(t, { facePresent: false, ... })` at line 237, is conditional on an aggregator existing. Per the finding above, `aggRef.current` is null in every stage where the monitor is rendered. So on a face-present→face-absent transition during COMPREHENSION / VISUAL_SEARCH / REACTION_TIME, `ingestResult` takes the else-branch, the guard fails, and nothing is emitted at all.
TrackingMonitor.tsx:44 `const [s, setS] = useState<LiveTrackingStats | null>(null)` retains the last payload; line 53 `const face = s?.facePresent ?? false`; line 60 `const dot = !face ? '#d14343' : fpsLow ? '#c98a22' : '#22c97a'`.

**Failure scenario:** Participant leans back out of frame, or the room dims below detection, at any point during the visual-search or reaction-time block. FaceMesh starts returning no landmarks. No further payload is emitted, so `s` keeps the last face-present value: the dot stays green (#22c97a), the label stays `face`, the fps freezes at its last good value, and `open 0.97` stays frozen on screen indefinitely. The monitor is visually indistinguishable from healthy tracking.

**Impact:** Inverts the safety property. TrackingMonitor.tsx:8-11 names "the participant leans out of frame" as the first failure the panel exists to surface, and the red dot is the mechanism. That mechanism can only fire before the first face is ever seen (`s === null`); once a face has been seen it can never return to red. The operator is actively reassured during precisely the failure the panel was built to catch. Combined with the finding above, every state the monitor can display during a real sitting is `green + face + — blinks`, whether tracking is perfect or the participant has left the room.

**Proposed fix:** Move the live emission out of the aggregator-conditional entirely. Restructure `ingestResult` so `emitLive` is called exactly once per FaceMesh result on both branches, independent of `aggRef.current`, and keep only `agg.ingest(...)` inside the aggregator guard. Additionally, make staleness explicit rather than implicit: have TrackingMonitor treat a payload older than ~1 s (compare an emitted `t` against `now()` on a low-rate interval) as unknown and render the red/absent state, so a stalled pump can never present as healthy.

## [critical] No code path exists to revoke media consent or delete retained photos/video, yet media.ts, PROTOCOL.md and the ethics section of the synopsis all state that one does

**STATUS: CONFIRMED BY AGENT AND FIXED (code); DOCS STILL NEED CORRECTING.** The separate-store half of the promise was true; independent deletion existed nowhere, and the only button that removed a video was Purge, which destroys the whole sitting. `revokeMediaGrant(sessionId, grant)` now withdraws one grant and deletes only the recordings it covered — consent first, blobs second, so a part-way failure leaves survivors already covered by a withdrawn grant. **Outstanding: the synopsis submitted to the IEC (SYNOPSIS_AdtU.md §3.10) states retained media are 'deletable independently of it'. That is now true of the code, but the sentence was false when submitted — flag it to the supervisor. A SessionManager control still needs wiring.**

`src/storage/media.ts`:27

**Evidence claimed:** media.ts:27-28 header: " - Media is deletable independently of the research data, so a later withdrawal of media consent does not force discarding the numeric dataset."  docs/PROTOCOL.md:184-185: "Media lives in its own `media_captures` store and is deletable independently of the research data, so withdrawing media consent later does not force discarding the numeric dataset."  synopsis/SYNOPSIS_AdtU.md:437 (the IEC-facing ethics paragraph): "retained media are held apart from the research dataset and deletable independently of it."  Verified against the code: `grep -rn "media_consent" src` shows exactly two writes — `media_consent: noMediaConsent()` at Experiment.tsx:457 (session creation) and `media_consent: media` at Experiment.tsx:657 (the one-time CONSENT screen). Every other reference is a read. `grep -rn "media_captures" src` shows exactly one deletion: gather.ts:195, `for (const r of bundle.media ?? []) await remove('media_captures', r.media_id);` — which sits inside `purgeSession()`, whose next 20 lines also remove conditions, fatigue, cvsq, tlx, comprehension, perception, visualSearch, eyeMetrics, rtSummaries, calibration, reactionTrials, the participant row and the session itself. SessionManager.tsx exposes only Rename / Delete (soft) / Restore / Purge — no media control at all.

**Failure scenario:** A participant in the validation subsample consents to annotation video at sitting 1. At sitting 2 they say they are no longer comfortable with the clips being kept and ask for them to be deleted, while wanting to remain in the study. The operator opens Session Manager and finds no control that touches media. The only button that removes the video files is 'Purge', which permanently destroys the entire sitting: all 10 condition rows, 320 reaction trials, both CVS-Q administrations, the NASA-TLX and the participant record. The operator either destroys usable research data the participant did not ask to withdraw, or — the likely outcome — keeps the video because nothing else is possible, in direct breach of the representation made to the ethics committee.

**Impact:** The instrument does not implement a capability that the submitted synopsis (§ ethics, SYNOPSIS_AdtU.md:437 and SYNOPSIS_AdtU_Short.md:384) asserts to the Institutional Ethics Committee. Any media-consent withdrawal during the ~2-year collection window is either unhonourable or costs a complete sitting. Under the project's own rule that a comment asserting a safeguard that does not exist is a finding, three separate documents are false in the same way.

**Proposed fix:** Add `revokeMediaGrant(sessionId, grant)` to storage/gather.ts that (a) writes the updated `media_consent` back to the session record and (b) removes every `media_captures` row whose `requiredGrant(checkpoint)` equals the revoked grant, leaving all other stores untouched. Surface it in SessionManager as a per-session 'Media' control listing the retained items with a Delete action, and record the revocation on the session (e.g. `media_consent_revoked_at`, `media_revoked_grants`) so the export can state that media existed and was removed on request rather than that none was ever captured. Until that exists, delete the three false claims from media.ts, PROTOCOL.md and the synopsis.

## [critical] Soft keyboard permanently locks the running-minimum floor at MIN_SCALE, halving every stimulus for the rest of the sitting

**STATUS: VERIFIED BY HAND AND FIXED.** Reproduced: 1152x650 -> keyboard 1152x300 -> floor locks at 300, scale locks at MIN_SCALE, and every subsequent reading exposure renders at half size for the rest of the sitting. Transient occlusions are now rejected from the floor. Fixing it exposed a second bug the tests caught: a narrow occlusion flipped the h>w orientation test and was misread as a rotation, discarding the floor entirely.

`src/lib/viewportScale.ts`:143

**Evidence claimed:** foldViewportFloor() folds EVERY visualViewport measurement into a monotone running minimum:

  floorW = Math.min(floorW, w);
  floorH = Math.min(floorH, h);

measure() deliberately reads window.visualViewport, and index.html sets no `interactive-widget` value, so Chrome's default `resizes-visual` applies: the Android on-screen keyboard shrinks visualViewport.height and fires a visualViewport `resize`. That shrunken height is folded into the floor and can never be un-folded — resetViewportFloor() is only wired to `orientationchange` (installViewportScale, line 188-194), and the orientation-flip branch at line 136 does not trigger because in landscape h stays < w with the keyboard open. vite.config.ts pins the installed PWA to `orientation: 'landscape'` and `display: 'fullscreen'`, so the study runs in exactly the orientation with no escape hatch (and with no address bar, the address-bar rationale the floor exists for does not even apply).

Empirically (npx tsx against the real module, Xiaomi Pad 6 landscape 1152x650, which the file's own header names as the target device):

  load, address bar showing                 1152x650 -> floor 1152x650 -> scale 0.76
  operator taps Participant ID, OSK opens   1152x250 -> floor 1152x250 -> scale 0.5
  OSK dismissed after Begin setup           1152x650 -> floor 1152x250 -> scale 0.5
  reading task                              1152x650 -> floor 1152x250 -> scale 0.5

SESSION_INIT (stateMachine.ts SETUP_ORDER[0]) is the very first screen and setupStages.tsx:103 puts a free-text Participant ID input on it, so the keyboard opens before any stimulus is ever shown.

**Failure scenario:** Operator opens VisuLab on the Xiaomi Pad 6, taps the Participant ID field on SESSION_INIT, the Android keyboard opens (visual viewport 1152x250) and closes again. --vl-scale is now 0.5 and stays 0.5 for every screen of the sitting. CONFIG.READING_FONT_SIZE_PX 22 renders at 11 CSS px; CONFIG.RT_DOT_PX 52 renders at 26 CSS px; #root's layout box becomes 2304x1300 so percentage-based margins stretch the reading column to roughly double the design line length.

**Impact:** Visual angle is the study's controlled variable and it is halved for the entire sitting by an incidental UI event. Every within-participant reading, visual-search and RT measure is taken at a stimulus size the protocol never specifies, and — because ambient illumination is a SESSION-level factor across two sittings — a keyboard-triggered collapse in one sitting and not the other makes stimulus size vary systematically WITH the 10-lux/150-lux factor for that participant. The primary outcome is not spared: incomplete-blink ratio during reading is measured while the participant reads 11 px text at an unintended viewing angle, and blink behaviour is size/accommodation dependent.

**Proposed fix:** Do not fold a keyboard-shrunk measurement into the floor. Concretely, in apply()/foldViewportFloor, ignore any visualViewport measurement whose height is materially below the layout viewport (e.g. `vv.height < window.innerHeight * 0.8` — the OSK shrinks the visual viewport but not the layout viewport), and additionally call resetViewportFloor() on `focusout` of the document and on `screen.orientation.change`. Failing that, drop the running minimum entirely on the installed PWA path: display:'fullscreen' means there is no address bar to stabilise against.

## [critical] min-h-screen (100vh) inside the scaled root under-fills #root, exposing a bright cream band that is visible ONLY in negative-polarity conditions

**STATUS: VERIFIED BY MEASUREMENT AND FIXED.** Measured at 1152x650 (scale 0.76): the fatigue and display-perception panels rendered 650 CSS px inside an 855 px root, a 205px band; comprehension 114px. On a negative-polarity condition that band is a bright strip present in one level of the primary IV and not the other. The five condition-coloured screens now use `.screen` (height:100%, root-relative). e2e/stimulusFill.spec.ts pins it and was checked against the reverted markup.

`src/tasks/TaskIntro.tsx`:29

**Evidence claimed:** theme.css:54-55 gives #root `height: calc(100% / var(--vl-scale))`, i.e. viewportPx/scale. `min-h-screen` is Tailwind 3.4.19's `min-height: 100vh` (verified in node_modules/tailwindcss/stubs/config.full.js:677), and vh measures the raw viewport, not the transformed root. So for scale < 1 the child is SHORTER than the box it sits in and its background stops early. #root has `background: #f8f7f5` (theme.css:56), body the same, so the uncovered strip paints cream.

Four condition-coloured stimulus screens are block children of #root with min-h-screen and NO height:100%:
  - src/tasks/TaskIntro.tsx:29 (rendered with `background={background}` from the condition — ReadingTask.tsx:109 and VisualSearchTask.tsx:126)
  - src/tasks/ComprehensionTask.tsx:95 (Experiment.tsx:950 passes cond.background)
  - src/scales/DisplayPerceptionRating.tsx:34 (Experiment.tsx:974 passes cond.background)
  - src/scales/FatigueScale.tsx:59 (Experiment.tsx:992 passes cond?.background)
ReadingTask.tsx:146 and VisualSearchTask.tsx:155 escape this only because they carry an explicit inline `height: '100%'`; Cvsq.tsx escapes it by using the `.screen` class. The other four were not converted.

conditions.ts:66-70 sets every negative condition's background to #000000 and every positive one to #FFFFFF. Against #FFFFFF the cream strip (#F8F7F5) is invisible; against #000000 it is a maximum-contrast white band.

Magnitude at scale 0.76 on 1152x650: root height 855 root-px, child 720 root-px (Chrome resolves vh against the large viewport) -> 135 root-px uncovered = 103 device px. At the stuck scale 0.5 from the finding above: root 1300, child 720 -> 580 root-px = 290 device px, ~45% of the panel.

**Failure scenario:** Participant runs condition N3 (red on black). The TaskIntro before reading, the comprehension screen, the display-perception rating and the post-condition fatigue scale each render a black panel across the top and a bright cream band across the bottom third of the tablet. In P3 (red on white) the identical layout shows nothing unusual.

**Impact:** The rendering artifact is perfectly confounded with display polarity, the study's primary IV. Negative-polarity conditions carry extra screen luminance and a hard light/dark edge that positive-polarity ones do not, on precisely the screens that collect the subjective DVs (DisplayPerceptionRating comfort/clarity, FatigueScale post-condition). Any polarity main effect on comfort, clarity or self-reported fatigue is contaminated by an artifact of the scaler, and it also breaks the light-adaptation control the ADAPTATION grey field exists to enforce.

**Proposed fix:** Replace `min-h-screen` with the `.screen` class (theme.css:83, `height:100%; min-height:100%`) on TaskIntro.tsx:29, ComprehensionTask.tsx:95, DisplayPerceptionRating.tsx:34 and FatigueScale.tsx:59 — and audit the remaining min-h-screen usages. Add a guard test that no element carrying a condition background also carries min-h-screen.

## [high] computeSdt exports hit_rate = 0 and false_alarm_rate = 0 for pools it did not measure, contradicting the hits/signal_trials in the same CSV row

`src/lib/signalDetection.ts`:78

**Evidence claimed:** Lines 74-82: `if (nSignal === 0 || nNoise === 0) { return { hit_rate: 0, false_alarm_rate: 0, d_prime: null, ... estimable: false }; }`. Run empirically: `computeSdt({hits:18, misses:2, falseAlarms:0, correctRejections:0})` -> `{"hit_rate":0,"false_alarm_rate":0,"d_prime":null,...}`. ReactionTimeTask.tsx:342-343 assigns `hit_rate: sdt.hit_rate` straight into the summary; storage/types.ts:422 types it `number` (non-nullable); export.ts:651 writes it to 09_rt_summary.csv; export.ts:396 documents it as 'hits divided by signal trials'.

**Failure scenario:** nNoise = falseAlarms + correctRejections = 0 whenever every one of the 12 no-go trials was scored 'anticipation' (RT < 150 ms) — a rhythmically-tapping, disengaged participant, which is the phenotype this task exists to detect. The block then exports hits=18, signal_trials=20, hit_rate=0.0. The same row asserts a hit rate of 0 and a hit count of 18. Symmetrically, all-anticipated go trials export false_alarm_rate=0 while false_alarms may be 3. The 'block never ran' case exports both rates as 0 too.

**Impact:** Violates the project's no-fabrication rule directly: 0 here means 'not measured', and 0.0 is a value an analyst will average alongside real rates. hit_rate and false_alarm_rate are role='dv' columns in the codebook. The only companion flag that would expose the problem, `d_prime_estimable`, is present on the object but ABSENT from the 09_rt_summary.csv header list at export.ts:651, so it is dropped from the CSV — leaving no in-file signal that the rates are not measurements. This bites hardest on the most disengaged blocks, i.e. it biases the fatigue contrast the task is there to measure.

**Proposed fix:** Make `hit_rate` and `false_alarm_rate` `number | null` in SdtResult, RtResult.summary and storage/types.ts, and in the empty-pool branch return the rate that IS computable (`nSignal > 0 ? hits/nSignal : null`, `nNoise > 0 ? falseAlarms/nNoise : null`) with null for the other. Add `d_prime_estimable` to the 09_rt_summary.csv column list at export.ts:651 and to the codebook so an analyst can filter. Check src/sim/fuzz.ts:120 (`inUnit(r.hit_rate)`) accepts null.

## [high] scripts/lib/timingModel.ts still models the foreperiod as a uniform midrange (950 ms) after it became a truncated exponential (mean 617.5 ms), overstating every RT block by 16%

`scripts/lib/timingModel.ts`:58

**Evidence claimed:** `const del = (CONFIG.RT_DELAY_MIN_MS + CONFIG.RT_DELAY_MAX_MS) / 2;` = (300+1600)/2 = 950. The shipped draw is `nonAgingDelay(300, 1600, 650)`, whose analytic truncated-exponential mean is 300 + (350 - 1300·e^-3.714/(1-e^-3.714)) = 617.52 ms; 2,000,000 draws gave 617.81. Measured: `rtBlockSeconds(32)` returns 75.20 s; the same formula with the true 617.5 ms mean gives 64.56 s. `CONFIG.RT_DELAY_MEAN_MS` is never read anywhere in scripts/.

**Failure scenario:** protocolFrontier.ts and simulateParticipant.ts both charge `rt_block` at 75.20 s per condition. Real blocks average 64.56 s. Over 10 conditions plus the one practice block that is ~108 s (1.8 min) of phantom time per sitting, ~3.6 min per participant, in the feasibility figure used to argue the protocol fits its slot.

**Impact:** The file's own header claims 'Every app-controlled duration is read from the real CONFIG', and PROVENANCE (line 85) marks 'rt_block' as 'enforced', defined at line 76 as 'the app will not advance before this much time has passed... Not an estimate at all — a lower bound the instrument imposes.' 950 ms is neither read correctly nor a lower bound — it exceeds the actual mean by 54%. Both claims are false as written. The repo now carries three different values for the same quantity: tests/foreperiod.test.ts:60 says 1050 ms total foreperiod, config.ts:68 says 'about 1.02 s', timingModel implies 1350 ms.

**Proposed fix:** Export the truncated-exponential mean from src/lib/foreperiod.ts (`export function meanNonAgingDelay(min, max, mean) { const s = Math.max(1, mean-min), r = max-min, e = Math.exp(-r/s); return min + s - r*e/(1-e); }`) and have rtBlockSeconds call it with the three RT_DELAY_* constants instead of the midrange. Add a test asserting `meanNonAgingDelay` matches the empirical mean of `nonAgingDelay` to within 1 ms, so the two can never drift again.

## [high] caffeine_today and hours_since_sleep are read from the participant record (sitting 1's values) while the codebook calls them session-level

**STATUS: CONFIRMED AND FIXED.** Read from the session, not the participant record, whose copy is deliberately the sticky first-sitting value. Measured: four sittings with true values false/true/false/true all exported `true`.

`src/storage/analysisExport.ts`:233

**Evidence claimed:** analysisExport.ts:233-234: `caffeine_today: p?.caffeine_today ?? null,` / `hours_since_sleep: p?.hours_since_sleep ?? null,` where `p = b.participant`. types.ts:78-83 documents those participant fields as: 'The FIRST sitting's values, kept for continuity. Per-sitting values are on the session record: this row is shared across a participant's sittings and cannot hold two of anything that varies between them. Analyses that need caffeine or sleep as a covariate must read the session's.' SessionRecord carries `caffeine_today?` / `hours_since_sleep?` (types.ts:161-162) with the note that holding them on the participant 'meant sitting 2 overwrote sitting 1's values'. The per-session exporter does it correctly (export.ts:572-573 `caffeine_today_session: session.caffeine_today ?? ''`) and its codebook entry (export.ts:308) says outright: "the participant record's copy is the first sitting's and must not be used as a per-session covariate." The analysis codebook (analysisCodebook.ts:172-175) nevertheless claims 'Session-level, repeated across the rows of one sitting.'

**Failure scenario:** A participant drinks coffee before sitting 1 and none before sitting 2, and sleeps 16 h vs 6 h before the two visits. All 20 rows for that participant carry caffeine_today=true and hours_since_sleep from sitting 1. Verified empirically: with a two-sitting participant every row shows the same participant-level value.

**Impact:** Illumination is the SESSION-level factor, so caffeine and hours-awake are exactly the state covariates that are confounded with sitting and therefore with illumination. Exporting sitting 1's values on both sittings makes the covariate constant within participant, so it can never adjust the whole-plot illumination contrast it was collected to adjust — and any adjusted illumination effect reported from this file is unadjusted in fact.

**Proposed fix:** Read the session record: `caffeine_today: s.caffeine_today ?? null, hours_since_sleep: s.hours_since_sleep ?? null` (falling back to the participant copy only for legacy sessions, and then flagging it in a separate column). Keep the codebook text as-is once the source is the session.

## [high] position_c is centred on 5.5 while session_position is 0-based, so the 'centring' it documents does not happen

**STATUS: CONFIRMED BY AGENT (ran the real exporter) AND FIXED.** session_position is 0-based, so the centre is 4.5. Measured mean was -1.0, not 0 — the column stayed correlated with the intercept, which is the one thing centring is for.

`src/storage/analysisExport.ts`:172

**Evidence claimed:** analysisExport.ts:172: `position_c: sum.session_position - (N_CONDITIONS + 1) / 2,` i.e. pos - 5.5. But session_position is 0-based: counterbalance.ts:79 documents PlannedStep.position as 'Serial position in the session, 0-based', sessionPlan maps with `(conditionIndex, position)`, and Experiment.tsx:608 stores it verbatim ('Global serial position (offset + local index) so split sittings keep a 0..9 covariate'). Running the exporter on the fixture prints session_position `0..9` and position_c `-5.5 | -4.5 | ... | 3.5` — mean -1, not 0. The codebook (analysisCodebook.ts:72-73) asserts 'session_position centred on the middle of the sitting. Centring removes the correlation between the position term and the intercept, so the intercept remains interpretable as the average condition' and declares session_position's unit as '1-10'.

**Failure scenario:** Fit `outcome ~ polarity_c * illumination_c + position_c + (1|participant)`. position_c has mean -1 rather than 0, so the intercept estimates the outcome at serial position 5.5 — a position that is one full condition beyond the middle of the sitting — and remains correlated with the position slope. Any model that reports an intercept, or an effect at 'the average condition', is reporting it at the wrong point on the fatigue gradient.

**Impact:** The stated safeguard is false (a comment asserting a safeguard that does not exist), and every intercept and every simple effect quoted at position_c = 0 is offset by one condition's worth of time-on-task — which in this study is the fatigue accumulation the design exists to measure.

**Proposed fix:** Use `sum.session_position - (N_CONDITIONS - 1) / 2` (pos - 4.5) for a 0-based position, or convert session_position to 1-based on export and keep -(N+1)/2. Whichever is chosen, correct the codebook's declared ranges: session_position is 0-9 (not '1-10') and global_position is 0-19 (not '1-20').

## [high] global_position is derived from a positional indexOf with Math.max(0, -1), not from the recorded illumination_block, and is wrong for split sittings, 3 sittings, and unresolved sessions

**STATUS: CONFIRMED AND FIXED, worse than claimed.** Now derived from the recorded illumination_block. The split protocol produced 0-4, 15-19, 20-24, 35-39 instead of 0-19 (session_position is already block-global, so the sitting counter double-counted); start-time order disagreeing with block order put illumination_block=0 beside global_position=10-19 in the same row; and an unresolved participant silently got a confident 0-9. Also fixed alongside: a hard-coded expectation of two sittings marked EVERY split-protocol participant unanalysable.

`src/storage/analysisExport.ts`:290

**Evidence claimed:** analysisExport.ts:290 `sittingIndex: Math.max(0, ids.indexOf(b.session.session_id)),` feeding analysisExport.ts:171 `global_position: sum.session_position + ctx.sittingIndex * N_CONDITIONS,`. `ids` comes from `orderByParticipant.get(...) ?? []`, so a session that checkJoin never filed (empty participant_id — joinIntegrity.ts:74-81 `continue`s before the Map insert) yields indexOf = -1, which Math.max turns into 0, i.e. 'this is the first sitting'. Verified: a bundle with participant_id '' exports 10 rows with global_position 0-9 and an empty participant_id. Verified with three sittings: global_position runs to 29 while the codebook says 1-20. The session record already carries the correct answer: `illumination_block` (types.ts:115, '0 = this participant's first level, 1 = their second'), and session_position is already the block-global position (Experiment.tsx:608), so with the supported split-session mode (conditions_per_session = 5, export.ts:295) a participant has four sittings and the formula produces 0-4, 15-19, 20-24, 35-39 instead of 0-19.

**Failure scenario:** (a) A block run as two sittings of five: the second sitting's conditions (true global positions 5-9) are exported as 15-19, and the fourth sitting's (true 15-19) as 35-39. (b) A participant whose first sitting was soft-deleted: the surviving second sitting is exported as global_position 0-9 while illumination_block on the same row says 1. (c) A session with no participant id: global_position 0-9 asserted as a first sitting.

**Impact:** global_position is the codebook's designated cumulative-fatigue predictor ('Use this for cumulative fatigue'). A cumulative-fatigue term built from wrong, non-monotone positions estimates a fatigue slope from a mis-ordered exposure sequence, and in case (b) it contradicts illumination_block in the same row — the kind of internal disagreement that is found, if at all, long after the reason is forgotten.

**Proposed fix:** Derive it from the record rather than from list membership: `global_position: sum.session_position + (s.illumination_block ?? 0) * N_CONDITIONS`. If a positional index really is wanted, do not swallow -1: emit null (and a join issue) when `ids.indexOf(...) < 0`, so 'sitting not resolved' is never rendered as 'first sitting'.

## [high] E2E-harness sessions and unfinished sittings are pooled with no column to filter them on

**STATUS: CONFIRMED AND FIXED.** e2e_timing and session_status are now exported with codebook entries. Soft-deleted sessions were REFUTED — listSessions filters them before the exporter sees them.

`src/storage/analysisExport.ts`:44

**Evidence claimed:** ANALYSIS_LONG_COLUMNS (analysisExport.ts:44-75) contains neither `e2e_timing` nor `session_complete`/`session_status`, and buildAnalysisDataset applies no filter; Dashboard.tsx:86-89 feeds it every session from `listSessions()` (which excludes only soft-deleted rows). The per-session exporter documents both as pooling gates: export.ts:306 — e2e_timing 'TRUE means this session ran under the end-to-end test harness, in which every protocol duration ... is collapsed to a token value. Such a row is a test artefact and must never be pooled with collected data'; export.ts:294 — session_complete 'Filter on this before pooling sittings: a truncated series is unbalanced with respect to the Williams order.' The flag is set at session creation from a URL parameter (Experiment.tsx:453 `e2e_timing: isE2ETimingActive()`), so a bookmarked ?e2e URL produces one on the real device. The Dashboard's own single-session panel warns 'Do not pool it with completed sittings without accounting for that' (Dashboard.tsx:248-255) — advice the pooled file makes impossible to follow.

**Failure scenario:** A demo or E2E run is done on the study tablet with the ?e2e URL: ten conditions complete under token durations (reading floor, adaptation, search cap and RT block all collapsed). checkJoin sees a participant with the right number of sittings, crossed illumination and 20 condition-runs, so analysable=true and no issue is raised. Its 20 rows enter analysis_long.csv indistinguishable from real data, and no exported column can identify them.

**Impact:** Fabricated-duration rows enter the thesis dataset as complete, analysable cases. Reading time, search time, adaptation and every rate computed over them are token values, and they will move reading_speed_wpm, search_time_ms and the ocular rates in whatever direction the harness constants happen to sit.

**Proposed fix:** Add `e2e_timing` and `session_complete` (status === 'complete' && conditions.length === conditions_per_session) to ANALYSIS_LONG_COLUMNS and to the codebook, and have checkJoin raise a blocking issue (e.g. 'e2e_session') for any bundle with e2e_timing true, so analysable is false and the reason is on every row.

## [high] Pause exits mid-session to SessionManager, where UpdateBanner renders — applyUpdate() is reachable during a sitting, contradicting the comments in four files

`src/experiment/Experiment.tsx`:1257

**Evidence claimed:** Experiment.tsx:1166 `const canPause = isInLoop(machine.stage) && (machine.stage !== 'REACTION_TIME' || rtBlockFinished) && !!session;` and :1255-1257 `saveResume(session.session_id, target); tracking.stop(); onExit();`. App.tsx:52 wires `onExit={toManager}`, and App.tsx:33-43 renders `<UpdateBanner />` unconditionally on the `manager` view. So the manager is NOT a between-sessions screen: it is the screen Pause lands on, and Pause is deliberately available throughout the condition loop (including BREAK, which is exactly when an operator steps away and taps around). The banner text itself then lies to the operator: "Apply it now, between sessions. Never during a sitting" (UpdateBanner.tsx:39) — while a sitting is in progress. Four comments assert a safeguard that does not exist: swUpdate.ts:23-25 ("ONLY on the landing and session-manager screens — between sessions, never inside one — which preserves the original safety property"), UpdateBanner.tsx:8-11 ("Render this on the landing and session-manager screens and nowhere else... exactly the operation that must never happen during a sitting"), App.tsx:27-28 ("Between-sessions screens only"), main.tsx:71 ("UpdateBanner offers the waiting build on the between-sessions screens only"). There is no test covering this: `find` for *swUpdate*/*UpdateBanner* returns only the two source files.

**Failure scenario:** Participant is 4 conditions into a 90-minute sitting and asks for a break. Operator taps ⏸ Pause (confirm: "This condition will be restarted on resume"), lands on the Session Manager, and sees a dark banner at the bottom of the screen: "A newer version of VisuLab is ready — Apply it now, between sessions." It reads as an instruction and the operator is, by the app's own account, between sessions. They tap Update now. The waiting worker skip-waits, the precache is replaced, the page reloads. Conditions 5-10 then run on a different build from conditions 1-4.

**Impact:** The session record's `provenance` (app_version, git_hash, build_time, condition_def_hash, schema_version) is stamped ONCE at session creation (Experiment.tsx:458, `provenance: provenance()`) and never rewritten. 01_session_info.csv therefore certifies a single build for a sitting produced by two. If the new build changed anything in the blink pipeline (EAR threshold, FPS_RATIO_THRESHOLD, the incomplete-blink classifier) or in CONDITIONS, half the participant's within-subject contrasts were measured with a different instrument and nothing in the export says so — condition_def_hash would silently be the old build's. The primary outcome is a within-participant comparison across the 10 conditions; a mid-series instrument change biases exactly that contrast, undetectably.

**Proposed fix:** Do not render UpdateBanner on the manager view whenever any session has status 'in_progress'. SessionManager already computes `inProgress` (SessionManager.tsx:65); lift that (or a `listResumable().length > 0` check) into App and gate the banner: `{inProgress.length === 0 && <UpdateBanner />}`. Failing that, make applyUpdate() itself refuse: query `getAll('sessions')` for any `status === 'in_progress' && !deleted_at` and, if found, replace the button with a line naming the participant(s) blocking the update. Then correct the four comments to describe what the code actually does.

## [high] Applying an update reloads EVERY open client, not just the one that consented: vite-plugin-pwa arms a hidden `controlling` -> window.location.reload() listener in every window the moment a new build starts waiting

`src/lib/swUpdate.ts`:64

**Evidence claimed:** node_modules/vite-plugin-pwa/dist/client/build/register.js (the module behind `virtual:pwa-register`): `const showSkipWaitingPrompt = () => { onNeedRefreshCalled = true; wb?.addEventListener("controlling", (event) => { if (event.isUpdate) window.location.reload(); }); onNeedRefresh?.(); }; ... wb.addEventListener("waiting", showSkipWaitingPrompt); wb.addEventListener("externalwaiting", showSkipWaitingPrompt);`. The reload listener is installed as a side effect of onNeedRefresh firing — i.e. in EVERY client, whatever screen it is on, the instant a new worker reaches `waiting`. workbox-window/src/Workbox.ts:556-571 dispatches `controlling` on ANY `controllerchange`, unconditionally, with `isUpdate: this._isUpdate`, and `this._isUpdate = Boolean(navigator.serviceWorker.controller)` at register time (Workbox.ts:119) — always true on a tablet that already has the app installed. Workbox.ts:147-173 fires `waiting` even for a worker that was already waiting before this page loaded, so a client that starts mid-study arms the listener too. `clientsClaim:false` does not prevent this: clientsClaim only governs the FIRST install; a worker told to skipWaiting takes over all in-scope clients registration-wide, which is precisely why the `controlling`-then-reload recipe works at all. The generated SW does honour the message — node_modules/workbox-build/build/templates/sw-template.js:37 installs the `SKIP_WAITING` listener in the `else` branch, i.e. exactly when `skipWaiting:false`.

**Failure scenario:** The tablet has the fullscreen PWA open running a session (participant mid-READING, MediaPipe streaming, blink counting), and the operator also has the same origin open in a Chrome tab — the routine way they check "did my fix reach the tablet?", which swUpdate.ts:18-20 says is exactly what they were doing. The new build installs and goes to waiting; both clients fire `waiting`, both arm the reload listener. In the browser tab the operator sees the banner on the landing screen and taps Update now. `messageSkipWaiting()` activates the new worker for the whole registration, both clients get controllerchange, and the PWA window — where no one touched anything — executes `window.location.reload()` in the middle of the reading task.

**Impact:** Answers the audit's "does anything auto-reload without user action?" with yes. The reload happens mid-READING, so the blink stream for that condition is truncated at an arbitrary point and the incomplete-blink ratio for it is a proportion over a partial, non-protocol-length observation window. Resume restarts the condition, but the participant has now read that passage once (comprehension and reading speed inflated by prior exposure) and, because resume reuses the condition_id, the truncated first attempt is overwritten with nothing recording that it happened. main.tsx's chunk-load error handler will not catch this — the page reloads cleanly onto the new precache.

**Proposed fix:** Stop routing the apply through vite-plugin-pwa's returned `updateSW`. Register with `onRegisteredSW` to capture the ServiceWorkerRegistration, keep a module-level `sessionActive` flag that Experiment sets on mount and clears on unmount, and do the apply by hand: `reg.waiting?.postMessage({type:'SKIP_WAITING'})` plus an own `navigator.serviceWorker.addEventListener('controllerchange', ...)` that reloads only when `!sessionActive`. That removes the library's ungated listener entirely (it cannot be removed once added, because the closure is not exposed).

## [high] exported_at is stamped from a download that structurally cannot fail, and it is the only gate on the unattended 30-day permanent purge

**STATUS: VERIFIED BY HAND AND FIXED.** Confirmed: downloadExport drives `a.click()`, which returns void whether the file was written, blocked, cancelled or refused for want of disk — and Chrome prompts before allowing multiple downloads from one origin while an export writes ~18 files, so a refused prompt is an ordinary outcome, not an edge case. exported_at was stamped unconditionally and was the sole gate on the unattended 30-day purge, so a refused prompt left every file absent and the only copy destroyed a month later. `export_confirmed_at` is now a separate field, set only by an explicit operator confirmation that the files arrived, and it alone releases a session to the timer. The two retention reasons are distinguished because they need different actions.

`src/dashboard/Dashboard.tsx`:64

**Evidence claimed:** export.ts:865-878 `downloadExport` is 19+ synthetic anchor clicks in a loop — `a.click(); a.remove(); URL.revokeObjectURL(url); await new Promise(r => setTimeout(r, 130));` — with no return value, no error path and no verification that a single byte reached the filesystem. It resolves successfully whether the browser wrote 21 files, blocked 20 of them behind a "Download multiple files?" prompt the operator declined, or wrote none. Dashboard.tsx:53-66 then does `await downloadExport(buildExportFiles(bundle)); const fresh = await get(...); if (fresh) await put('sessions', {...fresh, exported_at: Date.now()});` with no catch — so exported_at is stamped unconditionally on the strength of that non-signal. gather.ts:261-267 treats exactly that field as proof another copy exists: `if (s.exported_at == null) { retained... 'it was never exported, so this device holds the only copy' } ... await purgeSession(s.session_id);` and purgeSession (gather.ts:185-200+) removes every child row across every store. The comment at Dashboard.tsx:58-62 — "Record that this session has left the device" — asserts something the code never established.

**Failure scenario:** Operator exports participant 037's completed sitting. Chrome for Android raises "visulab wants to download multiple files" on the second anchor; the operator taps Block (or the tablet is out of free space after file 3, or Safari-in-standalone drops them). One CSV lands, the 20 others — including the session_*.json backup that SessionManager.tsx:157-160 calls the recovery path for a wiped or replaced tablet — never exist. exported_at is stamped anyway. Weeks later the operator moves the session to the bin during tidy-up. Thirty days after that, on the next Session Manager mount, purgeExpired() sees exported_at != null, calls purgeSession(), and permanently deletes all of participant 037's rows with no prompt and no confirmation.

**Impact:** One participant's complete sitting — 10 conditions of blink data, CVS-Q, TLX, comprehension — is irrecoverably gone, and cannot be re-collected because the ambient-illumination factor is between-sittings 48-72h apart and the participant has already been exposed to the passages. In a split-plot design a participant lost after both sittings is not a missing cell; it removes the whole within-subject block from the illumination contrast.

**Proposed fix:** Do not treat downloadExport's resolution as evidence. Either (a) make export require an explicit operator confirmation before stamping — "Confirm all 21 files are in Downloads" with a checkbox, stamping exported_at only on confirm — or (b) switch to a single archive (one .zip / one JSON) so there is exactly one download to succeed or fail, and use the File System Access `showSaveFilePicker` handle where available so a cancel throws. Independently, gate the auto-purge on more than exported_at: it should never destroy the last copy unattended at all — retain past 30 days and report, and let purge stay a deliberate button.

## [high] classifyBlinks() runs at full frame rate before the LIVE_HZ throttle and with zero subscribers, spending ~1.5 s of main thread and ~233 MB of garbage per reading condition inside the primary-outcome window

**STATUS: VERIFIED BY HAND AND FIXED.** Confirmed and worse than claimed: the aggregator exists only during READING_TASK, which is exactly when the monitor is hidden and the subscriber set is empty — so the cost landed at maximum with zero benefit, during the measurement that matters. Measured: 14.6M sample scans and 5,400 array allocations per 3-minute condition, 7.5x the work of doing it at LIVE_HZ. emitLive now takes a thunk invoked only after the rate and subscriber checks.

`src/tracking/useTracking.ts`:225

**Evidence claimed:** Call order in `ingestResult`: line 225 `const live = agg?.liveCounts(baselineEarRef.current);` executes, then line 226 `emitLive(t, {...})` is entered, and only at line 186 does the throttle run: `if (t - lastLiveEmit.current < 1000 / LIVE_HZ) return;`. The subscriber check is later still (line 188 `if (liveSubs.current.size === 0) return;`). So the expensive work is unconditional per FaceMesh result — 30-60x more often than LIVE_HZ=4, and it is paid even when nothing is subscribed.
aggregator.ts:142 `const events = classifyBlinks(this.ear, baseline);` over the WHOLE accumulated array. blink.ts:209 allocates a filtered copy of all n samples; blink.ts:174-182 `samplingGapThreshold` allocates an n-element `deltas` array and sorts it. Two O(n) allocations plus an O(n log n) sort, per frame, over a monotonically growing array — total O(N²).
Measured (node/V8, desktop-class CPU, /tmp scratch bench over the real blink.ts):
  n=1350: 0.14 ms/call · n=2700: 0.29 ms · n=5400: 0.60 ms
  30 fps × 180 s (N=5400): 1538 ms total main-thread work, 0.285 ms mean per frame
  60 fps × 180 s (N=10800): 6176 ms total, 0.572 ms mean per frame (4x for 2x frames — quadratic confirmed)
  transient allocation: 2 arrays × N²/2 = 29,160,000 entries ≈ 233 MB per 3-minute condition at 30 fps (~930 MB at 60).
CONFIG.CAMERA_FPS = 60 and CONFIG.PROCESS_EVERY_N_FRAMES = 1 (config.ts:193,197), so the 60 fps column is the requested operating point, not a hypothetical.

**Failure scenario:** A 3-minute reading exposure on a tablet. The monitor is not rendered (Experiment.tsx:1184 excludes READING_TASK), so `liveSubs.current.size === 0` and every single result of this computation is discarded. By the end of the condition each FaceMesh result additionally triggers a 5400-element array copy, a 5400-element allocation and sort, and a 5400-step state-machine pass. On tablet Safari (conservatively 5-10x slower than this bench) that is ~3-6 ms per frame late in the condition against a 16.7 ms budget already largely consumed by FaceMesh inference, plus major-GC pauses driven by ~233 MB of churn. Frames the pump cannot service are dropped by `requestAnimationFrame(pump)` self-pacing.

**Impact:** Directly violates the project's overriding constraint. Every dropped frame is a lost EAR sample from the series the primary outcome is counted over, and the loss is concentrated at the END of each condition — which is exactly where `binnedBlinkRates` (aggregator.ts:117) splits first vs second half. A systematic late-condition sampling deficit biases the second-half bin, the study's own within-condition fatigue-drift measure. Undersampling also biases minimum-EAR upward and therefore inflates the incomplete-blink ratio, as blink.ts:44-47 states explicitly. A monitor feature has been made to degrade the measurement it was written to protect, during the one window where it displays nothing.

**Proposed fix:** Hoist the throttle. Compute the throttle decision first and return before any work: at the top of `ingestResult`'s emit path, check `if (liveSubs.current.size === 0 || t - lastLiveEmit.current < 1000 / LIVE_HZ) skip live work`. Keep only the frameTimes push/trim outside that gate (it is O(1) and feeds fps). Restructure `emitLive` to take a thunk, or split it into `shouldEmitLive(t)` + `emitLive(t, stats)`, so `liveCounts()` and the payload object are never constructed on a throttled frame. Separately, make `liveCounts` incremental rather than O(n): keep the blink state machine's cursor and event count on the aggregator and advance it over only the samples appended since the last call — that removes the quadratic term entirely and also removes the 233 MB of churn.

## [high] Comments assert a main-thread safeguard that the code does not implement

**STATUS: VERIFIED AND FIXED.** The throttle guarded the React render, not the computation, while the comment claimed main-thread protection. Both the code and the comment are corrected.

`src/tracking/useTracking.ts`:17

**Evidence claimed:** useTracking.ts:17-25, the LIVE_HZ doc: "Deliberately far below the frame rate. The monitor is an operator aid; re-rendering it on every FaceMesh result would compete for the main thread with the tracker itself, and the tracker is the one thing in this app that must never be starved — a dropped frame is a lost EAR sample and the primary outcome is a count of events in that series."
useTracking.ts:162-166, the plumbing comment: "Emission is throttled to LIVE_HZ rather than fired per frame: the monitor is an operator aid and re-rendering it 30 times a second would compete with the tracker for the main thread, which is the one thing that must never be starved."
What is actually throttled is only the subscriber fan-out at line 190. The cost the comments describe — `liveCounts()`→`classifyBlinks()` over the whole EAR array (line 225), `faceSizeFromLandmarks` (line 232), and the payload object literal — is all computed at line 225-234, unconditionally, before `emitLive` is even entered and long before the line-186 throttle.

**Failure scenario:** A reviewer or future maintainer reads either comment, concludes the tracker is protected from live-readout cost, and does not investigate the pump when frame rate degrades late in a condition. The measured per-frame cost (0.29-0.60 ms desktop, quadratic in condition length) is entirely outside the throttle the comments credit.

**Impact:** Violates the standing rule "Comments must be TRUE. A comment asserting a safeguard that does not exist is a finding." These two comments are load-bearing: they are the written justification for the design, and they misdescribe it in the specific direction that hides the defect. The same applies to aggregator.ts:129-137, whose claim that liveCounts shows "the number that will be analysed rather than a parallel approximation" is true of the algorithm but vacuous in practice, since (per the first finding) it never runs while the monitor is on screen.

**Proposed fix:** After hoisting the throttle so the comments become true, tighten their wording to name what is gated: "the throttle gates ALL live work — classification, payload construction and fan-out — not just the fan-out; only the O(1) frameTimes push runs per frame." If the throttle is not hoisted, the comments must instead state plainly that classification runs at frame rate. Add a regression test that spies on EyeMetricsAggregator.prototype.liveCounts, drives 60 synthetic FaceMesh results within 250 ms, and asserts it was called at most once.

## [high] Media export and the integrity audit read only the historical consent_snapshot, never current consent — a session whose media grants are all false still exports the inventory and the blobs

**STATUS: CONFIRMED AND FIXED.** Latent, not live — media_consent could not previously be written after the consent screen, so snapshot and current were always identical. It becomes live the moment revocation exists, which it now does. downloadSessionMedia refuses any blob whose grant is not currently in force and reports the refusals; the integrity audit gained a `media_grant_withdrawn` error beside the existing snapshot check.

`src/storage/export.ts`:747

**Evidence claimed:** export.ts:745-748 (15_media_inventory.csv): `consent_setup_photos: m.consent_snapshot.setup_photos, consent_annotation_video: m.consent_snapshot.annotation_video` — the row is built from the snapshot on the media record, and `(bundle.media ?? []).map(...)` emits every row unconditionally. export.ts:845-849 `downloadSessionMedia` iterates `bundle.media ?? []` and writes every blob with no consent test whatsoever. integrity.ts:348-355 `media_requires_consent` also tests only `m.consent_snapshot?.[grant]`, while the parallel check twelve lines above it (integrity.ts:337) correctly tests CURRENT consent: `bundle.session?.media_consent?.camera_metrics === true`.  Empirically (npx tsx, fixture bundle with media, session.media_consent forced to {camera_metrics:false, setup_photos:false, annotation_video:false}): 15_media_inventory.csv still emitted 2 rows, both reading `consent_setup_photos=true, consent_annotation_video=true, blob_present=true`, and auditBundle raised no finding.

**Failure scenario:** Suppose finding #1 is fixed only halfway — the operator flips the session's media_consent to false to record a withdrawal, but the blobs are not yet purged. The next export writes 15_media_inventory.csv asserting the participant consented (true, from the snapshot), 01_session_info.csv asserting they did not (false, from the session), the integrity report reads `all_checks_passed`, and 'Download media files' writes both the photographs and the reading video onto the researcher's machine. The two files in one bundle contradict each other and the binaries leave the tablet regardless.

**Impact:** There is no data-level trace of a media-consent withdrawal anywhere in the export, and the audit that exists specifically to catch consent violations is structurally incapable of detecting this one because it interrogates the record's own history rather than the participant's current position. The asymmetry with the ocular check on the same page shows the correct pattern was known and not applied.

**Proposed fix:** In `auditBundle`, add a second media check against `bundle.session.media_consent` (error severity: 'media retained under a grant that is no longer in force'). In `downloadSessionMedia`, refuse to write any blob whose `requiredGrant(m.checkpoint)` is not currently true on `bundle.session.media_consent`, and return those ids in a `refused` list the Dashboard surfaces. Add a `consent_current_<grant>` column to 15_media_inventory.csv beside the snapshot column so the two are visibly distinct.

## [high] analysis_long.csv carries no e2e_timing flag, so E2E-harness sessions with collapsed timing constants pool silently into the modelling dataset

`src/storage/analysisExport.ts`:44

**Evidence claimed:** `grep -n "e2e" src/storage/analysisExport.ts src/storage/analysisCodebook.ts src/storage/joinIntegrity.ts` returns zero hits. ANALYSIS_LONG_COLUMNS (analysisExport.ts:44-76) contains no such column, `buildLongRows` never reads `s.e2e_timing`, and `checkJoin` does not test it. Meanwhile types.ts:141-145 documents the field: "True when this session ran with the E2E harness's collapsed timing constants. Such a session is a test artefact, not data: every protocol duration was replaced with a token value." Experiment.tsx:451-452 stamps it at creation "so a session run on a bookmarked ?e2e URL can never be mistaken for real data". The overrides (config.ts:238 and neighbours) replace READING_PAGE_MIN_MS 20000→150, RT_TRIALS_PER_CONDITION 32→4, VS_TIME_LIMIT_MS 40000→5000, ANNOTATION_SEGMENT_MS 180000→400. Dashboard.tsx:86 feeds `listSessions()` — which filters only `deleted_at` — straight into `buildAnalysisDataset`. Empirically: a fixture bundle with `e2e_timing: true` produced 10 rows in analysis_long.csv, and `/e2e/.test(header)` was false.

**Failure scenario:** An operator demonstrates the app from a bookmarked `?e2e` URL, or a developer smoke-tests the deployed build on the collection tablet. That session lands in IndexedDB with e2e_timing=true. At analysis time the researcher clicks 'Export analysis dataset', which pools every non-deleted session on the device. The demo rows appear in analysis_long.csv with reading_time_ms of a few hundred milliseconds, 4 RT trials and a 400 ms 'annotation' clip, and nothing in the file, the codebook, the join report or the join-issues file marks them. The per-session export would have caught it — 01_session_info.csv has an `e2e_timing` column (export.ts:524) — but that is not the file anyone models from.

**Impact:** Test-artefact rows enter the confirmatory dataset for the primary outcome undetectably. Because the collapsed constants shorten the reading exposure by two orders of magnitude, such rows carry near-zero blink counts and extreme reading_speed_wpm, which will distort exactly the binomial denominator the design's precision rests on. The fix applied for this exact hazard was applied to the session export only.

**Proposed fix:** Add `e2e_timing` to ANALYSIS_LONG_COLUMNS and ANALYSIS_CODEBOOK, sourced from `s.e2e_timing ?? false`; add a blocking issue in `checkJoin` for any bundle with `e2e_timing === true`; and have `buildAnalysisDataset` refuse (or loudly report) rather than silently pool them.

## [high] The pooled analysis dataset — the file the thesis is modelled from — carries no build or protocol provenance and no manifest, while its docstring claims provenance can never be unstated

`src/storage/analysisExport.ts`:279

**Evidence claimed:** analysisExport.ts:277-280: "The join is checked first and its verdict is carried onto every row, so a dataset can never be produced whose provenance is unstated." `grep -n "provenance|app_version|git_hash|condition_def_hash|schema_version" src/storage/analysisExport.ts src/storage/analysisCodebook.ts` returns exactly one hit — that comment. The four emitted files are analysis_codebook.csv, analysis_long.csv, analysis_join_report.csv and analysis_join_issues.csv (verified by running buildAnalysisDataset): no export_manifest.json, no per-file FNV-1a checksums, no exported_at, no app_version/git_hash/condition_def_hash/schema_version on any row or in any file. The per-session bundle has all of this (export.ts:812-836). scripts/verifyExport.ts checks only the per-session bundle (its manifest assertion is at line 252) and never touches the analysis path.

**Failure scenario:** The tablets run for two years and the build changes: a threshold in blink.ts is retuned, or CONDITIONS is edited so condition_def_hash changes. Sessions collected under both builds are on the device. The researcher exports the pooled dataset. analysis_long.csv contains rows from both builds with no column distinguishing them, no hash of the condition table that defined the stimuli, and no checksum by which a later re-export can be shown to be the same dataset that produced the reported numbers. Nothing in the file identifies which version of the instrument measured any row.

**Impact:** The single file the confirmatory analysis reads cannot be tied to a build or to a locked stimulus definition, and cannot be shown to be byte-identical to the one the thesis reported — the property the per-session manifest exists to provide. The docstring asserting the opposite is itself a violation of the comments-must-be-true rule.

**Proposed fix:** Add `app_version`, `git_hash`, `condition_def_hash`, `schema_version` (from `s.provenance`) as per-row columns of analysis_long.csv, documented in ANALYSIS_CODEBOOK; and emit an `analysis_manifest.json` mirroring export.ts's manifest — provenance, non_finite_cells, join verdict, and per-file byte counts and FNV-1a checksums. Extend scripts/verifyExport.ts to cover the analysis path.

## [high] Withdrawal is not durable: restoreSessionBackup force-clears deleted_at, and buildAnalysisDataset has no withdrawal filter or column

**STATUS: CONFIRMED AND FIXED.** deleted_at was doing double duty as 'operator tidied up' and 'participant withdrew', and importSessionBackup deliberately clears it — correct for the bin, catastrophic for a withdrawal, since the manual instructs a restore when a tablet is replaced. `withdrawn_at` is now a separate tombstone, preserved verbatim across import, blocking in checkJoin regardless of caller, and surfaced as a `withdrawn` column.

`src/storage/backup.ts`:499

**Evidence claimed:** backup.ts:492-499 writes the restored session with `deleted_at: null` unconditionally, with a comment explaining the intent (a binned backup used to restore into the bin). Every export writes `backup_<pid>_<sid>.json` (export.ts:791-797) containing the full session and every store, so a copy exists off-device the moment the session is exported once. SessionManager.tsx offers a prominent 'Import backup' button. `buildAnalysisDataset(bundles)` (analysisExport.ts:281) applies no `deleted_at` filter of its own — the only guard is at the Dashboard.tsx:86 call site via `listSessions()`. Empirically: `buildAnalysisDataset([{...fixture, session:{...session, deleted_at: Date.now()}}])` emitted 10 rows into analysis_long.csv. `deleted_at` is not in ANALYSIS_LONG_COLUMNS and there is no withdrawal field anywhere in SessionRecord.

**Failure scenario:** A participant withdraws after sitting 1, which had already been exported. The operator bins the session, honouring the consent text. Six months later the collection tablet is replaced and the researcher follows the documented recovery path, importing every backup_*.json from the export folder onto the new device. The withdrawn sitting restores with deleted_at forced to null, appears in the active list indistinguishably from consented sessions, and flows into analysis_long.csv at the next pooled export. Nothing anywhere records that a withdrawal ever happened, because deleted_at was the only marker and the restore is designed to erase it.

**Impact:** Withdrawn data re-enters the analysis dataset through the application's own recommended recovery procedure, and no artefact — not the session record, not the backup, not the export, not the join report — retains any evidence of the withdrawal. The soft-delete tombstone is doing double duty as 'operator tidied up' and 'participant withdrew', and only the first survives a restore.

**Proposed fix:** Add an explicit, backup-preserved `withdrawn_at: number | null` (and optional `withdrawal_scope: 'session' | 'participant'`) to SessionRecord, set by a dedicated 'Record withdrawal' action distinct from the recycle bin. Preserve it verbatim across restore (unlike deleted_at). Have `buildAnalysisDataset` filter or hard-fail on any bundle with `withdrawn_at != null` rather than relying on the caller, and have `checkJoin` raise a blocking issue if one is passed.

## [high] stimulus_scale is stamped once at session creation and never re-recorded when the scale later changes

`src/experiment/Experiment.tsx`:467

**Evidence claimed:** `stimulus_scale: currentScale()` and `layout_viewport: layoutViewport()` are written once inside beginSession(), which runs at SETUP_ORDER[0] = SESSION_INIT (stateMachine.ts:17-31). Every other stage — CONSENT (setupStages.tsx:620 has an input), PARTICIPANT_PROFILE (six inputs, setupStages.tsx:225-239), PREFLIGHT, and the whole condition loop — comes after. `applied` in viewportScale.ts continues to change after that point (a taller keyboard, or resetViewportFloor() on an orientationchange, which can move the scale UP as well as down: portrait 800x1280 -> 0.66, landscape 1280x800 -> 0.94). grep confirms nothing ever rewrites the field: the only other mutation of the record, the PREFLIGHT handler at Experiment.tsx:727, spreads the stale `session` object (`{ ...session, preflight_complete: true, stimulus_font_ok: fontOk }`) and so carries the original value forward. The comment at Experiment.tsx:463-466 asserts that recording it here 'keeps that an analysable covariate rather than an unstated difference' — true only if the scale cannot change afterwards, which it can.

**Failure scenario:** Tablet is used un-installed (in Chrome, not the landscape-locked PWA). Operator completes SESSION_INIT in portrait at scale 0.66; the record says stimulus_scale=0.66. Participant rotates to landscape before the first reading task; orientationchange fires resetViewportFloor(), the scale becomes 0.94, and all ten conditions are presented at 0.94. The export reports 0.66.

**Impact:** The covariate meant to make the scaling analysable instead certifies a value the stimuli were never presented at. An analyst modelling reading speed or blink ratio with stimulus_scale as a covariate is regressing on a wrong number, which is worse than having no column: it converts an unstated difference into a stated falsehood, and export.ts:302 tells the analyst to read it as 'the factor the interface and stimuli were rendered at'.

**Proposed fix:** Subscribe to scale changes and rewrite the session record when `applied` changes (viewportScale.ts already funnels every change through apply(); add a change callback). Better for the study: record the min and max scale observed across the sitting plus a count of changes, so a session whose stimulus size moved mid-run is identifiable and excludable rather than summarised by one scalar.

## [high] isBelowMinimum() has no production caller — the comment claims the operator is warned, and nothing warns them

`src/lib/viewportScale.ts`:148

**Evidence claimed:** The doc comment reads: 'True when the viewport is so small that even MIN_SCALE cannot fit the design canvas, so content is being clipped despite scaling. The operator needs to know rather than discover it as a missing button.' `grep -rn isBelowMinimum src/ tests/` returns exactly three files' worth of hits: the definition (viewportScale.ts:153) and six assertions in tests/viewportScale.test.ts. No component, no screen, no banner imports it. Meanwhile computeScale() clamps at MIN_SCALE 0.5 (line 81), so below-minimum viewports genuinely do clip into the region #root's `overflow:hidden` plus body's `touch-action:none` makes unreachable — the exact failure mode the file's header describes. tests/viewportScale.test.ts:52 even gates its 'always fits' assertion on `if (s > MIN_SCALE)`, so the suite is silent about the clamped case.

**Failure scenario:** After the keyboard collapses the floor to 1152x250, isBelowMinimum(1152,250) returns true (verified empirically). Nothing consumes it. The session proceeds, clipping any screen whose content exceeds 1300 root-px, with no on-screen indication and no flag written to the record.

**Impact:** A standing project rule is that a comment asserting a safeguard that does not exist is a finding, and this is one. Practically: the one detector that could have caught the keyboard collapse in the field is dead code, so a corrupted sitting is only discoverable post-hoc from the layout_viewport string, and there is no session-level QC flag for it alongside lux_all_in_range and stimulus_font_ok.

**Proposed fix:** Call isBelowMinimum() from apply() and surface it — an operator-visible banner (like the reportAsyncFailure panel in main.tsx) plus a persisted `layout_below_minimum` boolean on the session record, exported as a QC column so affected sittings can be excluded.

## [high] The root transform is not a similarity transform of the design canvas: reading line length changes with device aspect ratio and is not captured by stimulus_scale

`src/styles/theme.css`:54

**Evidence claimed:** #root is `width: calc(100% / var(--vl-scale)); height: calc(100% / var(--vl-scale))`, and computeScale() takes `Math.min(w/1194, h/834)` (viewportScale.ts:75). Whenever one axis binds, the other over-fills: the root box's aspect ratio is the DEVICE's, not the design canvas's 1194x834 = 1.432.

ReadingTask.tsx:146 sets `padding: '56px 10% 3%'` (CONFIG.READING_MARGIN_PERCENT = 10, config.ts:22) — percentages of the root width — while CONFIG.READING_FONT_SIZE_PX stays a fixed 22 (config.ts:20). So the text column is 0.8 x rootWidth root-px with a constant 22px font:
  design canvas 1194 wide  -> column 955 px  -> ~55 characters/line
  1152x650 at scale 0.76   -> root 1516 wide -> column 1213 px -> ~70 chars/line (+27%)
  1152x650 at stuck 0.5    -> root 2304 wide -> column 1843 px -> ~106 chars/line (+93%)
export.ts:302 describes stimulus_scale only as 'a value below 1 means the reading text subtended a smaller visual angle', which does not mention the reflow at all.

**Failure scenario:** Two participants on two tablets with the same 0.76 scale but aspect ratios 1.77 and 1.50 read the same passage at the same visual angle with line lengths differing by ~18%. Both export stimulus_scale = 0.76, which an analyst reads as 'identical presentation'.

**Impact:** Line length is a first-order determinant of reading speed and of saccade/regression pattern, and reading speed and ocular behaviour are DVs here. A single scalar covariate is presented in the codebook as sufficient to describe the presentation difference when it is not; the aspect-ratio component is invisible in the export except by manually re-deriving it from layout_viewport. Any device-level heterogeneity in reading-speed data will be misattributed.

**Proposed fix:** Either letterbox the root to the design aspect ratio (fixed 1194x834 box, centred, so scaling is a true similarity transform and the layout is identical everywhere), or export the derived stimulus geometry directly: root width/height in root-px and the computed reading-column width in px, so line length is an available covariate rather than a reconstruction.

## [medium] nonAgingDelay does not produce the mean it is given: the `mean` argument is used as the untruncated exponential scale, so the realised mean is 617.5 ms, not 650 ms

`src/lib/foreperiod.ts`:37

**Evidence claimed:** Docstring line 32: 'Draw from a truncated exponential on `[min, max]` with the given mean.' Line 40: `const scale = Math.max(1, mean - min);` — this is the scale of the UNtruncated exponential. Truncating at range=1300 with scale=350 removes the upper tail and pulls the mean down to min + scale - range·e^(-range/scale)/(1-e^(-range/scale)) = 617.52 ms. 2e6 draws: 617.81. The requested mean was 650.

**Failure scenario:** Any caller that trusts the contract — `nonAgingDelay(min, max, mean)` returning a distribution whose mean is `mean` — is off by 32.5 ms per trial at the shipped constants. tests/foreperiod.test.ts:57-62 ('preserves the mean foreperiod') asserts `|meanTotal - 1050| < 60`; the realised 1017.8 sits inside that tolerance, so the test passes without ever pinning the mean it claims to protect.

**Impact:** Small for the science — the distribution is still non-aging, which is the property that matters — but it is the root cause of the timingModel divergence above, and it means `RT_DELAY_MEAN_MS: 650` in config.ts:71 is a mislabelled constant: it is a scale parameter, not a mean. A future change to RT_DELAY_MAX_MS silently moves the realised mean while the constant named 'MEAN' stays at 650.

**Proposed fix:** Either (a) rename the parameter and the constant to `scale` / `RT_DELAY_SCALE_MS` and correct the docstring to 'exponential scale, before truncation', or (b) keep the name honest by solving numerically for the scale that yields the requested truncated mean (a dozen bisection steps on m(s) = min + s - r·e^(-r/s)/(1-e^(-r/s))). Then tighten the test tolerance from 60 ms to ~2 ms so it actually constrains the mean.

## [medium] d-prime uses the 1/(2N) clamp in the app but a log-linear correction in the design helper, and the app's comment calls its 1/(2N) clamp 'loglinear'

**STATUS: VERIFIED BY HAND AND FIXED.** Two separately named corrections: the app clamps to [1/(2N), 1-1/(2N)] (Macmillan & Kaplan), touching only extremes; the design helper used (x+0.5)/(N+1) (Hautus log-linear), shifting every rate. On the stated operating point they give .95/.10 against .929/.131. The comment calling the clamp 'loglinear-style' was wrong and is corrected; the design helper now models the estimator the app actually uses. Published d' SE figures moved from 0.623/0.831 to 0.683/0.966 and docs/TIMING_MODEL.md is regenerated.

`src/lib/signalDetection.ts`:87

**Evidence claimed:** signalDetection.ts:87-89: `// Loglinear-style clamp using each pool's N ...` then `clampRate(rawH, max(1,nSignal))`, which (stats.ts:101-113) is `min(1-1/(2n), max(1/(2n), rate))` — a Macmillan & Kaplan 1/(2N) bound that leaves interior rates untouched. timingModel.ts:322-324: `// Log-linear correction ...` then `h = (hit*nGo + 0.5)/(nGo + 1)`, which shrinks EVERY rate. Measured at the design operating point (19/20 hits, 1/12 FA): app d' = 3.0278, SE = 0.7029; `dPrimeSe(32, 0.625, 0.95, 1/12)` = 0.6348 (default operating point: 0.6231).

**Failure scenario:** protocolFrontier.ts:80 reports `dSe` from the log-linear helper when scanning candidate RT_TRIALS_PER_CONDITION values. That column reads 0.62-0.63 for the shipped 32-trial block, while the instrument will actually export d_prime_se ≈ 0.70 for the same block — an 11% understatement of the per-condition noise on the sensitivity measure the frontier is being used to size.

**Impact:** Two estimators of the same quantity disagree by ~11%, and the comment in signalDetection.ts:87 names a correction the code does not implement (a false-comment violation of the standing rules). Any decision about whether to shorten the RT block is made against the optimistic number.

**Proposed fix:** Pick one correction and share it. Cleanest: have scripts/lib/timingModel.ts import `probit`, `normalPdf` and `clampRate` from src/lib/stats.ts and reuse the exact `dPrimeStandardError` body from signalDetection.ts rather than re-deriving it, deleting timingModel's duplicate `probit`/`phi`. Fix the comment on signalDetection.ts:87 to say '1/(2N) bound (Macmillan & Kaplan), applied only at the extremes' — or switch both to log-linear deliberately and say so.

## [medium] cvsq_baseline_total is measured once per SITTING but the codebook declares it a participant-level trait repeated across the participant's rows

**STATUS: CONFIRMED AND FIXED (documentation).** It is genuinely per-sitting; the code comment and codebook both called it a participant trait. Both corrected, with a warning that sitting maps onto illumination_block so conditioning on it absorbs part of the whole-plot effect.

`src/storage/analysisExport.ts`:232

**Evidence claimed:** analysisExport.ts:128 `const cvsqBaseline = b.cvsq.find((c) => c.stage === 'baseline');` is scoped to the bundle, i.e. to one sitting, and line 232 writes `cvsq_baseline_total: round(cvsqBaseline?.total_score)`. CVSQ_BASELINE is a per-session setup stage (stateMachine.ts:27, and stateMachine.ts:236 `if (!p.hasBaselineCvsq) return 'CVSQ_BASELINE'` evaluated against `getAllByIndex('cvsq_scores','by_session', s.session_id)` — Experiment.tsx:239,246), and Experiment.tsx:738-743 writes a new baseline row per session. The codebook (analysisCodebook.ts:170-171) says: 'A PARTICIPANT-LEVEL TRAIT: it is repeated across this participant's rows and must not be treated as a repeated measurement.'

**Failure scenario:** A participant scores 14 on the CVS-Q at sitting 1 and 19 at sitting 2. Rows 1-10 carry 14 and rows 11-20 carry 19. An analyst who follows the codebook and collapses to one value per participant (or enters it as a between-subject covariate) silently drops one of the two measurements — or discovers the column varies within participant and no longer trusts the codebook.

**Impact:** Either a real, sitting-specific habitual-symptom measure is discarded, or a covariate documented as constant is entered as time-varying without the analyst intending it. Both change the adjusted illumination contrast, since the two sittings are the illumination levels.

**Proposed fix:** Either state the truth in the codebook ('measured at the start of EACH sitting; session-level, not a participant constant') and consider renaming to cvsq_sitting_baseline_total, or add a genuinely participant-level column (the earliest sitting's value) alongside it. Do not leave the description asserting invariance the data does not have.

## [medium] polarity_switched is null for any gap in session_position, and the codebook defines null as 'first condition of the sitting'

`src/storage/analysisExport.ts`:149

**Evidence claimed:** analysisExport.ts:149 `const prev = ordered.find((x) => x.session_position === sum.session_position - 1);` and line 178 `polarity_switched: prev ? prev.polarity !== sum.polarity : null,`. `ordered` holds only the conditions this sitting actually recorded, and session_position is the block-global index (Experiment.tsx:608), so it is not guaranteed contiguous or to start at 0. analysisCodebook.ts:86-87 states: missing 'first condition of the sitting' ... 'Empty on position 1 because there is no previous condition, which is not the same as false.'

**Failure scenario:** A sitting is interrupted during the condition at position 3 and that condition row is never completed/written; the condition at position 4 then finds no predecessor and exports polarity_switched empty. Likewise in a split block (condition_offset = 5) the sitting's first row is position 5, whose predecessor ran in the previous sitting — also exported empty. An analyst reads either as 'this was the first condition of the sitting'.

**Impact:** polarity_switched is the covariate for the doubled grey-field adaptation and the polarity after-effect. Mislabelled rows either drop out of that adjustment or are treated as a different position in the sitting, weakening exactly the after-effect control the column exists to provide.

**Proposed fix:** Distinguish the two cases explicitly: compute prev as the row with the greatest session_position less than this one within the sitting, and export polarity_switched as null ONLY when this row is the sitting's minimum position; when a predecessor position is missing from the data, emit null and record a join issue (or add a `prev_condition_gap` flag) rather than reusing the 'first condition' encoding.

## [medium] purgeExpired's `purged` count is computed and thrown away while the comment above it claims the bin reports what it destroyed

`src/start/SessionManager.tsx`:44

**Evidence claimed:** gather.ts:245 `const outcome: PurgeOutcome = { purged: 0, retained: [] };` and :269 `outcome.purged++`. `grep -rn "\.purged" src/` returns exactly one hit — gather.ts:269, the increment. Nothing reads it. SessionManager.tsx:44-56: `const purge = await purgeExpired(); if (purge.retained.length) { setBinNotice(...) } else { setBinNotice(null); }` — only `retained` is ever surfaced. Directly above it, SessionManager.tsx:40-43 states: "The bin reports what it declined to destroy as well as what it destroyed. It used to discard the count entirely, so a session it purged — or refused to purge — left no trace anywhere." The first half of that sentence is false and the second half still describes the current code.

**Failure scenario:** A session sits in the bin past 30 days with exported_at set (see the previous finding: possibly stamped on an export that never landed). The operator opens the Session Manager to start the next participant. On mount, refresh() runs purgeExpired(), which permanently deletes that session and every child row. `retained` is empty, so setBinNotice(null) runs and the screen shows nothing at all. The bin count silently drops by one on a screen the operator is not reading.

**Impact:** Permanent, unattended destruction of a participant's data with zero record anywhere — not in the UI, not in a log, not in an export. Because it is invisible, the loss is discovered (if ever) at analysis time as an unexplained missing participant, with no way to tell deletion from a session that was never run.

**Proposed fix:** Surface the purged count in binNotice unconditionally when it is non-zero: change the guard to `if (purge.retained.length || purge.purged)` and lead the notice with `${purge.purged} session(s) were permanently deleted (past the 30-day window and previously exported): <ids>`. Have purgeExpired return the purged session_ids, not just a count, so the notice can name them.

## [medium] db.ts blocking() closes the connection and comments that "the next call here reopens", but after a newer build raises DB_VERSION the reopen fails with VersionError on every retry for the rest of the session

`src/storage/db.ts`:68

**Evidence claimed:** db.ts:68-72: `blocking(_cur, _next, ev) { // This connection is the one in the way. Release it; the next call here reopens.  _dbPromise = null; (ev.target as IDBDatabase | null)?.close(); }`. getDB() (db.ts:52) always reopens with the constant `DB_VERSION` compiled into THIS bundle (schemaEnums.ts: `export const DB_VERSION = 9`). `blocking` fires when another client opens a HIGHER version — i.e. a client running a newer build. After that client's upgrade commits, the stored database is at version 10; this old-build client's `openDB(DB_NAME, 9)` rejects with VersionError. db.ts:99 `_dbPromise.catch(() => { _dbPromise = null; })` correctly avoids caching the rejection, so every subsequent call re-attempts and re-fails identically. The comment promises recovery that the version constant makes impossible. The surrounding block comment (db.ts:57-66) explicitly names the triggering case: "a service-worker update that bumps DB_VERSION".

**Failure scenario:** Two clients of the app are open (the same pairing as the auto-reload finding: the PWA running a session plus a browser tab). The tab applies a waiting build whose DB_VERSION is 10 and reloads; its openDB(…,10) needs a version change, so the session client's blocking() fires, nulls _dbPromise and closes the connection. Until that client's own reload lands, every `await put(...)` in the running session — condition rows, reaction trials, eye_metrics — rejects with VersionError. main.tsx's unhandledrejection panel fires, which is the correct behaviour, but the rows for that window are simply not written and the operator is told the session "may not have saved the last step" with no way to retry.

**Impact:** A window of the sitting during which no measurement can be persisted. The blink/eye_metrics row for a condition is keyed by condition_id and written once at the end of the condition; if that write lands inside the window it is lost outright, and the condition appears in the export with a missing eye_metrics join rather than as a recorded failure.

**Proposed fix:** Make the failure legible and bounded rather than silent-and-permanent: in getDB, catch VersionError specifically and rethrow with a message the operator can act on ("this tab is running an older build than the database on this device — reload this window"), and consider opening with no explicit version (`openDB(DB_NAME)`) for read paths so an old build can at least still read a newer database. At minimum, correct the comment: the next call reopens only while no newer build has upgraded the store.

## [medium] UpdateBanner's `applying` latch and swUpdate's `updateWaiting` are never cleared, and applyUpdate resolves as soon as the message is posted — a failed apply leaves the button stuck on "Updating…" forever

`src/components/UpdateBanner.tsx`:43

**Evidence claimed:** UpdateBanner.tsx:43 `onClick={() => { setApplying(true); void applyUpdate(); }}` — fire-and-forget, no catch, and nothing ever sets `applying` back to false. swUpdate.ts:90 `await applyFn(true);`, but vite-plugin-pwa's updateServiceWorker is `async (_reloadPage = true) => { await registerPromise; if (!auto) { await sendSkipWaitingMessage?.(); } }` — the `_reloadPage` argument passed as `true` is IGNORED (leading underscore, unused), and the function resolves the moment the SKIP_WAITING message is posted. The actual reload comes only from the separate `controlling` listener. workbox-window's messageSkipWaiting is `if (this._registration && this._registration.waiting) { void messageSW(this._registration.waiting, SKIP_WAITING_MESSAGE); }` (Workbox.ts:326-328) — if there is no waiting worker it is a silent no-op. `updateWaiting` (swUpdate.ts:30) is only ever set true; nothing resets it.

**Failure scenario:** The waiting worker becomes redundant between the banner appearing and the tap (another client applied it, or the browser discarded it). `updateWaiting` is still true so the banner is still on screen. Operator taps Update now: messageSkipWaiting finds `registration.waiting === null` and does nothing, applyUpdate resolves, no `controlling` event, no reload. The button reads "Updating…", disabled, with `cursor: progress`, permanently — and stays that way across every return to the landing/manager screen for the life of the page.

**Impact:** Not a data loss, but it reproduces the operational failure this module was written to end (swUpdate.ts:11-20): the operator cannot tell "the update was applied" from "the update silently did nothing", and the tablet keeps serving the old build while the UI claims to be updating. The BuildStamp is the only way out, and it is on the landing screen only — not on the manager, where the banner also renders.

**Proposed fix:** Await applyUpdate with a timeout and a catch: `try { await applyUpdate(); await new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), 8000)); } catch { setApplying(false); setError('The update did not take. Note the build number and tell the researcher.'); }` — the page reloads on success, so the timeout can only be reached on failure. Also render BuildStamp on the manager view (App.tsx:43) so the running build is visible on both screens the banner can appear on.

## [medium] The displayed fps never describes the reading exposure it is being compared against, because frameTimes is only pushed on code paths that are live in the complementary stages

`src/tracking/useTracking.ts`:179

**Evidence claimed:** `frameTimes.current.push(t)` happens only inside `emitLive` (useTracking.ts:179), and `emitLive` is reached from two places: the face-present branch (line 226, always) and the face-absent branch (line 237, gated on `aggRef.current`).
During READING_TASK the aggregator exists, so both branches push and the window measures total pipeline throughput — but the monitor is not rendered, so nobody sees it. During the visible stages the aggregator is null, so only face-present frames push, and the 2000 ms window (line 180) has long since rolled past the reading task by the time the panel remounts.
The monitor compares this number against `fpsFloor={FPS_RATIO_THRESHOLD}` (Experiment.tsx:1188, blink.ts:64 = 30). But the export's gate is `effective_fps = effectiveFps(this.ear.map(s => s.t_ms))` (aggregator.ts:194) — the EAR series of the READING window only, with `fps_adequate_for_ratio` derived from it (aggregator.ts:217).

**Failure scenario:** A 10-lux sitting: the webcam lengthens exposure in the dim room and FaceMesh throughput over the dark reading screen falls to ~18 fps. The operator glances at the monitor during the following comprehension questionnaire — a bright cream screen where the camera recovers to ~30 fps — sees `30 fps`, no amber, and continues. The exported row for that condition carries `effective_fps: 18` and `fps_adequate_for_ratio: false`.

**Impact:** The one QC number the operator can act on in real time is measured on a different task, a different screen luminance and a different time window from the one the primary outcome's frame-rate gate applies to. Ambient illumination is a session-level IV and display polarity a within-sitting IV, and both drive camera exposure — so the discrepancy is not random, it tracks the experimental factors. This is the same class of defect the aggregator already documents as fixed for the export (aggregator.ts:185-193: "The gate has to describe the series it is gating"), reintroduced in the live path.

**Proposed fix:** Feed the monitor the fps of the series it is gating: push into `frameTimes` only on frames that actually yield a finite EAR sample (i.e. inside the face-present branch, after the `Number.isFinite(ear)` check), matching `effectiveFps(this.ear...)`. And because the reading window cannot be observed live, carry the just-finished condition's `effective_fps` forward — have `endCondition` stash the finalized value and surface it in `LiveTrackingStats` as e.g. `lastConditionFps`, so the panel shown during COMPREHENSION reports the frame rate of the reading exposure that just ended rather than the frame rate of the questionnaire screen.

## [medium] The status dot is green whenever a face is present, regardless of whether blinks are being counted at all

`src/components/TrackingMonitor.tsx`:60

**Evidence claimed:** TrackingMonitor.tsx:60 `const dot = !face ? '#d14343' : fpsLow ? '#c98a22' : '#22c97a';` — the colour is a function of `facePresent` and `fps` only. `s.blinks === null` (no baseline fitted, or, per the first finding, no aggregator) has no effect on it. Line 59's comment claims the palette means "Amber for 'measuring but degraded', red for 'not measuring', otherwise unobtrusive" — but there is no state in which the dot reports "not measuring the primary outcome".

**Failure scenario:** Calibration produced no baseline (`calibrate()` returns null when fewer than 10 samples were collected — useTracking.ts:368 — and the operator can advance past a failed calibration). Every condition thereafter runs with `baselineEarRef.current === null`, `classifyBlinks` returns `[]` for a null baseline (blink.ts:205), and `finalize` writes `incomplete_blink_ratio: null` for all ten conditions. The monitor shows a green dot, `face`, a healthy fps, and `blinks —`.

**Impact:** Green is the operator's go/no-go signal and it is being shown for a sitting that will produce no primary outcome whatsoever. The panel's own contract (TrackingMonitor.tsx:30-31: "Nulls render as '—', never as 0… a blink count of zero and a blink count that cannot be computed are completely different situations for the operator") is honoured in the digits but broken in the traffic light, which is the part a glance actually reads. The digits are correct and unfabricated; the summary indicator contradicts them.

**Proposed fix:** Make the null case its own colour state: `const dot = !face ? '#d14343' : s?.blinks == null ? '#d14343' : fpsLow ? '#c98a22' : '#22c97a'` (red, since a null blink count means the primary outcome is not being collected at all), and replace the `face` label with an explicit `NO BASELINE` string when `s.blinks == null && s.facePresent`, so the reason is legible rather than inferred from an em-dash.

## [medium] The monitor is pinned to the same corner as ExperimentProgress, which renders over it at a higher z-index with 1.1:1 contrast — both readouts are illegible where they overlap

`src/components/TrackingMonitor.tsx`:66

**Evidence claimed:** TrackingMonitor.tsx:66 `position: 'fixed', right: 10, top: 10, zIndex: 35` with `padding: '6px 10px'`, `fontSize: 11`, `lineHeight: 1.3` → occupies roughly y 10-36, extending left from x = W-10 for ~320 px of monospace content.
ExperimentProgress.tsx:21 `position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40`; lines 35-40 place the text at `position: 'absolute', top: 8, right: 12, fontSize: 11, color: '#5a5a7a'` → y 8-21, extending left from x = W-12.
Both are rendered unconditionally together: Experiment.tsx:1180 (monitor, visible for every loop stage except READING_TASK/ADAPTATION) and Experiment.tsx:1190 `showProgress` (true for every stage except SESSION_INIT/EXPORT_DASHBOARD). zIndex 40 > 35, so the progress text paints on top of the monitor's `rgba(20,20,30,0.72)` panel.
Contrast of #5a5a7a over that panel composited on a white condition background (0.72×20 + 0.28×255 = rgb(86,86,93)): L_text = 0.109, L_bg = 0.094 → 1.10:1.

**Failure scenario:** Any loop stage in any condition. The label "Condition 7 of 10 · reaction time · ~27 min left" is drawn in dark grey directly over the monitor's dark translucent panel: the progress text disappears at 1.1:1, and the monitor's own white digits underneath are overprinted by it. The operator loses both the condition counter and part of the tracking readout simultaneously — permanently, not transiently.

**Impact:** TrackingMonitor.tsx:26 asserts as a design constraint that "It never overlaps the stimulus: pinned to a corner, small, and translucent." It does not overlap the stimulus, but it was placed into a corner already occupied by the app's other fixed overlay, and it loses the z-fight. The panel added to end ninety minutes of running on trust is partly unreadable in every stage it appears in, and it takes the condition counter down with it.

**Proposed fix:** Move the monitor out of the collision: `top: 10` → `bottom: 10` (bottom-right is unoccupied — the only fixed bottom element is none; the pause/exit control is top-left at Experiment.tsx:1142 `top: 10, left: 12`), or raise the monitor above the progress bar and shift the progress label to `left: 12`. Either way, add an assertion or a visual-regression check that no two `position: fixed` overlays share an anchor corner.

## [medium] The monitor renders during VISUAL_SEARCH and REACTION_TIME, injecting an asynchronous peripheral colour transient into two speeded tasks whose latency is a dependent variable

`src/experiment/Experiment.tsx`:1182

**Evidence claimed:** Experiment.tsx:1182-1187 excludes only READING_TASK and ADAPTATION, so `visible` is true for VISUAL_SEARCH and REACTION_TIME (LOOP_ORDER, stateMachine.ts:42-50).
The panel is not static: it repaints at LIVE_HZ = 4 with changing digits (blink counts, fps, `open` ratio to 2 dp), and its 8 px status dot switches between #22c97a (green), #c98a22 (amber) and #d14343 (red) asynchronously with respect to trial onset. CONFIG.RT_DISTRACTOR_COLORS = ['#E42222','#2869FF','#8D7300','#008742'] — the monitor's green/amber/red are drawn from the same hue families as the go/no-go distractors.
Geometry checked and NOT the problem: the RT target is at clusterPos x 25-75%, y 28-72% (ReactionTimeTask.tsx:218) with RT_DOT_PX 52, so at 1024×768 its topmost extent is y≈189 versus the monitor's y 10-36 — no occlusion, and `pointerEvents: 'none'` (TrackingMonitor.tsx:67) means no tap interception. The issue is the transient, not the overlap.
The panel is also a fixed `rgba(20,20,30,0.72)` patch drawn over the condition background, so its contrast against the field varies with display polarity — an IV.

**Failure scenario:** Mid RT block, during the truncated-exponential foreperiod (ReactionTimeTask.tsx:215), the participant briefly turns their head; the monitor's dot flips green→red→green in the upper-right periphery, ~250 ms before the go-target appears. Exogenous attention is captured away from the (unpredictably located) target and that trial's RT is inflated. Across a block the transients occur at rates that depend on how well the face is tracked — which depends on ambient illumination and on screen luminance, i.e. on both IVs.

**Impact:** The file's own stated rationale (TrackingMonitor.tsx:27-29) is that a moving number in peripheral vision is a competing stimulus and must not be shown during a measured task. That argument is applied to READING_TASK and then not applied to the two tasks whose DVs are latency and search time — where it applies more strongly, since RT is far more sensitive to peripheral onsets than reading is. Worse, the noise it injects is not uniform across cells: transient frequency covaries with tracking quality and the patch's salience covaries with polarity, so it is a confound with the factors under study rather than added variance.

**Proposed fix:** Extend the exclusion list to every measured task: `machine.stage === 'COMPREHENSION' || machine.stage === 'DISPLAY_PERCEPTION' || machine.stage === 'POST_FATIGUE'` (the questionnaire stages) as the allow-list, rather than excluding two stages from all seven. If live monitoring during RT/search is considered necessary, render it as a static non-animating indicator (freeze the digits, no colour transitions) for the duration of a block and update only between blocks — but the safer default is to show the panel only on self-paced screens.

## [medium] The operator manual's withdrawal procedure instructs export and never mentions deletion, contradicting what the consent screen promises the participant

**STATUS: CONFIRMED AND FIXED.** The consent screen tells the participant their data 'can be deleted'; the manual said stop-and-export and never mentioned deletion. The procedure now requires the operator to ASK, and names the media files and backup_*.json that Purge cannot reach.

`docs/OPERATOR_MANUAL.md`:210

**Evidence claimed:** setupStages.tsx:643-645 (the text the participant agrees to): "You may stop at any time without penalty; tell the researcher to withdraw and your data for this session can be deleted." docs/OPERATOR_MANUAL.md:210, the only withdrawal procedure in the manual: "| Participant withdraws | Their right, at any time | Stop immediately. Do not ask why. Session Manager → the session under **In progress** → **Export**. The export records the sitting as incomplete and lists only the conditions that ran. |" There is no step directing the operator to bin or purge, no step asking the participant whether they want deletion, and §7 (lines 221-226) then instructs the operator to take the closing photograph and download the media files.

**Failure scenario:** A participant withdraws at condition 6. The operator follows the manual exactly: stops, exports the partial sitting, downloads the media files including the setup photographs and any annotation clip, and moves on. Nothing is deleted. The participant leaves believing, on the basis of the consent form they signed, that their data for that session has been deleted. It is now on the researcher's machine, in a backup_*.json, and — being non-deleted — in the next pooled analysis_long.csv.

**Impact:** The instrument's operating procedure systematically produces the opposite of the outcome the consent document promises. This is a documentation-versus-consent contradiction in a human-subjects protocol, not a code bug, and it will be invisible in the data because a withdrawn-and-exported sitting is indistinguishable from an interrupted one.

**Proposed fix:** Rewrite OPERATOR_MANUAL.md:210 to a two-branch procedure: stop; ask whether they wish their data deleted; if yes, Session Manager → Record withdrawal → Purge (and delete any already-downloaded media and backup files, naming them); if no (they consent to the partial record being kept), export with the withdrawal recorded on the session. Add the same branch to the §8 checklist.

## [medium] The manual tells operators a changed consent decision 'has to be taken again from the consent screen', but no route back to CONSENT exists

**STATUS: PARTLY CONFIRMED AND FIXED (documentation).** True within a sitting — consent_given is never reset and no route back to CONSENT exists — but a NEW sitting does present it afresh. The manual now says so, and warns against starting a second session for the same visit as a workaround, which would corrupt the counterbalancing.

`docs/OPERATOR_MANUAL.md`:84

**Evidence claimed:** docs/OPERATOR_MANUAL.md:84-85: "If a participant changes their mind, that is a change of consent and has to be taken again from the consent screen." In the code, CONSENT is reachable in exactly one way: stateMachine.ts:216, `if (!p.consentGiven) return 'CONSENT';` inside `firstUnsatisfiedSetupStage`, used only on the resume path. SETUP_ORDER (stateMachine.ts:17-31) is a forward-only chain and `nextState` never returns to an earlier stage. Experiment.tsx:657 sets `consent_given: true` permanently, so even a resume skips CONSENT thereafter. There is no back control on any stage component.

**Failure scenario:** A participant declines camera measurement at consent, then at condition 3 says they have changed their mind and are happy for blink measurement to run. The operator consults the manual, which tells them to take consent again from the consent screen. There is no way to get there. The operator's only options are to leave the participant's stated wish unhonoured, or to delete the sitting and start over — which would consume the enrolment number's condition offset and lose three conditions of real data.

**Impact:** A documented operating instruction is unexecutable, and the failure occurs in front of the participant. The same gap blocks the reverse direction — a participant who wants to stop the camera mid-session — for which the only lever is abandoning the sitting.

**Proposed fix:** Add an operator-accessible 'Amend consent' action (e.g. from the progress header or Session Manager on an in-progress session) that re-renders the Consent component pre-populated with the current grants, writes the amended `media_consent` back to the session with an amendment timestamp, and — via the revocation path from finding #1 — deletes media whose grant was withdrawn. Export the amendment so the change is visible in the data. Until it exists, correct the manual to state that consent decisions are fixed for the sitting.

## [medium] display_label is unvalidated free text prompted as 'Rename session' and is written verbatim into session_*.json and backup_*.json in every export

`src/start/SessionManager.tsx`:116

**Evidence claimed:** SessionManager.tsx:116-117: `const label = window.prompt('Rename session', sessionLabel(s));` — an unbounded free-text prompt pre-filled with the participant code. gather.ts:179-182 `renameSession` stores it with only `label.trim() || null`: no length cap, no charset restriction, no warning. types.ts:105-106 calls it an "Optional researcher-editable display label (rename). Falls back to participant_id." export.ts:806-810 spreads the whole `session` object into the analysis JSON, and backup.ts:129 does the same into BackupData. Empirically: setting display_label to 'Priya Sharma (roll 21BOPT045)' and running buildExportFiles produced `"display_label": "Priya Sharma (roll 21BOPT045)"` in both session_VER_01_sess-ver.json and backup_VER_01_sess-ver.json.

**Failure scenario:** An operator managing twenty sessions on one tablet renames them to keep track: 'Priya S — Tue am'. The free-text prompt invites exactly this and nothing discourages it. Every subsequent export writes the name into two JSON files that travel with the de-identified CSV bundle, and into the backup that is the designated off-device copy. The bundle is no longer de-identified, and the identifier is in the two files least likely to be inspected.

**Impact:** A direct re-identification channel into files the protocol treats as de-identified, created by a UI affordance whose only purpose is human-readable labelling. It also defeats the separation the codebook describes, in which 'the link to the enrolment record is held separately'.

**Proposed fix:** Either restrict display_label to the same charset as participant_id with an inline warning ('do not enter names'), or keep it free text but exclude it from every export path: strip it in `buildExportFiles`'s jsonBundle and in `buildSessionBackup`, and treat it as device-local operator metadata only. The former is preferable, since a restore should not silently lose the operator's labels.

## [medium] The exported codebook asserts sixteen times that participant_id 'Never contains identifying information', but nothing validates it and it becomes part of every media filename

**STATUS: CONFIRMED AND FIXED.** The claim was repeated 16 times and validated nowhere; the app only checks a character class, so PriyaSharma passes, and the value propagates into the filename of every face photograph. All 16 now state it as a protocol requirement on the operator rather than a guarantee the software makes, and the input label says CODE, not a name.

`src/storage/export.ts`:247

**Evidence claimed:** export.ts:247-262 repeats for all 16 numbered CSVs: "De-identified participant code. Join key across every file in the bundle. Never contains identifying information; the link to the enrolment record is held separately." The only constraint anywhere is setupStages.tsx:79 and :94, `/^[A-Za-z0-9_-]{1,20}$/`, which accepts `PriyaSharma`, `RollNo21045` or `PSharma_21`. The field's own label is "Participant ID (letters, digits, - or _, ≤20)" — no instruction against names. export.ts:52-56 `mediaFilename` then embeds it in every photo and video filename: `media_${safe(session.participant_id)}_S${session.session_index}_...`, so a face photograph is written to disk under whatever the operator typed.

**Failure scenario:** A tired operator enrolling their fourth participant of the morning types 'PSharma' instead of 'P004'. Twenty CSVs, two JSON files and three JPEG/WebM files of that person's face are then written under that identifier, and 00_CODEBOOK.csv ships alongside them stating flatly that the identifier never contains identifying information. Anyone auditing the de-identification reads the codebook rather than the values.

**Impact:** The bundle's own data dictionary makes a de-identification guarantee the instrument does not enforce, in a study whose ethics declaration promises de-identified storage. Because the promise is repeated on every file, an auditor is more likely to trust it than to inspect the column.

**Proposed fix:** Enforce a code-shaped pattern at enrolment (e.g. `/^[A-Za-z]{1,4}[0-9]{2,5}$/`) with an inline note that names, roll numbers and initials must not be used; or, if free-form codes must be allowed, soften the codebook text to 'Researcher-assigned code — the protocol requires that it carry no identifying information' so the file states a requirement rather than a false guarantee.

## [medium] RT dot visual angle is device-dependent and its size-to-eccentricity ratio changes with the scale, recorded only via the session-level stimulus_scale

`src/tasks/ReactionTimeTask.tsx`:450

**Evidence claimed:** config.ts:80 sets RT_DOT_PX: 52, a fixed design-canvas pixel size, used at ReactionTimeTask.tsx:409 (the exemplar shown in the instructions, with the comment 'Show the actual target, at the size it will appear') and at line 450 (the stimulus). The dot renders at 52 root-px, i.e. 52 x --vl-scale CSS px on the panel — 39.5 px at scale 0.76, 26 px at the stuck 0.5.

Position, by contrast, is a PERCENTAGE: `left: ${clusterPos.current.x}%, top: ${clusterPos.current.y}%` on a `position: fixed; inset: 0` container which the root transform makes root-relative. So eccentricity scales with the root box while the dot diameter scales with --vl-scale — the two do not track each other, and the root box aspect ratio varies by device (previous finding). Nothing in the per-condition rt_results rows records the presented dot size; the only trace is the one session-level stimulus_scale field, which is itself stale (finding 3).

**Failure scenario:** Participant A on the design canvas sees a 52 px dot; participant B on a 0.76-scaled tablet sees a 39.5 px dot at proportionally the same screen position; participant C after the keyboard collapse sees a 26 px dot. All three contribute to the same polarity x colour RT and d-prime contrasts.

**Impact:** Simple RT and detection d-prime are monotone in target size and eccentricity. Between-participant variance in RT and d-prime acquires a device-driven component that no exported column identifies at trial or condition level, inflating the error term against which the polarity x colour effects are tested and reducing power for the split-plot contrasts.

**Proposed fix:** Record the effective presented dot size with each condition's rt_results row (`rt_dot_px_effective = CONFIG.RT_DOT_PX * currentScale()`), and consider specifying the dot in a size that is invariant under the transform (e.g. a fraction of root height) so the visual angle is at least constant relative to the rest of the display.

## [medium] resetViewportFloor is wired only to legacy `orientationchange`, and the fold's own h>w orientation test can be flipped by the keyboard

`src/lib/viewportScale.ts`:188

**Evidence claimed:** installViewportScale() registers resetViewportFloor() on `orientationchange` alone (lines 188-194). It is not registered on `screen.orientation.change` (the non-deprecated event), not on `focusout` / keyboard dismissal, not on `visibilitychange` (a session resumed after the tablet slept re-measures but can never recover a floor lowered before it slept), and not on any app-level 'a new sitting is starting' boundary — so a floor poisoned during sitting 1 persists across a page that is never reloaded.

Separately, foldViewportFloor() infers orientation from the measurement itself (`const portrait = h > w`, line 135) using the same visualViewport that the keyboard shrinks. Verified empirically in portrait 800x1280: opening the keyboard yields 800x600, h>w flips false, the function takes the 'new orientation' branch and RESETS the floor mid-orientation; closing it flips back and resets again. So the keyboard silently resets the floor in portrait and permanently poisons it in landscape — opposite behaviours from the same event, neither intended.

**Failure scenario:** Landscape sitting: keyboard poisons the floor, nothing resets it for the remaining ~90 minutes because no orientation change occurs (the PWA manifest pins orientation:'landscape'). Portrait sitting: every keyboard open/close pair silently resets the floor, so the stability guarantee the running minimum exists to provide does not hold there either.

**Impact:** The stability mechanism the file's header presents as the reason for the running minimum does not behave as documented in either orientation, and the failure direction differs by orientation. This is the mechanism behind findings 1 and 3.

**Proposed fix:** Detect orientation from `screen.orientation.type` or `matchMedia('(orientation: portrait)')` rather than from the (keyboard-affected) visual viewport, listen on `screen.orientation.change` in addition to `orientationchange`, and reset the floor on document `focusout` and on `visibilitychange` -> visible.

## [medium] theme.css documents `.screen` as the correct full-height container while 19 screens still use min-h-screen

`src/styles/theme.css`:71

**Evidence claimed:** theme.css:70-79 states: '`min-h-screen` is `min-height: 100vh`, and `vh` measures the raw viewport ... Anything sized in `vh` is therefore measuring something it is not laid out in ... `.screen` is the correct full-height container for a stage.' grep shows `.screen` is used in exactly one component (src/scales/Cvsq.tsx:96), while `min-h-screen` remains in 15 render sites across FatigueScale.tsx:59, DisplayPerceptionRating.tsx:34, NasaTlx.tsx:55, ComprehensionTask.tsx:95, ReadingTask.tsx:145, TaskIntro.tsx:29, VisualSearchTask.tsx:155, IshiharaTest.tsx:86, SessionManager.tsx:148, BreakScreen.tsx:42, LandingPage.tsx:11, Experiment.tsx:1153, Dashboard.tsx:112, LazyDashboard.tsx:14 and ErrorBoundary.tsx:29. Two of them (ReadingTask, VisualSearchTask) are saved only by an inline `height: '100%'` duplicated by hand with its own explanatory comment (VisualSearchTask.tsx:146-153), which is the convention being restated per-file instead of applied.

**Failure scenario:** A future screen is written by copying any of the 15 existing min-h-screen examples rather than the single .screen example, reintroducing the under-fill (or, on a viewport where 100vh exceeds root height, the unreachable-content clip) with no lint or test to catch it.

**Impact:** The stated safeguard is a convention that the codebase does not follow, so the class of stimulus-validity defect in finding 2 is structurally free to recur. Under the project rule that a comment asserting a safeguard that does not exist is itself a finding, the wording overstates what is in place.

**Proposed fix:** Convert all stage-level containers to `.screen` / `.screen-col`, and add a lint rule or a source-grep test asserting that `min-h-screen` appears nowhere under src/tasks, src/scales, src/screening or src/start.

## [medium] transform:scale() forces grayscale antialiasing and fractional glyph sizes on scaled devices only, so the rendering of the polarity/colour IV differs by device

`src/styles/theme.css`:53

**Evidence claimed:** #root carries `transform: scale(var(--vl-scale))`. On a device at or above the design canvas the scale is exactly 1 (computeScale caps at 1, viewportScale.ts:79) and text rasterises at its authored integer size; on a smaller tablet the same text rasterises through a composited transform at a non-integral em size (CONFIG.READING_FONT_SIZE_PX 22 x 0.76 = 16.72 px; x 0.5 = 11 px). Chrome disables LCD subpixel antialiasing on composited/transformed layers and falls back to grayscale AA, which changes effective stroke weight, and the size of that change is not the same for dark-on-light and light-on-dark rendering nor across inks of different luminance — conditions.ts pins those inks as the IV levels (#000000/#FFFFFF/#1E4ED8/#C81E1E/#C9A400/#00A651 on #FFFFFF or #000000). I have not measured the per-ink magnitude here; what is verifiable from the code is that the AA regime and the sub-pixel glyph metrics are a function of --vl-scale, and --vl-scale is a function of the device.

**Failure scenario:** Two tablets in the study, one at scale 1.0 and one at 0.76, present condition P4 (yellow #C9A400 on white, already the weakest at ~2.4:1 per the conditions.ts header note). On the scaled device the stems are grayscale-antialiased at 16.72 px, measurably lighter; on the unscaled one they are subpixel-rendered at 22 px. The legibility difference between the two devices is larger for the low-contrast chromatic conditions than for the 21:1 achromatic anchor.

**Impact:** Introduces a device x text-colour (and device x polarity) interaction into a design that has no device factor and no device column beyond a truncated user-agent string. The achromatic anchor conditions — the pair the design relies on to vary polarity with contrast held constant — are the least affected, so the artifact bends precisely the chromatic contrasts the anchor is supposed to calibrate.

**Proposed fix:** Run the study on one tablet model, or hold the scale constant across devices by letterboxing to the design canvas (see finding 5) so every session renders at scale 1 or at one fixed scale. If mixed devices are unavoidable, record the device model and the scale per session and treat device as a blocking factor; at minimum photograph the stimulus on each tablet to confirm the rendered inks match the locked hex values.

## [low] planRuns' capRespected flag is discarded by its only caller, and longestRun's comment claims a 'trial-order quality flag' that does not exist

`src/tasks/ReactionTimeTask.tsx`:111

**Evidence claimed:** `const { order } = planRuns(nGo, n - nGo, CONFIG.RT_MAX_RUN);` — the second field is destructured away. foreperiod.ts:69-71 states 'the cap is relaxed rather than looping forever, and the caller is told, because silently returning a sequence that violates its own constraint is worse than a longer run.' foreperiod.ts:134: 'Longest run of identical values, for testing and for the trial-order quality flag.' grep for `longestRun` and `capRespected` outside tests: zero hits in src/ and scripts/ — no such quality flag exists, and nothing stores the realised longest run.

**Failure scenario:** At the shipped 20/12/maxRun=3 the relaxation branch never fires (0 of 20000 draws), so there is no current data impact. But the constraint is one constant away from being unsatisfiable: `planRuns(20, 12, 2)` needs capacity 13·2 = 26 >= 20 and is fine, while lowering RT_MAX_RUN to 1 or raising RT_GO_RATE to 0.8 (26 go / 6 no-go, maxRun 3 -> capacity 7·3 = 21 < 26) makes it infeasible, and the block would then run with an unflagged long tail of go trials — the exact priming artefact the cap exists to prevent — with nothing in the export to identify the affected conditions.

**Impact:** Two false comments as written today (the caller is not 'told' in any consumable sense, and the 'trial-order quality flag' does not exist), plus a latent silent-degradation path that violates the nothing-silently-dropped rule the planRuns docstring itself invokes.

**Proposed fix:** Capture the flag in buildTrials, return it alongside the trials, and record it on the RT summary (e.g. `trial_order_cap_respected` and `trial_order_longest_run` from `longestRun(order)`) exported in 09_rt_summary.csv, or at minimum `console.warn` and set an engagement/quality reason. Until then, correct foreperiod.ts:134 to say 'for testing' only.

## [low] nonAgingDelay lacks the non-finite guard randInt was given, so a NaN delay would hang the RT block forever on a screen with no Pause control

`src/lib/foreperiod.ts`:43

**Evidence claimed:** `const u = Math.min(0.999999, Math.max(1e-9, rand()));` — `Math.max(1e-9, NaN)` is NaN, so u is NaN and the function returns NaN (verified: `nonAgingDelay(300,1600,650,()=>NaN)` -> NaN). A NaN `mean` propagates the same way through `Math.max(1, NaN)` -> NaN. Contrast src/lib/timing.ts:30-36, where randInt explicitly guards this: 'Non-finite bounds used to yield NaN, which then became a NaN timeout.' rafDelay (timing.ts:17-19) tests `performance.now() - start >= ms`, which is false for every NaN, so the rAF loop never resolves.

**Failure scenario:** `await rafDelay(NaN)` at ReactionTimeTask.tsx:216 never settles. The participant sits on a fixation cross forever. Pause is deliberately hidden during REACTION_TIME (per the comment at ReactionTimeTask.tsx:463-467), so only a force-quit recovers, losing the condition. Not reachable from today's call sites (Math.random and three finite constants), so this is a defensive gap rather than a live bug.

**Impact:** None currently. It matters because the sibling helper in the same task path was hardened against exactly this and this one was not, so the asymmetry will be read as intentional.

**Proposed fix:** Mirror randInt's guard: `const r = rand(); const u = Number.isFinite(r) ? Math.min(0.999999, Math.max(1e-9, r)) : 0.5;` and add `if (!Number.isFinite(mean)) return min;` alongside the existing `if (!(max > min)) return min;`.

## [low] No-go distractor colours are sampled i.i.d. with replacement, so the four luminance-matched distractors are unbalanced within every block

`src/tasks/ReactionTimeTask.tsx`:109

**Evidence claimed:** `const pick = () => DIST[Math.floor(Math.random() * DIST.length)];` over `RT_DISTRACTOR_COLORS: ['#E42222', '#2869FF', '#8D7300', '#008742']` (4 colours), applied independently to each of the 12 no-go trials. Expected 3 per colour, SD ≈ 1.5; a block getting 6 reds and 0 greens is unremarkable.

**Failure scenario:** Two conditions of the same participant draw different distractor compositions purely by chance. If false-alarm probability differs at all across the four hues (they are luminance-matched, not equated for salience against a given condition's chromatic text), the false-alarm rate — which config.ts and timingModel.ts:314-317 both note is the noisier half of d' because no-go trials are the minority — carries extra between-condition variance unrelated to polarity or text colour.

**Impact:** Adds noise to the FA rate, i.e. to d' and criterion, on a factor that is trivially controllable. It partly undoes the care taken in config.ts to luminance-match the distractors so go/no-go discriminability would not vary across display conditions. Modest, but free to fix.

**Proposed fix:** Build a balanced distractor multiset for the block (3 of each colour for 12 no-go trials, or `ceil/floor` when the count is not divisible by 4) and shuffle it, assigning colours to the no-go slots of `order` in that shuffled sequence. Record the realised composition if you want it as a covariate.

## [low] camera_active, fps_adequate_for_ratio and qc_overall can never be empty, contradicting the 'no eye record' missing-value meanings in the codebook

`src/storage/analysisExport.ts`:241

**Evidence claimed:** analysisExport.ts:241 `camera_active: sum.camera_active,` where aggregate.ts:351 defines `const cameraActive = eye?.camera_active ?? false;`, and analysisExport.ts:246 `qc_overall: sum.qc.overall` where all four flags are forced to 'warn' when cameraActive is false (aggregate.ts:356-361), so a condition with no eye record whatsoever exports camera_active=false and qc_overall='warn'. The codebook declares camera_active missing = 'no eye record' (analysisCodebook.ts:188) and qc_overall missing = 'no eye record' (analysisCodebook.ts:198) — states the writer cannot produce.

**Failure scenario:** A condition is aborted after its condition row is written but before endCondition() runs, so no eye_metrics row exists (useTracking.ts:414-436 writes one only at endCondition). The exported row says camera_active=false — 'tracking did not run' — which is indistinguishable from a participant who declined the camera, and qc_overall='warn' rather than the worst flag. An analyst filtering `qc_overall != 'bad'` retains a row with no ocular measurement at all.

**Impact:** Small, because the ocular columns on such a row are null anyway, but it is a documented missing state that cannot occur and a default that asserts a fact (camera declined) about a record that does not exist.

**Proposed fix:** Carry the distinction: `camera_active: e ? sum.camera_active : null` and `qc_overall: e ? sum.qc.overall : null` (the eye record `e` is already in scope at analysisExport.ts:134), or change the codebook's `missing` text to say the column is never empty and that false covers both 'declined' and 'no record'.

## [low] Rows from a session with no participant id are exported with an empty grouping key and appear in no join-report row

`src/storage/analysisExport.ts`:283

**Evidence claimed:** joinIntegrity.ts:72-81 `continue`s past the byParticipant Map for a falsy participant_id, so such a session produces an issue but no ParticipantJoin row. buildAnalysisDataset (analysisExport.ts:283-292) still builds contexts for every bundle, so the rows are written with `participant_id: s.participant_id` = ''. Verified: a bundle with participant_id '' yields 10 rows whose participant_id and row_id prefix are empty ('|sess-verify-0001|cond-0'), analysable=false, exclusion_reason='participant_not_resolved', while analysis_join_report.csv contains only its header and the dashboard reports '0/0 participants analysable'. joinIntegrity.ts:14-17 states the dataset 'ships with a machine-readable statement of exactly which participants are complete, which are not, and why'.

**Failure scenario:** Two such sessions exist. All their rows share participant_id '' , so a mixed model grouping on participant_id treats two different people as one, and neither appears in the join report the exporter offers as the record of who is in the dataset.

**Impact:** Low likelihood (participant_id is set at session creation from the operator form), but if it occurs the random-intercept grouping is silently wrong and the join report understates the dataset's contents.

**Proposed fix:** Give unattributable sessions a ParticipantJoin row (keyed e.g. `unresolved:<session_id>`, analysable false, excluded_by ['session_without_participant']) so they appear in analysis_join_report.csv, and export that synthetic key as participant_id so two unattributable sessions cannot merge into one grouping level.

## [low] illumination_lux_target hard-codes 10/150 instead of reading the ILLUMINATION spec the app actually ran

`src/storage/analysisExport.ts`:160

**Evidence claimed:** analysisExport.ts:160-161: `illumination_lux_target: s.ambient_illumination_level === 'dim' ? 10 : s.ambient_illumination_level === 'moderate' ? 150 : null,`. The authoritative values live in experiment/illumination.ts:51-67 (`ILLUMINATION.dim.target = 10`, `ILLUMINATION.moderate.target = 150`). The module's own header (analysisExport.ts:104-108) states the principle it is breaking: 'Two files that derive the same quantity by two routes will eventually disagree, and the disagreement will be found during analysis, when nobody remembers which route was right.' (The values are correct today, and the level strings 'dim'/'moderate' used at lines 160-166 do match IlluminationLevel, so centreTwoLevel's coding is right.)

**Failure scenario:** A protocol amendment changes the moderate target to 200 lux in ILLUMINATION. Sessions run at 200 lux export illumination_lux_target=150; the manipulation check against ambient_lux_measured then shows a 50 lux discrepancy on every row of every second sitting, with nothing in the file to say which number is the stale one.

**Impact:** None today; it is a latent divergence between the nominal target column and the constant the app actually enforced.

**Proposed fix:** `illumination_lux_target: s.ambient_illumination_level ? ILLUMINATION[s.ambient_illumination_level].target : null` (import ILLUMINATION from '@/experiment/illumination').

## [low] The applyFn === null fallback in applyUpdate() is unreachable dead code whose comment describes a safeguard that can never run

`src/lib/swUpdate.ts`:84

**Evidence claimed:** swUpdate.ts:83-91: `if (!applyFn) { // No registration to update through — reload anyway... location.reload(); return; }`. But `updateWaiting` (swUpdate.ts:30) is set true in exactly one place: the `onNeedRefresh` callback at swUpdate.ts:66-69, which only exists if the `await import('virtual:pwa-register')` at :63 succeeded. And `applyFn = registerSW(...)` (:64) is assigned synchronously from registerSW's synchronous return, before any event can fire. UpdateBanner returns null unless `waiting` is true (UpdateBanner.tsx:22), so applyUpdate() is only ever called when applyFn is non-null. If the import fails, applyFn stays null AND the banner never renders, so nothing can reach the branch.

**Failure scenario:** No runtime failure — the branch cannot execute. The defect is that it makes the module read as if it degrades gracefully when the PWA virtual module is absent (dev, unit tests), when in fact the entire update path is inert in that case and nothing says so.

**Impact:** None directly. It matters because it answers the audit question "is a bare reload safe from every screen the banner can appear on?" misleadingly: the honest answer is that the bare reload never happens, and the real risk is the opposite one — in dev or any environment without the virtual module, installUpdateWatch() swallows the failure (swUpdate.ts:71-73) and there is no way to tell an app with a working update path from one with none.

**Proposed fix:** Delete the branch and make applyUpdate assert (`if (!applyFn) throw new Error('applyUpdate called with no registration')`), or keep it and make it honest by exposing whether the watch actually installed — set a module flag in the catch at :71 and show it next to BuildStamp so "no service worker in this environment" is visible rather than inferred.

## [low] Stale live stats are repainted on remount after the reading task, and per-frame work is duplicated in the payload builder

`src/components/TrackingMonitor.tsx`:46

**Evidence claimed:** TrackingMonitor.tsx:46-51: `useEffect(() => { if (!visible) return; return subscribe(setS); }, [subscribe, visible]); if (!visible) return null;`. The component element is always present in the tree (Experiment.tsx:1180), so React retains `s` while `visible` is false — it is not unmounted, it merely renders null. On re-entry after a 2-3 minute reading task, the first paint shows the pre-reading payload.
Separately, useTracking.ts:221 and 232 both call `faceSizeFromLandmarks(lm)` on the same landmark array in the same frame — a full 468-point min/max pass, run twice, and the second one is inside the payload literal that the line-186 throttle discards 26 out of every 30 times.
Verified NOT defective, for the record: the frameTimes trim (useTracking.ts:180) runs immediately after every push on every path that pushes, so the window is hard-bounded at 2000 ms and there is no unbounded growth; `subscribeLive` is `useCallback(…, [])` so the effect does not resubscribe spuriously, and the returned `liveSubs.current.delete(fn)` closure runs on both unmount and visibility change — no subscription leak; and at LIVE_HZ = 4 `setS` re-renders only TrackingMonitor's own subtree (state is local), so there is no re-render storm in Experiment.

**Failure scenario:** Reading task ends, COMPREHENSION mounts. For up to 250 ms — or indefinitely if the face happens to be absent at that moment, per the face-loss finding above — the operator sees blink and fps numbers from before the reading exposure, presented as current.

**Impact:** Minor on its own; it becomes the persistence mechanism for the frozen-readout failure. The duplicated `faceSizeFromLandmarks` is a small unconditional per-frame tax on the pump in the same direction as the classifyBlinks finding.

**Proposed fix:** Clear the state on hide: `useEffect(() => { if (!visible) { setS(null); return; } return subscribe(setS); }, [subscribe, visible])`, so a remount starts from the honest "no data yet" state rather than repainting history. And hoist the face size: compute `const faceSize = faceSizeFromLandmarks(lm)` once before line 213 and pass the same value to both `agg.ingest` and the live payload.

## [low] A participant who grants setup_photos but declines camera_metrics silently gets no photographs, and the export cannot distinguish that from a capture failure

`src/experiment/Experiment.tsx`:837

**Evidence claimed:** Experiment.tsx:836-841: the session_start photograph is fired from `CalibrationRoutine`'s onDone, and that component renders only when `tracking.status === 'active' && session`; the else branch (`<Calibration cameraStatus={...} onDone={() => advanceOrResume('CALIBRATION')} />`) never calls captureMedia. tracking is started only from the CAMERA_SETUP branch at Experiment.tsx:817-826, which renders `<CameraDeclined>` whenever `media_consent.camera_metrics !== true`. So with setup_photos=true and camera_metrics=false, `tracking.mediaSource()` is null and captureMedia returns at Experiment.tsx:357 — a silent no-op by design (Experiment.tsx:345-347). The export then writes consent_setup_photos=true beside media_items_retained=0 (export.ts:566, :568).

**Failure scenario:** A participant declines blink measurement but is happy to be photographed at the device, and ticks the photo box. No photograph is ever taken. 01_session_info.csv records consent_setup_photos=true, media_items_retained=0, and 15_media_inventory.csv is empty — the identical signature to a session where the camera failed, where toBlob returned null, or where the operator skipped the closing photo. The setup-compliance evidence the grant exists to produce is missing precisely for the participants whose sessions have no ocular data to corroborate the setup independently.

**Impact:** A granted permission is never exercised and the fact is unrecorded, so setup-proof coverage is silently non-random with respect to camera refusal. Failing closed is the right direction; failing closed silently is not, given the project rule that nothing may be silently dropped.

**Proposed fix:** Record why a consented capture did not occur — e.g. a `media_capture_skips` count or a session-level `setup_photos_unavailable_reason: 'camera_not_started' | 'no_frame' | null` — and export it beside consent_setup_photos. Separately, decide deliberately whether a photo-only grant should be honoured by acquiring a still without starting FaceMesh; if it should not, say so on the consent screen so the participant is not offered a grant that cannot be used.

## [low] --vl-vw / --vl-vh are published but never consumed, and are skipped entirely when the scale does not change

`src/lib/viewportScale.ts`:161

**Evidence claimed:** apply() sets three custom properties, but only after `if (next === applied) return;` (line 161). --vl-vw and --vl-vh are described at line 164 as 'Expose the viewport actually sized for, so a layout can react without re-measuring', yet grep across src/ finds no reader of either — not theme.css, not any component. Because of the early return they are also never written at all on a device whose initial scale is 1, and they go stale whenever the floor moves by less than one quantisation step (0.02) while the scale does not.

**Failure scenario:** Someone writes a screen against `var(--vl-vh)` to avoid the vh trap of finding 2. On the design-canvas tablet (scale 1) the variable was never set, the fallback is empty, and the rule is dropped — the screen silently sizes wrong on exactly the reference device.

**Impact:** No effect on current data. It is a latent trap directly in the path of the correct fix for finding 2, and a comment describing a facility that is not usable as described.

**Proposed fix:** Either set --vl-vw/--vl-vh unconditionally (move them above the `next === applied` early return, since the floor can move without the scale moving) or delete them and the comment.
