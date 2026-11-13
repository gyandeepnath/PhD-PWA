# VisuLab — Visual Ergonomics Experiment

A tablet PWA that runs the data collection for a PhD in Optometry (Assam down town University):
*Ergonomics of Visual Perception — Effects of Display Polarity, Text Colour and Ambient Illumination
on Visual Fatigue, Ocular Behaviour and Task Performance.*

Each participant reads under **ten display conditions** (2 polarities × 5 text colours) in a
**single sitting** at a constant 300 lux, giving ten condition-runs per participant. Ambient
illumination was a second factor in an earlier version of the protocol — see
`docs/ILLUMINATION_AMENDMENT.md` for why it was withdrawn.
Per condition the app runs reading, comprehension, visual-search and go/no-go reaction-time tasks
while the front camera estimates blink, gaze and head-pose metrics, and collects validated fatigue
questionnaires. Everything is stored in IndexedDB and exported as CSV + JSON for analysis in R or
Python.

**Vite + React + TypeScript.** The original single-file build and the developer's architecture log
are preserved under `reference/` as the parity oracle.

---

## Quick start

```bash
npm ci
npm run dev          # dev server (vendors MediaPipe assets first)
npm run verify       # the whole gate: lint, typecheck, tests, corpus, codebook, export, analysis templates
npm run build        # typecheck + production PWA build
```

Individual gates:

```bash
npm test                 # unit + property tests (Vitest)
npm run test:e2e         # end-to-end (Playwright, no-camera path)
npm run stress           # adversarial / pipeline / state-machine / metamorphic / recovery sweeps
npm run verify:corpus    # reading-passage length, difficulty match, item completeness
npm run verify:codebook  # every exported column documented, and vice versa
npm run verify:export    # referential integrity + reproducibility of the export
npm run verify:analysis  # R and Python templates on simulated cohorts (needs python3 with pandas, numpy and
                         # statsmodels, and Rscript with the template's packages; without Python it prints
                         # SKIPPED (not passed) and exits 0, and without R only the R half is skipped)
npm run sim              # Monte-Carlo simulation + power analysis
npm run simulate:timing  # session-length distribution against the feasibility gate
npm run fuzz             # degenerate-input soak
```

The app opens on a landing page, then the session manager: start a **New Session**, **Resume** an
interrupted one, **Open** a completed session in the dashboard, or **Restore session from backup
file**. A 30-day recycle bin holds soft-deleted sessions.

---

## Running a study

- **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** — building, hosting, the HTTPS requirement for the
  camera, offline verification, device setup, and the pre-deployment checklist.
- **[`docs/OPERATOR_MANUAL.md`](docs/OPERATOR_MANUAL.md)** — the bench manual for whoever runs the
  session: room and lux setup, layered consent, what not to say, troubleshooting, and a printable
  checklist.
- **[`docs/PROTOCOL.md`](docs/PROTOCOL.md)** — the authoritative stage sequence and scientific
  rationale.
- **[`docs/AUDIT_FINDINGS.md`](docs/AUDIT_FINDINGS.md)** — the adversarial audit of the
  instrument: what was found, what was fixed, and what is still open.
- **[`docs/LITERATURE_VALIDATION.md`](docs/LITERATURE_VALIDATION.md)** — what a literature sweep
  found for and against the protocol's scientific claims, and the design decisions it raises.
  **Every citation in it is unverified and must be resolved before use.**
- **[`spec/CONSTANTS.md`](spec/CONSTANTS.md)** — values extracted from the original bundle, the
  IndexedDB schema, and every refinement made.
- Analysis templates: `src/analysis/analysis_template.R` and `.py` (mixed models; random intercept
  per participant; contrast as a covariate).

---

## What an export contains

23 files: **20 CSVs**, an analysis JSON, a complete backup, and a provenance manifest
(`tests/readmeFigures.test.ts` holds these two numbers to what the export writes).

`00_CODEBOOK.csv` documents **every** column in every file — type, unit, role and what it means —
and `npm run verify:codebook` fails the build if a column is added without a description or a
description survives its column.

`export_manifest.json` carries the app version, git hash, condition-definition hash and, for each
file, its size in bytes and an FNV-1a checksum of its UTF-8 bytes as written (`checksum_basis`), which
any FNV-1a tool can recompute. Those checksums are meaningful because every file but the manifest is
byte-reproducible: the same data gives the same bytes, which `tests/reproducibility.test.ts` enforces;
the manifest itself records when it was written. One exception: a sitting recorded before Round 93
stored no UTC offset, so the dates and local times in its `01_session_info.csv` follow the exporting
device's time zone (`session_utc_offset_source` = export_device; docs/ANALYSIS_PLAN.md §7).

Consented photographs and video are **not** in the bundle: the CSV carries the inventory — id,
checkpoint, condition, byte count, checksum and the filename — and *Export → Download media files*
writes the binaries under exactly those names. A session that has not finished can be exported as
well, from the Session Manager, and declares itself with `session_status`, `conditions_completed`
and `session_complete` in `01_session_info.csv`.

`backup_<participant>_<session>.json` is a **complete** copy of the session, reaction-time trials
included, and can be restored on any device. The analysis `session_*.json` is deliberately partial
(it carries `reaction_trials_count`, not the trials) and is **not** a backup — the app refuses it
with an explanation if you try.

---

