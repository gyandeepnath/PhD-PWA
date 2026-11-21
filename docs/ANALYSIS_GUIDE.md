# From the tablet to the thesis

This guide is for the person who collects the data and then has to analyse it and write it up. It
assumes no programming and no statistics. It says what to do after every sitting, what to do after
the last one, how to run the analysis, how to read what comes out, and where each result belongs in
the thesis. It was written in Round 97 with the export as one file per sitting and the analysis kit
(`run_analysis.R`). Where a figure below was measured, it says where; nothing in this guide was
measured on the study tablet.

## The whole path on one page

1. After every sitting: Dashboard → Export → **Download data bundle ↓**. One file arrives in the
   tablet's Downloads folder, named for the participant: `visulab_<code>_<session>.zip`.
2. Read the one-line integrity check on the Export tab. It should say *all checks passed*.
3. The same day, copy that file to the study computer by cable, into one study folder.
4. In the Session Manager, that sitting's row now says *exported, copy not yet checked*. Open the copy
   on the computer; when it opens, export again and answer **Copied off and checked**.
5. Every week: Dashboard → Export → **Download everything ↓**, and copy that file off too. It is a safety
   copy of the whole tablet.
6. Do not delete sittings from the tablet while the study is running.
7. After the last sitting: **Download everything ↓** once more. That file is what the analysis runs on.
8. On the computer: unzip it, install R and RStudio once, open `analysis/run_analysis.R`, press
   **Source**.
9. Open `results/00_START_HERE.html`. Every table and figure is there, with what it is for and where it
   might go in the thesis.
10. Write the thesis in your own words, from those numbers, and keep `results/analysis_log.txt` with it.

## Part 1. While collecting data

### After every sitting

1. **Export.** Dashboard → Export → **Download data bundle ↓**. This writes one file,
   `visulab_<code>_<session>.zip`, into the tablet's Downloads folder (`<code>` is the participant code,
   `<session>` the first eight characters of the sitting's id). Inside, in a folder of the same name, are
   the sitting's 23 files: 20 data tables (one of them the codebook `00_CODEBOOK.csv`, which explains
   every column of the others), an analysis JSON (`session_*.json`), a provenance manifest and
   `backup_*.json`, the complete backup of the sitting. Section 7 of `docs/OPERATOR_MANUAL.md` says which
   of them to look at after a sitting.
2. **Read the integrity line.** The Export tab, and the question that follows the download, show one
   line read from `16_integrity_report.csv` inside the file: *Integrity check of this sitting: all checks
   passed*, or the number of errors and warnings. If it reports any, open the archive in the tablet's
   Files app and read `16_integrity_report.csv` before the participant leaves.
3. **Answer the question honestly.** The app asks **Did the file arrive?** At that moment the file is
   only on the tablet, so the answer is **Not yet**. A sitting whose copy is not confirmed is never
   deleted automatically.
4. **Copy the file off the same day.** Connect the tablet to the computer with its cable, open the
   tablet's *Download* folder from the computer, and copy the `.zip` into your study folder. A layout that
   works:

   ```
   VisuLab data/
     sittings/      one visulab_<code>_<session>.zip per sitting, as they arrive
     everything/    the weekly visulab_everything_....zip files
     media/         photographs and video, if any were consented (see below)
     results/       a copy of each analysis run's results folder (the analysis writes it beside
                    data/ in the unzipped folder; copy it here afterwards)
   ```

   Keep a second copy of this folder on another drive or on your institution's storage. Never rename,
   unzip-in-place or edit the files you keep: the analysis reads them as they are, and the name is what
   tells one sitting from another.
5. **Confirm the copy.** Open the copied file on the computer (double-click: it opens like a folder). If
   it opens, go back to the tablet, export that sitting again, and answer **Copied off and checked**. The
   Session Manager row then says *exported, copy checked*.

The three row statuses in the Session Manager:

| Row says | Meaning | What to do |
|---|---|---|
| *not exported yet* | The sitting exists only on the tablet. | Export it and copy it off today. |
| *exported, copy not yet checked* | It was exported, and nobody has confirmed a copy off the tablet. | Copy it off, open the copy, then export again and answer **Copied off and checked**. |
| *exported, copy checked* | A copy off the tablet has been confirmed. | Nothing. |

