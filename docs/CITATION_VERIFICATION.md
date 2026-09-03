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

---

## UNRESOLVED — do not cite until checked

- Lin, M. et al. (2025), *Contact Lens and Anterior Eye* — citation matching returned **7 ambiguous
  candidates**. The supplied volume/year pairing (vol. 49 dated 2025) is internally suspect and must
  be resolved before use. A Letter to the Editor and authors' Reply were reported as attached to
  this paper; both need independent confirmation.
- Talens-Estarelles et al. (2022a, 2022b, 2022c) — three separate papers, not yet individually
  resolved. **2022b is load-bearing** for the multi-session argument (reported as running six
  conditions as six separate weekly sessions).
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
