# VisuLab — Master Blueprint

> **PROTOCOL AMENDMENT.** Ambient illumination is no longer a factor: every sitting runs at 300 lux
> and each participant attends once for all ten conditions. Passages describing two levels or two
> sittings describe the superseded design. See `docs/ILLUMINATION_AMENDMENT.md`.

**A within-subjects visual-ergonomics experiment delivered as an offline tablet PWA.**
Authoritative, self-contained specification of the build: scientific rationale, experimental
design, every task and parameter, the physiological/behavioural metrics and their formulae, the
data model and exports, the software architecture, the verification harness, and the full decision
log. Paired with the complete source tree in this archive (`ALL_SOURCE.md` = every code line
concatenated; the original files are also present under their paths).

- **Version:** package `visulab@2.1.0`; IndexedDB schema v8.
- **Commit at packaging:** branch `claude/build-review-refinement-3z0nrm` (see `CHANGELOG` section §16).
- **Status:** 169 unit/property tests, `tsc`+`vite` production build, ESLint, a harsh stress
  harness, and 6 Playwright E2E specs — all green.
- **Stack:** Vite + React 18 + TypeScript; MediaPipe FaceMesh; IndexedDB (`idb`); Recharts;
  vite-plugin-pwa (offline). No backend — all data is on-device until exported.

---

## 0. How to use this document (reviewer instructions)

This blueprint is written to be cross-checked against the scientific literature. When reviewing:

1. **Verify each design choice and parameter against current literature** (§§3–10). Citations used
   in the build are listed in §17; confirm they are applied correctly and add stronger/more recent
   sources where warranted.
2. **Audit the metric formulae** (§7, §10) for correctness and validity — especially the
   webcam-derived ocular metrics (EAR, blink tiers, incomplete-blink ratio, PERCLOS, inter-blink
   interval), the SDT scoring (d′, criterion), and the contrast metrics.
3. **Stress the experimental-design logic** (§3, §6, §12, §15): counterbalancing, confound control
   (contrast, passage content, polarity), sample size / power, and the boredom-vs-fatigue problem.
4. **Scrutinise the honest limitations** (§14) and the **open questions** (§18) — these are where
   the build is least certain and where the highest-value optimisation lies.
5. **Mark, suggest, optimise:** rate each subsystem, flag flaws, propose concrete improvements and a
   prioritised plan to make the instrument PhD-defensible at the highest standard of scientific
   integrity.

The build deliberately favours **honest measurement over impressive-looking numbers** (e.g. it flags
uncalibrated gaze, gates sub-Nyquist blink tiers, records `effective_fps`, and reports per-condition
d′ instability rather than hiding it). Treat any place that overstates fidelity as a defect.

---

## 1. Research aim & hypotheses

**Aim.** Quantify how **display polarity** (light vs dark background) and **text colour / luminance
contrast** affect reading performance, visual comfort, sustained attention, and objective and
subjective visual fatigue during a tablet reading session.

**Working hypotheses (to be confirmed/critiqued by the reviewer):**
- **H1 (contrast → performance):** lower text–background contrast slows reading and reaction time
  and reduces comprehension/search accuracy and comfort.
- **H2 (polarity):** positive polarity (dark text on light) vs negative polarity differ in comfort
  and fatigue, partly mediated by contrast and ambient light.
- **H3 (time-on-task → fatigue):** subjective (CVS-Q, VAS) and objective (blink rate ↓, incomplete-
  blink ratio ↑, RT variability ↑) fatigue markers rise with `session_position`.

These are operationalised as a **within-subjects** manipulation; every participant sees all 8
conditions. The analysis is a **linear mixed model with a random intercept per participant**, with
**WCAG contrast ratio as a covariate** and **session position** as a time-on-task covariate.

---

## 2. Design overview

- **10 display conditions** = **2 polarity × 5 text colour** (achromatic, blue, red, yellow,
  green). Hex values are **locked** (original spec: "must not be changed under any circumstance");
  contrast metadata is **derived** and recorded as covariates rather than altering colours.
  Green was added after a colour-set simulation (see §2.2) to balance sub-AA conditions across
  polarity at two each.
- **Ambient illumination** is **held constant at 300 lux** (accept 250–350) for every participant
  and every sitting. It was a third factor with two levels (dim ≈10 lux, moderate ≈150 lux) in an
  earlier version of the protocol; it was withdrawn because the ocular measures are camera-derived
  and, in a dim room, how well the camera sees the face is confounded with display polarity — the
  primary independent variable. See `docs/ILLUMINATION_AMENDMENT.md`.
- **Design:** polarity × colour, both within participant, in a **single sitting**:
  **10 condition-runs per person**. One random intercept, participant. The split-plot structure and
  its nested session-within-participant term belonged to the two-level design and no longer apply.
- **Counterbalancing:** balanced **Williams Latin square** (first-order carryover controlled),
  indexed by a **sequential enrolment number** (not a hash of an arbitrary ID — hashing breaks
  balance). Each condition appears in each serial position equally over each block of 10
  participants. The **second illumination block advances the Williams row by one**, so a
  participant does not meet the conditions in the same serial order twice — otherwise serial
  position would be perfectly correlated with condition within a participant across both sessions.
