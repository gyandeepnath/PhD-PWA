# Audit findings

An adversarial audit of the instrument, run across ten dimensions. Fifty-two distinct findings.

**Status of the verification.** Each finding was to be checked by three independent agents applying
different lenses (does it exist, does it matter, is it reachable). The account hit its API session
limit repeatedly and **every one of those verifier agents failed**, so nothing here carries a
machine verdict. The findings acted on below were re-verified by hand against the code before
anything was changed; the ones still open have NOT been, and some may prove wrong on inspection.
Treat each as a claim to check, not as an established defect.

A note on the first run: it reported all thirteen of its findings as "refuted". That was a bug in
the workflow script — errored verifiers were counted as refutations, so zero returned votes read as
unanimous rejection. All thirteen turned out to be real. The vote counting now treats fewer than two
returned votes as *unverified* and keeps the finding.


## Fixed (21 of 52)

Commits `6c83892` and `bddc493`. Each was verified by hand against the code first.

- **[critical]** The camera-metrics consent grant is written and exported but never enforced — eye data is collected from participants who refused it — `src/experiment/Experiment.tsx`
- **[critical]** Resume never restarts the camera: every condition after an interruption writes camera_active=false and a fabricated incomplete_blink_ratio of 0 — `src/experiment/Experiment.tsx`
- **[high]** disabledEyeMetrics reports the primary outcome as a measured 0 instead of missing — `src/tracking/aggregator.ts`
- **[high]** The ocular-metrics exposure window includes the reading task's instruction screen, so every blink rate and the first/second-half fatigue bins are computed over the wrong window — `src/experiment/Experiment.tsx`
- **[high]** Pausing on the rest screen rewinds the resume pointer over a completed condition, forcing a re-run and duplicating its reaction-time trials — `src/experiment/Experiment.tsx`
- **[high]** The annotation-video consent option can never be shown, so the blink-annotation validation sub-study can never collect a single segment — `src/start/setupStages.tsx`
- **[high]** `eligible` is computed from age 18–80 only, while the protocol's inclusion range is 18–35 with colour-vision and contact-lens exclusions the code never applies — `src/experiment/Experiment.tsx`
- **[medium]** `adaptation_ms_before` reports 60 s or 120 s of grey-field adaptation that did not occur, on every resumed condition — `src/experiment/Experiment.tsx`
- **[medium]** A crash between the closing CVS-Q and NASA-TLX produces two session_end CVS-Q rows, and the integrity audit does not detect it — `src/experiment/Experiment.tsx`
- **[medium]** A fully completed sitting stays `in_progress` unless the operator taps the export button on the participant-facing thank-you screen — `src/experiment/Experiment.tsx`
- **[medium]** One global localStorage resume pointer means starting a second session strands the first in-progress sitting with no way to continue it — `src/storage/sessionPersistence.ts`
- **[medium]** counterbalance.ts claims no participant reads the same passage twice, but there are only 10 passages for 20 condition-runs so every passage is re-read in session 2 — `src/experiment/counterbalance.ts`
- **[low]** The camera-setup screen tells the participant no images are recorded, contradicting the retention they may have consented to one screen earlier — `src/start/setupStages.tsx`
- **[high]** A failed Ishihara screen never sets eligible=false, contradicting the rationale written into the code beside it — `src/experiment/Experiment.tsx`
- **[critical]** Resume drops the participant straight into the condition loop from ANY pre-loop stage, silently skipping consent, profile/eligibility, colour-vision screening, pre-flight, camera setup, calibration, baseline CVS-Q and baseline fatigue — `src/experiment/Experiment.tsx`
- **[high]** A failed Ishihara screen never updates `eligible` / `exclusion_reason`, so a colour-vision-deficient participant is exported as eligible=TRUE with an empty exclusion reason — `src/experiment/Experiment.tsx`
- **[high]** Sitting 2's Ishihara result overwrites a sitting-1 `screen_failed` with `normal` on the shared participant record, and the plate set is identical and deterministically seeded between sittings — `src/experiment/Experiment.tsx`
- **[critical]** Within-condition blink bins compare an absolute performance.now() timestamp to a relative midpoint, so first_half_blink_rate is 0 and second_half_blink_rate is double the true rate in every real run — `src/tracking/aggregator.ts`
- **[high]** fps_adequate_for_ratio is declared in the eye-metrics CSV header and codebook but never written into the row, so the primary outcome's frame-rate gate is blank in every exported row — `src/storage/export.ts`
- **[medium]** FPS_RATIO_THRESHOLD equals the camera's own requested frame rate, so the primary-outcome gate can essentially never be satisfied and yields no usable subset — `src/tracking/blink.ts`
- **[low]** disabledEyeMetrics writes blink_count_incomplete: 0 where every sibling count is null, contradicting the contract stated in its own docstring — `src/tracking/aggregator.ts`

## Open (31)

Not yet acted on, and not yet verified. Ordered by the severity the auditor assigned.


### [PARTLY FIXED — one decision outstanding] [critical] Split sittings delete first-order carryover balance for exactly the ten same-colour polarity-switch adjacencies, while the code and synopsis both claim the split preserves the counterbalancing scheme

**Confirmed by enumeration.** Over 130 participants x 2 blocks a single sitting observes all 90 ordered condition pairs exactly 26 times each; a 5/5 split observes 80 of them 26 times and the other ten exactly ZERO times — P1->N1, N1->P1, ... P5->N5, N5->P5. All ten are same-colour polarity switches, the adjacency the Williams square is justified by.

**Done:** the false claim in config.ts is corrected and now states exactly what the split does and does not preserve. `predecessor_condition_label` is exported on the analysis dataset (empty at a sitting boundary), so the structural missingness is visible rather than inferred from `conditions_per_session`; its codebook entry tells the analyst to check for structural zeros before fitting a carryover term.

**Outstanding decision:** rotating the split point by enrolment — 4/6, 5/5, 6/4 as (enrolment-1) mod 3 — restores all 90 pairs at counts 16-26. Not applied: it makes sitting length vary per participant, which changes the resume path and the operator's expectations. That is a protocol decision. It must be taken BEFORE the split protocol is ever switched on; the default remains 10 conditions per sitting, under which carryover balance is intact.

`src/experiment/config.ts` line 84 · dimension: ?

**What the auditor reports**

config.ts:78-86 says the split into two sittings of five preserves "the counterbalancing scheme and the global serial-position record", and SYNOPSIS_AdtU_Short.md:366 repeats it. Position balance is preserved; carryover balance is not. A split sitting runs positions 0-4 then, days later, positions 5-9, so the 4->5 adjacency never occurs in time. In the Williams square that boundary pair is always (first[4]+r, first[5]+r) = (8+r, 3+r), i.e. every ordered pair whose condition indices differ by 5 — and indices c and c+5 are by construction the SAME colour in OPPOSITE polarity (0..4 = P1..P5, 5..9 = N1..N5). I built the carryover matrix over 130 participants x 2 blocks: single sitting gives 26 for every one of the 90 off-diagonal ordered pairs; split 5/5 gives 26 for 80 of them and exactly 0 for P1->N1, N1->P1, P2->N2, N2->P2, P3->N3, N3->P3, P4->N4, N4->P4, P5->N5, N5->P5. Not degraded — eliminated, in every participant, for the entire cohort. These are precisely the transitions the Williams square is justified by: 'first-order carryover arises chiefly from the light-adaptation transient that a polarity switch imposes' (synopsis:370). The design's own control is switched off for the hue-matched polarity switch, the only transition that isolates the adaptation transient from a hue change.

**Failure scenario given**

The pilot feasibility gate fires (median sitting > 120 min), so the study runs split 5/5 per config.ts:84. Participant 3, block 0, runs P1 as its 5th condition and N1 as its 6th — but those two sit on opposite sides of a multi-day gap. Over all 130 participants the exported 02_conditions.csv contains 26 runs of every condition preceded by every other condition except its own colour-partner, which appears 0 times. An analyst who fits the pre-specified carryover term (predecessor polarity x predecessor colour) finds the achromatic->achromatic, blue->blue, ... cells structurally empty and cannot estimate the polarity-switch after-effect at matched hue at all, while the paper states the design balances it. Nothing in the export names the broken adjacency; conditions_per_session=5 is the only trace.

**Suggested fix**

Either make the split boundary a design parameter of the square (choose the split point per participant so the broken adjacency rotates over the cohort — e.g. slice at position (5 + r) mod 10 with a wrap-around plan), or drop the claim: state in config.ts, the synopsis and the codebook that under the split protocol first-order carryover is balanced only for the 80 within-sitting ordered pairs and that the ten same-colour polarity switches are never observed adjacently, and emit a per-condition `predecessor_condition_label` column (null at a sitting boundary) so the missingness is explicit in the data.


### [high] Sitting 2 overwrites the shared participant record's screening result and baseline fatigue; the first sitting's values are unrecoverable

`src/experiment/Experiment.tsx` line 663 · dimension: ?

**What the auditor reports**

saveProfile was fixed to merge into the existing participant row (lines 391-417, with an explicit comment about the record being shared across sittings). Two other writers on the same row were not. Both run in EVERY sitting, because SETUP_ORDER (stateMachine.ts:17-31) puts COLOR_VISION and BASELINE_FATIGUE in the setup chain of every new session, and a second sitting is started with "+ New Session" and the same participant id.

BASELINE_FATIGUE, line 663:
```
const p = await get('participants', session.participant_id);
if (p) await put('participants', { ...p, baseline_fatigue: r.mean });
```

COLOR_VISION, lines 517-523:
```
const status = r.status === 'normal' ? 'normal'
  : r.status === 'screen_failed' ? 'screen_failed' : p.cvd_status;
await put('participants', {
  ...p, ishihara_correct: r.testCorrect, ishihara_total: r.testTotal, cvd_status: status,
});
```

Neither preserves the prior sitting's value, and the second one will downgrade 'screen_failed' to 'normal' — the exact downgrade saveProfile explicitly guards against at lines 400-403 ("A failed screening outranks a self-report and must not be undone"). The retest is not independent: PLATES (screening/ishihara.ts:58-65) is a fixed list of six plates with fixed digits presented in fixed order, and IshiharaTest walks it with `PLATES[idx]` without shuffling, so sitting 2 presents the identical digits the participant already saw.

There is only one participant row, so after sitting 2 both sittings' exports report sitting 2's values.

**Failure scenario given**

P07 sits session 1 (10 lux) on 3 March. BASELINE_FATIGUE writes participant.baseline_fatigue = 1.2; COLOR_VISION scores 2/5 and writes cvd_status='screen_failed', ishihara_correct=2. Session 1 is exported the same day. On 10 March P07 returns for session 2 (150 lux) on the same tablet. Setup runs again: BASELINE_FATIGUE overwrites baseline_fatigue with 4.8, and the same six plates with the same digits are re-presented — P07 now scores 4/5, so status='normal' and the handler overwrites cvd_status='screen_failed' with 'normal' and ishihara_correct=2 with 4. Nothing warns. The operator later re-opens session 1 in the dashboard and exports it again (a normal action — the manual routes every export through the dashboard): 11_participant.csv for session 1 now reports baseline_fatigue=4.8, which the codebook (export.ts:423) calls "Visual-fatigue rating taken before the first condition. The reference for within-session change" — it is the rating taken before session 2's first condition, 8.6 points of scale away from the value session 1 actually measured — and cvd_status='normal' for a participant the instrument screened as colour-deficient. Session 1's screening result exists nowhere in the dataset.

**Suggested fix**

Mirror saveProfile's merge semantics in both writers. Line 663: `baseline_fatigue: p.baseline_fatigue ?? r.mean` (the per-sitting value is already durably stored as the fatigue_scores row with stage='baseline' and this session_id, which is what fatigue_delta actually uses — aggregate.ts:322). Lines 517-523: `ishihara_correct: p.ishihara_correct ?? r.testCorrect`, `ishihara_total: p.ishihara_total ?? r.testTotal`, and `cvd_status: p.cvd_status === 'screen_failed' ? 'screen_failed' : status`. Better still, follow the pattern already used for caffeine_today/hours_since_sleep (types.ts:129-143) and store the per-sitting screening on the SESSION record, leaving the participant row to hold the first sitting's trait values.


### [high] A face-loss gap inside a condition is classified as one continuous blink and one long closure, fabricating multi-second blink durations and micro-sleep events

`src/tracking/blink.ts` line 142 · dimension: ?

**What the auditor reports**

`EyeMetricsAggregator.ingest` pushes to `this.ear` only when `f.facePresent` (aggregator.ts:78), so the EAR series is contiguous in the array but not in time. `classifyBlinks` walks that array with no gap check: once `inBlink` is set, the event closes at the next sample with `ear >= partialT` and takes `duration = s.t_ms - onset` (blink.ts:143) across whatever wall-clock gap sits between them. `computeClosureMetrics` does the same for closure runs — `const dur = present[i].t_ms - (runStart as number)` (blink.ts:308) measures across absent frames. I reproduced it with the real aggregator: 60 s of normal reading (blinks every 4 s, true mean duration ~133 ms), the last visible frame taken mid-blink, then 25 s of face-absent frames, then 60 s more reading. Result: blink_duration_mean_ms = 968 (7x the truth), long_closure_count = 1, long_closure_total_ms = 25167.

**Failure scenario given**

Halfway through the N3 reading exposure the participant turns to ask the operator a question. FaceMesh loses the face for 25 s; the last solved frame catches the lid part-way down during the head turn (EAR is a 2-D projection and drops with pitch/yaw), so the state machine is in a blink when tracking stops. 07_eye_metrics.csv for that condition reports blink_duration_mean_ms = 968 ms and long_closure_total_ms = 25167 ms — the codebook calls the latter 'a micro-sleep proxy'. A 25-second micro-sleep is entered into the sleepiness covariate for a fully awake participant who looked away.

**Suggested fix**

Track the previous sample's timestamp in `classifyBlinks` and `computeClosureMetrics`; when the gap to the next sample exceeds a few frame intervals (e.g. 3 / expected fps, or a fixed 200 ms), abandon the in-progress blink/closure run rather than closing it across the gap. Equivalently, have the aggregator record face-absent frames as explicit series breaks.


### [high] A condition in which the camera ran but no face was ever detected reports blink_rate 0 and head_stability_score 1.0 as measurements

`src/tracking/aggregator.ts` line 148 · dimension: ?

**What the auditor reports**

When every frame has `facePresent:false`, `this.ear` is empty, so `durationMs` is 0 (aggregator.ts:116) and `classifyBlinks` returns []. `blinkRatePerMinute(0, 0)` hits `durationMs < MIN_RATE_WINDOW_MS` and returns 0 rather than null (blink.ts:171), so blink_rate, blink_rate_full and blink_rate_micro are all written as 0. Separately, `movementStd` is `(0+0+0)/3 = 0` over three empty arrays, so `head_stability_score: 1 / (1 + movementStd)` (aggregator.ts:174) is exactly 1.0 — the maximum. I ran this: `{camera_active: true, blink_rate: 0, blink_rate_full: 0, blink_rate_micro: 0, incomplete_blink_ratio: null, head_stability_score: 1, face_presence_ratio: 0}`. This directly contradicts the module's own stated contract in `disabledEyeMetrics` ('Every count and rate here is NULL, not 0 … a zero … reads as "this participant blinked perfectly in this condition"'), which the code honours only for the camera-declined path, not for the camera-on-but-blind path.

**Failure scenario given**

In the 10-lux sitting a participant in glasses sits slightly outside the camera's usable field; FaceMesh solves nothing for the whole N4 exposure. camera_active is written true (useTracking.ts:289 checks only `status === 'active'`), so the row is not filtered out by the obvious guard. 07_eye_metrics.csv shows blink_rate = 0 blinks/min — a maximal, clinically extreme CVS finding — and head_stability_score = 1.0, the best possible QC value, for a condition in which the head was never seen. blink_rate is also carried into 10_wide_summary.csv and the operator dashboard.

**Suggested fix**

Return null from the rate/stability fields when there are no usable samples: make `blinkRatePerMinute` return null below the minimum window, and gate `head_stability_score`/`head_movement_std`/`postural_load` on `this.pitch.length > 0`, as `head_pitch_mean` already is.


### [high] effective_fps measures the frame-processing rate, not the rate at which the EAR series was actually sampled, so the primary outcome's frame-rate gate passes on undersampled data

`src/tracking/aggregator.ts` line 67 · dimension: ?

**What the auditor reports**

`this.frameTimes.push(f.t_ms)` runs before the `if (!f.facePresent) return;` early exit, so `effectiveFps(this.frameTimes)` is the rate at which frames were sent to FaceMesh, including every frame in which no face was solved. But the documented justification for FPS_RATIO_THRESHOLD (blink.ts:37-51) is about catching the frame at a blink's minimum aperture — a property of the EAR series, which only receives face-present frames. The two diverge exactly in proportion to face_presence_ratio. I reproduced it: a 30 fps stream with 60% of frames unsolved yields effective_fps 30.0, face_presence_ratio 0.60, and an EAR series actually sampled at 18 fps. The same denominator problem runs the other way on fast devices: `pump` (useTracking.ts:201-212) re-sends on every rAF tick with PROCESS_EVERY_N_FRAMES = 1, so on a 60 Hz display with sub-16 ms inference the same 30 fps camera frame is sent twice, producing two identical results, two EAR samples and an effective_fps near 60 — precisely the 'duplicating samples and overstating effective_fps' failure the hook's comment claims to have fixed.

**Failure scenario given**

Participant 011 wears spectacles; in the 10-lux sitting FaceMesh solves ~60% of frames. Every condition exports effective_fps ≈ 30, fps_adequate_for_tiers = TRUE, and (once the missing column is written) fps_adequate_for_ratio = TRUE. The analyst treats those ten incomplete_blink_ratio values as unbiased. The EAR series behind them was sampled at 18 fps — below the 25 fps the code itself calls sub-Nyquist — so the sampled minimum EAR is biased upward and the ratio inflated, on exactly the illumination level where detection is worst. The bias is confounded with an independent variable and nothing in the export reveals it.

**Suggested fix**

Compute a second rate over the face-present EAR timestamps (`this.ear.map(s => s.t_ms)`) and gate `fps_adequate_for_ratio` on that, exporting it as its own column. Separately, dedupe sends against `video.currentTime` (or drive from `requestVideoFrameCallback`) so a camera frame is never processed twice.


### [FIXED — one protocol decision left open] [high] The open-eye EAR baseline is a by-product of the 9-point gaze calibration, is taken in a different gaze/head posture than reading, and is never re-measured or re-checkable across a 90-minute sitting

`src/tracking/useTracking.ts` line 261 · dimension: ?

**What the auditor reports**

