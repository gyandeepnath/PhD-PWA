# VisuLab — Extracted Constants & Source-of-Truth Spec

Authoritative constants reverse-engineered from the compiled bundle
(`reference/VisuLab210_2.html`) and the developer log (`reference/BUILD_KNOWLEDGE.md`).
Where the two disagree, the **compiled bundle wins** (it is the latest build); such items are
tagged ⚠️ VERIFY and should be re-confirmed against the bundle as each module is ported.

## Theme (reproduce faithfully — do not alter the start-page look)
- Surface/background: `#F8F7F5` (cream); `theme-color` `#F8F7F5`.
- Fonts: **DM Mono** (`font-lab`, monospace), **Roboto** (body), **Georgia** serif (titles).
- Animation: `fadeIn` 0.35s ease-out (`animate-fade-in`).
- Scaling: `--vl-scale` transform-scale on `#root` (origin top-left; inverse width/height).
- Legacy dark `lab-*` palette (error boundary / legacy surfaces): bg `#0a0a12`, surface
  `#12121e`, border `#1e1e35`, accent `#4f8ef7`, success `#22c97a`, warning `#f5a623`,
  danger `#e64c4c`, muted `#5a5a7a`, text `#d4d4e8`, bright `#ffffff`.
- Frosted card: `rgba(255,255,255,0.55)` + `blur(8px)`. WavyBackground opacity 0.03–0.11.

## Conditions (LOCKED hex — never change)
| Label | Bg | Text | Polarity | Colour | WCAG ratio | Level |
|---|---|---|---|---|---|---|
| P1 | #FFFFFF | #000000 | positive | achromatic | 21.00 | AAA |
| P2 | #FFFFFF | #1E4ED8 | positive | blue | 6.70 | AA |
| P3 | #FFFFFF | #C81E1E | positive | red | 5.74 | AA |
| P4 | #FFFFFF | #C9A400 | positive | yellow | 2.39 | Fail |
| P5 | #FFFFFF | #00A651 | positive | green | 3.19 | AA Large |
| N1 | #000000 | #FFFFFF | negative | achromatic | 21.00 | AAA |
| N2 | #000000 | #1E4ED8 | negative | blue | 3.14 | AA Large |
| N3 | #000000 | #C81E1E | negative | red | 3.66 | AA Large |
| N4 | #000000 | #C9A400 | negative | yellow | 8.79 | AAA |
| N5 | #000000 | #00A651 | negative | green | 6.57 | AA |

Contrast is auto-computed (`src/lib/contrast.ts`) and stored per condition as an analysis
covariate. C4/C6/C7 are below AA and flagged in the codebook.

