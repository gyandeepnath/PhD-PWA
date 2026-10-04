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
Claims about the *literature* are limited to records verified against PubMed in
`docs/CITATION_VERIFICATION.md` and are named as such, with their item numbers. Statistical practice
(mixed models, binomial error, contrast coding) is stated as methodology, not attributed, except where
a specific modelling choice rests on a verified source (items 57 and 58, Round 70). Nothing here cites
a paper that has not been resolved to a real record. (This paragraph used to say "the seven records";
the plan has cited more than seven since Round 66.)

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
  informative. This bullet went on to say that fitting them together is not, "since they are
  near-collinear", while synopsis §3.9 asks for exactly that fit ("comparative fit and residual hue
  terms"). Reconciled in Round 70: log contrast is a function of the polarity × colour cell, so beside
  the colour factor it is identified only by how contrast differs between the polarities within a
  colour. The template fits the three nested models (contrast; contrast + colour, the residual-hue
  model; the full ten-cell model), all with the primary's covariates and passage intercept, compares
  them by likelihood ratio — valid however collinear the terms — and prints the residual-hue model's
  variance inflation factors, which say how far its contrast and colour coefficients can be read one
  by one rather than jointly. (On the 24-participant gate cohort both are about 3.7.)
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
- **Overdispersion is a standing sensitivity, not a threshold trigger** (amended in Round 70, before
  data collection). Blinks within a condition are not independent Bernoulli trials. This bullet used
  to say: if the dispersion statistic exceeds ~1.5, refit with `glmmTMB(..., family = betabinomial)`.
  The template then printed "betabinomial refit required" at a ratio of 1.55 and fitted nothing, and
  on the Round 62 audit's null replicates at N = 130, at a ratio of about 1.2 ("within tolerance" by
  that rule), an observation-level random effect raised the polarity SE by 20-30%. So the ratio is printed
  for description only, and two refits are reported beside the primary whatever it says: the same
  model with an **observation-level random effect** (`(1 | run_obs)`, one level per condition-run),
  and, where `glmmTMB` is installed, a **beta-binomial** refit of the same formula. `glmmTMB` is in
  neither the install line nor CI; without it the template says `[SKIPPED: glmmTMB not installed]`.
  Harrison (2015; `CITATION_VERIFICATION.md` item 57) found that an observation-level random effect
  copes with some sources of binomial overdispersion and not others, and that comparing it with the
  beta-binomial estimate shows when it is failing — which is why both are printed when both can be.
  Which fit the thesis reports if they disagree with the binomial one is a decision for the
  investigator, to be made before unblinding.