Every blink threshold is a fraction of `baselineEarRef.current` (partialT = 0.75 x baseline at blink.ts:127; the completeness cut at 0.6). That baseline is set only in `endGazeCalibration` (useTracking.ts:261) from `calibrating.current.samples`, which are collected across the whole 9-target routine — during which CalibrationRoutine instructs the participant to fixate dots at y=0.1 (top row) and y=0.9 (bottom row). `baselineEar` then takes the 90th percentile, which by construction selects the highest-EAR frames, i.e. the up-gaze frames from the top row; the palpebral fissure is widest in up-gaze and narrowest in down-gaze. Reading happens in sustained down-gaze at a tablet, and EAR is an unnormalised 2-D projection with no head-pose correction anywhere in the pipeline. The dedicated still-posture routine `calibrate(ms)` (useTracking.ts:230-243) exists in the TrackingApi and is called by nothing in the app — I grepped src/ and only the gaze routine reaches the baseline. The baseline is then frozen for the whole sitting (10 conditions x ~9 min), while the open-eye EAR itself falls with ocular fatigue and lid droop. Nothing in the export lets an analyst detect that: ear_baseline is the same constant on all ten rows, and no per-condition measured open-EAR (e.g. the median of non-blink frames) is recorded anywhere.

**Failure scenario given**

A participant whose EAR is 0.34 in up-gaze and 0.29 in reading posture is calibrated at 0.34. During reading, partialT = 0.255 instead of 0.2175, so shallow lid movements that are not blinks cross the entry threshold, and every real blink's min_ear/baseline ratio is scaled by 0.29/0.34 = 0.85, pushing events that were genuinely incomplete (ratio ~0.65 against the correct baseline) below the 0.60 cut and relabelling them complete. The primary outcome moves for that participant by a factor that varies with how much they moved their eyes during a 9.5 s calibration. Over the sitting, as their open EAR drifts down a further 5-8% with fatigue, the same relabelling grows monotonically with session_position — producing a spurious FALL in incomplete_blink_ratio across the sitting, the opposite sign to the hypothesis, with no diagnostic column that could expose it.

**Suggested fix**

Call the existing `calibrate()` on a still, straight-ahead, reading-posture fixation to set the EAR baseline (keep the gaze routine for gaze only); export a per-condition measured open-eye EAR (median of frames above partialT) alongside the calibration baseline so drift is visible and correctable; and re-take the baseline at the mid-session break.

**What was done**

The first two. The routine is now a sequence (`src/tracking/calibrationSequence.ts`) whose first step
is a dedicated six-second centre-fixation window, and `measureEarBaseline` — the former dead
`calibrate()` — is the only path in the hook that fits a baseline. `beginGazeCalibration` opens no
EAR window and `endGazeCalibration` fits none; the nine targets contribute iris offset only. Head
pitch zero moved to the same window, for the same reason. `open_ear_measured` is exported per
condition in `07_eye_metrics.csv`, computed with the same 90th-percentile estimator as the baseline
and null below the same 30-usable-frame floor, so within-sitting drift is a column an analyst can
model rather than a bias absorbed silently into the outcome. The recorded outcome is NOT corrected
by it. Tests in `tests/earBaseline.test.ts`, including the misclassification the old pooling caused;
mutation-tested.

**Still open — a protocol decision, not a code one**

Re-taking the baseline mid-sitting. It would track drift directly rather than only making it
visible, but it changes what a participant is asked to do partway through a 98-minute protocol and
means the ten conditions are no longer scored against one denominator. `open_ear_measured` gives the
analysis most of what a re-take would, without that cost. Left for the investigator to decide.


### [FIXED] [high] Passage index is a deterministic function of (condition, serial position): half the corpus can never appear at half the serial positions, for any participant, ever

**Fixed.** Confirmed by enumeration exactly as reported: five passages structurally unreachable at every position, and all 100 (condition, position) cells locked to a single passage. The cause was that the passage offset used `(enrolment - 1) mod N_CONDITIONS` — the same quantity as the Williams row — so both rotations advanced together, and the row is recoverable from (condition, position) in a Latin square. No multiplier fixes this; the shared modulus is the problem. The offset now rotates on `PASSAGE_ROTATION_PERIOD = 13`, coprime to the 10 conditions. All ten passages now reach every position, every (condition, position) cell holds ten distinct passages, and the position x passage counts are exactly uniform at n=130 (26 each) and n=260 (52 each). Four regression tests in tests/counterbalance.test.ts were checked against the reverted code and observed to fail.


`src/experiment/counterbalance.ts` line 72 · dimension: ?

**What the auditor reports**

passageForCondition uses offset = (enrolment-1) mod 10, which is the SAME quantity as the Williams row r. So passage(p) = (SQUARE[r][p] + r) = (first[p] + 2r) mod 10. Because 2r mod 10 only ever takes {0,2,4,6,8}, the passage at a given serial position is locked to the parity of first[p]. I enumerated it: positions 0,3,4,7,8 draw only from passages {0,2,4,6,8}; positions 1,2,5,6,9 only from {1,3,5,7,9} — at n=10 (2 each), n=20 both blocks (8 each) and n=130 both blocks (52 each). Five of ten passages are structurally absent from each position and this never converges with sample size. Equivalently, solving gives passage = (2c - first[p]) mod 10, so passage is a deterministic function of (condition, position): over 200 simulated participants x 2 blocks every (condition, position) cell contained exactly ONE distinct passage. Passage is therefore perfectly aliased with the condition x position interaction and carries no independent information. The module docstring (lines 15-20) and the codebook (export.ts:189, 276, 277) claim only orthogonality to condition, which is true — the position aliasing is undocumented and unguarded: scripts/stress/statemachine.ts checks condition x position and condition x passage, never passage x position, and verifyCorpus.ts checks only pooled corpus spread.

**Failure scenario given**

session_position is exported as a covariate that 'absorbs the vigilance decrement and fatigue accumulation' (export.ts:188). Fit the pre-specified model with session_position as a fixed effect. Positions 0,3,4,7,8 are estimated on passages {Carbon, Immune, Sleep, Plate, Sound} — search-target counts 12/9/14/10/8, FRE 17.3/29.0/16.2/27.4/24.1, spanning both the hardest and the easiest passage in the corpus. Positions 1,2,5,6,9 are estimated on {Ocean, Volcanic, Rainforest, Light, Birds} — target counts 10/11/10/11/10, FRE 18.9-26.6. Since visual-search accuracy is found/searchTargetCount inside a fixed 40 s window, the even-position accuracy denominator has sd 2.4 against 0.55 for odd positions, permanently. The serial-position coefficient — the paper's stated control for time-on-task — is contaminated by a fixed corpus property that no amount of recruitment averages away, and a future corpus edit that passed verify:corpus (which only bounds pooled FRE spread and length) could put a systematic difficulty difference on one parity and no test would catch it.

**Suggested fix**

Decouple the passage offset from the Williams row: use an offset that is coprime-varying with r, e.g. passage = (conditionIndex + 3*(enrolment-1)) mod 10, or better assign passage by serial position from an independent Latin square, passage = (first[p] + k) with k = (enrolment-1) mod 10 taken separately from the condition rotation. Then add a passage x position balance assertion to scripts/stress/statemachine.ts alongside the existing condition x position check.


### [high] No grey-field adaptation precedes the first condition of any sitting, so negative-polarity runs at position 0 start light-adapted from the cream UI and positive-polarity runs do not

`src/experiment/stateMachine.ts` line 104 · dimension: ?

**What the auditor reports**