**"as separate files instead"**, beside the export button, writes the same 23 files loose. It is for
opening one table on the tablet. Do not use it for the copy you keep: every sitting's loose files have the
same names, a second sitting's are renamed by the browser (`01_session_info (1).csv`), and the analysis
stops when it finds such names (`[SEVERAL SITTINGS IN ONE FOLDER]`, Part 6).

### Every week

Dashboard → Export → **Download everything ↓** writes `visulab_everything_<n>sittings_<checksum>.zip`:
every sitting on the tablet, the pooled analysis dataset over exactly those sittings, and the analysis
scripts with this guide. Copy it into `everything/`. It costs nothing and is a second copy of everything.
It does not mark any sitting as exported or checked: only the per-sitting question does that.

### Watching the study as it grows

Dashboard → **All Participants** reads every sitting on the tablet each time it is opened, so a sitting
counts as soon as it is saved. From the second participant it shows seven outcomes (the incomplete-blink
ratio, blink rate, reaction time, d′, fatigue change, comprehension and reading speed): their average in
every condition, positive against negative polarity, and how that difference has moved as each participant
completed (one chart per outcome, once two participants have a point on it). The other tabs show one
sitting at a time (choose it at the top).
`docs/OPERATOR_MANUAL.md` §7, *Reading the dashboard*, says how to read it.

These numbers are descriptive (the mean across participants with a 95% interval, no test), and you chose
to see them during collection (Round 98). Two things follow, and are worth writing down in your decision
record:

- The decisions of Part 5 that the plan says to fix "before unblinding" are best fixed now, before the
  averages have been watched for long, and dated.
- The trend is not a stopping rule. Early points rest on very few people and move a lot; the sample size is
  the one the protocol sets, and the result is the analysis, run once, after the last sitting. State in the
  thesis that descriptive results were visible to the investigator during collection.

### Do not delete sittings while the study runs

The analysis needs the pooled dataset, which the tablet builds from the sittings it still holds. A sitting
that has been deleted is not in **Download everything** or the pooled dataset, even while it is still in the
recycle bin: restore it from the bin first if it belongs in the analysis. Storage is rarely a reason to
delete: a camera-on sitting occupies about 0.7 MB of the tablet's browser storage (140 simulated sittings
came to about 100 MB in desktop Chromium, Round 97; not measured on the tablet). Video, if consented, is
what fills a tablet. If the tablet really is full, take **Download everything** first, copy it off, check
that it opens on the computer, and only then delete and purge (`docs/OPERATOR_MANUAL.md`, end of §5: *If the
red panel at the foot of the screen says the device has run out of storage*).

### Keeping the data safe

The files hold de-identified measurements, but also age, gender, vision and sleep details, symptom
scores and the times of each sitting; photographs and video show a face. Keep them as the approved
protocol and your institution require. In practice:

- Keep a screen lock on the tablet, and keep the tablet with you or locked away between sittings.
- Once a sitting's file is copied off and checked, delete it from the tablet's Downloads folder (the
  sitting itself stays in the app until the study ends). Do the same with media files.
- Keep the study folder on encrypted or institution-managed storage, not on a personal cloud account or
  a phone gallery, and send files only by the routes your institution allows.
- The participant code must carry no identifying information: no name, initials or roll number (the
  `participant_id` entry of the codebook). The link between codes and people is kept separately, never in
  the study folder.

### If a participant withdraws and asks for their data to be deleted

`docs/OPERATOR_MANUAL.md` §6 (the *Participant withdraws* row) says what to do in the app. The data are
also in every copy made since: that sitting's `.zip` (on the tablet's Downloads folder, in `sittings/`
and in the second copy), and inside every **Download everything** and pooled archive taken while the
sitting was on the tablet. After the purge, take **Download everything** again, check it, and delete the
earlier ones in `everything/` and in the second copy.

### Photographs and video

They are not in the data file. If a participant consented to them, a further button at the foot of the
Export tab, **Download media files ↓** (shown only for a sitting that holds photographs or video), writes
them. They show a face: keep them in `media/`, apart from the data,
under the terms of the consent given, and never put them in a thesis or share them unless that consent
covers it. Each file is listed in `15_media_inventory.csv`, so it can be traced to its consent.

