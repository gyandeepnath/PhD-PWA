# What the timing numbers are, and where each one comes from

This document exists to answer one question: *is the per-session estimate inflated?*

The short answer is that it is partly an estimate and mostly not. The minutes divide into three
tiers, and only the third can be argued down:

| Tier | What it is | Minutes | Share |
|---|---|---|---|
| **Enforced** | The app will not advance before this much time has elapsed. Read from `src/experiment/config.ts`. | 26.3 | 27% |
| **Corpus arithmetic** | Words in the reading corpus divided by a reading rate. The word count is exact. | 29.6 | 30% |
| **Estimated** | Per-item guesses for a motivated young adult. | 42.5 | 43% |

Enforced is `adaptation` (15.0 min: five 120 s polarity switches and five 60 s same-polarity
fields) plus `rt_block` (10.9 min: 32 trials × 10 conditions, where each trial's fixation, delay,
response window and ITI all come from CONFIG). Corpus arithmetic is `reading`: the ten passages
hold **5,851 words** (585.1 mean, verified by `countWords` over `PASSAGES`), so at 215 wpm that is
27.2 minutes and there is no rate at which it becomes small — 300 wpm still costs 19.5 minutes.

Together the two tiers that are **not** estimates come to **55.9 minutes**. Setting every one of my
behavioural estimates to zero — consent instantaneous, questionnaires instantaneous, calibration
instantaneous — leaves 55.9 minutes. Replacing the reading rate with a brisk 300 wpm on top of that
leaves **45.8 minutes**. That is the design's floor, and it is a property of the protocol rather
than of how fast the participant is.

## Sensitivity of the total to my estimates being wrong

```
estimates   0% too high ->  98.4 min   <- as modelled
estimates  20% too high ->  89.9 min
estimates  30% too high ->  85.6 min
estimates  50% too high ->  77.1 min
estimates  70% too high ->  68.6 min
estimates 100% too high ->  55.9 min   <- estimates set to zero
```

So the challenge is well aimed at the right tier and still does not reach the target. If every
behavioural estimate in the model is **half** what I claimed, a sitting is 77 minutes. If they are
all **zero**, it is 56.

## Illumination × sitting order

These two factors are orthogonal by design: illumination order is counterbalanced against sitting
order, so the dim sitting is the first visit for half the sample and the second for the other half.
They act on different things — illumination on reading rate, sitting order on setup burden.

Which setup stages repeat is decided by the predicates in `firstUnsatisfiedSetupStage()`, and those
read from two different scopes. `consent_given`, `cvsq.stage === 'baseline'` and the baseline
fatigue row are **session** fields, so they repeat every sitting. `participantRow` and
`cvd_screen_total` are **participant** fields, so `PARTICIPANT_PROFILE` and `COLOR_VISION` run once
in a participant's life. The second-sitting saving is therefore a property of the code, not an
assumption.

The size of the dim-reading effect is *itself one of the things this study exists to estimate*, so
baking a value into the feasibility model would beg the question. It is exposed as a knob and
reported across three assumptions:

| dim reading penalty | dim 1st | dim 2nd | bright 1st | bright 2nd | total contact |
|---|---|---|---|---|---|
| 0% | 98.4 | 90.3 | 98.5 | 90.5 | 188.9 |
| 5% | 99.8 | 92.0 | 98.2 | 90.5 | 190.3 |
| 10% | 101.2 | 93.4 | 98.3 | 90.6 | 191.8 |

Means in minutes, n = 2000 simulated participants per cell. A participant runs exactly one first
visit and one second visit, one dim and one bright, so total contact is the sum of the two cells
they actually occupy.

## Consequence for the 20-minute target

Twenty minutes per sitting is not reachable by sharpening the behavioural estimates, because the
estimates are 43% of the total and the target is below the 26% that the app enforces plus the 30%
that the corpus fixes. Reaching it requires changing the design in one or both of the two places
where the non-negotiable minutes live:

1. **Conditions per sitting.** Ten conditions × (adaptation + reading + RT) is the whole cost. An
   incomplete block design that runs a subset per sitting cuts the sitting proportionally, at the
   price of more sittings or more participants — total condition-runs is conserved at
   `n × runs-per-participant`.
2. **Adaptation.** 15.0 minutes of enforced grey field, of which 6.0 minutes is the cost of the
   five polarity switches the Williams order produces. Ordering conditions to group polarity would
   recover those 6 minutes but reintroduces the carryover confound the Williams order removes.

Reading exposure is the third lever and the most expensive one to pull, because it trades directly
against the precision of the primary outcome. `scripts/simulateParticipant.ts` prints that trade:
at the shipped 178 s per condition the incomplete-blink ratio carries SE = 0.059, and dropping to
73 s raises it to 0.092 while only saving 18 minutes.

## Reproducing every number here

```
npx tsx scripts/simulateParticipant.ts --n 2000
```

Every app-controlled duration is read from the real `CONFIG`, so this file cannot drift from what
the instrument does. Every participant-controlled duration is drawn from a distribution whose basis
is stated in the script's header comment. Nothing in the table above is typed in by hand.