LOOP_ORDER puts ADAPTATION last (stateMachine.ts:41-49) and nextState goes INSTRUCTIONS -> READING_TASK stepIndex 0 (line 104), so the grey field is delivered AFTER each condition, never before the first one. Experiment.tsx:96-100 and :446 confirm adaptation_ms_before is 0 on 'a cold entry — the first condition of a sitting, or one reached through the resume path'. The synopsis states the opposite: 'A neutral grey adaptation field precedes each condition, extended when polarity switches' (SYNOPSIS_AdtU_Short.md:362). The screen immediately preceding position 0 is the light cream app shell (setupStages.tsx:18, `bg-cream`), so a position-0 condition begins from a light-adapted state. That is symmetric for the five positive conditions (white field -> white field, no transient) and asymmetric for the five negative ones (cream -> #000000, a full light-to-dark transient with no adaptation at all, where the protocol prescribes 120 s). Condition x position is perfectly balanced, so each of the ten conditions occupies position 0 exactly 26 times over 130 participants x 2 blocks: 130 of the 1,300 negative-polarity runs carry an uncontrolled dark-adaptation transient and 0 of the 1,300 positive-polarity runs do. Under the split protocol it is positions 0 and 5, so 20% of runs.

**Failure scenario given**

Participant 3, block 0, opens with N1 (white-on-black) at position 0. They step straight from the cream INSTRUCTIONS screen into a black field and begin the 180 s reading window that is the exposure for the primary outcome. Pupil dilation and blink behaviour over the first tens of seconds reflect dark adaptation, not the display condition. Participant 1 opens with P4 (yellow-on-white) at position 0 and gets no such transient. Across the cohort every negative condition accumulates 26 contaminated runs and every positive condition none, so the polarity main effect on the incomplete-blink ratio — Objective 1 — is shifted by an adaptation artefact that the protocol says was controlled for. The only trace is adaptation_ms_before=0, whose codebook entry (export.ts:190) says '0 for the first condition' without saying the protocol requires otherwise or that the omission is polarity-asymmetric.

**Suggested fix**

Insert an ADAPTATION stage before READING_TASK stepIndex 0 — make INSTRUCTIONS -> ADAPTATION -> READING_TASK, with the duration chosen as the polarity-switch value (the preceding UI is always light, so any negative-polarity first condition is a switch) — and do the same on the resume path in Experiment.tsx instead of jumping straight to READING_TASK. If the stage cannot be added, at minimum state in the codebook that position-0 runs are unadapted and that the omission is confounded with polarity.


### [medium] Backup validation accepts rows with no session_id; they are written to IndexedDB but are invisible to every read path

`src/storage/backup.ts` line 281 · dimension: ?

**What the auditor reports**

validateStructure rejects a row that belongs to a different session, but only when the field is present:

```
if ('session_id' in r && r.session_id !== sessionId) {
  problems.push(`${store}[${i}] belongs to session "..."`);
}
```

A row with no session_id at all passes. Every one of the eleven stores in RESTORE_PLAN carries session_id and is read back exclusively through the by_session index (db.ts:24-35; gatherSession's `bySession` helper, gather.ts:37-38), and IndexedDB omits a record from an index when its key path evaluates to undefined. So such a row is written successfully, counted in ImportResult.written, and is then unreadable by gatherSession, buildExportFiles, auditBundle and purgeSession alike.

I confirmed this against the running code: taking a fixture backup, deleting session_id from the ten eyeMetrics rows, and recomputing the checksum as the writer would, parseSessionBackup returns ok=true; importSessionBackup returns ok=true with written.eye_metrics = 10; getAll('eye_metrics') shows 10 rows in the store; gatherSession returns eyeMetrics.length = 0; and auditBundle reports joins_sound=true, errors=0, with a single WARNING ("eye_metrics: no row for 10/10 condition(s) (the whole store is absent for this session)"). The module's own doc block (backup.ts:236-241) names "a build with a bug" and "a hand-edited file that was re-checksummed" as precisely the threat this function exists to stop.

**Failure scenario given**

A tablet fails and the operator restores participant P12's session from backup_P12_a1b2c3d4.json onto a replacement tablet. The file was written by a build whose eye_metrics rows lacked session_id (or was repaired by hand and re-checksummed). The alert reads "Session restored. Rows written: ... eye_metrics: 10 ..." and the operator files the recovery as complete. When the session is later exported, 07_eye_metrics.csv contains a header and no rows — every incomplete_blink_ratio for the study's PRIMARY OUTCOME is gone — while 16_integrity_report.csv reports joins_sound=true with only a warning, and the ten rows sit undeletable in IndexedDB (purgeSession also reads through by_session, so it will not remove them).

**Suggested fix**

Drop the presence guard and require the field. In validateStructure's per-row loop, replace the condition with: `const sid = r.session_id; if (typeof sid !== 'string' || sid === '') problems.push(`${store}[${i}] has no session_id. Every read path uses the by_session index, so this row would be written and then be invisible.`); else if (sid !== sessionId) problems.push(...existing message...)`. Apply the same to the media_captures loop at lines 301-303.


### [medium] `11_participant.csv`'s `baseline_fatigue` is last-write-wins across a participant's two sittings, and is a literal 0 when the baseline was never administered

`src/experiment/Experiment.tsx` line 415 · dimension: ?

**What the auditor reports**

The participants row is shared across sittings. `saveProfile` seeds `baseline_fatigue: prior?.baseline_fatigue ?? 0` (line 415) and the BASELINE_FATIGUE handler overwrites it with the current sitting's measurement (line 663: `await put('participants', { ...p, baseline_fatigue: r.mean })`). Nothing preserves the first sitting's value — unlike `caffeine_today` and `hours_since_sleep` on the same record, which ARE explicitly pinned to the first sitting (lines 410-412) and documented as such in the codebook (export.ts:297). `baseline_fatigue`'s codebook entry (export.ts:423) reads: "Visual-fatigue rating taken before the first condition. The reference for within-session change." For sitting 1 it is neither, once sitting 2 has run. The type is `number`, not `number | null` (types.ts:78), so the pre-measurement placeholder is 0 — the floor of the 0–10 VAS, which reads as "no visual fatigue at all".

**Failure scenario given**

P007 sitting 1 (dim, block 0): baseline fatigue mean 1.4 → participants.baseline_fatigue = 1.4. Sitting 2 (moderate, block 1) 72 h later: baseline 4.8 → participants.baseline_fatigue = 4.8. At the end of data collection the researcher re-exports every session to a clean folder (the manager's Open → Export path). Sitting 1's `11_participant.csv` now carries baseline_fatigue = 4.8, sitting 2's carries 4.8, and the dim-condition covariate is silently replaced by the moderate session's value — a 3.4-point shift on a 10-point scale, in the same column the codebook nominates as "the reference for within-session change". Separately, if a participant withdraws after the profile stage and the operator uses the in-progress "Export" button (SessionManager.tsx:190), the row ships baseline_fatigue = 0.0 for a rating that was never taken.

**Suggested fix**

Either drop `baseline_fatigue` from the participant record and source it per session from `03_fatigue_scores.csv` (where the correct per-sitting baseline row already lives), or pin it like the other intake fields (`baseline_fatigue: prior?.baseline_fatigue ?? r.mean`) and change the codebook to say it is the first sitting's value. Make the field `number | null` and initialise it to null so an unadministered baseline exports as an empty cell rather than 0.


### [medium] The manual-annotation video segment starts when the reading STAGE mounts, not when the participant taps "Begin reading", so the clip a human codes is offset from the automated measurement window and runs on past the end of reading

`src/experiment/Experiment.tsx` line 469 · dimension: ?

**What the auditor reports**

`ensureCondition()` fires `void captureMedia('reading_segment', …)` at line 469. `ensureCondition` is invoked from the render body of the READING_TASK case (line 641), i.e. while `ReadingTask` is still showing its `TaskIntro` card — the participant has not started reading. `recordSegment` (media.ts:149-166) starts `MediaRecorder` immediately and runs for a fixed `CONFIG.ANNOTATION_SEGMENT_MS` = 180 000 ms. The ocular measurement window, by contrast, opens at `onBegin` (line 656: `onBegin={() => tracking.beginCondition()}`) — a fix made deliberately, with a long comment at lines 645-655 explaining that starting on mount charged self-paced instruction dwell to the measurement window. The video capture still has exactly that bug. Compounding it, the passage corpus is sized so that "four pages and about 600 words … buys roughly 180 s of reading" (passages.ts:12-13), and the segment is exactly 180 s — so any intro-card dwell pushes the tail of the clip past the end of reading and into COMPREHENSION. The consent text the participant agreed to says "Keep short video clips of my eyes while I read" (setupStages.tsx) and "a short video segment of you reading"; `15_media_inventory.csv` labels it `checkpoint=reading_segment`.

**Failure scenario given**

P015 is in the annotation subsample (enrolment 15 ≡ 1 mod 7) and granted the video. Condition 1 mounts; the recorder starts. P015 reads the instruction card for 25 s, then taps "Begin reading" and finishes the four pages in 140 s. The stored 180 s clip therefore contains 25 s of instruction-card dwell, 140 s of reading, and the first 15 s of the comprehension task. The blink annotator codes the whole 180 s as "reading", producing a hand-coded incomplete-blink ratio over a window that includes 40 s of non-reading behaviour, while the automated `incomplete_blink_ratio` in `07_eye_metrics.csv` covers only the 140 s of reading. The criterion-validity coefficient for the primary outcome's classifier (Objective 4) is computed between two different time windows. The clip also contains material outside the scope of the consent the participant gave.

**Suggested fix**

Move the `reading_segment` capture out of `ensureCondition` and trigger it from the `ReadingTask` `onBegin` callback alongside `tracking.beginCondition()`, so the clip and the aggregator window open on the same event. Additionally cap the recorder on the reading-complete callback (stop early if reading finishes before ANNOTATION_SEGMENT_MS) so the clip can never extend past the exposure window, and record the segment's actual start offset relative to the reading window on the media row.


### [medium] `passage_repeat_number` is derived only from the illumination block, so a condition redone after a pause or interruption reports 1 while the participant is reading that passage for the second time

`src/experiment/Experiment.tsx` line 459 · dimension: ?

**What the auditor reports**

`ensureCondition` writes `passage_repeat_number: (session.illumination_block ?? 0) + 1`. The codebook (export.ts) defines the column as: "How many times this participant has read this passage, counting this run: 1 in the first sitting, 2 in the second" — and the counterbalance module's comment (counterbalance.ts:110-119) makes it load-bearing: "The exported passage_repeat_number on 02_conditions.csv makes the exposure explicit so it can be modelled rather than silently absorbed."

But the app has two documented paths that re-present a condition — and therefore its passage — inside the same block: the Pause button on any loop stage other than ADAPTATION saves `machine.stepIndex` and warns "This condition will be restarted on resume" (Experiment.tsx:940-947), and any crash before REACTION_TIME completes leaves the resume pointer at `machine.stepIndex` (line 462). On the redo, `ensureCondition` overwrites the row with the same block-derived value.

**Failure scenario given**

P009 is on condition 4 of 10 (passage 7). During the comprehension questions the operator has to evacuate the room and taps Pause; the dialog says "This condition will be restarted on resume" and they accept. Twenty minutes later they tap Resume. `ensureCondition` overwrites the condition row for position 3 with a fresh `started_at`, `completed_at: null`, and `passage_repeat_number: 1`. P009 re-reads passage 7 in full. The finished export shows that condition with reading_time_ms ~30% shorter than P009's other rows, comprehension 3/3, and a visual-search time far below the participant's own mean — because they have already read the text and know where the targets are — with `passage_repeat_number = 1` asserting this was a first exposure. The analyst has no column with which to model or exclude it.

**Suggested fix**

Count actual exposures rather than deriving them: on writing a condition row, count prior non-deleted condition rows for this participant with the same `passage_id` (across sessions) plus any prior attempt at this same `condition_id`, and store that count + 1. At minimum add an `attempt_number` / `is_redo` column set when `ensureCondition` finds an existing row at this `session_position`, and document it in the codebook.


### [medium] A session with two calibration runs (which every resume on the camera path produces) exports whichever calibration row happens to sort first by random uuid into the `calibration_*` columns of 01_session_info.csv

`src/storage/export.ts` line 539 · dimension: ?

**What the auditor reports**

`endGazeCalibration` writes a new `calibration_data` row with `calibration_id: uuidv4()` on every run (useTracking.ts:266-276); the store is keyed by `calibration_id`, so nothing replaces. The resume path deliberately re-runs the whole calibration — Experiment.tsx:148-160 explains that it must, because the EAR and pitch baselines live in refs that are cleared by the remount — so a session interrupted once and resumed holds two rows.

`normaliseBundle` sorts them by `x.calibration_id.localeCompare(y.calibration_id)` (gather.ts:113), i.e. by random uuid, and the export takes index 0 for four columns:
```
gaze_calibration_valid: bundle.calibration[0]?.is_real_calibration ?? '',
calibration_ear_baseline: bundle.calibration[0]?.ear_baseline ?? '',
calibration_pitch_baseline_frac: bundle.calibration[0]?.pitch_baseline_frac ?? '',
calibration_targets_detected: bundle.calibration[0] ? `${…targets_detected}/${…targets_total}` : '',
```
The codebook (export.ts:300) says `calibration_ear_baseline` is "Open-eye eye-aspect-ratio baseline for this participant. Every blink threshold is expressed as a fraction of this" — which, for the post-resume conditions, is the SECOND calibration's value.

**Failure scenario given**

P011's tablet is picked up and the app reloaded after condition 5. The operator taps Resume; the camera grant is present, so CAMERA_SETUP → CALIBRATION run again and a second `calibration_data` row is written with ear_baseline 0.281 (the first was 0.244, before the participant shifted seating). Conditions 6–10 are measured with `ear_threshold_used = 0.281 * 0.6`; conditions 1–5 were measured at `0.244 * 0.6`. Whether `01_session_info.csv` reports 0.244 or 0.281 is decided by a coin-flip on two random uuids. If the first row wins, an analyst checking the per-condition thresholds in `07_eye_metrics.csv` against the session-level baseline finds five conditions that disagree with the session's own stated calibration and no explanation; if the second wins, the disagreement lands on the other five. `gaze_calibration_valid` can likewise report a passing fit for a sitting whose second half ran on a failing one.

**Suggested fix**

Sort `calibration` chronologically (add and sort on a `calibrated_at` timestamp) instead of by uuid, export the LAST row rather than index 0, and add a `calibration_runs` count column so a re-calibrated session is visible. Better still, stamp the calibration_id onto each eye_metrics row so every condition names the calibration it was measured against.


### [medium] The post-condition fatigue scale shows the participant a colour-coded "Δ vs baseline" after every condition, feeding their previous ratings back into the repeated self-report outcome

`src/scales/FatigueScale.tsx` line 99 · dimension: ?

**What the auditor reports**

Experiment.tsx:753 passes `baselineMean={baselineFatigue ?? undefined}` to the POST_FATIGUE instance of `FatigueScale`. The component then renders, as soon as all five sliders are touched and before the participant submits:
```
<span style={{ … color: composite - baselineMean > 0 ? '#e64c4c' : '#22c97a' }}>
  Δ {(…)} vs baseline
</span>
```
Red when worse than baseline, green when better. This is evaluative feedback on a dependent variable, delivered ten times per sitting, immediately before the participant commits the rating and while they can still move the sliders. It directly contradicts the neutrality rationale the codebase states for the adjacent screen (BreakScreen.tsx:155-157: "It gives NO performance feedback or scores — that would differentially change effort across conditions and confound the display manipulation"), and the same concern applies more strongly here because the feedback is about the measured outcome itself, not about effort.

**Failure scenario given**

P004 completes condition 1 (P1, black on white), sets the five sliders, and sees "Composite: 2.4 — Δ +1.0 vs baseline" in red. They adjust two sliders down before tapping Continue. At condition 2 they now know the running reference and that going up is marked in red; from condition 3 onward they anchor each rating on the remembered delta rather than on their current state. The result is a systematically compressed and order-dependent fatigue series: the accumulation the design is built to detect is suppressed in exactly the later serial positions where it should be largest, and the suppression is confounded with the Williams condition order because it grows with position. `fatigue_mean` and `fatigue_delta` (10_wide_summary.csv) are the affected columns; nothing in the export records that the participant saw their own delta.

**Suggested fix**

Stop passing `baselineMean` to the POST_FATIGUE instance so the delta block never renders, and remove the live "Composite" readout for the post-condition administration as well (keep the per-slider value labels, which are needed to set the slider). If the researcher wants the delta, show it on a researcher-only surface — the dashboard already computes `fatigue_delta`.


### [medium] faceEar throws on a partially-solved landmark array — the exact crash its two sibling modules were hardened against — silently deleting the frame from the EAR series, the face-presence denominator and the fps estimate

`src/tracking/blink.ts` line 73 · dimension: ?

**What the auditor reports**

`gaze.ts:57` and `headPose.ts:76` both guard against short landmark arrays with explicit comments ('MediaPipe returns a short or empty landmark array when a frame is only partially solved. Dereferencing straight through threw inside the per-frame loop, which kills tracking for the rest of the condition'). `faceEar` has no such guard: `LEFT_EYE_EAR.map((i) => landmarks[i])` yields undefined entries and `dist` dereferences `a.x`. I verified: with a 100-element landmark array, `estimateGaze` returns NaN, `estimateHeadPose` returns NaN, and `faceEar` throws 'Cannot read properties of undefined (reading x)'. In `ingestResult` (useTracking.ts:122) `faceEar(lm)` is the first statement inside the `lm && lm.length > 0` branch, so the throw aborts the whole frame: no `calibrating.current.samples.push`, no `agg.ingest`, and therefore no `framesTotal++` and no `frameTimes.push`. The rejection propagates out of `fm.send` into the pump's `catch { /* transient frame error — ignore */ }` (useTracking.ts:206), so it is invisible.

**Failure scenario given**

A participant with heavy spectacle reflections at 10 lux produces partially-solved frames. Those frames vanish from both the numerator and denominator of face_presence_ratio, so the QC column reports high face presence for a condition where a large share of frames failed; effective_fps is computed from the survivors only. If the same thing happens during the 9.5 s calibration, `cal.samples.length` can stay under the 10-sample floor (useTracking.ts:261), `baselineEarRef` is never set, and all ten conditions of that sitting export incomplete_blink_ratio = null.

**Suggested fix**

Give `faceEar`/`eyeAspectRatio` the same guard as its siblings: return NaN when any of the twelve indexed landmarks is missing or non-finite, so the aggregator's existing `Number.isFinite` filter drops the EAR while the frame is still counted in framesTotal and frameTimes.


### [medium] A calibration that fails to produce an EAR baseline is never surfaced to the operator; the return value of endGazeCalibration is discarded and the sitting runs to completion with a null primary outcome

`src/start/CalibrationRoutine.tsx` line 32 · dimension: ?

**What the auditor reports**

`endGazeCalibration` returns `cal.valid` (useTracking.ts:277) and CalibrationRoutine does `await endGazeCalibration(sessionId);` at line 32, discarding it, then unconditionally calls `onDone()`. Experiment.tsx:644 passes `onDone={() => { void captureMedia('session_start').then(advanceOrResume); }}` — also with no branch on validity. Crucially the returned boolean describes only the GAZE fit; whether the EAR baseline was fitted at all (`earSamples.length >= 10`, useTracking.ts:261) is not returned, not stored as a separate flag, and not shown anywhere in the app. `finalize` correctly refuses to fabricate when the baseline is null — `classifyBlinks` returns [] and `summariseBlinks` reports `incomplete_blink_ratio: null` — so the failure is completely silent until export. The operator manual's only check on ocular data (docs/OPERATOR_MANUAL.md:219) is a post-export instruction.

**Failure scenario given**

The camera is granted but the video element is still warming up, or spectacle glare defeats FaceMesh, so fewer than 10 EAR samples land in the 9.5 s routine. The screen shows '9 / 9', advances normally, and the participant works through 10 conditions and roughly 90 minutes of reading, comprehension, search, RT and fatigue scales. The export then carries incomplete_blink_ratio = '' on all ten rows and calibration_ear_baseline = ''. The sitting's primary outcome is unrecoverable, and the participant would have to be re-run.

**Suggested fix**

Have `endGazeCalibration` return both the gaze validity and whether an EAR baseline was fitted; if the baseline is null, show the operator a blocking 'Calibration did not capture an eye baseline — retry' screen with a retry button before allowing the session to proceed.


### [medium] Gaze calibration reports valid = true when only 2 of 9 targets produced samples, leaving the vertical threshold at an unfitted floor while gaze_calibrated is exported as TRUE

`src/tracking/gazeCalibration.ts` line 71 · dimension: ?

**What the auditor reports**

`const valid = totalSamples >= GAZE_TARGETS.length && center.length > 0 && separable;` counts SAMPLES, not targets — and at 30 fps each 800 ms dwell yields ~24 samples, so a single successfully sampled target clears the '>= 9' bar three times over. `separable` is an OR across axes (`edgeH > centerSpreadH * 1.5 || edgeV > centerSpreadV * 1.5`, line 70), so one calibrated axis marks both calibrated. When an axis has no edge samples, its threshold falls back to the `Math.max(0.06, ...)` floor (lines 65-66) but is still reported as fitted. I ran `fitGazeCalibration` with samples for cc/ml/mr only: `{hThreshold: 0.153, vThreshold: 0.06, valid: true}`.

**Failure scenario given**

The tablet is propped low, so when the participant fixates the bottom-row targets their chin leaves the frame and FaceMesh solves nothing; the top row is missed for a different reason. Only cc, ml and mr produce samples. `is_real_calibration` is written true, and gaze_calibrated = TRUE goes onto all ten eye_metrics rows. vThreshold stays at 0.06, far tighter than the ~0.15 that would have been fitted, so ordinary vertical iris travel while reading lines of text puts almost every frame in the top or bottom row: zone_center_ratio collapses toward 0, gaze_deviation_ratio toward 1, and zone_transition_count inflates — all carrying the codebook's assurance that 'gaze columns rest on a valid nine-point calibration'.

**Suggested fix**

Require a minimum sample count per target and a minimum number of targets detected (e.g. >= 7 of 9 with >= 5 samples each), and validate each axis independently — report separate h/v calibration flags rather than a single OR.


### [medium] blink_rate's denominator is the span from the first to the last face-present frame, so unobserved time inside a condition is charged to the rate as if the participant had been watched

`src/tracking/aggregator.ts` line 116 · dimension: ?

**What the auditor reports**

`const durationMs = this.ear[last].t_ms - this.ear[0].t_ms` uses only face-present samples for its endpoints but spans every face-absent gap in between, and that span is the denominator of every `blinkRatePerMinute` call (blink.ts:172). `face_presence_ratio` uses a different denominator (`this.facesDetected / this.framesTotal`, aggregator.ts:183, counted from beginCondition, not from the first solved frame), so an analyst cannot reconstruct the actually-observed time from the export. In my 25 s-dropout reproduction the aggregator reported blink_rate 12.41 against a true 15.0 — a 17% underestimate.

**Failure scenario given**

Two participants blink identically at 15/min. Participant A's face is tracked throughout and exports blink_rate 15.0. Participant B looks away twice for 20 s each during a 180 s exposure and exports blink_rate 11.7. The codebook (export.ts:204) calls the column 'All detected blinks per minute'. Because dropouts are more frequent under the 10-lux condition, the artefactual deficit lands preferentially on one level of the illumination factor and reads as the reduced blink rate that is a validated CVS marker.

**Suggested fix**

Accumulate observed time as the sum of inter-sample intervals that fall below a gap threshold, and use that as the rate denominator; export it as an `observed_ms` column so the analyst can see the window each rate was computed over.


### [medium] perclos_p80 normalises 'closed' to the median blink minimum rather than to actual eye closure, so a participant who never closes their eyes gets a non-zero PERCLOS and the sleepiness covariate is mechanically coupled to the primary outcome

`src/tracking/blink.ts` line 282 · dimension: ?

**What the auditor reports**

`const earClosed = events.length > 0 ? median(events.map((e) => e.min_ear)) : percentileSorted(earsAsc, 0.02);` sets the zero of the openness scale to this participant's own median blink depth, and openness is `(ear - earClosed) / (earOpen - earClosed)`. For a participant whose blinks are all incomplete, earClosed is roughly 0.7 x baseline — the eyes at their deepest are ~30% closed — yet every frame at that depth scores openness <= 0.2 and is counted into perclos_p80. I ran a 180 s stream in which the EAR never fell below 0.21 against a 0.30 baseline (never more than 30% closed): incomplete_blink_ratio = 1.0 and perclos_p80 = 0.0333. The codebook (export.ts:207) states the column is 'Proportion of time eyes >80% closed'.

**Failure scenario given**

An analyst uses perclos_p80 as the pre-specified sleepiness covariate in the model for incomplete_blink_ratio, per the code's own framing ('PERCLOS + long-closure events are reported as covariates'). Both quantities are computed from the same min_ear distribution: shallower blinks raise the incomplete ratio and simultaneously move the openness zero up so that those same shallow frames register as '>80% closed'. The covariate partials out part of the effect of interest, and the reported 3.3% of time '>80% closed' describes a participant whose lids never passed 30%.

**Suggested fix**

Anchor earClosed to an absolute closure reference (e.g. the 1st percentile of EAR across the whole session, or only blink minima that fall below the 0.6 x baseline completeness cut), and return null for perclos when no genuinely complete closure was observed rather than rescaling to whatever the deepest blink happened to be.


### [medium] After a resume, two calibration records exist for the session and the session-level calibration columns pick one at random by uuid sort order

`src/storage/export.ts` line 539 · dimension: ?

**What the auditor reports**

The resume path deliberately re-runs calibration (Experiment.tsx:158 comment) and `endGazeCalibration` writes a fresh record with `calibration_id: uuidv4()` each time (useTracking.ts:265). `normaliseBundle` sorts calibration records by `x.calibration_id.localeCompare(y.calibration_id)` (gather.ts:113) — a random uuid — and export.ts:539-542 then reads `bundle.calibration[0]` for gaze_calibration_valid, calibration_ear_baseline, calibration_pitch_baseline_frac and calibration_targets_detected. Which of the two calibrations describes the row is decided by a coin flip on uuid ordering, and nothing in the export says a second calibration happened.

**Failure scenario given**

A tablet reboots after condition 5. The operator resumes; calibration runs again and this time succeeds where the first attempt had produced an unseparable gaze fit. 01_session_info.csv exports gaze_calibration_valid = FALSE and calibration_ear_baseline = 0.34 (the first, failed attempt) roughly half the time, because that record's uuid happened to sort first — while conditions 6-10 were actually measured against the second calibration's baseline of 0.29. The codebook asserts of that column 'Every blink threshold is expressed as a fraction of this'; for half the conditions it is not.

**Suggested fix**

Sort calibration records by capture time and export the last one, or export one row per calibration in a dedicated file and stamp each eye_metrics row with the calibration_id that produced its thresholds.


### [medium] The calibration screen has no exit if endGazeCalibration rejects — the operator is left on a 9/9 target screen with no control

`src/start/CalibrationRoutine.tsx` line 32 · dimension: ?

**What the auditor reports**

`start()` runs `await endGazeCalibration(sessionId); setBusy(false); onDone();` with no try/catch. `endGazeCalibration` performs `await put('calibration_data', {...})` (useTracking.ts:265), which rejects on any IndexedDB failure — quota exceeded is the realistic one on a tablet that has accumulated consented 30 s reading-segment videos and setup photos in the same database (media blobs are stored in IDB via `put('media_captures', {... blob})`). On rejection neither `setBusy(false)` nor `onDone()` runs. The rendered view for `idx === 8` is a bare target dot plus a '9 / 9' counter — the intro block with the only button is gated on `idx === -1`, so there is nothing to tap and no error text.

**Failure scenario given**

On the fourth session run on a tablet, storage quota is reached. The participant taps the ninth calibration dot; the app sits on a blue dot and '9 / 9' forever. The operator has no button, no message and no indication of what happened; the only recovery is reloading the app, which enters the resume path — and the resume path routes straight back through CALIBRATION, so it hangs again at the same point.

**Suggested fix**

Wrap the body of `start()` in try/catch: on failure set busy false, show the operator an explicit error with Retry and Continue-without-calibration options, and surface the storage error rather than stalling.


### [medium] faceEar has no geometry-validity gate, so a collapsed or degenerate solve produces EAR = 0, which every downstream filter accepts and the classifier scores as a maximally deep complete blink

`src/tracking/blink.ts` line 66 · dimension: ?

**What the auditor reports**

`eyeAspectRatio` divides by `2 * dist(p1, p4) + 1e-6`. headPose.ts:83-95 documents that MediaPipe produces collapsed solves ('every landmark at the same point, as a collapsed or failed solve produces') and added an explicit `geometryUsable` gate so all three axes report NaN together rather than a plausible zero. The EAR path never got that gate: with all landmarks coincident the numerator is 0 and the denominator 1e-6, so faceEar returns exactly 0 — finite, so it survives `Number.isFinite(f.ear)` at aggregator.ts:78 and the `Number.isFinite(s.ear)` filter at blink.ts:123. `classifyBlinks` then sees 0 < partialT and opens a blink with min_ear 0, ratio 0, tier 'full'. (With a partially degenerate solve — eye corners coincident, lids not — the same expression returns a huge finite EAR instead, which enters the baseline percentile.)

**Failure scenario given**

In the 10-lux sitting, occasional collapsed solves during the P2 exposure inject frames with EAR exactly 0 into the series. Each isolated one is scored as a complete blink of the deepest possible kind, adding to the denominator of the primary outcome without adding to the numerator. incomplete_blink_ratio is pulled downward, and because collapsed solves are more frequent in low light, the artefact is confounded with the illumination factor — the same class of failure headPose.ts was fixed for.

**Suggested fix**

Apply the same gate as headPose: return NaN from faceEar when the eye spans are below a minimum extent or any landmark is non-finite, so degenerate frames are dropped rather than measured.


### [FIXED] [medium] A third sitting for a participant who has already completed both illumination blocks silently replays all ten conditions of block 1 and labels them passage_repeat_number = 2

`src/experiment/Experiment.tsx` line 298 · dimension: ?

**What the auditor reports**

beginSession computes `block = Math.min(Math.floor(prior.conditionsCompleted / N_CONDITIONS), N_ILLUMINATION_BLOCKS - 1)` and `offset = prior.conditionsCompleted % N_CONDITIONS`. The block is clamped but the offset is not, so at conditionsCompleted = 20 the block clamps to 1 while the offset wraps to 0. I ran the arithmetic: completed=20 yields block 1, offset 0, plan slice 1,2,0,3,9,4,8,5,7,6 — the entire block-1 sequence again, under the same illumination level. passage_repeat_number is written as `(session.illumination_block ?? 0) + 1` = 2 (Experiment.tsx:459) although it is the third reading of every passage, and session_position is written 0..9 for a second time. resolveAssignment already returns conditionsCompleted and setupStages.tsx declares it in its props (line 39) but never uses it, so the New Session screen cheerfully renders 'Assigned illumination — block 2 of 2' with no warning. Each replay is a separate session record, so the per-session integrity audit (export.ts:713) still certifies 'condition_id and session_position unique'.

**Failure scenario given**

P047 finishes both sittings. A week later the investigator finds the camera consent was mis-recorded in sitting 2 and asks the operator to 'run the second session again'. The operator types P047, sees 'block 2 of 2 — Moderate (150 lux)', sets the room and runs all ten conditions. The dataset now holds 30 condition-runs for P047: twenty legitimate and ten more at illumination_block=1, session_position 0-9, passage_repeat_number=2 when it is actually the third exposure to each passage. An analyst aggregating by (participant_id, condition_label) averages a first/second exposure with a third-exposure run whose practice effect is unmodelled, and 16_integrity_report.csv reports all_checks_passed for every one of the three sessions.

**Suggested fix**

In beginSession, clamp the whole plan, not just the block: if `prior.conditionsCompleted >= N_CONDITIONS * N_ILLUMINATION_BLOCKS`, refuse to create the session. Surface the already-returned `conditionsCompleted` on the New Session screen ('this participant has completed 20 of 20 condition-runs') and require an explicit override that is stamped on the session record, and derive passage_repeat_number from the participant's actual prior exposure count for that passage rather than from illumination_block.

**What was done**

Under the current single-level design the problem is worse than the finding describes: the clamp is
to 0, so it bites after ONE complete pass, not two, and the replay's rows carry
passage_repeat_number = 1 — indistinguishable from a first reading rather than merely off by one.

`src/experiment/participantProgress.ts` now holds the arithmetic that was written out twice, and
keeps the two quantities apart: `passes` counts complete runs through the ten conditions and is
never clamped; `block` is the illumination assignment and is clamped to the levels the design has.
`passage_repeat_number` is derived from the pass (falling back to the block for sittings recorded
before `protocol_pass` existed). The New Session screen renders the participant's existing record —
conditions completed, sittings, enrolment — and, when they have completed a pass, refuses to start
until the researcher writes down why, in the same shape as the out-of-range lux acknowledgement.
Both `protocol_pass` and `repeat_run_note` are stored on the session and exported in
01_session_info.csv with codebook entries saying what a non-zero pass means for the rows.

Not refused outright, deliberately: a sitting voided by a camera failure is a real reason to run a
participant again, and the alternative to recording that decision is not preventing it — it is
losing it. Tests in `tests/protocolReplay.test.ts`; mutation-tested against restoring the clamp,
dropping the console gate, and re-deriving passage_repeat_number from the block.


### [medium] Single-vs-split sitting length is a free per-sitting operator toggle, so a participant's two illumination blocks can be run at different sitting lengths — confounding fatigue exposure with the whole-plot factor

`src/start/setupStages.tsx` line 150 · dimension: ?

**What the auditor reports**

config.ts:80-86 states the split/single decision belongs to the pilot feasibility gate: 'The pilot feasibility gate (§3.6) decides which: if the median session runs over 120 min, or withdrawals exceed 1 in 10, or face-presence drops below 0.90 in more than 10% of runs, each illumination level is split into two sittings of five.' The synopsis (line 366) frames it the same way — a study-wide, pre-specified, all-or-nothing decision. The UI instead offers a per-session Pick control ('Session structure (split shortens each sitting to reduce fatigue/boredom)') whose value goes straight into `conditionsPerSession` at line 150, with no gate, no stored study-level setting, and no consistency check against the participant's earlier sittings. Nothing in beginSession compares the chosen cps with what the participant's block-0 sittings used.

**Failure scenario given**

P062 arrives on a Monday looking tired; the operator picks 'split' and runs 5 dim conditions, then 5 more dim conditions on Wednesday. For the moderate block the operator has a full afternoon free and picks 'single', running all ten in one 110-minute sitting. Illumination is the whole-plot factor and is perfectly confounded with session order within a participant, so P062's moderate-light data now also carries twice the within-sitting time-on-task and half the between-sitting recovery of their dim data. The incomplete-blink ratio rises with time on task, so P062 contributes a spurious dim-vs-moderate difference. Because operators pick 'split' for the participants who look most fatigable, the assignment is correlated with participant susceptibility — exactly the between-participant moderator of Objective 3. The only trace is conditions_per_session in 01_session_info.csv, which no codebook entry flags as an analysis covariate.

**Suggested fix**

Store the split/single decision once as a study-level setting in the `meta` store, set from the pilot result, and derive conditionsPerSession from it rather than from a per-session control; failing that, lock the choice to whatever the participant's first sitting used (available from prior sessions) and refuse to change it mid-participant, and add conditions_per_session to the codebook as a required covariate.


### [medium] '?e2e' anywhere in the URL silently collapses every timing constant, with nothing on screen, in the session record or in the export to say so

`src/experiment/config.ts` line 106 · dimension: ?

**What the auditor reports**

isE2E() returns true whenever `location.search` contains an `e2e` key, and CONFIG (line 133) then swaps in E2E_OVERRIDES for the whole app. That drops READING_PAGE_MIN_MS from 20,000 to 150, VS_TIME_LIMIT_MS from 40,000 to 5,000, RT_TRIALS_PER_CONDITION from 32 to 4, RT_RESPONSE_WINDOW_MS from 1,000 to 120, ADAPTATION_SWITCH_POLARITY_MS from 120,000 to 300, and ANNOTATION_SEGMENT_MS from 180,000 to 400. provenance() (Experiment.tsx:47-52) stamps app_version, git_hash, condition_def_hash and schema_version but not this flag, and grep shows no banner, no session field and no export column derived from isE2E(). The overrides are also not written into 01_session_info.csv, so the numbers the codebook implies (40 s search limit, 32 RT trials) are simply wrong for such a session with no way to tell.

**Failure scenario given**

Someone runs the Playwright suite on the study tablet, or the operator restores a browser session / taps a history entry for http://…/?e2e=1. They enrol P088 and run a full sitting. Every reading page unlocks after 150 ms (only the floor moves, so the participant may still read normally), but the go/no-go response window is 120 ms — below human simple reaction time — so every scored trial in all ten conditions is a miss: d_prime is degenerate, mean_rt_hits_ms is null or based on anticipations, lapse rate is 100%. Visual search runs for 5 s instead of 40 s, so search_accuracy is ~0.1 everywhere. Grey-field adaptation is 0.3 s instead of 120 s, so the polarity-switch control is absent for the whole sitting. The exported CSVs, the integrity report and the codebook all look normal, and the only way to discover it is to notice that one participant's RT and search data are uniformly at floor.

**Suggested fix**

Carry the flag into the record: add `e2e_mode: isE2E()` to Provenance and to 01_session_info.csv, refuse to create a session when isE2E() is true unless an explicit confirmation is given, and render a persistent on-screen banner while it is active. Better still, gate E2E overrides on the build (import.meta.env.MODE) rather than on a URL parameter that survives in history and bookmarks.


### [low] `adaptation_ms_before` records the configured constant rather than the elapsed grey-field time, despite the comment stating it records what was actually delivered

`src/experiment/Experiment.tsx` line 837 · dimension: ?

**What the auditor reports**

The ADAPTATION case computes `dur` from the plan (same-polarity 60 000 ms vs polarity-switch 120 000 ms) and, on completion, stores that same constant: `adaptationDelivered.current = dur;`. `ensureCondition` then writes it as `adaptation_ms_before` under a comment (lines 435-446) that reads "What the grey field ACTUALLY delivered, not what the plan intended … a value that describes the protocol rather than the run is worse than no column, because it cannot be distinguished from a real one." The screen's progress loop is `requestAnimationFrame`-driven (`AdaptationScreen`, setupStages.tsx), and rAF is throttled to zero while the tab is backgrounded or the tablet screen is off — so the wall-clock interval and the grey-field exposure can both diverge from `dur`, in opposite directions.

**Failure scenario given**

Between conditions 6 and 7 (a polarity switch, planned 120 s) the tablet's auto-lock engages after 60 s of the grey field because the participant has not touched the screen. rAF stops; the countdown freezes. Four minutes later the operator wakes the device, rAF resumes and the remaining 60 s of progress plays out. `adaptation_ms_before` for condition 7 is written as 120000, asserting 120 s of continuous grey-field adaptation, when the participant actually saw ~60 s of grey field, then a dark screen for four minutes, then ~60 s more. The column exists to verify the polarity-switch after-effect control and to covary it out; here it certifies a control that did not happen.

**Suggested fix**

Have `AdaptationScreen.onDone` report the measured elapsed time (`now() - start.current`) and store that as `adaptation_ms_before`, keeping the planned `dur` in a separate `adaptation_ms_planned` column. Detect visibility loss during the screen (`document.visibilitychange`) and record it as a QC flag so an interrupted adaptation is distinguishable from a clean one.


### [low] Gaze is normalised against the eyelid landmarks, so every blink is scored as a vertical gaze excursion and inflates zone_transition_count and gaze_deviation_ratio

`src/tracking/gaze.ts` line 77 · dimension: ?

**What the auditor reports**

`leftBoxH = lm[EYE_BOX.botL].y - lm[EYE_BOX.topL].y` uses landmarks 145/159 (lower and upper lid) as the vertical reference box, and `vL = ((irisL.y - topL.y)/leftBoxH - 0.5) * 2`. During a blink the lids close, the box shrinks toward zero and the iris position within it swings wildly, so v leaves the centre band and the frame is classified into the top or bottom row. Blink frames are also not excluded from the calibration fit itself, where `meanAbs` (gazeCalibration.ts:46) — not a median — is used for the centre spread and edge offsets, so a few blinks during the 9.5 s routine move the fitted thresholds.

**Failure scenario given**

A participant blinking 15 times a minute over a 3-minute exposure produces ~45 blinks, each spanning 3-5 frames. Each one enters and leaves a non-centre zone, so zone_transition_count picks up roughly 90 spurious transitions and gaze_deviation_ratio gains the whole blink-frame fraction. The codebook calls zone_transition_count 'a coarse scanning-activity index'; for a fatigued participant who blinks more, the index rises with blink count rather than with scanning.

**Suggested fix**

Skip gaze estimation on frames whose EAR is below partialT (they are blink frames), and use medians rather than means for the calibration spread statistics.


### [low] ear_threshold_used exports the completeness cut, not the blink-detection threshold, so classification cannot be reproduced from the CSV as the codebook promises

`src/tracking/useTracking.ts` line 295 · dimension: ?

**What the auditor reports**

`earThresholdUsed: baselineEarRef.current * 0.6` writes the EAR_TIERS.full cut. The threshold that determines whether a blink is DETECTED at all is `baseline * EAR_TIERS.partial` = 0.75 x baseline (blink.ts:127), and it appears nowhere in the export. The codebook (export.ts:350) describes the column as 'Eye-aspect-ratio threshold actually applied … Recorded so classification can be reproduced or re-cut later' — a single value, implying a single threshold, when the classifier uses two.

**Failure scenario given**

A reviewer asks the candidate to re-cut the incomplete/complete boundary as a sensitivity analysis. Working from 07_eye_metrics.csv the analyst has ear_baseline and ear_threshold_used = 0.6 x baseline, and reasonably takes 0.6 x baseline as the entry threshold for a blink. Every re-derivation is then made against the wrong detection criterion; the 0.75 factor is nowhere in the exported data, and neither are the per-blink min_ear values that would allow a genuine re-cut.

**Suggested fix**

Export both thresholds (e.g. ear_detect_threshold and ear_complete_threshold) and correct the codebook text; better still, persist the per-blink event list (onset, duration, min_ear, tier) so the classification is genuinely re-cuttable.


### [low] illumination.ts asserts balance 'completes at n = 20, which divides the target of 130 evenly' — 130/20 = 6.5, and each Williams row ends 7/6 rather than balanced

`src/experiment/illumination.ts` line 90 · dimension: ?

**What the auditor reports**

The rule ((i mod 2) + floor(i/10)) mod 2 does achieve row x order orthogonality — I verified every row is 1/1 at n=20. But the docstring's arithmetic is wrong: 130 is not a multiple of 20. Running the row x (dim-first / moderate-first) table at n=130 gives r0:7/6 r1:6/7 r2:7/6 r3:6/7 r4:7/6 r5:6/7 r6:7/6 r7:6/7 r8:7/6 r9:6/7 — the last partial block of ten leaves every row one participant off. The existing stress check (scripts/stress/statemachine.ts:124) only asserts that each row meets both orders at least once (a Set size test), so it passes on a 7/6 split and would pass on a 12/1 split. The marginal dim-first count is 65/130, which is why the other assertion passes.

**Failure scenario given**

Recruitment closes at the planned 130 analysable participants. Condition-order row 0 (which starts with P1 and ends with N1) was run dim-first by 7 participants and moderate-first by 6; row 1 the reverse. The paper's methods section states illumination order was fully counterbalanced against the condition row, and reviewers checking the allocation table find a 7:6 residual in every row. The marginal condition x level table is unaffected (each condition appears once per row), so the practical bias is small — but the stated property is not the delivered one and the QA gate cannot detect the difference.

**Suggested fix**

Correct the docstring: balance completes in blocks of 20, and 130 leaves one incomplete half-block, so plan the analysable N as a multiple of 20 (120 or 140) or state the residual. Strengthen the stress check from a Set-size test to an equality test on the row x order counts, tolerating only the documented remainder.


### [low] blockPlan's second-block row shift moves every condition by at most two serial positions, so the within-participant position/condition correlation stays at +0.79 rather than being decorrelated as documented

`src/experiment/counterbalance.ts` line 103 · dimension: ?

**What the auditor reports**

The docstring (lines 100-106) says advancing the Williams row by one 'decorrelat[es] position from condition within a participant'. Because row i+1 is row i with +1 added to every value, the condition at position p in block 1 is simply the block-0 condition at p plus one, so the position of condition c in block 1 is the position of c-1 in block 0 — a fixed permutation, identical for every participant. I computed it: the Pearson correlation between a condition's serial position in block 0 and in block 1 is exactly +0.794 for enrolments 1, 4 and 7 (and every other), and each condition moves by at most 2 positions (shift distribution +2,-1,-2,-2,-2,-2,+1,+2,+2,+2). Group-level balance is genuinely preserved — condition x position over 10 participants x 2 blocks is exactly 2 in every cell — so this is an overstated rationale rather than a bias in the cohort means.

**Failure scenario given**

Participant 1 meets P5 at serial position 9 (last) in block 0 and at position 7 in block 1 — still in the fatigued tail of both sittings. The synopsis (line 372) justifies the row advance by saying that reusing the row 'would allow a position effect to masquerade as a condition effect in the same direction in both sessions'; with a maximum shift of two positions it still does, only attenuated. The consequence lands on the within-participant condition contrasts that carry the power analysis: each participant's own P5-minus-P1 estimate retains most of its position confound in the same direction in both sittings, inflating the between-participant variance of the condition effect (the denominator of the dz the power analysis is built on) without shifting the group mean.

**Suggested fix**

Advance by a stride that moves conditions across the sequence rather than by one, e.g. blockPlan(n, b) = sessionPlan(n + b * (N_CONDITIONS / 2 + 1)); each row is still used exactly once per block of ten so cohort balance is unchanged, but the within-participant position correlation drops. Otherwise correct the docstring and the synopsis to say the advance attenuates rather than removes the within-participant position/condition correlation, and quote the residual r.


### [low] session_position codebook entries contradict the values written: declared unit '1-10' and 'within the sitting' where the column is 0-based and is the position within the illumination block

`src/storage/export.ts` line 274 · dimension: ?

**What the auditor reports**

Experiment.tsx:450-451 writes `session_position: step.position`, and the comment says explicitly 'Global serial position (offset + local index) so split sittings keep a 0..9 covariate'. The codebook gives three inconsistent accounts of the same value: export.ts:188 says 'Serial position within the sitting, 0-based'; export.ts:274 (10_wide_summary.csv) and :275 (12_quality_flags.csv) both declare unit '1-10'. The written values are 0-9, and under a split protocol the second sitting of a block writes 5-9, which is neither 1-10 nor 'within the sitting'.

**Failure scenario given**

An analyst builds the pre-specified model from 10_wide_summary.csv, reads unit '1-10' in the codebook, and treats the column as one-based: either they subtract one (turning position 0 into -1 and shifting the whole vigilance-decrement covariate by one condition) or they filter to 1..10 and silently drop every first-condition run — which is 10% of the dataset and, per the adaptation finding above, exactly the runs with adaptation_ms_before = 0. On a split-protocol participant they additionally read 02_conditions.csv's 'within the sitting' and conclude the second sitting's positions 5-9 mean the participant did ten conditions in that sitting.

**Suggested fix**

Make the three entries agree with the code: unit '0-9', description 'Serial position within the ten-condition illumination block, 0-based; a split second sitting therefore starts at 5, not 0.'


---

## Dimensions that never ran

Six of the ten audit dimensions were never executed, all lost to the API session limit:
`tasks-psychophysics`, `scales-scoring`, `storage-recovery`, `export-analysis`,
`field-robustness`, `ethics-privacy-provenance`. The scales dimension matters most of those — it was
to check the CVS-Q, NASA-TLX and Ishihara implementations against their published scoring rules.

The workflow is resumable, so the four completed dimensions replay from cache and only the missing
six cost anything.

---

## Residual items closed after the round-2 triage

**Every camera frame was sent to the tracker more than once.** The pump was
`requestAnimationFrame`, which fires at the DISPLAY's refresh rate and sent whatever the `<video>`
element was holding without asking whether it was new. A 30 fps camera on a 60 Hz panel had every
frame sent twice; MediaPipe answers each send, so each duplicate produced its own EAR sample and its
own timestamp. `effective_fps` is computed from those timestamps and gates the primary outcome:
FPS_RATIO_THRESHOLD is 30 because a blink lasts 100-150 ms and classifying it complete or incomplete
needs the frame at its minimum aperture, so a tablet genuinely delivering 15 fps would have reported
30, passed the gate, and had `fps_adequate_for_ratio` certify a ratio drawn from blinks sampled once
or twice each. `src/tracking/framePump.ts` now delivers one frame per presented frame, via
`requestVideoFrameCallback` where available and rAF plus a `currentTime` comparison where not, with
a re-entry guard so a slow solver is not queued behind itself. `PROCESS_EVERY_N_FRAMES` now counts
camera frames, which is what it always meant — under rAF it counted display refreshes, so a value of
2 on a 60 Hz panel with a 30 fps camera dropped nothing at all.

**The annotation sub-study took one segment per participant, not one per polarity.** Capture was
gated on `stepIndex === 0`. Two things followed: the annotated volume was half what the kappa >=
0.60 acceptability criterion is set against, and each participant's classifier validation covered a
single polarity, allocated by Williams row rather than by design. Polarity is the factor that most
changes what the camera sees — on a negative screen the face is lit almost entirely by the room, at
the lid margin the EAR landmarks sit on. `annotationSegmentSteps()` now returns the first index of
each polarity present in the plan, so a full sitting yields two and a partial sitting yields only
segments that exist.

**A session run under the test harness had no on-screen mark.** `?e2e` replaces every protocol
duration with a token value and changes nothing else, so the rows are complete, plausible and
exportable; `e2e_timing` made such a session identifiable afterwards, but nothing said so at the
time, on the tablet, to the person about to run a participant. There is now a fixed banner on every
view (pointer-events: none, so it can never sit between an operator and a control) and an
`e2e_timing` integrity check of severity ERROR — there is no analysis in which such a row belongs.

**The illumination-block rotation is documented as an unreachable path.** `blockPlan`'s note
describes decorrelation across two sittings that cannot happen while `N_ILLUMINATION_BLOCKS` is 1.
It is kept because restoring the second level is a live possibility and the rotation would have to
be right on the day, but it now says at the top that it is a specification rather than a description
of what this build does.

---

## Round 3 — the task measures, and the ways data leaves the tablet

Two areas that had not been audited: the per-condition task measures from stimulus to exported
column, and every path by which data leaves or can be lost. Both were verified finding by finding
against the code before anything was changed; two of the reported findings turned out to be safer
than reported and are recorded here as such.

**Fixed — measurement**

- `search_d_prime` and `distractor_words` counted whitespace as words. The renderer's tokeniser is a
  capturing split, so the token array is about twice the passage's length in words: passage 0 has
  601 words and 1,201 tokens, and `distractor_words` exported 1,189 against a true 589. It does not
  cancel within a participant, because d′ uses the false-alarm RATE and the inflation scales with
  the false-alarm count — itself a dependent measure varying with the display condition. Same
  measure: false alarms counted tap EVENTS while hits counted words, so a double-tapped wrong word
  contributed two.
- `reading_time_ms` subtracted a wider window than it measured. The hidden-time tracker started at
  mount, while the self-paced instruction card was up; `taskStart` is set on "Begin reading". A 96 s
  absence on the intro plus a normal 178 s read exported 82,200 ms — 439 wpm for someone reading at
  202 — in a row that satisfied its own codebook definition, and a long enough absence exported a
  clamped zero.
- The last comprehension item could be recorded twice, because `onComplete` sits in the effect's
  dependency array and the parent passes a fresh arrow each render. Four rows for a three-item
  passage, with the proportion correct scored over four.
- Per-condition backgrounding is now recorded at all (`condition_hidden_ms`,
  `condition_hidden_events`), and the two duplicated hidden-time trackers are one module.

**Fixed — the data's exits**

- An overwrite restore destroyed media blobs still on the device: the carry-forward guard read the
  store AFTER `purgeSession` had emptied it, so it was dead in exactly the mode it exists for. The
  test that covered it wrote the media row but never the sessions row, so it passed in a device
  state that cannot occur.
- A missing collection was indistinguishable from an empty one, and the UI hid zero counts — 320
  reaction trials dropped by a shape mismatch left the same trace as a session that had none.
- The overwrite confirmation carried nothing to compare: no row counts, no end times, no export
  status, for a hard delete outside the recycle bin.
- The shared participant record was replaced without a word, reverting the eligibility decision and
  colour-vision result for both of a participant's sittings.
- `withdrawn_at` was read in three places and set in none, so the manual's own withdrawal procedure
  had no control — and when one was added, the restore turned out to take the tombstone from the
  FILE, which predates the withdrawal in exactly the case that matters.
- The export manifest's `bytes` was a UTF-16 code-unit count, and `verifyExport`'s section for it
  checked only that a manifest existed.
- A device that filled mid-sitting failed one write loudly and the next ninety minutes silently.

**Reported as defects, found to be sound**

- The RT distractor palette really is luminance-matched (L = 0.177–0.179; 4.54–4.59:1 on black,
  4.58–4.62:1 on white), so no-go discriminability does not vary with polarity.
- The condition-redo path does not double-count: child stores are keyed by `condition_id` or
  explicitly cleared first, and the condition row is rewritten with an incremented `attempt_number`.

**Not fixed, and why**

- A replacement tablet cannot detect an enrolment number issued on a different device — the scan is
  necessarily local. The restore now says so rather than implying the check is complete.
- `system_performance_logs` is declared, purged, and never written, and is in no backup path.
  Nothing is lost today; a ratchet test requires the backup to cover it if a writer ever appears.

---

## Round 4 — ledger triage, and what it turned up that the ledger did not have

Every unmarked finding in this file was re-checked against the code as it stands, by agents
instructed to open the code rather than trust the entry. **Thirteen of fourteen were already FIXED**
and had simply never had their headings updated — each verdict was confirmed with a reproduction on
the real module, not by reading the diff.

The value was not in the confirmations. It was in the residuals: defects adjacent to a fixed one,
which the original finding did not describe and which survived its fix.

**Fixed in this pass**

- **The within-condition halves still charged unobserved time to the rate.** `blink_rate` was moved
  onto observed time precisely because charging dropouts to a rate makes a tracking failure look
  like the effect under study — a reduced blink rate is this protocol's own marker of visual
  fatigue. `first_half_blink_rate` and `second_half_blink_rate`, sitting beside it, were left on the
  wall-clock span. Reproduced on the real aggregator: a true and constant 15 blinks/min over 180 s
  with two 20 s dropouts gave `blink_rate` 15.03 next to halves of 12.01 and 11.35 — a fabricated
  ~20% within-condition decline, in both halves, entirely from look-aways. Both columns carry role
  `dv`, so the codebook offers them as evidence of drift rather than as QC. The split stays
  wall-clock (the halves are about *when* in the exposure a blink happened); only the denominator
  changed. The gap threshold is computed once on the whole series and applied to both halves, so a
  half containing a long dropout cannot raise its own threshold and absorb it.
- **`effective_fps` was documented as the processing rate in three places** after it was changed to
  measure the EAR series. An analyst reading 18.0 would conclude the camera ran at 18 fps, when it
  ran at 30 and solved 60% of frames. Corrected in `07_eye_metrics.csv`, `10_wide_summary.csv` and
  the analysis codebook.
- **`adaptation_ms_before` still said "0 for the first condition".** False since the pre-first grey
  field was added — a `session_position=0` row now carries a normal adaptation value, and 0 means
  the field was *not delivered*. The old sentence was the only trace the original defect left.
- **`cvd_screen_correct`/`_total` were last-write-wins while `cvd_status` is sticky.** A participant
  who scored 3/6 and was marked `screen_failed`, then 6/6 at the next sitting, exported
  `screen_failed` beside 6 of 6 — a verdict next to numbers from a different, passing administration
  that contradict it. Exclusion was never affected; this is the kind of QC contradiction an analyst
  resolves the wrong way, by trusting the numbers over the flag. The counts now follow the
  administration that produced the status.

**Still LIVE, and an investigator decision rather than a code change**

- **Single-vs-split sitting length is a free per-sitting operator toggle.** One participant can be
  run as one ~110-minute sitting and the next as two halves, on the operator's judgement of how
  tired they look, with nothing in the export recording that it was a judgement rather than a
  study-wide setting. That is fatigue exposure varying between participants for a reason correlated
  with how they presented. Either fix the structure study-wide, or record the reason per sitting the
  way the lux deviation and repeat-run notes already are.

**Residuals recorded, not acted on**

- The gaze acceptance criterion counts a target as covered at **one** sample, where the original
  finding asked for five. At 30 fps an 800 ms dwell yields ~24, so a target contributing one sample
  had an almost entirely unsolved dwell, and six such targets would still report `valid = true`.
  Weaker than intended rather than broken; how strict the bar should be is a methods decision.
- `calibration_targets_detected` counts raw samples while the validity check counts finite ones, so
  the two can disagree by a target whose dwell produced only non-finite gaze estimates.
- The resume path enters the condition loop without a grey field, so a resumed condition starts from
  whatever the participant was last looking at. Narrower than the original finding, which was about
  every first condition, but the same mechanism.

---

## Round 5

**The codebook declared a type for every column and nothing checked it**

`scripts/buildCodebook.ts:76` asserts only that `type` is non-empty. Across ~650 columns the
declared type was therefore documentation that no test could contradict, and it had already drifted:
`calibration_targets_detected` was declared `integer` and emitted `"9/9"`.

That is not cosmetic. `as.integer("9/9")` in R is `NA` with a warning, not an error, so a QC filter
written from the codebook — drop sittings with too few calibration targets — silently kept every
sitting instead of dropping the bad ones. The column reads as a number to a person and parses to
missing in the analysis, and nothing anywhere reports the discrepancy.

`scripts/verifyExport.ts` now checks every emitted value against its declared type over the real
export path (4,985 typed cells in the fixture). Empty stays legal for every type — it means "not
applicable" throughout this export, and completeness is a separate check that already exists.
Reintroducing the ratio string fails the gate by name: *"01_session_info.csv:calibration_targets_detected
declared integer, got \"9/9\""*.

The column now emits a bare count. The denominator carried no information — it is `GAZE_TARGETS.length`
on every row, and the unit already states the range.

**`targets_detected` and the validity verdict counted different things**

`useTracking.ts:552` counted targets with at least one RAW sample; `fitGazeCalibration` decides
validity after dropping non-finite ones. `faceEar` returns NaN for a degenerate landmark solve, so a
target whose entire dwell failed to solve was exported as "detected" and excluded from the fit at the
same time — the QC column overstating coverage in precisely the case it exists to reveal.

Fixed at the root rather than by duplicating the filter: `fitGazeCalibration` now returns
`targetsWithSamples`, the same count its own verdict is decided on, and the caller reads it. One
definition, so the two cannot drift apart again. `targets_total` now derives from
`GAZE_TARGETS.length` instead of a literal `9`.

**A resumed condition began with no grey field**

Every other condition in a sitting is preceded by a controlled adaptation field. The resume path
went straight to `READING_TASK` (`Experiment.tsx`), so a condition reached after an interruption
started from whatever the participant had been looking at — the setup UI, the room, the operator's
screen. This is the same mechanism the pre-first-condition field exists to remove, reached by a
different route, and it landed on the one condition whose onset was least controlled.

The export was already honest about it: `adaptation_ms_before` recorded 0 rather than claiming a
field that never ran. So this was a protocol gap, not a fabrication — but a resumed condition was
not comparable with the others.

Resume now re-enters at `{ stage: 'ADAPTATION', stepIndex: loopTarget - 1 }`. Reusing the existing
step rather than adding a special case buys two things: the polarity-switch duration is computed
across the interruption from the real pair of conditions, and a resume landing on a break boundary
still gets its `BREAK_SCREEN`, which is where the mid-sitting illuminance prompt lives. A
`loopTarget` of 0 yields stepIndex -1, which is exactly the state a fresh sitting walks into.

The arithmetic is guarded in `tests/stateMachine.test.ts` across every resume point and for a split
sitting, because an off-by-one here would silently repeat a finished condition or skip an unrun one.
Both directions were mutation-tested and both fail the guard.

**Residual, recorded rather than silently decided:** the adaptation duration rule compares the
previous condition's polarity with the next one's, which assumes the previous condition is what the
eye is still adapted to. After an interruption of unknown length it is the room instead. Whether a
resume should always take the longer switch field is a methods decision for the investigator.

**Still open, unchanged from Round 4**

- The split-vs-single sitting length remains a free per-sitting operator toggle, with nothing in the
  export recording that it was a judgement call. Investigator decision.
- The gaze acceptance criterion still counts a target as covered at one sample where the original
  finding asked for five. A methods decision about how strict the bar should be, not a defect.

---

## Round 6 — the R analysis template

R was installed in the audit environment for the first time, which turned a set of static
suspicions into executed fact. The headline: **`analysis_template.R` did not run.** Not "ran with
caveats" — it stopped at its first join and no model in the file had ever been fitted.

**It selected a column that does not exist**

`select(..., lux_all_in_range)` from `01_session_info.csv`, where the exporter writes
`lux_logged_all_in_range` — a deliberate rename, because that column reports only on readings
actually TAKEN and must be read together with `lux_complete`. The bare name is real, but it lives in
`analysis_long.csv`, a different export product. Executed result:

    Error in `select()`: ! Can't subset columns that don't exist. Column `lux_all_in_range` doesn't exist.

`tests/analysisTemplates.test.ts` could not catch this by construction. Its `EXPORTED` set is the
UNION of every file's columns, so a column belonging to a different CSV passes; and it harvests
model-formula terms only, never `select()` arguments, so the reference was never examined. Both gaps
are now closed by a check that binds each data frame to the file it was read from and requires every
selected column to exist in THAT file. The check reproduces the defect by name before the fix.

**It could only ever have been run on one participant**

The app exports one folder per sitting. The template read one folder, so `(1 | participant_id)` had
a single level and `lme4` stops with `grouping factors must have > 1 sampled level`. The documented
instruction — "point DATA_DIR at the folder containing the exported CSVs" — therefore described a
run that cannot produce the thesis result, and the alternative was concatenating 130 folders by
hand, which `analysisExport.ts` names as "where analysis errors are actually introduced". A
`read_export()` helper now pools across participant folders, typing columns once over the pooled
frame so a column that is empty for one participant and numeric for another cannot abort the load.

**Three requirements of the plan were unimplemented**

- §2 sum-to-zero coding. R's default treatment contrasts made the printed `polarity` row the effect
  **in achromatic text only** — a duplicate of the achromatic anchor model fitted separately further
  down for exactly that special case. The plan states H1's falsification rule on the average effect
  and says in terms: "This is not a stylistic preference; it changes what the coefficient means."
  The study's headline hypothesis was being adjudicated against the wrong estimand. Colour is
  sum-coded too, and that is the part that does the work: a main effect averages over the other
  factor only when the other factor is sum-coded.
- §4 `fatigue_delta`. The model fitted `fatigue_mean` unconditionally, carrying every participant's
  scale-use bias into the residual. `fatigue_delta` was reachable all along — it is in
  `10_wide_summary.csv`, which the template already loads, but the join pulled only
  `engagement_flag`. The fallback is kept and now announces itself.
- §4 PERCLOS "LMM on logit. Bounded; do not model raw." It was fitted raw — the same error the
  file's own note correctly rejects for the primary outcome, repeated on the secondary one.

**§2's mandatory overdispersion check was absent**

Blinks within a condition are not independent Bernoulli trials, so dispersion above 1 is the
expectation. An unadjusted binomial GLMM understates every standard error on the primary outcome,
which inflates significance on the polarity x colour interaction the study exists to test. Worse, it
was asymmetric: the Python GEE carries robust sandwich errors and was protected, so the two files
could disagree on significance for a purely mechanical reason while the plan requires them to agree
on it. The check now runs and its verdict is printed beside the random structure at the top of the
output. It is reported, never applied silently — refitting as beta-binomial changes the model the
thesis reports.

**Smaller things the run surfaced**

- `check_model()` hard-requires the `see` package, which the template's own `install.packages` line
  did not list (it listed `afex`, which is never loaded). An analyst installing exactly what they
  were told hit a hard stop after the primary model. Diagnostic plots are now guarded: they are
  looked at, never inferred from, and must not end a run that has already produced the inference.
- `fit_noting` discarded the glmer error object, so a failure to fit surfaced only as
  `!is.null(m_primary) is not TRUE` with no diagnosis.

**The gate that was documented as missing now exists**

`scripts/verifyAnalysis.mjs` said plainly that R "is not run here because R is not available in this
environment. That is a gap... the R template is the one that implements the plan, so it is the one
that most needs this." It now runs both templates, and CI installs R from the Ubuntu archive to do
it. The R fixture is multi-participant and deterministically perturbed, because twelve identical
clones make the binomial response constant and glmer refuses that too — a property of the fixture,
not the template. `DATA_DIR` reads `VISULAB_DATA_DIR` when set, so the gate checks the bytes the
analyst is given rather than an edited copy.

`docs/ANALYSIS_PLAN.md` §5b has been corrected. Its previous text described the Python template's
defects and said an analyst "who ran that file instead of the R one" satisfied none of the plan's
requirements — implying R satisfied them. That was written without checking R, and R had the same
two defects plus one that stopped it running.

**Reported, not fixed — these need the investigator**

- The template is pointed at the numbered per-session bundle. `analysis_long.csv` exists to be the
  modelling unit directly and already carries `polarity_c`, `position_c`, `n_incomplete`,
  `n_blinks_total` and `analysable`. Pooling now works, so this is no longer blocking, but reading
  the purpose-built product would be better than reconstructing it.
- `(1 | passage_id)` is prescribed by §2 and is absent. Passage is decoupled from condition by
  design, so this does not bias the point estimates, but the variance loads onto the residual.
- §5's pre-inference QC is largely unimplemented: `face_presence_ratio`, `off_axis_ratio`,
  `observed_duration_ms` against `reading_time_ms`, the careless-responding flags, and the
  complete-case requirement on `session_status` / `analysable`. Directionally this dilutes a real
  effect toward null.
- The primary interaction has no omnibus test; `emmeans(~ colour | polarity)` prints marginal means,
  not a contrast.
- Four of the seven secondary outcomes in §4 are not modelled: reading speed, visual search
  (§4 warns that 40 s-capped rows bias the mean downward if treated as measurements), response
  bias `criterion`, and the d-prime LMM weighted by `d_prime_se`.

---

## Round 7 — a sitting could be collected by two builds, and nothing said so

The update gate is correct and, as far as the code can be traced, airtight for the path it guards.
`UpdateBanner` reads `sittingsInProgress()` from IndexedDB — shared across windows, so a sitting open
anywhere blocks the button everywhere — treats an unanswered or rejected query as "blocked" rather
than "allowed", re-polls on an interval and on focus, and re-asks synchronously inside `apply()`
before the update is applied. It guards the BUTTON.

It cannot guard the path where nobody presses anything. With `skipWaiting: false` a waiting service
worker activates on its own once every client of the old one is gone, and a study tablet reaches
that state without an operator: it sleeps, Android reclaims the page, or it is rebooted. The
operator then taps Resume — which the operator manual explicitly tells them to do after a mid-session
reload — and the remaining conditions are collected by the new build.

`DEPLOYMENT.md` states the safety property as "it takes control only after every window of the app
has been closed, which on a study tablet means between sessions". That last clause is an assumption,
not an invariant, and the operator manual contradicts it in its own troubleshooting table.

**What the export said.** `provenance()` is called exactly once, in `beginSession`, and every later
write spreads the loaded record. Nothing anywhere compared a loaded session's `git_hash` with the
running `GIT_HASH` — the only read of `provenance.git_hash` in the whole app was the export. So one
`app_version`, one `git_hash` and one `condition_def_hash` were written for all ten conditions of a
sitting that two builds had collected. If the build touched the blink pipeline, the within-participant
contrast is split by an instrument change confounded with `session_position`. If it touched the
condition table, `condition_def_hash` positively misstates which stimuli were shown — and that hash
exists to make exactly that impossible.

`joinIntegrity`'s `mixed_build_provenance` could not catch it. That check groups sittings BY
provenance and fires when there is more than one group, so it compares sittings with each other; a
sitting resumed under new code still contributes exactly one provenance.

**Recorded, not blocked.** Refusing to resume would strand a participant already in the chair, and
the requirement is only that the export stop asserting one build when there were two. The resume path
now compares the stored hash with the running one and appends the difference to
`session.additional_builds`. Two new columns carry it: `build_changed_mid_sitting` (boolean, which is
what an analyst filters on) and `session_builds` (the ordered evidence, `'aaaa111+bbbb222'`). A new
`build_changed_mid_sitting` integrity issue names the sittings and the transition. Both directions
are mutation-tested.

**Areas examined this round and found sound** — reported because a clean area is a result:

- Nothing in the app, its config or the generated worker touches IndexedDB or origin storage on
  install or activate. Workbox deletes stale precaches only. The cross-build schema hazard is
  handled explicitly and non-destructively.
- A precache miss cannot produce plausible zeros. `copy-mediapipe.mjs` fails the build if the
  tracking runtime is missing or truncated; `verifyBundle.mjs` runs as `postbuild` and fails if any
  shipped asset is absent from the precache manifest; the camera preview loads FaceMesh and shows an
  explicit "the primary outcome would be empty for every condition" panel before the participant is
  seated. When tracking is off the row written is `disabledEyeMetrics`, in which every count and rate
  is null, not 0.
- Offline collection holds. There is no `fetch` or `XMLHttpRequest` anywhere in `src/`; both dynamic
  imports are precached and covered by `verifyBundle`; fonts are self-hosted and their failure is
  measured and exported. Losing the network mid-sitting changes nothing.

---

## Round 8 — the plan's mandatory checks, the passage intercept, and a test that never tested

**§5's quality checks were not optional and were not there**

`ANALYSIS_PLAN.md` §5 opens "These are not optional and they come first." Only §5.2 was implemented.
§5.1 selected the lux columns and never read them; §5.3 (`face_presence_ratio`, `off_axis_ratio`),
§5.4 (`observed_duration_ms` against `reading_time_ms`) and §5.5 (the careless-responding flags)
appeared nowhere in the file. §5.4 is the one that hides best: when the camera stops part-way, every
RATE in the row still looks entirely normal, because a rate divides by the time actually observed.

The panel reports and drops nothing. §5.2 states the reason in general terms — frame rate covaries
with ambient illumination, so dropping flagged rows deletes data non-randomly with respect to a
factor — and it applies to the rest of §5 as well.

Only one threshold in the panel comes from the protocol: `face_presence_ratio >= 0.90`, the pilot
gate stated in that column's own codebook entry. The other two are analyst defaults and say so at
the point they are read, not only in a comment. A number that looks pre-registered and is not is
worse than no number at all.

§5.5 is reported from `12_quality_flags.csv` rather than joined onto the modelling frame, and that is
a limitation of the file: it carries no `condition_id`, only `participant_id` + `condition_label` +
`session_index`, and joining on the label is what this template's own join note warns against.
**Recorded as a finding:** the per-condition quality file cannot be joined to the modelling frame by
the key the template mandates. Counts answer §5.5's question; a per-row merge would need the export
to carry `condition_id` in that file.

**The passage intercept the documentation claimed**

§2 prescribes `(1 | passage_id)` and §5b asserted that a passage effect "loads onto the residual in
the Python fit and not in the R one". `passage_id` occurred zero times in the R template. Because
passage is decoupled from condition by design this does not bias the display coefficients — what it
does is leave passage variance in the residual, where in a binomial GLMM unmodelled cluster
structure surfaces as overdispersion, understating the standard errors on exactly the condition-level
terms under test. It is now carried through every rung of the reduction ladder, since the plan's
pre-specified reduction order concerns the participant structure and says nothing about passage, and
it is dropped only if keeping it prevents a fit at all — loudly, the way reduction 2 already is.

**The interaction was never tested**

The line headed "The polarity x colour interaction — Objective 2's crossover test" called
`emmeans(~ colour | polarity)`, which returns estimated marginal MEANS. Not a contrast, not a test
statistic, no p-value. The only thing resembling a test of the study's second objective was the four
separate Wald z's in `summary()`, with no omnibus test over them and no multiplicity handling. A
likelihood-ratio test against the additive model now runs first, and the marginal means print on the
response scale — that one call had omitted `type = "response"` while sitting under a heading that
said "back-transformed to the proportion scale".

The heading deliberately does NOT state the degrees of freedom. A full 2 x 5 crossing gives 4, but
`lme4` drops aliased columns from a rank-deficient design and reports the df it actually used — on
the gate's own fixture it reports 3. A heading asserting 4 would be describing a test that was not
run.

**The gate's fixture repeated itself twelve times**

Found while reading the panel's own output: the modelling frame was 1440 rows where 12 participants
x 10 conditions is 120. The twelve cloned participants shared `condition_id` values, so every join on
`condition_id` matched twelve rows instead of one. The models fitted happily on a dataset whose every
observation appeared twelve times — green, and checking nothing real, with any genuine fan-out bug
in the template free to hide inside the noise. Condition ids are now unique per participant and the
gate asserts the frame is exactly 120 rows.

The per-file column check from Round 6 caught this round's first mistake before it shipped: an
attempted join to `12_quality_flags.csv` on `condition_id`, a column that file does not have.

**Noted, not acted on:** the fixture's `observed_duration_ms` is a hardcoded 178,000 ms against a
`reading_time_ms` of ~61,000-72,000 ms, so the fixture claims the camera observed 2.7x the reading
exposure. That is an incoherent row, and it means the §5.4 check cannot be made to fire on the
fixture — the check is exercised for presence, not for its threshold behaviour. Changing the constant
touches a fixture several suites depend on and was left for a round with room to re-verify properly.

---

## Round 9 — four pre-registered outcomes were never modelled

`ANALYSIS_PLAN.md` §4 tabulates seven secondary outcomes. Four of them appeared nowhere in the R
template: reading speed, visual search, sensitivity and response bias. d-prime was averaged
descriptively per participant and never modelled. These are pre-registered outcomes, so their
absence is not a stylistic gap — an analyst running this file produced a thesis with four of its own
stated outcomes unanalysed, and nothing in the output said so.

All four are now fitted, each following what §4 specifies rather than what seemed reasonable:

- **Reading speed.** §4 says "Check against `observed_duration_ms` first — a truncated exposure
  produces a normal-looking speed." That check is §5.4, added in Round 8; the exposure-completeness
  range is now printed beside the model rather than left for the reader to connect.
- **Response bias, separately from sensitivity.** §4 is explicit about why: "A polarity effect on
  `criterion` WITHOUT one on `d_prime` is a bias shift, not a sensitivity change. Worth reporting as
  a distinct finding rather than folding into 'RT performance'." Folding them in is what the file did.
- **Sensitivity, inverse-variance weighted.** §4: "With 20 go and 12 no-go trials, one block's d' is
  imprecise. Check `d_prime_se` and consider weighting." Weighted by `1 / d_prime_se^2`, so an
  imprecise block carries the weight it has earned. When the standard error is missing or zero the
  fit falls back to unweighted and says so, rather than appearing to have done what §4 asked.
- **Visual search, with its censoring declared.** §4 permits either a censored model or reporting the
  completion rate alongside. The second option is taken and named as such: a genuinely censored LMM
  needs a package this template does not carry, and adding a dependency silently is worse than
  saying which option was used. The fit prints the share of blocks ending at the time limit and
  states that its own mean is biased downward by that share. On the gate's fixture that share is 60%,
  which is exactly why the warning has to be there.

**The plan named a column the export does not write.** §4 instructed the analyst to read
`search_termination`; the export writes `termination_mode`. This is the same defect class as the
`lux_all_in_range` fault that stopped the whole R template running, sitting in the plan document
instead of the code. Corrected in place, with the discrepancy recorded rather than quietly edited.

**The gate's fixture was degenerate for these outcomes.** `d_prime`, `d_prime_se` and `criterion`
were identical across all twelve cloned participants, so the weighted model failed with "not a
positive definite matrix" and the section reported "did not fit" on every run — a section the gate
cannot actually check. The signal-detection measures now vary deterministically, as the blink counts
and PERCLOS already did, and no section reports a failed fit.

**Still open, unchanged:** whether the template should read the purpose-built `analysis_long.csv`
rather than reconstructing the modelling unit from the numbered bundle; the split-sitting operator
toggle; and the gaze one-sample acceptance threshold. (The incoherent fixture
`observed_duration_ms` listed here was closed in Round 10.)

---

## Round 10 — a check that could not fail

§5.4 was added in Round 8 and the gate asserted that it printed. It could not have printed anything
else. The fixture's `observed_duration_ms` was a hardcoded 178,000 ms sitting beside a
`reading_time_ms` of ~61,000-72,000 ms, so the fixture claimed the camera had observed 2.7x the
exposure it was observing. The observed fraction was therefore always well above 1 and the check's
count was structurally zero — which reads on the console exactly like a check that passed.

This is the same class as the stress suite asserting the manifest's byte count in UTF-16 code units
(Round 7) and the R fixture whose twelve clones shared condition ids (Round 8): green, and measuring
nothing. It is worth naming as a pattern, because it is the failure mode that survives longest — a
broken check announces itself, a vacuous one does not.

`observed_duration_ms` is now derived from the same index `reading_time_ms` is, so a clean fixture
row says the camera saw the whole exposure. That makes a deliberately truncated copy a real test:
the gate now copies the fixture, halves `observed_duration_ms` for one participant, re-runs the
template, and requires §5.4 to report exactly 10 flagged rows — one participant x ten conditions —
and the combined `qc_clean` flag to pick up the same 10. Nothing in the export depended on the old
constant; all 810 tests and 653 export checks pass unchanged.

---

## Round 11 — the gaze coverage bar is now a decision, not an expression

The criterion deciding whether a calibration target counted as covered was `a.length > 0`, written
inline in a filter. That is a methods decision spelled as an expression, in a place nobody reviewing
the protocol would ever find it.

It is now `MIN_SAMPLES_PER_TARGET`, exported and documented where it can be read and argued with.
The value is unchanged at 1, deliberately: the bar decides how many sittings are declared
`gaze_calibration_valid`, and therefore the analysable n for every gaze measure. That is the
investigator's call and not something to settle inside a refactor.

What the current value means is written down beside it. At 1, a target whose 800 ms dwell yielded a
single solved frame counts the same as one that yielded all of them; at ~30 fps that dwell should
produce roughly 24 samples, so such a target had an almost entirely unsolved dwell and contributes
one noisy point where a distribution belongs. Six targets in that state still satisfy the two-thirds
coverage rule. The original audit finding asked for 5.

Three tests bind the verdict to the constant rather than to a hardcoded `> 0`, including a tripwire
asserting the value currently in force — so raising the bar cannot happen silently; it requires
editing that line too. Raising it to 5 fails two tests, which is the evidence that the constant is
load-bearing rather than decorative.

The exposure is bounded: gaze is a secondary measure, and the primary outcome's EAR baseline is
fitted in `measureEarBaseline` and does not depend on this.

---

## Round 12 — the split-sitting decision is now recorded, and the merge is locked

This closes the one finding that had been LIVE since Round 4 and was an investigator decision rather
than a defect. The investigator's ruling: keep the flexibility, record the reason, and make certain
the halves merge.

**The reason is now required.** Picking "split" opens a free-text field and "Begin setup" stays
disabled until it holds at least `SPLIT_REASON_MIN_CHARS`, on exactly the terms an out-of-range
illuminance already imposes. The prompt asks specifically whether the reason is logistical or about
the participant, because that is the distinction that matters and it is not recoverable afterwards. It
exports as `sitting_split_reason`, and the codebook entry says why an analyst has to read it before
pooling: if splits were granted because a participant looked tired, fatigue exposure varies between
people for a reason correlated with the outcome, which makes it a covariate rather than a free choice.

**The merge already worked, and is now protected.** `analysis_long.csv` pools every sitting on the
device into one row per participant x condition-run, so a split participant was already arriving as
ONE participant with all ten conditions — existing tests showed `condition_runs` at the full ten and
`global_position` spanning 0..19 continuously across four sittings. That was an emergent property of
several separate pieces of logic rather than anything asserted. Three tests now assert it directly:
one participant row and not one per sitting; both sittings still distinguishable inside the merged
set, because the second half happens on a different day and an analyst who cannot see the boundary
cannot test whether it mattered; and every condition covered exactly once, which is the guard against
a split that silently repeats the first five instead of continuing into the second five. Making both
halves run offset 0 fails two of the three.

**What stays separate, by design:** the numbered per-sitting folders. Each is the faithful record of
one sitting and a split participant has two. The merge belongs in the analysis dataset, not in the
per-sitting record, and the setup screen now says so at the point of the decision — "Both halves
export as ONE participant."

The split end-to-end suite still passes; its helper now fills the reason, because the gating would
otherwise have left it timing out on a disabled button — the same failure the lux literal once caused.

## Round 13 — gaze calibration could pass and be worth nothing

The investigator's question was the right one: how does a researcher know the nine-dot routine is not
a gimmick? The failure path was already handled — an invalid fit or a missing EAR baseline shows
"Calibration did not succeed" with a retry and an explicit continue-anyway. The gap was on the
**passing** side.

`valid` is one boolean over a deliberately lenient bar: a target counts as covered at
`MIN_SAMPLES_PER_TARGET` (currently 1) and two thirds of the targets must be covered. So a run where
six of nine targets each produced a **single solved frame** satisfies it. In that case the operator
was shown exactly what a clean nine-of-nine run showed them — nothing — and the sitting exported
`gaze_calibration_valid` TRUE. Two completely different runs collapsed to the same output, which is
the difference between a calibration and a gesture, and it was invisible at the only moment it could
be acted on: while the participant is still in the chair and the routine takes fifteen seconds.

**The evidence is now kept.** `fitGazeCalibration` returns `samplesPerTarget` — a count for every one
of the nine, including those that produced nothing, because a missing key and a zero are the same
fact and only one of them survives being read by someone else. This also makes the acceptance bar
revisitable: it is applied live, so without these counts a stricter threshold could never be applied
to data already collected.

**The verdict is graded, and the bar is derived rather than chosen.** `gazeQuality()` returns
`good` / `thin` / `unusable`. A target is *well covered* when it solved at least half its dwell,
where the expectation is the dwell duration times the frame rate — so it means "at least half the
dwell produced a usable landmark solve" rather than a magic sample count that silently means
something different on a slower tablet. `good` requires two thirds of targets well covered, mirroring
the shape of the validity rule but held to evidence rather than presence.

Stated honestly: there is **no measured frame rate at calibration time** — `effective_fps` is
computed per condition, from a reading exposure that has not happened yet — so the reference is the
protocol's nominal 30 fps. A genuinely slower tablet will look thinner than it is. That is the safe
direction to be wrong in, and it is why the raw counts are reported next to the grade instead of the
grade alone.

**The operator is now told.** A thin verdict raises "Gaze calibration is not trustworthy", naming the
numbers — how many targets registered, how many were tracked past half their dwell, the median
readings against what a full dwell would give — the likely causes, and that re-running costs about
fifteen seconds. It offers re-run or accept. It is a WARNING, not a gate: the mapping did fit and its
thresholds may be serviceable, so the decision stays with the operator; what changed is that they get
to make it. It also says plainly that the primary outcome is unaffected, because an operator who
believes a thin gaze fit has ruined the sitting might abandon a participant who was fine.

**The analyst can filter.** `gaze_trust` and `gaze_targets_well_covered` are exported, and the
codebook says which column to use: `gaze_calibration_valid` is TRUE for both `good` and `thin`, so
`gaze_trust` is the one to filter gaze measures on.

**An import cycle was removed on the way.** `gazeQuality` needs the dwell, and importing it from
`calibrationSequence` closed a loop — that module already imports `GAZE_TARGETS` from
`gazeCalibration`. Both uses sat inside function bodies so it happened to work, which is exactly the
kind of thing that stops working after a bundler reorders modules. The dwell moved to
`gazeCalibration`, where it belongs, and is re-exported from its old home.

**A gap worth naming.** Deleting the branch that shows the warning failed no test: the grading is pure
and well covered, the screen acting on it was covered by nothing. There is no DOM-rendering harness
here and adding one for a single branch did not justify a new dependency, so the wiring is guarded by
static assertions over the source — the technique `pwaPolicy.test.ts` already uses against
`vite.config.ts`. That proves the branch and its controls exist and are reachable before `onDone()`.
It does **not** prove the screen renders correctly. A render test would be stronger.

## Round 14 — the visual-search cap, and censoring that follows the hypothesis

Investigator ruling: the 40 s cap was too tight, with 60 s proposed. The exploration and the outcome.

**What was already there.** "Done searching" is on screen throughout, and the task ends by itself the
moment the last target is found, recording `voluntary_full`. So early completion already worked and
the three termination modes already distinguished finishing, giving up and running out of time. Only
the cap value was open.

**What 60 s costs.** Measured on the shipped timing model at the 177 s reading exposure: median
sitting 98 min at either value, p95 moving 120 → 121 min. At 90 s it is the same 121 min, because the
modelled search time rarely reaches 60 s at all. About a minute in the tail.

**What it buys.** A capped block is a lower bound, not a measurement, and the cap only ever binds on a
participant who has neither finished nor given up — exactly the people whose real search time is
worth having. It also eases the confound recorded at line 209 of this document: search accuracy is
`found / target-count` inside a FIXED window, and the corpus runs 8 to 14 targets per passage, so a
fixed window makes the high-count passages permanently harder. A longer window lets more participants
finish regardless of count.

Raised to 60 s. `PROTOCOL.md` and the §4 table were updated with it, and the on-screen instruction
derives the number from the constant, so it followed on its own.

**CORRECTION to this round, recorded in place.** This entry originally also said the plan "named a
column the export does not write" — `search_termination` — and I edited §4 to say `termination_mode`.
That was wrong. `search_termination` is a real column of `analysis_long.csv`, populated from
`termination_mode` at `analysisExport.ts:334` and documented in `analysisCodebook.ts`. I had checked
only the numbered bundle's `CODEBOOK` and concluded from its absence there that the column did not
exist, when in fact the plan is written against the pooled file — the same root cause the R audit
identified for `lux_all_in_range`. §4 now names both columns and the file each belongs to. The lesson
is narrow and worth keeping: this project has TWO export products with TWO codebooks, and "the export
does not write it" is a claim about one of them until both have been checked. **It must not change once collection
starts** — times under two different caps are not comparable, and the censoring rate is part of what
the number means.

**The part that matters more than the cap.** A uniform censoring rate biases every condition's mean
downward by about the same amount, and a between-condition comparison partly survives it. A rate that
VARIES by condition does not: if low-contrast or dark-polarity blocks hit the cap more often, the
difference in mean search time is partly a difference in how often the clock ran out — and that bias
points the same way as the hypothesis, which is the worst available direction. The template reported
one overall completion rate, which cannot show this.

It now breaks the censoring rate down by polarity and colour, prints the spread in percentage points,
and if that spread exceeds 10 points says explicitly that the time model must not be read before
either using the completion outcome or fitting a properly censored model.

**Completion as an outcome in its own right** — the investigator's own suggestion, and it is sound.
"Did they find every target inside the window" is immune to censoring by construction, because it uses
the fact that the clock ran out instead of pretending a time was measured, and it is a binomial
proportion like the primary outcome. It is reported beside the time model rather than instead of it,
for two reasons stated in the code: it is less powerful, since finishing at 10 s and at 59 s both
count as success; and it is only informative if it varies, so the template says so and defers to the
time model when completion is above 95% or below 5%.

**A bug I wrote and the run caught.** `summarise(n_capped = sum(capped), pct_capped = mean(capped))`
was first written with the count named `capped`. dplyr evaluates those arguments in order and in one
scope, so the count replaced the logical column before `mean()` read it, and every rate printed as
1200%. Found by reading the actual output rather than by trusting the code.

## Round 15 — an all-participants view, because the dashboard could only see one sitting

Investigator request: see one participant's data and the pooled analysis of everyone at the same
time, as it accrues, so that a condition or an analysis failing does not go unnoticed.

The dashboard was strictly per-sitting — pick a session, gather that bundle, show its tabs. That
answers "did this sitting work" and cannot answer "is the study working", and the two fail in
different ways. A single sitting looks fine while a condition is quietly broken in all of them: a
colour that never yields usable blink data, a position always thin, an exclusion rule firing far more
often than expected. Those are visible only across participants, and if they are first noticed at
analysis the participants have gone home.

**An "All Participants" tab now sits beside the per-sitting ones.** It reads the POOLED file —
`analysis_long.csv`, via `buildAnalysisDataset` — rather than recomputing from bundles. That is
deliberate: the numbers shown are the ones the models will actually see, not a parallel calculation
that can drift from them.

What it surfaces, chosen for what would otherwise hide:

- **Per-condition n, side by side.** Under counterbalancing every condition should accrue at the same
  rate, so a gap is the earliest visible sign that one is failing rather than lagging. A spread of
  more than one participant raises an explicit warning.
- **Rows with a usable outcome, against rows present.** A condition where blinks were never counted is
  broken, not noisy, and a mean computed over the survivors looks perfectly reasonable.
- **The blink total behind each mean.** The ratio's precision rests on how many blinks were counted,
  not on how many rows exist — ten rows of four blinks is not ten measurements.
- **Exclusion reasons, tallied.** A rule firing far more than expected is a study problem, not a
  participant problem.
- **The join and provenance issues** already computed by `checkJoin`, including the mixed-build and
  mid-sitting-build checks from Round 7.

It recomputes when the session list changes — which is what happens when a sitting finishes — so it
tracks the study as it is collected instead of being a snapshot someone must remember to refresh.

**Verified as rendering, not merely compiling.** The aggregation has eight unit tests pinning its
arithmetic, including an empty device and the rule that a blank frame-rate flag is "camera never ran"
rather than "inadequate" — counting blank as inadequate would invent a camera fault in every sitting
that declined the camera. On top of that the full-run end-to-end spec now opens the tab and asserts
the pooled table draws with the right count. A panel that throws on mount would leave the researcher
with a blank tab and no error, which is worse than no tab at all.

## Round 16 — the per-condition quality file had no join key

`12_quality_flags.csv` carried `participant_id` + `session_index` + `condition_label` and no
`condition_id`. Every other per-condition table has one, and the analysis templates' own stated rule
is to join on `condition_id` and NEVER on participant + label, because a label repeats across
sittings.

So the per-condition quality signals — straight-lining, rushed fatigue and perception responses, low
face presence, skimmed reading — could not be attached to the modelling frame the safe way at all.
The R template read `engagement_flag` from the wide summary instead and reported the
careless-responding flags as study-wide counts. That answers "how often did this happen in the study"
and cannot answer "was THIS condition for THIS participant rushed", which is the question
`ANALYSIS_PLAN.md` §5.5 asks. The columns existed in the export and were unusable.

`condition_id` now leads that file. Nothing else had to change: the export verifier's join-key section
picked it up automatically and the check count rose from 656 to 659, because a declared key column is
required to carry a value in every row.

The R template now joins those flags per condition and, more usefully, crosses them with the design:
careless responding that clusters in one polarity is a property of that condition rather than of those
participants, and a study-wide percentage cannot show that. The gate asserts both the per-condition
join and the crossing, so neither can silently revert to a count.

## Round 17 — QC columns that gate an analysis were not in the file the analysis reads

Found by checking my own work from the two previous rounds rather than by an audit of someone else's.

`analysis_long.csv` is documented as the modelling unit — "one row per participant x condition-run,
with the design factors, the outcomes, the covariates and the quality flags already on it". Three
columns added in Rounds 12 and 13 never reached it:

- `gaze_trust` and `gaze_targets_well_covered`. The per-session codebook I wrote in Round 13 tells the
  analyst, in capitals, to filter gaze measures on `gaze_trust` rather than on `gaze_calibrated` —
  because the latter is TRUE for both a good fit and a thin one. But `gaze_trust` existed only in the
  per-sitting file. **The advice pointed at a column the pooled analysis could not see.**
- `sitting_split_reason`. The whole point of Round 12 was to make the split judgement visible as a
  covariate. A covariate that exists only in a per-sitting file cannot enter a pooled model.

All three are now on the pooled rows, repeated across the sitting because the calibration and the
structure choice are session-level facts and a row cannot be filtered on a value it cannot reach. The
calibration is selected by `calibrated_at` rather than by array order, since records sort by a random
uuid and a resumed sitting re-runs calibration.

The `ANALYSIS_CODEBOOK` completeness test caught all three immediately — it requires every
`analysis_long` column to be documented, and named exactly the three I had added.

## Round 18 — the dashboard's own numbers

The operator uses this screen to decide whether a sitting worked and whether to re-run a participant,
so a plausible-looking wrong number here gets acted on. The aggregation was well covered; the
DISPLAY was not covered at all, and four defects lived in that gap.

**"Comprehension accuracy 0%" for a sitting where comprehension was never administered.** The tile
read `fmt(100 * (avg(...) ?? 0), '%')` — the `?? 0` inside the multiplication, so the null was
consumed before the formatter could render it as an em dash. `0%` reads as "answered every question
wrong", which is a strong reason to exclude or re-run a participant. The aggregator goes out of its
way to keep this value null, with a comment saying "never 0, which would read as 'attempted and got
none right'", and the display threw that guarantee away. Its two neighbouring tiles were always
correct, which is what made it easy to miss.

**"Conditions completed 9/10" for a sitting where all ten ran.** The count filtered on
`mean_rt_hits_ms != null`, which is null when there were no valid non-anticipatory hits — exactly
what a participant who stops responding to the go target produces. That condition ran, and produced
a damning result, and the tile called it not completed; the operator re-runs a condition that did
happen. Now counted on `hit_rate`, whose own type comment draws the distinction: a hit rate of zero
is a measurement, null means the block had no signal trials.

**One participant's numbers under another's name.** The gather effect had no cancellation guard and
did not clear the bundle. The header re-renders with the new participant immediately, so every tab
kept showing the previous participant's data under the new name until IndexedDB answered — and
switching A to B to C quickly left whichever gather resolved LAST in control, so B's numbers could
sit under C's name indefinitely. The cohort effect added in Round 15 already used the guard this one
lacked.

**A camera fast enough for the tiers, flagged good for the ratio.** `qc.fps` was `flag(fps, 25, 15)`,
and 25 is `FPS_TIER_THRESHOLD`; the primary outcome needs `FPS_RATIO_THRESHOLD` = 30, and
`tests/ocularIntegrity.test.ts` exists to assert that gap. So 26-29.9 fps was flagged `good`,
coloured green, and rolled into a `good` overall — while this same file's reason string said the
ratio for that condition is biased upward. The caveat existed as prose in a different table from the
tick the operator reads. Now good only at or above the ratio threshold, warn in the band between the
two floors.

**A test was asserting the defect.** `tests/export.test.ts` carried
`expect(s[0].qc.overall).toBe('good') // fps 28`. Corrected, with a tripwire on the boundary itself
so moving the line back to the tier floor fails.

**Also gated three ocular fields that had escaped it.** `blink_rate`, `blink_rate_full` and
`incomplete_blink_ratio` — the primary outcome among them — were not gated on `camera_active`, while
their eight neighbours were. `aggregator.ts` says why in terms: "camera_active = false is not a
sufficient guard on its own: it puts the burden on every downstream consumer to remember to filter,
and the app's own dashboard did not." The live writer nulls everything when the camera is off, so
this is not reachable from a fresh run today, but the shape exists in the repo's own fixtures and
fuzz generator and a restored backup would display a zero primary outcome for a camera that never
ran. The gate costs nothing.

**Reported and not acted on, for a later round:** the per-sitting view still shows the
incomplete-blink ratio without `blink_count_total` beside it, so a ratio from 4 blinks carries the
same visual authority as one from 60 — the cohort tab surfaces that denominator and the per-sitting
view, which is the one used while the participant is still in the chair, does not. A sitting that
continued without an EAR baseline also still reports QC `good` on every row with a blink rate of
0/min, because the camera genuinely is running well and only the baseline is missing; `ConditionSummary`
carries no baseline or `observed_duration_ms` field for the dashboard to show.

## Round 19 — the golden fixture contradicted itself on the primary outcome

The worst instance of the green-while-measuring-nothing pattern this audit has found, because it sat
on the primary outcome.

`bundleFixture.ts` hardcoded `blink_count_full: 30, blink_count_micro: 2, blink_count_incomplete: 8`
for **all ten conditions** — constant — while `incomplete_blink_ratio` varied 0.050 to 0.329. Two
consequences:

**The exported row contradicted itself.** `n_incomplete = 8` beside `n_blinks_total = 40` is 0.2,
printed next to a ratio column reading 0.05. The codebook instructs an analyst to re-derive the
proportion from the counts, and doing so disagreed with the column in every one of the ten rows.
Verified directly: ratio-from-counts was 0.2000 in all ten while the column ran 0.05 to 0.329.

**The primary model estimated nothing.** Both templates build the response from the COUNTS, never
from the ratio column, so the response was constant. Every coefficient came back zero to machine
precision with NaN standard errors — and the gate's assertion was that the section's *title* appeared
in the output. Green, on a pre-registered primary model that had fitted nothing.

**Fixed by derivation rather than by new constants.** `blinkTotalFor`, `blinkMicroFor`,
`blinkIncompleteFor` and `blinkFullFor` now vary per condition, and `ibrFor` is computed FROM them, so
the ratio cannot disagree with its own numerator and denominator. The denominator varies deliberately
(35 to 62): the reason the outcome is modelled binomially at all is that a proportion from 35 blinks
is not the same measurement as one from 62, and a constant denominator cannot exercise that. Both
existing assertions on `ibrFor` kept passing without edit, because they compare against the helper —
and they now mean something.

**The reading exposure was the root incoherence.** `readingMs` gave 61-72 s for ~580-word passages,
which is 480-560 words per minute; the app's own skim detector flags anything above 400. So the
fixture whose comment calls it "a normal first pass through the protocol" was a participant the app
classified as **skimming all ten passages**, with engagement `warn` and a quality score of 0.6 on
every row — and no test asserted the flags either way, so nothing said so. Raised to ~175-186 s,
which matches the shipped exposure the timing model is built around. Blink rates now land at 12-20
per minute instead of three times that, and reading speed at 186-202 wpm. `ear_sample_count` was also
still 5340, coherent with the *old* hardcoded 178,000 ms and left behind when that was removed —
implying 87 fps against an `effective_fps` of 29.4 in the same record. It is derived now.

**The Python template had the same single-folder defect as R.** `load()` read one folder, so the GEE
was estimated on one participant: ten design cells against ten rows is a saturated fit, every
standard error NaN or at machine epsilon, no coefficient testable. It now pools across participant
folders exactly as the R loader does — which matters beyond the gate, because §5b requires the two
toolchains to agree in sign and significance and they cannot be compared at all if one is fitted on a
single participant.

The gate now asserts the primary model **estimates**: a `polarity_c` coefficient that is present,
finite, non-zero beyond machine precision, and carrying a usable standard error. With the old
constant response all four of those fail.

**An honest note on the mutation test.** Reverting the fixture to constant counts did NOT fail the
gate, because the gate's own dumper perturbs counts per participant to guarantee a non-degenerate
response. That is correct for what the gate is for — it tests the template, not the fixture — but it
means **fixture coherence has no guard of its own**. That is the next piece of work, and the
remaining incoherences found in the same audit and not yet fixed are listed below.

**Still incoherent in the fixture, not yet acted on:**

- ~~`fatigue_mean` contradicts the mean of its own five items~~ — FIXED in Round 20.
- ~~CVS-Q `total_score` contradicts its own per-item columns~~ — FIXED in Round 20.
- `d_prime` is 6.13 where the production scorer on the fixture's own counts gives 3.343, `criterion`
  -1.68 against -0.288, and `d_prime_se` 0.4 with `d_prime_unstable: false` where the production rule
  makes it true. A d-prime of 6.13 is not a physiologically possible sensitivity. The fixture's own
  comment claims it matches the production scorer's log-linear correction; the production scorer
  deliberately uses the 1/(2N) rule and says so.
- `rtSummaryFor` documents "one miss and one false alarm per condition" and produces neither: the
  miss is gated on a trial index that is not a signal trial, so hit rate is 1.0 — a ceiling — in every
  condition.
- `mean_rt_hits_ms` is a hardcoded constant that at condition 9 sits 4.7 SD above the median exported
  beside it, and `lapse_count` claims lapses in five conditions whose slowest trial is 365 ms against
  a 600 ms threshold.
- `media.checksum_fnv1a` is `'00000000'` where the real FNV-1a of the blob is `3286d3b6`, so the
  media-integrity claim the codebook makes for that column is unverified end to end.
- In the fuzz harness: the head-pose property is gated on all 478 landmarks being finite when each has
  a 10% chance of NaN, so it executes with probability ~1e-44 and the block degenerates to "does not
  throw"; and the gaze property asserts only that a threshold is finite and positive, which is true by
  construction for every possible input.

## Round 20 — a coherence gate over the fixture, and the two outcomes it was wrong about

Round 19 ended on an honest admission: reverting the fixture to constant blink counts did not fail the
analysis gate, because that gate perturbs counts per participant itself. It tests the template, which
is what it is for — and it left **fixture coherence with no guard at all**. This is that guard, plus
the two remaining incoherences that bore on named outcomes.

**Subjective fatigue.** `fatigue_mean` ran 1.00 to 4.33 while the five item columns beside it were
constant at 2,2,2,1,1 — an item mean of 1.6 — in all ten rows, so `03_fatigue_scores.csv` contradicted
itself on the response `ANALYSIS_PLAN.md` §4 specifies. Worse, condition 1 reported `fatigue_delta` of
-0.20 — fatigue *falling* — while every item sat at or above its baseline value.

`src/sim/participant.ts` already did this the right way round: draw the items, take their mean. The
fixture now does the same. The profile rises fastest on eye strain and slowest on headache, which is
the ordering an optometrist would expect over time on task, and the baseline is all-ones so the delta
starts at 0.00 and climbs monotonically to 4.00 instead of opening negative.

**CVS-Q.** `total_score` was 3 against all-zero items, where the real scorer gives 0; and 11 against
all-one items, where it gives 16. The per-item `freq_*` and `intensity_*` columns are exported beside
the total, so `13_cvsq.csv` contradicted itself — on the KEY SECONDARY outcome, whose change score the
fixture put at 8 where its own items say 16. Both rows are now scored by `scoreCvsq`, and
`symptomatic` comes from the scorer too rather than being asserted separately: it is a comparison
against `CVSQ_CUTOFF` and there is no reason for a fixture to hold an opinion about it. This also
means the scorer-to-export path for the key secondary is now exercised end to end, which it never was.

**The gate.** `tests/fixtureCoherence.test.ts` re-derives each field from its own components rather
than checking that a value round-trips — which is the distinction that matters, because every one of
these values round-tripped perfectly. Thirteen assertions covering: the ratio against its counts, the
denominator varying at all, the blink rate against counts over observed exposure, the rate being
physiologically possible, `ear_sample_count` against `effective_fps`, `fatigue_mean` against its items,
the delta never falling while items rise, CVS-Q against the scorer, and reading speed against the
app's own skim ceiling.

Each of the four original defects was reintroduced in turn and the gate failed on every one: constant
counts 3 failures, constant fatigue items 1, a hand-picked CVS-Q total 2, the old reading exposure 2.

**Still open from the same audit:** nothing. The signal-detection block was fixed in Round 21, and
the media checksums and both dead fuzz properties in Round 22.

## Round 21 — the signal-detection block had its own scorer, and it was wrong

`rtSummaryFor` carried a second implementation of signal-detection theory: its own inverse-normal
approximation, clamping extreme rates at 1e-6, under a comment claiming it matched "the production
scorer's log-linear correction". It matched neither. `signalDetection.ts` deliberately uses the
1/(2N) rule and its own comment says in terms that this is NOT the log-linear correction, and the
1e-6 clamp put z(1 - 1e-6) at about 4.75. The results:

| field | fixture | production scorer, on the fixture's own counts |
|---|---|---|
| `d_prime` | 6.13 | ~3.03 |
| `criterion` | -1.68 | ~-0.13 |
| `d_prime_se` | 0.4, hardcoded | ~0.70 |
| `d_prime_unstable` | false, hardcoded | true |

A d-prime of 6.13 is not a physiologically possible sensitivity. And the last two were not merely
wrong but internally impossible: production ties the flag to the standard error
(`unstable === se > 0.3`) and `tests/scoring.test.ts` asserts that of production, so the fixture
asserted a combination the real code cannot emit. All of these now come from `computeSdt`, which
removes the possibility of disagreement rather than correcting one side of it.

**The documented miss never happened.** The generator's comment promised "one miss and one false alarm
per condition, so the summary has something other than a perfect score to summarise", and gated the
miss on `t === 3` — a trial index that is not a signal trial, since `(3*5)%8` is 7 and fails the test
two lines above. So the hit rate was a ceiling 1.0 in all ten conditions. Misses and false alarms are
now placed by ordinal position within their own pool, and the counts VARY by condition (misses rising
with time on task, false alarms alternating) so that d-prime and criterion move independently. Without
that, fixing the miss alone would have left d-prime constant at 3.03 in every condition — the same
constant-response trap the blink counts had, on the outcome §4 calls Sensitivity.

**`mean_rt_hits_ms` was a constant, not a mean.** `340 + i * 7` put condition 9 at 403 ms where the
real mean of its own trials is 344.9 — 4.7 SD above the median exported in the next column — and
`rt_cv` disagreed with `rt_sd_ms / mean_rt_hits_ms` for the same reason. Two assertions compared the
export against that constant, so the mean-RT path was certified against a number that was not the
mean of anything in the bundle; a refactor that correctly recomputed it would have been reported as a
regression. `rtFor` now derives from the trials, and both assertions kept their form and became
meaningful.

**`lapse_count` claimed lapses that no trial could produce.** `i % 2` asserted an attention lapse in
five of ten conditions while the slowest trial anywhere in the block is 365 ms, against a 600 ms
threshold — and it rides into `analysis_long.csv` as `rt_lapses`, the frame the analysis gates run on.
Counted against `CONFIG.RT_LAPSE_THRESHOLD_MS` now, which gives zero, correctly.

Seven more assertions on the coherence gate cover all of it: every SDT field against `computeSdt`, the
standard error against its own instability flag, the counts against the trial rows, the miss and false
alarm actually occurring, sensitivity varying across conditions, the mean RT being the mean of the hit
RTs and lying within three SD of the median, and the lapse count against the threshold. Each of the
four defects was reintroduced and the gate failed on every one.

## Round 22 — two fuzz properties that could not fail, and a checksum that certified nothing

**The head-pose property executed with probability about 1e-44.** It drew all 478 landmarks from a
generator that returns NaN one time in ten, then guarded its only substantive assertion on ALL of
them being finite: 0.9^956. So the block degenerated to "estimateHeadPose does not throw", and the
regression it existed to catch went untested.

Making it reachable was instructive, because the first attempt FAILED — 307 times. Coordinates drawn
independently are all finite and still routinely collapse the ear span, and `estimateHeadPose` returns
non-finite for a finite-but-degenerate face **on purpose**: its comment explains that reporting 0
degrees there would be a measurement of "looking straight ahead" rather than an absence, biasing the
postural summary toward perfect posture exactly when tracking is worst. So the invariant as written
was wrong — it is not "finite landmarks yield a finite pose" but "a face with real extent yields a
finite pose". Half the iterations now place the five landmarks the estimator reads at a geometry with
genuine extent and require a finite pose; the other half stay contaminated and keep the
does-not-throw coverage. A second assertion forbids Infinity in any regime, since a non-finite number
dressed as a measurement is the failure that matters.

Worth noting how close this came to being read the wrong way round: the debug output showed
`{"pitch":null}` and looked like a null-versus-NaN convention problem, when it was `JSON.stringify`
converting NaN to null. Chasing the wrong one would have "fixed" correct code.

**The gaze property was true by construction.** It asserted only that `hThreshold` is finite and
positive. `fitGazeCalibration` returns `Math.max(0.06, ...)` on the valid path and a positive constant
on the invalid one, with non-finite inputs mapped to zero before either — so no possible input could
falsify it. Meanwhile the failure mode that file documents at length went unchecked: `valid` exported
TRUE while an axis sat at its unfitted default, which makes every gaze zone in that sitting a guess
presented as a measurement. Five assertions replace it: a valid fit must have fitted BOTH axes and not
left one at the default; `targetsWithSamples` must agree with `samplesPerTarget`; every one of the
nine targets must be accounted for including those that produced nothing; a rejected fit must grade
`unusable` and never merely `thin`; and `wellCovered` cannot exceed `covered`. Breaking
`samplesPerTarget` so it omits zero-sample targets produces 2,888 failures where the old assertion
produced none.

**The media checksums certified nothing.** They were `'00000000'` and `'00000001'` — placeholders —
where the real FNV-1a of the blobs is `3286d3b6` and `4b52b20c`. The codebook describes that column as
"FNV-1a over the file bytes. Confirms a given file is the one this session recorded and has not been
altered or swapped", and nothing compared it to the blob, so the media-integrity claim was unverified
end to end on the one bundle every other check runs against. Both are computed with the app's own
`fnv1a` now, and `bytes` comes from the blob rather than a hardcoded number.

## Round 23 — the codebook declared ranges that nothing enforced

Found while auditing hardcoded bounds, and it is the mirror image of the declared-TYPE gate from
Round 5. The codebook states a `unit` for every column: 21 say `0-1`, 12 say `0-100`, 9 say `0-10`,
37 say `count`. Nothing compared the data against those declarations.

Demonstrated on the real export path. Injecting the values a corrupt store, a restored older-schema
backup or a bad import could carry produced a file that cheerfully contained:

| column | declared | emitted |
|---|---|---|
| `incomplete_blink_ratio` — the PRIMARY OUTCOME | `0-1` | `1.8` |
| `face_presence_ratio` | `0-1` | `-0.4` |
| `perclos_p80` | `0-1` | `42` |
| `blink_count_full` | `count` | `-3` |
| `hit_rate` | `0-1` | `2.5` |

with `non_finite_cells: 0` and no integrity issue raised. A model fitted on a proportion of 1.8 does
not fail; it produces a number.

**Passing the value through is the right behaviour.** Clamping 1.8 to 1.0 would fabricate a
measurement, and this export refuses to fabricate anywhere. What was missing is the other half of the
same bargain, which `escapeCsv` already states for the neighbouring class: it blanks a non-finite
value rather than writing "NaN", and its comment says that silence "is only tolerable because a count
of how often it happened travels in the manifest". The range case had no such count.

`countOutOfDeclaredRange` supplies it. Both manifests now carry
`out_of_declared_range_cells` and `out_of_declared_range_columns`, the latter naming the column, the
declared unit and the value seen. It is computed over the files AS WRITTEN rather than from the
records, so it sees what the analyst sees — including anything a rounding step introduced on the way
out, and including propagation: injecting one bad `face_presence_ratio` is reported in both
`07_eye_metrics.csv` and `10_wide_summary.csv`.

**The pooled file is covered too, on its own terms.** `analysis_long.csv` is the modelling unit and is
documented by a different codebook keyed by column alone, so the checker takes the unit lookup as a
parameter. A gate that covered only the numbered bundle would have left the file the models actually
read unguarded — which is precisely the gap that let three QC columns go missing from it in Round 17.

Distinctions the gate gets right, each with a test: a `count` of 0 passes because zero blinks is a
real and damning measurement while -3 is corruption; an empty cell is skipped because absence is the
completeness checks' business; and `'1-n'` — the unit for trial indices — is correctly NOT read as a
range, because its upper bound is however many there were. A tripwire requires every unit in the
codebook that states two numeric bounds to parse, so a new spelling like `'0..1'` cannot make the
whole check pass by examining nothing.

**Checked and found sound while looking:** the test-suite tolerances. Every `toBeCloseTo` with a
0- or 1-digit precision is tight relative to the rounding of the value it checks (a duration to
0.5 ms, a contrast ratio to 0.05, a blink rate to 0.05 against a value stored at one decimal), so
none of them is a loose guard masking a real drift.

## Round 24 — the hardcoded-bounds audit, and the thresholds I had left bare myself

A six-dimension audit was run for unnecessary hardcoded bounds that could affect the integrity of the
results. **It completed only in part and the incomplete portion is recorded here rather than glossed:**
two of the six scans finished, four (truncations, duplicated constants, validation gates, design facts
as literals) were cut off by a session limit, and none of the roughly twenty candidates from the two
that did finish was adversarially verified. The dimensions that ran are reported below; the rest are
**not** covered and must not be read as clean.

**The clamp dimension came back clean, and thoroughly so.** All 91 `Math.max` / `Math.min` / `clamp`
sites were read with their comments. The headline: **no clamp anywhere binds the primary outcome.**
`incomplete_blink_ratio` is `total > 0 ? incomplete / total : null` with no floor, no ceiling and no
rounding — it is not passed through the export's `round()` helper at all, so it leaves at full double
precision. Several clamps that look dangerous were traced and found provably inert or deliberately
documented:

- the PERCLOS `openness` clamp to [0,1] feeds only two comparisons at 0.2 and 0.3, so the bound cannot
  change any classification;
- the signal-detection rate bounds apply only to d-prime, while `hit_rate` and `false_alarm_rate` are
  exported UNCLAMPED, so the adjustment is fully reconstructable;
- `viewportScale.ts` is the exemplar of the pattern this audit was looking for — a clamp WITH a marker,
  where the file states that `stimulus_scale == MIN_SCALE` is the signature of a row that did not fit,
  and a separate integrity check warns when the scale varies within a sitting;
- the reading-time `Math.max(0, ...)` exports `reading_wall_clock_ms` and `reading_hidden_ms` beside
  the adjusted value precisely so the adjustment is auditable rather than silent.

**What I found in my own work, which is the part worth recording.** The QC panel I added in Round 8
labelled three of its thresholds with their provenance — one PROTOCOL, two ANALYST DEFAULT — and left
four others as bare literals at their use sites: the dispersion refit trigger, the censoring-spread
warning, the completion-informative band and the PERCLOS logit squeeze. That is an inconsistency in
the standard I had just set in the same file, and it matters for a concrete reason: a number that
decides how a result is READ cannot be defended or reproduced unless it says where it came from. All
four are now named constants carrying their provenance, and the ones that are my choices rather than
the protocol's say so.

**One was worse than unlabelled — it was duplicated.** The illumination check hardcoded 250 and 350
while `src/experiment/illumination.ts` defines the same band, so the two could drift apart. This
project has already been bitten by exactly that: an end-to-end helper's hardcoded lux literal silently
put every test out of range after the protocol retargeted its illuminance to 300 lux. The band is no
longer re-derived at all — the app writes its own verdict into `lux_logged_all_in_range` and the
template reads the flag, which cannot drift. The observed range is still printed so a reader can see
where the readings sat, and the flag is now reported beside `lux_complete` with a note that the two
must be read together, since a sitting can be in band on the readings it took and still be missing two.

Three tests guard it: every threshold must be named AND used, each must be marked protocol-derived or
analyst-chosen, and no bare 250/350 may reappear in code. Relabelling one constant or reinstating the
band literal each fails a test.

**Follow-up to Round 23, same day.** The range gate skipped the eight columns declaring `unit: 'ratio'`
because that spelling states no bounds. Checked each one rather than assuming: `open_ear_measured`,
`ear_baseline`, `ear_threshold_used` and `calibration_ear_baseline` are eye aspect ratios (roughly
0.1-0.4 for an open eye), `rt_cv` and `inter_blink_interval_cv` are coefficients of variation, and
both kinds can exceed 1 legitimately. So reading `'ratio'` as 0-1 would invent a bound the codebook
never claimed and flag real data as corrupt — skipping the ceiling is right.

None of them can be NEGATIVE, though, and that much is checkable without inventing anything: a
negative EAR or a negative coefficient of variation is corruption, not a measurement. `'ratio'` now
asserts a floor and no ceiling, with a test in each direction — a CV of 1.7 passes, an EAR of -0.2 is
reported.

## Round 25 — the cap I raised, and the four places that did not follow

The hardcoded-bounds audit was resumed and got further: 12 of 30 agents completed, 18 still lost to a
session limit. It confirmed five findings. Three of them are direct fallout from my own Round 14
change, and that is the part worth stating plainly: I raised the visual-search cap from 40 s to 60 s,
updated `PROTOCOL.md` and the analysis plan, noted that the on-screen instruction "followed on its
own" because it derives the number — and left four copies of the old value behind.

**Where the stale 40 survived.** Both codebooks, an internal comment in the pooled exporter, a type
comment, and two literals in the simulator.

The one in `analysisCodebook.ts` was the most serious, and not because of its severity grade.
`analysis_long.csv` is the file the confirmatory analysis reads, and the entry immediately above the
stale one tells the analyst that time-capped rows are a lower bound and must be treated as censored.
So the analyst was handed an explicit instruction to censor, at a threshold 20 s below the real one.
Blocks between 40 s and 60 s are not a rare tail: the timing model puts search time at a mean of 30 s
with an SD of 8, which puts 40 s at about +1.25 SD. An analyst who believed the cap was 40 s would
read those blocks as impossible — and the sibling codebook hands them a ready-made explanation for
deleting them ("a browser throttles timers while the app is in the background") — which would delete
genuine slow searches, the exact observations the raise was made to buy, in a condition-dependent way.

**The simulator was worse in a quieter way.** `src/sim/participant.ts` censored at two hardcoded
40000s, so the power and recovery analyses were resting on a cap the app no longer uses. A stale cap
there is a stale power estimate, and nothing would have announced it.

**The repo had already written down the lesson and it did not help.** The Round 14 correction note
says, in terms: "this project has TWO export products with TWO codebooks, and 'the export does not
write it' is a claim about one of them until both have been checked." The 40 s text survived in both
anyway. That is the argument for a test rather than a resolution to be careful: every one of these
sites now derives the number from `CONFIG.VS_TIME_LIMIT_MS`, and a test asserts that no stale 40-second
literal survives anywhere in the storage layer or the simulator, that both codebooks render the cap
the code actually uses, and that the simulator censors at that same cap.

**The other confirmed finding is a genuine clamp, and the only one the audit found that can pin a real
measurement without leaving a mark.** `gazeCalibration.ts` floored the fitted gaze threshold at a bare
`0.06`, written twice. The fitted value is the midpoint between the centre spread and the edge offset,
so the floor binds whenever those sum to under about 0.12 — a participant with limited gaze excursion,
or a camera far enough away that the iris offsets are small. That is not a degenerate fit: the validity
test only asks that the edges separate from the centre by 1.5x, which such a participant satisfies
comfortably. When it binds, every classification uses a threshold wider than their eyes earned, so more
samples land in the centre zone and `gaze_deviation_ratio` is biased DOWNWARD — one-directionally, on
a participant characteristic, so if it binds more often in one condition it is confounded with the
independent variable.

The floor stays, because a threshold near zero would classify ordinary measurement noise as a gaze
excursion. What changed is that the override is now recorded: `MIN_FITTED_GAZE_THRESHOLD` is named,
`thresholdFloored` is returned from the fit, and `gaze_threshold_floored` is exported so those sittings
can be found. Before, they could not be. This is the pattern `viewportScale.ts` already sets for its
own minimum — a clamp is acceptable when its firing is visible in the data.

**The d-prime correction was documented nowhere.** The audit flagged the correction's identity as
something that should be single-sourced rather than restated; reading the two codebooks showed the
sharper version of the problem — neither mentioned it at all. `computeSdt` bounds a rate of exactly 0
or 1 into [1/(2N), 1 - 1/(2N)] before the z-transform, because 1.0 has no z-score. A go/no-go block
with 20 signal trials reaches a ceiling easily, so an analyst re-deriving d-prime from the exported
hits, misses, false alarms and correct rejections gets a DIFFERENT number for those blocks, with
nothing in the file explaining the discrepancy.

`RATE_CORRECTION_NOTE` is now defined once beside the implementation and interpolated into both
codebooks — written out twice is how the search cap came to say 40 s in both of them twenty seconds
after it became 60. It states exactly what the code does, including that `hit_rate` and
`false_alarm_rate` export UNCORRECTED so the adjustment is reconstructable, and it deliberately does
NOT attribute the rule to a source: the module cites none, and inventing a citation for a procedure is
worse than leaving it uncited. A test asserts the absence of any year or author pattern in it.

**The three dimensions the workflow never finished were then covered directly**, since a third
attempt would likely have hit the same limit.

*Design facts as literals.* The codebooks describe the design in words — "the ten conditions", "the
nine targets", "the sixteen items", "Five levels" — and all of it is correct today. Interpolating
every string would be churn against a design far more stable than a cap that was being actively
tuned; the CVS-Q's sixteen items are definitional to a validated instrument, not a choice. A tripwire
was added instead: it asserts that the factorial actually crosses (five colours present in BOTH
polarities, or polarity x colour is not estimable at all), that the counts are 10 / 9 / 16, and that
any prose naming one of those numbers is only written while the number still holds. It also asserts
that at least three of those phrases are genuinely present, so rewording the descriptions cannot make
the block vacuous. Filtering one colour out of the condition table fails three of the seven tests.

One false alarm worth recording: an initial probe reported "1 distinct colour" across the condition
table, which would have meant the design did not cross at all. The field is `colorName`, not
`color_name` — the probe was wrong, not the data. Checked before reporting.

*Truncations.* Every `.slice(0, N)` in the storage layer is on an EXAMPLE LIST inside an integrity
warning, and each such message carries the full count in its own text (`${orphans.length} row(s)...`)
with the slice supplying a sample. The magnitude is not hidden and no measurement is truncated. Clean.

*Validation gates.* The age bounds derive from `CONFIG` rather than being restated, and the exclusion
machinery is careful — `mergeExclusionReasons` merges reasons across stages, with comments recording
two earlier defects (writing `eligible: TRUE` with an empty reason, and replacing rather than merging).
One inconsistency, reported rather than changed: contact-lens wear and colour-vision deficiency are
recorded as exclusions on the participant record, while age outside 18-35 blocks in the UI before any
record exists — two criteria stated in the same sentence on the same screen, one of which leaves a
trace and one of which does not. That is plausibly the RIGHT choice, since writing a record about
someone who was screened out has consent implications, but it means an age screen-out has to be
tallied by hand for a recruitment flow diagram. **Investigator decision, not a defect to fix here.**

**Still not covered:** 18 verify agents never ran, so the candidates from the threshold dimension
beyond the five confirmed above were never adversarially checked. That ground is unexamined, not clean.

## Round 26 — one split participant made every other participant unanalysable

Working through the audit candidates the verify agents never reached. This is the most serious defect
this audit produced, and it lands precisely on the design decision the investigator had just made.

`buildAnalysisDataset` derives how many sittings a complete participant should have using a
**pool-wide** `Math.min` over `conditions_per_session` across every session on the device, and
`checkJoin` then compares EVERY participant against that one number. So a single split participant
sets the expectation for the whole cohort.

Demonstrated on the real path:

    three participants, each ten conditions in one sitting  ->  analysable 3 / 3
    the same three, plus ONE split participant              ->  analysable 1 / 4

The three single-sitting participants each had `condition_runs = 10` — complete by every measure —
and were excluded as `incomplete_split_sitting`. The reason they were excluded is something a
DIFFERENT participant did.

Three things make this the worst shape a defect can take here. `analysable` is the column the
confirmatory analysis filters on, so the exclusion is silent and downstream. The excluded participants
are complete, so nothing about their own data would ever prompt a second look. And the investigator
has deliberately kept the split option, so a real cohort is EXPECTED to be mixed — which means the
majority case is the one that broke, and it would have broken at analysis time, after the participants
had gone home.

The expectation is now read from each participant's own sittings, falling back to the pool-wide figure
only when they record none. Total condition-runs remains the invariant, which is what the original
comment correctly identified as the thing that does not change. Same cohort now gives 4 / 4, and the
mirror case — one single-sitting participant among splits — is covered too. The check keeps its teeth:
a split participant genuinely missing a half is still blocked. Reverting to the pool-wide expectation
fails two of the three new tests.

**Two more from the same batch, both stale prose making a positive false claim.**

`analysisCodebook.ts` described `search_d_prime` as "Log-linear corrected". The code calls
`computeSdt`, and that module's comment says in terms: "The 1/(2N) rule, NOT the log-linear correction
— an earlier comment here called it 'loglinear-style', and they are different, separately named
procedures." So the codebook named the wrong statistical procedure to the analyst, and the module had
already recorded that this exact mislabel was fixed once in the code — it survived in the codebook.
It now interpolates the same `RATE_CORRECTION_NOTE` single-sourced beside the implementation.

`LandingPage.tsx` rendered the study overview as "10 (2 polarity × 4 colour)". Two times four is
eight. The condition count derived from the table and the factorial beside it did not, so the text
predated GREEN being added to the original four-colour set and never followed. Both factors are now
derived from the condition table, so the sentence cannot contradict its own count again.
