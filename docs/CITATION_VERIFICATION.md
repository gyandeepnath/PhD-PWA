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
one or more fields need correcting — the correct value is given) · `UNRESOLVED` (not yet checked or
ambiguous) · `FAILED` (DOI dead, or resolves to a different paper).

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

---

## UNRESOLVED — do not cite until checked

- The Letter to the Editor and authors' Reply reported against Lin et al. (2025) — not located.
- Talens-Estarelles et al. (2022a) and (2022c) — not yet individually resolved. (2022b is confirmed
  above, but its session structure is not.)
- Fan et al. (2024), *Sensors* — reported as the closest structural analogue (5 text colours,
  negative polarity, illumination as a day-level factor).
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
- Delgado et al. (2018), Salmerón et al. (2024), Clinton (2019), Oborne & Holton (1988) — reading
  comprehension.
- Craig & Klein (2019), Lin, C. J. et al. (2008), Buchner & Baumgartner (2007), Luzsa & Mayr (2025),
  Sethi & Ziat (2023), Muhamad et al. (2023), Huang et al. (2025), Molloy et al. (2012),
  Jost et al. (2022), Walsh et al. (2022).

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
