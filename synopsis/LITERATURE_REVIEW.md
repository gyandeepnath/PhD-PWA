# Review of Literature

## Display Polarity and Text Colour as Determinants of Reading Performance, Sustained Attention and Visual Fatigue during Prolonged Tablet Reading

**Prepared for: Ph.D. Synopsis Presentation (pre-registration)**
**Document type:** Review of literature, critical synthesis, identification of research gaps, and derivation of aim, objectives and hypotheses.

---

### How to read this document

Section 1 states the problem context. Section 2 documents the review methodology (search strategy and sources), so that the review is auditable. Sections 3–13 are the thematic review, each closing with a short **critical appraisal** that states what is established, what is contested, and what remains unknown. Section 14 synthesises the evidence into a **numbered gap register (G1–G10)**. Sections 15–18 derive the **problem statement, aim, objectives, hypotheses and conceptual framework** directly from those gaps, so that every objective is traceable to a documented deficiency in the literature. Sections 19–22 set out the proposed methodological outline, expected outcomes, applications and limitations. Section 23 is the reference list; Appendix A and B are evidence tables.

**Source attribution.** Bibliographic records for the biomedical and vision-science literature cited in this review were retrieved from **PubMed** (U.S. National Library of Medicine). Every retrieved record is cited below with its Digital Object Identifier (DOI) as a resolvable link. Non-biomedical sources (human-factors, ergonomics, educational-psychology and computer-vision literature, and technical standards) were identified through targeted literature searching and are cited with DOIs or canonical identifiers where these exist. Items whose bibliographic details could not be independently verified are explicitly flagged as such and are **not** relied upon for any substantive claim (see §2.4).

---

## 1. Introduction and background

### 1.1 The digital reading transition

Reading has undergone a substantive migration from reflective print to self-luminous digital displays. Tablets and comparable handheld devices now mediate a substantial share of sustained reading in education, professional work and leisure. Unlike print, a self-luminous display is an active light source whose polarity (whether text is dark-on-light or light-on-dark), chromaticity, luminance and contrast are all software-configurable design parameters. Each of these parameters is set, in practice, by interface designers and by user-selectable "themes" — most visibly the now-ubiquitous "dark mode" — largely in the absence of a settled evidence base regarding their consequences for visual health and reading performance.

This matters because the visual and ocular consequences of prolonged display use are neither rare nor trivial. A systematic review and meta-analysis of 103 cross-sectional studies comprising 66,577 participants estimated the pooled prevalence of computer vision syndrome (CVS) at **69.0% (95% CI 62.3–75.3)**, with individual study estimates ranging from 12.1% to 97.3% [1]. Prevalence was higher in women than men (71.4% vs 61.8%), higher among university students (76.1%), and higher in contact-lens wearers (73.1% vs 63.8%) [1]. Narrative and comprehensive reviews converge on a similar order of magnitude and document a further rise associated with pandemic-era remote learning and work, with reported prevalence in children rising to 50–60% [2–5].

### 1.2 Terminology

Two labels dominate the literature and are used near-synonymously: **computer vision syndrome (CVS)** and **digital eye strain (DES)**. Both denote the constellation of ocular and visual symptoms arising from prolonged use of digital devices — dry eye, irritation and burning, foreign-body sensation, watering, blurred vision, difficulty refocusing, headache and photophobia — together with associated non-ocular musculoskeletal complaints such as neck, shoulder and back discomfort [2,3,6,7]. This review uses **DES** when referring to the symptom entity and **CVS** when referring to the literature and instruments that use that term (notably the CVS-Q). A significant, and explicitly acknowledged, weakness of the field is the absence of a standardised operational definition; the prevalence meta-analysis concludes with a direct call for future studies to "standardize a definition of CVS" [1].

### 1.3 Why display polarity and text colour are the right lever

Interventions for DES have been studied extensively and, on the whole, disappointingly. A systematic review and meta-analysis of 45 randomised controlled trials involving 4,497 participants found **no high-certainty evidence supporting any of the analysed therapies** [8]. Specifically: multifocal lenses did not improve visual-fatigue scores relative to single-vision lenses (3 RCTs; SMD 0.11, 95% CI −0.14 to 0.37); blue-blocking spectacle lenses did not reduce visual-fatigue symptoms (3 RCTs, low-certainty evidence); oral berry-extract supplementation improved neither visual fatigue (7 RCTs; SMD −0.27, 95% CI −0.70 to 0.16) nor dry-eye symptoms; only oral omega-3 supplementation showed a low-certainty benefit for dry-eye symptoms [8]. An independent systematic review restricted to studies using a validated DES questionnaire in pre-presbyopic users likewise found **no evidence for blue-blocking filters**, while supporting optimisation of ergonomic parameters and restriction of screen-use duration [9].

The negative findings for filters and supplements are informative: they redirect attention to the **antecedent** rather than the palliative — that is, to the properties of the displayed stimulus itself. Display polarity, text chromaticity and luminance contrast are (i) causally upstream of the visual load, (ii) zero-cost to modify in software, (iii) universally deployable at population scale, and (iv) already being modified aggressively by industry and by users, without evidence. This is the lever the present research programme addresses.

---

## 2. Review methodology

### 2.1 Objective of the review

To locate, appraise and synthesise the empirical evidence concerning (a) the effects of display polarity, text colour and luminance contrast on reading performance and visual fatigue; (b) the validated subjective and objective measurement of digital eye strain; and (c) the methodological adequacy of consumer-grade (webcam-based) ocular measurement — in order to identify defensible research gaps and derive a scientifically sound doctoral research design.

### 2.2 Information sources and search strategy

The primary bibliographic source was **PubMed/MEDLINE**, searched through the National Library of Medicine's E-utilities interface. Because the relevant human-factors, ergonomics, typographic-legibility, educational-psychology and computer-vision literatures are incompletely indexed in PubMed, these were searched additionally through general and scholarly web search, with candidate records subsequently verified in PubMed where indexed, and otherwise verified against publisher records.

Search concepts were combined across the following blocks:

1. **Condition:** digital eye strain; computer vision syndrome; asthenopia; visual fatigue; dry eye; video display terminal.
2. **Exposure:** display polarity; positive/negative polarity; dark mode; text–background colour; contrast; luminance; ambient illumination; character size.
3. **Outcome — performance:** reading performance; reading speed; proofreading; legibility; comprehension; visual search; reaction time; vigilance; sustained attention.
4. **Outcome — ocular:** blink rate; incomplete blinking; blink amplitude; tear film stability; PERCLOS; accommodation; accommodative response; pupil size; critical flicker fusion.
5. **Instruments:** CVS-Q; Computer Vision Symptom Scale; validation; psychometric properties.
6. **Measurement technology:** eye aspect ratio; facial landmarks; webcam eye tracking; remote eye tracking; MediaPipe.
7. **Standards:** WCAG contrast ratio; perceptual contrast.

### 2.3 Selection principles

Priority was given, in descending order, to: (i) systematic reviews and meta-analyses; (ii) validation studies of measurement instruments; (iii) controlled experimental studies with objective outcome measurement; (iv) authoritative narrative reviews; (v) technical standards. Studies were retained when they addressed a display-parameter manipulation, a validated fatigue/performance outcome, or the metrological properties of a measure used in the proposed research. No date restriction was imposed, because several foundational polarity and legibility findings predate 2010 and remain the primary evidence; however, contemporary reviews (2018–2025) were preferred for epidemiology and for intervention evidence.

### 2.4 Verification discipline and stated limitations of this review

Every substantive claim in this review is attributed to a source whose bibliographic record was retrieved and inspected. Where a source is a conference proceeding or a technical/standards document without a journal DOI, this is stated explicitly in the reference list. Three specific transparency notes apply:

- **Reference [35]** (the eye-aspect-ratio method) is a peer-reviewed **workshop proceedings** paper, not a journal article; it is cited as the methodological origin of the metric, and the *validity* of the metric for the present application is argued separately from empirical vision-science sources (§11).
- **Reference [37]** (the Advanced Perceptual Contrast Algorithm) is a **draft/candidate technical specification**, not peer-reviewed research. It is cited only to document that the limitations of the current contrast standard are formally recognised, not as evidence of any empirical effect.
- This review is a **narrative/critical review with a documented search strategy**, not a PRISMA-registered systematic review. Where pooled estimates are quoted, they are quoted from published systematic reviews and meta-analyses [1,8,9], not computed here. This is an acknowledged limitation and is stated as such in §22.

---

## 3. The clinical entity: symptomatology and pathophysiology of digital eye strain

### 3.1 The two-mechanism model

The most useful organising framework in the literature partitions DES symptoms into **two mechanistically distinct clusters** [3]:

1. **Accommodative and vergence (binocular) stress** — difficulty focusing, blurred vision, near-work-induced transient myopia, headache. These arise from the sustained near-focus demand and the vergence–accommodation load of prolonged display work.
2. **Ocular-surface (external) symptoms** — dryness, burning, irritation, foreign-body sensation, watering. These arise principally from altered blinking behaviour and consequent tear-film instability.

This partition is clinically consequential because the two clusters have different antecedents, different time courses and different objective correlates; and, critically for measurement design, because **a single composite symptom score can conflate them**. Reviews consistently note that the pathophysiology remains "poorly understood" and multifactorial, with heterogeneous and partly dated evidence for the accommodative/vergence component and considerably more consistent evidence for the ocular-surface component [6].

### 3.2 The ocular-surface pathway

The mechanistic chain for the ocular-surface pathway is comparatively well described. Display use reduces spontaneous blink rate and increases the proportion of **incomplete** blinks; incomplete blinking enlarges the effectively exposed evaporative area of the ocular surface and impairs the distribution of meibomian lipid across the tear film; the resulting tear-film instability raises tear osmolarity and initiates ocular-surface inflammation, entering the recognised vicious cycle of dry eye disease [10,11]. A dedicated review of candidate mechanisms concluded that visual display terminal (VDT) use causes dry eye disease "mainly through impaired blinking patterns", while noting that proposed contributions from altered parasympathetic signalling and blue-light exposure lack sufficient scientific support at present [11].

### 3.3 Risk factors

Converging evidence identifies exposure duration (screen use beyond approximately 4–5 hours per day), uncorrected refractive error including presbyopia, accommodative and vergence anomalies, altered blinking pattern, closer working distance, smaller font size, poor ergonomic parameters, adverse ambient lighting and glare, female sex, and contact-lens wear as risk factors for DES [1,3,7,9].

