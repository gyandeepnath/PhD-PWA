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
| C1 | #FFFFFF | #000000 | positive | black | 21.0 | AAA |
| C2 | #FFFFFF | #1E4ED8 | positive | blue | 6.70 | AA |
| C3 | #FFFFFF | #C81E1E | positive | red | 5.74 | AA |
| C4 | #FFFFFF | #C9A400 | positive | yellow | **2.39** | **Fail** |
| C5 | #000000 | #FFFFFF | negative | white | 21.0 | AAA |
| C6 | #000000 | #1E4ED8 | negative | blue | 3.14 | AA Large |
| C7 | #000000 | #C81E1E | negative | red | 3.66 | AA Large |
| C8 | #000000 | #C9A400 | negative | yellow | 8.79 | AAA |

Contrast is auto-computed (`src/lib/contrast.ts`) and stored per condition as an analysis
covariate. C4/C6/C7 are below AA and flagged in the codebook.

## Counterbalancing
- Williams balanced Latin square, first row `[0,1,7,2,6,3,5,4]` (N=8). Row = `(enrolment−1) % 8`.
- **Enrolment number is a sequential index** assigned at session creation (NOT a hash of the
  arbitrary participant ID — the late builds' hashing broke balance).
- Passage decoupled: `passage(condition, p) = (conditionIndex + (p−1) % 8) % 8` → every
  condition meets every passage once per block of 8 participants. (Original build yoked
  `passage = conditionIndex`, a confound.)

## Stage machine
`SESSION_INIT → PARTICIPANT_PROFILE → CAMERA_SETUP → CALIBRATION → BASELINE_FATIGUE →`
`[×8: READING_TASK → COMPREHENSION → DISPLAY_PERCEPTION → POST_FATIGUE → VISUAL_SEARCH →`
` REACTION_TIME → ADAPTATION] → SESSION_COMPLETE → EXPORT_DASHBOARD`
Progress: 4 setup steps + 8×6 = 52 tracked steps.

## Task constants (⚠️ VERIFY against bundle while porting)
| Constant | Bundle value | Doc value | Plan (refined) |
|---|---|---|---|
| Reading | per-page ~20 s minimum-unlock (rAF) | 120s min/180s max (stale config) | floor, self-paced beyond; record `reading_time_ms`/wpm |
| Passages | 8 science topics, ~274–292 words, 2 pages | same | decouple from condition |
| Comprehension | 1×4-option MCQ, RT recorded, 1 s feedback | same | persist record (was a fixed bug) |
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

We use the actual count as `searchTargetCount` (original kept as `originalStoredTargetCount` for
provenance). Counts are unequal across passages (2–13) but passage↔condition decoupling makes this
orthogonal to condition (noise, not bias). Rebalancing target words to a tighter 6–11 range is an
optional follow-up the researcher can opt into.
| RT (flanker) | 48 trials, Eriksen colour flanker | 48; target red `#C81E1E`, distractors blue/yellow/green | render on fixed `#808080`; report d′ + SE |
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
11 CSVs + JSON bundle + master codebook. Fix stale `count!==20` validation → use configured
trial count. Add per-export manifest: schema version, app version, git hash, condition-def hash,
checksums.

## Scoring formulae (verified)
- Composite fatigue = mean of 5 VAS items (eye_strain, dryness, blur, burning, headache), 0–10.
- d′ = Φ⁻¹(hit_rate) − Φ⁻¹(false_alarm_rate), Acklam probit, inputs clamped [0.001, 0.999].
- FCE = mean_RT(incongruent hits) − mean_RT(congruent hits).
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
