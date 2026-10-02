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
import sys
import numpy as np
import pandas as pd
import statsmodels.api as sm
import glob
import statsmodels.formula.api as smf

# Point DATA_DIR at one exported folder, OR at a folder containing one per participant.
# VISULAB_DATA_DIR overrides it from the environment, so scripts/verifyAnalysis.mjs can run this
# file against a fixture WITHOUT editing it — the gate then checks the bytes the analyst is given.
DATA_DIR = os.environ.get("VISULAB_DATA_DIR", ".")


def load(name: str, with_folder: bool = False) -> pd.DataFrame:
    """Load one numbered export file, pooled across every participant folder found.

    The app exports ONE FOLDER PER SITTING, so 130 participants is 130 folders. This used to read a
    single folder, which meant the GEE below was estimated on one participant: the design has ten
    cells and a sitting has ten rows, so the fit was saturated, every standard error came out NaN or
    at machine epsilon, and no coefficient could be tested. The documented instruction therefore
    described a run that cannot produce the thesis result, and the alternative was concatenating 130
    folders by hand — which analysisExport.ts calls out as "where analysis errors are actually
    introduced: a mis-sorted join, a participant counted twice, a sitting silently missing".

    The R template was corrected the same way. Keeping the two loaders equivalent matters, because
    ANALYSIS_PLAN.md 5b requires the two toolchains to agree in sign and in significance, and they
    cannot be compared at all if one of them is fitted on a single participant.

    A single exported folder still yields exactly one match, so that case behaves as before.
    """
    matches = sorted(glob.glob(os.path.join(DATA_DIR, "**", name), recursive=True))
    if not matches:
        raise FileNotFoundError(
            f"no {name} found under DATA_DIR ({os.path.abspath(DATA_DIR)}). "
            "Point DATA_DIR at an exported folder, or at a folder of them."
        )
    # Each file is typed by pandas on its own and then concatenated; NOTHING re-infers the types
    # over the pooled frame (an earlier version of this comment said it did). A column that is empty
    # in one folder and numeric in another therefore arrives as object or float depending on the
    # mix, which is why every comparison below that reads a flag or a key coerces explicitly
    # (truthy(), astype(str)) instead of trusting the dtype.
    parts = []
    for m in matches:
        d = pd.read_csv(m)
        if with_folder:
            # One exported folder is one sitting; see the R template's read_export for why the folder,
            # not session_index, ties 01_session_info.csv to the condition rows of the same sitting.
            d["sitting_folder"] = os.path.dirname(m)
        parts.append(d)
    return pd.concat(parts, ignore_index=True)


def truthy(col: pd.Series) -> pd.Series:
    """TRUE/True/true/1 as True; anything else, including blank, as False."""
    return col.astype(str).str.strip().str.lower().isin(["true", "1"])


# Codes that mean "this participant's condition set is incomplete" and nothing else. The SENSITIVITY
# set re-admits the finished runs of participants excluded ONLY for these (ANALYSIS_PLAN.md §1); the
# list is the R template's COMPLETENESS_CODES, and the gate checks both files reach the same sets.
COMPLETENESS_CODES = {"condition_incomplete", "condition_coverage", "incomplete_split_sitting",
                      "incomplete_crossover", "sitting_not_in_data_dir"}