## Counterbalancing
- Williams balanced Latin square, first row `[0,1,9,2,8,3,7,4,6,5]` (N=10). Row = `(enrolment−1) % 10`.
- **Enrolment number is a sequential index** assigned at session creation (NOT a hash of the
  arbitrary participant ID — the late builds' hashing broke balance).
- Passage decoupled: `passage(condition, p) = (conditionIndex + (p−1) % 10) % 10` → every
  condition meets every passage once per block of 10 participants. (Original build yoked
  `passage = conditionIndex`, a confound.)

## Stage machine
`SESSION_INIT → PARTICIPANT_PROFILE → CAMERA_SETUP → CALIBRATION → BASELINE_FATIGUE →`
`[×10: READING_TASK → COMPREHENSION → DISPLAY_PERCEPTION → POST_FATIGUE → VISUAL_SEARCH →`
` REACTION_TIME → ADAPTATION] → SESSION_COMPLETE → EXPORT_DASHBOARD`
Progress: 4 setup steps + 10×6 = 64 tracked steps. (COMPREHENSION remains ONE tracked step even
though it administers three items, because the three run inside a single stage.)

## Task constants (⚠️ VERIFY against bundle while porting)
| Constant | Bundle value | Doc value | Plan (refined) |
|---|---|---|---|
| Reading | per-page ~20 s minimum-unlock (rAF) | 120s min/180s max (stale config) | floor, self-paced beyond; record `reading_time_ms`/wpm |
| Passages | 8 science topics, ~274–292 words, 2 pages | same | **10 topics, ~584 words, 4 pages** — length sets the reading exposure and therefore the precision of the primary outcome; decoupled from condition |
| Comprehension | 1×4-option MCQ, RT recorded, 1 s feedback | **NO feedback** — see below | **3×4-option MCQ per passage** (gist, inference, detail), each timed from its own mount; one stored row per ITEM, so a per-condition join must aggregate |
| Visual search | 40 000 ms limit | 60s (doc) / 120s (config) ⚠️ | use ACTUAL occurrence count (see below); record as covariate |

### Visual-search target counts — bundle bug (fixed)
The bundle stored a hand-authored `target_count` per passage that does **not** match the actual
occurrences in the passage text (tokenised: strip non-letters, lowercase, exact match), so the
original `accuracy_rate = found/target_count` was miscalibrated. Authoritative computed counts:

| Passage | target | stored (wrong) | actual |
|---|---|---|---|
| P0 | carbon | 8 | 12 |
| P1 | ocean | 8 | 7 |
| P2 | immune | 7 | 6 |
| P3 | eruption | 6 | 3 |
| P4 | sleep | 9 | 13 |
| P5 | forest | 7 | 2 |
| P6 | plate | 9 | 5 |
| P7 | light | 10 | 11 |

We use the actual count as `searchTargetCount` (the original mismatched values are noted in the
`passages.ts` source comment for provenance, not carried as a data field). Counts are unequal across
passages. They were unequal across passages (2–13), which made accuracy_rate incomparable between a
2-target and a 13-target passage; the rebalancing is **done**, and the set now runs 8–14 with
`npm run verify:corpus` enforcing the band.
| RT (go/no-go) | implemented: 32 trials, go-rate 0.625, target GREEN `#00A651`, distractors red/blue/yellow | (no flanker manipulation) | **target is ACHROMATIC and background-relative** (black on light fields, white on dark), since green became a text colour and would otherwise collide with conditions P5/N5; render on the condition background; report d-prime + SE + criterion |
| RT windows | resp ~1500, fix ~400–600, delay ~800–1500, ITI ~400–700 ms ⚠️ | resp 3000, fix 500–1000, delay 1000–3000, ITI 800–1200 ⚠️ | confirm from bundle, make configurable |
| Adaptation | 20 000 ms `#808080` | same | 60 s same-polarity / 120 s on polarity switch |
| Camera | 1280×720 @30fps, process every 2nd frame (~15fps) ⚠️ | 640×480 @30fps ⚠️ | record effective FPS; gate blink tiers ≥25fps |
| EAR | thr 0.22; adaptive baseline = 90th pct of 150 samples; tiers 0.60/0.75/0.88×baseline ⚠️ | thr 0.20, 2 consec frames, valid 50–500 ms ⚠️ | full-blink + incomplete-ratio primary |
| Gaze | center threshold 0.15–0.18; 9-zone grid | calibration stores hardcoded zeros (fake) | real calibration OR drop gaze-zone analysis |
| Head pose | off-axis pitch>12°, yaw>8° | same | raise to pitch≥20°, yaw≥15°; smooth; continuous |

EAR landmarks — left `[33,160,158,133,153,144]`, right `[362,385,387,263,373,380]`;
EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2·‖p1−p4‖).

## Storage (IndexedDB `VisualErgonomicsDB`, v5 → refined v6)
Stores: participants, sessions, conditions, reaction_trials, visual_search, eye_metrics,
fatigue_scores, display_perception, calibration_data, comprehension_results,
system_performance_logs. v6 adds: covariates (cvd_status, correction, numeric screen hours,
caffeine, sleep), `passage_id`, photometry (white cd/m², Michelson, WCAG), `effective_fps`,
within-task blink bins, consent record, provenance (app version/git hash/condition-def hash),
`session_position`, adaptation ms per transition, slider `touched` flags, CVS-Q baseline/end.

## Export
18 CSVs (00_CODEBOOK.csv among them) + analysis JSON + complete session backup + per-export manifest, 21 files in all (schema version, app version, git
hash, condition-def hash, checksums).

## Scoring formulae (verified)
- Composite fatigue = mean of 5 VAS items (eye_strain, dryness, blur, burning, headache), 0–10.
- d′ = Φ⁻¹(hit_rate) − Φ⁻¹(false_alarm_rate), Acklam probit, inputs clamped [0.001, 0.999].
- criterion (response bias) c = −0.5·(zH + zF); >0 conservative, <0 liberal.
- search_efficiency = hits / (search_seconds / 60); accuracy = (found + correct_rej)/total.
- Population SD (÷N) for frame-level descriptives (intentional).

## Simulation & power (Phase: simulation)
`npm run sim [N] [seed]` generates synthetic participants with injected ground-truth effects
(effects.ts) pushed through the real scoring code, then recovers them via OLS and runs a
Monte-Carlo power curve. Validation results (N=40, seed 20260613):
- log-contrast→RT recovered −26.8 ms/log-unit (true −28); negative-polarity +23 (true +18);
  session-position +4.0 (true +4); fatigue: position +0.36 (true 0.35), below-AA +0.88 (true 0.9).
- Mean per-condition d′ SE ≈ 0.54 (> 0.30) — confirms 24-signal-trial instability; aggregate d′
  across conditions for inference.
- Power for the log-contrast RT effect: N=8 → 0.50, **N=16 → 0.90**, N≥24 → ~1.0.
Authoritative inference uses the linear mixed models in `src/analysis/analysis_template.{R,py}`
(random intercept per participant); OLS here is only for pipeline validation.