- **Illumination order** (dim-first / moderate-first) is counterbalanced **orthogonally** to the
  Williams row. A naive parity rule would NOT be orthogonal: the row cycles every 10 and parity
  every 2, and 2 divides 10, so row would determine order completely. The rule therefore
  alternates with parity *and* flips once per completed block of ten, which splits 5/5 within each
  block and pairs every row with both orders across twenty participants.
- **Passage assignment** is a **second, independent Latin square** (rotating offset), so passage
  content is **orthogonal to display condition** (removes the passage-difficulty confound that the
  original build had by yoking passage = condition). Word counts and search-target counts are
  **derived from the passage text**, never declared — the original bundle's declared word counts
  overstated the real text by 11–32%, which inflated `reading_speed_wpm` and mis-set the
  skim-detection floor.
- **Per condition**, 6 measured sub-stages run in a fixed order (reading → comprehension → display
  perception → post-fatigue → visual search → reaction time), followed by an adaptation rest.
- **Session close:** end CVS-Q, then **NASA-TLX** once per session as a cumulative workload index.

### 2.1 The 10 conditions (derived contrast, computed by `src/lib/contrast.ts`)

| Label | Text on background | Polarity | WCAG ratio | WCAG level | Michelson | Below AA? |
|------|--------------------|----------|-----------|-----------|-----------|-----------|
| P1 | black on white   | positive | 21.00 : 1 | AAA      | 1.000 | no  |
| P2 | blue on white    | positive | 6.70 : 1  | AA       | 0.807 | no  |
| P3 | red on white     | positive | 5.74 : 1  | AA       | 0.765 | no  |
| P4 | yellow on white  | positive | **2.39 : 1** | **Fail** | 0.439 | **yes** |
| P5 | green on white   | positive | **3.19 : 1** | AA Large | 0.564 | **yes** |
| N1 | white on black   | negative | 21.00 : 1 | AAA      | 1.000 | no  |
| N2 | blue on black    | negative | **3.14 : 1** | AA Large | 1.000 | **yes** |
| N3 | red on black     | negative | **3.66 : 1** | AA Large | 1.000 | **yes** |
| N4 | yellow on black  | negative | 8.79 : 1  | AAA      | 1.000 | no  |
| N5 | green on black   | negative | 6.57 : 1  | AA       | 1.000 | no  |

### 2.2 What the condition matrix buys, and what it cannot

1. **The contrast ordering is exactly reversed between polarities, and this is arithmetic rather
   than design.** Contrast on white is `1.05/(L+0.05)`, strictly decreasing in the text's relative
   luminance L; on black it is `(L+0.05)/0.05`, strictly increasing in the same L. Both read one
   quantity, so the chromatic rank order must reverse — rank correlation is exactly **−1.00** for
   *any* colour set. The build does not claim credit for it. What the colour choice *does* control
   is how balanced the polarities are and whether any condition is too faint to read.
2. **The achromatic pair is contrast-matched and is the one clean test of polarity.** Both give
   21.00 : 1, so that pair varies polarity with luminance contrast held constant — an experimental
   control, not a statistical one. It is the only comparison where a polarity effect cannot be
   attributed to contrast.
3. **Sub-AA conditions are balanced two per polarity** (P4, P5 / N2, N3), so polarity is not
   systematically confounded with accessibility compliance. Across the ten conditions
   `r(polarity, log contrast) = +0.11` — near enough to zero for both to enter one model.
4. **Michelson contrast is uninformative under negative polarity.** With a pure black background
   the minimum luminance is zero, so the metric saturates at 1.000 for every colour. The WCAG
   ratio, backed by measured display photometry, is therefore the analytic contrast variable.

Colour-set alternatives were compared before the set was fixed. A **luminance-matched** chromatic
set is the *worst* option, not the most rigorous: equalising luminance across hues necessarily
makes every chromatic colour low-contrast on white and high-contrast on black, pushing all four
sub-AA conditions into one polarity and raising the confounding correlation to **+0.43**. The
web-default hues yield an unusable condition (yellow on white, 1.07 : 1).

> **Residual limitation (superseded in part by §2.2):** polarity and luminance contrast are still
> not fully orthogonal, because chromatic pigments differ intrinsically in luminance and contrast
> cannot be equalised across polarity with a fixed colour set. Polarity and
> contrast are therefore partially entangled. The build records WCAG ratio + `below_wcag_aa` so the
> analysis can model contrast as a covariate or reframe as **polarity × contrast**, but the reviewer
> should assess whether the design can cleanly separate the two effects, or whether additional
> conditions / a contrast-matched subset are needed.

A deterministic **FNV-1a hash** over the locked condition table (`conditionDefinitionHash()`) is
stamped into every export so a dataset is tied to the exact condition definitions used.

---

## 3. Session flow (as implemented)