> **Critical appraisal.** *Established:* DES is highly prevalent; the ocular-surface pathway operates principally via reduced and incomplete blinking; exposure duration and ergonomics are modifiable risk factors. *Contested:* the accommodative/vergence contribution (heterogeneous, partly old evidence); the causal role of blue light (in-vitro retinal toxicity is demonstrated but has not been translated into evidence linking blue light to DES symptoms) [6]. *Unknown:* the extent to which the **displayed stimulus configuration itself** — polarity, chromaticity, contrast — modulates either pathway during prolonged, ecologically valid reading. Notably, the two most authoritative risk-factor syntheses list font size and ambient lighting but **do not** list text colour or display polarity among established, evidence-supported risk factors [7,9] — not because they have been excluded, but because they have not been adequately tested. This absence is the point of entry for the present research.

---

## 4. Display polarity: the positive polarity advantage

### 4.1 The core empirical finding

The most robust single finding in the display-legibility literature is the **positive polarity advantage (PPA)**: reading performance is superior for dark text on a light background (positive polarity) relative to light text on a dark background (negative polarity).

In a systematic series of experiments, proofreading performance was consistently better with positive than with negative polarity, and — importantly for the present design — this advantage was **independent of ambient lighting** (darkness vs typical office illumination) and **independent of chromaticity** (black-and-white vs blue-and-yellow) [12]. Two further features of that study deserve emphasis. First, physiological indices of effort and strain (breathing rate, heart rate, heart-rate variability, skin conductance) and self-reported mood, fatigue, arousal, eyestrain, headache, muscle strain and back pain **did not vary** across conditions, indicating that participants expended comparable effort in all conditions and that the performance difference was not an artefact of an effort–performance trade-off [12]. Second, a final experiment showed that **colour contrast (red text on green background) could not compensate for a lack of luminance contrast** [12]. The methodological implication of this last result is substantial and is developed in §5.3.

### 4.2 The mediating mechanism: display luminance → pupil size → retinal image quality

The dominant explanation of the PPA is the **display luminance hypothesis**: positive polarity presentations have higher overall luminance, which drives pupillary constriction, which reduces optical aberrations and increases depth of focus, which sharpens the retinal image and thereby improves the perception of fine detail.

This hypothesis has received direct and convergent support:

- **Pupillometric test.** Pupil size was measured while participants proofread positive- and negative-polarity texts. Pupil sizes were **smaller** and proofreading performance **better** with positive polarity, as the hypothesis predicts [13].
- **Character-size interaction.** If the PPA operates through retinal-image sharpness, it should matter most when the visual task is limited by spatial detail. Exactly this was found: across character sizes of 8, 10, 12 and 14 pt (0.22°, 0.25°, 0.31°, 0.34° of vertical visual angle), the PPA **increased linearly as character size decreased** [14]. The authors' applied conclusion is direct: "Especially with small font sizes, negative polarity displays should be avoided" [14].
- **Ambient-illumination interaction.** Using a lexical-decision paradigm to measure legibility thresholds under glance-like reading, legibility thresholds were **worst for negative polarity under dark ambient illumination**, whereas positive polarity under dark illumination and all conditions under bright illumination showed significantly lower (better) thresholds [15]. This is consistent with the pupillary account: under dark ambient conditions a negative-polarity display supplies little light, the pupil dilates, aberrations increase and legibility degrades.
- **Generality across typefaces, sizes and age.** In psychophysical work using an adaptive staircase, stimulus-duration thresholds were sensitive to polarity as well as to typeface and size, with black-on-white significantly more legible than white-on-black; typeface interacted with age, particularly for conditions with higher legibility thresholds [16].

### 4.3 Boundary conditions and recency

The PPA is not confined to conventional displays: it has recently been reported in virtual and video see-through mixed reality, with better proofreading performance and faster optotype identification under positive polarity [17]. Its persistence across display technologies strengthens the inference that the mechanism is optical/physiological rather than an artefact of any particular hardware.

> **Critical appraisal.** *Established:* the PPA is a robust, replicated legibility and short-task-performance effect, mechanistically attributable to display luminance acting through pupil size and retinal image quality; it is strongest for small characters and for dark ambient conditions [12–17]. *Contested:* whether it generalises beyond achromatic (and a small number of chromatic) text to the full space of coloured text used in real interfaces. *Unknown — and this is the decisive gap:* whether the PPA extends from **short-duration legibility and proofreading tasks** to **prolonged reading with accumulating visual fatigue and ocular-surface consequences**. The polarity literature is dominated by proofreading, lexical-decision and glance-reading paradigms of minutes' duration, with performance-threshold outcomes. With the notable exception of Buchner and Baumgartner's null findings on self-reported strain and autonomic indices in short sessions [12], this literature does **not** measure blink behaviour, tear-film-relevant outcomes, validated symptom instruments, comprehension, or sustained attention over an hour-scale session. A "positive polarity advantage" in legibility does not license an inference of "positive polarity advantage in visual fatigue" — and the field's dark-mode discourse routinely makes exactly that unlicensed inference in both directions.

---

## 5. Text colour, luminance contrast, and the contrast confound

### 5.1 Chromatic text: the two closest studies

Only a small number of studies manipulate text chromaticity systematically. Two are close enough to the present proposal to be treated as the immediate prior art.

**(a) Jiménez et al. (2019)** measured accommodative and pupillary dynamics continuously with a binocular open-field autorefractometer while twenty healthy young adults read fourteen 2-minute passages rendered in **fourteen different text–background colour combinations** on an LCD screen [18]. Findings:

- Text–background colour combination **significantly modulated accommodative and pupillary dynamics** across a 2-minute reading task.
- The **blue-on-red** combination induced a heightened accommodative response.
- **Positive polarities** were associated with **greater variability of the accommodative response** and **smaller pupil sizes**.
- Combinations with **lower luminance contrast** (white-on-yellow) received **lower perceived legibility ratings**.
- Manipulation of text–background colour had **no significant effect on reading speed**.

**(b) Fan et al. (2024)** examined ambient illumination and text colour **under negative polarity only**, collecting pupil-accommodation and blink-rate data via an eye tracker during a reading task [19]. Findings:

- Text colour **significantly affected visual fatigue**: **red text produced the highest** visual fatigue and **yellow text the lowest**.
- Improving ambient lighting **reduced** visual fatigue, but **the magnitude of improvement depended on text colour** (i.e. an ambient-illumination × text-colour interaction).
- **Cognitive performance** was better with yellow and white text and worse with red text.
- The authors' design recommendation: yellow text is the most effective choice for reducing visual fatigue under negative polarity, and increasing ambient lighting improves visual fatigue in low-illumination conditions [19].

### 5.2 Reading the two studies against each other

These two studies are complementary in coverage but only partially reconcilable, and the tension between them is itself informative.

- **Outcome divergence.** Jiménez et al. found colour modulated *ocular physiology* but **not reading speed** [18]; Fan et al. found colour affected both *visual fatigue* and *cognitive performance* [19]. One plausible reconciliation is exposure duration: 2-minute passages [18] may be too brief for performance decrements to emerge, whereas fatigue-relevant differences require accumulation. If so, **duration is a moderator that neither study was designed to estimate** — a direct argument for a longer, ecologically valid protocol.
- **Coverage divergence.** Jiménez et al. crossed many colour combinations but did not measure symptom-level visual fatigue with a validated instrument, nor comprehension, nor attention [18]. Fan et al. measured visual fatigue but examined **only negative polarity**, precluding any statement about polarity × colour interaction [19].
- **Convergence on chromatic specificity.** Both implicate specific chromaticities as physiologically non-equivalent: red is adverse in Fan et al. [19], and long-wavelength/short-wavelength pairings (blue-on-red) heightened accommodative response in Jiménez et al. [18]. Yellow is *favourable* under negative polarity [19] yet *low-contrast and poorly rated* when paired with white [18] — which is precisely the signature of a **contrast-dependent, not hue-dependent, effect**.

### 5.3 The contrast confound: a methodological mandate from the literature

The single most important methodological lesson available from this literature is Buchner and Baumgartner's demonstration that **colour contrast cannot substitute for luminance contrast** [12]. Combined with the pupillary mechanism of the PPA [13–15] and with the observation that low-luminance-contrast colour pairs are rated less legible [18], this yields an unavoidable inference:

> In any study that manipulates text colour, the **luminance contrast** of each colour pair is a covarying property of the stimulus. Unless luminance contrast is explicitly quantified and modelled, any apparent "effect of text colour" is uninterpretable — it may be wholly or partly an effect of contrast.

This is not a hypothetical concern. Because chromatic pigments differ intrinsically in relative luminance (yellow is high-luminance; blue is low-luminance), a fixed set of text colours rendered on a fixed light background and on a fixed dark background will **necessarily** produce unequal, and polarity-asymmetric, luminance contrasts. Any design of this form therefore embeds a **polarity × contrast entanglement** by construction. The literature's mandate is that such a design must (i) compute and report the luminance contrast of every condition, (ii) treat contrast as a modelled covariate rather than an ignorable nuisance, and (iii) frame the inferential question as polarity **and** contrast, or explicitly as **polarity × contrast**, rather than as "polarity vs colour".

### 5.4 Which contrast metric? The inadequacy of a single standard

Three metrics are in circulation, and the choice is consequential.

- **WCAG 2.x contrast ratio.** The W3C Web Content Accessibility Guidelines define contrast ratio as (L₁+0.05)/(L₂+0.05) over relative luminance computed from linearised sRGB, with the well-known thresholds of 4.5:1 (AA, normal text), 3:1 (AA, large text) and 7:1 (AAA) [36]. This is the de facto standard in interface design and accessibility compliance, and its use makes findings directly actionable for practitioners.
- **Michelson contrast.** (L_max − L_min)/(L_max + L_min), the classical psychophysical modulation metric, bounded in [0,1] and appropriate for periodic/patterned stimuli.
- **Perceptual alternatives.** The WCAG 2.x formula is subject to substantive, formally recognised criticism: it does not account for text size or weight, and — most relevant here — it does **not** account for polarity, and is held to **overstate** contrast for dark colour pairs, such that nominally compliant light-on-dark combinations can be functionally difficult to read and can produce halation and reported eye strain, particularly with highly saturated colours [37]. A candidate perceptual replacement (APCA) that incorporates polarity and typography is under development for a future generation of the guidelines [37].

