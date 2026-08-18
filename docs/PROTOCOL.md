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


---

## Media capture — consented, off by default

The instrument's default is that no image or video leaves the frame buffer: the camera produces
numeric ocular measures and the pixels are discarded. Two things need pixels, and each is a
**separate, optional grant** on the consent screen, defaulting to OFF:

| Grant | What it permits | Why it exists |
|---|---|---|
| `camera_metrics` | Numeric blink / head-pose measures. No pixels stored. | The ocular outcomes. Refusable — §3.10 requires it. |
| `setup_photos` | One still at session start, one at session end. | Documents seating distance and room lighting, so setup compliance is evidenced rather than asserted. |
| `annotation_video` | One 3-minute reading segment per session. | Objective 4 cannot be met without video a human can code frame by frame. Validation subsample only. |

Enforcement is in `src/storage/media.ts`, not the UI:

- `mayCapture()` is checked against the **persisted** session record immediately before every
  capture, so a withdrawn grant takes effect at once and a stale component cannot capture.
- No grant implies another. A photo grant does not authorise video; the `camera_metrics` grant does
  not authorise retaining pixels at all. Tests assert each of these separately.
- Every stored item carries a `consent_snapshot`, so a file can never be separated from the
  permission under which it was made.
- Media lives in its own `media_captures` store and is deletable independently of the research
  data, so withdrawing media consent later does not force discarding the numeric dataset.
- `15_media_inventory.csv` lists every retained file with an FNV-1a checksum over its bytes.
- A capture that fails, or finds no frame yet, is a silent no-op. A black placeholder is never
  stored as "proof", and a media failure never aborts a session.

## Timing and the feasibility gate

`scripts/simulateParticipant.ts` models one sitting for the target population (university students
aged 20–24), reading every app-controlled duration from the real `CONFIG`. Participant-controlled
durations are drawn from distributions with a stated basis — reading rate anchored below
Brysbaert's (2019) meta-analytic 238 wpm for dense expository prose, blink rate 13/min during
reading, and two participant-level multipliers so a slow, careful participant is slow throughout
rather than independently slow at each step.

Result over 2,000 simulated participants: **median 75 min, p95 90 min, p99 96 min** — the
120-minute gate passes with margin, and no simulated participant exceeded it.

Where the time goes: adaptation 14.0 min (18.6%), reading 12.1 min (16.1%), RT blocks 10.9 min
(14.5%), visual search 4.8 min, CVS-Q ×2 6.4 min. Polarity switching costs ~5 min per sitting on
top of the baseline adaptation, since a Williams row averages 5 switches over 9 transitions.

**Open issue — reading exposure and the precision of the primary outcome.** At ~73 s of reading per
condition the camera captures only ~16 blinks, so the incomplete-blink ratio for that condition has
a standard error of about 0.09 (±18 percentage points at 95%). The synopsis's own validation
sub-study assumes **3-minute** reading segments, which the current ~245-word passages cannot fill.
Raising reading exposure to 180 s costs ~20 min per sitting (median 93 min, still inside the gate)
and needs passages of roughly 650 words. Until that is done, `12_quality_flags.csv` carries
`blink_count_total` and `insufficient_blinks` so a thin exposure window can never be mistaken for a
clean null.

---

## Data-integrity guarantees and how to re-check them

Six rounds of stress testing found sixteen defects, every one of the same species: **a function
returning a plausible number where it had no measurement**. Each was invisible downstream, because
the output was indistinguishable from a real reading. The worst examples:

- a camera dropout made the EAR baseline NaN, every threshold comparison false, and so **zero
  blinks detected — reported as an incomplete-blink ratio of 0**, the cleanest possible value for
  the study's primary outcome, manufactured from nothing;
- a duplicate `condition_id` made two different display conditions export the **same** blink rates,
  reaction times and ratings, with correct row counts and every cell populated;
- `d'` was reported as 1.38 for a reaction-time block containing **no signal trials at all**;
- head pose reported **0 degrees — "perfectly level"** — for frames whose geometry was never
  measurable, biasing the postural summary toward good posture exactly where tracking struggled.

The rule those fixes now share is stated once and enforced by `tests/noFabrication.test.ts`:

> Given input carrying no information about a quantity, a function must report the absence — null,
> or a non-finite value its consumer is documented to filter — and must never return a value that
> reads as a measurement.

Zero is the dangerous case throughout: zero blinks incomplete, zero degrees of pitch, zero
sensitivity and zero face size are all substantive claims an analyst will average alongside real
values, and none of them means "not measured".

### Commands

| Command | What it checks |
|---|---|
| `npm test` | 296 unit tests, including the no-fabrication contract |
| `npm run stress` | Six stress rounds, ~11,500 assertions |
| `npm run verify:export` | Prints every exported table and traces 366 cells back to source |
| `npm run simulate:timing` | Session-length distribution for the target population |
| `npx playwright test` | Six end-to-end specs through the full protocol |

### What the export now guarantees

- **Reproducible.** The same data always produces the same bytes, so the manifest's per-file
  checksums identify content. Record order is normalised at the boundary; the export timestamp
  lives in the manifest, not in the data.
- **Self-auditing.** `16_integrity_report.csv` states whether the joins in that dataset can be
  trusted, and `export_manifest.json` carries `integrity.joins_sound`. Faults are reported, never
  silently repaired — de-duplicating quietly would hide the bug that produced the duplicate.
- **Documented.** `00_CODEBOOK.csv` gives the type, unit, role and meaning of every column, and a
  test asserts it cannot drift from the writer.
- **Free of non-finite values.** Anything non-finite is written as the empty missing-marker and
  counted in `export_manifest.json` as `non_finite_cells`, so an upstream fault stays visible
  rather than becoming `NA` in R.