## Setup flow (updated) & screening (Phase: start panel/consent/colour-vision/CVS-Q)
Setup chain: SESSION_INIT → CONSENT → PARTICIPANT_PROFILE → COLOR_VISION → PREFLIGHT →
CAMERA_SETUP → CALIBRATION → CVSQ_BASELINE → BASELINE_FATIGUE → [×8 loop] → CVSQ_END →
SESSION_COMPLETE → EXPORT_DASHBOARD. Tracked steps = 8 setup + 8×6 = 56.
- Consent: informed-consent gate (no-video statement, withdrawal, voluntary).
- Colour-vision: digital Ishihara SCREENING (dot-mosaic plates via 5×7 font mask; control plate +
  5 red-green confusion plates; status normal/screen_failed/inconclusive). Honestly framed as a
  screening aid, not diagnostic; result stored on participant (ishihara_correct/total, cvd_status).
- CVS-Q (Seguí 2015): validated 16-item freq×intensity, recode 0/1/2, cutoff ≥6; at baseline + end.
- Pre-flight: 7-item researcher checklist (brightness/auto-brightness/night-shift/clean/lux/lenses/
  backlight/distance) gating session start; sets preflight_complete.
Deferred to a later phase: session manager + 30-day soft-delete bin (researcher convenience, not a
validity item).

## Offline + E2E (Phase: self-hosted MediaPipe + Playwright)
- MediaPipe FaceMesh assets are vendored from node_modules into public/mediapipe/ (scripts/
  copy-mediapipe.mjs, run on predev/prebuild; gitignored). The build precaches them via Workbox
  (24 entries, ~17 MB) so eye tracking works fully offline after first load.
- `?e2e=1` collapses long timings (reading floor 150 ms, adaptation 200/300 ms, RT 4 trials/120 ms
  window) for fast automation; production timings are unchanged.
- Playwright E2E (e2e/fullRun.spec.ts) drives the entire flow on the no-camera path and asserts
  IndexedDB captured 10 conditions, 10 RT summaries, 2 CVS-Q, 11 fatigue records, 1 NASA-TLX,
  then the dashboard.
  Run: `npm run test:e2e` (uses a pre-installed Chromium when the browser download is blocked).
- StrictMode removed from main.tsx (dev double-invoke double-requested the camera / re-ran FaceMesh
  init; the original build was production with no StrictMode). Production behaviour unchanged.

## Authoritative protocol (final, post workflow cross-check)
The implemented stage order was corrected during the workflow-logic review — see
`docs/PROTOCOL.md` (authoritative). Key changes vs the original bundle order:
- Setup: SESSION_INIT → CONSENT → PARTICIPANT_PROFILE → **PREFLIGHT → COLOR_VISION** (preflight now
  before colour-vision so night-shift is off) → CAMERA_SETUP → CALIBRATION → CVSQ_BASELINE → BASELINE_FATIGUE.
- Per condition: READING → COMPREHENSION → **DISPLAY_PERCEPTION → POST_FATIGUE** → VISUAL_SEARCH →
  REACTION_TIME → ADAPTATION. The subjective ratings sit immediately after reading, while the
  impression is fresh and before the attention tasks add their own load; ADAPTATION closes the
  condition, plus once before the first, and is skipped after the last one, so it runs ten times
  across ten conditions. The pre-first field prevents adaptation state at onset from being a
  function of the first condition's own polarity.
- Consent recorded at the CONSENT stage (not pre-emptively at session creation).
- Double-tap guards (session re-entry, advance lock, scale/screening submit) and condition-level
  resume (interrupted condition restarted, not stitched).

---

## Comprehension feedback: removed, deliberately

The original bundle held each answered comprehension item for one second while outlining the correct
option in green and the participant's choice in red. That constant (`COMPREHENSION_FEEDBACK_MS`) is
now **0**, and the correctness colouring is gone.

It is performance feedback, delivered thirty times a sitting and sixty across the study. The
protocol forbids it in five separate places: the synopsis rests its whole
no-differential-effort argument on its absence, the operator manual forbids the *operator* from
saying exactly what the screen was showing, and `dashboard/aggregate.ts` asserts of its own quality
flags that "nothing extra is shown to the participant (no performance feedback → no confound)". A
participant told they are failing raises effort in the conditions that follow — correlated with
their earlier luck rather than with the display — and nothing in the export recorded that it had
happened.

The marker colours were a second, independent confound: `#22c97a` is 2.16:1 against the light
backgrounds and 9.70:1 against the dark ones, so the feedback itself was 4.5x more legible in
negative polarity, and 1.48:1 against the green ink — invisible in the very condition it marked.

**Any pilot data collected with feedback enabled cannot be pooled with main-study data.**
