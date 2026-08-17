# VisuLab — Experimental Protocol & Workflow Logic Review

This document describes the data-collection protocol **as implemented**, the scientific rationale
for each stage, the workflow-logic cross-check (and the issues it fixed), how a researcher runs a
session, and the known limitations a PhD write-up should disclose.

---

## 1. Design

- **Within-subjects crossover (split-plot), 10 conditions × 2 illumination levels = 20 condition-runs**
  = 2 polarity (light/dark background) × 5 text colour (achromatic, blue, red, yellow, green),
  each block run under one ambient illumination level (dim ≈10 lux / moderate ≈150 lux). Polarity
  and colour vary WITHIN a session; illumination is the session-level (whole-plot) factor, with
  its order counterbalanced between participants. Legacy note: the build previously ran 4 text
  colours and a single researcher-chosen illumination level
  (achromatic / blue / red / yellow). Hex values are locked; contrast differs across conditions and
  is recorded as a covariate (see §5).
- **Condition order**: balanced Williams Latin square, assigned by a **sequential enrolment index**
  (controls first-order carryover; every condition appears in every serial position equally over
  each block of 8 participants).
- **Passage assignment**: rotated independently of condition (each condition meets each passage
  equally over a block of 8) so passage difficulty is **orthogonal to display condition**.

## 2. Session flow (as implemented)

```
SESSION_INIT            researcher: participant ID, ambient lux, (optional) screen luminance + brightness,
                        session structure (single 8-condition sitting, or split 4+4)
  → CONSENT             participant: informed consent (recorded here, not pre-emptively)
  → PARTICIPANT_PROFILE demographics + vision covariates (age 18–80, correction, self-report CVD…)
  → PREFLIGHT           researcher: display/room configured (brightness fixed, night-shift OFF, …)
  → COLOR_VISION        digital Ishihara screening (runs AFTER night-shift is off)
  → CAMERA_SETUP        webcam permission (or skip → no eye tracking)
  → CALIBRATION         9-point gaze calibration + EAR baseline + per-person frontal-pitch baseline
                          (head frontal during calibration → pitch zero) / positioning check
  → CVSQ_BASELINE       validated CVS-Q (16 items)
  → BASELINE_FATIGUE    5-item VAS baseline
  → INSTRUCTIONS        participant overview of the per-condition tasks
  → [×10 conditions per illumination block]
        READING_TASK        intro → passage (self-paced beyond a per-page floor); exposure +
                            eye-tracking window; reading time → words/min recorded
        → COMPREHENSION     1×4-option MCQ (accuracy + RT)
        → DISPLAY_PERCEPTION comfort + clarity, rated IMMEDIATELY after reading (perception fresh)
        → POST_FATIGUE       5-item VAS, immediately after the strongest fatigue inducer (reading)
        → VISUAL_SEARCH     intro → tap every target word, 40 s limit (selective attention)
        → REACTION_TIME     pure colour go/no-go (one dot at a RANDOM screen location each trial;
                            respond only to the target colour) — reports RT mean/median/SD/CV,
                            omission & commission errors, d′. (Pure go/no-go by design — no flanker
                            congruency manipulation; the simulation models the same go/no-go task.)
        → ADAPTATION         60 s neutral grey (120 s when polarity switches)
        → BREAK_SCREEN       self-paced rest after every 2 conditions (CONFIG.BREAK_EVERY_N_CONDITIONS);
                             neutral "X of N done", no performance feedback; never after the last
  → CVSQ_END            validated CVS-Q again (Δ from baseline = primary validated fatigue outcome)
  → SESSION_COMPLETE    thank-you; session marked complete
  → EXPORT_DASHBOARD    researcher: charts, QC, CSV/JSON export
```

Progress bar tracks 8 setup steps + 8×6 measured sub-stages = **56 steps**.

## 3. Workflow-logic cross-check — issues found & resolved

Reviewing the sequence as a PhD data-collection protocol surfaced these logic flaws (all fixed):

| # | Issue | Resolution |
|---|---|---|
| 1 | `consent_given` was written **true at session creation**, before the participant consented. | Consent is now recorded at the CONSENT stage (`consent_given:false` until then). |
| 2 | Colour-vision screening ran **before** the pre-flight checklist that disables night-shift; a blue-light filter invalidates red-green plates. | PREFLIGHT now precedes COLOR_VISION. |
| 3 | Order of the subjective ratings. | Per the author's framework (reading is the exposure + strongest fatigue inducer; perception must be captured fresh), the preference rating and fatigue VAS are collected **immediately after reading**, then search and reaction follow. (An interim build had moved them to the end; reverted to match the design.) |
| 4 | Rapid double-tap could create **duplicate sessions** / **skip a stage**. | Re-entry guard on session creation + an `advance()` transition lock; scales/screening guard double-submit. |
| 5 | Interruption mid-session lost progress. | Condition-level resume pointer; an interrupted condition is **restarted** (not stitched) for data integrity. |
| 6 | Stale local session state reverted `preflight_complete` on the final write. | Local session state is refreshed after each session update. |

Earlier scientific-audit fixes also baked in: passage↔condition decoupling, colour-vision screening,
real gaze calibration, neutral RT background, longer adaptation on polarity switch, FPS-gated blink
tiers, validated CVS-Q, contrast-as-covariate, provenance stamping. See `spec/CONSTANTS.md`.

## 4. Data integrity

- Every measure is written to IndexedDB immediately (no buffering); a crash loses at most the
  in-progress condition, which is flagged (`completed_at: null`) and restarted on resume.
- Each session/export is stamped with app version, git hash, condition-definition hash and schema
  version; the export manifest carries per-file checksums.