The convergence of this critique with the empirical polarity literature is striking and should be stated plainly: an accessibility standard that is **polarity-blind** is being used to certify the readability of interfaces in a domain where **polarity is one of the strongest replicated determinants of legibility** [12–17]. This is a live scientific problem, and a study that measures polarity, chromaticity, computed contrast (by more than one metric) and photometrically measured display luminance simultaneously is positioned to speak to it.

> **Critical appraisal.** *Established:* text–background colour combination modulates accommodative and pupillary dynamics [18]; under negative polarity, text colour affects visual fatigue and cognitive performance, with red adverse and yellow favourable, and interacts with ambient illumination [19]; colour contrast cannot compensate for absent luminance contrast [12]. *Contested:* whether colour affects reading *speed* at all [18] versus performance more broadly [19] — plausibly a duration-moderated discrepancy. *Unknown:* the polarity × text-colour interaction on fatigue outcomes (never tested — Fan et al. held polarity constant [19]); the behaviour of these effects over an hour-scale session; whether hue exerts any effect independent of luminance contrast. *Metrological gap:* no study in this space simultaneously reports WCAG contrast, an alternative contrast metric, and measured display photometry, which is what would be required to separate hue, contrast and luminance.

---

## 6. Ambient illumination as a moderator

Ambient illumination enters the causal picture at three points: it changes the effective contrast of the display by adding veiling luminance and glare; it changes pupil size independently of the display, thereby interacting with the very mechanism that produces the PPA; and it is a documented risk factor for DES [7,9].

The empirical picture is consistent with that mechanistic account. Legibility thresholds under glance-like reading were worst for negative polarity under near-dark ambient illumination, and improved markedly either by switching to positive polarity or by raising ambient illumination [15] — that is, **polarity and ambient illumination trade off against each other**, exactly as a pupil-mediated account predicts. Independently, raising ambient illumination reduced visual fatigue under negative polarity, but by an amount that depended on text colour [19]. Against this, the proofreading PPA itself was found to be *independent* of ambient lighting across darkness and typical office illumination [12], suggesting the interaction may be threshold-like — appearing at the extremes of illumination and in threshold-limited tasks, rather than scaling smoothly.

> **Critical appraisal.** *Established:* ambient illumination modulates the legibility cost of negative polarity [15] and the fatigue cost of coloured text under negative polarity [19]. *Contested:* whether ambient illumination moderates the PPA in supra-threshold, sustained reading; [12] found independence, [15] found interaction, and the two used different paradigms and illumination ranges. *Implication for design:* ambient illuminance must be **measured and controlled** (not merely described), and display luminance must be measured photometrically, or ambient conditions become an uncontrolled moderator capable of reversing conclusions.

---

## 7. Reading performance and comprehension on digital media

### 7.1 The screen-inferiority effect

A separate and mature literature compares comprehension across reading media. A meta-analysis of the effects of reading medium on comprehension reported an advantage for print over screen reading, moderated by text genre and by time constraint — the effect being more pronounced for **expository** (rather than narrative) texts and when **reading time is limited** [20]. The dominant explanation, the *shallowing hypothesis*, holds that screens promote shallower processing and/or impose greater cognitive load than print.

### 7.2 What this implies for the present design — and what it does not

Two implications follow, and they cut in opposite directions.

First, a **within-screen** design (in which every condition is presented on the same tablet, and only polarity and text colour vary) is methodologically preferable for the present question, because it removes the medium confound entirely: all conditions inherit whatever screen-inferiority exists, so it cannot differentiate the conditions. The comparison of interest is *within* the digital medium.

Second, and more cautionary: because the medium effect is moderated by **time pressure** and by **text genre** [20], a comprehension measure embedded in a display-parameter study must standardise both. Passage genre and difficulty must be controlled or counterbalanced, and time pressure must be either eliminated (self-paced reading) or held strictly constant. Otherwise a genuine display effect may be masked by, or confounded with, genre and pacing variance.

Third, an explicitly psychometric caution: comprehension assessed by a small number of items per condition is a low-information measure. The reliability of a difference score between conditions is bounded by the reliability of the constituent measures, and single-item-per-condition designs are, in general, inadequate for detecting the modest effect sizes plausible for a display-parameter manipulation. Any design in this space must therefore budget an adequate number of comprehension items per condition, or explicitly acknowledge that comprehension is a secondary, exploratory outcome rather than a confirmatory one.

> **Critical appraisal.** *Established:* print exceeds screen for comprehension on average, moderated by genre and time pressure [20]. *Not applicable, and important to state:* this literature does **not** speak to *within-screen* display-parameter effects; it must not be cited as evidence that dark mode or coloured text impairs comprehension. *Implication:* it constrains the *measurement* of comprehension (genre control, pacing control, item count) rather than the hypothesis under test.

---

## 8. Sustained attention, vigilance and time-on-task

### 8.1 The vigilance decrement

Prolonged, monotonous visual tasks produce a reliable **vigilance decrement**: performance declines with time on task. The leading theoretical account is a **resource-depletion** ("resource theory") account, under which sustained attention consumes limited information-processing resources that must be replenished; the competing account attributes the decrement to the under-arousing, "mindless" nature of such tasks [21]. Experimental work comparing task types has supported the resource account, with evidence that the workload of vigilance is high, sensitive to processing demands, and subjectively stressful, and that the decrement reflects **limitations in effortful attention rather than mindlessness** [21].

### 8.2 Why this is central rather than peripheral to the present research

Three consequences follow for a study of prolonged reading under varying display parameters.

1. **Attentional outcomes and visual-fatigue outcomes share a driver.** Both degrade with time on task. A study that measures only visual fatigue over an hour-scale session cannot distinguish display-induced ocular fatigue from generic task-induced attentional decline. Measuring **both** — and modelling serial position — is therefore not an optional extra but a requirement for interpretability.
2. **Time-on-task must be counterbalanced.** If conditions were presented in a fixed order, the vigilance decrement would be perfectly confounded with condition. A balanced counterbalancing scheme is mandatory (see §12).
3. **Vigilance is effortful and stressful, not mindless** [21] — hence **disengagement and boredom are genuine threats to data quality**, not merely nuisances. They mimic visual fatigue phenomenologically (slower and more variable responses, lapses, careless responding) and must therefore be measured and either modelled or used as exclusion criteria, rather than assumed absent.

### 8.3 Measurement of sustained attention

The reference paradigm for fatigue-sensitive sustained attention is the **Psychomotor Vigilance Test (PVT)**, which has been extensively validated as sensitive to deficits in attention arising from sleep loss and circadian misalignment, and which yields **lapses** (long reaction times) and reaction-time variability as its principal fatigue-sensitive indices [22]. Reaction-time *variability* and lapse frequency are generally more sensitive to fatigue than mean reaction time. Signal-detection-theoretic analysis (sensitivity d′ and response bias c) additionally permits separation of perceptual sensitivity from decision criterion, which is desirable when a display manipulation may plausibly affect stimulus discriminability.

> **Critical appraisal.** *Established:* time-on-task produces a resource-limited vigilance decrement; lapses and RT variability are its sensitive indices [21,22]. *Implication:* sustained attention should be an outcome domain in its own right; serial position must be counterbalanced and modelled; and disengagement must be instrumented.

---

## 9. Subjective measurement of digital eye strain

### 9.1 Validated instruments

Contemporary reviews identify **two** validated, widely used DES questionnaires: the **Computer Vision Syndrome Questionnaire (CVS-Q)** and the **Computer Vision Symptom Scale (CVSS17)** [4].

The **CVS-Q** was developed and validated with explicit psychometric method [23]. It assesses the **frequency and intensity of 16 symptoms** on a single rating scale that fits the **Rasch** rating-scale model; content validity was established with expert panels across occupational health, optometry and ophthalmology; criterion validity yielded **sensitivity and specificity both above 70%**; and test–retest reliability was good, with an **intraclass correlation coefficient of 0.802 (95% CI 0.673–0.884)** for scores and **Cohen's κ = 0.612 (95% CI 0.384–0.839)** for CVS classification [23]. The instrument has since been cross-culturally adapted and re-validated in further languages, with a Portuguese validation in 280 workers reporting Cronbach's α = 0.793, ICC = 0.847 (95% CI 0.764–0.902), sensitivity 78.5%, specificity 70.7%, area under the ROC curve 0.832 (95% CI 0.784–0.879), convergent validity with the Ocular Surface Disease Index (Spearman ρ = 0.728, p < 0.001), a single-factor structure accounting for 37.7% of common variance, and a cut-off of ≥7 points [24]; and an Italian adaptation reporting a CVS prevalence of 62.5% in its validation sample [25].

### 9.2 Instrument choice is not neutral

An important, easily overlooked finding from the prevalence meta-analysis: pooled CVS prevalence was **higher in studies that did *not* use the CVS-Q (75.4%)**, and in meta-regression, use of the CVS-Q scale was **associated with a lower estimated prevalence** [1]. In other words, non-validated ad hoc symptom checklists appear to inflate prevalence. This is direct empirical justification for using a validated instrument with a defined cut-off, rather than a bespoke symptom list, as the primary subjective endpoint.

### 9.3 The subjective–objective dissociation

A recurring and unresolved problem is stated bluntly in the authoritative review literature: DES may be measured by questionnaire, or by objective evaluation of parameters such as critical flicker-fusion frequency, blink rate and completeness, accommodative function and pupil characteristics — but **"correlations between objective and subjective measures are not always apparent"** [3].

This dissociation is not a nuisance to be explained away; it is arguably one of the central metrological problems of the field. It has at least three candidate explanations, which are not mutually exclusive: (i) the two-cluster structure of DES [3] means a composite subjective score and a single objective marker may index different mechanisms; (ii) objective markers such as blink rate are multiply determined (see §10.3) and hence poor proxies for symptom burden; (iii) symptom report is subject to expectation and demand effects, particularly where the manipulation is visible to the participant (as any display-polarity manipulation necessarily is).

> **Critical appraisal.** *Established:* the CVS-Q is a psychometrically sound, cross-culturally validated instrument with a defined cut-off [23–25], and instrument choice materially affects prevalence estimates [1]. *Unresolved:* the poor and inconsistent correspondence between subjective and objective indices [3]. *Implication:* a defensible design must (i) use a validated primary subjective endpoint, (ii) co-register subjective and objective measures **within the same session and condition** so that their correspondence can be estimated rather than assumed, and (iii) treat any bespoke supplementary rating scale as exploratory unless its own reliability is established in-sample.