```
SESSION_INIT            researcher: participant ID, ambient lux, (optional) white-screen luminance
                        cd/m² + locked brightness %, session structure (single 8 / split 4+4)
  → CONSENT             informed consent (recorded HERE, not at session creation)
  → PARTICIPANT_PROFILE age (18–80), gender, daily screen hours, device familiarity, lighting habit,
                        vision correction, self-report CVD, caffeine (≤4 h), hours since waking
  → PREFLIGHT           researcher checklist: brightness fixed, auto-brightness + night-shift OFF,
                        screen clean, ~50–60 cm, landscape, no backlight
  → COLOR_VISION        digital Ishihara screening (AFTER night-shift is off)
  → CAMERA_SETUP        webcam permission (or skip → camera_active=false, zeroed eye metrics)
  → CALIBRATION         9-point gaze calibration + EAR open-eye baseline + per-person frontal-pitch
                        baseline (head frontal → pitch zero)  /  positioning check if no camera
  → CVSQ_BASELINE       validated CVS-Q (16 items)
  → BASELINE_FATIGUE    5-item visual-fatigue VAS (0–10)
  → INSTRUCTIONS        participant overview
  → [× 10 conditions, Williams order, per illumination block]
        READING_TASK         self-paced passage (per-page minimum dwell floor); eye-tracking window
        → COMPREHENSION      1 × 4-option MCQ (accuracy + RT)
        → DISPLAY_PERCEPTION comfort + clarity sliders, captured immediately after reading
        → POST_FATIGUE       5-item VAS, immediately after the strongest fatigue inducer (reading)
        → VISUAL_SEARCH      tap every target word, 40 s limit (selective attention)
        → REACTION_TIME      colour go/no-go (random-location dot; respond only to target colour)
        → ADAPTATION         60 s neutral grey (120 s when polarity switches vs the next condition)
        → BREAK_SCREEN       self-paced rest after every 2 conditions; never after the last
  → CVSQ_END              CVS-Q again (Δ from baseline = primary validated subjective fatigue outcome)
  → SESSION_COMPLETE
  → EXPORT_DASHBOARD      researcher: QC charts + CSV/JSON export
```

Progress bar = **8 setup steps + 8×6 measured sub-stages = 56 steps**. The state machine
(`src/experiment/stateMachine.ts`) is a pure transition function; `Experiment.tsx` is the driver.

### 3.1 Ordering rationale (workflow-logic cross-check; all fixed)
- **Consent** is recorded at the CONSENT stage, not pre-set true at session creation.
- **Preflight precedes colour-vision** screening, because a blue-light filter invalidates red–green
  Ishihara plates.
- **Display-perception and post-fatigue are captured immediately after reading** (the exposure and
  strongest fatigue inducer), so perception is fresh — not deferred to the end.
- A **transition lock** + session-creation re-entry guard prevent double-tap from skipping a stage
  or creating duplicate sessions.
- An interrupted condition is **restarted** (not stitched) and reuses its stored `condition_id`, so
  no duplicate/orphan rows are produced.

---

## 4. Per-task specifications

### 4.1 Reading (`ReadingTask.tsx`)
- Passage shown at `READING_FONT_SIZE_PX=22`, line height 1.6, 10% margins.
- **Per-page minimum dwell** `READING_PAGE_MIN_MS=20 000` ms, rAF-gated; the Next button unlocks
  after the floor but the participant is **self-paced** beyond it. `reading_time_ms` is recorded and
  converted to **words/min** in export.
- The reading window is the **eye-tracking window** for blink/gaze/head metrics for that condition.

### 4.2 Comprehension (`ComprehensionTask.tsx`)
- One 4-option multiple-choice question per passage; **accuracy + response time**; 1 s post-answer
  feedback dwell.

### 4.3 Display perception (`DisplayPerceptionRating.tsx`)
- Two sliders: **display comfort** and **text clarity** (0–100). `touched` flags gate submission
  (prevents default-value/straight-line responses being silently accepted).

### 4.4 Visual fatigue VAS (`FatigueScale.tsx`)
- **5 items** (eye strain, dryness, blur, burning, headache), 0–10 each; composite = **mean**.
  Collected at baseline and immediately after each condition's reading. `touched`/`all_touched`
  flags recorded.

### 4.5 Visual search (`VisualSearchTask.tsx`)
- Tap **every occurrence** of a target word in the passage; **40 s** limit. Records targets found /
  missed / false detections, time-to-first-target, inter-target intervals, **accuracy** (found ÷
  authoritative occurrence count), **search efficiency** (found per minute), termination mode.