## Key scientific decisions

- **Condition hex values are locked** and contrast is recorded as a covariate. P4 (yellow on white)
  is 2.39:1, below WCAG AA; conditions below AA are balanced two per polarity so polarity is not
  confounded with accessibility compliance.
- **Passages are rotated against conditions** (period 13, `passageForCondition`), which makes passage
  exactly uniform against SERIAL POSITION but NOT balanced against display condition: each condition
  meets three of the ten passages twice as often as the other seven, and against polarity the gap
  grows with recruitment. Every model in both analysis templates therefore carries passage (a random
  intercept in R, a fixed effect in Python). This line used to say the rotation kept passage
  "orthogonal to display condition", which was wrong. Each passage is read once per sitting; a whole
  repeat of the protocol is marked by `passage_repeat_number` and `protocol_pass`.
- **Passage length is load-bearing.** Each passage is about 585 words (571–601), laid out as three pages, which buys a
  ~180 s reading exposure. At the earlier ~240 words the exposure was 73 s, about 16 blinks, and the
  polarity × colour interaction had 27% power. `npm run verify:corpus` guards this.
- **Three comprehension items per passage** — gist, inference and detail — tagged by kind so
  accuracy can be modelled by item type rather than pooled.
- Colour-vision screening on the study display, display photometry, validated **CVS-Q**, real
  per-participant gaze calibration, FPS-gated blink tiers, an achromatic background-relative RT
  target, longer adaptation on polarity switches, and build-provenance stamping.
- **Consent is enforced, not just recorded.** A participant who declines camera measurement never
  reaches a camera screen, and `auditBundle` reports any ocular row collected without that grant.
  The annotation-video grant is offered only to the pre-specified validation subsample, and
  membership follows from the enrolment number rather than from an operator's judgement at the
  bench.
- **The ocular exposure window is the reading exposure**, opened when the participant starts
  reading rather than when the stage mounts, so blink rates and the within-task halves are computed
  over the window the codebook says they are.
- **Nothing is fabricated.** A function given input carrying no information reports absence — null,
  or a non-finite value its consumer filters — and never a plausible number. `tests/noFabrication.
  test.ts` states this as a contract and checks every summary-producing function against it.
- **The stimulus typeface is a control, not decoration.** Roboto is vendored into the build rather
  than fetched from a CDN, every stimulus surface names a full fallback stack, and pre-flight
  records whether the face actually loaded (`stimulus_font_ok`). Sessions run in aeroplane mode, so
  a CDN font meant the reading passage silently rendered in an unknown platform face.
- **A new build cannot take over a running session.** The service worker installs and waits rather
  than claiming an open page, because claiming it would break the two lazily-loaded chunks: the
  dashboard, which is the only export path, and MediaPipe, which produces the primary outcome.
- **A blink cut by the reading window's edge or by a sampling gap is counted, not classified** (rule
  `blink-r2`, Round 91, before data collection). Its deepest frame may lie outside what the camera
  saw, so it is in the blink rate (`blink_count_cut`) and on neither side of the incomplete-blink
  ratio. Each row names the blink and inter-blink-interval rules it is under (`blink_rule_version`,
  `ibi_rule_version`; docs/ANALYSIS_PLAN.md §5).
- **The reaction onset is a frame's own timestamp, never before the dot's paint has finished**
  (`rt_timing_version` `rt-t3`, Round 93; the investigator has still to confirm it as the study's
  rule), and the face tracker is given no camera frames during the trials. Where the onset moved past
  the next frame, 08 `onset_moved_ms` bounds the true reaction time (docs/ANALYSIS_PLAN.md §5).
- Front-camera metrics are reported honestly: uncalibrated-gaze flag, sub-Nyquist blink tiers gated, and
  the blink count behind each primary-outcome ratio exported alongside it.

---

## Verification

Each command prints its own count; the table names what each one checks. (It used to quote counts —
"364 unit and property tests", "6 Playwright E2E tests across 4 spec files" — that every round
outdated.)

| Gate | Command | What it covers |
|---|---|---|
| Unit and property tests (`tests/`) | `npm test` | scoring, counterbalancing balance, contrast, storage, screening, gaze calibration, ocular metrics, backup/restore, media export, schema migration, consent enforcement, stimulus-typeface control, no-fabrication contract, and the figures the documents quote |
| End-to-end tests in a real browser (`e2e/`, `e2e-prod/`) | `npm run test:e2e`, `npm run test:e2e:prod` | full sittings at the study tablet's viewports, every screen fitting its box, input gating, double taps, resume, split sittings, the built and installed app |
| Stress rounds | `npm run stress` | adversarial input, pipeline joins, state machine, metamorphic properties, crash recovery |
| Export verification | `npm run verify:export` | referential integrity, reproducibility, codebook coverage, filename portability |
| Corpus and codebook gates | `npm run verify:corpus`, `npm run verify:codebook` | passage length and difficulty matching; complete data dictionary |
| Analysis templates | `npm run verify:analysis` | both templates on simulated cohorts with known effects: signs recovered, R and Python agree, the confirmatory and sensitivity sets match the export's verdict, a split cohort changes no formula; SKIPPED (not passed) without Python, and the R half skipped without R |

CI runs all of it on every push: [`.github/workflows/verify.yml`](.github/workflows/verify.yml).

Requires Node ≥ 20.11.