---

## 10. Objective ocular markers of visual fatigue

### 10.1 Blink rate

Reduced spontaneous blink rate during display use is among the most reproducible objective findings in this field [3,10,11]. Quantitatively, in a controlled 15-minute reading task at 50 cm, mean blink rate was **11.6 blinks per minute (SD 7.84)** [26]; in a study of six controlled reading conditions, **all** reading conditions reduced spontaneous blink rate relative to a non-reading baseline (all p < 0.001), with the smallest reduction for text presented at 330% magnification [27]; and during computer game play, blink rate fell to approximately **one-third** (fast-paced) and **one-half** (slow-paced) of baseline levels [28].

### 10.2 Incomplete blinking: the marker with the strongest claim to specificity

The proportion of blinks that fail to achieve complete lid closure has emerged as a marker of particular interest, for two reasons: it is mechanistically tied to tear-film instability [10,11,29], and it appears to discriminate the display context specifically.

The pivotal evidence:

- **Association with symptoms.** In a 15-minute desktop reading task, the percentage of incomplete blinks ranged from 0.9% to 56.5% across participants (mean 16.1%, SD 15.7), and a **significant positive correlation was observed between total symptom score and the percentage of incomplete blinks (p = 0.002)**, alongside a significant negative correlation between blink score and symptoms (p = 0.035) [26].
- **Specificity to electronic media.** Comparing six controlled reading conditions (tablet; computer display at 100% and 330% zoom; hard-copy in book position silently and aloud; hard copy pasted on the display), **all** conditions reduced blink rate, but the percentage of incomplete blinks increased **only when reading was conducted on an electronic platform**, not with hard copy [27]. The authors' interpretation is that incomplete blinking "may account for the symptoms experienced by VDT users" [27].
- **Causal link to tear-film instability.** During a 60-minute computer task, total blink rate changed little while complete and incomplete blink rates fluctuated reciprocally; non-invasive (ring) break-up time fell significantly from 8.62 ± 1.54 s at baseline to 4.33 ± 2.57 s at 30 minutes (p < 0.01), and recovered as incomplete blinking declined. The authors concluded that **"even if the total blink rate decreases, the tear film remains stable so long as almost all blinks are complete"** — tear-film stability is determined by blinking *quality*, not merely quantity [29].
- **Sensitivity to task dynamics.** Blink rate, blink amplitude and tear-film stability were all more compromised during a more dynamic (faster-paced) display task of equal cognitive demand, implicating the *rate of visual information presentation* and not cognitive load alone [28].

### 10.3 A crucial interpretive caution: blink rate is not a fatigue thermometer

Three findings jointly forbid a naive "lower blink rate = more fatigue" reading.

1. Blink rate is reduced by **reading itself**, regardless of medium [27], and further reduced by **higher task dynamism** at matched cognitive demand [28]. It therefore indexes visual/cognitive engagement as much as fatigue.
2. **Total** blink rate can remain essentially unchanged while the clinically consequential quantity — the complete/incomplete composition — fluctuates substantially [29].
3. Most tellingly, **experimentally increasing blink rate did not help.** Raising mean blink rate from 11.6 to 23.5 blinks per minute by means of an audible tone every 4 seconds produced **no significant change in symptom score** [26]. The authors' conclusion is that blink *completeness* may be at least as important as blink rate, and that "actions to achieve complete corneal coverage during blinking may be more helpful" [26].

The methodological consequence is direct: **incomplete-blink ratio, referenced to a within-participant baseline, is a better-justified primary ocular marker for computer-related visual fatigue than blink rate alone**, and blink rate should be interpreted only against a baseline and in conjunction with blink quality.

### 10.4 Accommodative and pupillary measures

Accommodative response, accommodative variability, near-work-induced transient myopia (NITM) and pupil size are established objective indices in this domain [3,18,30]. They are sensitive to display parameters: text–background colour modulates accommodative and pupillary dynamics over even a 2-minute task [18]. They are also sensitive to workload management: in a 40-minute reading task under four break schedules, participants reported greater "eye irritation or burning" and greater eye strain in the no-break condition than in the frequent-break (every 10 min) and self-paced-break conditions; accommodative variability was greater in the no-break and 3-break conditions during the final interval; and NITM was higher in the no-break condition, with faster NITM decay under frequent breaks [30]. Accommodative *lag* did not differ across conditions [30].

These measures, however, require a binocular open-field autorefractometer (e.g. Grand Seiko WAM-5500) [18,30] — laboratory instrumentation that is neither portable nor scalable, which is precisely the constraint motivating §11.

### 10.5 PERCLOS: a drowsiness measure, not a CVS measure

**PERCLOS** — the percentage of time the eyes are more than 80% closed — is described as "one of the most validated indices used for the passive detection of drowsiness" [31]. It increases with sleep deprivation, after partial sleep restriction, at night, and under other drowsiness manipulations, across vigilance tests, simulated driving and on-road driving [31]. Empirically, following 24 hours of total sleep deprivation, professional drivers showed significantly more eyelid closure (p < 0.05), greater variation in lane position (p < 0.01) and more attentional lapses (p < 0.05), with PERCLOS moderately associated with variability in vigilance performance (r = 0.68, p < 0.05) and with lane-position variation (r = 0.61, p < 0.05) [32]. PERCLOS is also identified, alongside the PVT, as a technology for detecting transient fatigue in safety-sensitive settings [22].

Its limitations are, however, explicitly documented: PERCLOS has failed to track drowsiness manipulations in **moderate** drowsiness conditions, in **older adults**, and during **aviation-related tasks**; **no single index** is currently an optimal drowsiness marker in real-world settings; and the review calls for standardisation of the PERCLOS definition across studies, extensive single-device validation, and integration with other behavioural/physiological indices, since "PERCLOS alone may not be sufficiently sensitive for detecting drowsiness caused by factors other than falling asleep, such as inattention or distraction" [31].

The implication for the present research is a precise scoping statement: over an hour-scale session, **sleepiness is a genuine confounder of visual-fatigue measurement**, and PERCLOS is the best-validated available index of it. PERCLOS should therefore be measured and used as a **covariate/confound control**, and must **not** be reported as a measure of computer-related visual fatigue — a conflation that would be unsupported by the cited validation literature.

### 10.6 Critical flicker fusion

Critical flicker-fusion (CFF) frequency is listed among the objective indices of visual fatigue [3]. Its status is, however, weak: in the intervention meta-analysis, oral carotenoid supplementation produced a statistically significant CFF change of 1.55 Hz (95% CI 0.42–2.67; p = 0.007) relative to placebo, but the authors explicitly note that **"the clinical significance of this finding is unclear"** [8]. CFF is therefore best regarded as a secondary index of uncertain interpretive value.

> **Critical appraisal.** *Established:* reduced blink rate during display use [3,26–28]; incomplete-blink ratio correlates with symptoms [26], rises specifically with electronic reading [27], and mechanistically drives tear-film instability [29]; accommodative variability and NITM respond to break schedules [30]; PERCLOS is a validated drowsiness index [31,32]. *Contested/limited:* blink rate as a fatigue index (confounded by engagement and task dynamism, and unresponsive to experimental manipulation of rate) [26–28]; CFF's clinical meaning [8]; PERCLOS outside frank sleepiness [31]. *Unknown:* the sensitivity of the incomplete-blink ratio to *display-parameter* manipulations specifically — every study cited above manipulated medium, task dynamism, duration or breaks, **not polarity or text colour**.

---

## 11. Scalable measurement: consumer-grade ocular metrology

### 11.1 The problem

The best-validated objective markers require specialist instrumentation: open-field autorefractometry for accommodation [18,30], and video observation with manual frame-by-frame annotation for blink completeness [26–29]. Manual annotation in particular is labour-intensive and unblinded, and constrains sample size and session length. This is a first-order obstacle to accumulating evidence in this field, and it is the reason the literature on blink completeness consists of small-sample studies (N = 11–50) [26–29].

### 11.2 Facial-landmark blink detection: the eye-aspect-ratio approach

The dominant computational approach derives a scalar **eye aspect ratio (EAR)** from facial landmarks — the ratio of the vertical inter-landmark distances of the eye aperture to its horizontal palpebral width — and detects blinks as a characteristic temporal pattern in the EAR signal [35]. The method's rationale is that modern landmark detectors trained on in-the-wild data are robust to head orientation, illumination variation and facial expression, and localise eye landmarks precisely enough to estimate the level of eye opening [35]. Dense-landmark face models (e.g. 468-point face-mesh models) provide sufficient eye-region landmark density for this estimation using only an RGB camera. Because EAR is a continuous, normalised measure of aperture, it is in principle capable of distinguishing **partial from complete** closure — that is, of automating precisely the blink-completeness measurement that the clinical literature has had to perform by hand [26,27,29].

### 11.3 Validity: what webcam methods can and cannot support

The validity evidence must be read carefully, and it differs sharply by measurement target.

- **Gaze position.** Webcam gaze estimation is **less accurate and lower in sampling rate** than infrared pupil–corneal-reflection eye tracking; regression-based webcam approaches (e.g. WebGazer) have substantially poorer spatial accuracy than dedicated infrared systems. Direct comparisons indicate webcam methods can recover expected effects in some paradigms but that lower sampling rate and lower spatial accuracy are their two principal limitations. Webcam gaze is therefore defensible for **coarse, large-region** classification (on-screen vs off-screen, broad zone) and **not** for fixation-level or reading-eye-movement analysis.
- **Blink and eyelid-aperture measures.** These have a materially stronger case, because they are **count- and proportion-based** rather than spatially precise: they require temporal resolution adequate to resolve a blink and amplitude resolution adequate to distinguish partial from complete closure, but not degree-accurate gaze mapping.
- **Sampling-rate constraint.** This is quantitative and must be respected. Blinks last on the order of 100–400 ms. Metrics defined by blink *duration* are therefore near the Nyquist limit at conventional webcam frame rates and become unreliable below approximately 25 frames per second, whereas *proportion* and *count* metrics (blink rate, incomplete-blink ratio, PERCLOS) are considerably more robust to frame-rate variation. Any instrument of this kind must therefore **record its achieved effective sampling rate** and gate duration-dependent metrics on it, rather than reporting all metrics with equal confidence.

