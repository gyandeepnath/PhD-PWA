# Analysis plan

> **PROTOCOL AMENDMENT — ambient illumination.** The dim (~10 lux) level has been withdrawn. The
> study now runs at a SINGLE ambient level of 300 lux (band 250-350), one sitting per participant,
> ten condition-runs. Everything else — the Williams order, the five text colours, both polarities,
> CVS-Q, NASA-TLX, reaction time, visual search, comprehension, fatigue and blink measurement — is
> unchanged. The design sections, the model formulae and the timing tables below have been rewritten
> for the amended protocol; any remaining reference to two sittings is either explicitly historical
> or describes the split-sitting accommodation, which is a scheduling option and not a factor. See
> `ILLUMINATION_AMENDMENT.md` for the reasoning, the verified citations and what the change costs.

What model answers which question, why that model and not a simpler one, and what would falsify
each hypothesis. Written against the columns in `analysis_long.csv`; every column named here exists
and is documented in `analysis_codebook.csv`.

**On citations.** Claims about the *design* are derived from the design itself and need no source.
Claims about the *literature* are limited to the seven records verified against PubMed in
`docs/CITATION_VERIFICATION.md` and are named as such. Statistical practice (mixed models, binomial
error, contrast coding) is stated as methodology, not attributed. Nothing here cites a paper that
has not been resolved to a real record.

---

## 1. What kind of design this is, and why it dictates the model

Two factors, both at the same level:

| Factor | Levels | Varies |
|---|---|---|
| Display polarity | positive, negative | Within sitting |
| Text colour | 5 (achromatic, blue, red, yellow, green) | Within sitting |
| *Ambient illumination* | *300 lux, constant* | *Controlled — not a factor* |

Polarity × colour gives the 10 conditions, all run inside one sitting. Every participant contributes
10 condition-runs and is their own control for both factors, so this is a straightforward
within-subjects repeated-measures design with a single random-effect stratum: participant.

**This replaces a split-plot design and the change simplifies the analysis rather than complicating
it.** Illumination used to be a session-level (whole-plot) factor estimated on two observations per
participant while polarity and colour had twenty, which meant the illumination effect had to be
tested against a different error stratum or its standard error would be understated. That
asymmetry is gone. Both surviving factors vary within participant at the same grain, and the model
below has one random intercept instead of two nested ones.

A mixed model with a participant random intercept handles this correctly without any special
casing, which is the main reason to use one rather than a repeated-measures ANOVA on cell means.

**Before any of this, check `analysis_join_report.csv`.** A participant with an incomplete condition
set — a sitting abandoned part-way, or one half of a split sitting missing — is present in the file
and marked `analysable = FALSE`. The confirmatory analysis is complete-case; a sensitivity analysis
including them is reasonable and should be reported as such. Anyone carrying the withdrawn two-level
crossover (twenty condition-runs across two illumination levels) is also flagged, because pooling
them would average two illumination cells into one and call the result a constant-illumination
measurement.

**The two sets, as both templates apply them** (Round 69). Both analysis templates read this file —
the exporter's verdict — rather than re-deriving one, and stop with a named message if it is not
under `DATA_DIR`. They used to drop only withdrawn participants and unfinished runs, so test-harness
sittings, integrity-blocked sittings and incomplete participants were modelled.

- **Confirmatory set** (every model): `analysable`, not `withdrawn`, not `e2e_timing`,
  `protocol_pass` 0 (blank on older sittings, which were all first passes), and the run finished.
- **Sensitivity set** (one refit of the primary): the confirmatory set plus the finished runs of
  participants excluded *only* for an incomplete condition set (`condition_incomplete`,
  `condition_coverage`, `incomplete_split_sitting`, `incomplete_crossover`; the list is
  `COMPLETENESS_EXCLUSIONS` in `src/storage/joinIntegrity.ts`). Nobody excluded for an integrity
  fault, missing consent, a test session or a repeat pass enters it.

Each template prints the count of condition-runs and participants per exclusion reason, and the size
of both sets; the dashboard's cohort tab counts the same two sets from `analysis_long.csv`, and
`npm run verify:analysis` checks that R, Python and the dashboard agree on a simulated cohort.

