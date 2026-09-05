# Analysis plan

> **PROTOCOL AMENDMENT — ambient illumination.** The dim (~10 lux) level has been withdrawn. The
> study now runs at a SINGLE ambient level of 300 lux (band 250-350), one sitting per participant,
> ten condition-runs. Everything else — the Williams order, the five text colours, both polarities,
> CVS-Q, NASA-TLX, reaction time, visual search, comprehension, fatigue and blink measurement — is
> unchanged. Passages of this document that describe two sittings or a crossover describe the
> superseded design. See `ILLUMINATION_AMENDMENT.md` for the reasoning, the verified citations and
> what the change costs.

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

Three factors, and they do not sit at the same level:

| Factor | Levels | Varies |
|---|---|---|
| Ambient illumination | 10 lux, 150 lux | **Between sittings** — the whole-plot factor |
| Display polarity | positive, negative | Within sitting |
| Text colour | 5 | Within sitting |

Polarity × colour gives the 10 conditions run inside each sitting; illumination changes only between
the two sittings. That is a **split-plot repeated-measures design**, and it has one consequence that
governs everything below: *the illumination effect is estimated on fewer effective units than the
polarity and colour effects are.* Each participant contributes 20 condition-runs but only **two**
illumination observations. Any analysis that pools all 20 rows and treats illumination like the
other factors will understate its standard error, because it counts ten correlated rows as ten
independent ones.

A mixed model with a participant random intercept handles this correctly without any special
casing, which is the main reason to use one rather than a repeated-measures ANOVA on cell means.

**Before any of this, check `analysis_join_report.csv`.** Rows from a participant whose two sittings
ran under the same illumination, or who has only one sitting, carry no illumination contrast at all.
They are present in the file and marked `analysable = FALSE`. The confirmatory analysis is
complete-case; a sensitivity analysis including them is reasonable and should be reported as such.

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
    polarity_c * illumination_c + text_colour +
    position_c + (1 | participant_id) + (1 | passage_id),
  family = binomial, data = subset(d, analysable & camera_active)
)
```

Notes on each term:

- **`polarity_c * illumination_c`** — sum-to-zero coded (±0.5). With an interaction present, a
  dummy-coded main effect is the simple effect at the other factor's reference level rather than an
  average effect. This is not a stylistic preference; it changes what the coefficient means.
- **`text_colour`** as a factor, or **`wcag_contrast_ratio`** as a continuous predictor. These
  answer different questions — "does colour matter?" versus "does contrast matter?" — and the
  ten-cell design cannot separate hue from contrast on its own. Fitting both and comparing is
  informative; fitting them together is not, since they are near-collinear.
- **`position_c`** — order within the sitting, centred. The Williams square balances position across
  participants, so this is a nuisance term rather than a confound, but leaving it out pushes
  fatigue-driven variance into the residual.
- **`(1 | passage_id)`** — passage is decoupled from condition by design, so it can carry its own
  intercept and is not confounded with the display factors.
- **Overdispersion must be checked.** Blinks within a condition are not independent Bernoulli trials;
  if the dispersion statistic exceeds ~1.5, refit with `glmmTMB(..., family = betabinomial)`.

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
| Visual search | `search_time_ms` | LMM, **censored** | `search_termination` says whether the block ended by completion or by the 40 s cap. Capped rows are a lower bound; treating them as measurements biases the mean downward. Either model them as censored or report the completion rate alongside. |
| Sensitivity | `d_prime` | LMM | With 20 go and 12 no-go trials, one block's d′ is imprecise. Check `d_prime_se` in `09_rt_summary.csv` and consider weighting. |
| Response bias | `criterion` | LMM | A polarity effect on `criterion` **without** one on `d_prime` is a bias shift, not a sensitivity change. Worth reporting as a distinct finding rather than folding into "RT performance". |
| PERCLOS | `perclos_p80` | LMM on logit | Bounded; do not model raw. |

---

## 5. Manipulation and quality checks, before any inference

These are not optional and they come first.

1. **Did the illumination manipulation hold?** Plot `ambient_lux_measured` by `illumination`. If the
   two levels overlap, the whole-plot factor is not what the labels say. `lux_all_in_range` flags
   sittings that drifted outside the accepted band.
2. **Was the primary outcome measurable?** `fps_adequate_for_ratio`. Below the frame-rate floor the
   sampled minimum EAR is biased **upward**, so `incomplete_blink_ratio` is inflated — a directional
   bias, not symmetric noise. **Do not drop these rows silently:** frame rate covaries with ambient
   illumination, which is an independent variable, so dropping them deletes data non-randomly with
   respect to a factor. Run the model with and without them and report both.
3. **Was the participant present?** `face_presence_ratio` and `off_axis_ratio`.
4. **Was the exposure complete?** `observed_duration_ms` against `reading_time_ms`. A large shortfall
   means every rate in that row describes only the fraction the camera saw, and the rates themselves
   look entirely normal.
5. **Careless responding.** `12_quality_flags.csv` carries straight-lining and rushed-response
   signals per condition.

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
