# The frame-rate simulation: gate fps-g2 and the fitted minimum

Round 79. Reproduce with `npm run sim:fps` (150 runs per cell, base seed 20261008, about 7 minutes; the
full output is the appendix below, unedited). The code is `scripts/fpsGateSim.ts` and
`src/sim/fpsGate.ts`; `tests/fpsGateSim.test.ts` pins a small run so the code cannot drift without a
test failing. **Everything here is a model, not a measurement.** Nothing was measured on the Xiaomi
Pad 6; the only device figure is the investigator's report of at most 23–25 frames a second.

## In plain words

1. **About 24 frames a second is enough to count blinks and to sort them into complete and
   incomplete.** At 20 frames a second or more the app found at least 98% of blinks, and sorted them
   about as well as at 30 (in the four scenarios the gate is decided on). So the frame-rate gate
   (fps-g2) is set at **20 frames a second while the face is seen** (tier A, "adequate"), 15–20 is "reduced" (kept,
   flagged), under 15 is "too slow" (exploratory only).
2. **What does change with frame rate is the level of the incomplete-blink ratio.** A slower camera
   misses the deepest moment of more blinks, so more of them read as incomplete: about +0.1 to +0.3
   percentage points for every frame a second lost. That matters only if the frame rate DIFFERS
   between one participant's conditions. So each condition is also checked against the same
   person's other conditions: **more than 2 frames a second away is flagged.**
3. **The real danger is a frame rate that follows the page colour.** Under the camera's automatic
   exposure a white page lights the face and a black page does not, so the camera may run faster on
   white. In the model that alone makes the black-page ratio read about 1.5–2.2 points higher (the
   planned effect is 3 points). Fixing the exposure at camera setup (already done, rule exp-r1)
   removes this by design, as long as the fixed exposure holds.
4. **The "fitted minimum" is a check, not the main result.** It estimates each blink's deepest
   point between frames. When the exposure is known it removes nearly all of the frame-rate effect
   on the ratio's level, but it does not sort individual blinks better. It is reported beside the
   main result as a pre-registered sensitivity analysis.

## What was simulated

- **Blinks:** 180-s reading windows with a blink every 2.5–9.5 s (about 27 per window). Each blink
  closes over a down-phase and reopens over an up-phase. The mean phase durations, about 100 and
  220 ms, are the 1-kHz measurements of Nakamura et al. (2008; docs/CITATION_VERIFICATION.md #62,
  English abstract). Everything else is an **assumption**: the spreads (SD 25 and 50 ms), the shape
  within a phase (a smooth raised cosine, and a V-shaped "linear" lid as the least favourable case),
  the mix of depths (70% complete, true lowest openness 0.10–0.60; 30% incomplete, 0.60–0.75).
- **Camera:** frames at a regular rate with 1.5 ms timing jitter; each frame is the lid averaged
  over its exposure (instantaneous, the whole frame interval, or a fixed 30 ms), computed exactly;
  independent landmark noise of 2%, 3% or 4% of the open eye per frame (Round 75 measured 1.6–2.3%
  on one still portrait). A 30-fps camera whose tracker keeps 80% of frames was also run.
- **Classifier:** the shipped `classifyBlinks` (rule blink-r1) against a baseline fitted by the
  shipped `fitEarBaseline` on a 6-s open-eye window, as at calibration. The truth is "incomplete"
  when the true lowest openness is 0.60 or more.
- **Pairing:** within a scenario the same blinks are sampled at every frame rate, so differences
  between rates are paired (common random numbers).

## The decision rules (fixed in R2 §A3, round 78, before this code existed)

- **C1, the floor:** the lowest rate at which detection is at least 0.98 in every decision
  scenario is "adequate"; at least 0.95, "reduced".