def exporter_verdict(session_info: pd.DataFrame, conditions: pd.DataFrame) -> pd.DataFrame:
    """One row per condition-run with the exporter's verdict applied: reasons, confirmatory, sensitivity.

    The R template's "WHICH ROWS ARE MODELLED" section explains the rule at length; this is the same
    rule. Both files read analysis_join_report.csv — the join check's verdict — and neither re-derives
    it, so the exporter, the dashboard and the two toolchains model the same rows. This file used to
    drop withdrawn participants and unfinished runs only, and modelled a test-harness session,
    integrity-blocked sittings and participants without a complete condition set.
    """
    paths = sorted(glob.glob(os.path.join(DATA_DIR, "**", "analysis_join_report.csv"), recursive=True))
    if not paths:
        sys.exit(
            f"[NO VERDICT] analysis_join_report.csv was not found under DATA_DIR "
            f"({os.path.abspath(DATA_DIR)}). Which participants may be analysed is decided by the "
            "exporter's join check, not by this file. Take the pooled export (Dashboard -> 'Export "
            "analysis dataset') from the same tablet and put its folder inside DATA_DIR beside the "
            "per-sitting folders.")
    if len(paths) > 1:
        sys.exit(f"[TWO VERDICTS] more than one analysis_join_report.csv under DATA_DIR "
                 f"({' AND '.join(paths)}). Keep only the pooled export taken after the last sitting.")
    v = pd.read_csv(paths[0], dtype=str, keep_default_na=False)
    verdict = pd.DataFrame({
        "participant_key": v["participant_id"],
        "session_id": v["session_ids"].str.split(";"),
        "p_analysable": truthy(v["analysable"]),
        "excluded_by": v["excluded_by"],
    }).explode("session_id")

    si = session_info.copy()
    for col in ("withdrawn", "e2e_timing", "protocol_pass"):
        if col not in si.columns:
            si[col] = np.nan
    flags = pd.DataFrame({
        "sitting_folder": si["sitting_folder"],
        "test_harness": truthy(si["e2e_timing"]),
        "repeat_pass": pd.to_numeric(si["protocol_pass"], errors="coerce").fillna(0) > 0,
    })
    wd_pids = set(si.loc[truthy(si["withdrawn"]), "participant_id"])
    present = set(conditions["session_id"].astype(str))
    # .eq(False) rather than the unary negation operator, which is also patsy's formula separator:
    # tests/analysisTemplates.test.ts reads any quoted span containing that character as a formula.
    short_keys = set(verdict.loc[verdict["session_id"].isin(present).eq(False), "participant_key"])

    runs = conditions[["condition_id", "participant_id", "session_id", "sitting_folder"]].copy()
    runs["session_id"] = runs["session_id"].astype(str)
    # Older exports lack the column: their rows pass as finished, exactly as in the R template.
    runs["finished"] = (conditions["condition_complete"].astype(str).str.strip().str.lower().ne("false")
                        if "condition_complete" in conditions.columns else True)
    runs = runs.merge(flags, on="sitting_folder", how="left").merge(verdict, on="session_id", how="left")

    def reasons(r) -> list:
        codes = [c for c in str(r["excluded_by"] if isinstance(r["excluded_by"], str) else "").split(";") if c]
        extra = [
            "run_unfinished" if not r["finished"] else None,
            "participant_withdrawn" if r["participant_id"] in wd_pids else None,
            "audit_e2e_timing" if pd.notna(r["test_harness"]) and bool(r["test_harness"]) else None,
            "protocol_pass_repeat" if pd.notna(r["repeat_pass"]) and bool(r["repeat_pass"]) else None,
            "no_verdict_for_sitting" if pd.isna(r["p_analysable"]) else None,
            "sitting_not_in_data_dir" if r["participant_key"] in short_keys else None,
        ]
        return list(dict.fromkeys(codes + [e for e in extra if e]))

    runs["reasons"] = runs.apply(reasons, axis=1)
    runs["confirmatory"] = runs["reasons"].map(len).eq(0)
    runs["sensitivity"] = runs["reasons"].map(lambda rs: all(x in COMPLETENESS_CODES for x in rs))

    print("\n" + "=" * 74)
    print(f"WHICH ROWS ARE MODELLED — the exporter's verdict ({os.path.basename(paths[0])})")
    print("=" * 74)
    print(f"condition-runs under DATA_DIR: {len(runs)} from {runs['participant_id'].nunique()} participant(s)")
    print(f"withdrawn participants removed before modelling: {len(wd_pids)}")
    n_unfinished = int(runs["finished"].eq(False).sum())
    print(f"unfinished condition-runs removed before modelling (paused or interrupted): {n_unfinished}")
    long = runs[["participant_id", "reasons"]].explode("reasons").dropna(subset=["reasons"])
    if len(long):
        print("\nexclusion reasons (a run can carry several; a participant-level code applies to every run of")
        print("that participant; run_unfinished is the run itself):")
        tab = (long.groupby("reasons").agg(condition_runs=("participant_id", "size"),
                                            participants=("participant_id", "nunique"))
               .reset_index().sort_values(["condition_runs", "reasons"], ascending=[False, True]))
        for _, t in tab.iterrows():
            print(f"  [exclusion] {t['reasons']:<34} {t['condition_runs']:5d} condition-run(s)  "
                  f"{t['participants']:4d} participant(s)")
    else:
        print("no condition-run is excluded.")
    conf, sens = runs[runs["confirmatory"]], runs[runs["sensitivity"]]
    print(f"\nCONFIRMATORY SET: {len(conf)} condition-runs from {conf['participant_id'].nunique()} participants")
    print(f"SENSITIVITY SET:  {len(sens)} condition-runs from {sens['participant_id'].nunique()} participants "
          "(adds finished runs of participants")
    print("                  excluded only for an incomplete condition set; ANALYSIS_PLAN.md §1)")
    return runs


