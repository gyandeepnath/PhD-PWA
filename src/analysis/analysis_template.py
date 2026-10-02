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

  - A GEE takes ONE clustering level, the participant, so passage enters every model here as a
    FIXED effect, C(passage_id), where the R template carries a random intercept. This header used
    to say passage was not fitted here at all, which conflated the two: a passage random effect
    cannot be fitted in a GEE, a passage fixed effect can, and passage is not balanced against
    polarity, so leaving it out lets passage difficulty load onto the polarity contrast.
  - `mixedlm` fits a random intercept only. Where the plan's maximal structure carries a random
    slope, this file is at the plan's first reduction from the start.

Every GEE uses statsmodels' bias-reduced sandwich covariance: the plain robust one is too small
with few participants (see GEE_COV).

Run after exporting the CSV bundle.

    pip install pandas numpy statsmodels scipy

Set DATA_DIR to a folder holding the per-sitting export folders AND the pooled analysis export
(its analysis_join_report.csv is the verdict on who may be analysed); see the R template's header.
"""
from __future__ import annotations
import os
import sys
import numpy as np
import pandas as pd
import statsmodels.api as sm
import glob
import statsmodels.formula.api as smf

# Point DATA_DIR at a folder containing one exported folder per sitting plus the pooled export.
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
            "exporter's join check, not by this file. Take the pooled export (Dashboard -> 'Download "
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

    # WHAT THE CONFIRMATORY SET CAN SUPPORT, checked before any model — the R template's guards,
    # with the same messages. One participant used to fit "successfully" here with a polarity
    # standard error of 6e-16 and z = 3.6e14; one polarity raised a bare LinAlgError.
    n_participants = conditions["participant_id"].nunique()
    if n_participants < 2:
        sys.exit(f"[TOO FEW PARTICIPANTS] the confirmatory set holds {n_participants} participant(s). A "
                 "cluster-robust standard error needs several clusters, and a population claim many more. "
                 "See the exclusion counts above for who was left out and why.")
    if conditions["polarity"].nunique() < 2:
        sys.exit(f"[ONE POLARITY] every confirmatory condition-run has polarity "
                 f"'{', '.join(map(str, conditions['polarity'].dropna().unique()))}'. The study's question is "
                 "the CONTRAST between polarities, which this data cannot estimate.")
    # ANALYST DEFAULT, as in the R template (SMALL_N_WARN). Below it every standard error rests on few
    # clusters; the GEEs below use a small-sample correction, but the warning stands.
    SMALL_N_WARN = 20
    if n_participants < SMALL_N_WARN:
        print(f"\n[SMALL N] {n_participants} participants in the confirmatory set (fewer than {SMALL_N_WARN}, "
              "an ANALYST DEFAULT).\n          Standard errors and p-values rest on few clusters; treat every "
              "inferential result below as provisional.")

    # ENGAGEMENT: counted, retained, and a sensitivity on the PRIMARY only. This defaulted to True and
    # dropped every "bad" run from EVERY model, uncounted. The flag is built from comprehension,
    # reading-skim and false-alarm signals — outcomes modelled below — so filtering on it selects on
    # the dependent variable, and synopsis §3.9 puts the exclusion in the SENSITIVITY analyses. See
    # the R template's DROP_DISENGAGED. True removes "bad" runs from the OCULAR models only.
    DROP_DISENGAGED = False  # ANALYST DEFAULT

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

    def report_n(m, data: pd.DataFrame, label: str) -> None:
        """Rows used of rows given, for every model. patsy drops a row with a missing value in any
        term without a word; on a dataset with mostly-missing frame rates the R primary fell from 120
        rows to 23 that way and printed nothing to say so."""
        used = int(m.nobs)
        gone = len(data) - used
        print(f"[n] {label}: {used} of {len(data)} rows used"
              + (f" — {gone} dropped for a missing value in a model term" if gone > 0 else ""))

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

    # PASSAGE, IN EVERY MODEL, as a FIXED effect. Passage is not balanced against polarity (see the R
    # template's re_passage: at N = 130 passages 2-4 are read 80:50 under positive polarity), so a
    # model without it lets passage difficulty load onto the polarity contrast — and no model in this
    # file carried it. The header used to say passage "is not fitted here" because a GEE takes one
    # clustering level; that is true of a passage RANDOM effect, and irrelevant to a fixed one, which
    # fits in every model below. Ten levels, nine parameters: affordable at any N this study reaches.
    pas = " + C(passage_id)" if cond["passage_id"].nunique() > 1 else ""

    n_bad = int(cond["engagement_flag"].eq("bad").sum())
    print(f"\n[engagement] {n_bad} of {len(cond)} confirmatory condition-runs are flagged 'bad'. "
          + ("DROP_DISENGAGED is True: they are removed from the OCULAR models only." if DROP_DISENGAGED
             else "RETAINED in every model; the primary is refitted without them as a labelled sensitivity."))

    # SMALL-SAMPLE STANDARD ERRORS FOR EVERY GEE. The robust sandwich estimator is biased downward when
    # clusters are few — on 12 participants the bias-reduced SE of the primary was 0.115 against a
    # robust 0.078, and on 3 participants 2.6 against 0.47 — and this file printed p < 0.001 from two
    # clusters. statsmodels' cov_type="bias_reduced" corrects it, but in this version it raises a
    # broadcasting ValueError when weights= is given, so the primary is fitted on one row per BLINK
    # (identical point estimates to the count-weighted fit; verified) rather than one row per
    # condition-run with the blink count as a weight.
    GEE_COV = "bias_reduced"

    def cluster_note(m, label: str) -> None:
        """A cluster-robust covariance is a sum of one term per cluster, so its rank is at most the
        number of clusters. With no more participants than parameters it is singular, and the
        standard errors it yields are not interpretable — on two participants the primary printed
        SE nan, on three a refit printed SE 9e7. Said beside the model, not left to be noticed."""
        n_clusters = len(np.unique(m.model.groups))
        if n_clusters <= len(m.params):
            print(f"[SE CAUTION] {label}: {n_clusters} participants (clusters) for {len(m.params)} parameters. "
                  "The cluster-robust covariance cannot be full rank, so these standard errors and tests are "
                  "not interpretable; read the coefficients only.")

    # ===========================================================================================
    # BEHAVIOURAL AND QUESTIONNAIRE OUTCOMES — none of them needs the camera, and none is fitted
    # inside the ocular section, so a dataset with every camera off still produces all of them.
    # ===========================================================================================

    # --- Reaction time -----------------------------------------------------------------
    rt = rt_summary.merge(cond, on=["participant_id", "condition_id"]).dropna(
        subset=["mean_rt_hits_ms"]
    )
    m_rt = smf.mixedlm(
        "mean_rt_hits_ms ~ log_contrast + polarity_c + position_c" + si + pas,
        rt,
        groups=rt["participant_id"],
    ).fit()
    print("=== RT mixed model ===")
    print(m_rt.summary())
    report_n(m_rt, rt, "RT")

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
    n_fat_rows = len(fat)
    fat = fat.dropna(subset=[fat_dv])
    m_fat = smf.mixedlm(
        f"{fat_dv} ~ log_contrast + polarity_c + position_c" + si + pas,
        fat,
        groups=fat["participant_id"],
    ).fit()
    print(f"\n=== Fatigue mixed model ({fat_dv}) ===")
    print(m_fat.summary())
    print(f"[n] fatigue: {int(m_fat.nobs)} of {n_fat_rows} post-condition ratings used")

    # --- Comprehension (logistic; GEE as a mixed-logit stand-in) -----------------------
    # passage_id from the condition frame: 04_comprehension.csv carries its own copy, and the merge
    # would otherwise suffix both.
    comp = comprehension.drop(columns=["passage_id"], errors="ignore").merge(cond, on=["participant_id", "condition_id"])
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
        # groups=condition_id, which the code has never used.) The passage fixed effect carries
        # passage difficulty; the R template adds an item intercept, which here would alias with
        # question_kind.
        f"is_correct ~ log_contrast + polarity_c{ilx} + C(question_kind)"
        " + position_c" + si + pas,
        groups="participant_id",
        data=comp,
        family=sm.families.Binomial(),
    ).fit(cov_type=GEE_COV)
    print("\n=== Comprehension GEE (logistic) ===")
    print(m_comp.summary())
    report_n(m_comp, comp, "comprehension")
    cluster_note(m_comp, "comprehension")

    # --- d-prime aggregated across conditions (per-condition d' is unstable) -----------
    dprime = rt_summary.groupby("participant_id").agg(
        mean_dprime=("d_prime", "mean"),
        any_unstable=("d_prime_unstable", "any"),
    )
    print("\n=== Aggregated d' per participant ===")
    print(dprime)

    # CVS-Q change, per SITTING. Pivoting on participant_id alone silently averaged the two sittings
    # (pivot_table defaults to aggfunc="mean"), which destroyed the illumination contrast that is
    # the entire reason for administering it twice. 13_cvsq.csv now carries session_index.
    #
    # NOTE: baseline and close use DIFFERENT recall frames (see the `frame` column and
    # docs/LITERATURE_VALIDATION.md). This change score is exploratory.
    #
    # One row per stage per sitting is assumed, and the app's integrity audit (one_cvsq_per_stage)
    # exists because it can fail. aggfunc="first" used to resolve a duplicate SILENTLY; the first row
    # is still kept, and the duplicate is now named — as in the R template, which crashed on it.
    dupes = cvsq.groupby(["participant_id", "sitting_folder", "stage"]).size()
    dupes = dupes[dupes > 1]
    if len(dupes):
        pid, _, stage = dupes.index[0]
        print(f"\n[cvsq] {len(dupes)} sitting x stage combination(s) carry more than one CVS-Q row (e.g. {pid}, "
              f"stage {stage}); the FIRST row of each is kept. The per-sitting audit (one_cvsq_per_stage) "
              "should have blocked this sitting — check its 16_integrity_report.csv and whether the pooled "
              "export predates the data.")
    cvsq_wide = cvsq.pivot_table(
        index=["participant_id", "sitting_folder", "session_index", "ambient_illumination_level"],
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
            print(f"n = {len(ch)} sitting(s), mean change = {ch.mean():.2f}, sd = {ch.std():.2f}")

    # --- NASA-TLX: SESSION-level workload ------------------------------------------------
    # Never analysed here at all. Once per sitting, so it supports a session-level contrast only
    # (illumination, in archived two-level data); polarity and colour vary within a sitting and
    # cannot be given one end-of-session rating. Read like every other file and trimmed to the
    # confirmatory sittings; a duplicated rating is named and the first kept.
    try:
        tlx = by_folder(load("14_nasa_tlx.csv", with_folder=True), keep_folders)
    except FileNotFoundError:
        tlx = None
        print("\n[NASA-TLX] 14_nasa_tlx.csv not found under DATA_DIR — not summarised.")
    if tlx is not None:
        n_dup = int(tlx["sitting_folder"].duplicated().sum())
        if n_dup:
            print(f"\n[NASA-TLX] {n_dup} duplicated rating row(s); the FIRST per sitting is kept (the per-sitting "
                  "audit, one_tlx_per_session, should have blocked them).")
            tlx = tlx.drop_duplicates(subset="sitting_folder")
        if len(tlx) and tlx["ambient_illumination_level"].nunique() > 1:
            m_tlx = smf.mixedlm("raw_tlx ~ C(ambient_illumination_level)", tlx, groups=tlx["participant_id"]).fit()
            print("\n=== NASA-TLX raw score by illumination (session level) ===")
            print(m_tlx.summary())
        elif len(tlx):
            print("\n=== NASA-TLX raw score (session level, descriptive) ===")
            print("One rating per sitting and one illumination level: no contrast is estimable.")
            print(f"n = {len(tlx)} sitting(s), mean = {tlx['raw_tlx'].mean():.2f}, sd = {tlx['raw_tlx'].std():.2f}")
        else:
            print("\n[NASA-TLX not summarised: no confirmatory sitting has a rating]")

    # ===========================================================================================
    # OCULAR OUTCOMES — the PRIMARY, its sensitivities, and the ocular secondaries.
    # CVS markers: blink_rate (drops with screen concentration) + incomplete_blink_ratio (rises,
    # correlates with CVS symptoms — Portello, Rosenfield & Chu 2013). Drowsiness covariate: perclos_p80.
    # ===========================================================================================
    counts = ["blink_count_incomplete", "blink_count_full", "blink_count_micro"]

    def primary_frame(eye_rows: pd.DataFrame, cond_rows: pd.DataFrame) -> pd.DataFrame:
        """Camera-on rows with at least one blink, and the binomial response. Shared by the
        confirmatory fit and every sensitivity refit so they differ in their rows only."""
        ea = eye_rows[truthy(eye_rows["camera_active"])].merge(cond_rows, on=["participant_id", "condition_id"])
        if DROP_DISENGAGED:
            ea = ea[ea["engagement_flag"].ne("bad")]
        # fps_adequate_for_ratio is deliberately NOT in the dropna subset: a row missing the
        # flag must reach the sensitivity block and be counted there, not vanish from the
        # primary fit for want of a QC column.
        prim = ea.dropna(subset=counts + ["polarity", "ambient_illumination_level"]).copy()
        prim["n_blinks"] = prim[counts].sum(axis=1)
        prim = prim[prim["n_blinks"] > 0].reset_index(drop=True)
        prim["p_incomplete"] = prim["blink_count_incomplete"] / prim["n_blinks"]
        # Centred frame rate, as in the R primary (eff_fps_c): undersampling inflates the ratio, a
        # directional bias. It was absent here, so the two primaries differed by a covariate — and by
        # the rows a missing frame rate removes. The fit without it is reported beside the primary.
        prim["eff_fps_c"] = prim["effective_fps"] - prim["effective_fps"].mean()
        return prim

    # C(color_name, Sum), NOT C(color_name). With treatment-coded colour inside the interaction, the
    # polarity_c coefficient is the polarity effect at the REFERENCE colour (achromatic) — the anchor
    # contrast — not the average polarity effect that the R primary and ANALYSIS_PLAN.md §2 test.
    # polarity_c being +/-0.5 does not make it an average effect; that needs the OTHER factor
    # sum-coded too, which is what the R template's contr.sum(5) does. On a simulated N=40 cohort the
    # two codings gave -0.497 (achromatic only) and -0.257 (average), so the "cross-check" was
    # comparing two different estimands.
    primary_rhs = f"polarity_c * C(color_name, Sum){ilx} + position_c{rep_t}{pas} + eff_fps_c"

    def fit_primary(prim: pd.DataFrame, rhs: str = primary_rhs):
        """The binomial GEE on one row per BLINK (incomplete = 1), so the small-sample covariance can
        be used; see GEE_COV. The point estimates equal the count-weighted fit's. Runs missing a term
        are dropped HERE, by name, so the [n] line can count them — patsy would drop them silently."""
        if "eff_fps_c" in rhs:
            prim = prim[prim["eff_fps_c"].notna()].reset_index(drop=True)
        blinks = prim.loc[prim.index.repeat(prim["n_blinks"].astype(int))].copy()
        blinks["incomplete"] = (blinks.groupby(level=0).cumcount() < blinks["blink_count_incomplete"]).astype(int)
        fitted = smf.gee("incomplete ~ " + rhs, groups="participant_id", data=blinks.reset_index(drop=True),
                         family=sm.families.Binomial()).fit(cov_type=GEE_COV)
        fitted.runs_used = len(prim)
        return fitted

    def sens_line(label: str, m) -> None:
        print(f"  {label:<44} polarity_c {m.params['polarity_c']:.4f} (SE {m.bse['polarity_c']:.4f}), "
              f"{int(m.nobs)} blink rows")

    eye_active = eye[truthy(eye["camera_active"])].merge(cond, on=["participant_id", "condition_id"])
    prim = primary_frame(eye, cond) if all(c in eye.columns for c in counts) else pd.DataFrame()
    if len(prim) == 0:
        print("\n" + "#" * 64)
        print("[PRIMARY NOT ESTIMABLE] no camera-on condition-run with at least one blink in the "
              "confirmatory set\n— the camera was declined, off or lost for every run. The primary "
              "outcome and its sensitivity refits\ncannot be estimated from this data. The behavioural "
              "and questionnaire outcomes above stand.")
        print("#" * 64)
    else:
        # NOTE ON ESTIMANDS: GEE is a POPULATION-AVERAGED model. Its coefficients are systematically
        # attenuated relative to the subject-specific ones from the R template's glmer, so the two
        # files answer the same question on different scales and must not be compared coefficient
        # for coefficient. Where they must agree is in SIGN and in significance.
        m = fit_primary(prim)
        print("\n=== PRIMARY: incomplete-blink ratio, binomial GEE (population-averaged) ===")
        print(m.summary())
        gone = len(eye_active) - m.runs_used
        print(f"[n] primary: {m.runs_used} of {len(eye_active)} camera-on condition-runs used ({int(m.nobs)} blinks)"
              + (f" — {gone} dropped: no blink, or a missing count or frame rate" if gone > 0 else "")
              + f"; covariance {GEE_COV} over {prim['participant_id'].nunique()} participants")
        cluster_note(m, "primary")

        print("\n=== PRIMARY: sensitivity refits (polarity_c = positive minus negative, log-odds) ===")
        sens_line("confirmatory (the primary above)", m)
        # Without eff_fps_c: ANALYSIS_PLAN.md §2's formula, and the answer if frame rate is a
        # mediator of the polarity effect (polarity changes face illumination) rather than a nuisance.
        sens_line("without the eff_fps_c covariate (§2 formula)", fit_primary(prim, primary_rhs.replace(" + eff_fps_c", "")))

        # --- the pre-registered frame-rate sensitivity, which was ABSENT ------------------------
        #
        # docs/ANALYSIS_PLAN.md §5.2: "Below the frame-rate floor the sampled minimum EAR is
        # biased UPWARD, so incomplete_blink_ratio is inflated — a directional bias, not
        # symmetric noise. Do not drop these rows silently ... Run the model with and without
        # them and report both."
        #
        # This file did neither, until it was fixed: it pooled the flagged rows into the single fit
        # and never named fps_adequate_for_ratio. The R template has done this all along.
        if "fps_adequate_for_ratio" in prim.columns:
            # A missing flag is neither adequate nor inadequate: counted apart, and never used as a
            # mask (a nullable boolean with NA in it cannot select rows, and raised here).
            flag = prim["fps_adequate_for_ratio"].astype("boolean")
            adequate = flag.eq(True).fillna(False).to_numpy()
            n_low = int(flag.eq(False).fillna(False).sum())
            print(f"\nframe-rate adequacy on the primary-outcome rows: "
                  f"{int(adequate.sum())} adequate, {n_low} below the floor, {int(flag.isna().sum())} unknown")
            if n_low == 0:
                print("No rows below the frame-rate floor: the fit above is already the "
                      "adequate-only fit, and no sensitivity comparison is needed.")
            else:
                ok = prim[adequate].reset_index(drop=True)
                if len(ok) and ok["polarity_c"].nunique() > 1 and ok["participant_id"].nunique() > 1:
                    m_ok = fit_primary(ok)
                    print("\n=== PRIMARY refit, adequately-sampled conditions ONLY "
                          "(pre-registered sensitivity) ===")
                    print(m_ok.summary())
                    sens_line("fps_adequate_for_ratio conditions only", m_ok)
                    cluster_note(m_ok, "frame-rate refit")
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

        # --- engagement 'bad' runs out: a labelled sensitivity on the PRIMARY only ----------------
        if not DROP_DISENGAGED and n_bad > 0:
            sens_line("without engagement 'bad' runs", fit_primary(prim[prim["engagement_flag"].ne("bad")].reset_index(drop=True)))

        # --- the SENSITIVITY SET (ANALYSIS_PLAN.md §1), as in the R template --------------------
        # The same model on the confirmatory rows PLUS the finished runs of participants excluded
        # ONLY for an incomplete condition set; built by the same functions from the untrimmed
        # tables, so the two fits differ in their rows and nothing else.
        n_extra = len(sens_ids - keep_ids)
        if n_extra == 0:
            print("\n[sensitivity set] identical to the confirmatory set here (no participant was "
                  "excluded only for an incomplete condition set), so there is nothing to refit.")
        else:
            cond_s = build_cond(by_condition(conditions_all, sens_ids), wide_all,
                                by_folder(participant_all, sens_folders),
                                by_folder(session_info_all, sens_folders))
            m_s = fit_primary(primary_frame(by_condition(eye_all, sens_ids), cond_s))
            print(f"\n=== PRIMARY refit on the SENSITIVITY SET ({n_extra} extra finished run(s) of "
                  "incomplete participants; ANALYSIS_PLAN.md §1) ===")
            print(f"polarity_c: confirmatory {m.params['polarity_c']:.4f} (SE {m.bse['polarity_c']:.4f}, "
                  f"n {int(m.nobs)} blinks) | sensitivity {m_s.params['polarity_c']:.4f} "
                  f"(SE {m_s.bse['polarity_c']:.4f}, n {int(m_s.nobs)} blinks)")
            print(m_s.summary())

    # --- ocular secondaries ----------------------------------------------------------------
    # PERCLOS is modelled raw here; ANALYSIS_PLAN.md §4 asks for the logit, as the R template does.
    for dv in ["blink_rate", "perclos_p80"]:
        if dv in eye_active.columns and eye_active[dv].notna().any():
            sub = eye_active.dropna(subset=[dv, "ambient_illumination_level"])
            if DROP_DISENGAGED:
                sub = sub[sub["engagement_flag"].ne("bad")]
            if len(sub):
                mm = smf.mixedlm(
                    f"{dv} ~ position_c + polarity_c{il}{pas}",
                    sub, groups=sub["participant_id"],
                ).fit()
                print(f"\n=== {dv} mixed model ===")
                print(mm.summary())
                report_n(mm, sub, dv)


if __name__ == "__main__":
    main()