- **C2, accuracy:** at that floor, agreement with the true class (Cohen's kappa) is no more than
  0.05 below its value at 30 fps, in every decision scenario.
- **C3, consistency:** the band = floor(0.75 / the worst slope of the ratio between 20 and 30 fps),
  so that a frame-rate difference inside the band moves the ratio by at most 25% of the planned
  3-point effect.
- **The decision scenarios** are the four R2 fixed: the low-light case the gate exists for (each
  frame exposed for the whole frame interval), the smooth lid at 2%, 3% and 4% noise, and the
  V-shaped lid at 3%. The other 14 scenarios (instantaneous and 30-ms exposures; the V-shaped lid at
  2% and 4%) are a robustness check, reported beside.

## Results

| Rule | Decision scenarios (4) | All 18 scenarios (robustness) |
|---|---|---|
| C1 adequate floor (detection ≥ 0.98) | **20 fps** (lowest detection at 20: 0.984) | 22 fps (lowest at 20: 0.971) |
| C1 reduced floor (detection ≥ 0.95) | **15 fps** (lowest simulated) | 15 fps |
| C2 kappa at 20 fps vs 30 fps | at most 0.019 lower — passes | at most 0.048 lower — passes |
| C3 worst slope, 20–30 fps | 0.310 points per fps → **band 2 fps** (0.62 points) | the same (0.310) |

**Gate fps-g2: tier A ≥ 20 fps, tier B 15 to < 20, tier C < 15, consistent within 2 fps of the
participant's median.** These are R2's values; this simulation reproduces them on the shipped code.

**Where the robustness check differs, and why it does not move the gate.** In one of the 14 extra
scenarios — the V-shaped lid, whole-frame exposure, 2% noise — detection at 20 fps is 0.971, below
0.98 (it reaches 0.98 at 22 fps). Table A5 of the appendix shows which blinks are missed: **every**
blink deeper than 0.70 of the open eye is found at 20 fps (1.000); the misses are all among the
shallowest incomplete blinks, within 0.05 of the 0.75 registration cut, and that band is incompletely
found even at 30 fps (0.69–0.99). So this criterion measures how many simulated blinks were placed
right at the definition's edge — an assumption — more than whether 20 fps is adequate; and the
effect those misses have on the ratio is already inside the C3 slope. C2 and C3 hold on all 18
scenarios. **This is a judgement and is recorded as one**: an investigator who prefers the stricter
reading can set `FPS_GATE.ADEQUATE` to 22 in `src/tracking/frameRateGate.ts`; tiers are recomputed
from columns already stored in every row, so the choice can be changed after collection without
re-collecting anything, and both can be reported.

**The fitted minimum (appendix §B).** With the true exposure, the shift of the ratio between 20 and
60 fps falls from 3.6–6.0 points (lowest frame) to −0.4 to +1.2 points (fitted); with the V-shaped
lid a residual of about 1–1.6 points remains (the template is smooth). Per-blink misclassification
is not better: 4.7–5.6% fitted against 3.6–4.5% lowest frame for the smooth lid, similar for the
V-shape. The fitted count is therefore a sensitivity analysis for the frame-rate dependence of the
ratio's **level**, never the primary outcome. Neither count equals the true share: landmark noise
raises the 90th-percentile baseline (by about 1.28 × the noise), so blinks just under 0.60 of the
true open eye are called complete — with the smooth lid the fitted count sits about 5 points below
the true share at every rate, and the lowest-frame count is partly pulled back up by its frame-rate
bias; with the V-shaped lid the smooth template reads blinks shallower and the fitted count sits
about 2 points above. These offsets are the same in every condition of one person, so they are
between-person and absorbed by the participant's random intercept; the comparison the study makes is
within each person.

**Polarity under auto-exposure (appendix §C).** Assumed: white page 30 fps with a 15-ms exposure,
black page 25 fps with 40 ms (the 50-Hz anti-banding step: a mechanism, not a measurement). The
black-page ratio reads +1.55 to +2.23 points higher by the lowest-frame rule; the fitted minimum
with the true exposure removes it (−0.58 to +0.04); with the exposure assumed to be the frame
interval, a residual of 0.0 to +0.9 points stays. Under the fixed exposure both pages are sampled
identically, so the polarity difference is zero by design (the table's "fixed exposure" row is the
fixed level against the auto white page, not a polarity difference).

**Two causes of the same 24 fps (appendix §D).** A tracker that drops 20% of a 30-fps camera's
frames shifts the ratio about as much as a camera running regularly at the same mean rate (+1.7 vs
+1.0 points; a 40-ms exposure at 25 fps, +1.4). Dropped frames are not worse than a slow camera.

**Landmark noise (appendix §E).** Against a calibration at 3% noise, reading-window noise of 2%
or 4% moves the ratio by +0.7 or −0.65 points: about 0.7 points per 1% of noise. Noise that differed
by polarity would be a confound the same size as the frame-rate one, so it should be recorded per
condition and checked between polarities before inference.

## How this sits with the published evidence

- **Zheng et al. (2022)** (ledger #63, full text) recommend 30 frames a second or more for
  incomplete-blink analysis. They compared only 30 with 8 frames a second (a Keratograph 5M, not a
  webcam); at 8 the incomplete-blink proportion was 47.6% against 21.2% at 30 in the same people —
  the same upward bias this simulation shows, much larger at 8. No rate in between was tested, so
  the paper neither supports nor rules out 20.
- **Navascues-Cornago et al. (2026)** (ledger #64, abstract only) downsampled 500-fps infrared
  recordings: blink amplitude and duration showed minimal bias down to 25 fps, the lowest rate they
  tested; velocities did not. This project computes no blink velocity.
- So the 20-fps floor is a model result for the shipped classifier, under the assumptions above. It is
  stated as such, and the validation sub-study (a human coder against 07b) is what can test it.

## Limits

- Phase spreads, lid shape, depth mix, noise level and jitter are assumptions; the noise is
  independent between frames (real landmark noise may be correlated, which would shrink its effect).
- The exposure model is a box average over the exposure; rolling-shutter timing is not modelled.
- Nothing below 15 fps was simulated.
- No published validation of fitting a blink template between frames was found (R2, PubMed search).

## Appendix: the full output of `npm run sim:fps` (150 runs per cell)

Runs per cell 150; base seed 20261008; each run a 180-s reading window (about 27 blinks).

#### A. The gate grid — the shipped lowest-frame rule (blink-r1)

18 scenarios: lid profile {cosine, linear} x exposure {whole frame interval, instant, 30 ms fixed} x per-frame noise {2%, 3%, 4%}.

##### A1. The 4 decision scenarios (R2): ranges over them

| fps | detection (lowest) | kappa vs truth | kappa minus kappa at 30 (lowest) | ratio shift vs 60 fps, points | paired SE, points | misclassified within 0.05 of the cut | misclassified further away |
|---|---|---|---|---|---|---|---|
| 15 | 0.971 | 0.850–0.933 | -0.083 | 5.79 to 8.99 | 0.36–0.45 | 15.09–29.16% | 0.32–1.70% |
| 18 | 0.978 | 0.883–0.952 | -0.043 | 4.52 to 7.12 | 0.32–0.42 | 11.88–24.84% | 0.05–0.68% |
| 20 | 0.984 | 0.882–0.948 | -0.019 | 3.93 to 6.36 | 0.29–0.40 | 12.82–25.75% | 0.03–0.35% |
| 22 | 0.987 | 0.872–0.954 | -0.023 | 3.45 to 5.61 | 0.29–0.39 | 11.48–27.58% | 0.00–0.43% |
| 24 | 0.991 | 0.856–0.956 | -0.013 | 2.91 to 5.07 | 0.28–0.37 | 10.95–31.24% | 0.00–0.43% |
| 25 | 0.991 | 0.841–0.946 | -0.010 | 2.76 to 4.34 | 0.27–0.37 | 13.48–33.20% | 0.00–0.65% |
| 26 | 0.992 | 0.843–0.951 | -0.011 | 2.80 to 4.56 | 0.27–0.37 | 12.15–32.94% | 0.00–0.65% |
| 30 | 0.995 | 0.817–0.946 | — | 2.09 to 3.55 | 0.25–0.35 | 13.48–37.39% | 0.00–0.89% |
| 60 | 0.999 | 0.729–0.909 | -0.088 | — | — | 21.24–50.07% | 0.00–1.97% |

##### A2. All 18 scenarios: ranges over them

| fps | detection (lowest) | kappa vs truth | kappa minus kappa at 30 (lowest) | ratio shift vs 60 fps, points | paired SE, points | misclassified within 0.05 of the cut | misclassified further away |
|---|---|---|---|---|---|---|---|
| 15 | 0.953 | 0.813–0.937 | -0.119 | 3.61 to 10.01 | 0.30–0.48 | 14.87–34.04% | 0.08–2.22% |
| 18 | 0.968 | 0.852–0.952 | -0.067 | 2.86 to 7.81 | 0.28–0.45 | 11.88–30.08% | 0.00–0.89% |
| 20 | 0.971 | 0.846–0.948 | -0.048 | 2.32 to 6.42 | 0.27–0.43 | 12.82–30.98% | 0.00–0.99% |
| 22 | 0.980 | 0.839–0.954 | -0.032 | 2.18 to 5.67 | 0.25–0.41 | 11.48–33.68% | 0.00–0.75% |
| 24 | 0.982 | 0.828–0.956 | -0.023 | 1.86 to 5.13 | 0.26–0.41 | 10.95–34.83% | 0.00–0.97% |
| 25 | 0.983 | 0.839–0.946 | -0.013 | 1.71 to 4.80 | 0.24–0.40 | 13.48–33.93% | 0.00–0.72% |
| 26 | 0.985 | 0.821–0.951 | -0.018 | 1.71 to 4.97 | 0.24–0.40 | 12.15–36.63% | 0.00–0.91% |
| 30 | 0.990 | 0.817–0.946 | — | 1.17 to 3.58 | 0.24–0.39 | 13.27–38.17% | 0.00–0.89% |
| 60 | 0.998 | 0.729–0.954 | -0.095 | — | — | 11.08–50.07% | 0.00–2.05% |

##### A3. Each scenario at 15, 20, 24 and 30 fps: detection / kappa (D = decision scenario)

| scenario | 15 | 20 | 24 | 30 | 60 |
|---|---|---|---|---|---|
| D cosine, exposure whole frame, noise 2% | 0.985 / 0.933 | 0.995 / 0.948 | 0.998 / 0.956 | 0.999 / 0.946 | 1.000 / 0.903 |
| D cosine, exposure whole frame, noise 3% | 0.991 / 0.917 | 0.997 / 0.920 | 0.998 / 0.912 | 1.000 / 0.883 | 1.000 / 0.826 |
| D cosine, exposure whole frame, noise 4% | 0.993 / 0.895 | 0.997 / 0.882 | 0.999 / 0.856 | 1.000 / 0.817 | 1.000 / 0.729 |
| cosine, exposure instant, noise 2% | 0.994 / 0.932 | 0.998 / 0.933 | 0.999 / 0.936 | 0.999 / 0.927 | 1.000 / 0.901 |
| cosine, exposure instant, noise 3% | 0.994 / 0.896 | 0.998 / 0.888 | 0.999 / 0.882 | 1.000 / 0.873 | 1.000 / 0.814 |
| cosine, exposure instant, noise 4% | 0.994 / 0.858 | 0.999 / 0.846 | 0.999 / 0.828 | 1.000 / 0.819 | 1.000 / 0.747 |
| cosine, exposure 30 ms fixed, noise 2% | 0.991 / 0.937 | 0.996 / 0.943 | 0.998 / 0.947 | 0.999 / 0.932 | 1.000 / 0.896 |
| cosine, exposure 30 ms fixed, noise 3% | 0.993 / 0.898 | 0.996 / 0.903 | 0.999 / 0.893 | 1.000 / 0.871 | 1.000 / 0.819 |
| cosine, exposure 30 ms fixed, noise 4% | 0.995 / 0.890 | 0.999 / 0.866 | 0.998 / 0.853 | 1.000 / 0.836 | 1.000 / 0.742 |
| linear, exposure whole frame, noise 2% | 0.953 / 0.813 | 0.971 / 0.885 | 0.982 / 0.909 | 0.990 / 0.932 | 0.998 / 0.954 |
| D linear, exposure whole frame, noise 3% | 0.971 / 0.850 | 0.984 / 0.914 | 0.991 / 0.920 | 0.995 / 0.933 | 0.999 / 0.909 |
| linear, exposure whole frame, noise 4% | 0.978 / 0.854 | 0.990 / 0.887 | 0.995 / 0.898 | 0.997 / 0.901 | 1.000 / 0.839 |
| linear, exposure instant, noise 2% | 0.965 / 0.876 | 0.983 / 0.913 | 0.986 / 0.939 | 0.994 / 0.945 | 0.998 / 0.945 |
| linear, exposure instant, noise 3% | 0.980 / 0.874 | 0.990 / 0.897 | 0.994 / 0.915 | 0.997 / 0.917 | 1.000 / 0.892 |
| linear, exposure instant, noise 4% | 0.983 / 0.867 | 0.992 / 0.895 | 0.996 / 0.897 | 0.997 / 0.876 | 1.000 / 0.823 |
| linear, exposure 30 ms fixed, noise 2% | 0.965 / 0.871 | 0.980 / 0.919 | 0.987 / 0.930 | 0.991 / 0.940 | 0.998 / 0.949 |
| linear, exposure 30 ms fixed, noise 3% | 0.974 / 0.878 | 0.989 / 0.905 | 0.990 / 0.918 | 0.995 / 0.930 | 1.000 / 0.912 |
| linear, exposure 30 ms fixed, noise 4% | 0.986 / 0.855 | 0.993 / 0.887 | 0.994 / 0.900 | 0.998 / 0.898 | 1.000 / 0.843 |

##### A4. Ratio shift per fps between 20 and 30 fps

Least-squares slope of the shift vs 60 fps over 20, 22, 24, 25, 26 and 30 fps; negative = the ratio falls as the rate rises.

| scenario | slope, points per fps |
|---|---|
| D cosine, exposure whole frame, noise 2% | -0.180 |
| D cosine, exposure whole frame, noise 3% | -0.265 |
| D cosine, exposure whole frame, noise 4% | -0.310 |
| cosine, exposure instant, noise 2% | -0.117 |
| cosine, exposure instant, noise 3% | -0.113 |
| cosine, exposure instant, noise 4% | -0.130 |
| cosine, exposure 30 ms fixed, noise 2% | -0.137 |
| cosine, exposure 30 ms fixed, noise 3% | -0.180 |
| cosine, exposure 30 ms fixed, noise 4% | -0.166 |
| linear, exposure whole frame, noise 2% | -0.273 |
| D linear, exposure whole frame, noise 3% | -0.237 |
| linear, exposure whole frame, noise 4% | -0.270 |
| linear, exposure instant, noise 2% | -0.204 |
| linear, exposure instant, noise 3% | -0.178 |
| linear, exposure instant, noise 4% | -0.234 |
| linear, exposure 30 ms fixed, noise 2% | -0.108 |
| linear, exposure 30 ms fixed, noise 3% | -0.186 |
| linear, exposure 30 ms fixed, noise 4% | -0.214 |

##### A5. Which blinks are missed — by true depth, in the scenario with the lowest detection at 20 fps (linear, exposure whole frame, noise 2%)

| fps | all | depth 0.00–0.60 | depth 0.60–0.70 | depth 0.70–0.72 | depth 0.72–0.74 | depth 0.74–0.75 |
|---|---|---|---|---|---|---|
| 15 | 0.953 | 1.000 (n 3214) | 0.984 (n 855) | 0.827 (n 173) | 0.447 (n 179) | 0.324 (n 105) |
| 20 | 0.971 | 1.000 (n 3214) | 1.000 (n 855) | 0.913 (n 173) | 0.682 (n 179) | 0.457 (n 105) |
| 24 | 0.982 | 1.000 (n 3214) | 1.000 (n 855) | 0.948 (n 173) | 0.816 (n 179) | 0.619 (n 105) |
| 30 | 0.990 | 1.000 (n 3214) | 1.000 (n 855) | 0.994 (n 173) | 0.933 (n 179) | 0.686 (n 105) |
| 60 | 0.998 | 1.000 (n 3214) | 1.000 (n 855) | 1.000 (n 173) | 1.000 (n 179) | 0.914 (n 105) |

#### Decision rules

##### On the 4 decision scenarios

- **C1** detection >= 0.98 in every scenario down to **20 fps** (adequate); >= 0.95 down to **15 fps** (reduced; the lowest rate simulated). Lowest detection at 20 fps: 0.984.
- **C2** at 20 fps kappa is at most 0.019 below its 30-fps value in every scenario: **yes** (limit 0.05). At 20 fps: 0.019.
- **C3** worst slope 0.310 points per fps (cosine, exposure whole frame, noise 4%); 25% of the planned 3-point effect is 0.75 points; band = floor(0.75 / 0.310) = **2 fps** (worst-case shift over the band 0.62 points).

GATE fps-g2: adequate >= 20; reduced 15 to < 20; exploratory < 15; consistent within 2 fps of the participant's median.

##### The same rules on all 18 scenarios (robustness)

- **C1** detection >= 0.98 in every scenario down to **22 fps** (adequate); >= 0.95 down to **15 fps** (reduced; the lowest rate simulated). Lowest detection at 20 fps: 0.971.
- **C2** at 22 fps kappa is at most 0.032 below its 30-fps value in every scenario: **yes** (limit 0.05). At 20 fps: 0.048.
- **C3** worst slope 0.310 points per fps (cosine, exposure whole frame, noise 4%); 25% of the planned 3-point effect is 0.75 points; band = floor(0.75 / 0.310) = **2 fps** (worst-case shift over the band 0.62 points).

#### B. The fitted minimum (fit-r1) against the lowest frame (blink-r1)

Noise 3%. The fit assumes the exposure the frames really had (as under the fixed camera exposure). "Bias" is the incomplete share among detected blinks minus the true share. Misclassified: share of detected blinks given the wrong class.

| profile | exposure | fps | true share | bias, lowest frame | bias, fitted | shift vs 60, lowest frame | shift vs 60, fitted | misclassified, lowest frame | misclassified, fitted | kappa, lowest frame | kappa, fitted | blinks not fitted |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cosine | whole frame | 20 | 0.304 | -1.91 | -5.21 | 5.22 ± 0.37 | 0.13 ± 0.31 | 3.64% | 5.33% | 0.912 | 0.867 | 0 |
| cosine | whole frame | 24 | 0.304 | -3.59 | -5.64 | 3.38 ± 0.33 | -0.45 ± 0.26 | 4.21% | 5.63% | 0.897 | 0.859 | 0 |
| cosine | whole frame | 30 | 0.304 | -4.10 | -5.34 | 2.83 ± 0.31 | -0.20 ± 0.26 | 4.49% | 5.34% | 0.890 | 0.867 | 0 |
| cosine | whole frame | 60 | 0.304 | -6.87 | -5.09 | — | — | 6.96% | 5.09% | 0.824 | 0.874 | 0 |
| cosine | 30 ms fixed | 20 | 0.303 | -2.97 | -5.24 | 3.60 ± 0.33 | -0.42 ± 0.27 | 3.63% | 5.23% | 0.912 | 0.870 | 0 |
| cosine | 30 ms fixed | 24 | 0.303 | -3.95 | -5.01 | 2.56 ± 0.30 | -0.27 ± 0.25 | 4.13% | 4.93% | 0.898 | 0.877 | 0 |
| cosine | 30 ms fixed | 30 | 0.303 | -4.20 | -4.77 | 2.29 ± 0.31 | -0.04 ± 0.25 | 4.27% | 4.67% | 0.895 | 0.884 | 0 |
| cosine | 30 ms fixed | 60 | 0.303 | -6.38 | -4.63 | — | — | 6.37% | 4.62% | 0.840 | 0.886 | 0 |
| linear | whole frame | 20 | 0.304 | 1.89 | 1.87 | 5.97 ± 0.37 | 1.19 ± 0.25 | 3.95% | 3.39% | 0.908 | 0.921 | 0 |
| linear | whole frame | 24 | 0.304 | 1.19 | 2.57 | 4.98 ± 0.35 | 1.63 ± 0.24 | 3.24% | 3.42% | 0.924 | 0.921 | 0 |
| linear | whole frame | 30 | 0.304 | -0.13 | 2.65 | 3.29 ± 0.33 | 1.36 ± 0.22 | 2.62% | 3.27% | 0.938 | 0.924 | 0 |
| linear | whole frame | 60 | 0.304 | -3.13 | 1.56 | — | — | 3.76% | 1.86% | 0.908 | 0.957 | 0 |
| linear | 30 ms fixed | 20 | 0.296 | 1.14 | 2.03 | 4.54 ± 0.35 | 1.10 ± 0.26 | 3.66% | 3.71% | 0.912 | 0.912 | 0 |
| linear | 30 ms fixed | 24 | 0.296 | 0.11 | 2.47 | 3.44 ± 0.32 | 1.46 ± 0.24 | 2.74% | 3.35% | 0.934 | 0.921 | 0 |
| linear | 30 ms fixed | 30 | 0.296 | 0.18 | 2.72 | 3.06 ± 0.31 | 1.29 ± 0.23 | 2.50% | 3.26% | 0.940 | 0.924 | 0 |
| linear | 30 ms fixed | 60 | 0.296 | -2.62 | 1.67 | — | — | 3.31% | 2.00% | 0.918 | 0.953 | 0 |

#### C. A frame rate that follows polarity (auto-exposure), and the fixed exposure

Same participant, same blinks. White page: 30 fps, 15 ms exposure. Black page: 25 fps, 40 ms (the 50-Hz anti-banding step; a mechanism, not a measurement). Fixed: 30 fps, 30 ms on both. Shift is against the white page, in points. "Exposure assumed = frame interval" is what the fit does when the exposure is not known.

| profile, noise | setting | shift, lowest frame | shift, fitted (true exposure) | shift, fitted (exposure assumed = frame interval) |
|---|---|---|---|---|
| cosine, 3% | black page under auto (25 fps, 40 ms) | 2.23 ± 0.32 | 0.04 ± 0.28 | 0.93 ± 0.28 |
| cosine, 3% | fixed exposure on both (30 fps, 30 ms) | 1.19 ± 0.31 | 0.44 ± 0.28 | 0.88 ± 0.26 |
| linear, 3% | black page under auto (25 fps, 40 ms) | 2.21 ± 0.30 | 0.00 ± 0.24 | 0.02 ± 0.23 |
| linear, 3% | fixed exposure on both (30 fps, 30 ms) | 1.34 ± 0.30 | -0.09 ± 0.23 | 0.00 ± 0.23 |
| cosine, 4% | black page under auto (25 fps, 40 ms) | 1.55 ± 0.35 | -0.58 ± 0.31 | 0.74 ± 0.32 |
| cosine, 4% | fixed exposure on both (30 fps, 30 ms) | 0.45 ± 0.33 | -0.31 ± 0.29 | 0.67 ± 0.31 |

#### D. The same average rate from two causes

| setting | detection | shift vs 30 fps, points | kappa |
|---|---|---|---|
| 30 fps, 10 ms (exposure 10 ms) | 1.000 | 0.00 ± 0.00 | 0.866 |
| 24 fps regular, 10 ms (exposure 10 ms) | 0.999 | 0.97 ± 0.29 | 0.890 |
| 30-fps camera, tracker keeps 80%, 10 ms (exposure 10 ms) | 0.995 | 1.69 ± 0.31 | 0.878 |
| 25 fps regular, 40 ms (exposure 40 ms) | 0.999 | 1.42 ± 0.30 | 0.895 |

#### E. Reading-window noise against a calibration at 3% (24 fps, whole-frame exposure)

| reading noise | incomplete share | shift vs 3%, points |
|---|---|---|
| 2% | 0.281 | 0.69 ± 0.18 |
| 3% | 0.273 | — |
| 4% | 0.266 | -0.65 ± 0.16 |

(414 s)
