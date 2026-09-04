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


### [critical] Split sittings delete first-order carryover balance for exactly the ten same-colour polarity-switch adjacencies, while the code and synopsis both claim the split preserves the counterbalancing scheme

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


### [high] The open-eye EAR baseline is a by-product of the 9-point gaze calibration, is taken in a different gaze/head posture than reading, and is never re-measured or re-checkable across a 90-minute sitting

`src/tracking/useTracking.ts` line 261 · dimension: ?

**What the auditor reports**

Every blink threshold is a fraction of `baselineEarRef.current` (partialT = 0.75 x baseline at blink.ts:127; the completeness cut at 0.6). That baseline is set only in `endGazeCalibration` (useTracking.ts:261) from `calibrating.current.samples`, which are collected across the whole 9-target routine — during which CalibrationRoutine instructs the participant to fixate dots at y=0.1 (top row) and y=0.9 (bottom row). `baselineEar` then takes the 90th percentile, which by construction selects the highest-EAR frames, i.e. the up-gaze frames from the top row; the palpebral fissure is widest in up-gaze and narrowest in down-gaze. Reading happens in sustained down-gaze at a tablet, and EAR is an unnormalised 2-D projection with no head-pose correction anywhere in the pipeline. The dedicated still-posture routine `calibrate(ms)` (useTracking.ts:230-243) exists in the TrackingApi and is called by nothing in the app — I grepped src/ and only the gaze routine reaches the baseline. The baseline is then frozen for the whole sitting (10 conditions x ~9 min), while the open-eye EAR itself falls with ocular fatigue and lid droop. Nothing in the export lets an analyst detect that: ear_baseline is the same constant on all ten rows, and no per-condition measured open-EAR (e.g. the median of non-blink frames) is recorded anywhere.

**Failure scenario given**

A participant whose EAR is 0.34 in up-gaze and 0.29 in reading posture is calibrated at 0.34. During reading, partialT = 0.255 instead of 0.2175, so shallow lid movements that are not blinks cross the entry threshold, and every real blink's min_ear/baseline ratio is scaled by 0.29/0.34 = 0.85, pushing events that were genuinely incomplete (ratio ~0.65 against the correct baseline) below the 0.60 cut and relabelling them complete. The primary outcome moves for that participant by a factor that varies with how much they moved their eyes during a 9.5 s calibration. Over the sitting, as their open EAR drifts down a further 5-8% with fatigue, the same relabelling grows monotonically with session_position — producing a spurious FALL in incomplete_blink_ratio across the sitting, the opposite sign to the hypothesis, with no diagnostic column that could expose it.

**Suggested fix**

Call the existing `calibrate()` on a still, straight-ahead, reading-posture fixation to set the EAR baseline (keep the gaze routine for gaze only); export a per-condition measured open-eye EAR (median of frames above partialT) alongside the calibration baseline so drift is visible and correctable; and re-take the baseline at the mid-session break.


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


### [medium] A third sitting for a participant who has already completed both illumination blocks silently replays all ten conditions of block 1 and labels them passage_repeat_number = 2

`src/experiment/Experiment.tsx` line 298 · dimension: ?

**What the auditor reports**

beginSession computes `block = Math.min(Math.floor(prior.conditionsCompleted / N_CONDITIONS), N_ILLUMINATION_BLOCKS - 1)` and `offset = prior.conditionsCompleted % N_CONDITIONS`. The block is clamped but the offset is not, so at conditionsCompleted = 20 the block clamps to 1 while the offset wraps to 0. I ran the arithmetic: completed=20 yields block 1, offset 0, plan slice 1,2,0,3,9,4,8,5,7,6 — the entire block-1 sequence again, under the same illumination level. passage_repeat_number is written as `(session.illumination_block ?? 0) + 1` = 2 (Experiment.tsx:459) although it is the third reading of every passage, and session_position is written 0..9 for a second time. resolveAssignment already returns conditionsCompleted and setupStages.tsx declares it in its props (line 39) but never uses it, so the New Session screen cheerfully renders 'Assigned illumination — block 2 of 2' with no warning. Each replay is a separate session record, so the per-session integrity audit (export.ts:713) still certifies 'condition_id and session_position unique'.

**Failure scenario given**

P047 finishes both sittings. A week later the investigator finds the camera consent was mis-recorded in sitting 2 and asks the operator to 'run the second session again'. The operator types P047, sees 'block 2 of 2 — Moderate (150 lux)', sets the room and runs all ten conditions. The dataset now holds 30 condition-runs for P047: twenty legitimate and ten more at illumination_block=1, session_position 0-9, passage_repeat_number=2 when it is actually the third exposure to each passage. An analyst aggregating by (participant_id, condition_label) averages a first/second exposure with a third-exposure run whose practice effect is unmodelled, and 16_integrity_report.csv reports all_checks_passed for every one of the three sessions.

**Suggested fix**

In beginSession, clamp the whole plan, not just the block: if `prior.conditionsCompleted >= N_CONDITIONS * N_ILLUMINATION_BLOCKS`, refuse to create the session. Surface the already-returned `conditionsCompleted` on the New Session screen ('this participant has completed 20 of 20 condition-runs') and require an explicit override that is stamped on the session record, and derive passage_repeat_number from the participant's actual prior exposure count for that passage rather than from illumination_block.


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
