# What the timing numbers are, and where each one comes from

> **PROTOCOL AMENDMENT — ambient illumination.** The dim (~10 lux) level has been withdrawn. The
> study now runs at a SINGLE ambient level of 300 lux (band 250-350), one sitting per participant,
> ten condition-runs. Everything else — the Williams order, the five text colours, both polarities,
> CVS-Q, NASA-TLX, reaction time, visual search, comprehension, fatigue and blink measurement — is
> unchanged. Passages of this document that describe two sittings or a crossover describe the
> superseded design. See `ILLUMINATION_AMENDMENT.md` for the reasoning, the verified citations and
> what the change costs.

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

---

# The frontier: what each way of shortening a sitting costs

`scripts/protocolFrontier.ts` prices every shortening lever against the same simulated participant
stream and the same power assumptions the main simulation uses (both now read them from one
`SYNOPSIS` block in `scripts/lib/timingModel.ts`, so the two scripts cannot reach different
verdicts on the same design). Full output in `docs/PROTOCOL_FRONTIER_OUTPUT.txt`.

Two quantities are conserved, and they are why shortening is not free:

1. **Total condition-runs** = `n × runs-per-participant`. Halving the conditions in a sitting does
   not halve the study — it doubles the visits or the participants.
2. **Blinks per condition.** The primary outcome is a binomial proportion, so its SE is set by the
   blink *count*. Cutting reading exposure cuts blinks one for one.

> **Note on d′ standard error.** These figures were regenerated after the design helper was
> corrected to use the same rate correction the app applies — the 1/(2N) rule — rather than the
> log-linear one. A planning tool must model the estimator actually in use. The earlier figures
> (0.623 / 0.831) described a correction the app does not perform.

## The result

| variant | cond | sitting | visits | contact | SE | power main | power interaction |
|---|---|---|---|---|---|---|---|
| as shipped | 10 | 93m | 2 | 186m | 0.059 | 89% | 45% |
| CVS-Q once per participant | 10 | 87m | 2 | 174m | 0.059 | 89% | 45% |
| 5 cond/sitting | 5 | 56m | 4 | 223m | 0.059 | 89% | 45% |
| 4 cond/sitting | 4 | 41m | 5 | 207m | 0.059 | 89% | 45% |
| 2 cond/sitting | 2 | 26m | 10 | 260m | 0.059 | 89% | 45% |
| 4 cond, 60% passage | 4 | 37m | 5 | 183m | 0.076 | 87% | 34% |
| 2 cond, 40% passage | 2 | 22m | 10 | 224m | 0.093 | 84% | 27% |

**Cutting conditions per sitting costs no statistical power at all.** Every condition-count variant
holds identical power, because the condition-runs are conserved however they are packaged. What it
costs is *visits* — and therefore total contact time, which goes **up**, because the fixed overhead
is paid once per visit.

**Cutting reading exposure is the only lever that reduces total contact time, and the only one that
costs power.** It costs it unevenly: the polarity main effect barely moves, while the polarity ×
colour interaction falls fastest, because it contrasts single conditions instead of averaging five
per side (`CONTRAST.interaction` is `2 × se`; `CONTRAST.main` is `se × √2/√5`).

## The fixed-overhead wall

A sitting costs `T(k) = overhead + 7.13 × k` minutes for `k` conditions.

| overhead variant | first visit | repeat visit | conditions a 20-min sitting affords |
|---|---|---|---|
| as shipped | 22.0 min | 16.0 min | 0 |
| CVS-Q end of sitting only | 18.5 min | 12.8 min | 1 |
| CVS-Q once per participant | 15.6 min | 10.1 min | 1 |

The overhead alone exceeds 20 minutes on a first visit and nearly exhausts it on a repeat. Twenty
minutes is therefore not reachable by trimming; it is reachable only by moving the CVS-Q out of the
sitting **and** running one or two conditions per visit **and** truncating the passages.

## Why that makes the dropout worry worse, not better

