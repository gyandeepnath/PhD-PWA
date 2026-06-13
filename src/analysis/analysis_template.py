"""VisuLab — analysis template (Python).

Authoritative inference for the within-subjects design: linear mixed models with a random
intercept per participant. Run after exporting the CSV bundle.

    pip install pandas numpy statsmodels scipy

Set DATA_DIR to the folder containing the exported CSVs.
"""
from __future__ import annotations
import os
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

DATA_DIR = "."


def load(name: str) -> pd.DataFrame:
    return pd.read_csv(os.path.join(DATA_DIR, name))


def main() -> None:
    conditions = load("02_conditions.csv")
    fatigue = load("03_fatigue_scores.csv")
    comprehension = load("04_comprehension.csv")
    rt_summary = load("09_rt_summary.csv")
    eye = load("07_eye_metrics.csv")

    cond = conditions.copy()
    cond["log_contrast"] = np.log10(cond["wcag_contrast_ratio"])
    cond["below_aa"] = cond["below_wcag_aa"].astype(int)

    # --- Reaction time -----------------------------------------------------------------
    rt = rt_summary.merge(cond, on=["participant_id", "condition_id"]).dropna(
        subset=["mean_rt_hits_ms"]
    )
    m_rt = smf.mixedlm(
        "mean_rt_hits_ms ~ log_contrast + C(polarity) + session_position",
        rt,
        groups=rt["participant_id"],
    ).fit()
    print("=== RT mixed model ===")
    print(m_rt.summary())

    # --- Fatigue -----------------------------------------------------------------------
    fat = fatigue[fatigue["stage"] == "post_condition"].merge(
        cond, on=["participant_id", "condition_id"]
    )
    m_fat = smf.mixedlm(
        "fatigue_mean ~ log_contrast + C(polarity) + session_position",
        fat,
        groups=fat["participant_id"],
    ).fit()
    print("\n=== Fatigue mixed model ===")
    print(m_fat.summary())

    # --- Comprehension (logistic; GEE as a mixed-logit stand-in) -----------------------
    comp = comprehension.merge(cond, on=["participant_id", "condition_id"])
    m_comp = smf.gee(
        "is_correct ~ log_contrast + C(polarity) + session_position",
        groups="participant_id",
        data=comp,
        family=__import__("statsmodels.api", fromlist=["families"]).families.Binomial(),
    ).fit()
    print("\n=== Comprehension GEE (logistic) ===")
    print(m_comp.summary())

    # --- d-prime aggregated across conditions (per-condition d' is unstable) -----------
    dprime = rt_summary.groupby("participant_id").agg(
        mean_dprime=("d_prime", "mean"),
        any_unstable=("d_prime_unstable", "any"),
    )
    print("\n=== Aggregated d' per participant ===")
    print(dprime)

    # --- Blink rate (full blinks only; caution per codebook) ---------------------------
    eye_active = eye[eye["camera_active"] == 1].merge(
        cond, on=["participant_id", "condition_id"]
    )
    if len(eye_active):
        m_blink = smf.mixedlm(
            "blink_rate_full ~ session_position + C(polarity)",
            eye_active,
            groups=eye_active["participant_id"],
        ).fit()
        print("\n=== Full-blink-rate mixed model ===")
        print(m_blink.summary())


if __name__ == "__main__":
    main()
