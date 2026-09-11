# Citation verification record

Every citation used anywhere in this project must appear here with a status. The rule this file
enforces: **a citation either resolves to a real record whose metadata matches, or it is marked as
failing.** A citation is never repaired by substituting a different paper on the same topic, and no
bibliographic field is ever filled in by inference.

Verification is against **PubMed** (via the PubMed MCP server), which returns the DOI, journal,
volume, issue, pages, publication date and full author list for each record. Crossref's REST API is
blocked by this environment's egress proxy, so PubMed is the authority used here; items PubMed does
not index are marked `NOT INDEXED IN PUBMED` and remain unverified until checked against another
authority.

Statuses: `CONFIRMED` (every field matches) · `CONFIRMED, FIELD DIFFERS` (record is the right paper,
one or more fields need correcting — the correct value is given) · `METADATA CONFIRMED, SUBSTANTIVE
CLAIM NOT CONFIRMED` (the right paper, but what it is cited FOR has not been checked against its
text) · `NOT INDEXED IN PUBMED` (outside PubMed's scope by subject or publication type; a secondary
authority is named where one was reachable, and corroboration is not confirmation) · `NOT VERIFIED`
(found only in secondary reporting and never read at source — must not be cited as given) ·
`UNRESOLVED` (not yet checked or ambiguous) · `FAILED` (DOI dead, or resolves to a different paper).

**That list is closed.** `tests/citationIntegrity.test.ts` fails the build on any status not in it.
Two statuses were in use here for months without appearing in this legend, which is how a status
comes to read as "verified" to everyone who scans the file without anyone having decided that it is.

---

## CONFIRMED

