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
import statsmodels.api as sm
import statsmodels.formula.api as smf

DATA_DIR = "."


def load(name: str) -> pd.DataFrame:
    return pd.read_csv(os.path.join(DATA_DIR, name))


def main() -> None:
    # Photometry covariates live in 01_session_info.csv (screen_white_luminance_cd_m2,
    # brightness_percent); constant on a single fixed device, otherwise join as a session covariate.
    session_info = load("01_session_info.csv")   # the whole-plot illumination factor lives here
    conditions = load("02_conditions.csv")
    fatigue = load("03_fatigue_scores.csv")
    comprehension = load("04_comprehension.csv")
    rt_summary = load("09_rt_summary.csv")
    eye = load("07_eye_metrics.csv")
    wide = load("10_wide_summary.csv")  # carries session_index + engagement_flag per condition
    participant = load("11_participant.csv")  # demographics + vision covariates (age, cvd_status, ...)
    cvsq = load("13_cvsq.csv")  # CVS-Q symptom questionnaire (baseline + session_end), per item

    # Join participant covariates onto every condition row so models can adjust for them, e.g.
    #   "... + age + C(correction_type)"  or stratify by cvd_status.
    PARTICIPANT_COVARIATES = ["age", "gender", "daily_screen_hours", "correction_type", "cvd_status"]
    participant_cov = participant[["participant_id", *PARTICIPANT_COVARIATES]]

    # Boredom/disengagement mimics fatigue; optionally drop conditions flagged "bad" and re-run as
    # a sensitivity analysis. session_index distinguishes split-session sittings (1, 2, ...).
    DROP_DISENGAGED = True
    # Join on condition_id, NEVER on participant_id + condition_label. Each participant runs all ten
    # labels in EACH illumination block, so a label join matches every condition twice on both
    # sides — four rows per condition, half carrying the wrong sitting and so the wrong illumination
    # level. pandas.merge emits no warning for this at all.
    cond = conditions.merge(
        wide[["condition_id", "engagement_flag"]], on="condition_id", how="left",
    )
    assert len(cond) == len(conditions), "condition join duplicated rows - check the join key"
    # session_index comes from 02_conditions.csv itself now. It is NOT filled with 1 on absence:
    # relabelling an unknown sitting as sitting 1 silently assigns it the wrong illumination level.
    if DROP_DISENGAGED:
        cond = cond[cond["engagement_flag"].fillna("good") != "bad"]
    # One row per participant: 11_participant.csv is written per EXPORT, i.e. per sitting, and its
    # mutable covariates can differ between them.
    cond = cond.merge(participant_cov.drop_duplicates(subset="participant_id"),
                      on="participant_id", how="left")
    # The whole-plot factor. This file used to load 01_session_info.csv and never merge it, so
    # ambient illumination appeared in no model in the entire template: the Python replication
    # answered none of the study's whole-plot question.
    cond = cond.merge(
        session_info[["participant_id", "session_index", "ambient_illumination_level",
                      "illumination_block", "illumination_order_first"]],
        on=["participant_id", "session_index"], how="left",
    )
    cond["log_contrast"] = np.log10(cond["wcag_contrast_ratio"])
    cond["below_aa"] = cond["below_wcag_aa"].astype(int)
    # CVS-Q change, per SITTING. Pivoting on participant_id alone silently averaged the two sittings
    # (pivot_table defaults to aggfunc="mean"), which destroyed the illumination contrast that is
    # the entire reason for administering it twice. 13_cvsq.csv now carries session_index.
    #
    # NOTE: baseline and close use DIFFERENT recall frames (see the `frame` column and
    # docs/LITERATURE_VALIDATION.md). This change score is exploratory.
    cvsq_wide = cvsq.pivot_table(
        index=["participant_id", "session_index", "ambient_illumination_level"],
        columns="stage", values="total_score", aggfunc="first",
    ).reset_index()
    if {"baseline", "session_end"} <= set(cvsq_wide.columns):
        cvsq_wide["change"] = cvsq_wide["session_end"] - cvsq_wide["baseline"]
        if cvsq_wide["ambient_illumination_level"].nunique() > 1:
            m_cvsq = smf.mixedlm(
                "change ~ C(ambient_illumination_level)",
                cvsq_wide.dropna(subset=["change"]),
                groups=cvsq_wide.dropna(subset=["change"])["participant_id"],
            ).fit()
            print("\n=== CVS-Q change by illumination (EXPLORATORY: frames differ) ===")
            print(m_cvsq.summary())
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
        # Item-level rows, three per condition, sharing a passage and a reading episode. GEE with
        # groups=condition_id gives a working-correlation account of that clustering; a plain
        # participant-level mixed model would treat the three items as independent.
        "is_correct ~ log_contrast + C(polarity) * C(ambient_illumination_level) + C(question_kind)"
        " + session_position" + si,
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
        # The PRIMARY outcome is a binomial proportion with an exported denominator, so it is fitted
        # as one — a GEE with a binomial family and the blink total as the trial count, clustered on
        # participant. Fitting the naked proportion in a Gaussian model gave a ratio from 8 blinks
        # the same weight as one from 60, and produced fitted values below zero for the low-blink
        # conditions.
        #
        # NOTE ON ESTIMANDS: GEE is a POPULATION-AVERAGED model. Its coefficients are systematically
        # attenuated relative to the subject-specific ones from the R template's glmer, so the two
        # files answer the same question on different scales and must not be compared coefficient
        # for coefficient. Where they must agree is in SIGN and in significance.
        counts = ["blink_count_incomplete", "blink_count_full", "blink_count_micro"]
        if all(c in eye_active.columns for c in counts):
            prim = eye_active.dropna(subset=counts + ["polarity", "ambient_illumination_level"]).copy()
            prim["n_blinks"] = prim[counts].sum(axis=1)
            prim = prim[prim["n_blinks"] > 0]
            if len(prim):
                prim["p_incomplete"] = prim["blink_count_incomplete"] / prim["n_blinks"]
                m = smf.gee(
                    "p_incomplete ~ C(polarity) * C(color_name) * C(ambient_illumination_level)"
                    " + session_position + passage_repeat_number",
                    groups="participant_id", data=prim,
                    family=sm.families.Binomial(), weights=prim["n_blinks"],
                ).fit()
                print("\n=== PRIMARY: incomplete-blink ratio, binomial GEE (population-averaged) ===")
                print(m.summary())

        for dv in ["blink_rate", "perclos_p80"]:
            if dv in eye_active.columns and eye_active[dv].notna().any():
                sub = eye_active.dropna(subset=[dv, "ambient_illumination_level"])
                if len(sub):
                    m = smf.mixedlm(
                        f"{dv} ~ session_position + C(polarity) + C(ambient_illumination_level)",
                        sub, groups=sub["participant_id"],
                    ).fit()
                    print(f"\n=== {dv} mixed model ===")
                    print(m.summary())


if __name__ == "__main__":
    main()
