# VisuLab — Visual Ergonomics Experiment (reconstructed source)

A tablet PWA for a within-subjects visual-ergonomics study: per display condition it runs
reading-comprehension, visual-search and Eriksen-flanker reaction-time tasks while a webcam
(MediaPipe FaceMesh + Eye-Aspect-Ratio) estimates blink/gaze/head-pose metrics, plus pre/post
fatigue scales. Data is stored in IndexedDB and exported as CSV + JSON for analysis in R/Python.

This is a maintainable **Vite + React + TypeScript** reconstruction of the original single-file
build, with scientific refinements verified against the literature. The original compiled bundle
and the developer's architecture log are preserved under `reference/` as the parity oracle.

## Status
Phased reconstruction in progress. See `spec/CONSTANTS.md` for the extracted source-of-truth
constants and the planned refinements.

## Scripts
- `npm run dev` — dev server
- `npm run build` — typecheck + production build (PWA)
- `npm test` — unit/property tests (Vitest)
- `npm run test:e2e` — end-to-end tests (Playwright, fake camera)
- `npm run sim` — Monte-Carlo simulation harness

## Key design decisions (literature-grounded)
- Locked condition hex values are never changed; **contrast is recorded as a covariate**
  (C4 yellow-on-white is only 2.39:1, below WCAG AA).
- **Passages are decoupled from conditions** (rotating Latin-square assignment) to remove the
  content confound.
- Colour-vision screening, display photometry, validated CVS-Q, real/honest gaze calibration,
  FPS-gated blink tiers, neutral-background RT stimuli, and longer adaptation on polarity
  switches are added for scientific accuracy.

See `reference/BUILD_KNOWLEDGE.md` for the full origin history and `spec/CONSTANTS.md` for specs.
