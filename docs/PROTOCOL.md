# VisuLab — Experimental Protocol & Workflow Logic Review

This document describes the data-collection protocol **as implemented**, the scientific rationale
for each stage, the workflow-logic cross-check (and the issues it fixed), how a researcher runs a
session, and the known limitations a PhD write-up should disclose.

---

## 1. Design

- **Within-subjects, 8 conditions** = 2 polarity (light/dark background) × 4 text colour
  (achromatic / blue / red / yellow). Hex values are locked; contrast differs across conditions and
  is recorded as a covariate (see §5).
- **Condition order**: balanced Williams Latin square, assigned by a **sequential enrolment index**
  (controls first-order carryover; every condition appears in every serial position equally over
  each block of 8 participants).
- **Passage assignment**: rotated independently of condition (each condition meets each passage
  equally over a block of 8) so passage difficulty is **orthogonal to display condition**.

## 2. Session flow (as implemented)

```
SESSION_INIT            researcher: participant ID, ambient lux, (optional) screen luminance + brightness
  → CONSENT             participant: informed consent (recorded here, not pre-emptively)
  → PARTICIPANT_PROFILE demographics + vision covariates (age 18–80, correction, self-report CVD…)
  → PREFLIGHT           researcher: display/room configured (brightness fixed, night-shift OFF, …)
  → COLOR_VISION        digital Ishihara screening (runs AFTER night-shift is off)
  → CAMERA_SETUP        webcam permission (or skip → no eye tracking)
  → CALIBRATION         9-point gaze calibration + EAR baseline (camera path) / positioning check
  → CVSQ_BASELINE       validated CVS-Q (16 items)
  → BASELINE_FATIGUE    5-item VAS baseline
  → [×8 conditions]
        READING_TASK        per-page minimum dwell, self-paced; eye-tracking window
        → COMPREHENSION     1×4-option MCQ (accuracy + RT)
        → VISUAL_SEARCH     tap every target word, 40 s limit
        → REACTION_TIME     Eriksen colour-flanker go/no-go, neutral-grey background
        → DISPLAY_PERCEPTION comfort + clarity (rated AFTER the performance tasks)
        → POST_FATIGUE       5-item VAS (rated AFTER all tasks → reflects full exposure)
        → ADAPTATION         60 s neutral grey (120 s when polarity switches)
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
| 3 | "Post-condition" fatigue/perception were rated **mid-condition** (before search & RT). | DISPLAY_PERCEPTION + POST_FATIGUE moved to the **end** of each condition. |
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
   baseline questionnaires. The participant then completes the 8 conditions (~60–90 min).
4. At the end, open the session from the manager → **Export** the CSV + JSON bundle.
5. Analyse with the **mixed-model templates** in `src/analysis/analysis_template.{R,py}` (random
   intercept per participant; contrast as a covariate; d′ aggregated across conditions).

## 6. Known limitations to disclose

- **Webcam eye tracking** is lower-fidelity than IR (spatial error ~3–5°; ~15 fps effective). Blink
  micro/partial tiers are sub-Nyquist and flagged; **full-blink rate + incomplete-blink ratio** are
  the defensible metrics. Blink rate is **non-monotonic** w.r.t. fatigue (drops with concentration,
  rises with fatigue onset) — interpret with the within-task bins, not as "higher = more fatigued".
- **Gaze** is only meaningful when calibration was valid (`gaze_calibrated:true`); otherwise treat
  as a gross head-movement proxy.
- **Contrast confound**: C4 (yellow-on-white) is below WCAG AA (2.39:1); treat WCAG ratio as a
  covariate or reframe as polarity × contrast.
- **Per-condition d′** rests on ~24 signal trials (unstable; SE often > 0.3) — report aggregated d′.
- **Session length** (~60–90 min) accumulates fatigue; `session_position` is recorded as a covariate.
- The **Ishihara screening** is a digital screening aid, not a clinical diagnosis.