### 11.4 Consequence for research design

The honest positioning is that consumer-grade webcam metrology is a **screening-grade** instrument: it trades spatial precision for scale, cost, portability and ecological validity, and it is appropriately used for proportion/count-based ocular markers with transparent reporting of achieved sampling rate and data quality. Infrared eye tracking and open-field autorefractometry remain the reference standards for gaze and accommodation respectively. A research programme that adopts webcam metrology must therefore build in its own quality-control instrumentation (face-presence ratio, achieved frame rate, illumination adequacy, head-pose stability) and report it as data, not suppress it.

> **Critical appraisal.** *Established:* the EAR/facial-landmark approach is a workable, widely adopted basis for automated blink detection [35]; webcam gaze is less accurate and lower-rate than infrared. *Unknown/gap:* there is **no published validation of a webcam-based incomplete-blink-ratio measure against the manual video annotation used in the clinical blink literature** [26,27,29]. Establishing such agreement is a methodological contribution in its own right, and one this research programme is positioned to make.

---

## 12. Methodological considerations for within-subjects display research

### 12.1 Counterbalancing and carryover

With eight conditions presented within participants over a long session, two order-related threats arise: serial-position effects (driven by the vigilance decrement, §8, and by accumulating visual fatigue) and first-order carryover (each condition's effect contaminated by its predecessor — of particular concern here, since a polarity switch imposes a light-adaptation transient). A **balanced (Williams-type) Latin square** addresses both: each condition occupies each serial position equally often across a full cycle of participants, and each condition precedes and follows every other equally often. Two design corollaries follow: participant-to-row assignment must use a **sequential enrolment index** (hashing arbitrary identifiers destroys balance through collisions and gaps), and full balance is achieved only in complete blocks of *n* participants, so target sample size should be a multiple of the number of conditions.

### 12.2 Adaptation between conditions

Because polarity transitions impose a luminance-adaptation transient, an inter-condition adaptation interval on a neutral field is required, with a longer interval when polarity switches than when it does not. This is a direct implication of the pupil-mediated mechanism of the PPA [13–15].

### 12.3 Confound control: stimulus content

Where each condition uses a different reading passage, passage difficulty is confounded with condition unless passage assignment is itself counterbalanced independently of condition (a second, orthogonal Latin square). Given the demonstrated moderation of medium effects by text genre [20], passages must additionally be matched on genre, length and readability.

### 12.4 Statistical model

The appropriate analytic framework is a **linear mixed-effects model with a random intercept per participant**, which accommodates the repeated-measures structure, unbalanced data and participant heterogeneity. Fixed effects should include polarity, text colour (or, per §5.3, luminance contrast), serial position, and the polarity × contrast interaction. Consideration should be given to random slopes where individual differences in susceptibility are of interest, and to ordinal (cumulative-link) models for Likert-type and visual-analogue symptom outcomes, which are not interval-scaled. Signal-detection indices computed from small per-condition trial counts are unstable and should be aggregated or modelled hierarchically rather than analysed per condition.

### 12.5 Ancillary participant characteristics

Given documented risk factors [1,7,9], the following should be recorded as covariates or screening variables: refractive correction status, colour-vision status, daily screen-exposure hours, contact-lens wear, and — because sleepiness is a confounder of fatigue measurement (§10.5) — time since waking and recent caffeine intake.

### 12.6 Colour-vision screening on digital displays

Since the manipulation is chromatic, colour-vision deficiency must be screened. Digital presentation of Ishihara plates is supported: presented on a calibrated PC monitor, sensitivity was **94.4%** and specificity **82.4%**; on a smartphone display, sensitivity **96.0%** and specificity **94.7%**, with **no significant difference between presentation modes** (p > 0.05) [33]. The authors nonetheless emphasise that this supports **screening of groups**, and that display presentation is comparable to booklet or projected presentation for that purpose [33]. Two caveats must be carried forward: display colour rendering is device-dependent (the cited validation used a calibrated monitor), and a screening instrument is not a clinical diagnosis.

---

## 13. Interventions and ergonomic guidance: the state of the evidence

The intervention evidence base is, as noted in §1.3, largely negative for the most heavily marketed options: no high-certainty evidence for any analysed therapy; no benefit of blue-blocking lenses; no benefit of berry-extract supplementation; low-certainty benefit of oral omega-3 for dry-eye symptoms; and a CFF change of unclear clinical significance for carotenoids [8]. An independent systematic review in young users similarly found no evidence for blue-blocking filters, while supporting ergonomic optimisation and restriction of exposure duration [9].

Where positive evidence does exist, it concerns **behaviour and exposure management**. Break scheduling has now been tested directly: relative to no break during a 40-minute reading task, frequent (every 10 minutes) and self-paced breaks reduced reported eye irritation/burning and eye strain, reduced near-work-induced transient myopia, and were associated with lower accommodative variability in the final interval [30]. Ergonomic training and adjustable seating, blink-animation programmes and omega-3 supplementation have been identified as acting on different points of the dry-eye cycle and as potentially complementary, though the widely promulgated "20-20-20 rule" had not, at the time of that review, been directly assessed [10]. General management reviews additionally recommend correction of refractive error and presbyopia, management of vergence anomalies, blink training, lubricant eye drops, and workplace ergonomic policy [2,7].

> **Critical appraisal.** *Established:* filters and most supplements lack support [8,9]; exposure/break management has emerging direct support [30]; the ocular-surface cycle offers multiple complementary intervention points [10]. *Gap:* **display-design parameters are essentially absent from the intervention evidence base** — the most modifiable, zero-cost, population-scalable lever available is also the least tested. This is the central justification for the present research programme.

---

## 14. Research gap register

The following gaps are stated so that each is traceable to specific evidence reviewed above.

| # | Gap | Basis |
|---|-----|-------|
| **G1** | The positive polarity advantage is established for **short-duration legibility/proofreading** tasks with **achromatic** text, but has never been tested for **prolonged reading with fatigue accumulation**. | [12–17] use proofreading, lexical-decision and glance-reading paradigms; none measures blink behaviour, validated symptom instruments, or hour-scale fatigue. |
| **G2** | **Polarity × text-colour interaction on visual fatigue has never been estimated.** | The only study of text colour on visual fatigue held polarity constant at negative [19]; the multi-colour physiological study measured accommodation/pupil, not symptom-level fatigue, over 2-minute exposures [18]. |
| **G3** | **Luminance contrast is not disentangled from hue and polarity.** | Colour contrast cannot substitute for luminance contrast [12]; chromatic pigments differ intrinsically in luminance, so colour sets embed polarity-asymmetric contrast by construction (§5.3). |
| **G4** | **No study reports multiple contrast metrics plus measured display photometry**, and the prevailing standard is polarity-blind and criticised for overstating contrast at low luminance. | [36] vs [37]; empirical polarity effects [12–17]. |
| **G5** | The **subjective–objective dissociation** in DES measurement remains unresolved, and few studies co-register a validated symptom instrument with objective ocular markers in the same condition and session. | Explicit statement that "correlations between objective and subjective measures are not always apparent" [3]. |
| **G6** | **Incomplete-blink ratio has never been tested as an outcome of a display-parameter manipulation**, despite being the ocular marker with the strongest claim to specificity for computer-related visual fatigue. | [26,27,29] manipulate medium, dynamism and duration — not polarity or colour. |
| **G7** | **Blink-completeness measurement does not scale**, being dependent on manual frame-by-frame video annotation, which constrains sample sizes to N ≈ 11–50. | [26–29]; §11.1. |
| **G8** | There is **no published validation of automated (webcam/EAR-based) incomplete-blink measurement against the manual annotation standard** used in the clinical literature. | §11.4. |
| **G9** | **Ambient illumination × polarity × text-colour interactions are barely characterised**, and the two relevant findings are in partial conflict. | Independence of PPA from ambient lighting [12] vs polarity × illumination interaction in threshold legibility [15] vs illumination × colour interaction under negative polarity [19]. |
| **G10** | **Visual-fatigue and sustained-attention outcomes are rarely measured in the same protocol**, despite sharing time-on-task as a driver — leaving display-induced ocular fatigue confounded with generic attentional decline. | §8.2; [21,22]. |
| **G11** | **Tablet-specific, ecologically valid protocols are scarce**, and the field's own prevalence synthesis identifies non-standardised definitions and instruments as a limitation. | [1]; predominance of desktop/automotive/laboratory paradigms in [12–17]. |

---

## 15. Statement of the problem

Digital eye strain affects approximately seven in ten screen users [1], the interventions most heavily promoted to mitigate it lack high-certainty supporting evidence [8,9], and the one class of determinants that is simultaneously upstream of the visual load, free to modify, and already being altered at global scale — the **configuration of the displayed stimulus itself: its polarity, its text chromaticity and its luminance contrast** — remains inadequately evidenced. The legibility literature establishes a robust positive polarity advantage for brief, detail-limited tasks [12–17] but is silent on prolonged reading and on ocular-surface outcomes. The two studies that manipulate text colour are each incomplete: one measures ocular physiology across many colour pairs but neither symptom-level fatigue nor performance over more than two minutes [18]; the other measures visual fatigue but only under negative polarity [19]. No study estimates the polarity × text-colour interaction on visual fatigue, disentangles hue from luminance contrast, or co-registers validated subjective symptom measurement with the objective ocular marker — the incomplete-blink ratio — that has the strongest mechanistic and empirical claim to specificity for this condition [26,27,29]. Progress is further constrained by a metrological bottleneck: blink-completeness measurement currently depends on manual video annotation, restricting the literature to small samples [26–29].

## 16. Aim

**To determine how display polarity and text colour — and the luminance contrast they jointly produce — affect reading performance, visual comfort, sustained attention, and subjective and objective visual fatigue during prolonged tablet reading; and, in doing so, to establish and validate a scalable, instrumented protocol for objective ocular measurement of digital eye strain outside the specialist laboratory.**

## 17. Objectives and hypotheses

Each objective addresses one or more registered gaps.

| Obj. | Objective | Gaps | Hypothesis |
|------|-----------|------|------------|
| **O1** | To quantify the effect of display polarity and text colour on **reading performance** (reading rate) and **comprehension** during prolonged tablet reading. | G1, G11 | **H1:** Positive polarity and higher luminance contrast are associated with faster reading rate; comprehension is less sensitive than rate, consistent with the null colour effect on reading speed reported over short exposures [18]. |
| **O2** | To quantify the effect of polarity and text colour on **subjective visual fatigue** (CVS-Q change from baseline as the primary endpoint; per-condition symptom and comfort/clarity ratings as secondary). | G1, G2, G5, G11 | **H2:** Conditions of lower luminance contrast, and negative-polarity conditions, produce greater increases in subjective visual fatigue and lower perceived comfort and clarity. |
| **O3** | To quantify the effect of polarity and text colour on **objective ocular markers** — blink rate, **incomplete-blink ratio** (primary), inter-blink interval — with drowsiness (PERCLOS, long-closure events) modelled as a covariate. | G2, G6, G10 | **H3:** Incomplete-blink ratio increases, and blink rate decreases, with time on task; and both are modulated by condition, with the greatest incomplete-blink burden in low-contrast conditions. **H3a:** Condition effects on incomplete-blink ratio persist after adjustment for PERCLOS, distinguishing visual fatigue from sleepiness. |
| **O4** | To quantify the effect of polarity and text colour on **sustained attention** (reaction-time mean and variability, lapse rate, signal-detection sensitivity and bias). | G10 | **H4:** Reaction-time variability and lapse rate increase with serial position (vigilance decrement) and are elevated in lower-contrast conditions; sensitivity (d′) is reduced where stimulus discriminability is degraded. |
| **O5** | To **disentangle hue from luminance contrast** by computing multiple contrast metrics (WCAG ratio; Michelson) for every condition, measuring display photometry and ambient illuminance, and modelling contrast explicitly as a covariate and as a polarity × contrast interaction. | G3, G4, G9 | **H5:** Luminance contrast accounts for the majority of between-condition variance in performance and fatigue outcomes; residual hue-specific effects, if present, are small — with red text as the a priori candidate exception [19]. |
| **O6** | To establish the **feasibility, data quality and criterion validity** of tablet-based webcam ocular metrology for digital-eye-strain research, including agreement of automated incomplete-blink detection with manual video annotation, and transparent reporting of achieved sampling rate, face-presence and illumination adequacy. | G7, G8 | **H6:** Automated EAR-based incomplete-blink classification achieves acceptable agreement with manual annotation, and proportion/count-based markers are robust to frame-rate variation whereas duration-based markers are not. |
| **O7** | To characterise the **correspondence between subjective and objective** fatigue indices measured concurrently within condition and session. | G5 | **H7:** Subjective symptom change and objective ocular markers are only modestly correlated, with incomplete-blink ratio showing stronger association with ocular-surface symptoms than with accommodative/vergence symptoms. |
| **O8** | To derive **evidence-based display-design and ergonomic recommendations**, and to evaluate them against the prevailing accessibility contrast standard. | G4, G11 | **H8:** A polarity-blind contrast criterion misclassifies the readability/comfort of a subset of negative-polarity conditions relative to empirically measured outcomes. |

## 18. Conceptual framework

The framework is causal and two-pathway, integrating §3.1 with §§4–10:

**Display configuration** (polarity; text chromaticity; ⇒ **luminance contrast**; display luminance) — moderated by **ambient illuminance** — acts through two proximal mechanisms:

- **Optical/refractive pathway:** display luminance → **pupil diameter** → optical aberration and depth of focus → **retinal image quality** → legibility and accommodative demand → accommodative variability, near-work-induced transient myopia → *accommodative/vergence symptom cluster* [13–15,18,30].
- **Ocular-surface pathway:** visual and cognitive demand → **reduced blink rate and increased incomplete blinking** → exposed evaporative area and impaired lipid distribution → **tear-film instability** → osmolarity and inflammation → *ocular-surface symptom cluster* [10,11,26,27,29].

Both pathways feed **manifest outcomes**: reading performance and comprehension; perceived comfort and clarity; subjective visual fatigue (CVS-Q, symptom ratings); and sustained attention. **Time on task** exerts an independent effect on attention (vigilance decrement, resource depletion) [21,22] and on fatigue accumulation, and is therefore both counterbalanced and modelled. **Sleepiness** (PERCLOS) and **disengagement/boredom** are treated as measured confounders rather than assumed absent. **Person-level covariates** (refractive correction, colour vision, habitual screen exposure, sleep and caffeine) modulate susceptibility.

## 19. Proposed methodological outline

Presented in brief, as the synopsis's methods chapter will develop it fully.

- **Design.** Within-subjects, repeated measures; **eight conditions = 2 polarity × 4 text colour**; balanced Williams Latin-square counterbalancing on a sequential enrolment index; passage assignment counterbalanced independently of condition (second orthogonal square); target N a multiple of eight, determined by a formal a priori power analysis for the smallest effect of interest in a mixed-effects framework.
- **Setting and apparatus.** Fixed tablet device at a standardised viewing distance; brightness fixed with auto-brightness and blue-light filter disabled; ambient illuminance measured (lux) and display white-point luminance measured (cd/m²) and recorded per session; contrast computed per condition by WCAG ratio and Michelson.
- **Procedure per condition.** Adaptation on a neutral field (longer on polarity switch) → self-paced reading with a per-page minimum dwell → comprehension items → comfort and clarity ratings → symptom rating → visual-search task → sustained-attention (go/no-go) task. Rest breaks at fixed intervals; no performance feedback (to avoid differential effort across conditions).
- **Measures.** *Primary:* CVS-Q change from baseline; incomplete-blink ratio. *Secondary:* reading rate; comprehension accuracy; comfort/clarity; blink rate and inter-blink interval; reaction-time mean, variability, lapse rate, d′ and criterion; visual-search accuracy and efficiency. *Covariates/confounders:* serial position; PERCLOS and long-closure events; ambient illuminance; display luminance; head-pose stability; face-presence ratio and achieved sampling rate; person-level covariates per §12.5.
- **Screening.** Ishihara colour-vision screening on the study display [33]; refractive-correction status; eligibility criteria specified a priori.
- **Instrumentation.** A purpose-built, offline-capable tablet application performing stimulus presentation, task administration, on-device webcam ocular measurement (facial-landmark EAR: blink rate, incomplete-blink ratio, inter-blink interval, PERCLOS), quality-control logging, and provenance-stamped data export. A concurrent manual-annotation sub-study establishes criterion validity for automated blink classification (O6).
- **Analysis.** Linear mixed-effects models with random intercept per participant; contrast as covariate and polarity × contrast interaction (O5); ordinal models for rating outcomes; hierarchical treatment of signal-detection indices; pre-specified sensitivity analysis excluding conditions flagged for disengagement; multiplicity control across the outcome families.
- **Ethics.** Institutional ethics approval; written informed consent; camera-based measurement optional and separately consented, with on-device processing and no video retention; right to withdraw; data protection and de-identification.

## 20. Expected outcomes

1. Quantified effect estimates, with confidence intervals, for display polarity and text colour on reading performance, comprehension, perceived comfort, subjective visual fatigue, objective ocular markers and sustained attention during prolonged tablet reading.
2. The **first estimate of the polarity × text-colour interaction** on visual fatigue outcomes (G2), and the first test of whether the positive polarity advantage established for brief legibility tasks extends to hour-scale reading and to ocular-surface outcomes (G1).
3. A quantitative apportionment of between-condition variance to **luminance contrast** versus residual **hue-specific** effects (G3), with implications for whether display guidance should be framed in terms of colour or of contrast.
4. Evidence on whether the prevailing **polarity-blind** contrast criterion adequately predicts measured readability and comfort, and if not, in which direction and for which conditions it errs (G4, O8).
5. An empirical characterisation of the **subjective–objective correspondence** in DES, measured concurrently within condition (G5).
6. A **validated, scalable, open protocol and instrument** for objective ocular measurement of digital eye strain outside the specialist laboratory, with reported agreement against manual annotation and transparent data-quality metrics (G7, G8) — a methodological contribution intended to be reusable by other groups.
7. **Evidence-based, directly implementable design recommendations** for text presentation on tablets, including for low-illumination use.

## 21. Applications and significance

- **Interface and product design.** Actionable, empirically grounded specification of text presentation and "dark mode" implementation for reading-centric applications, e-readers, e-learning platforms and operating-system themes.
- **Accessibility standards.** Empirical input to the ongoing revision of contrast criteria, specifically on whether and how polarity must enter a contrast standard [36,37].
- **Occupational and public health.** Display-configuration guidance as a zero-cost, population-scalable preventive measure for a condition affecting approximately 70% of screen users [1], complementing the exposure-management measures for which evidence is emerging [30] and substituting for the filter/supplement approaches for which it is lacking [8,9].
- **Education.** Evidence for the configuration of tablet-based learning materials, where reading duration is long and users are young.
- **Research methodology.** A scalable objective-measurement instrument that relieves the manual-annotation bottleneck currently limiting this literature to small samples [26–29], enabling larger and more diverse studies.
- **Clinical practice.** Guidance that eye-care practitioners can give patients regarding device configuration, an area in which practitioners are explicitly said to require quality research evidence [3].

## 22. Limitations and threats to validity (declared a priori)

1. **Polarity × contrast entanglement.** Because the condition colours are fixed and chromatic pigments differ intrinsically in luminance, luminance contrast is not balanced across polarity. This is mitigated by measuring and modelling contrast (O5) and by framing the analysis as polarity × contrast, but it constrains causal separation and is disclosed as such (G3).
2. **Screening-grade objective measurement.** Webcam metrology is lower in accuracy and sampling rate than infrared eye tracking and does not measure accommodation. Gaze measures are limited to coarse zones; duration-based blink metrics are gated on achieved frame rate (§11.3).
3. **Non-blindable manipulation.** Display polarity is visible to participants, so expectation and demand effects on subjective ratings cannot be excluded. Objective markers, absence of performance feedback, and counterbalancing mitigate but do not eliminate this.
4. **Session length.** An hour-scale session accumulates both visual fatigue and generic fatigue/boredom; these are counterbalanced, measured and modelled (§8.2), not eliminated.
5. **Sleepiness confounding.** PERCLOS is used as a covariate, but it is itself insensitive to moderate drowsiness and to inattention/distraction [31].
6. **Generalisability.** Findings will be specific to the device, display technology, luminance range and population studied; display colour rendering is device-dependent and uncalibrated consumer displays vary.
7. **Screening, not diagnosis.** Ishihara screening on a display is a group-screening instrument, not a clinical diagnosis [33].
8. **Review-level limitation.** This literature review is a critical narrative review with a documented search strategy, not a PRISMA-registered systematic review with dual independent screening; pooled estimates are quoted from published meta-analyses rather than computed here (§2.4).

---

## 23. References

Records marked *(PubMed)* were retrieved from PubMed/MEDLINE; DOI links are provided for all items where a DOI exists.

1. Ccami-Bernal F, Soriano-Moreno DR, Romero-Robles MA, Barriga-Chambi F, Tuco KG, Castro-Diaz SD, Nuñez-Lupaca JN, Pacheco-Mendoza J, Galvez-Olortegui T, Benites-Zapata VA. Prevalence of computer vision syndrome: A systematic review and meta-analysis. *Journal of Optometry.* 2024;17(1):100482. *(PubMed; PMID 37866176)* [https://doi.org/10.1016/j.optom.2023.100482](https://doi.org/10.1016/j.optom.2023.100482)

2. Kaur K, Gurnani B, Nayak S, Deori N, Kaur S, Jethani J, Singh D, Agarkar S, Hussaindeen JR, Sukhija J, Mishra D. Digital Eye Strain — A Comprehensive Review. *Ophthalmology and Therapy.* 2022;11(5):1655–1680. *(PubMed; PMID 35809192)* [https://doi.org/10.1007/s40123-022-00540-9](https://doi.org/10.1007/s40123-022-00540-9)

3. Sheppard AL, Wolffsohn JS. Digital eye strain: prevalence, measurement and amelioration. *BMJ Open Ophthalmology.* 2018;3(1):e000146. *(PubMed; PMID 29963645)* [https://doi.org/10.1136/bmjophth-2018-000146](https://doi.org/10.1136/bmjophth-2018-000146)

4. Pucker AD, Kerr AM, Sanderson J, Lievens C. Digital Eye Strain: Updated Perspectives. *Clinical Optometry.* 2024;16:233–246. *(PubMed; PMID 39308959)* [https://doi.org/10.2147/OPTO.S412382](https://doi.org/10.2147/OPTO.S412382)

5. Kahal F, Al Darra A, Torbey A. Computer vision syndrome: a comprehensive literature review. *Future Science OA.* 2025;11(1):2476923. *(PubMed; PMID 40055942)* [https://doi.org/10.1080/20565623.2025.2476923](https://doi.org/10.1080/20565623.2025.2476923)

6. Auffret É, Gomart G, Bourcier T, Gaucher D, Speeg-Schatz C, Sauer A. [Digital eye strain. Symptoms, prevalence, pathophysiology, and management]. *Journal Français d'Ophtalmologie.* 2021;44(10):1605–1610. *(PubMed; PMID 34657757; in French)* [https://doi.org/10.1016/j.jfo.2020.10.002](https://doi.org/10.1016/j.jfo.2020.10.002)

7. Coles-Brennan C, Sulley A, Young G. Management of digital eye strain. *Clinical and Experimental Optometry.* 2019;102(1):18–29. *(PubMed; PMID 29797453)* [https://doi.org/10.1111/cxo.12798](https://doi.org/10.1111/cxo.12798)

8. Singh S, McGuinness MB, Anderson AJ, Downie LE. Interventions for the Management of Computer Vision Syndrome: A Systematic Review and Meta-analysis. *Ophthalmology.* 2022;129(10):1192–1215. *(PubMed; PMID 35597519)* [https://doi.org/10.1016/j.ophtha.2022.05.009](https://doi.org/10.1016/j.ophtha.2022.05.009)

9. Mataftsi A, Seliniotaki AK, Moutzouri S, Prousali E, Darusman KR, Adio AO, Haidich AB, Nischal KK. Digital eye strain in young screen users: A systematic review. *Preventive Medicine.* 2023;170:107493. *(PubMed; PMID 36977430)* [https://doi.org/10.1016/j.ypmed.2023.107493](https://doi.org/10.1016/j.ypmed.2023.107493)

10. Kamøy B, Magno M, Nøland ST, Moe MC, Petrovski G, Vehof J, Utheim TP. Video display terminal use and dry eye: preventive measures and future perspectives. *Acta Ophthalmologica.* 2022;100(7):723–739. *(PubMed; PMID 35122403)* [https://doi.org/10.1111/aos.15105](https://doi.org/10.1111/aos.15105)

11. Fjaervoll K, Fjaervoll H, Magno M, Nøland ST, Dartt DA, Vehof J, Utheim TP. Review on the possible pathophysiological mechanisms underlying visual display terminal-associated dry eye disease. *Acta Ophthalmologica.* 2022;100(8):861–877. *(PubMed; PMID 35441459)* [https://doi.org/10.1111/aos.15150](https://doi.org/10.1111/aos.15150)

12. Buchner A, Baumgartner N. Text — background polarity affects performance irrespective of ambient illumination and colour contrast. *Ergonomics.* 2007;50(7):1036–1063. *(PubMed; PMID 17510822)* [https://doi.org/10.1080/00140130701306413](https://doi.org/10.1080/00140130701306413)

13. Piepenbrock C, Mayr S, Buchner A. Smaller pupil size and better proofreading performance with positive than with negative polarity displays. *Ergonomics.* 2014;57(11):1670–1677. *(PubMed; PMID 25135324)* [https://doi.org/10.1080/00140139.2014.948496](https://doi.org/10.1080/00140139.2014.948496)

14. Piepenbrock C, Mayr S, Buchner A. Positive display polarity is particularly advantageous for small character sizes: implications for display design. *Human Factors.* 2014;56(5):942–951. *(PubMed; PMID 25141597)* [https://doi.org/10.1177/0018720813515509](https://doi.org/10.1177/0018720813515509)

15. Dobres J, Chahine N, Reimer B. Effects of ambient illumination, contrast polarity, and letter size on text legibility under glance-like reading. *Applied Ergonomics.* 2017;60:68–73. *(PubMed; PMID 28166901)* [https://doi.org/10.1016/j.apergo.2016.11.001](https://doi.org/10.1016/j.apergo.2016.11.001)

16. Dobres J, Chahine N, Reimer B, Gould D, Mehler B, Coughlin JF. Utilising psychophysical techniques to investigate the effects of age, typeface design, size and display polarity on glance legibility. *Ergonomics.* 2016;59(10):1377–1391. *(PubMed; PMID 26727912)* [https://doi.org/10.1080/00140139.2015.1137637](https://doi.org/10.1080/00140139.2015.1137637)

17. The polarity effect in virtual and video see-through mixed reality — better proofreading performance and faster optotype identification with positive display polarity. *Ergonomics.* 2025. [https://doi.org/10.1080/00140139.2025.2457470](https://doi.org/10.1080/00140139.2025.2457470) *(Publisher record; author list to be completed from the final published version.)*

18. Jiménez R, Redondo B, Molina R, Martínez-Domingo MÁ, Hernández-Andrés J, Vera J. Short-term effects of text-background color combinations on the dynamics of the accommodative response. *Vision Research.* 2020;166:33–42. *(PubMed; PMID 31841707)* [https://doi.org/10.1016/j.visres.2019.11.006](https://doi.org/10.1016/j.visres.2019.11.006)

19. Fan Q, Xie J, Dong Z, Wang Y. The Effect of Ambient Illumination and Text Color on Visual Fatigue under Negative Polarity. *Sensors.* 2024;24(11):3516. *(PubMed; PMID 38894307)* [https://doi.org/10.3390/s24113516](https://doi.org/10.3390/s24113516)

20. Delgado P, Vargas C, Ackerman R, Salmerón L. Don't throw away your printed books: A meta-analysis on the effects of reading media on reading comprehension. *Educational Research Review.* 2018;25:23–38. [https://doi.org/10.1016/j.edurev.2018.09.003](https://doi.org/10.1016/j.edurev.2018.09.003)

21. Warm JS, Parasuraman R, Matthews G. Vigilance requires hard mental work and is stressful. *Human Factors.* 2008;50(3):433–441. [https://doi.org/10.1518/001872008X312152](https://doi.org/10.1518/001872008X312152)

22. Abe T, Mollicone D, Basner M, Dinges DF. Sleepiness and Safety: Where Biology Needs Technology. *Sleep and Biological Rhythms.* 2014;12(2):74–84. *(PubMed; PMID 24955033)* [https://doi.org/10.1111/sbr.12067](https://doi.org/10.1111/sbr.12067)

23. Seguí MdelM, Cabrero-García J, Crespo A, Verdú J, Ronda E. A reliable and valid questionnaire was developed to measure computer vision syndrome at the workplace. *Journal of Clinical Epidemiology.* 2015;68(6):662–673. *(PubMed; PMID 25744132)* [https://doi.org/10.1016/j.jclinepi.2015.01.015](https://doi.org/10.1016/j.jclinepi.2015.01.015)

24. Cantó-Sancho N, Linhares J, Ronda-Pérez E, Franco S, Perales E, Seguí-Crespo M. Cross-cultural validation into Portuguese of a questionnaire to assess computer vision syndrome in workers exposed to digital devices. *Arquivos Brasileiros de Oftalmologia.* 2024;87(6):e20220256. *(PubMed; PMID 37878876)* [https://doi.org/10.5935/0004-2749.2022-0256](https://doi.org/10.5935/0004-2749.2022-0256)

25. Seguí-Crespo MdelM, Cantó Sancho N, Ronda E, Colombo R, Porru S, Carta A. [Italian cross-cultural adaptation of the Computer Vision Syndrome Questionnaire]. *La Medicina del Lavoro.* 2019;110(1):37–45. *(PubMed; PMID 30794247; in Italian)* [https://doi.org/10.23749/mdl.v110i1.7499](https://doi.org/10.23749/mdl.v110i1.7499)

26. Portello JK, Rosenfield M, Chu CA. Blink rate, incomplete blinks and computer vision syndrome. *Optometry and Vision Science.* 2013;90(5):482–487. *(PubMed; PMID 23538437)* [https://doi.org/10.1097/OPX.0b013e31828f09a7](https://doi.org/10.1097/OPX.0b013e31828f09a7)

27. Argilés M, Cardona G, Pérez-Cabré E, Rodríguez M. Blink Rate and Incomplete Blinks in Six Different Controlled Hard-Copy and Electronic Reading Conditions. *Investigative Ophthalmology & Visual Science.* 2015;56(11):6679–6685. *(PubMed; PMID 26517404)* [https://doi.org/10.1167/iovs.15-16967](https://doi.org/10.1167/iovs.15-16967)

28. Cardona G, García C, Serés C, Vilaseca M, Gispets J. Blink rate, blink amplitude, and tear film integrity during dynamic visual display terminal tasks. *Current Eye Research.* 2011;36(3):190–197. *(PubMed; PMID 21275516)* [https://doi.org/10.3109/02713683.2010.544442](https://doi.org/10.3109/02713683.2010.544442)

29. Hirota M, Uozato H, Kawamorita T, Shibata Y, Yamamoto S. Effect of incomplete blinking on tear film stability. *Optometry and Vision Science.* 2013;90(7):650–657. *(PubMed; PMID 23770659)* [https://doi.org/10.1097/OPX.0b013e31829962ec](https://doi.org/10.1097/OPX.0b013e31829962ec)

30. Redondo B, Jiménez R, Vera J, Rosenfield M. The impact of break schedules on digital eye strain symptoms and ocular accommodation during prolonged near work. *Experimental Eye Research.* 2025;258:110463. *(PubMed; PMID 40466853)* [https://doi.org/10.1016/j.exer.2025.110463](https://doi.org/10.1016/j.exer.2025.110463)

31. Abe T. PERCLOS-based technologies for detecting drowsiness: current evidence and future directions. *SLEEP Advances.* 2023;4(1):zpad006. *(PubMed; PMID 37193281)* [https://doi.org/10.1093/sleepadvances/zpad006](https://doi.org/10.1093/sleepadvances/zpad006)

32. Jackson ML, Raj S, Croft RJ, Hayley AC, Downey LA, Kennedy GA, Howard ME. Slow eyelid closure as a measure of driver drowsiness and its relationship to performance. *Traffic Injury Prevention.* 2016;17(3):251–257. *(PubMed; PMID 26065627)* [https://doi.org/10.1080/15389588.2015.1055327](https://doi.org/10.1080/15389588.2015.1055327)

33. Klinke T, Hannak W, Böning K, Jakstat H. A Comparative Study of the Sensitivity and Specificity of the Ishihara Test With Various Displays. *International Dental Journal.* 2024;74(4):892–896. *(PubMed; PMID 38228434)* [https://doi.org/10.1016/j.identj.2023.12.009](https://doi.org/10.1016/j.identj.2023.12.009)

34. Pavel IA, Bogdanici CM, Donica VC, Anton N, Savu B, Chiriac CP, Pavel CD, Salavastru SC. Computer Vision Syndrome: An Ophthalmic Pathology of the Modern Era. *Medicina.* 2023;59(2):412. *(PubMed; PMID 36837613)* [https://doi.org/10.3390/medicina59020412](https://doi.org/10.3390/medicina59020412)

35. Soukupová T, Čech J. Real-Time Eye Blink Detection using Facial Landmarks. In: *Proceedings of the 21st Computer Vision Winter Workshop (CVWW).* Rimske Toplice, Slovenia; 2016. *(Peer-reviewed workshop proceedings; no journal DOI. Cited as the methodological origin of the eye-aspect-ratio metric.)*

36. World Wide Web Consortium (W3C). *Web Content Accessibility Guidelines (WCAG) 2.1 / 2.2* — Success Criterion 1.4.3 (Contrast (Minimum)) and 1.4.6 (Contrast (Enhanced)); definition of contrast ratio and relative luminance. W3C Recommendation. [https://www.w3.org/TR/WCAG22/](https://www.w3.org/TR/WCAG22/) *(Technical standard, not peer-reviewed research.)*

37. Advanced Perceptual Contrast Algorithm (APCA) — candidate perceptual contrast method under development for a future generation of the accessibility guidelines, incorporating polarity and typographic parameters. [https://git.apcacontrast.com/](https://git.apcacontrast.com/) *(Draft technical specification, not peer-reviewed research. Cited only to document that limitations of the current contrast standard are formally recognised.)*

---

## Appendix A — Evidence table: display polarity, text colour and contrast

| Study | Design & sample | Manipulation | Outcomes | Principal finding |
|---|---|---|---|---|
| Buchner & Baumgartner 2007 [12] | Series of experiments | Polarity × ambient illumination × chromaticity; colour vs luminance contrast | Proofreading performance; autonomic indices (HR, HRV, respiration, skin conductance); self-reported strain | Positive polarity advantage, **independent of ambient lighting and chromaticity**; **colour contrast cannot compensate for absent luminance contrast**; no differences in effort/strain indices |
| Piepenbrock et al. 2014 [13] | Experimental, pupillometry | Polarity | Pupil size; proofreading | Smaller pupils **and** better performance with positive polarity — supports display-luminance hypothesis |
| Piepenbrock et al. 2014 [14] | Experimental | Polarity × character size (8/10/12/14 pt) | Proofreading | PPA **increased linearly as character size decreased**; avoid negative polarity at small sizes |
| Dobres et al. 2017 [15] | Psychophysical, lexical decision | Polarity × ambient illumination (near-dark vs daylight-like) × type size | Legibility threshold (time to read accurately) | Thresholds **worst for negative polarity under dark ambient**; positive polarity or bright ambient both improved legibility |
| Dobres et al. 2016 [16] | Psychophysical, adaptive staircase | Typeface × polarity (Study I); × size (Study II); age | Stimulus-duration threshold | Black-on-white significantly more legible than white-on-black; typeface × age interaction |
| Jiménez et al. 2020 [18] | Within-subjects, N = 20; open-field autorefractometer | **14 text–background colour combinations**, 2-min passages | Accommodative response & variability; pupil size; perceived legibility; reading speed | Colour modulates accommodative/pupillary dynamics; blue-on-red raised accommodative response; positive polarity → smaller pupils, more accommodative variability; low-contrast pair rated less legible; **no effect on reading speed** |
| Fan et al. 2024 [19] | Experimental; eye tracker | Ambient illumination × text colour, **negative polarity only** | Visual fatigue (pupil accommodation, blink rate); cognitive performance | **Red text worst, yellow best** for visual fatigue; better illumination reduced fatigue but **magnitude depended on text colour**; performance better with yellow/white, worse with red |
| Mixed-reality polarity study 2025 [17] | Experimental | Polarity in VR and video see-through MR | Proofreading; optotype identification | PPA replicated in mixed reality |

## Appendix B — Evidence table: ocular markers and measurement instruments

| Study / source | Focus | Key quantitative finding | Role in the present research |
|---|---|---|---|
| Portello et al. 2013 [26] | Blink rate, incomplete blinks, CVS symptoms; 15-min reading at 50 cm | Blink rate 11.6/min (SD 7.84); incomplete blinks 0.9–56.5% (mean 16.1%, SD 15.7); **symptom score ↔ % incomplete blinks p = 0.002**; forcing rate to 23.5/min did **not** reduce symptoms | Justifies **incomplete-blink ratio as primary ocular marker**; warns against treating blink rate as a fatigue thermometer |
| Argilés et al. 2015 [27] | Blink rate & incomplete blinks across 6 reading conditions; N = 50 | All reading reduced blink rate (p < 0.001); **% incomplete blinks rose only for electronic platforms** | Establishes specificity of incomplete blinking to electronic media |
| Hirota et al. 2013 [29] | Incomplete blinking and tear-film stability; 60-min task | Non-invasive break-up time 8.62 ± 1.54 s → 4.33 ± 2.57 s at 30 min (p < 0.01); tear film stable if blinks complete | Mechanistic link: blink **quality** governs tear-film stability |
| Cardona et al. 2011 [28] | Blink rate/amplitude & tear film during dynamic VDT tasks; N = 25 | Blink rate fell to ~⅓ (fast) and ~½ (slow) of baseline; more incomplete blinks in dynamic tasks | Shows task dynamism, not cognition alone, drives blink change |
| Fjaervoll et al. 2022 [11] | Mechanisms of VDT-associated dry eye; 55 articles | VDT causes dry eye "mainly through impaired blinking patterns"; parasympathetic/blue-light hypotheses unsupported | Conceptual framework, ocular-surface pathway |
| Redondo et al. 2025 [30] | Break schedules, 40-min reading; N = 24 | No-break worse than 3-break and self-paced for irritation/burning and eye strain; NITM higher without breaks; accommodative lag unchanged | Justifies rest-break protocol; accommodative measures require lab autorefractometry |
| Seguí et al. 2015 [23] | CVS-Q development & validation | 16 symptoms, Rasch-fitting; sensitivity & specificity > 70%; ICC 0.802 (0.673–0.884); κ 0.612 | Primary subjective endpoint instrument |
| Cantó-Sancho et al. 2024 [24] | CVS-Q Portuguese validation; N = 280 | α 0.793; ICC 0.847; sens 78.5%, spec 70.7%; AUC 0.832; ρ 0.728 with OSDI; cut-off ≥ 7 | Cross-cultural robustness of CVS-Q |
| Ccami-Bernal et al. 2024 [1] | Prevalence meta-analysis; 103 studies, N = 66,577 | Pooled prevalence 69.0% (62.3–75.3); **non-CVS-Q studies estimated higher (75.4%)** | Burden justification; argues for validated instrument |
| Abe 2023 [31] | PERCLOS review | Among the most validated drowsiness indices; fails in moderate drowsiness, older adults, aviation tasks; no single optimal index | PERCLOS as **confound covariate**, not a CVS outcome |
| Jackson et al. 2016 [32] | PERCLOS after 24 h sleep deprivation; N = 12 | More eyelid closure (p<0.05); PERCLOS ↔ vigilance variability r = 0.68; ↔ lane position r = 0.61 | Validity of automated ocular drowsiness measurement |
| Singh et al. 2022 [8] | Interventions SR/MA; 45 RCTs, N = 4,497 | **No high-certainty evidence for any therapy**; blue-blocking ineffective; omega-3 low-certainty benefit | Establishes that display design is an under-exploited lever |
| Klinke et al. 2024 [33] | Ishihara on displays; N = 38 / 18 | PC: sens 94.4%, spec 82.4%; smartphone: sens 96.0%, spec 94.7%; no significant difference (p > 0.05) | Supports display-based colour-vision screening |
| Soukupová & Čech 2016 [35] | EAR blink detection | EAR from facial landmarks + temporal classification | Methodological basis for automated blink metrology |

---

*End of document.*
