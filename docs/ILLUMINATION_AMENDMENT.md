# Protocol amendment: withdrawal of the dim ambient-illumination level

**Status: APPROVED. Cleared with the supervisor and the Institutional Ethics Committee before any
data collection began. This document is retained as the record of what changed and why.**

This document states what changed, why, and what the change costs. It is written to be readable by
the supervisor and the ethics committee, and every citation in it has been verified against PubMed
and recorded in `CITATION_VERIFICATION.md`. Where something could not be verified it is marked
NOT VERIFIED and is not used to support a conclusion.

---

## 1. What changes

| | Before | After |
|---|---|---|
| Ambient illumination | Two levels: ~10 lux and ~150 lux, crossed within participant | **One level: 300 lux (accepted band 250–350)** |
| Sittings per participant | 2 | **1** |
| Conditions per sitting | 10 (5 text colours × 2 polarities) | **10, unchanged** |
| Condition-runs per participant | 20 | **10** |
| Condition order | Williams square, keyed to enrolment number | **Unchanged** |
| Every other measure | CVS-Q, NASA-TLX, reaction time, visual search, comprehension, fatigue, blink | **Unchanged** |

Nothing else in the protocol is altered. The text colours, the locked condition table, the exposure
durations, the questionnaires, the tasks and the counterbalancing are all as approved.

**One methodological improvement falls out of this for free.** With twenty condition-runs across two
sittings, ten passages had to cover twenty exposures, so every participant read every passage twice
and `passage_repeat_number` was a covariate that had to be modelled. With ten condition-runs, each
of the ten passages is read exactly **once**. The practice-effect confound disappears rather than
being adjusted for.

---

## 2. Why: the instrument, not the science

The ocular outcomes — blink rate, incomplete-blink ratio, PERCLOS — are derived from the tablet's
front camera. In a dark room, the **screen is the dominant thing lighting the participant's face**,
and the two levels of the primary independent variable emit very different amounts of light.

Computed from this study's own locked condition table (backgrounds `#FFFFFF` and `#000000`, an 11″
panel at the protocol's 50–60 cm viewing distance, display white at the working target of
120–150 cd/m²):

| | light cast on the face by the screen alone |
|---|---|
| positive polarity (mean of P1–P5) | **14.6 lux** |
| negative polarity (mean of N1–N5) | **0.49 lux** |

A factor of thirty, from the stimulus. Adding the room:

| room | face, positive | face, negative | ratio |
|---|---|---|---|
| **10 lux (the withdrawn level)** | 24.6 lux | 10.5 lux | **2.35×** |
| 150 lux | 164.6 | 150.5 | 1.09× |
| **300 lux (the new level)** | 314.6 | 300.5 | **1.05×** |

The ratio holds between 2.25× and 2.43× at 10 lux across every assumption varied (ink coverage
5–12%, panel contrast ratio 800–2000:1).

**So at 10 lux, how well the camera can see the participant's face is confounded with display
polarity — the primary independent variable.** That is a validity problem, not a noise problem.

### 2.1 Why the direction of the resulting bias is the worst possible one

Blink completeness is classified from the minimum eye-aspect ratio reached during a blink. Sampling
can only *miss* the deepest frame, never overshoot it, so undersampling is a **one-directional**
error: complete blinks are miscalled as incomplete, never the reverse. Simulated against this
build's own classifier thresholds, for a blink of 100–200 ms:

| effective frame rate | blinks detected | complete blinks miscalled as incomplete |
|---|---|---|
| 30 fps | 99% | 0.3% |
| 20 fps | 95% | 4.2% |
| 15 fps | 89% | 11.4% |
| 10 fps | 73% | 23.0% |

And with the **same true ratio in both polarities**, differing only in achieved frame rate:

| positive fps | negative fps | spurious difference in incomplete-blink ratio |
|---|---|---|
| 30 | 15 | **+0.028** |
| 30 | 12 | +0.048 |
| 30 | 10 | +0.073 |

The artefact points toward *more incomplete blinking under negative polarity* — the direction the
hypothesis predicts. A measurement artefact that imitates the expected result is the single most
damaging thing that can happen to this thesis, and at 10 lux the design would have created one.

**NOT VERIFIED — and load-bearing.** Whether the study tablet's front camera actually drops to
15 fps at the face luminance implied by 10 lux (~1 cd/m²) has *not* been measured. The consequence
above is modelled; the cause is assumed.

The amendment does not depend on settling it — the polarity confound in face illuminance is
arithmetic and holds regardless of how the camera responds to it — but the pilot is worth an
afternoon anyway, because it also establishes the frame rate the study will actually achieve at
300 lux, which bounds the precision of the primary outcome. **The procedure:** run all ten
conditions at 10, 50, 100, 150 and 300 lux and read `effective_fps` and `face_presence_ratio` out
of the export. The app already records both, per condition, with no extra instrumentation.