### If the tablet is lost, broken or reset

Every sitting's file holds `backup_*.json`. On any device with the app: Session Manager → **Restore
session from backup file**, choose the `backup_*.json` (unzip the sitting's file on that device first),
and then export that sitting again. The restored sitting carries its measurements; photographs and video
are not in the backup.

## Part 2. After the last sitting: running the analysis

1. On the tablet: Dashboard → Export → **Download everything ↓**. Copy the file to the computer.
2. Unzip it (Windows: right-click → *Extract All*; macOS: double-click). You get one folder with
   `START_HERE.txt`, `data/` (one folder per sitting and `_pooled/`) and `analysis/`.
3. Install, once:
   - R, from <https://cran.r-project.org>, with the default choices;
   - RStudio Desktop, from <https://posit.co/download/rstudio-desktop/>;
   - in RStudio's Console (bottom left), paste this line and press Enter. It needs the internet and takes
     a few minutes:

     ```r
     install.packages(c("tidyverse","lme4","lmerTest","emmeans","performance"))
     ```
     Optionally also `install.packages("glmmTMB")`: without it the analysis skips the beta-binomial
     refit of the primary, which `docs/ANALYSIS_PLAN.md` §2 compares with the observation-level one to
     show when that refit is failing, and T14 lists it as not fitted.
4. In RStudio: File → Open File → `analysis/run_analysis.R`, then press **Source** (top right of the
   script). It finds `data/` beside `analysis/` by itself; if it cannot, it asks for the folder.
5. Wait. It prints where the data and the results are, then nothing more until the analysis template has
   finished. On 130 simulated sittings the template took about five minutes on a desktop computer
   (`docs/AUDIT_FINDINGS.md` Round 97); a laptop may take longer, and the time of each run is written in T17.
6. When it ends it prints where the results are: a folder `results/` beside `data/`. Open
   `results/00_START_HERE.html` in a browser.

`run_analysis.R` runs the analysis template (`analysis_template.R`) unchanged, saves everything it prints
in `results/analysis_log.txt`, and writes its results as tables and figures. It fits nothing of its own
and changes no rule: every estimate, interval and p-value is the template's. The template is the analysis
`docs/ANALYSIS_PLAN.md` pre-specifies.

**The Python cross-check.** `analysis/analysis_template.py` fits the same models in a second toolchain;
`docs/ANALYSIS_PLAN.md` §5b asks for the two to agree in sign and in significance. To run it you need
Python with `pip install pandas numpy statsmodels scipy` (if `python` or `pip` is not found, type `python3`
and `pip3` instead); then, in the unzipped folder,
`VISULAB_DATA_DIR=data python analysis/analysis_template.py` (macOS or Linux) or, in Windows PowerShell,
`$env:VISULAB_DATA_DIR="data"; python analysis\analysis_template.py`. It prints only; compare its polarity
estimates with R's. If you cannot run it, say so in the thesis rather than claim the cross-check.

**Running it from a terminal** (optional): `Rscript analysis/run_analysis.R data results`. The data
argument can also be a folder of the per-sitting `.zip` files with a pooled export beside them, or one
`.zip`.

## Part 3. Reading the results

`results/00_START_HERE.html` opens with what was read (sittings, participants, the confirmatory and
sensitivity sets, the rules in force) and a list of anything not produced in this run, with the reason.
Then every item, each with: what it addresses, the analysis-plan section, a suggested place in the
thesis, the number of participants and rows it rests on, the table or figure, a one-line caption saying
what the numbers are, and its file name. The same list is in `results/thesis_map.csv`.

| Id | What it is | How to read it |
|---|---|---|
| T01 | Participant flow | Counts read, withdrawn, excluded with the exporter's reason codes, and analysed (confirmatory and sensitivity sets; the rows of the primary model). The basis of a flow diagram. |
| T02 | Participant characteristics | The confirmatory set: numeric characteristics as n, mean, SD, median, quartiles, range; categories as counts and percentages. |
| T03 | Data quality | How much the camera measured, frame-rate tiers, runs left out of the ocular models and why, reliability verdicts, engagement flags. |
| T04 | Descriptive statistics by condition | Each outcome in each of the ten conditions: runs, participants, mean, SD, median, quartiles, range. Observed values, not model estimates. |
| T05 | Primary model coefficients | The fixed effects of the primary model on the log-odds scale, with SE, z, p and a Wald 95% interval. `polarity1` is positive minus negative; colour terms are deviations from the mean of the five colours. The model formula, random structure, convergence and dispersion are in the item's description. |
| T06 | Primary hypothesis tests | H1a: the polarity effect as log-odds and odds ratio (95% interval, p), the predicted proportion of incomplete blinks under each polarity, and their difference with its 95% interval. H1b: the likelihood-ratio test of polarity × colour. The Holm column adjusts across H1a and H1b. H1a is given for each model the plan reports until you decide which is confirmatory (the `model` column; Part 5): with the frame-rate covariate, without it, and with frame rate as each person's mean plus the within-person deviation. |
| T07 | Primary model's estimated proportions | The model-estimated proportion of incomplete blinks in each condition, with 95% intervals. |
| T08 | Polarity effect within each colour | Odds ratios inside each colour; the p-values Holm-adjusted across the five, the intervals Bonferroni-adjusted. Read only beside H1b in T06. |
| T09 | Objective 2: nested model comparison | Contrast alone, contrast + colour, and the full model, compared by likelihood ratio and AIC/BIC. |
| T10 | Objective 2: residual hue coefficients | What colour adds beyond luminance contrast. |
| T11 | Objective 2: collinearity | How far contrast and colour can be told apart (VIF). |
| T12 | Achromatic anchor | Black-on-white against white-on-black at the same 21:1 contrast. |
| T13 | Secondary outcomes with multiplicity adjustment | Each secondary outcome's polarity effect in its own units, 95% interval, p, Holm within its family, the interaction p, and its N. |
| T14 | Sensitivity refits of the primary | The polarity estimate refitted on other rows or with one change, beside the confirmatory estimate in the first row; each row gives the rows and participants it used. |
| T15 | Moderation | Polarity × moderator tests (screen time, lighting, device familiarity), with Holm across moderators. Exploratory. |
| T16 | Questionnaires | CVS-Q at baseline and close and the change; NASA-TLX. One value per participant, as the template takes it, with the template's 95% interval. |
| T17 | Provenance | R and package versions, the scripts' checksums, the rules, the builds that collected the data. |
| T18 | Secondary models, all coefficients | Every secondary model in full: each term's estimate, SE, test statistic and p, with the model's formula and N. The contrast (`log_contrast`) and serial-position (`session_position`) terms are here. |
| T19 | Quality checks of plan section 5 | The template's own printed block, unchanged: illumination constancy, the frame-rate gate and its polarity check, participant present, exposure completeness, careless responding, completeness of sittings. A text file. |
| T20 | Index of the analysis log | Every section the template printed, with its line number in `analysis_log.txt`: where to find an analysis that has no table of its own. |
| F01 | Primary outcome by condition | T07 as a figure. |
| F02 | Secondary outcomes by condition | Reaction time, fatigue and comprehension: mean across participants and 95% interval (descriptive). |
| F03 | Reaction-time distribution | Runs' mean reaction times by polarity. |
| F04 | Outcomes over the sitting | The incomplete-blink ratio, reaction time and fatigue by serial position (1 = first condition). |
| F05 | CVS-Q baseline and close | One line per participant. |
| F06 | Sensitivity of the primary estimate | T14 as a figure. |

**Not computed by the kit:** Objective 4's agreement of the automated blink classification with manual
annotation needs the annotated video, which the template does not read. The thesis map lists it as not
computed.

**Reporting format.** A mixed-model effect is conventionally reported with its estimate, its 95%
confidence interval, the test statistic where one is given, the p-value, and the number of participants
and observations it rests on, in the units of the table (log-odds or odds ratio for the binomial models;
milliseconds, words per minute or scale points for the others). State the rule versions in force (T17)
in the methods. For the primary outcome, `docs/ANALYSIS_PLAN.md` §2 decides H1 on the unadjusted 95%
interval of the polarity effect. Report descriptive and model-estimated numbers as what they are: T04
and F02–F05 are observed; T05–T15, T18 and F01, F06 come from the models.

**The log.** `results/analysis_log.txt` is everything the template printed, followed by what R printed
to its error stream (messages such as *boundary (singular) fit*, and warnings). Its first block,
PROVENANCE, is the record of how the numbers were produced. Keep the whole log with the thesis files.

## Part 4. What goes where in the thesis

The kit gives numbers, labels and formats, and a suggested place for each item; the wording of the
thesis is yours. The suggested places follow the synopsis's Objectives 1 to 4 and hypotheses H₁ₐ, H₁ᵦ,
H₁ᵪ, H₁ᵨ (`synopsis/SYNOPSIS_AdtU.md` §1.7–1.8), in a results chapter the kit calls Chapter 4 with sections
4.1 to 4.7. That numbering is the kit's suggestion, not the synopsis's: the synopsis's own Chapter 4 is its
Conclusion.

**Materials and Methods needs**, with where each fact is written down:

| What | Where it is |
|---|---|
| Design, conditions, counterbalancing, procedure, timings | `docs/PROTOCOL.md`; `docs/TIMING_MODEL.md` |
| Participants: inclusion, screening, the confirmatory set's definition | `docs/PROTOCOL.md`; `docs/ANALYSIS_PLAN.md` §1; T01 |
| How each measure is computed (blinks, frame-rate gate, reaction time, questionnaires) | `docs/ANALYSIS_PLAN.md` §2, §4, §5; the codebook `00_CODEBOOK.csv` in every export |
| The statistical models, exclusions, multiplicity, sensitivity analyses | `docs/ANALYSIS_PLAN.md` §2, §4b, §5; T05's description (the fitted formula) |
| Software and versions, rule versions, builds | T17; the PROVENANCE block of `results/analysis_log.txt` |
| Deviations from the protocol | your session sheets; `lux_deviation_note` and other notes in the export; Part 5 below |

**Results, in the order of the objectives** (the `suggested_thesis_place` column of `thesis_map.csv`):

1. Participants and data quality: T01, T02, T03, T19.
2. Objective 1, primary outcome (H₁ₐ, H₁ᵦ): T04 (its primary rows), T06, T07, F01, T08, T12; T05 in full
   in an appendix.
3. Objective 1, secondary outcomes: T13, T04, T16, F02–F05; single terms from T18.
4. Objective 2, contrast and colour (H₁ᵪ): T09, T10, T11; the contrast terms of the secondary models in T18.
5. Objective 3, moderation (H₁ᵨ): T15.
6. Objective 4, feasibility of the camera measures: T03, T19 (T16 gives the subjective scores the objective
   indices are compared with); agreement with manual annotation is not computed by the kit (Part 3).
7. Sensitivity analyses: T14, F06.

**Appendices:** the full coefficient tables (T05, T10, T18), the codebook, T17 and the analysis log's
PROVENANCE block, the integrity and exclusion counts (T01, T03), the list of protocol deviations, and
the decisions of Part 5 with the date each was made.

## Part 5. Decisions that are yours, to make and write down before the confirmatory analysis is run

The software has a default for each; the default is not a decision. Record each choice, with its date, in
the place named, before running the confirmatory analysis. The **All Participants** tab shows descriptive
averages of the confirmatory set from the second participant (Round 98, by your choice), so these data are
seen, descriptively, while they are collected: with each decision, note whether those averages had been
seen when you made it. Each is described in the place named in the
second column: mostly `docs/AUDIT_FINDINGS.md` (the sections "For the investigator" and "Not done" of
Rounds 88 to 96) and `docs/ANALYSIS_PLAN.md`.

| Decision | Where it is described | What the software does now |
|---|---|---|
| Interim descriptive results on the tablet during collection | AUDIT_FINDINGS Round 98 | shown on **All Participants** from the second participant, by the investigator's choice (Round 98). `docs/ANALYSIS_PLAN.md` asks for several decisions "before unblinding"; with the tab visible that cannot be met as written. Record in your decision record, dated, that descriptive results were visible from the second participant and when each decision was fixed; whether to amend the plan's wording is yours to decide |
| Confirm the reaction-time onset rule `rt-t3` | AUDIT_FINDINGS Round 94, For the investigator; ANALYSIS_PLAN §5 | uses `rt-t3` and records how far each onset moved |
| Keep the frame-rate covariate `eff_fps_c` in the primary or not, or enter frame rate as each person's mean plus the within-person deviation | ANALYSIS_PLAN §2 and §5 item 2 | fits all three; H1 for each is printed and tabled (T06) |
| Whether H1a is tested two-sided at α = .05, and what an interval wholly on the other side of zero (positive polarity raising incomplete blinking) means for H1 | ANALYSIS_PLAN §2, *Falsification* (the synopsis's H₁ₐ names a direction; §2's rule does not) | prints whether the interval excludes zero and on which side; judges nothing |
| RT mean, fatigue and comprehension: keep their log contrast + polarity models (polarity at a fixed contrast, no interaction test) or fit polarity × colour as for the other members | ANALYSIS_PLAN §4, below the table | log contrast + polarity, as the template has always fitted them |
| The completion rule `COMPLETION_INFORMATIVE`: no visual-search completion model when the overall completion rate is outside 5–95% | ANALYSIS_PLAN §4c | applies it; the member is listed as near-constant |
| Whether H1a and H1b share a family-wise error rate | ANALYSIS_PLAN §4b | decides H1 on the unadjusted interval, prints Holm beside it |
| Comprehension threshold for the engagement penalty | ANALYSIS_PLAN §5 item 5; PROTOCOL | as in the plan; marked open |
| The formal colour-vision plate rule | AUDIT_FINDINGS Round 90 §9 item 4 and Round 95, Not done | a deficient result at any sitting stands; not done never replaces a result |
| The sitting term in the models | ANALYSIS_PLAN §2; PROTOCOL | not in the models; a sensitivity refit adds it |
| Participants recorded by more than one build | DEPLOYMENT §5; OPERATOR_MANUAL §8; AUDIT_FINDINGS Round 88 §8 item 4 | warns on the New Session form (the sitting can still be run); the export's join check leaves such a participant out of the models (`mixed_build_within_participant`); the template counts builds |
| Sensitivity choices for rows under earlier rules (`tg-v1`, `rt-t1`, `rw-v1`, `sf-v1`, `at-v1`, `blink-r1`) | ANALYSIS_PLAN §5 | kept or refitted as the plan states; marked open |
| Whether blink rate follows the inter-blink interval for earlier-rule rows | ANALYSIS_PLAN §5 | blink rate keeps the current-rule rows only |
| Frame-rate floor of 20 against 22 face-solved frames a second | `docs/FPS_GATE_SIMULATION.md` | 20 (pre-registered gate `fps-g2`) |
| Which display follows a break (P8) | AUDIT_FINDINGS Round 92 | as the protocol table; marked open |
| Consent duration (the model puts some sittings over the duration the consent states) | AUDIT_FINDINGS Round 92 §9 item 4 | the consent screen's current text |
| Consent wording for the camera grant | AUDIT_FINDINGS Round 90 §9 item 1 | the app's current text; check it against the approved consent |
| Version number 2.4.0 or 2.5.0 for the build used | OPERATOR_MANUAL §2 | 2.4.0 |
| Re-exporting sittings exported before Round 89–94 changes | AUDIT_FINDINGS Rounds 89–94 | old exports keep their old text and columns |
| A reason value for a camera lost on the camera set-up screen | AUDIT_FINDINGS Rounds 96 and 101 | decided (Round 101): `lost_at_setup` in 01 `camera_off_reason`, and the set-up screen offers Retry or going on without the camera |
| The analyst defaults in the template (QC thresholds, `SMALL_N_WARN`, `DROP_DISENGAGED`) | the lines marked `ANALYST DEFAULT` in `analysis_template.R` | as written there |

## Part 6. When the analysis stops, or warns

The analysis stops on purpose when the data cannot give a sound result, and says why in one line that,
for the stops below, begins with a code in square brackets. `00_START_HERE.html` then shows the message at
the top, and the whole output is in `analysis_log.txt`.

A few messages carry no code. `run_analysis.R`'s own (*These R packages are not installed*, *The data
folder does not exist*, *The results folder … must not be inside the data folder*) stop it before anything
is written: follow the sentence, and for the first repeat the install line of Part 2. The template's
*no … found under DATA_DIR* means a file every export has is missing: point the analysis at the folder that
holds the exports.