- **Target counts are the ACTUAL occurrence counts** computed from the passage text (the original
  bundle's stored counts were wrong, e.g. "carbon" stored 8 vs 12 actual); accuracy is therefore
  correctly calibrated.

### 4.6 Reaction time — colour go/no-go (`ReactionTimeTask.tsx`)
- A single coloured dot appears at a **random screen location** each trial, on the active condition's
  own background. The participant taps **only** for the **achromatic target** — black `#000000` on
  a light field, white `#FFFFFF` on a dark one — so target contrast is 21:1 and identical in both
  polarities, and no target hue coincides with the text-colour manipulation. (This replaced a fixed
  green target, whose justification — "the only colour not used by any display condition" — expired
  when green became the fifth text colour.) The participant withholds for the four chromatic
  distractors (red, blue, yellow, green). The discrimination is therefore achromatic-against-
  chromatic rather than hue-against-hue: an easier judgement, but it preserves the two
  fatigue-sensitive indices the task exists to measure — RT variability and lapse rate.
- **32 trials/condition**, go-rate **0.625** (≈ 20 go / 12 no-go). **6 unscored practice trials**
  run once, before the first scored block only.
- Onset is timestamped at the **actual painted frame** (rAF); RT uses the hardware pointer-event
  timestamp (low jitter). The trial **ends on response** (only no-go trials wait the 1 s window out).
- Responses `< RT_MIN_VALID_RT_MS=150 ms` are **anticipations** (excluded from RT means, counted
  separately); valid hits `> RT_LAPSE_THRESHOLD_MS=600 ms` are **attention lapses** (PVT-style).
- **This is a pure go/no-go task — there is no Eriksen-flanker / congruency manipulation.** (Earlier
  schema scaffolding for congruency was removed because it could never be populated.)

---

## 5. Eye tracking & physiological metrics (`src/tracking/`)

Webcam frames → MediaPipe **FaceMesh** (468/478 landmarks) → one sample **per FaceMesh result**
(true measurement rate, target ~30 fps; not the 60 fps render loop). `effective_fps` is recorded
from processed-frame timestamps and **gates** the timing-dependent metrics.

### 5.1 Eye-Aspect-Ratio (EAR) and blink classification (`blink.ts`)
- **EAR** (Soukupová & Čech, 2016): for eye points p1..p6, `EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2·‖p1−p4‖)`,
  averaged over both eyes. Landmarks: left `[33,160,158,133,153,144]`, right `[362,385,387,263,373,380]`.
- **Open-eye baseline** = 90th percentile of calibration EAR samples (robust to blinks in the set).
- A blink starts when EAR drops below `0.75 × baseline` and ends when it recovers. **Tier = depth of
  closure:**
  - **complete blink** (lid fully closes): min-EAR ratio `< 0.60 × baseline`;
  - **incomplete blink** (lid does *not* fully close): `0.60 ≤ ratio < 0.75` — **a primary CVS
    marker** (Portello & Rosenfield, 2013);
  - very short complete closures (`< ~40–80 ms`) are tagged **micro** (diagnostic only).
- **`incomplete_blink_ratio` = incomplete / all blinks** — now genuinely reachable (a prior bug made
  this branch unreachable so it was always 0; fixed and regression-tested).

### 5.2 CVS / ocular-fatigue markers (primary; frame-rate-robust)
- **Blink rate** (per minute) and **first/second-half bins** (within-task dynamics).
- **Incomplete-blink ratio** (above).
- **Inter-blink interval** (mean + CV) — lengthens / becomes erratic with reduced blinking.
- These are **proportion/count** measures → robust to webcam frame rate.

### 5.3 Drowsiness covariates (Dinges & Grace, 1998; frame-rate-robust)
- **PERCLOS P80 / P70** — proportion of measured time eyes are ≥80% / ≥70% closed (openness
  self-normalised between the per-participant open baseline and an estimated closed-EAR).
- **Long-closure events** (> 500 ms) — micro-sleep proxy: count + total duration.

### 5.4 Diagnostics only (sub-Nyquist below ~25 fps; JSON bundle only)
- Blink **duration**, **micro-blink** counts/rate, per-tier counts. Gated by `fps_adequate_for_tiers`.

### 5.5 Head pose (`headPose.ts`)
- **Yaw** from nose-vs-ear-midpoint; **roll** from eye-line angle; **pitch** from the nose-tip's
  vertical position between the eye-line and chin.
- **Per-person frontal-pitch baseline:** during calibration (head frontal, eyes-only movement) the
  participant's own frontal nose-fraction is captured (median) and used as the **pitch zero**, so
  `head_pitch_mean` is relative to their natural straight-ahead (`head_pitch_calibrated:true`). This
  removes inter-individual face-geometry bias. **Caveat:** the degrees-per-unit slope is a monocular
  proxy (no depth sensor) — treat magnitude as approximate; prefer within-person change.
- Off-axis thresholds raised to pitch ≥ 20°, yaw ≥ 15° (> 2× typical webcam error); continuous means
  are preferred over the dichotomised flag.

### 5.6 Gaze (`gaze.ts`, `gazeCalibration.ts`)
- Real **9-point calibration**: neutral bias (h0,v0) from the centre target + per-axis thresholds
  (midpoint between centre spread and edge offset). `gaze_calibrated` is **true only when the fit is
  separable**; otherwise gaze is honestly reported as a gross head-movement proxy.
- Derived: zone-centre ratio, gaze-deviation ratio, zone-transition count.

### 5.7 Other QC
- **Face presence ratio**, **face size** (landmark bounding-box geometric-mean extent — a
  viewing-distance/posture proxy), **head movement std**, **postural load**, **head stability**.
- **Lighting QC:** per-frame BT.601 luma → mean luma + band (`low`/`good`/`overexposed`).

---

## 6. Questionnaires & screening

- **CVS-Q (Computer Vision Syndrome Questionnaire)** — 16 items, each scored by frequency × intensity
  recoded {0→0, 1–2→1, ≥4→2} and summed (range 0–32); **≥ 6 = symptomatic**. Administered at
  **baseline and end**; **Δ is the primary validated subjective fatigue outcome**. (`scales/cvsq.ts`)
- **Visual-fatigue VAS** — 5 items (above), baseline + per condition.
- **Display perception** — comfort + clarity, per condition.
- **Ishihara colour-vision screening** (`screening/ishihara.ts`) — control plate must pass; allows
  one slip on test plates; digital **screening aid, not a clinical diagnosis**.

---

## 7. Scoring formulae

- **Composite fatigue** = mean of 5 VAS items (0–10).
- **WCAG contrast** (`contrast.ts`): sRGB linearised (threshold 0.04045, γ 2.4, coefficients
  0.2126/0.7152/0.0722); ratio `(L_light+0.05)/(L_dark+0.05)`. **Michelson** = `(Lmax−Lmin)/(Lmax+Lmin)`.
- **Signal Detection Theory** (`signalDetection.ts`): `d′ = z(H) − z(F)` with the **Acklam probit**;
  rates clamped via a loglinear `1/(2N)` correction to avoid infinities. **criterion (response bias)
  `c = −0.5·(zH+zF)`** (>0 conservative, <0 liberal) is reported. Per-condition `d′_se` is computed
  (Macmillan & Creelman) and **flagged unstable when SE > 0.3** — analysis should use d′ aggregated
  across conditions.
- **RT metrics:** mean/median/SD/CV of valid hit RTs; **inverse efficiency** = mean RT ÷ proportion
  correct; **lapse rate**; **anticipation count**; first/second-half mean RT (within-block vigilance).
- **Search:** accuracy = found ÷ actual target count; efficiency = found per minute.

---

## 8. Data model (IndexedDB `VisualErgonomicsDB`, schema v8)

**Stores:** `participants`, `sessions`, `conditions`, `reaction_trials`, `rt_summaries`,
`visual_search`, `eye_metrics`, `fatigue_scores`, `display_perception`, `comprehension_results`,
`calibration_data`, `cvsq_scores`, `system_performance_logs`. Full field-level types in
`src/storage/types.ts`.

**Integrity:** every measure is written immediately (no buffering — a crash loses at most the
in-progress condition, flagged `completed_at:null` and restarted). Soft-delete = 30-day recycle bin
(restore/auto-purge); permanent purge **cascades** to all child records and only deletes the shared
`participants` row when no other session references it (split-session safe).

**Provenance:** every session/export is stamped with app version, git hash, condition-definition
hash, schema version; the export manifest carries **per-file FNV-1a checksums**.

### 8.1 Export bundle (`src/storage/export.ts`) — 14 CSVs + JSON + codebook + manifest
`00_MASTER_CODEBOOK` (condition key), `01_session_info`, `02_conditions` (+ reading wpm),
`03_fatigue_scores`, `04_comprehension`, `05_visual_search`, `06_display_perception`,
`07_eye_metrics`, `08_reaction_trials`, `09_rt_summary` (incl. d′, d′_se, criterion),
`10_wide_summary` (one joined row per condition + QC + engagement), `11_participant`
(demographics + caffeine/sleep covariates), `12_quality_flags` (engagement/careless-responding),
`13_cvsq` (baseline + end, per-item). CSV writer is RFC-4180-safe (quotes `" , \n \r`).

---

## 9. Counterbalancing math (`counterbalance.ts`)
- **Williams Latin square** for even n: first row `0, 1, n−1, 2, n−2, …`; row *i* = first row +*i*
  (mod n). For n=8 the first row is `[0,1,7,2,6,3,5,4]`. Each column (serial position) contains every
  condition exactly once and first-order carryover is balanced.
- `conditionOrderFor(enrolment)` maps the **1-based enrolment number** to a row (`(n−1) mod 8`),
  cycling every 10 participants; safe-modulo guards non-integer/negative inputs.
- `passageForCondition` applies a **rotating offset** so passage is decoupled from condition.

---

## 10. Software architecture
- **Vite + React 18 + TypeScript**, Tailwind for styling. Single-page app; pure functions for all
  scoring/counterbalancing/stats (fully unit-testable, no DOM).
- **MediaPipe FaceMesh** dynamically imported and **self-hosted** (assets vendored into `public/`
  and precached) → fully **offline-capable PWA** (vite-plugin-pwa / Workbox).
- **State machine** (`stateMachine.ts`) is a pure transition function; `Experiment.tsx` wires it to
  the React tree and persistence; `useTracking.ts` owns the camera + per-condition aggregation.
- **Storage layer** (`storage/`) wraps IndexedDB via `idb`, with a deterministic in-memory fallback
  for tests (`fake-indexeddb`).
- **Resume**: a condition-level pointer in `localStorage`; reload offers Resume and restarts the
  interrupted condition.

### 10.1 Source map (responsibilities)
```
src/
  experiment/   config (all tunables), conditions (locked table + derived contrast),
                counterbalance (Williams + passage rotation), passages (text/Qs/search targets),
                stateMachine (pure transitions), Experiment.tsx (driver)
  tasks/        Reading, Comprehension, VisualSearch, ReactionTime, TaskIntro
  scales/       Cvsq, FatigueScale, DisplayPerceptionRating (+ cvsq scoring)
  screening/    Ishihara (test + scoring)
  tracking/     blink (EAR/tiers/PERCLOS/IBI), headPose, gaze, gazeCalibration, lighting,
                aggregator (per-condition rollup), useTracking (camera + MediaPipe)
  lib/          contrast (WCAG/Michelson/sRGB), signalDetection (d′/criterion), stats (probit,
                SD, clampRate), timing, env (build provenance)
  storage/      db (IndexedDB + fallback), types (schema), gather (assemble a session bundle),
                export (CSV/JSON/codebook/manifest), sessionPersistence (resume), schemaEnums
  start/        LandingPage, SessionManager, setupStages, CalibrationRoutine, BreakScreen
  dashboard/    Dashboard, aggregate (per-condition summaries + QC + engagement), charts
  sim/          rng, effects (ground truth), participant (synthetic data via the REAL scoring code),
                analysis (recovery + power), fuzz (adversarial soak), runSimulation/runFuzz/runStress
  analysis/     analysis_template.{R,py} (mixed models a researcher runs on the export)
docs/           PROTOCOL.md (authoritative), DEPLOY.md
spec/           CONSTANTS.md (provenance of every value/refinement)
tests/, e2e/    unit/property/stress tests (Vitest) + Playwright E2E
```

---

## 11. Engagement / boredom mitigation & QC (`dashboard/aggregate.ts`, `12_quality_flags.csv`)
The 4-task loop repeats ×8, so **boredom/disengagement accumulate with time-on-task and mimic
fatigue**. The build:
- **Detects** per condition: reading **skim** (faster than word-count ÷ 400 wpm), **rushed** rating
  response times, **straight-lined** fatigue ratings, RT **disengagement** (high FA/error/lapse),
  wrong comprehension, low face presence → an **engagement flag** (`good`/`warn`/`bad`) + 0–1
  `quality_score`. Exported for a **sensitivity analysis** (fit on all data vs the clean subset).
- **Reduces** monotony with a neutral progress readout and a **self-paced break every 2 conditions**
  — deliberately **no gamification or performance feedback** (which would differentially change
  effort across conditions and confound the manipulation).

---

## 12. Split-session support
A sitting can be **split (4 + 4)**. The enrolment number (which drives the Williams order) is
**reused** across sittings; the next sitting resumes at the **global serial position** where the last
stopped, so each condition runs exactly once. `session_index` is recorded as a covariate; baseline
fatigue + CVS-Q are re-measured each sitting (fatigue resets — documented, not assumed away).

---

## 13. Simulation & verification harness (`src/sim/`, `tests/`, `e2e/`)
- **Monte-Carlo simulation** (`npm run sim`): N synthetic participants generated through the **same
  scoring code the app uses** (computeSdt, summariseBlinks), with known ground-truth effects;
  recovers coefficients and runs a **power analysis**. The simulated RT task matches the real
  go/no-go design (32 trials, go-rate 0.625, **no flanker**).
- **Fuzz harness** (`npm run fuzz`): tens of thousands of degenerate iterations (NaN/negative/huge
  sensor streams, empty/partial bundles, extreme enrolments, CSV-injection free text) asserting no
  throws and invariant bounds.
- **Harsh stress run** (`npm run stress`): large-cohort numeric invariants (no NaN/Inf/out-of-range),
  CSV RFC-4180 round-trip integrity, head-pitch dynamic-range/frontal-zero, incomplete-blink
  reachability.
- **Unit/property tests** (Vitest, **169**): scoring, Williams balance, contrast, storage, screening,
  gaze + head-pose calibration, ocular metrics, engagement, CSV torture.
- **E2E** (Playwright, **6**, fake camera): full 56-stage run, input gating, double-click→single
  session, reload→resume, split session.

---

## 14. Known limitations to disclose (PhD write-up)
1. **Webcam eye tracking is screening-grade** (spatial error ~3–5°); an IR eye-tracker is the
   reference standard. Frame rate is recorded (`effective_fps`) and gates timing-based metrics.
2. **Blink rate is non-monotonic w.r.t. fatigue** (drops with concentrated reading, rises with
   sleepiness) — never interpret in isolation; triangulate incomplete-blink ratio + IBI + CVS-Q +
   PERCLOS.
3. **Head-pitch magnitude** is an uncalibrated monocular slope (zero-point is per-person calibrated);
   prefer within-person change.
4. **Contrast confound**: contrast is not balanced across polarity (C4/C6/C7 below AA, unevenly
   split) — model contrast as a covariate or reframe as polarity × contrast.
5. **Per-condition d′ is small-N** (~20 go trials of 32; SE often > 0.3) — aggregate across conditions.
6. **Session length (~60–90 min)** accumulates fatigue and boredom; `session_position` + engagement
   flags address this but cannot fully remove it.
7. **Ishihara digital screening** is an aid, not a diagnosis; depends on uncalibrated display colour.
8. **Gaze** is meaningful only when calibration is valid.

---

## 15. Open questions for the reviewer (highest-value scrutiny)
1. **Power / sample size:** is the within-subjects N (and trial counts per task) adequate for the
   effect sizes plausibly expected for polarity/contrast on RT, comprehension, and fatigue? The sim's
   power curve is a starting point — validate its effect-size assumptions against literature.
2. **Contrast vs polarity separability** (§2.1) — can the 8-condition design identify both, or is a
   contrast-matched / expanded design needed?
3. **EAR thresholds** (0.60/0.75 × baseline) and the **incomplete-blink** operationalisation — are
   these the right literature-grounded cut-points, and is the depth-based tiering valid for CVS?
4. **PERCLOS without an IR eye-tracker** — is the self-normalised openness estimate defensible, and
   is the P80/P70 + 500 ms long-closure thresholding standard?
5. **CVS-Q recode/scoring** and the **5-item VAS** — confirm against the validated instruments;
   should additional validated scales be added?
6. **Reading measure** — per-page floor + self-paced reading time → wpm: is this an adequate reading-
   performance operationalisation, or should eye-movement reading metrics be added?
7. **Adaptation durations** (60/120 s) and **ITI/fixation/delay** windows — confirm against
   adaptation/recovery literature.
8. **Statistical model** — is a random-intercept LMM sufficient, or are random slopes / ordinal models
   (for VAS/CVS-Q) / trial-level models warranted?

---

## 16. Decision log / changelog (provenance of refinements)
Each item below was a deliberate, verified change from the original single-file bundle. Full detail
in `spec/CONSTANTS.md` and `docs/PROTOCOL.md`.

**Scientific design**
- Passage **decoupled** from condition (rotating Latin square) — removed content confound.
- **Contrast recorded as covariate** (WCAG + Michelson + below-AA flag); colours left locked.
- **Williams** square indexed by sequential enrolment (was an ID hash → unbalanced).
- **Colour-vision screening** added and ordered **after** night-shift-off preflight.
- **Validated CVS-Q** (baseline + end) as the primary subjective fatigue outcome.
- **Neutral RT background / target colour** unused by any condition (constant salience).
- **Adaptation** lengthened; **doubled on polarity switch**.
- **Consent** recorded at the consent stage (not pre-set true).

**Measurement correctness (audit-found bugs, fixed + regression-tested)**
- **Incomplete-blink ratio** was structurally always 0 (dead classifier branch) → depth-based tiers;
  now reachable. *(Primary CVS marker restored.)*
- **Head-pose pitch** was algebraically pinned to a constant (~+22.5°) every frame → rewritten
  against independent eye-line/chin references; **per-person frontal-pitch calibration** added.
- **Duplicate EAR sampling** on a 60 fps loop over stale landmarks → one sample per FaceMesh result;
  `effective_fps` recorded; sub-Nyquist tiers gated.
- **PERCLOS / inter-blink-interval / long-closure** added (frame-rate-robust drowsiness covariates).
- **SDT criterion** surfaced (was computed then discarded); per-condition d′ instability flagged.

**Data integrity**
- `gatherSession` fetched participant by `session_id` → every 2nd+ split sitting lost demographics;
  now by `participant_id`. **Purge** no longer deletes a participant referenced by another sitting.
- **Resume** reuses the stored `condition_id` (was minting fresh UUIDs → duplicate/orphan rows).
- **CSV** escaping quotes `\r` (was column-misalignment risk).

**Dead-documentation cleanup (fields/constants/comments that didn't do what they claimed)**
- Removed inert **flanker/congruency** schema (task is pure go/no-go); `trial_category` → `signal|noise`.
- Removed `blink_rate_delta_from_baseline` + `setBaselineBlinkRate` (never wired; column always null).
- Removed `originalStoredTargetCount` (never read), dead constants `EAR_CALIBRATION_SAMPLES` /
  `MIN_TOUCH_TARGET_PX`, and `void`-masked unused imports in the sim.
- **Wired up** what was worth keeping: `face_size_ratio` (was always 0 → real landmark bbox),
  `baseline_fatigue` (was hard-0 → propagated), `caffeine_today` / `hours_since_sleep` (now captured),
  `CONDITIONS_PER_SESSION_DEFAULT` (now the UI source), `exclusion_reason` (populated from eligibility).
- Corrected stale docs ("11 CSVs" → 14; Eriksen-flanker references → go/no-go).

---

## 17. References (as applied in the build)
- **Soukupová, T. & Čech, J. (2016).** Real-Time Eye Blink Detection using Facial Landmarks. *CVWW.*
  — the Eye-Aspect-Ratio used for blink detection.
- **Portello, J.K. & Rosenfield, M. (2013).** Computer-related visual symptoms… blink rate and
  incomplete blinking. *Optometry and Vision Science.* — reduced blink rate + raised incomplete-blink
  ratio as CVS markers.
- **Dinges, D.F. & Grace, R. (1998).** PERCLOS: A Valid Psychophysiological Measure of Alertness.
  *FHWA-MCRT-98-006.* — PERCLOS + long-closure as drowsiness measures.
- **Macmillan, N.A. & Creelman, C.D. (2005).** *Detection Theory: A User's Guide.* — d′, criterion,
  and d′ standard error.
- **Acklam, P.J.** Algorithm for the inverse normal (probit) — used in `stats.ts`.
- **W3C WCAG 2.x** — relative-luminance / contrast-ratio definitions used in `contrast.ts`.
- **(RT/PVT lapse interpretation)** Dinges & Powell PVT tradition — RT > 600 ms = lapse.
> Reviewer: please verify each citation is applied correctly and supplement with the strongest
> current sources (e.g. polarity & reading performance, CVS questionnaires validation, blink/CVS
> meta-analyses, dark-mode/contrast reading studies).

---

## 18. How to run / reproduce
```bash
npm install
npm run dev        # dev server (vendors MediaPipe first)
npm run build      # tsc + vite production PWA
npm test           # 169 unit/property tests
npm run test:e2e   # Playwright E2E (fake camera)
npm run sim        # Monte-Carlo + power analysis
npm run fuzz       # adversarial soak
npm run stress     # harsh multi-regime stress run
```
Analysis: run `src/analysis/analysis_template.{R,py}` on an exported CSV bundle (random-intercept
mixed models; contrast as covariate; d′ aggregated; engagement sensitivity analysis).

## 19. Archive contents
- `MASTER_BLUEPRINT.md` — this document.
- `ALL_SOURCE.md` — **every source file concatenated** (each under a `### path` header) for linear
  reading.
- The full project tree: `src/`, `tests/`, `e2e/`, `docs/`, `spec/`, `scripts/`,
  `src/analysis/`, config files (`package.json`, `tsconfig*`, `vite.config.*`, `vitest.config.ts`,
  `playwright.config.ts`, `.eslintrc.cjs`, `tailwind`/`postcss`), `README.md`, and
  `reference/BUILD_KNOWLEDGE.md` (the original developer's architecture log / parity oracle).
- **Excluded** (not build logic / large binaries): `node_modules/`, `dist/`, `.git/`,
  `public/mediapipe/` (vendored third-party assets), `reference/VisuLab210_2.html` (the original
  compiled single-file bundle), `package-lock.json`, `*.tsbuildinfo`.

---

## 20. Reviewer brief — YOUR TASK (read and follow this)

You are a senior peer reviewer and methodologist for a PhD-level human-vision / visual-ergonomics
study. You have been given the complete specification (this document) and the full source code
(`ALL_SOURCE.md`). **Your job is to REVIEW against the scientific literature — not to build.**
Do **not** write, rewrite, or "fix" code, and do not produce an implementation. If you propose a
change, describe it in prose with justification and citations — never as code to ship.

### Method (do these in order and show your work)
1. **Ingest & confirm.** Read this document and all the source in full. Confirm what you can see
   (file/line counts, the subsystems) so it's clear nothing was truncated. Restate the study's aim,
   hypotheses, and design in your own words to prove comprehension.
2. **Extract every testable claim** — the scientific choices, parameters, formulae, thresholds and
   stated rationales (e.g. EAR blink thresholds 0.60/0.75×baseline; incomplete-blink ratio as a CVS
   marker; PERCLOS P80/P70 + 500 ms long-closure; d′/criterion scoring; WCAG/Michelson contrast;
   Williams counterbalancing; CVS-Q recode/cutoff; the 5-item fatigue VAS; reading-time→wpm;
   adaptation 60/120 s; go/no-go RT, 32 trials, 0.625 go-rate; per-person head-pitch calibration; the
   contrast↔polarity confound in §2.1; sample-size/power).
3. **Search the literature actively for each claim** (use web search if available). Find the
   strongest, most current, authoritative sources (peer-reviewed papers, validated-instrument
   references, standards, meta-analyses). For each claim state whether the literature **supports,
   partially supports, contradicts, or is silent**, and cite specific sources (authors, year, venue;
   DOI/identifier where possible). Flag citations that are misapplied, outdated, or weaker than what
   is available. Do **not** invent references — if unsure a citation is real, say so.
4. **Compare claim vs build vs literature.** Where the implementation diverges from best practice,
   say so precisely, explain the consequence for validity/reliability/interpretability, and rate
   severity.
5. **Stress the design logic** (not just citations): confounds — especially contrast not balanced
   across polarity (§2.1); counterbalancing adequacy; statistical-model choice (random-intercept LMM
   — should there be random slopes / ordinal models for VAS & CVS-Q / trial-level models?); and
   **statistical power / sample size** for plausible effect sizes (critique the build's own power
   assumptions).
6. **Give special attention to §15 (Open questions) and §14 (Known limitations)** — these are where
   the author most wants your judgment.

### Deliverables (structured, detailed, elaborate)
- **A. Executive assessment** — overall scientific-integrity verdict and the top 5 issues ranked by
  impact on the defensibility of the findings.
- **B. Subsystem-by-subsystem audit** — for each of: experimental design & counterbalancing; display
  conditions & contrast; the four tasks (reading, comprehension, visual search, reaction time);
  ocular metrics (EAR / blink / incomplete-ratio / PERCLOS / IBI); head-pose & gaze; questionnaires
  (CVS-Q & VAS); Ishihara screening; SDT scoring; data model & analysis pipeline; engagement/QC;
  power & sampling — give a **rating** (e.g. 1–5 or strong/adequate/weak), what's right, what's
  flawed, the relevant literature with citations, and concrete suggestions.
- **C. Validity & confounds register** — every threat to internal/external/construct validity, with
  severity and mitigation options.
- **D. Literature map** — a referenced bibliography grouped by topic, noting which build claims each
  source supports or challenges.
- **E. Prioritised improvement plan** — sequenced and actionable (must-fix → should-fix →
  nice-to-have), each item justified by evidence. **Description only — no code.**

### Standards
Maintain the highest scientific rigor. Distinguish clearly between (a) what the literature firmly
establishes, (b) reasonable-but-contested choices, and (c) your own opinion. Cite sources for
substantive claims. Call out anywhere the build **overstates** fidelity or certainty. Be specific
(reference blueprint sections and file/function names). Be exhaustive; this is a formal
methodological review, not a summary.

> Suggested pacing if your replies get cut off: deliver **A + B** first, then continue with
> **C, D, E** in follow-up replies.
