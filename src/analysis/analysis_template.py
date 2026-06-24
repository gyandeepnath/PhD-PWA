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
    # Photometry covariates live in 01_session_info.csv (screen_white_luminance_cd_m2,
    # brightness_percent); constant on a single fixed device, otherwise join as a session covariate.
    session_info = load("01_session_info.csv")  # noqa: F841 (available for between-session covariates)
    conditions = load("02_conditions.csv")
    fatigue = load("03_fatigue_scores.csv")
    comprehension = load("04_comprehension.csv")
    rt_summary = load("09_rt_summary.csv")
    eye = load("07_eye_metrics.csv")
    wide = load("10_wide_summary.csv")  # carries session_index + engagement_flag per condition

    # Boredom/disengagement mimics fatigue; optionally drop conditions flagged "bad" and re-run as
    # a sensitivity analysis. session_index distinguishes split-session sittings (1, 2, ...).
    DROP_DISENGAGED = True
    cond = conditions.merge(
        wide[["participant_id", "condition_label", "session_index", "engagement_flag"]],
        on=["participant_id", "condition_label"], how="left",
    )
    cond["session_index"] = cond["session_index"].fillna(1).astype(int)
    if DROP_DISENGAGED:
        cond = cond[cond["engagement_flag"].fillna("good") != "bad"]
    cond["log_contrast"] = np.log10(cond["wcag_contrast_ratio"])
    cond["below_aa"] = cond["below_wcag_aa"].astype(int)
    # Only include session_index when sittings actually vary (else it is constant → unidentified).
    si = " + session_index" if cond["session_index"].nunique() > 1 else ""

    # --- Reaction time -----------------------------------------------------------------
    rt = rt_summary.merge(cond, on=["participant_id", "condition_id"]).dropna(
        subset=["mean_rt_hits_ms"]
    )
    m_rt = smf.mixedlm(
        "mean_rt_hits_ms ~ log_contrast + C(polarity) + session_position" + si,
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
        "fatigue_mean ~ log_contrast + C(polarity) + session_position" + si,
        fat,
        groups=fat["participant_id"],
    ).fit()
    print("\n=== Fatigue mixed model ===")
    print(m_fat.summary())

    # --- Comprehension (logistic; GEE as a mixed-logit stand-in) -----------------------
    comp = comprehension.merge(cond, on=["participant_id", "condition_id"])
    m_comp = smf.gee(
        "is_correct ~ log_contrast + C(polarity) + session_position" + si,
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

    # --- Ocular fatigue (interpret per codebook; gate duration tiers on effective_fps) ----
    # CVS markers: blink_rate (drops with screen concentration) + incomplete_blink_ratio (rises,
    # correlates with CVS symptoms — Portello & Rosenfield 2013). Drowsiness covariate: perclos_p80.
    eye_active = eye[eye["camera_active"] == 1].merge(
        cond, on=["participant_id", "condition_id"]
    )
    if len(eye_active):
        for dv in ["blink_rate", "incomplete_blink_ratio", "perclos_p80"]:
            if eye_active[dv].notna().any():
                m = smf.mixedlm(
                    f"{dv} ~ session_position + C(polarity)",
                    eye_active.dropna(subset=[dv]),
                    groups=eye_active.dropna(subset=[dv])["participant_id"],
                ).fit()
                print(f"\n=== {dv} mixed model ===")
                print(m.summary())


if __name__ == "__main__":
    main()
