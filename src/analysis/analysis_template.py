"""VisuLab — analysis template (Python).

A CROSS-CHECK, not the authoritative analysis. `analysis_template.R` is what implements
docs/ANALYSIS_PLAN.md: a random-effects reduction ladder that reports which structure it settled
on, and the pre-specified sensitivity refits. This file's header used to claim to be
"authoritative inference", which it was not — and three pre-registered requirements were simply
absent from it, so an analyst who ran this file instead of the R one satisfied none of them and had
no way to tell.

What this file is for: an independent re-derivation in a second toolchain. Where the two must agree
is in SIGN and in significance, not coefficient for coefficient — statsmodels' GEE is
population-averaged where lme4's glmer is subject-specific.

TWO LIMITS OF THIS FILE, stated because they are limits of the tool and not choices:

  - A GEE takes ONE clustering level. The pre-registered primary model has
    `(1 | participant_id) + (1 | passage_id)`; this file can cluster on participant only, so the
    passage intercept the design deliberately makes available is not fitted here. The R template
    fits it. A passage effect will therefore load onto the residual here and not there.
  - `mixedlm` fits a random intercept only. Where the plan's maximal structure carries a random
    slope, this file is at the plan's first reduction from the start.

Run after exporting the CSV bundle.

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

    # SUM-TO-ZERO POLARITY, and CENTRED POSITION. Both are pre-registered and neither was used.
    #
    # Every model below carried `C(polarity)`, which is patsy's default TREATMENT coding, inside an
    # interaction with colour. docs/ANALYSIS_PLAN.md is explicit about why that is wrong: "With an
    # interaction present, a dummy-coded main effect is the simple effect at the other factor's
    # reference level rather than an average effect. This is not a stylistic preference; it changes
    # what the coefficient means." The polarity coefficient this file printed for the PRIMARY
    # outcome was therefore the effect of polarity in achromatic text only — the one condition pair
    # with contrast held constant — reported as though it were the average effect of polarity.
    #
    # analysis_long.csv already exports `polarity_c` and `position_c` for exactly this. They are
    # re-derived here because this file reads the numbered CSVs, and the codings are kept identical
    # to that file's: negative = -0.5, positive = +0.5; position centred on (N_CONDITIONS - 1) / 2.
    cond["polarity_c"] = np.where(cond["polarity"] == "positive", 0.5, -0.5)
    cond["position_c"] = cond["session_position"] - (cond["session_position"].max() / 2)
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
        # Previously skipped in silence when the illumination check failed. The baseline-to-close
        # CHANGE is estimable with one level; only the between-level contrast is not.
        if cvsq_wide["ambient_illumination_level"].nunique() > 1:
            m_cvsq = smf.mixedlm(
                "change ~ C(ambient_illumination_level)",
                cvsq_wide.dropna(subset=["change"]),
                groups=cvsq_wide.dropna(subset=["change"])["participant_id"],
            ).fit()
            print("\n=== CVS-Q change by illumination (EXPLORATORY: frames differ) ===")
            print(m_cvsq.summary())
        else:
            # This branch did not exist: with one illumination level the whole block vanished
            # without printing a word, and the key secondary outcome simply never appeared in the
            # output. The change score itself is perfectly estimable; only the contrast is gone.
            ch = cvsq_wide["change"].dropna()
            print("\n=== CVS-Q baseline-to-close change (EXPLORATORY: frames differ) ===")
            print("One illumination level: no between-level contrast is estimable.")
            print(f"n = {len(ch)}, mean change = {ch.mean():.2f}, sd = {ch.std():.2f}")
    # Only include session_index when sittings actually vary (else it is constant → unidentified).
    si = " + session_index" if cond["session_index"].nunique() > 1 else ""

    # Ambient illumination is a SINGLE level under the current protocol, and patsy contributes ZERO
    # columns for a one-level categorical with an intercept — no error, no warning, the term simply
    # vanishes along with every interaction it appears in. That silent drop is worse than R's hard
    # error, because the model still fits and still prints. Detected from the data, so this file
    # analyses earlier two-level data unchanged.
    n_illum = cond["ambient_illumination_level"].nunique(dropna=True)
    il = " + C(ambient_illumination_level)" if n_illum > 1 else ""
    ilx = " * C(ambient_illumination_level)" if n_illum > 1 else ""
    if n_illum <= 1:
        print("\n[PROTOCOL NOTE] One ambient illumination level: illumination terms are omitted and"
              "\nno illumination effect is estimable. This is the protocol, not a fault in the data.")

    # passage_repeat_number is constant at 1 when each passage is read once, and statsmodels does
    # NOT drop an aliased column - the fit goes singular instead of telling you.
    rep_t = (" + passage_repeat_number"
             if cond.get("passage_repeat_number") is not None
             and cond["passage_repeat_number"].nunique(dropna=True) > 1 else "")

    # --- Reaction time -----------------------------------------------------------------
    rt = rt_summary.merge(cond, on=["participant_id", "condition_id"]).dropna(
        subset=["mean_rt_hits_ms"]
    )
    m_rt = smf.mixedlm(
        "mean_rt_hits_ms ~ log_contrast + polarity_c + position_c" + si,
        rt,
        groups=rt["participant_id"],
    ).fit()
    print("=== RT mixed model ===")
    print(m_rt.summary())

    # --- Fatigue -----------------------------------------------------------------------
    # fatigue_delta, per the plan's outcome table: "Change from the participant's own baseline
    # removes between-person scale use. Use fatigue_mean only if baselines are missing." This file
    # fitted fatigue_mean unconditionally, so it carried every participant's scale use into the
    # residual and into any between-participant term. 10_wide_summary.csv computes the delta
    # against the session baseline; fall back only when it is genuinely absent.
    fat = fatigue[fatigue["stage"] == "post_condition"].merge(
        cond, on=["participant_id", "condition_id"]
    )
    if "condition_id" in wide.columns and "fatigue_delta" in wide.columns:
        fat = fat.merge(wide[["condition_id", "fatigue_delta"]], on="condition_id", how="left")
    fat_dv = "fatigue_delta" if ("fatigue_delta" in fat.columns and fat["fatigue_delta"].notna().any()) else "fatigue_mean"
    if fat_dv == "fatigue_mean":
        print("\n[NOTE] No session baseline available: fitting fatigue_mean, which carries "
              "between-participant scale use. See the plan's outcome table.")
    fat = fat.dropna(subset=[fat_dv])
    m_fat = smf.mixedlm(
        f"{fat_dv} ~ log_contrast + polarity_c + position_c" + si,
        fat,
        groups=fat["participant_id"],
    ).fit()
    print(f"\n=== Fatigue mixed model ({fat_dv}) ===")
    print(m_fat.summary())

    # --- Comprehension (logistic; GEE as a mixed-logit stand-in) -----------------------
    comp = comprehension.merge(cond, on=["participant_id", "condition_id"])
    m_comp = smf.gee(
        # Item-level rows, three per condition, sharing a passage and a reading episode. GEE with
        # groups=condition_id gives a working-correlation account of that clustering; a plain
        # participant-level mixed model would treat the three items as independent.
        f"is_correct ~ log_contrast + polarity_c{ilx} + C(question_kind)"
        " + position_c" + si,
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
            # fps_adequate_for_ratio is deliberately NOT in the dropna subset: a row missing the
            # flag must reach the sensitivity block and be counted there, not vanish from the
            # primary fit for want of a QC column.
            prim = eye_active.dropna(subset=counts + ["polarity", "ambient_illumination_level"]).copy()
            prim["n_blinks"] = prim[counts].sum(axis=1)
            prim = prim[prim["n_blinks"] > 0]
            if len(prim):
                prim["p_incomplete"] = prim["blink_count_incomplete"] / prim["n_blinks"]
                m = smf.gee(
                    f"p_incomplete ~ polarity_c * C(color_name){ilx}"
                    f" + position_c{rep_t}",
                    groups="participant_id", data=prim,
                    family=sm.families.Binomial(), weights=prim["n_blinks"],
                ).fit()
                print("\n=== PRIMARY: incomplete-blink ratio, binomial GEE (population-averaged) ===")
                print(m.summary())

                # --- the pre-registered frame-rate sensitivity, which was ABSENT ----------------
                #
                # docs/ANALYSIS_PLAN.md §5.2: "Below the frame-rate floor the sampled minimum EAR is
                # biased UPWARD, so incomplete_blink_ratio is inflated — a directional bias, not
                # symmetric noise. Do not drop these rows silently: frame rate covaries with ambient
                # illumination, which is an independent variable, so dropping them deletes data
                # non-randomly with respect to a factor. Run the model with and without them and
                # report both."
                #
                # This file did neither. It pooled the flagged rows into the single fit above and
                # never named fps_adequate_for_ratio, so an analyst running it got one estimate that
                # silently included rows the export marks as biased on the primary outcome — and no
                # indication that a comparison was required. The R template has done this all along.
                #
                # The weighting above handles PRECISION (a ratio from 8 blinks is down-weighted
                # against one from 60). It cannot handle BIAS, which is what this is.
                if "fps_adequate_for_ratio" in prim.columns:
                    flag = prim["fps_adequate_for_ratio"].astype("boolean")
                    n_bad = int((flag == False).sum())  # noqa: E712 — pandas nullable boolean
                    print(f"\nframe-rate adequacy on the primary-outcome rows: "
                          f"{int((flag == True).sum())} adequate, {n_bad} below the floor")
                    if n_bad == 0:
                        print("No rows below the frame-rate floor: the fit above is already the "
                              "adequate-only fit, and no sensitivity comparison is needed.")
                    else:
                        ok = prim[flag == True]  # noqa: E712
                        if len(ok) and ok["polarity_c"].nunique() > 1:
                            m_ok = smf.gee(
                                f"p_incomplete ~ polarity_c * C(color_name){ilx}"
                                f" + position_c{rep_t}",
                                groups="participant_id", data=ok,
                                family=sm.families.Binomial(), weights=ok["n_blinks"],
                            ).fit()
                            print("\n=== PRIMARY refit, adequately-sampled conditions ONLY "
                                  "(pre-registered sensitivity) ===")
                            print(m_ok.summary())
                            print("\nBoth fits are reported because the plan requires both. If the "
                                  "effect exists only in the pooled fit, it is a camera artefact; if "
                                  "it survives here, the frame rate is not what produced it.")
                        else:
                            print("Too few adequately-sampled rows to refit — report the pooled fit "
                                  "with this count stated, and do not treat it as unqualified.")
                else:
                    print("\n[PLAN VIOLATION] fps_adequate_for_ratio is not in this export, so the "
                          "pre-registered frame-rate sensitivity CANNOT be run. Do not report the "
                          "primary outcome from this bundle without it.")

        for dv in ["blink_rate", "perclos_p80"]:
            if dv in eye_active.columns and eye_active[dv].notna().any():
                sub = eye_active.dropna(subset=[dv, "ambient_illumination_level"])
                if len(sub):
                    m = smf.mixedlm(
                        f"{dv} ~ position_c + polarity_c{il}",
                        sub, groups=sub["participant_id"],
                    ).fit()
                    print(f"\n=== {dv} mixed model ===")
                    print(m.summary())


if __name__ == "__main__":
    main()