- **Convergence** (synopsis §3.9: "a non-converging random structure is reduced in a pre-specified
  order and the reduction reported"). The ladder used to step down on a singular or failed fit only
  and kept a fit lme4 had flagged as not converged. Now, when lme4 warns, `allFit()` refits the rung
  with every available optimizer (lme4's own help calls this "the gold standard"). The rung stands
  only if it reached the highest log-likelihood any optimizer found (within 0.01,
  `ALLFIT_LOGLIK_TOL`) and the optimizers that reached it agree on every fixed effect to within 0.05
  of its standard error (`ALLFIT_AGREE_SE_FRAC`); both are analyst defaults. An optimizer that
  stopped at a lower likelihood is a worse fit, not a competing answer, and is not compared.
  Otherwise the next rung is tried. If none converges, the most reduced structure that fitted is reported, marked
  NOT CONVERGED. The verdict for every rung tried is printed under `PRIMARY MODEL CONVERGENCE`, and the
  binomial secondaries (comprehension, search completion) report theirs the same way.
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

Neither template reported either quantity until Round 70. Both now print, under `[H1]`, the
log-odds difference (positive minus negative) with its 95% CI and whether that CI includes zero, the
odds ratio with its CI, and the predicted proportions and their difference with a delta-method CI —
for the model with `eff_fps_c` and for the formula above, until the investigator decides which is
confirmatory. "At the mean" means: each colour weighted equally, serial position and frame rate at
their means, and, in R, random effects at zero, so the proportions are those of a typical participant;
the Python GEE's are population-averaged, so the two agree in sign and not to the decimal.

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
| Visual search | `targets_found` over `search_time_ms`; `search_d_prime`; completion (`search_termination`) | **Poisson rate GLMM, search d′ LMM, completion GLMM; censoring tested** (Round 71, §4c) | Round 71: the uncensored time LMM is printed as a description only. Before: The column is `search_termination` in `analysis_long.csv` (the file this plan is written against) and `termination_mode` in `05_visual_search.csv`; it says whether the block ended by completion or by the 60 s cap. An earlier revision of this line claimed `search_termination` did not exist — that was wrong, and came from checking only the numbered bundle's codebook and not `analysisCodebook.ts`. Capped rows are a lower bound; treating them as measurements biases the mean downward. Either model them as censored or report the completion rate alongside. |
| Sensitivity | the trials in `08_reaction_trials.csv` (`d_prime` per block as a cross-check) | **Probit GLMM on the trials** (Round 71), with the condition-run's own criterion and d′ (Round 73) | With 20 go and 12 no-go trials, one block's d′ is imprecise. This row used to say "consider weighting" by `d_prime_se`; the template did, and that was biased, because the SE rises with d′ itself (correlation 0.95 on the Round 62 audit's N = 40 cohort), so inverse-variance weights down-weight high-sensitivity blocks. See §4c. |
| Response bias | the trials (`criterion` per block as a cross-check) | **The same probit GLMM** (Round 71) | A polarity effect on `criterion` **without** one on `d_prime` is a bias shift, not a sensitivity change. Worth reporting as a distinct finding rather than folding into "RT performance". |
| Comfort, clarity | `display_comfort_score`, `text_clarity_score` (06) | LMM (Round 71) | 0-100 sliders. Untouched sliders (`comfort_touched` / `clarity_touched` FALSE) are excluded. Not a cumulative-link model: see §4c. |
| RT variability | `rt_sd_ms` | LMM on log (Round 71) | Effect is a ratio of SDs. |
| Lapses | `lapse_count` of `hits` | Binomial GLMM with an observation-level (run) term (Rounds 71, 73) | Weighted by the block's hits, as the primary is by its blinks. The run term carries the extra-binomial variation between runs; see §4c. |
| Inter-blink interval | `mean_inter_blink_interval_ms` | LMM on log (Round 71) | Near the reciprocal of blink rate; both are in the ocular family. |
| PERCLOS | `perclos_p80` | **A covariate, not an outcome** (Round 70) | See below the table. |

**PERCLOS is a sleepiness covariate, not an outcome** (Round 70). This row used to list it as a
secondary outcome ("LMM on logit"), the analysis codebook called it `secondary`, and both templates
fitted it as an outcome of polarity — the Python one raw — while the numbered bundle's codebook says
"a SLEEPINESS covariate, never a visual-fatigue outcome" and the synopsis says the same (§2.5: "a
covariate for sleepiness rather than a measure of visual fatigue"; §3.7 lists it among the covariates
and as a drowsiness index; §3.9: "Sensitivity analyses ... add PERCLOS as a covariate"). It now has two
uses and no third:

1. **The PERCLOS-adjusted refit of the primary**, the synopsis's sensitivity analysis, in both
   templates (the Python one never ran it). Two properties limit it, and are printed beside it.
   PERCLOS P80 counts frames with the eye at or below 20% of the open baseline (`blink.ts`); a
   complete blink can reach that and an incomplete blink, which never falls below 60% of baseline,
   cannot — so at a given blink rate PERCLOS falls as the incomplete-blink ratio rises, and the
   covariate is partly a function of the outcome it adjusts. And if the display condition itself moves
   PERCLOS, adjusting for it removes part of the condition effect.
2. **A covariate check**: PERCLOS modelled on the primary's condition terms (polarity × colour, serial
   position, participant and passage intercepts), to show whether the condition moves it. It is in no
   outcome family and no multiplicity table (§4b). PERCLOS is bounded, right-skewed and often exactly
   0, so it is compressed into the open interval as y′ = (y(n − 1) + 0.5)/n, n the number of rows —
   every value moves by at most 0.5/n and no constant is chosen by the analyst — and, where `glmmTMB`
   is installed, y′ is modelled by a beta GLMM with a logit link (beta regression: Smithson &
   Verkuilen 2006, `CITATION_VERIFICATION.md` item 58, which records that the compression formula is
   not confirmed against that paper's text). Both templates fit an LMM on logit(y′), the R one as its
   fallback when `glmmTMB` is absent. The fixed clip at 5e-4 it replaces put every zero at −7.6 on the
   logit scale, the high-leverage pattern §2 rejects for the primary.

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
  effects). This note fixed what they must contain before anyone looked at the data; the R template
  fits the probit GLMM with these terms from Round 71 (§4c). From Round 73 both also carry the
  **condition-run** as a random effect, because polarity, colour and position vary only between runs
  and a run's trials are not independent evidence about them (§4c).
- `stim_ecc_deg_55cm` is the angle at the nominal 55 cm and `stim_ecc_deg_at_distance` at the
  eye-to-screen distance tape-measured at pre-flight (Round 74; not recorded before, when the
  protocol's 50–60 cm left about ±9% in angle). Both are computed from the sitting's ruler
  calibration of the screen, or flagged as assumed where there is none (`stim_ecc_deg_source`).
  Model `stim_ring` as the factor and treat the degree values as descriptive.
- **Rows recorded before Round 66 have no location columns** (all blank): the dot then landed at a
  uniformly random point in the central part of the screen, which was not recorded. Those rows enter
  the condition-level analysis as before and must be left out of any model with a location term —
  never imputed. They are also a different stimulus layout, so a dataset pooling both should carry the
  build (`git_hash`) as a factor.

### 4b. Effect sizes and multiplicity: the outcome families (Round 70)

Synopsis §3.9: "Effect sizes with confidence intervals and multiplicity control within outcome
families are reported throughout." §3.7: "Confirmatory inference is confined to the primary outcome."
Until Round 70 neither template printed a single confidence interval or adjusted a single p-value.

**Effect sizes.** Every polarity effect is read through `emmeans` as positive minus negative,
averaged over colour wherever colour is in the model (which, colour being sum-coded, is the main
effect), at the mean of every covariate, with an unadjusted 95% CI. Effects stay in each outcome's own
units — odds ratios for the binomial models; ms, words/min, scale points or z units for the Gaussian
ones — rather than being standardised: a mixed model has no single standard deviation to divide by,
and a unit a reader can picture is the more useful number. lmer intervals use Satterthwaite degrees of
freedom, as lmerTest's tables do.

**The primary family.** Two pre-specified tests on the primary outcome: H₁ₐ, the polarity effect
(§2's rule, the unadjusted 95% CI), and H₁ᵦ, the polarity × colour interaction (the likelihood-ratio
test against the additive model; a 4-df Wald test in the Python GEE, which has no likelihood). Both
templates print both p-values raw and Holm-adjusted across the two. **§2's rule stands as written
until the investigator decides otherwise**: whether H₁ₐ and H₁ᵦ share one family-wise error rate (the
Holm column then decides H1, at the cost of a stricter bar) or H₁ₐ alone is confirmatory is a decision
for the investigator, to be fixed before unblinding. The polarity effect within each colour is
reported as an odds ratio, Holm-adjusted across the five colours, and is read only beside the omnibus
interaction test: it describes the shape of an interaction and does not establish one.

**The secondary families.** Holm is applied within each family, separately to the polarity p-values
and to the interaction p-values (where the model has an interaction), across the family's outcomes:

| Family | Members | Modelled in the templates now |
|---|---|---|
| Ocular | blink rate; inter-blink interval | both (inter-blink interval from Round 71) |
| Subjective (per condition) | visual fatigue (`fatigue_delta`); comfort; clarity | all three (comfort and clarity from Round 71) |
| Performance | reading speed; comprehension; RT mean; RT variability; lapse rate; d′; criterion; visual-search completion; visual-search rate; search d′ | all ten (RT variability, lapse rate, search rate and search d′ from Round 71) |

Every member is modelled since Round 71. A member that does not fit in a given run (no data, or a
model that fails) is still listed under its family with the reason, so a smaller family is never
presented as the whole. Outside every family: the key secondary CVS-Q change and NASA-TLX are once per
sitting, so no polarity contrast exists for them (they are reported with an interval over
participants, §4c); PERCLOS, head pose and face presence are covariates and quality indices, not
outcomes (§4, PERCLOS row). The R template implements all three families, and a unit test holds its
family list to its models; the Python cross-check implements the primary family only, since its role
is the confirmatory sign check (§5b).


### 4c. The secondary models (Round 71)

**Sensitivity and criterion: one probit GLMM on the trials.** Every scored trial of
`08_reaction_trials.csv` (anticipations excluded, as the summaries exclude them) is a Bernoulli
"responded or not". With the signal coded `sig` = +0.5 (go) / −0.5 (no-go), the equal-variance
signal-detection model is P(respond) = Φ(a + d′·sig): every term multiplying `sig` is an effect on d′,
and every term that does not is an effect on −c, the criterion at the midpoint (the quantity the
per-block `criterion` column estimates, −(z(H) + z(F))/2). The model is

```r
glmer(cbind(responded, not) ~ sig * (polarity * colour + session_position + ring + ring:colour)
        + (1 + sig | participant_id) + (1 | passage_id) + (1 + sig || run_id),
      family = binomial(link = "probit"))
```

with trials of identical covariates grouped (the likelihood is unchanged). The polarity effect on d′ is
the difference in the `sig` slope between polarities, averaged over colour and ring; on c, minus the
difference in the intercept. The polarity × colour interaction on each, and ring × colour on d′, are
joint Wald tests. Wright, Horry & Skagerberg (2009; `CITATION_VERIFICATION.md` item 59) argue for
multilevel generalized linear models in place of signal-detection measures computed participant by
participant; the probit coding is the method, stated rather than attributed. It needs no weights and
no rate correction (20 of 20 hits is a likelihood term, not a bound to nudge). Rows recorded before
Round 66 carry no target location: with none located, the model is fitted without the ring terms and
says so; with some, the located trials are modelled and the count left out is printed.

**The condition-run as a random effect (Round 73).** `run_id` is the condition-run (participant ×
condition). Polarity, colour and serial position vary only between a participant's ten runs, and the
32 trials of a run share its moment — attention, arousal, the minute of the session — so each run has
a criterion and a d′ of its own around the participant's. Without a term for that, the model counted a
run's 32 correlated trials as independent evidence about its condition. In the null simulation of the
review of Rounds 69-72 (24 participants, run-to-run SD 0.25 on both), the polarity test on the criterion rejected
11% of the time instead of 5%, and 6% with the run term; the d′ test was not inflated in that setting
(8% with and without). The same applies more strongly to the trial-level log-RT model: with a run SD of
0.06 on log RT its polarity test rejected 37% of the time, and 4% with `(1 | run_id)`. It is the
pseudo-replication the comprehension model's `(1 | participant_id/condition_id)` already avoids. So:

- the probit GLMM carries `(1 + sig || run_id)`, the run's own criterion and d′, uncorrelated. A run
  term whose variance is estimated at zero (a singular fit) is dropped, and the output says the data
  show no run-to-run variation in it, so dropping it changes nothing. If the model does not fit or
  fails the convergence check, terms are dropped in a **pre-specified order**, the run's d′ first and
  then its criterion, and the output says that tests on what was dropped are anti-conservative to the
  extent that runs vary in it;
- the trial-level log-RT LMM carries `(1 | run_id)`, removed only if the model with it does not fit,
  which the output then says;
- the lapse GLMM (one row per run) carries `(1 | run_id)` as an observation-level random effect, so its
  polarity row in the performance family allows for extra-binomial variation between runs;
- the stacked fatigue-item `clmm` carries `(1 | run_id)`: the five items of one rating share the run.

The simulated cohort the analysis gate runs on draws each block's own criterion, d′, speed and lapse
propensity, so the gate can tell these models from ones without the run term.

The per-block LMMs on `d_prime` and `criterion` are kept as **unweighted cross-checks**, in no
family. The template no longer prints a count of blocks with `d_prime_unstable`, which is TRUE for
every block this design can produce.

**Visual search: censoring tested, speed as a rate, search d′.** The template used to warn when the
ten conditions' censoring rates spanned more than 10 percentage points. That is not a test: in the
Round 62 audit's null simulations it fired in 79% of datasets at N = 40 and 55% at N = 130 (20%
censoring). It is replaced by a likelihood-ratio test of `censored ~ polarity × colour` against the same
model without the condition terms (serial position and the participant and passage intercepts in both),
and the outcome that carries search speed in the performance family is now a **Poisson GLMM of
`targets_found` with `log(search_time_ms / 60000)` as an offset** — targets found per minute, the
modelled form of `search_efficiency`. A block that hit the cap contributes what it found in the time it
searched, which is what was observed, so the rate needs no censoring model; the passage intercept is
there because the target count differs by passage. **Search d′** (targets tapped against non-targets
tapped), which the codebook asks to prefer to accuracy, is an unweighted LMM with the passage intercept
and joins the performance family; "visual-search time" leaves it, and the uncensored time LMM is printed
as a description. **Completion** stays: when a polarity × colour cell completed every block or none, the
ten-cell logistic model is separated (its estimates run off to infinity), so the additive model is
fitted and labelled `[additive]`, with no interaction test; when a whole polarity or colour level is
degenerate, no completion model is fitted. A censored-time model (a Cox or censored-normal mixed model)
is not fitted: it needs a package (`survival`) that is not in the install line or CI.

**The remaining members and analyses (Round 71).**

- **RT variability** (log SD of hit latencies) and **lapses** (hits slower than the lapse threshold, a
  binomial count out of the block's hits) — synopsis §2.6's "most fatigue-sensitive indices".
- **Inter-blink interval** on the log scale, beside blink rate.
- **Comfort and clarity**, LMMs. Synopsis §3.9 says "ordinal cumulative-link models serve rating
  outcomes". For a 0-100 slider that is not workable: a cumulative-link model needs a threshold between
  every pair of adjacent values used, about ten ratings per participant cannot support up to 100 of
  them, and the scores are close to continuous already, so the LMM is the model, by this amendment. The
  0-10 fatigue ITEMS are ordinal ratings in the ordinary sense; where `ordinal` is installed the template
  fits a cumulative-link mixed model (`ordinal::clmm`) to the five post-condition items stacked, with the
  condition-run intercept (Round 73), as a sensitivity for the fatigue member, and otherwise says `[SKIPPED: ordinal not installed]`. `ordinal`,
  like `glmmTMB`, is in neither the install line nor CI.
- **RT polarity × serial position** (§3): on the per-block mean RT model, and in a trial-level LMM on the
  log RT of valid hits that also carries §4a's ring and ring × colour terms and, from Round 73, the
  condition-run intercept (polarity × position is a between-run contrast too).
- **Primary sensitivities**: without restarted runs (`attempt_number` > 1); without interrupted runs
  (`condition_interrupted`); serial position as a factor rather than a line; and first-order carryover —
  `polarity_switched` (the run before, in the same sitting, had the other polarity) added, tested by
  likelihood ratio against the primary refitted on the runs that have a predecessor.
- **Moderation** (Objective 3; synopsis §3.9, "condition-by-moderator interactions"): each recorded
  moderator — `daily_screen_hours` (standardised), `lighting_habit`, `device_familiarity` — with its
  polarity interaction, one at a time, by likelihood ratio against the primary plus the moderator's
  main effect on the same rows, Holm across the three. Exploratory: the sample size of a between-participant moderator is the number of
  participants. H₁ᵨ's habitual display-mode preference is **not recorded** by the app and cannot be
  tested.
- **CVS-Q change and NASA-TLX**: one value per participant — for CVS-Q the first sitting's baseline to
  the last sitting's close, for NASA-TLX the mean of a participant's sittings — with a t interval over
  participants. A split sitting used to contribute two half-exposure changes counted as independent.

**Not done, and why.** A censored-time model of search (Cox or censored-normal): needs `survival`,
not in the install line or CI (the search rate makes it unnecessary for the family). Moderation of
the colour effect, and moderators beyond polarity: not pre-specified in a form small enough to test.
The Python cross-check mirrors none of this — its role is the confirmatory sign check (§5b).

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

**What the Python file mirrors since Round 70**: the confirmatory pieces. H1's effect sizes on the
same three scales as R (log-odds with 95% CI, odds ratio, predicted proportion difference with a
delta-method CI, population-averaged), the primary family (H1a and H1b, raw and Holm across the two;
H1b by a 4-df Wald test), the PERCLOS-adjusted refit and the PERCLOS covariate check with the same
compression. It does not refit the primary for overdispersion: its participant-clustered sandwich
covariance does not assume binomial variance, so extra-binomial variation is already in its standard
errors, and the output says so. The secondary outcome families (§4b) are R's alone.

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
and sensitivity sets. It also runs one participant, a sitting exported twice, a missing verdict, a
one-polarity cohort (both as the app writes it, which the exporter's verdict refuses, and with the
condition table edited after export, which only the templates' own guard can see) and an
all-cameras-off cohort through both templates, each of which must end with its named message. Since
Round 72 it also holds the polarity x colour test to its designed 4 df in both templates, and runs a
cohort where three of twelve declined the camera: the primary is fitted on the camera-on runs, and
every behavioural model on all twelve. The gate was mutation-tested in Round 72: with each of the
original B1, M1, M4 and M5 defects put back into a scratch copy of the templates, it fails.

---

## 6. Things this design cannot answer, and should not be asked to

Stating these protects the thesis more than any additional analysis would.

- **Hue versus contrast.** The five colours differ in both. An effect of "green" cannot be separated
  from an effect of its contrast ratio without a design that varies them independently.
- **Causal mechanism for incomplete blinking.** The study measures the association between display
  appearance and blink completeness. It does not measure tear film, and no ocular-surface claim
  follows from blink data alone.
- **Generalisation beyond the device.** One tablet, one panel, one luminance range. The physical
  size of what was shown is measured per sitting from Round 74 (`mm_per_css_px`, `viewing_distance_cm`
  in 01_session_info.csv; `reading_x_height_arcmin` per condition), so it can be reported in degrees
  rather than pixels; `stimulus_scale` alone is not a size, since it depends on the device's pixel
  ratio. Sittings before Round 74 have assumed physical sizes (`physical_size_source`).
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