---

## 2. The primary outcome, and why it is a count and not a number

**Incomplete-blink ratio during reading.**

`incomplete_blink_ratio` is a proportion, and it is exported alongside its two components:
`n_incomplete` (numerator) and `n_blinks_total` (denominator). **Model the counts, not the ratio.**

A proportion of 0.20 from 5 blinks and a proportion of 0.20 from 60 blinks are not the same
measurement. The first is one blink away from 0.0 or 0.4; the second is a stable estimate. A
Gaussian model of the ratio column treats them as equally informative, which both inflates apparent
precision on sparse rows and lets a handful of low-blink conditions dominate the residual variance.

```r
library(lme4)
m_primary <- glmer(
  cbind(n_incomplete, n_blinks_total - n_incomplete) ~
    polarity_c * text_colour +
    position_c + (1 | participant_id) + (1 | passage_id),
  family = binomial, data = subset(d, analysable & camera_active)
)
```

Notes on each term:

- **`polarity_c`** — sum-to-zero coded (±0.5). With an interaction present, a dummy-coded main
  effect is the simple effect at the other factor's reference level rather than an average effect.
  This is not a stylistic preference; it changes what the coefficient means.
- **`illumination_c` is NOT in this model, and must not be added.** It is a constant +0.5 in a
  single-level dataset, aliased with the intercept, so `polarity_c * illumination_c` is
  rank-deficient. The column still ships so that a pooled file containing earlier two-level data
  stays separable; in this dataset it carries no variance. The same applies to
  `illumination_order_first`, which R will reject outright as a one-level factor, and to
  `passage_repeat_number`, which is constant at 1 now that each passage is read once.
- **`text_colour`** as a factor, or **`wcag_contrast_ratio`** as a continuous predictor. These
  answer different questions — "does colour matter?" versus "does contrast matter?" — and the
  ten-cell design cannot separate hue from contrast on its own. Fitting both and comparing is
  informative; fitting them together is not, since they are near-collinear.
- **`position_c`** — order within the sitting, centred. The Williams square balances position across
  participants, so this is a nuisance term rather than a confound, but leaving it out pushes
  fatigue-driven variance into the residual.
- **`(1 | passage_id)`** — and it is needed, because passage is NOT fully balanced against
  condition. The rotation period makes passage uniform against serial position, not against
  condition: each condition meets three of the ten passages twice as often as the other seven, an
  imbalance that is structural and does not shrink with recruitment. This bullet previously said
  passage was "decoupled from condition by design", which was wrong. The random intercept is
  therefore doing real work rather than being a convenience, and the residual leak onto the polarity
  contrast should be acknowledged in the limitations — it is small only because the corpus is
  length- and difficulty-matched.
- **Overdispersion must be checked.** Blinks within a condition are not independent Bernoulli trials;
  if the dispersion statistic exceeds ~1.5, refit with `glmmTMB(..., family = betabinomial)`.
- **`eff_fps_c`, the centred effective frame rate, is in the templates' primary model and not in the
  formula above** (Round 69 makes this explicit). Undersampling biases the measured minimum EAR
  upward and so inflates the ratio, which is the case for adjusting; but polarity changes how the
  face is lit, so frame rate may lie on the path from polarity to the outcome, which is the case
  against. Both templates therefore report the primary WITH it and, beside it, the formula above
  WITHOUT it. Which one is the confirmatory model is the investigator's decision, to be fixed before
  the data are unblinded; until it is, report both.

**Falsification.** H1 (polarity affects incomplete blinking) is not supported if the `polarity_c`
coefficient's 95% CI includes zero in the model above. Report the coefficient on the log-odds scale
*and* as a predicted difference in proportion at the mean, because a log-odds of 0.2 is not
interpretable to an optometry readership.

---

## 3. What the verified literature does and does not license

Four of the seven verified records bear directly on interpretation.