### 1. Argilés et al. (2015) — the load-bearing citation
**Status: CONFIRMED.** PMID 26517404 · DOI [10.1167/iovs.15-16967](https://doi.org/10.1167/iovs.15-16967)

> Argilés, M., Cardona, G., Pérez-Cabré, E., & Rodríguez, M. (2015). Blink rate and incomplete
> blinks in six different controlled hard-copy and electronic reading conditions. *Investigative
> Ophthalmology & Visual Science, 56*(11), 6679–6685.

Every field matches PubMed's record. The substantive claim was checked against the abstract, not
merely the metadata. Verbatim from the abstract:

- *"during six different, 6-minute controlled reading experimental conditions"* — **six conditions,
  6 minutes each, confirmed.**
- *"All reading conditions resulted in a decrease in SEBR when compared with baseline conditions
  (all P < 0.001)"* — **blink rate measured and significant, confirmed.**
- *"The percentage of incomplete blinks was found to increase when reading was conducted on an
  electronic platform, in contrast to hard-copy text."* — **incomplete-blink proportion measured
  and changed, confirmed.**

n = 50. **Caveat that must travel with this citation:** the age range is 18–74, not a student
sample, and the manipulation is reading *platform* (tablet / computer / hard copy / zoom level),
not text colour or polarity. It supports a claim about exposure duration for this outcome. It does
not supply a colour or polarity effect.

**What this licenses:** the statement that 6 minutes per condition is sufficient exposure for blink
rate and incomplete-blink proportion to move detectably, and therefore that this protocol's ~3
minutes per condition sits *below* the shortest published precedent for its own primary outcome.

### 2. Portello, Rosenfield & Chu (2013)
**Status: CONFIRMED.** PMID 23538437 · DOI [10.1097/OPX.0b013e31828f09a7](https://doi.org/10.1097/OPX.0b013e31828f09a7)

> Portello, J. K., Rosenfield, M., & Chu, C. A. (2013). Blink rate, incomplete blinks and computer
> vision syndrome. *Optometry and Vision Science, 90*(5), 482–487.

Abstract confirms: 15-minute continuous reading task, N = 21; incomplete blinks ranged 0.9–56.5%
with a **mean of 16.1% (SD 15.7)**; positive correlation between total symptom score and percentage
of incomplete blinks (p = 0.002); mean blink rate 11.6/min (SD 7.84).

**This is the source of the simulator's population parameters.** `scripts/lib/timingModel.ts` draws
`incompleteP` around a mean of 0.16 and `blinkRate` around 13/min; both now trace to a verified
record rather than to an assumption.

### 3. Talens-Estarelles et al. (2020)
**Status: CONFIRMED.** PMID 33259378 · DOI [10.1097/OPX.0000000000001616](https://doi.org/10.1097/OPX.0000000000001616)

> Talens-Estarelles, C., Sanchis-Jurado, V., Esteve-Taboada, J. J., Pons, Á. M., &
> García-Lázaro, S. (2020). How do different digital displays affect the ocular surface?
> *Optometry and Vision Science, 97*(12), 1070–1079.

Abstract confirms: 15-minute reading blocks, n = 31 aged 20–26, and statistically significant
differences between displays on the OSDI, the **CVS-Q**, tear meniscus height, Schirmer I, NIKBUT,
osmolarity and bulbar redness (P < .05).

**Relevance:** the shortest verified exposure at which the CVS-Q itself discriminates between
display conditions is 15 minutes.

### 4. Golebiowski et al.
**Status: CONFIRMED, FIELD DIFFERS (year).** PMID 31573824 · DOI [10.1080/02713683.2019.1663542](https://doi.org/10.1080/02713683.2019.1663542)

> Golebiowski, B., Long, J., Harrison, K., Lee, A., Chidi-Egboka, N., & Asper, L. Smartphone use
> and effects on tear film, blinking and binocular vision. *Current Eye Research, 45*(4), 428–434.

Volume, issue and pages match. **Correct the year: cite as 2020, not 2019.** PubMed's
`publication_date` of 2019-10-07 is the electronic-ahead-of-print date; volume 45 issue 4 is the
2020 issue. Cite the issue year.

A citation-matching search on author + journal + year was **ambiguous between two PMIDs**, and the
other candidate (31743651) is an unrelated paper on corneal epithelial dendritic cells in allergy.
The DOI resolved the ambiguity. This is exactly the failure mode that makes author-plus-year
matching unsafe.

Abstract confirms: 60 min smartphone reading, n = 12 (pilot), aged 18–23; *"Number of incomplete
blinks per minute increased from a median of 6 blinks at 1 min to 15 at 60 min"* (p = .0049).

### 5. Pattyn et al.
**Status: CONFIRMED, FIELD DIFFERS (year).** PMID 17999934 · DOI [10.1016/j.physbeh.2007.09.016](https://doi.org/10.1016/j.physbeh.2007.09.016)

> Pattyn, N., Neyt, X., Henderickx, D., & Soetens, E. Psychophysiological investigation of vigilance
> decrement: Boredom or cognitive fatigue? *Physiology & Behavior, 93*(1–2), 369–378.

Volume, issue and pages match. PubMed's date is 2007-10-03 (electronic); the issue is 2008. Cite as
2008. **Correct the author list:** the fourth author is **Soetens, E.** — the version circulating in
the draft used "et al." and did not name him.

Abstract confirms the two thresholds verbatim: *"the usually described vigilance decrement,
expressed as increased reaction times (RTs) after 30 min for both conditions; and a higher cost in
RTs after invalid cues for the endogenous condition only, appearing after 60 min."*

**Relevance:** a 98-minute sitting runs past both documented thresholds.

### 6. Lin, M. et al. (2025) — the nearest content analogue
**Status: CONFIRMED. The volume/year pairing that looked wrong is correct.** PMID 41058350 · DOI [10.1016/j.clae.2025.102515](https://doi.org/10.1016/j.clae.2025.102515)

> Lin, M., Zheng, X., He, C., Li, M., Lu, F., & Hu, L. (2025). Effects of ambient illuminance and
> mobile phone screen brightness on tear film stability, visual fatigue, and blink patterns during
> reading. *Contact Lens and Anterior Eye, 49*(1), 102515.

Every field matches, author list included. Volume 49 issue 1 with a 2025 date was flagged as
internally suspect during triage; PubMed confirms it is right. The suspicion was mine and it was
wrong — recorded here because a rejected doubt is as much part of the record as a caught error.

Abstract confirms the design: 30 subjects, **four** conditions crossing ambient illuminance with
screen brightness (bright/dark room × bright/dark screen), and a **30-minute** reading task in each.
*"The incomplete blink rate in all the groups tended to increase over time (all P < 0.05)."* Reading
in a dark room with a bright screen produced the largest effect on every tear-film indicator.

**Why this matters to the design decision.** This is the closest published study to the present one,
and it spends **30 minutes per condition across only four conditions**. Set against Argilés
(6 min × 6 conditions), the field's range for this outcome is 6–30 minutes per condition. This
protocol runs **~3 minutes across ten conditions** — below the floor of that range on exposure and
above the top of it on condition count, simultaneously. That is the shape of the problem.

**A caution on the letters.** A Letter to the Editor and an authors' Reply were reported as attached
to this paper. Neither has been independently confirmed and neither is cited here. If this paper is
used, the correspondence must be located and read first.

### 7. Talens-Estarelles et al. (2022b)
**Status: METADATA CONFIRMED. SUBSTANTIVE CLAIM NOT CONFIRMED.** PMID 35394083 · DOI [10.1111/opo.12987](https://doi.org/10.1111/opo.12987)

> Talens-Estarelles, C., García-Marqués, J. V., Cerviño, A., & García-Lázaro, S. (2022). Digital
> display use and contact lens wear: Effects on dry eye signs and symptoms. *Ophthalmic &
> Physiological Optics, 42*(4), 797–806.

Metadata matches field for field. The abstract confirms n = 34 (aged 20.87 ± 2.33) and a **20-minute
reading task** on a computer and a smartphone, with and without contact lenses and with artificial
tears — six condition combinations.

**What is NOT confirmed:** the claim that these six conditions were run as **six separate sessions
one week apart, each with a 15-minute acclimatisation**. That was reported from a full-text source
and cannot be checked here — this environment's egress proxy blocks `doi.org` and Crossref, so no
full text is reachable. The abstract does not state the session structure.

This distinction is the whole point of this file. The paper is real and the exposure duration is
verified; **the multi-session structure is the part being used as precedent, and it is exactly the
part still unverified.** Do not cite it for that until the full text is in hand. It is the single
highest-priority item to obtain.

### 8. Buchner & Baumgartner (2007) — the citation the single-level protocol rests on
**Status: CONFIRMED.** PMID 17510822 · DOI [10.1080/00140130701306413](https://doi.org/10.1080/00140130701306413)

> Buchner, A., & Baumgartner, N. (2007). Text–background polarity affects performance irrespective
> of ambient illumination and colour contrast. *Ergonomics, 50*(7), 1036–1063.

Verified against PubMed: journal, volume, issue, pages and both authors match. Verbatim from the
abstract:

- *"In a series of experiments, proofreading performance was consistently better with positive
  polarity (dark text on light background) than with negative polarity displays."*
- *"This positive polarity advantage was **independent of ambient lighting (darkness vs. typical
  office illumination)** and of chromaticity (black and white vs. blue and yellow)."*
- *"A final experiment showed that colour contrast (red text on green background) could not
  compensate for a lack of luminance contrast."*
- *"Physiological measures of effort and strain … and self-reported mood, fatigue, arousal,
  eyestrain, headache, muscle strain and back pain did not vary as a function of any of the
  independent variables."*

**What this licenses.** The claim that the polarity effect *on performance measures* does not depend
on ambient illumination, and therefore that estimating it at a single ambient level does not
sacrifice a documented interaction. It is the primary published justification for withdrawing the
second illumination level.

**Two cautions that must travel with it.** First, its outcome is proofreading performance, not blink
behaviour or tear film — it licenses nothing about the ocular outcomes. Second, its own null on
self-reported eyestrain and fatigue is a caution for this study's subjective measures, not support
for them.

### 9. Piepenbrock, Mayr & Buchner and the display-luminance account
**Status: CONFIRMED (four records).**

> Buchner, A., Mayr, S., & Brandt, M. (2009). The advantage of positive text–background polarity is
> due to high display luminance. *Ergonomics, 52*(7), 882–886.
> PMID 19562598 · DOI [10.1080/00140130802641635](https://doi.org/10.1080/00140130802641635)

> Piepenbrock, C., Mayr, S., Mund, I., & Buchner, A. (2013). Positive display polarity is
> advantageous for both younger and older adults. *Ergonomics, 56*(7), 1116–1124.
> PMID 23654206 · DOI [10.1080/00140139.2013.790485](https://doi.org/10.1080/00140139.2013.790485)

> Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Smaller pupil size and better proofreading
> performance with positive than with negative polarity displays. *Ergonomics, 57*(11), 1670–1677.
> PMID 25135324 · DOI [10.1080/00140139.2014.948496](https://doi.org/10.1080/00140139.2014.948496)

> Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Positive display polarity is particularly
> advantageous for small character sizes: implications for display design. *Human Factors, 56*(5),
> 942–951. PMID 25141597 · DOI [10.1177/0018720813515509](https://doi.org/10.1177/0018720813515509)

**A finding this project must not ignore.** Buchner et al. (2009) state verbatim: *"No positive
polarity advantage was observed when overall display luminance of positive and negative polarity
displays was equivalent … This suggests that the positive polarity advantage is in fact due to the
typically higher luminance of positive polarity displays."*

This build holds display *white* luminance constant across polarities, which means mean screen
luminance is far higher in the positive conditions — by construction. That is the standard
operationalisation of polarity and it is what makes the manipulation ecologically real, but under
Buchner et al. (2009) the effect this study measures is a **luminance** effect as much as a polarity
effect. It must be described that way in the write-up rather than as a pure polarity effect.

### 10. Sethi & Ziat (2023) — the interaction this design gives up
**Status: CONFIRMED.** PMID 36533999 · DOI [10.1080/00140139.2022.2160879](https://doi.org/10.1080/00140139.2022.2160879)

> Sethi, T., & Ziat, M. (2023). Dark mode vogue: Do light-on-dark displays have measurable benefits
> to users? *Ergonomics, 66*(12), 1814–1828.

Abstract confirms: younger and older adults, positive and negative polarity, **bright and dim
environments**, writing and search tasks. Verbatim: *"Eye-tracking results showed higher cognitive
load using negative polarity, reflected in increased search time and pupil diameter for older adults
in a bright environment and **younger adults in a dim environment**."*

**Why this is recorded as a cost, not as support.** This study's sample is young adults. Sethi & Ziat
located the negative-polarity cognitive-load effect for that age group specifically in the DIM
environment — the condition being withdrawn. A single-level protocol at 300 lux cannot address it,
and the limitation belongs in the write-up.

### 11. Fan, Xie, Dong & Wang (2024) — the closest structural analogue, now resolved
**Status: CONFIRMED.** PMID 38894307 · DOI [10.3390/s24113516](https://doi.org/10.3390/s24113516)

> Fan, Q., Xie, J., Dong, Z., & Wang, Y. (2024). The effect of ambient illumination and text color on
> visual fatigue under negative polarity. *Sensors, 24*(11), 3516.

Previously listed as UNRESOLVED. Abstract confirms text colour and ambient illumination crossed
under negative polarity, with pupil accommodation and blink rate measured by eye tracker. Verbatim:
*"text color significantly affects visual fatigue, with red text causing the highest level of visual
fatigue and yellow text causing the lowest"*; *"Improvements in ambient lighting reduce visual
fatigue, but the degree of improvement varies depending on the text color."*

That last clause is an **ambient × text-colour interaction**, and this design can no longer estimate
it. Recorded here so the loss is explicit rather than discovered by a reviewer.

### 12. Li, Huang, Li, Ma, Zhang & Li (2022)
**Status: CONFIRMED.** PMID 34856871 · DOI [10.1080/00140139.2021.2013546](https://doi.org/10.1080/00140139.2021.2013546)

> Li, Y., Huang, Y., Li, X., Ma, J., Zhang, J., & Li, J. (2022). The influence of brightness
> combinations and background colour on legibility and subjective preference under negative
> polarity. *Ergonomics, 65*(8), 1046–1056.

Abstract confirms: *"higher brightness contrasts led to better legibility; different background
colours with identical brightness and saturation did not cause significant differences."* Supports
carrying luminance contrast as a covariate on the colour factor, which this build already does
(`wcag_contrast_ratio`).

### 13. Luzsa & Mayr (2025), Mayr & Buchner (2010), Dobres et al. (2016)
**Status: CONFIRMED (three records).** Supporting polarity literature; none is load-bearing here.

> Luzsa, R., & Mayr, S. (2025). The polarity effect in virtual and video see-through mixed
> reality — better proofreading performance and faster optotype identification with positive display
> polarity. *Ergonomics, 69*(2), 221–235.
> PMID 39918051 · DOI [10.1080/00140139.2025.2457470](https://doi.org/10.1080/00140139.2025.2457470)

> Mayr, S., & Buchner, A. (2010). After-effects of TFT-LCD display polarity and display colour on the
> detection of low-contrast objects. *Ergonomics, 53*(7), 914–925.
> PMID 20582772 · DOI [10.1080/00140139.2010.484508](https://doi.org/10.1080/00140139.2010.484508)

> Dobres, J., Chahine, N., Reimer, B., Gould, D., Mehler, B., & Coughlin, J. F. (2016). Utilising
> psychophysical techniques to investigate the effects of age, typeface design, size and display
> polarity on glance legibility. *Ergonomics, 59*(10), 1377–1391.
> PMID 26727912 · DOI [10.1080/00140139.2015.1137637](https://doi.org/10.1080/00140139.2015.1137637)

### 14. The Lin et al. (2025) correspondence — LOCATED
**Status: CONFIRMED to exist; CONTENTS NOT READ.**

> Erdinest, N., & Bura, N. (2026). Letter to the Editor concerning: "Effects of ambient illuminance
> and mobile phone screen brightness on tear film stability, visual fatigue, and blink patterns
> during reading." *Contact Lens and Anterior Eye, 49*(2), 102618.
> PMID 41520503 · DOI [10.1016/j.clae.2026.102618](https://doi.org/10.1016/j.clae.2026.102618)

> Reply to Letter to the Editor concerning the same. *Contact Lens and Anterior Eye, 49*(2), 102622.
> PMID 41775136 · DOI [10.1016/j.clae.2026.102622](https://doi.org/10.1016/j.clae.2026.102622)

Item 6 above flagged these as *"reported … neither has been independently confirmed"* and required
that they be located before Lin et al. is used. **They are now located and are real.** PubMed carries
no abstract for either — both are Letters — so their CONTENT is still unread. Lin et al. (2025) is
cited in this project's illumination rationale, so the correspondence must be obtained and read from
an unrestricted network before that citation is relied on in the thesis.

### 15. Atuanya et al. (2025) and Azam et al. (2023) — a counter-consideration for 300 lux
**Status: CONFIRMED (two records).**

> Atuanya, G. N., Okhaifoh, G. I., Bale, B. I., & Ayikoru, C. P. (2025). Effect of illumination on
> near positive fusional vergence in young adults. *Clinical Optometry, 17*, 297–306.
> PMID 40969672 · DOI [10.2147/OPTO.S534389](https://doi.org/10.2147/OPTO.S534389)

> Azam, R., Karmakar, S., Mondal, A., & Bhardwaj, G. K. (2023). The effect of illumination on
> positive fusional vergence. *The British and Irish Orthoptic Journal, 19*(1), 78–84.
> PMID 37780187 · DOI [10.22599/bioj.296](https://doi.org/10.22599/bioj.296)

Both measured positive fusional vergence at 50, 100 and 150 lux in young adults and both found it
**significantly lower at higher illumination**. Atuanya et al. conclude verbatim that *"lower-to-
moderate lighting optimises binocular coordination during near tasks."*

**Recorded as a counter-consideration, not suppressed.** Neither study measured beyond 150 lux, so
300 lux is outside their range and the extrapolation is not theirs. Positive fusional vergence is
also not an outcome of this study. But both point the opposite way to the decision to raise ambient
illumination, and the write-up should say so rather than cite only the supportive literature.

### 16. Lighting standards — EXTERNALLY DISCOVERED, AWAITING VERIFICATION
**Status: NOT VERIFIED. Do not cite as given.**

The 300 lux target was chosen partly on the basis that guidance for screen work places ambient
illuminance at roughly 300–500 lux — below the 500–750 lux specified for paper tasks — because a
display is self-luminous and the screen-to-surround luminance ratio must be controlled. The figures
were found in secondary sources (lighting-industry technical pages and standards-preview material),
**not in the standards themselves**. This environment's egress proxy blocks the publisher and
standards domains, and `www.ncbi.nlm.nih.gov` is also blocked, so none of the following could be
checked at source:

- **EN 12464-1** — 500 lux maintained illuminance for office reading and writing tasks.
- **ISO 9241** (Parts 6/7/303) — ambient illuminance for work with visual display terminals, and the
  treatment of veiling reflections.
- **IS 3646** — the 300–500 lux figure for Indian offices and classrooms, asserted in
  `src/experiment/illumination.ts` and never verified.

**These must be checked against the standard texts before any of them appears in the thesis.** Until
then the 300 lux target is defended on the measured photometry in `illumination.ts` — the level at
which room illumination dominates the screen's contribution to face illuminance — and not on a
standards citation.

### 17. Sengsoon & Intaruk (2025) — the direct light-mode/dark-mode comparison
**Status: CONFIRMED.** PMID 40283833 · DOI [10.3390/ijerph22040609](https://doi.org/10.3390/ijerph22040609)

> Sengsoon, P., & Intaruk, R. (2025). Immediate effects of light mode and dark mode features on visual
> fatigue in tablet users. *International Journal of Environmental Research and Public Health, 22*(4),
> 609.

The PMID and DOI carried by this reference were **checked, not assumed**, and both hold. Journal,
volume, issue, article number, year and both authors match PubMed field for field. PubMed types the
record as a Randomized Controlled Trial.

Abstract confirms: 30 female tablet users, block randomisation, every participant using both modes,
with visual fatigue, critical flicker frequency and dry eye symptoms measured before and after each
mode. Verbatim: *"No statistically significant difference in visual fatigue was observed between the
two modes"*; *"a statistically significant difference was found in critical flicker frequency … and
dry eye symptoms … between the two modes"*; and all three outcomes *"significantly increased after
tablet use in both modes."*

**What this licenses, and what it does not.** It licenses the statement that polarity moves dry-eye
symptoms and critical flicker frequency on a tablet, and — more usefully — that a subjective
visual-fatigue scale can fail to separate the modes while objective measures separate them. That is a
direct caution for this study's own subjective instrument. It does **not** license a claim that dark
mode reduces visual fatigue: the paper's primary comparison on visual fatigue was null, and the
concluding sentence that dark mode *"may help reduce the risk of eye fatigue"* is the authors'
inference from secondary outcomes, not a result on fatigue.

**Three limits that must travel with it.** The sample is all female and n = 30. The exposure duration
is **not stated in the abstract and is therefore NOT verified here** — this paper cannot be used as an
exposure-duration precedent until the full text is read. And "immediate effects" in the title is the
authors' framing, not a measured interval.

### 18. Jiménez et al. (2020) — the exposure-duration precedent that changes the picture
**Status: CONFIRMED.** PMID 31841707 · DOI [10.1016/j.visres.2019.11.006](https://doi.org/10.1016/j.visres.2019.11.006)

> Jiménez, R., Redondo, B., Molina, R., Martínez-Domingo, M. Á., Hernández-Andrés, J., & Vera, J.
> (2020). Short-term effects of text-background color combinations on the dynamics of the
> accommodative response. *Vision Research, 166*, 33–42.

Every field matches, all six authors included. PubMed's date of 2019-12-13 is the electronic date;
volume 166 is the 2020 issue, which is what the synopsis cites.

Abstract, verbatim: *"Twenty healthy young adults read fourteen 2-min passages designed with fourteen
different color combinations between text and background, while the accommodative and pupil responses
were continuously measured with a binocular open-field autorefractometer."*

**This is the most consequential find in this pass, and it cuts against a claim already in this
file.** Item 6 records the field's range as 6–30 minutes per condition (Argilés, 6 min × 6
conditions; Lin, 30 min × 4 conditions) and concludes that this protocol's ~3 minutes across ten
conditions sits below the floor on exposure and above the ceiling on condition count. Jiménez et al.
is a published precedent for **2 minutes per condition across fourteen conditions** — shorter and
wider than this protocol on both axes at once.

**The weakening is outcome-specific and must be stated that way.** Jiménez et al. measure
accommodative response, pupil size, reading speed and perceived legibility. They do **not** measure
blink completeness or tear film. Argilés and Lin remain the only verified precedents for this study's
primary outcome, and 2 minutes is nowhere shown to be sufficient for it. What this citation licenses
is the narrower claim that a many-condition, few-minutes-per-condition text-colour design is an
established form in this literature **for pupillary and accommodative outcomes**. It does not rescue
the exposure duration for blink completeness.

It also supplies two findings the design must reckon with: *"The blue-red combination induced a
heightened accommodative response, whereas positive polarities were associated with more variability
of the accommodative response and smaller pupil sizes"* — independent support for the
pupil-mediated account in item 9 — and *"The manipulation of text-background color did not have a
significant effect on reading speed"*, a published null on a performance outcome this study also
collects.

### 19. Redondo et al. (2025) — the multi-session precedent item 7 could not supply
**Status: CONFIRMED.** PMID 40466853 · DOI [10.1016/j.exer.2025.110463](https://doi.org/10.1016/j.exer.2025.110463)

> Redondo, B., Jiménez, R., Vera, J., & Rosenfield, M. (2025). The impact of break schedules on
> digital eye strain symptoms and ocular accommodation during prolonged near work. *Experimental Eye
> Research, 258*, 110463.

Journal, volume, article number, year and all four authors match. Note the author overlap with item 18
(Redondo, Jiménez and Vera are the Granada group) — the two papers are distinct records with distinct
DOIs and different designs.

Abstract confirms, verbatim: *"Twenty-four young adults participated in four experimental conditions,
performed on four different days in random order: no break, one break at 20 min, one break every 10
min and self-paced breaks"*, each around a **40-minute** reading task, with accommodative measures
taken on a Grand Seiko WAM-5500 open-field autorefractor.

**What this licenses.** Two things. First, a verified precedent for **running each condition of a
repeated-measures visual-fatigue study as a separate session on a separate day** — the structure item
7 attributes to Talens-Estarelles et al. (2022b) but cannot confirm from the abstract. This one is
confirmed from the abstract and can carry that argument in the meantime. Second, the finding that
break schedule alters symptoms and near work-induced transient myopia, which is why any within-session
break structure in this protocol is a design variable and not a convenience.

**The caution.** Four days for four conditions does not scale to ten conditions, and this paper offers
no precedent for compressing ten conditions into one sitting. Cited honestly, it argues for *more*
sessions, not fewer.

### 20. Dobres, Chahine & Reimer (2017) — a DIFFERENT paper from Dobres et al. (2016)
**Status: CONFIRMED.** PMID 28166901 · DOI [10.1016/j.apergo.2016.11.001](https://doi.org/10.1016/j.apergo.2016.11.001)

> Dobres, J., Chahine, N., & Reimer, B. (2017). Effects of ambient illumination, contrast polarity,
> and letter size on text legibility under glance-like reading. *Applied Ergonomics, 60*, 68–73.

**Recorded explicitly as a separate record from item 13.** Dobres et al. (2016), *Ergonomics* 59(10)
1377–1391, PMID 26727912, has **six** authors (Dobres, Chahine, Reimer, Gould, Mehler, Coughlin). This
2017 paper has **three** (Dobres, Chahine, Reimer), a different journal, a different DOI and a
different design. They are two papers and must never be merged or collapsed into one citation.
PubMed's date of 2016-11-15 is the electronic date; volume 60 is the 2017 issue.

Abstract confirms the design and, verbatim, the finding: *"legibility thresholds … were highest for
the negative polarity configurations under dark ambient illumination, indicat[ing] worse performance.
Conversely, the positive polarity conditions under dark ambient illumination and all conditions under
bright illumination demonstrated significantly reduced thresholds."* The authors attribute this to
*"pupillary contraction that reduces optical aberrations."*

**What this licenses, and the tension it creates.** It licenses the pupil-mediated mechanism stated in
Section 1.3. But note carefully what it says about ambient light: the polarity penalty appeared **only
in the dark condition**, and bright ambient illumination abolished the difference between polarities.
That is a **polarity × ambient interaction on legibility**, and it sits directly against item 8
(Buchner & Baumgartner 2007), whose null on ambient is the primary justification for the single-level
protocol. The two findings differ in task (glance-like lexical decision vs sustained proofreading) and
in illumination range, and the write-up must acknowledge the disagreement rather than cite only the
convenient side of it.

### 21. Lin, C., Ji & Lin (2024) — a DIFFERENT paper from Lin, M. et al. (2025), and the 300 lux anchor
**Status: CONFIRMED.** PMID 38629123 · DOI [10.1080/00140139.2024.2339439](https://doi.org/10.1080/00140139.2024.2339439)

> Lin, C., Ji, Z., & Lin, Y. (2024). Optimum display luminance and contrast polarity of desktop
> head-up display under office lighting level based on visual ergonomic study. *Ergonomics, 67*(11),
> 1491–1503.

**Recorded explicitly as a separate record from item 6.** First author here is **Lin, Caixin**
(Fudan University, display engineering), in *Ergonomics*; item 6 is **Lin, M.** (Wenzhou, clinical
optometry) in *Contact Lens and Anterior Eye*. Different first authors, different co-authors,
different journals, different years, different DOIs. Author-and-year matching on "Lin" would collapse
these two; the DOIs keep them apart.

Abstract confirms: two contrast polarities (N = 36) and five display luminance levels (N = 21),
evaluating visual performance, fatigue and discomfort. Verbatim: *"A positive polarity advantage was
found over negative in visual fatigue and discomfort"*, and *"The calculated optimum display luminance
… was 153 cd/m² under 300 lx."*

**Why this matters here.** It is the only verified record in this file that evaluates polarity **at
300 lux specifically** — the ambient level this protocol fixes — and it reports a positive polarity
advantage there on fatigue and discomfort, not merely on performance. That partly answers the gap
flagged in item 8, whose outcome was proofreading only. **The caveat is the display:** this is a
long-viewing-distance desktop head-up display, and the authors attribute the high optimum luminance
to the smaller target angular size that the longer distance produces. The 153 cd/m² figure is
specific to that geometry and must not be transferred to a tablet at reading distance.

### 22. Piepenbrock et al. (2014a) and (2014b) — the a/b labels checked against the records
**Status: CONFIRMED (both, already listed in item 9); a/b assignment verified.**

The synopsis distinguishes two 2014 papers by the same three authors. The labels were checked against
PubMed rather than inferred, and both are assigned correctly:

> **2014a** — Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Positive display polarity is
> particularly advantageous for small character sizes: Implications for display design. *Human
> Factors, 56*(5), 942–951.
> PMID 25141597 · DOI [10.1177/0018720813515509](https://doi.org/10.1177/0018720813515509)

> **2014b** — Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Smaller pupil size and better
> proofreading performance with positive than with negative polarity displays. *Ergonomics, 57*(11),
> 1670–1677.
> PMID 25135324 · DOI [10.1080/00140139.2014.948496](https://doi.org/10.1080/00140139.2014.948496)

Title, journal, volume, issue and pages match the synopsis for each. **These are two distinct papers
by the same authors in the same year and must not be merged.** The a/b suffixes are load-bearing:
2014a is the character-size study (*"the positive polarity advantage linearly increased with
decreasing character size"*), 2014b is the pupillometric study (*"pupil sizes were smaller and
proofreading performance was better with positive than with negative polarity displays"*). Section 1.3
cites both together for the pupil-mediated account, which is correct — 2014b supplies the pupil
measurement and 2014a the size-dependence that the same mechanism predicts.

### 23. Tian et al. (2022) — colour × screen brightness in a dark room
**Status: CONFIRMED.** PMID 35684700 · DOI [10.3390/s22114082](https://doi.org/10.3390/s22114082)

> Tian, P., Xu, G., Han, C., Zheng, X., Zhang, K., Du, C., Wei, F., & Zhang, S. (2022). Effects of
> paradigm color and screen brightness on visual fatigue in light environment of night based on eye
> tracker and EEG acquisition equipment. *Sensors, 22*(11), 4082.

Journal, volume, issue, article number, year and all eight authors match.

Abstract confirms: subjective Likert ratings plus pupil diameter (eye tracker) and θ + α band EEG,
crossing paradigm colour with screen brightness in a dark environment (< 3 lx). Verbatim: *"The
Likert scale showed that a low screen brightness in the dark environment could reduce the visual
fatigue of the subjects, and participants preferred blue to red"*; *"EEG frequency band data concluded
that there was no significant difference between paradigm colours and screen brightness on visual
fatigue."*

**What this licenses.** A text-colour preference ordering (blue over red) that runs in the same
direction as Fan et al. (item 11), and a reminder that subjective and objective measures dissociate.
**Its ambient level is the opposite of this study's:** < 3 lx, not 300 lux. It is evidence about
night-time dark-room use and cannot be carried across to a lit room. Its own EEG null is also a
caution against over-reading any colour effect.

### 24. Seguí et al. (2015) and Cantó-Sancho et al. (2024) — the CVS-Q instrument and a validation
**Status: CONFIRMED (two records).**

> Seguí, M. del M., Cabrero-García, J., Crespo, A., Verdú, J., & Ronda, E. (2015). A reliable and
> valid questionnaire was developed to measure computer vision syndrome at the workplace. *Journal of
> Clinical Epidemiology, 68*(6), 662–673.
> PMID 25744132 · DOI [10.1016/j.jclinepi.2015.01.015](https://doi.org/10.1016/j.jclinepi.2015.01.015)

> Cantó-Sancho, N., Linhares, J., Ronda-Pérez, E., Franco, S., Perales, E., & Seguí-Crespo, M. (2024).
> Cross-cultural validation into Portuguese of a questionnaire to assess computer vision syndrome in
> workers exposed to digital devices. *Arquivos Brasileiros de Oftalmologia, 87*(6), e20220256.
> PMID 37878876 · DOI [10.5935/0004-2749.2022-0256](https://doi.org/10.5935/0004-2749.2022-0256)

All fields match both records, author lists included. The Cantó-Sancho DOI stem reads `2022-0256`
against a 2024 issue — that is the journal's own submission-year identifier scheme, and PubMed's
`pii` (`S0004-27492024000600307`) confirms volume 87 issue 6 is the 2024 issue. PubMed's
`publication_date` of 2023-10-20 is the ahead-of-print date; cite the issue year, 2024, as the
synopsis does. Note also that Seguí (2015) and Seguí-Crespo (2024) are the **same researcher**
publishing under two name forms, so the two records are not independent validations.

Seguí et al. confirms the CVS-Q's construction: *"the frequency and intensity of 16 symptoms using a
single rating scale (symptom severity) that fits the Rasch rating scale model"*, sensitivity and
specificity over 70%, ICC 0.802. Cantó-Sancho et al. confirms the Portuguese adaptation in 280
workers, Cronbach's alpha 0.793, and the cut-off: *"A worker who scored ≥7 points would have computer
vision syndrome."*

**CORRECTION — THE CUT-OFF. This entry previously read "the ≥7 cut-off ... used by this project's
instrument". That was wrong, and wrong in a way that would have changed a classification variable
in the data had it been acted on.**

≥7 is the **Portuguese** version's cut-off, quoted above from Cantó-Sancho et al. This project
administers the **original 16-item CVS-Q**, whose cut-off is **≥6** — which is what
`src/scales/cvsq.ts` implements. The two are different instruments' thresholds and conflating them
would have reclassified every participant scoring exactly 6.

The original's own authors say so. Seguí-Crespo is a co-author of the CVS-Q teen adaptation (record
24b below), which states: *"When comparing both questionnaires (CVS-Q vs. CVS-Q teen), it is
observed that the total number of items in the adolescent questionnaire is lower (16 vs. 14), the
cut-off point being the same, although this differs for other linguistic versions that are also
derived from the original."* The teen cut-off is ≥6, so the original's is ≥6, and that paper
explicitly flags the linguistic versions as differing — which is exactly the trap this entry fell
into.

**Provenance of the ≥6, stated exactly.** The Seguí (2015) full text could not be read from this
environment: the publisher and the institutional repository copy are both blocked by the network
egress proxy, and the PubMed abstract confirms a cut-off was derived by ROC analysis without giving
its value. The ≥6 figure therefore rests on record 24b's statement that the two cut-offs are the
same, from a paper two of the original's authors wrote. **The investigator should confirm it once
against the Seguí (2015) full text, which is the one source that settles it directly.** Until then
this is a same-authors secondary statement, not a reading of the primary.

### 24b. Seguí-Crespo et al. (2024) — CVS-Q teen, and the original's cut-off
**Status: CONFIRMED.** PMID 39285189 · DOI [10.1038/s41598-024-70821-9](https://doi.org/10.1038/s41598-024-70821-9)
Record and full text retrieved from PubMed / PubMed Central (PMC11405871).

> Seguí-Crespo, M., Cantó-Sancho, N., Sánchez-Brau, M., & Ronda-Pérez, E. (2024). CVS-Q teen: an
> adapted, reliable and validated tool to assess computer vision syndrome in adolescents.
> *Scientific Reports, 14*(1), 21576.

Author list, journal, volume, issue, pages and year are as PubMed returns them. Note that
Seguí-Crespo here and Seguí (2015) at entry 24 are the SAME researcher under two name forms, and
Cantó-Sancho appears in both this record and the Portuguese validation — so 24, 24b and the
Portuguese record are **not independent**. That is precisely why 24b is cited for what the original
instrument's authors say about their own cut-off, and for nothing else.

Verified full text gives, for the ADOLESCENT instrument: 14 items, cut-off ≥6 points, sensitivity
85.2%, specificity 76.5%, AUC 0.879 (95% CI 0.836–0.922), ICC 0.77, Cohen's κ 0.49, person
reliability 0.69. And, for the ORIGINAL 16-item CVS-Q by direct comparison: sensitivity 75.0%,
specificity 70.2%, AUC 0.826, and the same ≥6 cut-off.

**What this licenses.** The ≥6 cut-off this project's instrument uses, and the original's
sensitivity/specificity/AUC figures quoted above. **What it does not license:** anything about
adolescents — this study enrols 18–35 — and it is not a substitute for reading Seguí (2015).

**What entry 24 licenses.** The 16-item structure used by this project's instrument and the
psychometric claims made for it; ≥7 **only** as the Portuguese version's cut-off, which is how
LITERATURE_REVIEW.md already cites it. **What it does not license:** the CVS-Q was developed and
validated as an *occupational* screening tool for habitual workplace exposure, not as a within-session
change score after a few minutes of reading. Using it as a repeated pre/post measure across ten short
conditions is outside its validated use, and that must be stated as a limitation rather than left
implicit. Item 3 (Talens-Estarelles 2020) is the only verified record here in which the CVS-Q
discriminated between display conditions, and it needed 15 minutes per block to do so.

### 25. Cardona et al. (2011)
**Status: CONFIRMED.** PMID 21275516 · DOI [10.3109/02713683.2010.544442](https://doi.org/10.3109/02713683.2010.544442)

> Cardona, G., García, C., Serés, C., Vilaseca, M., & Gispets, J. (2011). Blink rate, blink amplitude,
> and tear film integrity during dynamic visual display terminal tasks. *Current Eye Research, 36*(3),
> 190–197.

All fields match. Note the shared author with item 1 (Cardona is second author on Argilés et al.
2015); the records are distinct.

Abstract confirms n = 25 and, verbatim: blink rate *"during fast- and slow-paced game play decreasing
to almost 1/3 and 1/2 of baseline levels"*, with *"a larger percentage of incomplete blinks during
dynamic tasks"*, and tear-film break-up differentiating conditions.

**What this licenses.** That blink rate and incomplete-blink proportion respond to *task* properties —
here the rate of visual information presentation — and not only to the display. That is a confound
this protocol must control: if reading passages differ in difficulty or pace across colour conditions,
this paper says the blink outcome will move for that reason alone.

### 26. Hirota et al. (2013) — the non-monotonic time course
**Status: CONFIRMED.** PMID 23770659 · DOI [10.1097/OPX.0b013e31829962ec](https://doi.org/10.1097/OPX.0b013e31829962ec)

> Hirota, M., Uozato, H., Kawamorita, T., Shibata, Y., & Yamamoto, S. (2013). Effect of incomplete
> blinking on tear film stability. *Optometry and Vision Science, 90*(7), 650–657.

All fields match.

Abstract confirms: 11 subjects, mean age 21.3, a **60-minute** computer task with measurement every 15
minutes. Verbatim: *"Although the total blink rate changed very little, the complete and incomplete
blink rates fluctuated during the VDT experiment"*; break-up time at 30 min (4.33 ± 2.57 s) was
significantly shorter than baseline (8.62 ± 1.54 s); *"After 30 min, the incomplete blink rate began
decreasing … Ring breakup time increased (improved) after 45 min; however, the incomplete blink rate
began to increase again after approximately 50 min."* Conclusion, verbatim: *"Even if the total blink
rate decreases, the tear film remains stable so long as almost all blinks are complete."*

**What this licenses — and a warning about short conditions.** It is the strongest verified support
for treating blink *completeness* rather than blink *rate* as the primary outcome, which is the
position taken in Section 1.2. But it also documents that incomplete-blink proportion follows a
**non-monotonic, oscillating time course** over an hour. A design that samples ~3 minutes per
condition is sampling a single point on a curve that is known to rise, fall and rise again, and
condition order will therefore be confounded with phase of that curve unless order is fully
counterbalanced. n = 11.

### 27. Fjaervoll et al. (2022) — the mechanistic review behind Section 1.2
**Status: CONFIRMED.** PMID 35441459 · DOI [10.1111/aos.15150](https://doi.org/10.1111/aos.15150)

> Fjaervoll, K., Fjaervoll, H., Magno, M., Nøland, S. T., Dartt, D. A., Vehof, J., & Utheim, T. P.
> (2022). Review on the possible pathophysiological mechanisms underlying visual display
> terminal-associated dry eye disease. *Acta Ophthalmologica, 100*(8), 861–877.

All fields match, all seven authors included. The first two authors are different people sharing a
surname (Ketil and Haakon Fjaervoll); both are in the synopsis's list correctly as a single
"Fjaervoll, K." entry with the rest as *et al.*

Abstract confirms 55 included articles and, verbatim: *"VDT use causes DED mainly through impaired
blinking patterns. Changes in parasympathetic signalling and increased exposure to blue light, which
could disrupt ocular homeostasis, were proposed in some studies but lack sufficient scientific
support."*

**What this licenses.** Exactly the claim Section 1.2 makes: that display-associated dry eye is
attributed principally to impaired blinking, with insufficient support for the parasympathetic and
blue-light routes. It is a narrative review, not primary evidence, and should be cited as the source
of a mechanistic consensus rather than of a measured effect.

### 28. Kamøy et al. (2022)
**Status: CONFIRMED.** PMID 35122403 · DOI [10.1111/aos.15105](https://doi.org/10.1111/aos.15105)

> Kamøy, B., Magno, M., Nøland, S. T., Moe, M. C., Petrovski, G., Vehof, J., & Utheim, T. P. (2022).
> Video display terminal use and dry eye: Preventive measures and future perspectives. *Acta
> Ophthalmologica, 100*(7), 723–739.

All fields match. Same Oslo group and an overlapping author list with item 27, in the same journal and
volume but a **different issue** (7, not 8) with a different DOI — two distinct reviews, not one.

Abstract confirms 31 included articles and, verbatim, a finding worth carrying: *"Taking frequent
breaks was associated with fewer symptoms, but no study assessed the commonly suggested 20-20-20
rule."*

**What this licenses.** The statement that the most widely repeated ergonomic prescription for digital
eye strain has no direct evidential test. Cited with item 33 (Singh et al.) and item 32 (Mataftsi et
al.), it supports Section 1.4's framing that the promoted remedies lack trial support.

### 29. Sheppard & Wolffsohn (2018) — the two-mechanism framework
**Status: CONFIRMED.** PMID 29963645 · DOI [10.1136/bmjophth-2018-000146](https://doi.org/10.1136/bmjophth-2018-000146)

> Sheppard, A. L., & Wolffsohn, J. S. (2018). Digital eye strain: Prevalence, measurement and
> amelioration. *BMJ Open Ophthalmology, 3*(1), e000146.

All fields match.

Abstract confirms the split Section 1.2 is built on, verbatim: *"Symptoms fall into two main
categories: those linked to accommodative or binocular vision stress, and external symptoms linked to
dry eye."* It also confirms the measurement caution: objective indices include *"critical
flicker-fusion frequency, blink rate and completeness, accommodative function and pupil
characteristics"*, and *"correlations between objective and subjective measures are not always
apparent."*

**What this licenses.** The two-mechanism framing, and — more importantly for this protocol — the
explicit warning that objective and subjective measures need not agree. That warning should be cited
*before* the results, not deployed afterwards to explain a null.

### 30. Kaur et al. (2022)
**Status: CONFIRMED.** PMID 35809192 · DOI [10.1007/s40123-022-00540-9](https://doi.org/10.1007/s40123-022-00540-9)

> Kaur, K., Gurnani, B., Nayak, S., Deori, N., Kaur, S., Jethani, J., Singh, D., Agarkar, S.,
> Hussaindeen, J. R., Sukhija, J., & Mishra, D. (2022). Digital eye strain: A comprehensive review.
> *Ophthalmology and Therapy, 11*(5), 1655–1680.

All fields match, all eleven authors included in the correct order.

Abstract confirms the prevalence figures cited in Section 1.1: *"A variable prevalence ranging from 5
to 65% has been reported in the pre-COVID-19 era"*, rising to *"50-60%"* among children during
lockdown.

**A caution on how this is used.** Section 1.1 cites it for a rise alongside remote work and study.
That is supported. But the review's own pre-COVID range (5–65%) is materially different from the
69.0% pooled estimate cited from Ccami-Bernal et al. in the same sentence, and the two figures should
not be presented as if they agree. This is a narrative review, not a meta-analysis; where the two
disagree, the meta-analysis is the better authority for a pooled number.

### 31. Ccami-Bernal et al. (2024) — the prevalence figure in Section 1.1
**Status: CONFIRMED.** PMID 37866176 · DOI [10.1016/j.optom.2023.100482](https://doi.org/10.1016/j.optom.2023.100482)

> Ccami-Bernal, F., Soriano-Moreno, D. R., Romero-Robles, M. A., Barriga-Chambi, F., Tuco, K. G.,
> Castro-Diaz, S. D., Nuñez-Lupaca, J. N., Pacheco-Mendoza, J., Galvez-Olortegui, T., &
> Benites-Zapata, V. A. (2024). Prevalence of computer vision syndrome: A systematic review and
> meta-analysis. *Journal of Optometry, 17*(1), 100482.

All fields match, all ten authors in order. PubMed's date of 2023-10-30 is the electronic date; volume
17 issue 1 is the 2024 issue, which the synopsis cites.

Every number Section 1.1 attributes to this paper was checked against the abstract and every one is
verbatim: 103 cross-sectional studies, **66 577 participants**, pooled prevalence **69.0% (95% CI 62.3
to 75.3)**, range **12.1 to 97.3%**, and **76.1%** in university students. Heterogeneity is I² = 99.7%.

**Two things must travel with it.** First, that I² of 99.7% — the pooled 69.0% is an average over
almost completely heterogeneous studies, and the paper's own conclusion is that *"future studies
should standardize a definition of CVS."* Quoting 69.0% without the heterogeneity overstates its
precision. Second, the paper's own meta-regression finding that *"using the CVS-Q scale was associated
with a lower prevalence of CVS"* (75.4% in studies not using it) bears directly on this project's
choice of instrument.

### 32. Mataftsi et al. (2023)
**Status: CONFIRMED.** PMID 36977430 · DOI [10.1016/j.ypmed.2023.107493](https://doi.org/10.1016/j.ypmed.2023.107493)

> Mataftsi, A., Seliniotaki, A. K., Moutzouri, S., Prousali, E., Darusman, K. R., Adio, A. O.,
> Haidich, A. B., & Nischal, K. K. (2023). Digital eye strain in young screen users: A systematic
> review. *Preventive Medicine, 170*, 107493.

All fields match, all eight authors in order.

Abstract confirms: ten studies, 2365 participants, restricted to pre-presbyopic (< 40) users and to
studies using a validated questionnaire. Verbatim: *"blue-blocking filters do not appear to prevent
DES (2 studies, 130 participants), while use of screens for > 4-5 h/day … and poor ergonomic
parameters during screen use … are associated with higher DES symptoms' score"*, at *"low to moderate
quality of evidence."*

**What this licenses.** Precisely the sentence in Section 1.4: no evidence for blue-blocking filters,
support for ergonomic optimisation and shorter exposure. Cite the evidence grade with it — the review
itself grades the evidence low-to-moderate, and two studies with 130 participants is a thin base for a
negative claim.

### 33. Singh et al. (2022) — the strongest verified support for Section 1.4
**Status: CONFIRMED.** PMID 35597519 · DOI [10.1016/j.ophtha.2022.05.009](https://doi.org/10.1016/j.ophtha.2022.05.009)

> Singh, S., McGuinness, M. B., Anderson, A. J., & Downie, L. E. (2022). Interventions for the
> management of computer vision syndrome: A systematic review and meta-analysis. *Ophthalmology,
> 129*(10), 1192–1215.

All fields match.

Every figure Section 1.4 attributes to it is verbatim in the abstract: **45 RCTs**, **4497
participants**, and *"We did not identify high-certainty evidence supporting the use of any of the
therapies analyzed. Low-certainty evidence suggested that oral omega-3 supplementation reduces dry eye
symptoms in symptomatic computer users."* Blue-blocking spectacles did not reduce visual fatigue
symptoms (3 RCTs, low certainty); multifocal lenses did not improve visual fatigue scores.

**What this licenses.** The claim that the heavily promoted remedies for digital eye strain lack
trial support, stated at GRADE certainty rather than as opinion. This is the load-bearing citation for
the problem statement and it holds.

### 34. Pucker et al. (2024)
**Status: CONFIRMED.** PMID 39308959 · DOI [10.2147/OPTO.S412382](https://doi.org/10.2147/OPTO.S412382)

> Pucker, A. D., Kerr, A. M., Sanderson, J., & Lievens, C. (2024). Digital eye strain: Updated
> perspectives. *Clinical Optometry, 16*, 233–246.

All fields match. Same journal as item 15 (Atuanya et al.), different volume and year.

Abstract confirms, verbatim: *"The two most used, validated DES questionnaires are the Computer Vision
Syndrome Questionnaire (CVS-Q) and Computer Vision Symptom Scale (CVSS17)"*, and *"Ocular surface
symptoms in DES are integrally tied to decreased blink frequency."*

**What this licenses.** The choice of the CVS-Q as one of only two validated instruments — an
independent second source for that claim alongside item 24. Note its stated prevalence range of
*"8.2% to 100%"*, wider still than Ccami-Bernal's, which reinforces the point in item 31 that no
single prevalence number should be quoted as settled.

### 35. Klinke et al. (2024) — the colour-vision screening method
**Status: CONFIRMED.** PMID 38228434 · DOI [10.1016/j.identj.2023.12.009](https://doi.org/10.1016/j.identj.2023.12.009)

> Klinke, T., Hannak, W., Böning, K., & Jakstat, H. (2024). A comparative study of the sensitivity and
> specificity of the Ishihara test with various displays. *International Dental Journal, 74*(4),
> 892–896.

All fields match. PubMed's date of 2024-01-15 and the 2024 issue agree.

Abstract confirms: 38 dental students, 25 Ishihara plates presented on a smartphone display (n = 38)
and/or a calibrated 22-inch monitor (n = 18). Verbatim: *"On the SD, a sensitivity of 96.0% and a
specificity of 94.7% were calculated"*; *"No significant difference between display modi (PC vs SD)
was evaluated (P > .05)."* Conclusion: *"The presentation of ICC on an SD is useful and can be used
for the investigation of a possible CVD of large groups."*

**What this licenses, and three limits.** It licenses screening participants for colour vision
deficiency using Ishihara plates presented on a display rather than the printed booklet — necessary
here because text colour is a factor and a colour-deficient participant would confound it. The limits
must travel with it. The paper's own label is *in vitro*; the sample is 38 dental students, so the
prevalence base for a sensitivity/specificity estimate is very small; and the screen used was either a
smartphone or a **calibrated** monitor. Nothing here licenses plate presentation on an uncalibrated
display, which is the condition under which a screening step of this kind would usually be run.

### 36. Abe (2023) — PERCLOS, and the limits on it
**Status: CONFIRMED.** PMID 37193281 · DOI [10.1093/sleepadvances/zpad006](https://doi.org/10.1093/sleepadvances/zpad006)

> Abe, T. (2023). PERCLOS-based technologies for detecting drowsiness: Current evidence and future
> directions. *SLEEP Advances, 4*(1), zpad006.

All fields match; single author. (PubMed's journal title is "Sleep advances: a journal of the Sleep
Research Society"; the journal styles itself *SLEEP Advances*, which is what the synopsis prints.)

Abstract confirms the definition used in this project — *"the percentage of time that the eyes are
more than 80% closed (PERCLOS)"* — and that it is *"one of the most validated indices used for the
passive detection of drowsiness."*

**What this licenses is narrower than it looks, and the caveats are the point.** This is a narrative
review that spends most of its abstract on PERCLOS's failures: *"some cases have been reported wherein
PERCLOS was not affected by drowsiness manipulations, such as in moderate drowsiness conditions, in
older adults, and during aviation-related tasks"*, and *"no single index is currently available as an
optimal marker for detecting drowsiness during driving or other real-world situations."* It calls for
*"standardization to minimize differences in the definition of PERCLOS between studies."*

If this project computes a PERCLOS-like measure from webcam eyelid data, this citation supports the
80%-closure definition and simultaneously requires that the exact definition used be stated, since the
review's own first recommendation is that the definition is not standardised. It is a drowsiness
literature, not a visual-fatigue literature, and the transfer must be argued rather than assumed.

### 37. Abe, Mollicone, Basner & Dinges (2014)
**Status: CONFIRMED.** PMID 24955033 · DOI [10.1111/sbr.12067](https://doi.org/10.1111/sbr.12067)

> Abe, T., Mollicone, D., Basner, M., & Dinges, D. F. (2014). Sleepiness and safety: Where biology
> needs technology. *Sleep and Biological Rhythms, 12*(2), 74–84.

All fields match, all four authors included. Same first author as item 36, different paper, different
journal, different DOI.

Abstract confirms the PERCLOS characterisation used here, verbatim: *"online tracking the percent of
slow eyelid closures (PERCLOS), which has been shown to reflect momentary fluctuations of vigilance."*

**What this licenses.** That PERCLOS indexes momentary vigilance fluctuation, and — read together with
item 5 (Pattyn et al.) and item 39 (Warm et al.) — that a long single sitting is a vigilance problem
as well as an ocular one. **Same caution as item 36:** this is fatigue-risk management in
safety-critical occupations under sleep loss. It is not evidence about eyelid behaviour during
normally rested screen reading, and citing it as such would overreach.

### 38. Jackson et al. (2016)
**Status: CONFIRMED.** PMID 26065627 · DOI [10.1080/15389588.2015.1055327](https://doi.org/10.1080/15389588.2015.1055327)

> Jackson, M. L., Raj, S., Croft, R. J., Hayley, A. C., Downey, L. A., Kennedy, G. A., & Howard, M. E.
> (2016). Slow eyelid closure as a measure of driver drowsiness and its relationship to performance.
> *Traffic Injury Prevention, 17*(3), 251–257.

All fields match, all seven authors included. PubMed's date of 2015-06-11 is the electronic date;
volume 17 issue 3 is the 2016 issue.

Abstract confirms: **twelve** professional drivers, mean age 45.58 ± 10.93, tested after normal sleep
and after **24 hours of total sleep deprivation**. PERCLOS was *"moderately associated"* with
variability in vigilance performance (r = 0.68) and lane position (r = 0.61). Conclusion: *"Automated
ocular measurement appears to be an effective means of detecting impairment due to sleep loss in the
laboratory."*

**Recorded with its limits stated plainly, because they are severe for this use.** n = 12; mean age 45,
not a student sample; and the manipulation is 24 hours of total sleep deprivation, which is nothing
like the state of a rested participant reading for a few minutes. It licenses the claim that automated
eyelid measurement can detect a state change in the laboratory. It does **not** license any threshold,
cut-off or effect size for this study's population or exposure.

### 39. Warm, Parasuraman & Matthews (2008)
**Status: CONFIRMED.** PMID 18689050 · DOI [10.1518/001872008X312152](https://doi.org/10.1518/001872008X312152)

> Warm, J. S., Parasuraman, R., & Matthews, G. (2008). Vigilance requires hard mental work and is
> stressful. *Human Factors, 50*(3), 433–441.

All fields match.

Abstract confirms the two claims it is used for, verbatim: *"Vigilance tasks have typically been
viewed as undemanding assignments requiring little mental effort"* — the view this paper overturns —
and *"physiological and subjective reports confirm that vigilance tasks reduce task engagement and
increase distress and that these changes rise with increased task difficulty."*

**What this licenses.** That sustained monitoring imposes real resource demand and induces stress, so
a long protocol carries a workload cost that is not a nuisance variable but a documented effect. It is
the theoretical companion to item 5 (Pattyn et al.), which supplies the measured 30- and 60-minute
thresholds. This is a review, and its evidence base is classical vigilance tasks — not reading — so it
frames the argument rather than measuring it.

---

## NOT INDEXED IN PUBMED — verified against a secondary authority, or unverified

PubMed indexes biomedical and life-sciences literature only. The five references below fall outside
that scope by subject or by publication type, so the PubMed MCP server cannot confirm them and the
status `NOT INDEXED IN PUBMED` is a statement about the tool, not about the source. Where a secondary
authority was reachable it is named; where the primary document itself was blocked by this
environment's egress proxy, that is said plainly and the item remains unverified at source.

### 40. Delgado, Vargas, Ackerman & Salmerón (2018)
**Status: NOT INDEXED IN PUBMED. Metadata corroborated by secondary sources; not verified at
publisher.** DOI [10.1016/j.edurev.2018.09.003](https://doi.org/10.1016/j.edurev.2018.09.003)

> Delgado, P., Vargas, C., Ackerman, R., & Salmerón, L. (2018). Don't throw away your printed books: A
> meta-analysis on the effects of reading media on reading comprehension. *Educational Research
> Review, 25*, 23–38.

*Educational Research Review* is an education journal and is not in PubMed; a PubMed citation lookup
on author, journal, year, volume and first page returned NOT_FOUND, as expected. **Authority used:**
web search returning the University of Haifa institutional repository record, the Universitat de
València repository record, the Scholars Portal Journals entry (which places the article at volume 25,
first page 23) and the ScienceDirect landing page for PII S1747938X18300101. These agree on all four
authors, the title, the journal, volume 25, pages 23–38, the year 2018 and the DOI as the synopsis
prints them.

**What remains unverified.** The publisher page itself (`sciencedirect.com`), Scholars Portal and
`doi.org` are all blocked by this environment's egress proxy, so no field was read from the record of
authority. Some secondary sources render the citation as *25*(1); the synopsis prints no issue number,
which is the safer form. Secondary sources also report the meta-analysis as covering studies from
2000–2017 with 171,055 participants and a paper-over-screen advantage moderated by time pressure and
text genre — **that substance is second-hand and is not confirmed here.** Do not quote a number from
it until the article is read.

This item was previously listed under UNRESOLVED as one of the reading-comprehension sources. It is
upgraded to metadata-corroborated, not to confirmed.

### 41. Xie, Song, Liu, Wang & Yu (2021)
**Status: NOT INDEXED IN PUBMED. Metadata corroborated by secondary sources; not verified at
publisher.** DOI [10.1109/ACCESS.2021.3061770](https://doi.org/10.1109/ACCESS.2021.3061770)

> Xie, X., Song, F., Liu, Y., Wang, S., & Yu, D. (2021). Study on the effects of display color mode
> and luminance contrast on visual fatigue. *IEEE Access, 9*, 35915–35923.

*IEEE Access* is an engineering journal outside PubMed's scope; the citation lookup returned
NOT_FOUND. **Authority used:** web search returning the IEEE Xplore record (document 9363189), a
Google Scholar record carrying the identical DOI, volume, page range and author initials, and a
ResearchGate entry. All five author initials, the title, volume 9, pages 35915–35923, the year and the
DOI match the synopsis.

**What remains unverified.** `ieeexplore.ieee.org` is blocked by this environment's egress proxy, so
the record of authority could not be opened. Secondary sources describe a 2 × 6 design crossing two
colour modes with six luminance contrast ratios under low screen luminance and low ambient
illumination at night, reporting that dark mode raised blink rate and pupil accommodation while light
mode scored better on subjective fatigue and preference. **That description is second-hand.** If the
paper is used for its subjective/objective dissociation — which would be a substantive point, since it
runs the same way as item 17 — the full text must be read first. Its ambient condition is night-time
and low, not 300 lux, and that limit applies as it does to item 23.

### 42. Hart & Staveland (1988)
**Status: NOT INDEXED IN PUBMED (book chapter). Metadata corroborated by secondary sources.**

> Hart, S. G., & Staveland, L. E. (1988). Development of NASA-TLX (Task Load Index): Results of
> empirical and theoretical research. In P. A. Hancock & N. Meshkati (Eds.), *Human mental workload*
> (pp. 139–183). North-Holland.

PubMed does not index book chapters, so this cannot be checked there at all and no DOI exists for it.
**Authority used:** web search returning the Internet Archive copy of the NASA technical document
(nasa_techdoc_20000004342), a Semantic Scholar record and a BibSonomy BibTeX record. These agree on
both authors, the chapter title, the editors P. A. Hancock and N. Meshkati, the book title *Human
Mental Workload*, the publisher North-Holland, the page range 139–183 and the year 1988.

**One optional field the synopsis omits.** Secondary sources place the book as volume 52 of the
*Advances in Psychology* series. APA does not require the series volume, so the reference as printed
is not wrong; it is simply less complete than it could be. No field disagrees.

**What this licenses.** The NASA-TLX as a validated six-dimension subjective workload instrument
(mental, physical and temporal demand, effort, performance, frustration). If this project administers
the TLX, the chapter is the correct primary citation for the instrument. What it cannot license is any
claim about the TLX's behaviour in short repeated administrations across ten conditions — nothing in
this project has verified that use, and the raw-versus-weighted TLX distinction should be stated
explicitly in the methods.

### 43. Soukupová & Čech (2016)
**Status: NOT INDEXED IN PUBMED (conference paper). Existence and venue corroborated by secondary
sources; not verified at source.**

> Soukupová, T., & Čech, J. (2016). *Real-time eye blink detection using facial landmarks* [Paper
> presentation]. 21st Computer Vision Winter Workshop, Rimske Toplice, Slovenia.

A computer-vision workshop paper, outside PubMed's scope; the citation lookup returned NOT_FOUND and
flagged the venue as an invalid journal, as expected. **Authority used:** web search returning the
proceedings PDF hosted by the Center for Machine Perception at CTU Prague
(`cmp.felk.cvut.cz/ftp/articles/cech/Soukupova-CVWW-2016.pdf`, filename itself encoding author, venue
and year) and a Semantic Scholar record for the same paper. Both authors, the title, the venue and the
year match the synopsis.

**What remains unverified.** Both `cmp.felk.cvut.cz` and `semanticscholar.org` are blocked by this
environment's egress proxy, so the PDF could not be opened and **the location "Rimske Toplice,
Slovenia" and the ordinal "21st" were not read from the proceedings themselves.** Conference papers
have no DOI here and no volume or page numbers, so there is less metadata to check than for a journal
article and correspondingly less that a match can prove.

**What this licenses, and the caution that matters most.** This is the source of the eye aspect ratio
(EAR), the scalar computed from six eyelid landmarks that underpins webcam blink detection in this
project. It licenses the EAR definition and the claim that blink detection from a standard camera is
feasible in real time. It does **not** license the use of EAR to classify a blink as *incomplete* —
this study's primary outcome. Soukupová & Čech detect blink *events* with an SVM over a temporal
window of EAR values; partial-closure classification is a different problem, and any threshold used to
separate complete from incomplete blinks in this build is **this project's own and must be validated
here**, not attributed to this paper. That distinction is the single most important thing in this
entry.

### 44. World Wide Web Consortium (2023)
**Status: NOT INDEXED IN PUBMED (technical standard). Date corroborated by secondary sources; version
question flagged below.**

> World Wide Web Consortium. (2023, October 5). *Web content accessibility guidelines (WCAG) 2.2*.
> https://www.w3.org/TR/WCAG22/

A W3C technical standard, not indexed anywhere in PubMed. **Authority used:** web search returning the
W3C WAI news item "WCAG 2.2 is a Web Standard 'W3C Recommendation'" dated 2023-10-05, the European
Commission's AccessibleEU announcement, and a University of Iowa accessibility notice — all agreeing
that WCAG 2.2 reached W3C Recommendation status on **5 October 2023**, which is the date the synopsis
prints. `www.w3.org` is itself blocked by this environment's egress proxy, so the document was not
opened.

**A version question that needs the author's decision, not a silent fix.** Those same secondary
sources report that WCAG 2.2 was **updated on 12 December 2024**, and that ISO/IEC approved it as
ISO/IEC 40500:2025 on 21 October 2025. The URL in the reference, `https://www.w3.org/TR/WCAG22/`, is
the *living* location and therefore now serves the December 2024 revision, not the October 2023 one.
The reference as printed is not wrong — 5 October 2023 is a real, dated version — but the date and the
URL point at two different documents. If any contrast ratio or success criterion in this build was
read from the page as it stands today, the citation should carry the 2024 update date or a dated
`/TR/2023/REC-WCAG22-20231005/` URL. **This is flagged, not corrected.**

**What this licenses.** The WCAG contrast-ratio formula and thresholds used by `wcag_contrast_ratio`
in this build. Note that WCAG's thresholds are accessibility minima for readability, not visual-fatigue
criteria; the standard makes no claim about fatigue, and the covariate should be described as a
contrast metric taken from an accessibility standard rather than as a fatigue-relevant threshold.

---

## UNRESOLVED — do not cite until checked

- Talens-Estarelles et al. (2022a) and (2022c) — not yet individually resolved. (2022b is confirmed
  above, but its session structure is not.)
- Miller (2023/2024), *Behavior Research Methods* — supplied as vol. 56 (2024 volume) dated 2023;
  the pairing needs resolving. Not indexed in PubMed.
- Huang & Shih (2021), MacDonald et al. (2020), Villa & Labayrade (2014), Kim et al. (2025) — the
  incomplete-block-design sources.
- Fairchild & Reniff (1995), Belgers et al. (2025), Bierings et al. (2018), Han et al. (2018),
  Yoon et al. (2023) — the adaptation-interval sources. **The 60 s adaptation figure rests on
  these**, so they must be resolved before that change is defended in writing.
- Hoerger (2010), Galešić & Bošnjak (2009), Revilla & Ochoa (2017), Andreadis & Kartsounidou (2020),
  Eisele et al. (2022), Jeong et al. (2023), Bowling et al. (2022) — the session-length and dropout
  sources. All are survey-methodology papers; **none is a lab-based vision study**, and that
  limitation must be stated wherever they are used.
- Salmerón et al. (2024), Clinton (2019), Oborne & Holton (1988) — reading comprehension.
  (Delgado et al. 2018 is now item 40 below: not indexed in PubMed, metadata corroborated by
  secondary sources, substance still unread.)
- Craig & Klein (2019), Lin, C. J. et al. (2008), Muhamad et al. (2023), Huang et al. (2025),
  Molloy et al. (2012), Jost et al. (2022), Walsh et al. (2022).
  (Buchner & Baumgartner 2007, Luzsa & Mayr 2025 and Sethi & Ziat 2023 are now CONFIRMED above.)

## EXCLUDED

- Choudhary et al. (2026), "Effects of positive and negative display polarity on subjective visual
  fatigue near point of convergence, among smartphone users," *International Journal of Aquatic
  Research and Environmental Studies*. **Excluded, not cited.** A smartphone display-polarity study
  published in an aquatic-research journal is a topical mismatch severe enough to warrant exclusion
  on its own; it is recorded here so that the decision to exclude it is documented rather than
  silent.

---

## Method note

Verification is by DOI wherever possible, never by author-and-year matching. Item 4 above
demonstrates why: an author + journal + year lookup returned two PMIDs, one of which was an
unrelated paper by an overlapping author group. Author-year matching cannot distinguish these; a
DOI can.

**Metadata verification and substance verification are different things, and this file tracks them
separately.** A confirmed DOI proves the paper exists and that the citation points at it. It proves
nothing about whether the paper says what it is being cited for. Where a claim is load-bearing, the
abstract has been quoted verbatim above; where the claim lives in a Methods section that cannot be
reached from here, the item is marked `SUBSTANTIVE CLAIM NOT CONFIRMED` no matter how clean its
metadata is. Item 7 is the current example.

**Environment limitation.** This session's egress proxy blocks `doi.org`, `api.crossref.org` and
publisher domains. Verification is therefore limited to what PubMed indexes and to abstracts. Items
not indexed in PubMed — the psychology, survey-methodology, lighting and experimental-design sources
— cannot be verified here at all and remain listed as unresolved. They must be checked from an
unrestricted network before any of them is cited.

**Web search as a secondary authority.** For items 40–44, which PubMed does not index, web search was
used as a secondary check and the sources consulted are named inside each entry. This is weaker
evidence than a PubMed record and is labelled as such: search results are aggregator and repository
metadata, which can propagate an error uniformly across every site that copied it. In every one of
those five cases the record of authority itself — ScienceDirect, IEEE Xplore, the CTU proceedings PDF,
`w3.org` — was blocked by the egress proxy and could not be opened. Corroboration is not confirmation.

---

## Coverage of the synopsis reference list

`synopsis/SYNOPSIS_AdtU.md` prints **38 references**. As of this pass, **all 38 carry a status in this
file**, none is unaccounted for, and no reference in the synopsis was found whose metadata disagrees
with the record it resolves to.

| | Count |
|---|---|
| Synopsis references with a status here | **38 of 38** |
| CONFIRMED against PubMed, field by field | **33** |
| NOT INDEXED IN PUBMED (items 40–44) | **5** |
| CONFIRMED, FIELD DIFFERS | **0** |
| FAILED | **0** |

The five outside PubMed are Delgado et al. (2018) in *Educational Research Review*, Xie et al. (2021)
in *IEEE Access*, the Hart & Staveland (1988) book chapter, the Soukupová & Čech (2016) workshop paper
and the W3C WCAG 2.2 standard.

**What "38 of 38" does and does not mean.** It means every printed reference resolves to a real record
and that the fields as printed match that record. It does **not** mean every citation is safe to use
for the claim it is attached to. Three of the new entries record a substantive gap that metadata
cannot close:

- **Item 17 (Sengsoon & Intaruk 2025)** — the exposure duration is not in the abstract, so this paper
  cannot yet serve as a duration precedent.
- **Item 43 (Soukupová & Čech 2016)** — licenses the eye aspect ratio and blink *event* detection, but
  **not** the classification of a blink as incomplete. That threshold is this project's own.
- **Item 44 (W3C 2023)** — the printed date (5 October 2023) and the printed URL (the living
  `/TR/WCAG22/`, now serving the 12 December 2024 revision) point at two different documents. Flagged
  for the author's decision, not silently corrected.

Two further entries record a **conflict inside the literature** that the write-up must face rather
than resolve by selective citation: item 20 (Dobres et al. 2017) finds the polarity penalty only under
dark ambient illumination, which is a polarity × ambient interaction, while item 8 (Buchner &
Baumgartner 2007) reports a null on ambient and is the basis for the single-level design. And item 18
(Jiménez et al. 2020) — 2 minutes per condition across fourteen conditions — is a published precedent
shorter and wider than this protocol, which materially weakens the "below the shortest published
precedent" framing in item 6, though only for accommodative and pupillary outcomes and not for blink
completeness.

The `UNRESOLVED` list above is **not** part of this count. Those items are drawn from the wider
project bibliography and do not appear in the synopsis's 38; they remain unresolved and must be
checked before any of them enters the thesis.
