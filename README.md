# VisuLab — Visual Ergonomics Experiment (reconstructed source)

A tablet PWA for a within-subjects visual-ergonomics study. Per display condition it runs
reading-comprehension, visual-search and colour go/no-go reaction-time tasks while a webcam
(MediaPipe FaceMesh + Eye-Aspect-Ratio) estimates blink/gaze/head-pose metrics, with validated
fatigue questionnaires. Data is stored in IndexedDB and exported as CSV + JSON for analysis in
R/Python.

This is a maintainable **Vite + React + TypeScript** reconstruction of the original single-file
build, with scientific refinements verified against the literature. The original compiled bundle and
the developer's architecture log are preserved under `reference/` as the parity oracle.

## Quick start

```bash
npm install
npm run dev        # dev server (vendors MediaPipe assets first)
npm run build      # typecheck + production PWA build
npm test           # unit/property tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright, fake camera)
npm run sim        # Monte-Carlo simulation + power analysis
npm run fuzz       # fuzz/stress harness (degenerate-input soak)
```

The app opens on a **landing page → session manager**. Start a **New Session** to run the protocol,
**Resume** an interrupted one, or **Open** a completed session in the analysis dashboard. A 30-day
recycle bin holds soft-deleted sessions.

## How it works

- **Protocol & workflow**: see [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — the authoritative stage
  sequence, scientific rationale, the workflow-logic cross-check, researcher run instructions, and
  limitations to disclose.
- **Constants & provenance**: see [`spec/CONSTANTS.md`](spec/CONSTANTS.md) — values extracted from
  the original bundle, the data schema (IndexedDB v7), and every refinement made.
- **Analysis**: exported data is analysed with the mixed-model templates in
  `src/analysis/analysis_template.{R,py}` (random intercept per participant; contrast as covariate;
  d′ aggregated across conditions).

## Key scientific decisions (literature-grounded)

- Locked condition hex values are never changed; **contrast is recorded as a covariate** (C4
  yellow-on-white is only 2.39:1, below WCAG AA).
- **Passages are decoupled from conditions** (rotating Latin-square assignment) to remove the
  content confound.
- Colour-vision screening, display photometry, validated **CVS-Q**, **real per-participant gaze
  calibration**, FPS-gated blink tiers, neutral-background RT stimuli, longer adaptation on polarity
  switches, and build-provenance stamping are added for scientific accuracy and reproducibility.
- Webcam metrics are reported honestly (uncalibrated-gaze flag; sub-Nyquist blink tiers gated;
  non-monotonic blink-rate caveat).

## Verification

- **169 unit/property tests** (scoring, counterbalancing balance, contrast, storage, screening,
  gaze calibration, session admin, head-pose calibration, ocular metrics) + a **harsh stress suite**
  (`tests/stress.test.ts`) and a **fuzz harness** (`npm run fuzz` / `npm run stress` — CSV-injection
  round-trip, adversarial sensor/trial inputs, large-cohort invariants; soak clean).
- **Playwright E2E**: a full no-camera run through all 56 stages plus edge cases (input gating,
  double-click→single session, reload→resume, split-session).
- Production build emits an offline-capable PWA (MediaPipe assets precached).