**Portello, Rosenfield & Chu (2013)** — [10.1097/OPX.0b013e31828f09a7](https://doi.org/10.1097/OPX.0b013e31828f09a7),
verified via PubMed. A 15-minute reading task, N = 21, gave a **mean incomplete-blink proportion of
16.1% (SD 15.7, range 0.9–56.5%)**, and the proportion correlated with symptom score (p = 0.002).

- **Licenses:** a prior expectation for the outcome's central value and its very wide
  between-person spread; and the choice to relate the ocular measure to the subjective one.
- **Does not license:** any claim about polarity or colour. The manipulation was not display
  appearance.

**Argilés et al. (2015)** — [10.1167/iovs.15-16967](https://doi.org/10.1167/iovs.15-16967).
Six 6-minute reading conditions, N = 50: blink rate fell in all six (p < 0.001) and incomplete-blink
percentage rose on electronic platforms specifically.

- **Licenses:** the statement that 6 minutes is sufficient exposure for this outcome to move.
- **Bears on a limitation of this study:** exposure here is **~3 minutes per condition**, below that.
  This must be stated in the limitations, not glossed. It is also why `n_blinks_total` matters so
  much — at ~39 blinks per condition the ratio's standard error is around 0.059, which is the
  binding constraint on the polarity × colour interaction.
- **Does not license:** a colour or polarity claim. The manipulation was reading platform, and the
  sample was 18–74, not students.

**Golebiowski et al. (2020)** — [10.1080/02713683.2019.1663542](https://doi.org/10.1080/02713683.2019.1663542).
Incomplete blinks per minute rose from a median of 6 at 1 min to 15 at 60 min of smartphone reading
(p = .0049), N = 12 pilot.

- **Licenses:** the expectation that the outcome **drifts upward with time on task**, which is
  precisely why `position_c` and `global_position` belong in the model. An analysis omitting
  position risks attributing a fatigue trend to whichever condition happened to run late.

**Pattyn et al. (2008)** — [10.1016/j.physbeh.2007.09.016](https://doi.org/10.1016/j.physbeh.2007.09.016).
Reaction times increased after **30 min** of time-on-task, with a further attentional cost appearing
only after **60 min**.

- **Bears on the RT analysis directly.** A sitting runs ~93 minutes, so later conditions are measured
  past both thresholds. Position is counterbalanced, so this is inflated error variance rather than
  bias — but it means `position_c` is **not optional** in any RT model, and a
  `polarity_c × position_c` interaction is worth testing explicitly: an effect that appears only late
  in the sitting is a fatigue interaction, not a display effect.

---

## 4. Secondary outcomes

| Outcome | Column(s) | Model | Why |
|---|---|---|---|
| Subjective fatigue | `fatigue_delta` | LMM, Gaussian | Change from the participant's own baseline removes between-person scale use. Use `fatigue_mean` only if baselines are missing. |
| Comprehension | `comprehension_correct` / `comprehension_items` | Binomial GLMM | Same argument as the primary: 2/3 is a coarse measurement and should be weighted as such. |
| Reading speed | `reading_speed_wpm` | LMM | Check against `observed_duration_ms` first — a truncated exposure produces a normal-looking speed. |
| Visual search | `search_time_ms` | LMM, **censored** | The column is `search_termination` in `analysis_long.csv` (the file this plan is written against) and `termination_mode` in `05_visual_search.csv`; it says whether the block ended by completion or by the 60 s cap. An earlier revision of this line claimed `search_termination` did not exist — that was wrong, and came from checking only the numbered bundle's codebook and not `analysisCodebook.ts`. Capped rows are a lower bound; treating them as measurements biases the mean downward. Either model them as censored or report the completion rate alongside. |
| Sensitivity | `d_prime` | LMM | With 20 go and 12 no-go trials, one block's d′ is imprecise. Check `d_prime_se` in `09_rt_summary.csv` and consider weighting. |
| Response bias | `criterion` | LMM | A polarity effect on `criterion` **without** one on `d_prime` is a bias shift, not a sensitivity change. Worth reporting as a distinct finding rather than folding into "RT performance". |
| PERCLOS | `perclos_p80` | LMM on logit | Bounded; do not model raw. |

### 4a. Reaction-time target location: ring, and ring × colour (Round 66)

From Round 66 the go/no-go dot appears at one of **eight fixed locations**: two rings around the
fixation cross, 4° and 8° at the nominal 55 cm (a judgement, not a published optimum), on the four
diagonals. Every 32-trial block uses each location 4 times, with go 10 per ring and no-go 6 per ring,
so the condition-level outcomes in `09_rt_summary.csv` (mean RT, d′, criterion, lapse rate) stay
defined and comparable across conditions: every block is balanced over the rings. What changes is
that location is now a **recorded, balanced factor** in `08_reaction_trials.csv` (`stim_location_id`,
`stim_ring`, `stim_angle_deg`, `stim_dx_px`, `stim_dy_px`, `stim_ecc_px`, `stim_ecc_deg_55cm`).

- **Ring enters the trial-level models, and so does ring × colour.** Response time rises with target
  eccentricity, and red–green cone opponency declines with eccentricity faster than blue–yellow,
  which declines about as achromatic sensitivity does (Mullen & Kingdom 2002). The go/no-go decision
  here is a colour decision, so the colour conditions are not expected to lose discriminability
  equally at 8°; with balanced rings that interaction is estimable instead of being noise. The two
  trial-level models are the probit GLMM for sensitivity and criterion (signal-detection terms on
  `is_signal`, with `stim_ring` and its interaction with the colour factor added) and an LMM on log
  RT of valid hits (`stim_ring`, ring × colour, `position_c`, and participant and passage random
  effects). **The analysis templates do not fit these terms yet**; the analysis batch implements
  them. This note fixes what they must contain before anyone looks at the data.
- `stim_ecc_deg_55cm` assumes a 55 cm eye-to-screen distance, which is not recorded; the protocol
  allows 50–60 cm, about ±9% in angle. Model `stim_ring` as the factor and treat the degree value as
  descriptive.
- **Rows recorded before Round 66 have no location columns** (all blank): the dot then landed at a
  uniformly random point in the central part of the screen, which was not recorded. Those rows enter
  the condition-level analysis as before and must be left out of any model with a location term —
  never imputed. They are also a different stimulus layout, so a dataset pooling both should carry the
  build (`git_hash`) as a factor.

---

## 5. Manipulation and quality checks, before any inference

These are not optional and they come first.

1. **Did the illumination CONTROL hold?** Plot `ambient_lux_measured` across sittings: it should be
   a tight cluster at 300 lux, not a spread. This is a constancy check rather than a separation
   check — there are no levels to separate — and a sitting outside 250–350 is a protocol deviation.
   `lux_all_in_range` flags those, and `lux_complete` says whether all three checkpoints were taken.
2. **Was the primary outcome measurable?** `fps_adequate_for_ratio`. Below the frame-rate floor the
   sampled minimum EAR is biased **upward**, so `incomplete_blink_ratio` is inflated — a directional
   bias, not symmetric noise. **Do not drop these rows silently:** frame rate covaries with how the
   face is lit, and display polarity — an independent variable — changes that, so dropping them
   deletes data non-randomly with respect to a factor. (This item used to name ambient illumination
   as the independent variable; illumination is now held constant.) Run the model with and without
   them and report both.
3. **Was the participant present?** `face_presence_ratio` and `off_axis_ratio`.
4. **Was the exposure complete?** `observed_duration_ms` against `reading_time_ms`. A large shortfall
   means every rate in that row describes only the fraction the camera saw, and the rates themselves
   look entirely normal.
5. **Careless responding.** `12_quality_flags.csv` carries straight-lining and rushed-response
   signals per condition.

---

## 5b. Which template implements this plan

`src/analysis/analysis_template.R` does. It fits the random-effects reduction ladder, reports which
structure it settled on, and runs the pre-specified sensitivity refits.

`analysis_template.py` is a CROSS-CHECK in a second toolchain, and two of its limits are limits of
the tool rather than choices:

- statsmodels' GEE takes one clustering level, so passage cannot be a random intercept there; it
  enters every Python model as a FIXED effect, `C(passage_id)`. (This bullet used to say a passage
  effect "loads onto the residual in the Python fit", which was true only because no Python model
  carried passage at all — and, until Round 69, only the R primary did.)
- GEE is population-averaged where `glmer` is subject-specific, so the two sets of coefficients are
  on different scales. Where they must agree is in SIGN and in significance, never coefficient for
  coefficient.

For the two to be comparable at all they must estimate the same quantity on the same rows. Until
Round 69 they did not: the Python comprehension model was fitting P(wrong answer), so every sign was
inverted against R; the Python primary's colour factor was treatment-coded, so its `polarity_c` was
the achromatic simple effect rather than the average effect R tests; and neither applied the
exporter's verdict. Both now use the confirmatory set above, sum-coded colour, `eff_fps_c` in the
primary, and passage in every model; Python's GEEs use statsmodels' bias-reduced sandwich covariance,
because the plain robust one is too small with few participants.

Its header used to call itself "authoritative inference", and three requirements of this plan were
absent from it: the frame-rate sensitivity refit of §5.2, the sum-to-zero polarity coding of §2, and
the `fatigue_delta` preference of §4. An analyst who ran that file instead of the R one satisfied
none of them and had nothing in the output to say so.

**That correction was written without checking the R file, and the sentence above implied a
guarantee that did not exist.** The R template carried the same sum-to-zero and `fatigue_delta`
defects, and it did not run at all: it selected `lux_all_in_range` from `01_session_info.csv`, where
the exporter writes `lux_logged_all_in_range`, so `dplyr` stopped at that join and no model below it
had ever executed. It also read a single exported folder, which gives `(1 | participant_id)` one
level, and fitted PERCLOS raw against the instruction in §4. All of these are now fixed, and the
`§5b` claim that R "does implement this plan" is true for the first time.

`npm run verify:analysis` runs BOTH templates against a fixture export and fails if any required
section is missing. The R fixture is multi-participant, because a single-folder fixture can only
exercise data loading and never a model. Neither template had ever been run against the app's own
output; neither worked when it was.

Checking that sections print could not catch a model that runs and answers the wrong question, so
since Round 69 the gate runs both templates on ONE simulated cohort (`src/sim/analysisCohort.ts`: the
real Williams row and passage rotation for each enrolment, and known polarity effects on the primary
and on comprehension). It fails unless both recover the simulated SIGN, no design is rank deficient,
the polarity standard error is bounded, and R, Python and the dashboard count the same confirmatory
and sensitivity sets. It also runs one participant, a sitting exported twice, a missing verdict and an
all-cameras-off cohort through both templates, each of which must end with its named message.

---

## 6. Things this design cannot answer, and should not be asked to

Stating these protects the thesis more than any additional analysis would.

- **Hue versus contrast.** The five colours differ in both. An effect of "green" cannot be separated
  from an effect of its contrast ratio without a design that varies them independently.
- **Causal mechanism for incomplete blinking.** The study measures the association between display
  appearance and blink completeness. It does not measure tear film, and no ocular-surface claim
  follows from blink data alone.
- **Generalisation beyond the device.** `stimulus_scale` and `screen_resolution` bound this. One
  tablet, one panel, one luminance range.
- **The 3-minute exposure.** Below the shortest verified precedent for this outcome. It bounds the
  effect sizes that are detectable, and the limitation belongs in the write-up rather than in a
  reviewer's report.

---

## 7. Reproducibility

Every export carries `app_version`, `git_hash`, `condition_def_hash` and `schema_version`. Report the
git hash of the build that collected the data. The export is byte-reproducible — it contains no
timestamps, so re-exporting the same session yields identical files and the checksums in
`16_integrity_report.csv` certify content rather than time of export.

**Both templates print their provenance first** (Round 70). Before any data is read: the R or Python
version, the version of every package a model comes from (and whether `glmmTMB` is installed), and a
checksum of the template file itself. Then, over every sitting read and before exclusions, the count
of sittings per `git_hash`, `app_version`, `condition_def_hash` and `schema_version`, and how many
sittings were collected by more than one build; after the verdict, the builds behind the
confirmatory set, with `[MIXED BUILDS]` when there is more than one (§4a says when the build must
then enter a model). Neither template printed any of this before, and CI installs the packages
unpinned, so an output could not be tied to the software or the build that produced it. The CI
install stays unpinned on purpose, as a canary for upstream changes; the thesis run should be made
from a recorded environment, and the provenance block is the record of which one it was.