**Messages that stop the analysis**

| Message | What it means | What to do |
|---|---|---|
| `[NO VERDICT]` | The pooled export (`analysis_join_report.csv`) is not under the data folder. | Use the "Download everything" file, or put the pooled export (`visulab_pooled_….zip`) beside the sittings. |
| `[TWO VERDICTS]` | Two different pooled exports are there. | Keep only the one taken after the last sitting (its name says how many sittings it covers). |
| `[DUPLICATED EXPORT]` | One sitting is there twice with different data. | Keep only the most recent export of that sitting. Identical copies are read once and do not stop it. |
| `[SEVERAL SITTINGS IN ONE FOLDER]` | Loose files of several sittings were saved into one folder (names like `01_session_info (1).csv`). | Export each sitting again with the current build (one `.zip` each), or use "Download everything". |
| `[DAMAGED ARCHIVE]` | A `.zip` cannot be opened. | Copy it from the tablet again, or export that sitting again. |
| `[MIXED FOLDER]` | One folder holds rows of more than one sitting. | Keep each sitting's files in their own folder (the archives do this). |
| `[TOO FEW PARTICIPANTS]` | Fewer than two participants in the confirmatory set. | A mixed model needs several. No table is written when it stops here: in `analysis_log.txt`, the lines headed *exclusion reasons* above the message say who was left out and why. |
| `[ONE POLARITY]` | Every confirmatory run has the same polarity. | The data cannot test polarity; check the exports and the counterbalancing. |
| `[PRIMARY NOT FITTED]` | The primary model could not be fitted at any step of its reduction ladder. | Read the fit notes above it in the log; the other results are still written. |