Every visit after the first is an opportunity not to come back. If the per-return dropout
probability is `q`, a design needing `v` visits retains `(1 − q)^(v−1)`.

| visits | sitting | contact | retained @ q=5% | @ q=10% | @ q=15% | recruit for n=130 @ q=10% |
|---|---|---|---|---|---|---|
| 2 | 94m | 188m | 95% | 90% | 85% | 145 |
| 4 | 56m | 223m | 86% | 73% | 61% | 179 |
| 5 | 41m | 206m | 81% | 66% | 52% | 199 |
| 10 | 26m | 261m | 63% | 39% | 23% | 336 |

`q` is a swept parameter, **not a measured value** — substitute a figure from a pilot or from the
literature before quoting any of this.

The 20-minute design turns two 93-minute visits into ten 22-minute ones, with *more* total contact
time (224 vs 187 min), worse retention, and interaction power falling from 45% to 27%. Shortening
the sitting to reduce dropout achieves the opposite of its purpose.

## The pre-existing problem this exposed

Interaction power is **45% at full exposure**, against a synopsis target of 81%. That is not
created by any of the shortening options — it is there now, and it is the reason reading exposure
is the most expensive thing in the protocol to cut. It needs addressing on its own terms.

---

# What the literature changes

A literature search on short-protocol precedent has run; **every citation below is awaiting
independent DOI verification and must not be quoted until that resolves.** The findings that bear
on the timing decision:

## Reading exposure is already below the shortest published precedent

The shortest per-condition reading exposure retrieved with the *primary outcome* (blink rate and
incomplete-blink proportion) as its endpoint is **6 minutes** across six conditions. This protocol
runs **~3 minutes** per condition. Cutting reading exposure further therefore moves the study below
the precedent it would need to cite in defence — which closes off the only lever that reduces total
contact time. The interaction power problem and the exposure problem are the same problem.

## Adaptation on a polarity switch rests on analogy, not citation

No retrieved study measures the time course of adaptation to a display *polarity* switch. What
exists is the general chromatic and light-adaptation literature: chromatic adaptation ~90% complete
at approximately 60 s, 60–100 s found suitable for repeated pupillary measures, and light
adaptation (as opposed to dark) too fast to time at 30-second resolution. The current 120 s is
defensible by analogy but not by direct citation, and nothing retrieved requires it.

## The go/no-go block is not free to halve

RT-power methodology favours more participants with fewer trials each, which argues for a shorter
block. But the frontier now reports what it costs: d′ standard error rises from **0.683 to 0.966**
(+41%) at 32 → 16 trials, because the false-alarm rate comes from the minority no-go trials and is
always the noisier half.

## Session length past 30 minutes has documented consequences

Vigilance decrement is documented at 30 minutes with a further attentional cost at 60. A
98-minute sitting therefore measures its later conditions in a materially different attentional
state from its earlier ones. The Williams square counterbalances position, so this is inflated
error variance rather than bias — but it is inflated error variance on top of an interaction that
is already underpowered.

## The package that costs nothing

| variant | sitting | visits | contact | power int | d′ SE |
|---|---|---|---|---|---|
| as shipped | 93.1m | 2 | 186m | 45% | 0.683 |
| **90s switch + CVS-Q once per participant** | **84.5m** | 2 | **169m** | 45% | 0.683 |
| **60s switch + CVS-Q once per participant** | **82.0m** | 2 | **164m** | 45% | 0.683 |
| all three cuts (incl. 16 RT trials) | 79.0m | 2 | 158m | 45% | **0.966** |
| CONFIG cuts + 5 conditions/sitting | 45.5m | 4 | 182m | 45% | 0.966 |

Moving the CVS-Q to a once-per-participant covariate and trimming the polarity-switch adaptation
takes **9–11 minutes off every sitting and 18–23 minutes off total contact, at zero cost to any
outcome**. Neither touches reading exposure, condition count, or the number of visits.

That is the whole of what is free. Everything beyond it is paid for in d′ precision, in interaction
power, or in retention.