- Soft-delete uses a 30-day recycle bin (restore/auto-purge); permanent purge cascades to all child
  records.

## 5. Running a session (researcher)

1. **Enter Research Console → New Session.** Enter participant ID, measured ambient lux, and
   (recommended) white-screen luminance in cd/m² + locked brightness %.
2. Obtain **consent**; complete the **profile** and **pre-flight checklist** (fix brightness, turn
   **off** auto-brightness and night-shift/blue-light filter, clean screen, ~50–60 cm distance,
   landscape, no backlight).
3. Run **colour-vision screening**, allow the **camera**, complete **calibration**, then the
   baseline questionnaires. The participant then completes the 10 conditions of the assigned
   illumination block (~60–120 min), closing with the end CVS-Q and NASA-TLX.
4. At the end, open the session from the manager → **Export** the CSV + JSON bundle.
5. Analyse with the **mixed-model templates** in `src/analysis/analysis_template.{R,py}` (random
   intercept per participant; contrast as a covariate; d′ aggregated across conditions).

## 6. Known limitations to disclose

- **Webcam eye tracking** is lower-fidelity than IR (spatial error ~3–5°). It now samples one EAR
  reading **per FaceMesh result at ~30 fps** (the literature minimum for blink detection; an earlier
  build sampled stale landmarks on a 60 fps render loop, duplicating samples and overstating fps).
  `effective_fps` records the true achieved rate and gates the duration-based tiers.
- **Blink metrics distinguish two constructs.** For **visual/ocular fatigue (CVS — this study)** the
  validated markers are a **reduced blink rate** and a **raised incomplete-blink ratio** (Portello &
  Rosenfield, *Optom Vis Sci* 2013), read with the within-task first/second-half bins and inter-blink
  interval. For **drowsiness/sleepiness** (a confound over a 60–90 min session) **PERCLOS** (% time
  eyes ≥70/80% closed) and **long-closure events** are the validated, frame-rate-robust covariates
  (Dinges & Grace, FHWA 1998). Blink rate is **non-monotonic** w.r.t. fatigue (drops with
  concentration/reading, rises with sleepiness) — never read "higher = more fatigued" in isolation;
  triangulate the blink markers with the subjective CVS-Q. Blink **duration** and the micro/partial
  tiers are sub-Nyquist below ~25 fps and flagged as diagnostics only. Webcam EAR is a
  **screening-grade** proxy; an IR eye-tracker remains the reference standard for definitive data.
- **Gaze** is only meaningful when calibration was valid (`gaze_calibrated:true`); otherwise treat
  as a gross head-movement proxy.
- **Head pitch** (`head_pitch_mean`) is reported relative to each participant's own frontal posture,
  captured at calibration (`head_pitch_calibrated:true`; baseline fraction in `01_session_info.csv`).
  This removes inter-individual face-geometry bias so 0° = that person's straight-ahead. The deg-per-
  unit slope is still a monocular proxy (no depth sensor), so treat pitch magnitude as approximate and
  prefer within-person change. When uncalibrated, a population default zero is used.
- **Contrast confound**: C4 (yellow-on-white) is below WCAG AA (2.39:1); treat WCAG ratio as a
  covariate or reframe as polarity × contrast.
- **Per-condition d′** rests on ~20 signal (go) trials of 32 (unstable; SE often > 0.3) — report aggregated d′.
- **Session length** (~60–90 min) accumulates fatigue; `session_position` (0–7) is recorded as a covariate.

## 7. Boredom / disengagement vs. fatigue

The session repeats the same 4-task loop ×8, so **boredom and disengagement accumulate with
time-on-task and mimic visual fatigue** — slower and more variable RT, attention lapses, careless
or straight-lined ratings, and skim-reading. Left unaddressed this adds noise (lowers power), risks
careless data contaminating the fatigue/comprehension measures, and risks dropout. The Williams
square already balances serial-position effects out of the *group-level* condition contrast; these
additional measures target the *data-quality* and *participant-experience* problem directly.

**Detection (so suspect data can be excluded or modelled, not silently trusted).** Each condition
gets an **engagement flag** (`good`/`warn`/`bad`) and a 0–1 `quality_score` composed from existing
signals plus newly recorded questionnaire response times: reading **skim** (reading faster than the
word-count ÷ 400 wpm floor), **rushed** fatigue/perception ratings, **straight-lined** fatigue
ratings, RT **disengagement** (high false-alarm/error/lapse rate), a wrong comprehension answer, and
low camera face-presence. Exported in `10_wide_summary.csv` (`engagement_flag`, `quality_score`) and
the dedicated **`12_quality_flags.csv`** (per-signal booleans + reasons). The analysis templates run
a **sensitivity analysis**: fit on all data and on the clean subset (drop `bad`); agreement means
disengagement is not driving the result.

**Reduction (without biasing the data).** A neutral progress readout ("Condition X of N", rough time
remaining) and a **self-paced rest break after every 2 conditions** reduce monotony. Crucially there
is **no gamification or performance feedback** — telling participants their scores would
differentially change effort across conditions and confound the display manipulation.

**Methodology (shorten each sitting).** The session can be **split** (4 conditions per sitting, a
later sitting for the remaining 4). The participant's enrolment number — which drives the Williams
order — is **reused across sittings**, and the next sitting resumes at the global serial position
where the last stopped, so each condition is still run exactly once. `session_index` (sitting
number) is recorded and added as a covariate when sittings vary; baseline fatigue and CVS-Q are
re-measured each sitting (fatigue resets between sittings — documented, not assumed away).
- The **Ishihara screening** is a digital screening aid, not a clinical diagnosis.
