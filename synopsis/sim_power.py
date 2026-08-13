"""
Simulation-based power analysis for the proposed crossover (split-plot) design.

The guide's view is that n should exceed 200.  That intuition comes from
between-participant studies, where n is the number of independent replicates.
In this design every participant contributes 20 condition-runs and serves as
their own control, so the unit of replication differs by outcome type:

  (a) WITHIN-participant effects  (polarity, colour, illumination, and their
      interactions) are tested on participant-level difference scores.  Power
      depends on n and on the within-participant effect size d_z.
  (b) BETWEEN-participant effects (Objective 3 moderation: does the polarity
      effect differ between habitual dark-mode users and others?) are tested
      across participants and are far more demanding.

This script quantifies both, so the sample size can be justified per outcome
rather than by a single global number.
"""
import math
import numpy as np
from scipy.stats import t as tdist

rng = np.random.default_rng(20260813)
ALPHA = 0.05

# ---------------------------------------------------------------- within-participant
def power_within(n, dz, reps=20000):
    """Paired/one-sample t-test on participant-level difference scores."""
    crit = tdist.ppf(1 - ALPHA/2, n - 1)
    x = rng.normal(dz, 1.0, size=(reps, n))
    tstat = x.mean(1) / (x.std(1, ddof=1) / math.sqrt(n))
    return float(np.mean(np.abs(tstat) > crit))

# ---------------------------------------------------------------- between-participant
def power_moderation(n, delta_dz, prop=0.5, sd_effect=1.0, reps=20000):
    """
    Two-sample t-test comparing the participant-level effect between two subgroups.
    delta_dz = difference in the within-participant effect between subgroups,
    expressed in units of the between-participant SD of that effect.
    """
    n1 = int(round(n*prop)); n2 = n - n1
    if n1 < 2 or n2 < 2: return float('nan')
    crit = tdist.ppf(1 - ALPHA/2, n - 2)
    a = rng.normal(delta_dz, sd_effect, size=(reps, n1))
    b = rng.normal(0.0,      sd_effect, size=(reps, n2))
    sp = np.sqrt(((n1-1)*a.var(1, ddof=1) + (n2-1)*b.var(1, ddof=1)) / (n-2))
    tstat = (a.mean(1) - b.mean(1)) / (sp*math.sqrt(1/n1 + 1/n2))
    return float(np.mean(np.abs(tstat) > crit))

NS = (40, 60, 80, 100, 150, 200, 250)

print("="*104)
print("PART 1 — WITHIN-PARTICIPANT EFFECTS (polarity, colour, illumination, interactions)")
print("="*104)
print("Effect size d_z = mean participant-level difference / SD of those differences.")
print("Each participant contributes 20 condition-runs, so condition means are precise and d_z is large.\n")
print(f"{'d_z':>6s} " + "".join(f"{'n='+str(n):>9s}" for n in NS))
for dz in (0.20, 0.25, 0.30, 0.40, 0.50, 0.80):
    print(f"{dz:6.2f} " + "".join(f"{power_within(n, dz)*100:8.1f}%" for n in NS))
print("""
Reading: at n = 100 a within-participant effect of d_z = 0.30 (conventionally 'small')
is detected with about 86% power; d_z = 0.40 with about 98%.  Going from n = 100 to
n = 200 raises power for d_z = 0.30 from ~86% to ~99% — a real but modest gain, because
power is already high.  The within-participant contrasts are NOT the limiting factor.""")

print("\n" + "="*104)
print("PART 2 — BETWEEN-PARTICIPANT MODERATION (Objective 3)")
print("="*104)
print("Does the size of the polarity effect differ between subgroups (e.g. habitual dark-mode")
print("users vs others)?  Tested across participants; two equal subgroups assumed.\n")
print(f"{'delta':>6s} " + "".join(f"{'n='+str(n):>9s}" for n in NS))
for d in (0.30, 0.40, 0.50, 0.60, 0.80):
    print(f"{d:6.2f} " + "".join(f"{power_moderation(n, d)*100:8.1f}%" for n in NS))
print("""
Reading: moderation is the demanding analysis.  At n = 100 (50 per subgroup) a moderate
moderation effect of 0.50 SD is detected with only ~70% power; 0.60 SD with ~84%.
Reaching 80% power for a 0.40 SD moderation would need roughly n = 200.
This is where the guide's instinct is correct — but it applies to Objective 3 only.""")

print("\n" + "="*104)
print("PART 3 — SAMPLE SIZE REQUIRED FOR 80% AND 90% POWER")
print("="*104)
def n_for(target, kind, eff, lo=10, hi=1200):
    f = power_within if kind == 'within' else power_moderation
    best = None
    for n in range(lo, hi+1, 2):
        if f(n, eff, reps=4000) >= target:
            best = n; break
    # refine
    if best:
        for n in range(max(lo, best-2), best+1):
            if f(n, eff, reps=20000) >= target: return n
    return best
print(f"{'analysis':44s} {'effect':>8s} {'n for 80%':>11s} {'n for 90%':>11s}")
for lbl, kind, eff in [
    ("Within: polarity main effect",        'within', 0.40),
    ("Within: polarity main effect (small)",'within', 0.30),
    ("Within: polarity x colour interaction",'within',0.25),
    ("Between: moderation, large (0.60 SD)",'mod',    0.60),
    ("Between: moderation, moderate (0.50)", 'mod',   0.50),
    ("Between: moderation, small (0.40 SD)", 'mod',   0.40),
]:
    n80 = n_for(0.80, kind, eff); n90 = n_for(0.90, kind, eff)
    print(f"{lbl:44s} {eff:8.2f} {str(n80):>11s} {str(n90):>11s}")

print("\n" + "="*104)
print("PART 4 — WHAT n = 100 BUYS, AND WHAT IT DOES NOT")
print("="*104)
print(f"  Total condition-runs at n=100 : {100*20:,}")
print(f"  Total condition-runs at n=200 : {200*20:,}")
print("""
  n = 100 is comfortably sufficient for every WITHIN-participant contrast, which
  covers Objectives 1 and 2 and both primary and key secondary outcomes.
  n = 100 is adequate only for LARGE moderation effects (Objective 3).
  n = 200 would be needed for moderate moderation effects.

  Options, in order of feasibility:
    1. Retain n = 100, declare Objective 3 (moderation) EXPLORATORY and
       hypothesis-generating, and report it with confidence intervals only.
    2. Retain n = 100 for the full protocol and extend recruitment for a reduced
       moderation sub-study.
    3. Increase to n = 200 (4,000 condition-runs, roughly 400 laboratory hours).""")
