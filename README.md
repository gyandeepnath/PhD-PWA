# VisuLab — Visual Ergonomics Experiment

A tablet PWA that runs the data collection for a PhD in Optometry (Assam down town University):
*Ergonomics of Visual Perception — Effects of Display Polarity, Text Colour and Ambient Illumination
on Visual Fatigue, Ocular Behaviour and Task Performance.*

Each participant reads under **ten display conditions** (2 polarities × 5 text colours) in each of
**two sittings** that differ in ambient illumination, giving twenty condition-runs per participant.
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
npm run verify       # the whole gate: lint, typecheck, tests, corpus, codebook, export
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
- **[`spec/CONSTANTS.md`](spec/CONSTANTS.md)** — values extracted from the original bundle, the
  IndexedDB schema, and every refinement made.
- Analysis templates: `src/analysis/analysis_template.R` and `.py` (mixed models; random intercept
  per participant; contrast as a covariate).

---

## What an export contains

21 files: **18 CSVs**, an analysis JSON, a complete backup, and a provenance manifest.

`00_CODEBOOK.csv` documents **every** column in every file — type, unit, role and what it means —
and `npm run verify:codebook` fails the build if a column is added without a description or a
description survives its column.

`export_manifest.json` carries the app version, git hash, condition-definition hash and a per-file
checksum. Those checksums are meaningful because the export is byte-reproducible: the same data
always produces the same bytes, which is enforced by `tests/reproducibility.test.ts`.

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
- **Passages are decoupled from conditions** by a rotating Latin square, so passage difficulty stays
  orthogonal to display condition. It does not prevent a re-read: ten passages cover twenty
  condition-runs, so each is read once per sitting. Because illumination is confounded with session
  order within a participant, the practice effect would otherwise load onto the illumination main
  effect, so `passage_repeat_number` is exported and must be modelled.
- **Passage length is load-bearing.** Each passage is four pages and about 600 words, which buys a
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
- Webcam metrics are reported honestly: uncalibrated-gaze flag, sub-Nyquist blink tiers gated, and
  the blink count behind each primary-outcome ratio exported alongside it.

---

## Verification

| Gate | What it covers |
|---|---|
| 364 unit and property tests | scoring, counterbalancing balance, contrast, storage, screening, gaze calibration, ocular metrics, backup/restore, media export, schema migration, consent enforcement, stimulus-typeface control, no-fabrication contract |
| 6 Playwright E2E tests across 4 spec files | full no-camera run, input gating, double-click → single session, reload → resume, split session |
| 6 stress rounds: 28 scenarios, 2,393 checks, 0 failures | adversarial input, pipeline joins, state machine, metamorphic properties, crash recovery |
| Export verification, 587 checks | referential integrity, reproducibility, codebook coverage, filename portability |
| Corpus and codebook gates | passage length and difficulty matching; complete data dictionary |

CI runs all of it on every push: [`.github/workflows/verify.yml`](.github/workflows/verify.yml).

Requires Node ≥ 20.11.