def main() -> None:
    # Photometry covariates live in 01_session_info.csv (screen_white_luminance_cd_m2,
    # brightness_percent); constant on a single fixed device, otherwise join as a session covariate.
    session_info = load("01_session_info.csv", with_folder=True)   # the whole-plot illumination factor lives here
    conditions = load("02_conditions.csv", with_folder=True)
    fatigue = load("03_fatigue_scores.csv")
    comprehension = load("04_comprehension.csv")
    rt_summary = load("09_rt_summary.csv")
    eye = load("07_eye_metrics.csv")
    wide = load("10_wide_summary.csv")  # carries session_index + engagement_flag per condition
    participant = load("11_participant.csv", with_folder=True)  # demographics + vision covariates (age, cvd_status, ...)
    cvsq = load("13_cvsq.csv", with_folder=True)  # CVS-Q symptom questionnaire (baseline + session_end), per item

    # A SITTING EXPORTED TWICE STOPS THE RUN, before anything is counted — the same check, in the same
    # place, as the R template. Two folders holding one session would otherwise be pooled as two.
    dup = conditions.loc[conditions["condition_id"].duplicated(), "condition_id"].unique()
    if len(dup):
        where = conditions.loc[conditions["condition_id"] == dup[0], "sitting_folder"].unique()
        sys.exit(f"[DUPLICATED EXPORT] {len(dup)} condition_id value(s) occur more than once under DATA_DIR "
                 f"(e.g. {dup[0]}, in: {' AND '.join(where)}). The same sitting has been exported into more "
                 "than one folder, so every row of it would be counted twice. Remove the duplicate folder "
                 "and run again.")

    # WHICH ROWS ARE MODELLED: the exporter's verdict, applied once, here, to every table before any
    # join. See exporter_verdict(). The untrimmed tables are kept for the one sensitivity refit.
    runs = exporter_verdict(session_info, conditions)
    keep_ids = set(runs.loc[runs["confirmatory"], "condition_id"])
    keep_folders = set(runs.loc[runs["confirmatory"], "sitting_folder"])
    sens_ids = set(runs.loc[runs["sensitivity"], "condition_id"])
    sens_folders = set(runs.loc[runs["sensitivity"], "sitting_folder"])
    conditions_all, eye_all, wide_all = conditions, eye, wide
    session_info_all, participant_all = session_info, participant

    def by_condition(d: pd.DataFrame, ids: set) -> pd.DataFrame:
        return d[d["condition_id"].isin(ids)] if "condition_id" in d.columns else d

    def by_folder(d: pd.DataFrame, folders: set) -> pd.DataFrame:
        return d[d["sitting_folder"].isin(folders)]

    conditions = by_condition(conditions, keep_ids)
    fatigue = by_condition(fatigue, keep_ids)
    comprehension = by_condition(comprehension, keep_ids)
    rt_summary = by_condition(rt_summary, keep_ids)
    eye = by_condition(eye, keep_ids)
    wide = by_condition(wide, keep_ids)
    session_info = by_folder(session_info, keep_folders)
    participant = by_folder(participant, keep_folders)
    cvsq = by_folder(cvsq, keep_folders)

    # Join participant covariates onto every condition row so models can adjust for them, e.g.
    #   "... + age + C(correction_type)"  or stratify by cvd_status.
    PARTICIPANT_COVARIATES = ["age", "gender", "daily_screen_hours", "correction_type", "cvd_status"]

    # Boredom/disengagement mimics fatigue; optionally drop conditions flagged "bad" and re-run as
    # a sensitivity analysis. session_index distinguishes split-session sittings (1, 2, ...).
    DROP_DISENGAGED = True

    # The design's condition count, for position_c. See the note at position_c below.
    # DISTINCT conditions, not rows: load() pools every participant folder, so a 12-participant
    # cohort returns 120 reference rows. Counting them gave a centring constant of 59.5 and drove the
    # GEE's standard errors to NaN — caught by the gate's own "usable standard error" assertion.
    try:
        n_conditions = int(load("00_condition_reference.csv")["condition_label"].nunique())
    except (FileNotFoundError, KeyError):
        n_conditions = 0
    if n_conditions <= 0:
        n_conditions = int(conditions["session_position"].max()) + 1
        print(
            f"[position_c] 00_condition_reference.csv unavailable — centring on the observed "
            f"{n_conditions} positions instead of the design's. This differs from analysis_long.csv "
            f"if any position is absent from the data."
        )

    def build_cond(conditions: pd.DataFrame, wide: pd.DataFrame, participant: pd.DataFrame,
                   session_info: pd.DataFrame) -> pd.DataFrame:
        """The per-condition modelling frame. A function because the sensitivity refit needs the
        identical frame built from the untrimmed tables."""
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
        cond = cond.merge(participant[["participant_id", *PARTICIPANT_COVARIATES]]
                          .drop_duplicates(subset="participant_id"),
                          on="participant_id", how="left")
        # The whole-plot factor. This file used to load 01_session_info.csv and never merge it, so
        # ambient illumination appeared in no model in the entire template: the Python replication
        # answered none of the study's whole-plot question. Joined on the FOLDER, which is the sitting;
        # session_index is not unique within a participant (see the R template's build_cond).
        cond = cond.merge(
            session_info[["sitting_folder", "ambient_illumination_level",
                          "illumination_block", "illumination_order_first"]],
            on="sitting_folder", how="left",
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

        # Centred on the DESIGN's last position, not on the one this dataset happens to contain.
        #
        # This read `session_position.max() / 2`, which agrees with analysis_long.csv only when the data
        # includes position 9 — and the comment above claims the two codings are identical. A cohort in
        # which no participant reached the last condition centres at 4.0 here and at 4.5 there, so the
        # covariate the two toolchains call position_c is not the same covariate. It also drifts with the
        # dataset rather than with the protocol, which means re-running the same analysis after one more
        # participant is added can move it.
        #
        # 00_condition_reference.csv lists every condition of a full sitting whether or not it ran (the
        # export writes it that way on purpose), so it is the authoritative count available to this file.
        # Falling back to the observed maximum is kept for a bundle that predates that file, and it says
        # so rather than silently differing.
        cond["position_c"] = cond["session_position"] - (n_conditions - 1) / 2
        return cond

    cond = build_cond(conditions, wide, participant, session_info)
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
    # THE RESPONSE IS 0/1, NOT A BOOLEAN. read_csv types `is_correct` as bool, patsy expands a bool
    # response into TWO indicator columns (is_correct[False], is_correct[True]), and statsmodels'
    # Binomial takes the FIRST as the success — so this model was fitting P(WRONG answer). Every
    # comprehension coefficient came out with the opposite sign to the R template's glmer, with no
    # warning; ANALYSIS_PLAN.md 5b requires the two to agree in sign. The intercept-only fit gave
    # p = 0.273 on a cohort whose observed CORRECT rate was 0.727. Coerced from the text form so a
    # column that arrives as "TRUE"/"true"/"1"/True all mean the same thing.
    comp["is_correct"] = comp["is_correct"].astype(str).str.strip().str.lower().isin(["true", "1"]).astype(int)
    m_comp = smf.gee(
        # Item-level rows, three per condition, sharing a passage and a reading episode. Clustered
        # on PARTICIPANT, which nests the condition (each condition-run belongs to one participant),
        # so the robust standard errors allow for the three items of a condition being correlated as
        # well as for the participant's ten conditions. A plain mixed model with a participant
        # intercept alone would treat the three items as independent. (This comment used to say
        # groups=condition_id, which the code has never used.)
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
    # correlates with CVS symptoms — Portello, Rosenfield & Chu 2013). Drowsiness covariate: perclos_p80.
    eye_active = eye[truthy(eye["camera_active"])].merge(
        cond, on=["participant_id", "condition_id"]
    )
    counts = ["blink_count_incomplete", "blink_count_full", "blink_count_micro"]

    def primary_frame(eye_rows: pd.DataFrame, cond_rows: pd.DataFrame) -> pd.DataFrame:
        """Camera-on rows with at least one blink, and the binomial response. Shared by the
        confirmatory fit and the sensitivity refit so the two differ in their rows only."""
        ea = eye_rows[truthy(eye_rows["camera_active"])].merge(cond_rows, on=["participant_id", "condition_id"])
        # fps_adequate_for_ratio is deliberately NOT in the dropna subset: a row missing the
        # flag must reach the sensitivity block and be counted there, not vanish from the
        # primary fit for want of a QC column.
        prim = ea.dropna(subset=counts + ["polarity", "ambient_illumination_level"]).copy()
        prim["n_blinks"] = prim[counts].sum(axis=1)
        prim = prim[prim["n_blinks"] > 0].copy()
        prim["p_incomplete"] = prim["blink_count_incomplete"] / prim["n_blinks"]
        return prim

    # C(color_name, Sum), NOT C(color_name). With treatment-coded colour inside the interaction, the
    # polarity_c coefficient is the polarity effect at the REFERENCE colour (achromatic) — the anchor
    # contrast — not the average polarity effect that the R primary and ANALYSIS_PLAN.md §2 test.
    # polarity_c being +/-0.5 does not make it an average effect; that needs the OTHER factor
    # sum-coded too, which is what the R template's contr.sum(5) does. On a simulated N=40 cohort the
    # two codings gave -0.497 (achromatic only) and -0.257 (average), so the "cross-check" was
    # comparing two different estimands.
    primary_formula = f"p_incomplete ~ polarity_c * C(color_name, Sum){ilx} + position_c{rep_t}"

    def fit_primary(prim: pd.DataFrame):
        return smf.gee(primary_formula, groups="participant_id", data=prim,
                       family=sm.families.Binomial(), weights=prim["n_blinks"]).fit()

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
        if all(c in eye_active.columns for c in counts):
            prim = primary_frame(eye, cond)
            if len(prim):
                m = fit_primary(prim)
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
                            m_ok = fit_primary(ok)
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

                # --- the SENSITIVITY SET (ANALYSIS_PLAN.md §1), as in the R template ------------
                # The same model on the confirmatory rows PLUS the finished runs of participants
                # excluded ONLY for an incomplete condition set; built by the same functions from the
                # untrimmed tables, so the two fits differ in their rows and nothing else.
                n_extra = len(sens_ids - keep_ids)
                if n_extra == 0:
                    print("\n[sensitivity set] identical to the confirmatory set here (no participant was "
                          "excluded only for an incomplete condition set), so there is nothing to refit.")
                else:
                    cond_s = build_cond(by_condition(conditions_all, sens_ids), wide_all,
                                        by_folder(participant_all, sens_folders),
                                        by_folder(session_info_all, sens_folders))
                    prim_s = primary_frame(by_condition(eye_all, sens_ids), cond_s)
                    m_s = fit_primary(prim_s)
                    print(f"\n=== PRIMARY refit on the SENSITIVITY SET ({n_extra} extra finished run(s) of "
                          "incomplete participants; ANALYSIS_PLAN.md §1) ===")
                    print(f"polarity_c: confirmatory {m.params['polarity_c']:.4f} (SE {m.bse['polarity_c']:.4f}, "
                          f"n {int(m.nobs)}) | sensitivity {m_s.params['polarity_c']:.4f} "
                          f"(SE {m_s.bse['polarity_c']:.4f}, n {int(m_s.nobs)})")
                    print(m_s.summary())

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