**Messages that warn and carry on**

| Message | What it means |
|---|---|
| `[IDENTICAL COPIES]` | A sitting (or the pooled verdict) was there more than once with the same data; one copy was read. |
| `[SMALL N]` | Fewer participants than the template's warning level: every estimate is imprecise. |
| `[MIXED BUILDS]` | The confirmatory set was collected by more than one build; the plan says how to report it. |
| `[PRIMARY NOT ESTIMABLE]` | No camera-on run with a blink: the ocular models cannot be fitted; the behavioural ones are. |
| `[NOT CONVERGED]` | A secondary model's fit did not converge; its row in T13 says so. |
| `[SEPARATION]`, `[OLRE]`, `[PROTOCOL NOTE]`, `[NASA-TLX]` | Notes on a particular model or measure; the line says what was done. |
| `[SE CAUTION]` | Printed only by the Python cross-check: too few participants for that model's standard errors; it says what it withholds. |

## Part 7. Words used here

- **Condition-run**: one participant's run through one display condition (reading, questions, ratings,
  search, reaction task).
- **Confirmatory set**: the rows every model is fitted on: analysable participants, not withdrawn, first
  protocol pass, finished runs (`docs/ANALYSIS_PLAN.md` §1).
- **Sensitivity analysis**: the same model refitted with one thing changed, to see whether a result
  depends on it.
- **Mixed model**: a regression model that includes, besides the effects of interest, a term for each
  participant (and here each passage), so that repeated measurements of one person are not treated as
  independent.
- **Random intercept**: that per-participant (or per-passage) term: each participant's own baseline
  level.
- **Log-odds and odds ratio**: the scale of a binomial model. An odds ratio of 1 means no difference;
  below 1, lower odds in the first group named.
- **Confidence interval (95%)**: the range of values for the effect that are compatible with the data at
  the 5% level; read with the estimate.
- **p-value**: how surprising data at least this extreme would be if there were no effect. It is not the
  probability that the hypothesis is true.
- **Multiplicity adjustment (Holm)**: an adjustment of p-values when several tests are made in one family,
  so that the chance of at least one false positive in the family stays at 5%.
- **Codebook**: `00_CODEBOOK.csv`, the description of every column of every data table in a sitting's
  export. The pooled analysis files have their own, `analysis_codebook.csv`.
- **Provenance**: the record of which software, versions, rules and builds produced a result.