---

## 3. Why one level is scientifically defensible

### 3.1 The polarity effect on performance does not depend on ambient illumination

The primary published justification is a direct test of exactly this question:

> Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective
> of ambient illumination and colour contrast. *Ergonomics, 50*(7), 1036–1063.
> PMID 17510822 · [doi:10.1080/00140130701306413](https://doi.org/10.1080/00140130701306413)

Verbatim from the abstract: *"proofreading performance was consistently better with positive polarity
… This positive polarity advantage was **independent of ambient lighting (darkness vs. typical office
illumination)** and of chromaticity."*

A study whose whole title is that the polarity effect is irrespective of ambient illumination is
direct evidence that measuring it at one level sacrifices no documented interaction — **for the
performance outcomes**. It licenses nothing about the ocular ones, and is not used to.

The same paper also reports that *"colour contrast (red text on green background) could not
compensate for a lack of luminance contrast"*, which supports this study's existing decision to carry
`wcag_contrast_ratio` as a covariate on the colour factor. Li et al. (2022), *Ergonomics* 65(8),
[doi:10.1080/00140139.2021.2013546](https://doi.org/10.1080/00140139.2021.2013546), reach the same
conclusion under negative polarity: *"higher brightness contrasts led to better legibility; different
background colours with identical brightness and saturation did not cause significant differences."*

### 3.2 The effects that *do* depend on ambient level are the ones the camera cannot measure in the dark

Two verified studies report ambient-dependent effects, and both are on the ocular/tear-film side:

- Lin, M., et al. (2025), *Contact Lens and Anterior Eye* 49(1), 102515.
  [doi:10.1016/j.clae.2025.102515](https://doi.org/10.1016/j.clae.2025.102515) — reading in a **dark
  room with a bright screen** produced the largest effect on every tear-film indicator.
- Fan, Q., Xie, J., Dong, Z., & Wang, Y. (2024), *Sensors* 24(11), 3516.
  [doi:10.3390/s24113516](https://doi.org/10.3390/s24113516) — *"Improvements in ambient lighting
  reduce visual fatigue, but the degree of improvement varies depending on the text color"*: an
  ambient × text-colour interaction, measured with an eye tracker under negative polarity.

Both used dedicated instrumentation — clinical tear-film measures and a laboratory eye tracker — not
a tablet's front camera. **The level being withdrawn is precisely the level at which this study's
instrument would have produced its least trustworthy data, on exactly the outcomes that would have
needed it.** That is the argument in one sentence.

### 3.3 Why 300 lux

- It is the level at which room illumination dominates the screen's contribution to face
  illuminance, collapsing the polarity confound from 2.35× to 1.05× (§2).
- Guidance for screen work places ambient illuminance at roughly 300–500 lux, below the 500–750 lux
  specified for paper tasks, because a display is self-luminous and the screen-to-surround luminance
  ratio must be controlled. **NOT VERIFIED**: these figures come from secondary lighting-industry
  sources, not from EN 12464-1, ISO 9241 or IS 3646 themselves, because this environment's egress
  proxy blocks the standards and publisher domains. They must be checked at source before appearing
  in the thesis. Until then, 300 lux is defended on the photometry above and not on a standards
  citation.
- The accepted band is 250–350 lux, logged at three checkpoints per sitting exactly as before. A
  sitting outside the band is flagged as a protocol deviation, unchanged.

---

## 4. What is given up — stated plainly

**This is not a cost-free change and the write-up must say so.**

1. **The polarity × illumination interaction is no longer estimable.** It was arguably the most
   interesting question in the original design — the claim that dark mode helps in dim environments
   is an interaction claim.

2. **The evidence for that interaction in this study's own age group points to the withdrawn level.**
   Sethi, T., & Ziat, M. (2023), *Ergonomics* 66(12), 1814–1828,
   [doi:10.1080/00140139.2022.2160879](https://doi.org/10.1080/00140139.2022.2160879), tested both
   polarities in bright and dim environments and found higher cognitive load under negative polarity
   *"for older adults in a bright environment and **younger adults in a dim environment**"*. This
   study's sample is young adults. A protocol run only at 300 lux cannot speak to the condition in
   which that effect was located for them.

3. **The night-time domestic reading scenario is gone.** The 10 lux level modelled real behaviour
   that the 300 lux level does not.

4. **Two studies point the other way on raising ambient illumination for near work.** Atuanya et al.
   (2025), *Clinical Optometry* 17, 297–306,
   [doi:10.2147/OPTO.S534389](https://doi.org/10.2147/OPTO.S534389), and Azam et al. (2023),
   *British and Irish Orthoptic Journal* 19(1), 78–84,
   [doi:10.22599/bioj.296](https://doi.org/10.22599/bioj.296), both measured positive fusional
   vergence at 50, 100 and 150 lux in young adults and both found it significantly **lower** at
   higher illumination; Atuanya et al. conclude that *"lower-to-moderate lighting optimises binocular
   coordination during near tasks."* Neither measured above 150 lux, so 300 lux is outside their
   range, and positive fusional vergence is not an outcome here — but the finding is recorded rather
   than omitted.

5. **A caution on what the polarity factor actually is.** Buchner, Mayr & Brandt (2009),
   *Ergonomics* 52(7), 882–886,
   [doi:10.1080/00140130802641635](https://doi.org/10.1080/00140130802641635), report that *"No
   positive polarity advantage was observed when overall display luminance of positive and negative
   polarity displays was equivalent."* This build holds display *white* luminance constant across
   polarities, so mean screen luminance is far higher in the positive conditions by construction.
   That is the standard operationalisation and it is ecologically the right one, but under Buchner
   et al. the effect measured here is a **luminance** effect as much as a polarity effect, and it
   must be described that way. This is true of the design as originally approved; the amendment does
   not create it.

---

## 5. How it is implemented, and why nothing else needed re-auditing

The dim level is **switched off, not removed**. `ILLUMINATION_LEVELS` in
`src/experiment/illumination.ts` is now a single-element list; the `dim` specification stays in the
table and the two-level counterbalancing rule stays in the file, unreached.

Three consequences, all deliberate:

- **A sitting recorded under the dim level still resolves.** No archived or pilot session becomes
  unreadable, and no data migration is required.
- **Every exported column keeps its shape.** `ambient_illumination_level`, `illumination_block` and
  `illumination_order_first` are all still written; they simply carry no variance. The codebook now
  says so explicitly and tells the analyst not to enter them in a model. A pooled file containing
  both old and new data therefore remains separable.
- **Restoring the crossover is a one-line change.** The dormant rule is still under test — it is
  exercised directly rather than through its caller — so if the committee prefers the two-level
  design, what comes back is a mechanism known to work rather than one unverified for however long
  it was switched off.

A participant carrying the old twenty-run crossover is **flagged**, not silently pooled: averaging
two illumination cells into one and calling the result a constant-illumination measurement is
exactly the error the join-integrity check exists to catch.

Gate after the change: 567 unit tests across 41 files, 31 end-to-end tests, export verifier
610/610, lint and type-check clean.

---

## 6. Settled, and still outstanding

**Settled.** The amendment was discussed with the supervisor and cleared by the ethics committee
before data collection began. The thesis title has been revised to *"Effects of Display Polarity and
Text Colour on Visual Fatigue, Ocular Behaviour and Task Performance under Controlled Ambient
Illumination"* — illumination remains in the title because it is still controlled and measured, and
only its status as a manipulated factor has changed. The consent document now describes a single
visit; participant burden falls from roughly 189 minutes across two visits to roughly 98 minutes in
one.

**Still outstanding, and neither blocks collection.**

1. `src/experiment/illumination.ts` justified the original 10/150 lux choice as straddling *"the
   range at which negative-polarity penalties have been reported to emerge."* That claim carried no
   citation in the code and could not be verified. It no longer bears on the design, since neither
   level is now used, but if the two-level rationale is quoted anywhere in the thesis its source
   should be established first.
2. The Letter to the Editor and Reply concerning Lin et al. (2025) have been located
   (PMID 41520503 and 41775136) but are unread — this environment cannot reach the full text. They
   must be read before Lin et al. is cited in the thesis, since a correspondence can change what a
   paper supports.
3. The lighting pilot in §2.1 remains worth running, now for the frame rate it establishes at
   300 lux rather than as evidence for the amendment.

---

## 7. Verification status of every source used here

All items are recorded in `CITATION_VERIFICATION.md` with per-field verification against PubMed.

**Verified and used:** Buchner & Baumgartner (2007); Buchner, Mayr & Brandt (2009); Piepenbrock et
al. (2013, 2014a, 2014b); Mayr & Buchner (2010); Dobres et al. (2016); Sethi & Ziat (2023); Luzsa &
Mayr (2025); Fan et al. (2024); Li et al. (2022); Lin et al. (2025); Atuanya et al. (2025); Azam et
al. (2023).

**Located but unread:** Erdinest & Bura (2026) Letter, and the authors' Reply, concerning Lin et al.

**NOT VERIFIED — must not be cited until checked at source:** EN 12464-1, ISO 9241, IS 3646
illuminance figures; the uncited "straddle" claim in `illumination.ts`; the study tablet's actual
low-light frame-rate behaviour.
