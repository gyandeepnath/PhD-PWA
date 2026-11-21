# =============================================================================================
# VisuLab: run the analysis and write the results (Round 97)
# =============================================================================================
#
# HOW TO RUN IT
#   In RStudio: open this file and press "Source" (top right of the script). If it cannot find the
#   data it asks for the folder.
#   From a terminal: Rscript run_analysis.R [DATA] [OUT]
#
#   DATA  where the exports are. If not given: the folder "data" beside this script's folder (the
#         app's "Download everything" archive unzips to analysis/ and data/ side by side). It may be
#         a folder of the app's .zip files, a folder of exported folders, or one .zip.
#   OUT   where the results go. If not given: a folder "results" beside DATA, never inside it.
#
# WHAT IT DOES
#   1. Runs analysis_template.R, beside this file, UNCHANGED, as its own R process, exactly as the
#      project's checks run it. What it prints is saved byte for byte in OUT/analysis_log.txt.
#   2. Reads the results the template computed (the template saves them when VISULAB_RESULTS_RDS
#      names a file) and writes them as numbered tables (OUT/tables, CSV), figures (OUT/figures,
#      PNG at 300 dpi), a map of where each item belongs in the thesis (OUT/thesis_map.csv), and a
#      report to open first (OUT/00_START_HERE.html).
#
# WHAT IT DOES NOT DO
#   It fits no model and changes no rule, threshold or exclusion: every estimate, interval and
#   p-value in its tables is the template's own. The descriptive tables (n, mean, SD, median,
#   quartiles) are computed here from the same rows the corresponding model was fitted on, and say
#   so. It writes no interpretation: titles, labels, what each item addresses and where it might go.
#   The wording of the thesis is its author's.
#
# Needs R and: install.packages(c("tidyverse","lme4","lmerTest","emmeans","performance"))
# Optional: officer and flextable, for a Word file of the tables (OUT/tables.docx).
# =============================================================================================

needed <- c("dplyr", "tidyr", "readr", "ggplot2", "lme4", "lmerTest", "emmeans", "performance")
missing_pkgs <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_pkgs)) {
  stop("These R packages are not installed: ", paste(missing_pkgs, collapse = ", "),
       ". Install them once with:\n  install.packages(c(\"tidyverse\",\"lme4\",\"lmerTest\",\"emmeans\",\"performance\"))",
       call. = FALSE)
}
suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(readr)
  library(ggplot2)
})

# --- Text encoding (Round 102) ---------------------------------------------------------------
# This file's own words carry UTF-8 characters (the section sign, the multiplication sign, dashes).
# Read under a locale that is not UTF-8 (a Linux shell with LANG unset is "POSIX"), R took their bytes
# as the locale's own and wrote the section sign as "<c2><a7>" in the thesis map and the report, 27
# times each (found by the review of Round 97). So the kit's character type is set to UTF-8 where it is
# not already. The template runs as its own process and is not affected.
if (!isTRUE(l10n_info()[["UTF-8"]])) {
  for (loc in c("C.UTF-8", "en_US.UTF-8", "en_GB.UTF-8", "UTF-8")) {
    if (nzchar(suppressWarnings(Sys.setlocale("LC_CTYPE", loc)))) break
  }
  if (!isTRUE(l10n_info()[["UTF-8"]])) message("[encoding] no UTF-8 locale on this computer: section signs may be written as <c2><a7>.")
}

# --- Where things are ------------------------------------------------------------------------
norm <- function(p) normalizePath(p, winslash = "/", mustWork = FALSE)
script_dir <- (function() {
  f <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))
  if (length(f) == 1 && nzchar(f)) return(dirname(norm(f)))
  for (fr in rev(sys.frames())) if (!is.null(fr$ofile)) return(dirname(norm(fr$ofile)))   # source()
  if (requireNamespace("rstudioapi", quietly = TRUE) && isTRUE(tryCatch(rstudioapi::isAvailable(), error = function(e) FALSE))) {
    p <- tryCatch(rstudioapi::getSourceEditorContext()$path, error = function(e) "")
    if (nzchar(p)) return(dirname(norm(p)))
  }
  norm(getwd())
})()
TEMPLATE <- file.path(script_dir, "analysis_template.R")
if (!file.exists(TEMPLATE)) {
  stop("analysis_template.R was not found beside run_analysis.R (", script_dir,
       "). Keep the files of the analysis folder together.", call. = FALSE)
}

args <- commandArgs(trailingOnly = TRUE)
choose_data <- function() {
  if (length(args) >= 1 && nzchar(args[1])) return(args[1])
  if (nzchar(Sys.getenv("VISULAB_DATA_DIR"))) return(Sys.getenv("VISULAB_DATA_DIR"))
  beside <- file.path(dirname(script_dir), "data")
  if (dir.exists(beside)) return(beside)
  if (interactive()) {
    cat("Choose the folder that holds the exports: the folder called \"data\", or a folder of the app's .zip files.\n")
    if (requireNamespace("rstudioapi", quietly = TRUE) && isTRUE(tryCatch(rstudioapi::isAvailable(), error = function(e) FALSE))) {
      d <- tryCatch(rstudioapi::selectDirectory("Folder with the exports"), error = function(e) NULL)
      if (!is.null(d) && nzchar(d)) return(d)
    }
    if (.Platform$OS.type == "windows") {
      d <- utils::choose.dir(caption = "Folder with the exports")
      if (!is.na(d)) return(d)
    }
    d <- readline("Type the path of that folder and press Enter: ")
    if (nzchar(d)) return(d)
  }
  stop("No data folder was given. Run it as: Rscript run_analysis.R <folder with the exports> [<results folder>]",
       call. = FALSE)
}
DATA <- norm(choose_data())
if (!file.exists(DATA)) stop("The data folder does not exist: ", DATA, call. = FALSE)
OUT <- norm(if (length(args) >= 2 && nzchar(args[2])) args[2]
            else if (nzchar(Sys.getenv("VISULAB_OUT_DIR"))) Sys.getenv("VISULAB_OUT_DIR")
            else file.path(dirname(DATA), "results"))
if (dir.exists(DATA) && startsWith(paste0(OUT, "/"), paste0(DATA, "/"))) {
  stop("The results folder (", OUT, ") must not be inside the data folder (", DATA,
       "): the analysis reads every file under the data folder.", call. = FALSE)
}
dir.create(file.path(OUT, "tables"), recursive = TRUE, showWarnings = FALSE)
dir.create(file.path(OUT, "figures"), recursive = TRUE, showWarnings = FALSE)
# A previous run's numbered outputs are replaced, never mixed with this run's. Only files this
# script writes are removed.
unlink(list.files(file.path(OUT, "tables"), pattern = "^T[0-9]{2}_.*\\.(csv|txt)$", full.names = TRUE))
unlink(list.files(file.path(OUT, "figures"), pattern = "^F[0-9]{2}_.*\\.png$", full.names = TRUE))
unlink(file.path(OUT, c("00_START_HERE.html", "thesis_map.csv", "analysis_log.txt", "tables.docx")))

# --- 1. The template, unchanged, as its own R process -----------------------------------------
LOG_MARKER <- "==== Printed by R to its error stream (messages, warnings and any error), in order ===="
rscript <- file.path(R.home("bin"), if (.Platform$OS.type == "windows") "Rscript.exe" else "Rscript")
out_tmp <- tempfile("template_stdout_")
err_tmp <- tempfile("template_stderr_")
rds <- tempfile("template_results_", fileext = ".rds")
saved_env <- Sys.getenv(c("VISULAB_DATA_DIR", "VISULAB_RESULTS_RDS"), unset = NA)
Sys.setenv(VISULAB_DATA_DIR = DATA, VISULAB_RESULTS_RDS = rds)
cat("Data:    ", DATA, "\nResults: ", OUT, "\n", sep = "")
cat("Running the analysis template. A study of about 130 sittings takes several minutes;\n")
cat("nothing is shown until it has finished.\n")
started <- Sys.time()
status <- system2(rscript, shQuote(TEMPLATE), stdout = out_tmp, stderr = err_tmp)
for (k in names(saved_env)) if (is.na(saved_env[[k]])) Sys.unsetenv(k) else do.call(Sys.setenv, setNames(list(saved_env[[k]]), k))
elapsed <- as.numeric(difftime(Sys.time(), started, units = "mins"))
stdout_lines <- if (file.exists(out_tmp)) readLines(out_tmp, warn = FALSE, encoding = "UTF-8") else character(0)
stderr_lines <- if (file.exists(err_tmp)) readLines(err_tmp, warn = FALSE, encoding = "UTF-8") else character(0)
writeLines(c(stdout_lines, "", LOG_MARKER, stderr_lines), file.path(OUT, "analysis_log.txt"), useBytes = TRUE)
cat(sprintf("The template finished in %.1f minutes (exit status %d).\n", elapsed, as.integer(status)))

stop_message <- NULL
if (!identical(as.integer(status), 0L)) {
  at <- grep("^Error", stderr_lines)
  stop_message <- if (length(at)) {
    m <- paste(trimws(stderr_lines[at[1]:length(stderr_lines)]), collapse = " ")
    m <- sub("^Error[^:]*: *", "", m)
    trimws(sub("Execution halted *$", "", m))
  } else sprintf("the template ended with exit status %d and printed no error message", as.integer(status))
}

# --- The report's helpers --------------------------------------------------------------------
esc <- function(x) {
  x <- gsub("&", "&amp;", as.character(x), fixed = TRUE)
  x <- gsub("<", "&lt;", x, fixed = TRUE)
  gsub(">", "&gt;", x, fixed = TRUE)
}
is_p_col <- function(name) grepl("(^p$|^p_|_p$|Pr\\(|p\\.value|^p value)", name)
show_cell <- function(x, name) {
  if (is.numeric(x)) {
    out <- if (is_p_col(name)) ifelse(is.na(x), "", format.pval(x, digits = 3, eps = 1e-4))
           else ifelse(is.na(x), "", ifelse(abs(x) >= 1000 | x == round(x), format(round(x, 1), trim = TRUE, big.mark = ""),
                                            formatC(x, digits = 3, format = "f")))
    return(out)
  }
  ifelse(is.na(x), "", as.character(x))
}
html_table <- function(d, max_rows = 200) {
  if (is.null(d) || !nrow(d)) return("<p class='none'>(no rows)</p>")
  shown <- head(d, max_rows)
  head_html <- paste0("<tr>", paste0("<th>", esc(names(shown)), "</th>", collapse = ""), "</tr>")
  cells <- vapply(names(shown), function(n) esc(show_cell(shown[[n]], n)), character(nrow(shown)))
  if (is.null(dim(cells))) cells <- matrix(cells, nrow = nrow(shown))
  body <- paste0("<tr>", apply(cells, 1, function(r) paste0("<td>", r, "</td>", collapse = "")), "</tr>", collapse = "\n")
  more <- if (nrow(d) > max_rows) sprintf("<p class='none'>%d more rows in the CSV file.</p>", nrow(d) - max_rows) else ""
  paste0("<div class='scroll'><table>", head_html, "\n", body, "</table></div>", more)
}

ITEMS <- list()
SKIPPED <- character(0)
RULES <- "see T17 (provenance)"
register <- function(id, kind, file, title, what, addresses, plan, place, n_part, n_rows, status, caption, df = NULL) {
  ITEMS[[length(ITEMS) + 1]] <<- list(id = id, kind = kind, file = file, title = title, what = what,
                                     addresses = addresses, plan = plan, place = place,
                                     n_participants = if (is.null(n_part)) NA else n_part,
                                     n_rows = if (is.null(n_rows)) NA else n_rows,
                                     status = status, caption = caption, df = df)
  if (!identical(status, "written")) SKIPPED <<- c(SKIPPED, sprintf("%s %s: %s", id, title, status))
}
slug <- function(x) gsub("[^a-z0-9]+", "_", tolower(x))

write_table <- function(id, title, df, what, addresses, plan, place, n_part = NULL, n_rows = NULL, why_not = NULL,
                        caption = "") {
  file <- file.path("tables", sprintf("%s_%s.csv", id, slug(title)))
  if (is.null(df) || !is.data.frame(df) || nrow(df) == 0) {
    reason <- if (is.null(why_not)) "the template produced no result for it in this run (see analysis_log.txt)" else why_not
    df <- data.frame(status = "not produced", reason = reason)
    write_csv(df, file.path(OUT, file), na = "")
    register(id, "table", file, title, what, addresses, plan, place, n_part, n_rows, paste("not produced:", reason), caption, df)
    return(invisible(NULL))
  }
  df <- as.data.frame(df, stringsAsFactors = FALSE)
  rownames(df) <- NULL
  write_csv(df, file.path(OUT, file), na = "")
  register(id, "table", file, title, what, addresses, plan, place, n_part, n_rows, "written", caption, df)
}

write_text <- function(id, title, lines, what, addresses, plan, place, n_part = NULL, n_rows = NULL, why_not = NULL,
                       caption = "") {
  file <- file.path("tables", sprintf("%s_%s.txt", id, slug(title)))
  if (is.null(lines) || !length(lines)) {
    reason <- if (is.null(why_not)) "the template printed no such block in this run" else why_not
    register(id, "text", NA_character_, title, what, addresses, plan, place, n_part, n_rows, paste("not produced:", reason), caption)
    return(invisible(NULL))
  }
  writeLines(lines, file.path(OUT, file), useBytes = TRUE)
  register(id, "text", file, title, what, addresses, plan, place, n_part, n_rows, "written", caption)
  ITEMS[[length(ITEMS)]]$text <<- lines
}

write_figure <- function(id, title, plot, what, addresses, plan, place, n_part = NULL, n_rows = NULL, why_not = NULL,
                         caption = "", height_mm = 110) {
  file <- file.path("figures", sprintf("%s_%s.png", id, slug(title)))
  if (is.null(plot)) {
    reason <- if (is.null(why_not)) "no data for it in this run" else why_not
    register(id, "figure", NA_character_, title, what, addresses, plan, place, n_part, n_rows, paste("not produced:", reason), caption)
    return(invisible(NULL))
  }
  ok <- tryCatch({
    ggsave(file.path(OUT, file), plot, width = 170, height = height_mm, units = "mm", dpi = 300, bg = "white")
    TRUE
  }, error = function(err) conditionMessage(err))
  if (!isTRUE(ok)) {
    register(id, "figure", NA_character_, title, what, addresses, plan, place, n_part, n_rows,
             paste("not produced: the figure could not be drawn:", ok), caption)
    return(invisible(NULL))
  }
  register(id, "figure", file, title, what, addresses, plan, place, n_part, n_rows, "written", caption)
}

theme_thesis <- theme_bw(base_size = 10) +
  theme(panel.grid.minor = element_blank(), legend.position = "bottom", strip.background = element_rect(fill = "grey92"))
POL_SHAPES <- c(positive = 16, negative = 1)
POL_LINES <- c(positive = "solid", negative = "dashed")
mean_ci <- function(x) {
  x <- x[is.finite(x)]
  n <- length(x)
  m <- if (n) mean(x) else NA_real_
  h <- if (n >= 2) qt(0.975, n - 1) * sd(x) / sqrt(n) else NA_real_
  c(n = n, mean = m, lcl = m - h, ucl = m + h)
}
describe <- function(d, value, outcome, units, rows_note) {
  if (is.null(d) || !nrow(d) || !(value %in% names(d))) return(NULL)
  d %>% mutate(.v = as.numeric(.data[[value]])) %>% filter(is.finite(.v)) %>%
    group_by(polarity, colour) %>%
    summarise(n_runs = n(), n_participants = n_distinct(participant_id), mean = mean(.v), sd = sd(.v),
              median = median(.v), q1 = unname(quantile(.v, 0.25)), q3 = unname(quantile(.v, 0.75)),
              min = min(.v), max = max(.v), .groups = "drop") %>%
    mutate(outcome = outcome, units = units, rows = rows_note, .before = 1) %>%
    mutate(polarity = as.character(polarity), colour = as.character(colour))
}

# --- 2. The results -------------------------------------------------------------------------
R_ <- if (file.exists(rds)) readRDS(rds) else NULL
# The template's own text (labels such as "§2") is UTF-8, as its file is; marked so, whatever the
# locale of the R process that parsed it.
as_utf8 <- function(x) {
  if (is.character(x)) { Encoding(x) <- "UTF-8"; return(x) }
  if (is.list(x)) x[] <- lapply(x, as_utf8)
  x
}
if (!is.null(R_)) R_ <- as_utf8(R_)
if (!is.null(R_)) {
  rl <- R_$rules
  # What was modelled, not only the current rule's name (Round 103): the rating format said vas-v2 on data
  # with no vas-v2 row, where the template modelled sl-v1.
  fmt_used <- if (length(rl$slider_used)) paste(sprintf("%s %s", names(rl$slider_used), rl$slider_used), collapse = ", ") else rl$slider
  RULES <- sprintf(paste0("blink rule %s; frame-rate gate %s (tier A from %s, tier B from %s face-solved frames/s, ",
                          "consistent within %s); reaction-time onset %s (rules present in the RT rows: %s); inter-blink interval %s; ",
                          "rating format modelled: %s"),
                   rl$blink, rl$fps_gate, rl$fps_adequate, rl$fps_reduced, rl$fps_band, rl$rt_timing,
                   if (length(rl$rt_timing_present)) paste(rl$rt_timing_present, collapse = ", ") else "unknown",
                   if (is.null(rl$ibi)) "unknown" else rl$ibi, fmt_used)
  runs <- R_$runs
  conf <- runs[runs$confirmatory, , drop = FALSE]
  sens <- runs[runs$sensitivity, , drop = FALSE]
  n_conf_p <- n_distinct(conf$participant_id)
  P <- R_$primary
  OBJ1 <- "Objective 1"

  # T01 participant flow
  rlong <- R_$reason_long
  flow <- bind_rows(
    tibble(step = "Read under the data folder", participants = n_distinct(R_$sittings$participant_id),
           sittings = nrow(R_$sittings), condition_runs = nrow(runs), detail = ""),
    tibble(step = "Withdrawn: every sitting of theirs is removed", participants = length(R_$withdrawn),
           sittings = NA_integer_, condition_runs = NA_integer_, detail = paste(R_$withdrawn, collapse = ", ")),
    if (nrow(rlong)) rlong %>% group_by(reason) %>%
      summarise(participants = n_distinct(participant_id), condition_runs = n(), .groups = "drop") %>%
      transmute(step = paste("Excluded, reason code:", reason), participants, sittings = NA_integer_, condition_runs,
                detail = "the exporter's verdict (analysis_join_report.csv) or the run unfinished; a run can carry several codes"),
    tibble(step = "CONFIRMATORY SET: every model", participants = n_conf_p, sittings = NA_integer_,
           condition_runs = nrow(conf), detail = "analysable, not withdrawn, first protocol pass, run finished"),
    tibble(step = "SENSITIVITY SET: one refit of the primary", participants = n_distinct(sens$participant_id),
           sittings = NA_integer_, condition_runs = nrow(sens),
           detail = "the confirmatory set plus the finished runs of participants excluded only for an incomplete condition set"),
    if (!is.null(P)) tibble(step = "Primary model fitted on", participants = P$n_participants, sittings = NA_integer_,
                           condition_runs = P$n_rows,
                           detail = "camera-on runs with at least one blink, frame-rate tiers A and B, the current blink rule"))
  write_table("T01", "Participant flow", flow,
              "How many participants, sittings and condition-runs were read, excluded (with the reason codes) and analysed.",
              "housekeeping", "ANALYSIS_PLAN.md §1", "Chapter 3 (participants) and Chapter 4, 4.1 Participants and data quality",
              n_conf_p, nrow(conf), caption = "Counts of participants and condition-runs at each step.")

  # T02 participant characteristics
  pp <- R_$participant %>% distinct(participant_id, .keep_all = TRUE)
  labels <- c(age = "Age (years)", gender = "Gender", daily_screen_hours = "Daily screen time (hours)",
              device_familiarity = "Familiarity with the device", lighting_habit = "Usual lighting when using screens",
              correction_type = "Refractive correction", cvd_clinical = "Formal colour-vision plates",
              caffeine_today = "Caffeine today", hours_since_sleep = "Hours awake at the sitting")
  chars <- bind_rows(lapply(intersect(names(labels), names(pp)), function(v) {
    x <- pp[[v]]
    if (is.numeric(x) && length(unique(na.omit(x))) > 2) {
      s <- x[is.finite(x)]
      tibble(characteristic = labels[[v]], level = "", n = length(s), percent = NA_real_,
             mean = if (length(s)) mean(s) else NA_real_, sd = if (length(s) > 1) sd(s) else NA_real_,
             median = if (length(s)) median(s) else NA_real_,
             q1 = if (length(s)) unname(quantile(s, 0.25)) else NA_real_, q3 = if (length(s)) unname(quantile(s, 0.75)) else NA_real_,
             min = if (length(s)) min(s) else NA_real_, max = if (length(s)) max(s) else NA_real_, missing = sum(!is.finite(x)))
    } else {
      x <- ifelse(is.na(x) | as.character(x) == "", "(not recorded)", as.character(x))
      tab <- sort(table(x), decreasing = TRUE)
      tibble(characteristic = labels[[v]], level = names(tab), n = as.integer(tab), percent = 100 * as.integer(tab) / length(x),
             mean = NA_real_, sd = NA_real_, median = NA_real_, q1 = NA_real_, q3 = NA_real_, min = NA_real_, max = NA_real_,
             missing = NA_integer_)
    }
  }))
  write_table("T02", "Participant characteristics", chars,
              "The confirmatory set's participants: age, gender and the vision and habit covariates recorded at profiling (11_participant.csv).",
              "housekeeping", "descriptive (no plan section; ANALYSIS_PLAN.md §1 defines the set)", "Chapter 4, 4.1 Participants and data quality",
              nrow(pp), nrow(pp), caption = "One row per participant of the confirmatory set; numbers are counts, percentages of participants, or summaries of a numeric characteristic.")

  # T03 data quality
  em <- R_$eye_metrics_all %>% filter(condition_id %in% conf$condition_id)
  cam_on <- em %>% filter(as.character(camera_active) %in% c("1", "TRUE", "true"))
  q <- bind_rows(
    tibble(check = "Condition-runs of the confirmatory set", value = nrow(conf), out_of = NA_integer_, note = ""),
    tibble(check = "... with the camera measuring", value = nrow(cam_on), out_of = nrow(conf),
           note = "camera_active in 07_eye_metrics.csv"),
    if (nrow(cam_on) && "fps_tier" %in% names(cam_on))
      cam_on %>% mutate(fps_tier = ifelse(is.na(fps_tier), "(no rate)", fps_tier)) %>% count(fps_tier) %>%
        transmute(check = paste0("... frame-rate tier ", fps_tier, " (gate ", rl$fps_gate, ")"), value = n, out_of = nrow(cam_on),
                  note = "tier C is out of the ocular models; tier B is in, and out of one pre-registered refit"),
    tibble(check = "Camera-on runs left out of the ocular models: tier C", value = rl$n_tier_c, out_of = NA_integer_, note = ""),
    tibble(check = paste("Camera-on runs left out of the ocular models: blink counts under a rule before", rl$blink),
           value = rl$n_blink_old, out_of = NA_integer_, note = "put back in one sensitivity refit (T14)"),
    tibble(check = "Camera-on reaction-time blocks timed under rt-t1", value = rl$n_rt_t1_camera, out_of = NA_integer_,
           note = "kept in the RT model; refitted without them (T18, when there are any)"),
    if (!is.null(rl$n_rt_t2)) tibble(check = "Reaction-time blocks timed under rt-t2", value = rl$n_rt_t2, out_of = NA_integer_,
                                     note = "kept in the RT model and its refit"),
    if (!is.null(rl$n_ibi_old)) tibble(check = paste("Camera-on runs with an inter-blink interval under a rule before", rl$ibi), value = rl$n_ibi_old,
                                       out_of = NA_integer_, note = "out of the interval model; put back in a refit (T18, when there are any)"),
    if (!is.null(rl$n_old_and_c) && rl$n_old_and_c > 0)
      tibble(check = "... of the earlier-blink-rule runs, also in tier C", value = rl$n_old_and_c, out_of = NA_integer_,
             note = "in neither the earlier-rule nor the every-tier refit; a refit of their own (T14)"),
    if (!is.null(rl$n_cal_r1)) tibble(check = "Sittings calibrated under cal-r1", value = rl$n_cal_r1, out_of = NA_integer_,
                                      note = "the primary is refitted without them when there are any (T14)"),
    # The verdict per run as the POOLED export gives it, when the data include it (Round 103): the
    # per-sitting 10_wide_summary.csv judges the frame rate's consistency against each sitting's median,
    # so with split sittings its counts differ from the template's own frame-rate count.
    if (!is.null(R_$verdict_long) && nrow(R_$verdict_long) && "ocular_reliability" %in% names(R_$verdict_long))
      R_$verdict_long %>% mutate(v = ifelse(is.na(ocular_reliability) | ocular_reliability == "", "(none)", ocular_reliability)) %>%
        count(v) %>% transmute(check = paste("Reliability verdict:", v), value = n, out_of = nrow(R_$verdict_long),
                               note = "ocular_reliability in analysis_long.csv (the pooled export), confirmatory runs")
    else if (!is.null(R_$wide) && "ocular_reliability" %in% names(R_$wide))
      R_$wide %>% mutate(v = ifelse(is.na(ocular_reliability) | ocular_reliability == "", "(none)", ocular_reliability)) %>%
        count(v) %>% transmute(check = paste("Reliability verdict:", v), value = n, out_of = nrow(R_$wide),
                               note = "ocular_reliability in 10_wide_summary.csv (no pooled export in the data): per sitting, so with split sittings the frame-rate consistency is judged against each sitting's median"),
    if ("engagement_flag" %in% names(R_$cond))
      R_$cond %>% mutate(v = ifelse(is.na(engagement_flag) | engagement_flag == "", "(none)", engagement_flag)) %>%
        count(v) %>% transmute(check = paste("Engagement flag:", v), value = n, out_of = nrow(R_$cond),
                               note = "kept in every model; the primary is refitted without 'bad' runs (T14)"),
    if (!is.null(P)) tibble(check = "Rows of the primary model", value = P$n_rows, out_of = nrow(cam_on), note = ""))
  write_table("T03", "Data quality", q,
              "How much of the confirmatory set the camera measured, the frame-rate tiers, the runs left out of the ocular models and why, reliability verdicts and engagement flags.",
              "housekeeping; Objective 4 (feasibility of the camera measures)", "ANALYSIS_PLAN.md §5",
              "Chapter 4, 4.1 Participants and data quality, and 4.6 Objective 4", n_conf_p, nrow(conf),
              caption = "Counts of condition-runs; out_of is the count each row is a part of.")

  # T04 descriptive statistics by condition
  comp_runs <- if (!is.null(R_$comp) && nrow(R_$comp)) R_$comp %>% group_by(participant_id, condition_id, polarity, colour) %>%
    summarise(proportion_correct = mean(as.numeric(is_correct), na.rm = TRUE), .groups = "drop") else NULL
  desc <- bind_rows(
    describe(R_$eye %>% mutate(ratio = blink_count_incomplete / blink_total), "ratio", "incomplete-blink ratio (primary)",
             "proportion of classified blinks", "rows of the primary model"),
    describe(R_$eye, "blink_rate", "blink rate", "blinks per minute", "rows of the primary model (the blink-rate model's rows)"),
    describe(R_$eye, "mean_inter_blink_interval_ms", "mean inter-blink interval", "ms", "rows of the primary model with an interval"),
    describe(R_$rt, "mean_rt_hits_ms", "reaction time, mean of hits", "ms", "rows of the RT model"),
    describe(R_$fat, R_$fat_response, paste0("fatigue (", R_$fat_response, ")"), "points (0-10 scale)", "rows of the fatigue model"),
    describe(comp_runs, "proportion_correct", "comprehension", "proportion correct per run", "runs of the comprehension model (items averaged per run)"),
    describe(R_$cond, "reading_speed_wpm", "reading speed", "words per minute", "every confirmatory run with a reading speed"))
  write_table("T04", "Descriptive statistics by condition", desc,
              "Each outcome in each of the ten display conditions (polarity x colour): number of runs and participants, mean, SD, median, quartiles, range.",
              paste(OBJ1, "(descriptive)"), "ANALYSIS_PLAN.md §4 and §7", "Chapter 4, 4.2 and 4.3 (descriptive statistics before the models)",
              n_conf_p, nrow(conf), caption = "Observed values, not model estimates. Each row says which rows it is computed from.")

  # T05-T08 primary
  if (!is.null(P)) {
    cf <- P$coefficients
    # The multiplier is named apart from the z column: inside tibble() a later column sees an earlier one
    # of the same name, and `z` here was the z VALUE, which made every interval [0, 2 x estimate]
    # (found by the review of Round 97).
    z975 <- qnorm(0.975)
    coefs <- tibble(term = cf$term, estimate_log_odds = cf[["Estimate"]], se = cf[["Std. Error"]], z = cf[["z value"]],
                    p = cf[["Pr(>|z|)"]], wald_ci_low = cf[["Estimate"]] - z975 * cf[["Std. Error"]],
                    wald_ci_high = cf[["Estimate"]] + z975 * cf[["Std. Error"]])
    lv <- P$colour_levels
    colour_key <- if (length(lv) >= 2) paste0(" colour1 to colour", length(lv) - 1, " are ", paste(lv[-length(lv)], collapse = ", "),
                                              "; ", lv[length(lv)], " is minus their sum.") else ""
    write_table("T05", "Primary model coefficients", coefs,
                paste0("The primary model's fixed effects as fitted: ", P$formula, ". Polarity is coded +0.5 positive and -0.5 negative, so polarity1 is ",
                       "positive minus negative; colour is sum-coded, so each colour term is a deviation from the mean of the five colours.", colour_key, " ",
                       "Random structure: ", P$structure, ". Convergence: ", paste(P$ladder, collapse = " | "), ". Dispersion: ", P$dispersion, "."),
                paste(OBJ1, "H1a"), "ANALYSIS_PLAN.md §2", "Chapter 4, 4.2 (the effect to report is in T06); the full table in an appendix",
                P$n_participants, P$n_rows,
                caption = "Log-odds scale, binomial mixed model; Wald 95% interval = estimate +/- 1.96 x SE.")
    # H1a for each model the plan reports until the investigator decides which is confirmatory (§2, §5
    # item 2; Round 102): T06 carried only the default, so a decision for another left the thesis
    # tables showing the default as if it had been decided.
    MODEL_DEFAULT <- "with eff_fps_c (the template's default)"
    h1_rows <- function(h, model) {
      if (is.null(h)) return(NULL)
      tibble(model = model, test = "H1a polarity",
             quantity = c("positive minus negative, log-odds", "odds ratio, positive / negative",
                          "predicted proportion incomplete, positive", "predicted proportion incomplete, negative",
                          "difference in predicted proportion, positive minus negative"),
             estimate = c(h$estimate, exp(h$estimate), h$p_pos, h$p_neg, h$diff),
             ci_low = c(h$lcl, exp(h$lcl), NA, NA, h$diff_lcl), ci_high = c(h$ucl, exp(h$ucl), NA, NA, h$diff_ucl),
             statistic = NA_real_, df = NA_real_, p = c(h$p, h$p, NA, NA, NA))
    }
    tests <- bind_rows(
      h1_rows(P$h1, MODEL_DEFAULT),
      if (!is.null(P$omnibus) && nrow(P$omnibus) >= 2)
        tibble(model = MODEL_DEFAULT, test = "H1b polarity x colour", quantity = "likelihood-ratio test of the interaction as a whole",
               estimate = NA_real_, ci_low = NA_real_, ci_high = NA_real_, statistic = P$omnibus$Chisq[2],
               df = P$omnibus$Df[2], p = P$omnibus[["Pr(>Chisq)"]][2]),
      h1_rows(P$h1_no_fps, "without eff_fps_c (the section 2 formula)"),
      h1_rows(P$h1_fps_bw, "frame rate as person mean + within-person deviation (section 5 item 2)"))
    if (nrow(tests) && !is.null(P$p_family_holm)) {
      on_default <- tests$model == MODEL_DEFAULT
      tests$p_holm_across_H1a_H1b <- ifelse(on_default & tests$test == "H1a polarity" & !is.na(tests$p), P$p_family_holm[["H1a"]],
                                            ifelse(on_default & tests$test == "H1b polarity x colour", P$p_family_holm[["H1b"]], NA_real_))
    }
    caution <- if (isTRUE(grepl("NOT CONVERGED", P$rung))) " CAUTION: no rung of the reduction ladder converged; these estimates come from a fit the optimizers do not agree on (analysis_log.txt, PRIMARY MODEL CONVERGENCE)." else ""
    # §5 item 2: a frame rate that differs between the polarities is said beside the primary (Round 103).
    d_fps_v <- if (is.null(rl$d_fps)) NA_real_ else as.numeric(rl$d_fps)
    if (is.finite(d_fps_v) && abs(d_fps_v) > as.numeric(rl$fps_band))
      caution <- paste0(caution, sprintf(" CAUTION: the frame rate differs between the polarities by %+.2f fps, over the pre-registered %s: read the consistent-only and fitted-minimum refits in T14 with H1.", d_fps_v, rl$fps_band))
    write_table("T06", "Primary hypothesis tests", tests,
                paste0("H1a: the polarity effect on the incomplete-blink ratio (log-odds, odds ratio and predicted proportions, with 95% intervals); H1b: whether that effect depends on colour (likelihood-ratio test). Section 2's rule decides H1 on the unadjusted 95% interval; the Holm column is the alternative section 4b leaves open. ",
                       "H1a is given for each model the plan reports until the investigator decides which is confirmatory (the model column): with eff_fps_c, without it, and with frame rate as each person's mean plus the within-person deviation; T05, T07, T08 and F01 are from the first. ",
                       "Random structure fitted: ", P$structure, ".", caution),
                paste(OBJ1, "H1a and H1b"), "ANALYSIS_PLAN.md §2 and §4b", "Chapter 4, 4.2 Objective 1: primary outcome",
                P$n_participants, P$n_rows,
                caption = "Proportions are for a typical participant and passage (random effects at zero), covariates at their means, averaged over the five colours.")
    cells <- P$cells
    if (!is.null(cells) && nrow(cells)) {
      cells <- tibble(polarity = as.character(cells$polarity), colour = as.character(cells$colour),
                      proportion_incomplete = cells$prob, se = cells$SE, ci_low = cells$asymp.LCL, ci_high = cells$asymp.UCL)
    }
    write_table("T07", "Primary model estimated proportions by condition", cells,
                "The model-estimated proportion of incomplete blinks in each of the ten conditions, with 95% intervals (emmeans on the primary model, as the template prints them under Objective 2's crossover test).",
                paste(OBJ1, "H1b; read with Objective 2"), "ANALYSIS_PLAN.md §2", "Chapter 4, 4.2 (and Figure F01)",
                P$n_participants, P$n_rows, caption = "Model estimates on the proportion scale, not observed means.")
    wc <- P$within_colour
    if (!is.null(wc) && nrow(wc)) {
      wc <- tibble(colour = as.character(wc$colour), contrast = as.character(wc$contrast), odds_ratio = wc$odds.ratio,
                   se = wc$SE, ci_low = wc$asymp.LCL, ci_high = wc$asymp.UCL, z = wc$z.ratio, p_holm_across_colours = wc$p.value)
    }
    write_table("T08", "Polarity effect within each colour", wc,
                "The polarity effect as an odds ratio inside each colour, its p-value Holm-adjusted across the five colours. It describes the shape of an interaction and is read only beside the H1b test in T06.",
                paste(OBJ1, "H1b"), "ANALYSIS_PLAN.md §2", "Chapter 4, 4.2", P$n_participants, P$n_rows,
                caption = "Odds ratio, positive / negative; p-values Holm-adjusted across the five colours, intervals Bonferroni-adjusted (emmeans adjusts intervals by Bonferroni).")
  } else {
    why <- if (isTRUE(R_$primary_failed)) "the primary model could not be fitted (see analysis_log.txt, PRIMARY NOT FITTED)" else "no camera-on rows for the primary model in this data"
    for (t in list(c("T05", "Primary model coefficients"), c("T06", "Primary hypothesis tests"),
                   c("T07", "Primary model estimated proportions by condition"), c("T08", "Polarity effect within each colour"))) {
      write_table(t[1], t[2], NULL, "", paste(OBJ1, "H1a/H1b"), "ANALYSIS_PLAN.md §2", "Chapter 4, 4.2", why_not = why)
    }
  }

  # T09-T11 objective 2, T12 anchor
  o2 <- R_$objective2
  write_table("T09", "Objective 2 nested model comparison", if (is.null(o2)) NULL else o2$comparison,
              "Three nested models of the primary outcome: contrast alone, contrast plus colour (residual hue), and the full polarity x colour model, compared by likelihood ratio (Chisq, Df, Pr(>Chisq)) and by AIC/BIC.",
              "Objective 2, H1χ (contrast and colour)", "ANALYSIS_PLAN.md §2 (Objective 2)", "Chapter 4, 4.4 Objective 2: contrast and colour",
              if (is.null(o2)) NULL else P$n_participants, if (is.null(o2)) NULL else o2$n_rows,
              why_not = "the Objective 2 models did not fit, or there were no camera-on rows (see analysis_log.txt)",
              caption = "Each row is one model; the test on a row compares it with the row above.")
  write_table("T10", "Objective 2 residual hue coefficients", if (is.null(o2)) NULL else o2$residual_hue,
              "The contrast-plus-colour model's coefficients: what colour adds beyond luminance contrast. Read with the collinearity in T11.",
              "Objective 2, H1χ", "ANALYSIS_PLAN.md §2 (Objective 2)", "Chapter 4, 4.4; the full table in an appendix",
              if (is.null(o2)) NULL else P$n_participants, if (is.null(o2)) NULL else o2$n_rows,
              why_not = "the Objective 2 models did not fit (see analysis_log.txt)", caption = "Log-odds scale.")
  write_table("T11", "Objective 2 collinearity", if (is.null(o2)) NULL else o2$vif,
              "How far log contrast and colour can be told apart in this design (variance inflation of the contrast-plus-colour model's terms).",
              "Objective 2, H1χ", "ANALYSIS_PLAN.md §2 (Objective 2)", "Chapter 4, 4.4, or an appendix",
              why_not = "not computed in this run (see analysis_log.txt, Objective 2)", caption = "VIF; the larger, the more the terms must be read jointly.")
  an <- R_$anchor
  write_table("T12", "Achromatic anchor polarity at matched contrast", if (is.null(an)) NULL else an$coefficients,
              "Black-on-white against white-on-black, both 21:1: the polarity effect with luminance contrast held constant.",
              paste(OBJ1, "H1a (contrast-matched)"), "ANALYSIS_PLAN.md §2", "Chapter 4, 4.2",
              if (is.null(an)) NULL else an$n_participants, if (is.null(an)) NULL else an$n_rows,
              why_not = "the anchor model was not fitted in this run (see analysis_log.txt)", caption = "Log-odds scale, binomial mixed model.")

  # T13 secondary outcomes
  fam <- if (length(R_$families)) bind_rows(R_$families) else NULL
  write_table("T13", "Secondary outcomes with multiplicity adjustment", fam,
              "Every secondary outcome's polarity effect (positive minus negative, or a ratio for odds ratios) with its 95% interval, p and the Holm adjustment within its family; the polarity x colour p where the model has that term. Each row carries the rows and participants its model rests on (the counts this map gives are the confirmatory set's; the comprehension rows are items, and the signal-detection rows cells of identical covariates, as the row's note says).",
              paste(OBJ1, "(secondary outcomes)"), "ANALYSIS_PLAN.md §4 and §4b", "Chapter 4, 4.3 Objective 1: secondary outcomes",
              n_conf_p, nrow(conf), caption = "Units are in the units column; intervals unadjusted; Holm within each family, separately for polarity and for the interaction.")

  # T14 sensitivity refits
  sr <- if (length(R_$sensitivity)) bind_rows(lapply(R_$sensitivity, as_tibble)) else NULL
  if (!is.null(sr)) sr <- sr %>% mutate(wald_ci_low = estimate - qnorm(0.975) * se, wald_ci_high = estimate + qnorm(0.975) * se)
  write_table("T14", "Sensitivity refits of the primary", sr,
              "The primary model's polarity estimate refitted on other rows or with one change at a time (frame-rate tiers, earlier blink rule, without the frame-rate covariate, frame rate as person mean plus within-person deviation, with an observation-level random effect, the beta-binomial, without participants measured on two trackers, without disengaged, restarted or interrupted runs, the sensitivity set, adjusted for PERCLOS, and so on), beside the confirmatory estimate in the first row. Each row gives the rows and participants it used (the counts this map gives are the confirmatory set's).",
              "Objective 1, H1a (robustness)", "ANALYSIS_PLAN.md §1, §2, §4, §4c and §5", "Chapter 4, 4.7 Sensitivity analyses",
              n_conf_p, if (is.null(P)) NULL else P$n_rows,
              caption = "Polarity, positive minus negative, log-odds; n_rows and n_participants are what each refit used; interval = estimate +/- 1.96 x SE. A row with no estimate was not refitted (its note says why: its rows would be the primary's own) or did not fit. The carryover refit is read against the row above it, on the same runs.")

  # T15 moderation
  md <- if (length(R_$moderators)) {
    m <- bind_rows(lapply(names(R_$moderators), function(k) as_tibble(c(list(moderator = k), R_$moderators[[k]]))))
    m$p_holm_across_moderators <- p.adjust(m$p, "holm")
    m
  } else NULL
  write_table("T15", "Moderation of the polarity effect", md,
              "Whether habitual screen time, usual lighting and device familiarity change the polarity effect (polarity x moderator, likelihood-ratio test, one moderator at a time), with the Holm adjustment the template prints. Exploratory; habitual display-mode preference is not recorded by the app, so it cannot be tested.",
              "Objective 3, H1ρ (moderation)", "Synopsis §3.9; ANALYSIS_PLAN.md §4",
              "Chapter 4, 4.5 Objective 3: moderation", n_conf_p, NULL,
              why_not = "no moderator could be tested in this run (see analysis_log.txt, MODERATION)",
              caption = "chisq with df degrees of freedom; participants is the sample size of a between-participant moderator.")

  # T16 questionnaires
  # One value per participant, AS THE TEMPLATE TAKES IT (its per_p and tlx_p): for a split sitting the
  # CVS-Q runs from the first sitting's baseline to the last sitting's close, and the NASA-TLX ratings
  # are averaged. The interval is the template's t interval over participants (t.test).
  cv <- R_$cvsq_per_participant
  tlx_one <- R_$tlx_per_participant
  qs <- bind_rows(
    if (!is.null(cv) && nrow(cv)) {
      one <- cv
      bind_rows(lapply(c("baseline", "session_end", "change"), function(v) {
        s <- mean_ci(one[[v]])
        tibble(measure = paste("CVS-Q total,", v), n_participants = s[["n"]], mean = s[["mean"]], ci_low = s[["lcl"]], ci_high = s[["ucl"]],
               sd = sd(one[[v]], na.rm = TRUE), median = median(one[[v]], na.rm = TRUE),
               q1 = unname(quantile(one[[v]], 0.25, na.rm = TRUE)), q3 = unname(quantile(one[[v]], 0.75, na.rm = TRUE)),
               note = if (v == "change") "close minus baseline; the two use different recall frames (see LITERATURE_VALIDATION.md)" else "")
      }))
    },
    if (!is.null(tlx_one) && nrow(tlx_one)) {
      one <- tlx_one
      s <- mean_ci(one$raw_tlx)
      tibble(measure = "NASA-TLX raw score (0-100)", n_participants = s[["n"]], mean = s[["mean"]], ci_low = s[["lcl"]],
             ci_high = s[["ucl"]], sd = sd(one$raw_tlx, na.rm = TRUE), median = median(one$raw_tlx, na.rm = TRUE),
             q1 = unname(quantile(one$raw_tlx, 0.25, na.rm = TRUE)), q3 = unname(quantile(one$raw_tlx, 0.75, na.rm = TRUE)),
             note = "one rating per sitting, at its close: it cannot be attributed to a display condition")
    })
  write_table("T16", "Questionnaires", qs,
              "The CVS-Q total at baseline and at the close and its change, and the NASA-TLX raw score, one value per participant of the confirmatory set, taken as the template takes them (a split sitting: CVS-Q from the first baseline to the last close; NASA-TLX ratings averaged).",
              paste(OBJ1, "(subjective outcomes); Objective 4 (subjective and objective indices)"), "ANALYSIS_PLAN.md §4",
              "Chapter 4, 4.3 Objective 1: secondary outcomes", n_conf_p, NULL,
              why_not = "the template did not summarise the questionnaires per participant in this run (more than one illumination level, or a stage missing): see analysis_log.txt",
              caption = "The template's own per-participant values; 95% interval of the mean across participants (t distribution), as the template prints it.")

  # T17 provenance
  pkg_ver <- function(p) tryCatch(as.character(utils::packageVersion(p)), error = function(e) "not installed")
  si <- R_$sittings
  prov <- bind_rows(
    tibble(item = "R", value = R.version.string),
    tibble(item = paste("package", needed), value = vapply(needed, pkg_ver, "")),
    # Round 103: the optional packages whose absence changes what runs (the beta-binomial, the ordinal
    # sensitivity, and the optimizers allFit compares when it judges the primary's convergence).
    tibble(item = paste("package", c("Matrix", "glmmTMB", "ordinal", "dfoptim", "optimx")),
           value = vapply(c("Matrix", "glmmTMB", "ordinal", "dfoptim", "optimx"), pkg_ver, "")),
    tibble(item = "analysis_template.R md5", value = unname(tools::md5sum(TEMPLATE))),
    tibble(item = "run_analysis.R md5", value = if (file.exists(file.path(script_dir, "run_analysis.R"))) unname(tools::md5sum(file.path(script_dir, "run_analysis.R"))) else ""),
    tibble(item = "rules", value = RULES),
    tibble(item = "builds that collected the confirmatory set (git_hash)", value = paste(R_$conf_builds, collapse = ", ")),
    if ("app_version" %in% names(si)) si %>% count(app_version) %>% transmute(item = paste("sittings collected by app version", app_version), value = as.character(n)),
    if ("condition_def_hash" %in% names(si)) si %>% count(condition_def_hash) %>% transmute(item = paste("sittings with condition table", condition_def_hash), value = as.character(n)),
    if ("schema_version" %in% names(si)) si %>% count(schema_version) %>% transmute(item = paste("sittings with schema version", schema_version), value = as.character(n)),
    if ("build_changed_mid_sitting" %in% names(si)) tibble(item = "sittings whose build changed mid-sitting",
                                                           value = as.character(sum(as.character(si$build_changed_mid_sitting) %in% c("TRUE", "true", "1")))),
    if ("git_hash" %in% names(si) && "participant_id" %in% names(si))
      tibble(item = "participants collected by more than one build", value = as.character(sum(tapply(si$git_hash, si$participant_id, function(x) length(unique(x))) > 1))),
    tibble(item = "sittings read", value = as.character(nrow(si))),
    tibble(item = "template run time (minutes)", value = sprintf("%.1f", elapsed)))
  write_table("T17", "Provenance", prov,
              "Which software produced these numbers: R and package versions, the checksums of the two analysis scripts, the rule versions, and the app builds that collected the data.",
              "housekeeping", "ANALYSIS_PLAN.md §7", "Appendix (software and versions); the methods chapter cites it",
              n_conf_p, NULL, caption = "Keep with every number reported from this run.")

  # T18 every secondary model, as fitted
  mods <- R_$models
  all_coefs <- if (length(mods)) bind_rows(lapply(names(mods), function(label) {
    m <- mods[[label]]
    co <- m$coefficients
    stat_col <- intersect(c("t value", "z value"), names(co))[1]
    p_col <- grep("^Pr\\(", names(co), value = TRUE)[1]
    tibble(model = label, term = co$term, estimate = co[["Estimate"]], se = co[["Std. Error"]],
           df = if ("df" %in% names(co)) co[["df"]] else NA_real_,
           statistic = if (is.na(stat_col)) NA_real_ else co[[stat_col]],
           statistic_type = if (is.na(stat_col)) NA_character_ else sub(" value", "", stat_col),
           p = if (is.na(p_col)) NA_real_ else co[[p_col]],
           n_rows = m$n_rows, n_participants = m$n_participants, formula = m$formula)
  })) else NULL
  write_table("T18", "Secondary models all coefficients", all_coefs,
              "Every model of a secondary outcome the template fitted, in full, with its sensitivity and descriptive refits (the polarity x serial-position test of section 3, the uncensored search time, the ordinal fatigue model, the earlier-rule refits): each term's estimate, standard error, test statistic and p, with the model's formula and N. Not here: the per-block d' and criterion cross-checks and the censoring test, which are in analysis_log.txt. This is where the contrast (log_contrast) and serial-position terms are. Estimates are in each model's own scale (ms, points, log-odds, probit units, log units). In the signal-detection model the terms that do not multiply sig are effects on MINUS the criterion; T13 gives the criterion effect with its sign, and the polarity effect of every outcome in reporting units.",
              paste(OBJ1, "(secondary outcomes); Objective 2 (the contrast terms)"), "ANALYSIS_PLAN.md §3, §4 and §4c",
              "Appendix (full model tables); Chapter 4, 4.3 and 4.4 cite single terms", n_conf_p, NULL,
              caption = "One row per model term. Polarity is coded +0.5 positive, -0.5 negative; colour terms, where present, are deviations from the mean of the five colours.")

  # T19 the template's own quality-check block, verbatim
  qc_at <- grep("^QUALITY CHECKS \\(ANALYSIS_PLAN.md", stdout_lines, useBytes = TRUE)[1]
  banners <- grep("^={20,}$", stdout_lines, useBytes = TRUE)
  qc_end <- if (is.na(qc_at)) NA_integer_ else banners[banners > qc_at + 1][1]
  write_text("T19", "Quality checks of plan section 5", if (is.na(qc_at) || is.na(qc_end)) NULL else stdout_lines[(qc_at - 1):qc_end],
             "The manipulation and quality checks the plan asks for before any inference, exactly as the template printed them: illumination constancy (5.1), the frame-rate gate and its polarity check (5.2), participant present and the descriptive gaze check (5.3), exposure completeness (5.4), careless responding (5.5) and completeness of sittings. Each line prints its own denominator: sittings for 5.1, camera-on runs for 5.2-5.4, every confirmatory run for 5.5 (the counts this map gives are the confirmatory set's).",
             "housekeeping; Objective 4 (feasibility of the camera measures)", "ANALYSIS_PLAN.md §5",
             "Chapter 4, 4.1 Participants and data quality; 4.6 Objective 4", n_conf_p, nrow(conf),
             caption = "Copied from analysis_log.txt without change.")

  # T20 an index of everything the template printed
  # Section headings: "=== ... ===" lines, and the title line between two banner lines. ASCII patterns,
  # matched bytewise, so the index does not depend on the locale R runs in.
  n_out <- length(stdout_lines)
  is_banner <- grepl("^={20,}$", stdout_lines, useBytes = TRUE)
  titled <- which(c(FALSE, is_banner[-n_out]) & c(is_banner[-1], FALSE) & !is_banner & nzchar(stdout_lines))
  heads <- sort(unique(c(grep("^=== .* ===$", stdout_lines, useBytes = TRUE), titled)))
  section_names <- gsub("^=== +| +===$|^ +| +$", "", stdout_lines[heads], useBytes = TRUE)
  Encoding(section_names) <- "UTF-8"   # bytewise matching returns unmarked strings; the log is UTF-8
  log_index <- if (length(heads)) tibble(line = heads, section = section_names) else NULL
  write_table("T20", "Index of the analysis log", log_index,
              "Every section the template printed, with its line number in analysis_log.txt. An analysis that has no table of its own above (for example the trial-level reaction-time model's ring terms, the visual-search censoring test, the cumulative-link sensitivity or the PERCLOS check) is found here.",
              "housekeeping", "ANALYSIS_PLAN.md §7", "not for the thesis: a finding aid", NULL, NULL,
              caption = "Line numbers refer to analysis_log.txt.")

  # --- Figures -------------------------------------------------------------------------------
  if (!is.null(P) && !is.null(P$cells) && nrow(P$cells)) {
    d <- as.data.frame(P$cells)
    d$polarity <- factor(as.character(d$polarity), levels = c("positive", "negative"))
    f1 <- ggplot(d, aes(colour, prob, shape = polarity, linetype = polarity, group = polarity)) +
      geom_point(position = position_dodge(0.4), size = 2.2) +
      geom_errorbar(aes(ymin = asymp.LCL, ymax = asymp.UCL), width = 0.15, position = position_dodge(0.4)) +
      scale_shape_manual(values = POL_SHAPES) + scale_linetype_manual(values = POL_LINES) +
      labs(x = "Text colour", y = "Proportion of blinks incomplete (model estimate)", shape = "Polarity", linetype = "Polarity") +
      theme_thesis
  } else f1 <- NULL
  write_figure("F01", "Primary outcome by condition", f1,
               "The model-estimated proportion of incomplete blinks in each condition, with 95% intervals (the numbers of T07).",
               paste(OBJ1, "H1a and H1b"), "ANALYSIS_PLAN.md §2", "Chapter 4, 4.2",
               if (is.null(P)) NULL else P$n_participants, if (is.null(P)) NULL else P$n_rows,
               why_not = "the primary model was not fitted in this run",
               caption = "Points: model-estimated proportion (random effects at zero, covariates at their means); bars: 95% interval.")

  per_participant_cells <- function(d, value, outcome) {
    if (is.null(d) || !nrow(d) || !(value %in% names(d))) return(NULL)
    d %>% mutate(.v = as.numeric(.data[[value]])) %>% filter(is.finite(.v)) %>%
      group_by(participant_id, polarity, colour) %>% summarise(.v = mean(.v), .groups = "drop") %>%
      group_by(polarity, colour) %>%
      summarise(n = n(), mean = mean(.v), lcl = mean(.v) - (if (n() > 1) qt(0.975, n() - 1) * sd(.v) / sqrt(n()) else NA_real_),
                ucl = mean(.v) + (if (n() > 1) qt(0.975, n() - 1) * sd(.v) / sqrt(n()) else NA_real_), .groups = "drop") %>%
      mutate(outcome = outcome, polarity = factor(as.character(polarity), levels = c("positive", "negative")))
  }
  f2d <- bind_rows(per_participant_cells(R_$rt, "mean_rt_hits_ms", "Reaction time, mean of hits (ms)"),
                   per_participant_cells(R_$fat, R_$fat_response, paste0("Fatigue, ", R_$fat_response, " (points)")),
                   per_participant_cells(comp_runs, "proportion_correct", "Comprehension, proportion correct"))
  f2 <- if (nrow(f2d)) ggplot(f2d, aes(colour, mean, shape = polarity, group = polarity)) +
    geom_point(position = position_dodge(0.4), size = 2) +
    geom_errorbar(aes(ymin = lcl, ymax = ucl), width = 0.15, position = position_dodge(0.4)) +
    facet_wrap(~ outcome, scales = "free_y", ncol = 1) + scale_shape_manual(values = POL_SHAPES) +
    labs(x = "Text colour", y = NULL, shape = "Polarity") + theme_thesis else NULL
  write_figure("F02", "Secondary outcomes by condition", f2,
               "Reaction time, fatigue and comprehension in each condition: the mean across participants with a 95% interval (descriptive).",
               paste(OBJ1, "(secondary outcomes)"), "ANALYSIS_PLAN.md §4", "Chapter 4, 4.3", n_conf_p, NULL,
               caption = "Observed means across participants and 95% intervals (t distribution); not model estimates.", height_mm = 200)

  f3 <- if (!is.null(R_$rt) && nrow(R_$rt)) {
    d <- R_$rt %>% mutate(polarity = factor(as.character(polarity), levels = c("positive", "negative")))
    ggplot(d, aes(mean_rt_hits_ms, linetype = polarity)) + geom_density(adjust = 1) +
      scale_linetype_manual(values = POL_LINES) +
      labs(x = "Mean reaction time of a run's hits (ms)", y = "Density", linetype = "Polarity") + theme_thesis
  } else NULL
  write_figure("F03", "Reaction time distribution", f3,
               "The distribution of runs' mean reaction times, by polarity (one value per condition-run of the RT model).",
               paste(OBJ1, "(secondary outcomes)"), "ANALYSIS_PLAN.md §4", "Chapter 4, 4.3, or an appendix",
               n_conf_p, if (is.null(R_$rt)) NULL else nrow(R_$rt), caption = "Kernel density of run-level means; trial-level reaction times are in 08_reaction_trials.csv.")

  pos <- function(d, value, outcome) {
    if (is.null(d) || !nrow(d) || !(value %in% names(d))) return(NULL)
    d %>% mutate(.v = as.numeric(.data[[value]])) %>% filter(is.finite(.v), !is.na(session_position)) %>%
      group_by(session_position) %>%
      summarise(n = n(), mean = mean(.v), lcl = mean(.v) - (if (n() > 1) qt(0.975, n() - 1) * sd(.v) / sqrt(n()) else NA_real_),
                ucl = mean(.v) + (if (n() > 1) qt(0.975, n() - 1) * sd(.v) / sqrt(n()) else NA_real_), .groups = "drop") %>%
      mutate(outcome = outcome)
  }
  f4d <- bind_rows(pos(R_$eye %>% mutate(ratio = blink_count_incomplete / blink_total), "ratio", "Incomplete-blink ratio"),
                   pos(R_$rt, "mean_rt_hits_ms", "Reaction time, mean of hits (ms)"),
                   pos(R_$fat, R_$fat_response, paste0("Fatigue, ", R_$fat_response, " (points)")))
  f4 <- if (nrow(f4d)) ggplot(f4d, aes(session_position, mean)) + geom_point() + geom_line() +
    geom_errorbar(aes(ymin = lcl, ymax = ucl), width = 0.2) + facet_wrap(~ outcome, scales = "free_y", ncol = 1) +
    scale_x_continuous(breaks = sort(unique(f4d$session_position))) +
    labs(x = "Serial position of the condition in the sitting", y = NULL) + theme_thesis else NULL
  write_figure("F04", "Outcomes over the sitting", f4,
               "Each outcome by the condition's serial position in the sitting (1 = first): the mean across runs with a 95% interval (descriptive). Position is counterbalanced against condition.",
               paste(OBJ1, "(fatigue over time)"), "ANALYSIS_PLAN.md §4", "Chapter 4, 4.3", n_conf_p, NULL,
               caption = "Observed means across condition-runs at each position and 95% intervals.", height_mm = 200)

  f5 <- if (!is.null(cv) && nrow(cv)) {
    one <- cv %>% select(participant_id, baseline, session_end) %>%
      pivot_longer(c(baseline, session_end), names_to = "when", values_to = "score") %>%
      mutate(when = factor(ifelse(when == "baseline", "Baseline", "Close of the sitting"), levels = c("Baseline", "Close of the sitting")))
    ggplot(one, aes(when, score, group = participant_id)) + geom_line(colour = "grey60") + geom_point(size = 1.4) +
      labs(x = NULL, y = "CVS-Q total score") + theme_thesis
  } else NULL
  write_figure("F05", "CVS-Q baseline and close", f5,
               "Each participant's CVS-Q total at baseline and at the close of the sitting (one line per participant).",
               paste(OBJ1, "(subjective outcomes)"), "ANALYSIS_PLAN.md §4", "Chapter 4, 4.3", n_conf_p, NULL,
               caption = "The two administrations use different recall frames (see LITERATURE_VALIDATION.md).")

  f6 <- if (!is.null(sr) && nrow(sr)) {
    d <- sr %>% filter(is.finite(estimate)) %>% mutate(label = factor(label, levels = rev(unique(label))))
    ggplot(d, aes(estimate, label)) + geom_vline(xintercept = 0, colour = "grey50") +
      geom_errorbarh(aes(xmin = wald_ci_low, xmax = wald_ci_high), height = 0.2) + geom_point() +
      labs(x = "Polarity effect, positive minus negative (log-odds)", y = NULL) + theme_thesis
  } else NULL
  write_figure("F06", "Sensitivity of the primary estimate", f6,
               "The polarity estimate of every sensitivity refit (T14), beside the confirmatory estimate, with estimate +/- 1.96 x SE.",
               "Objective 1, H1a (robustness)", "ANALYSIS_PLAN.md §2 and §5", "Chapter 4, 4.7 Sensitivity analyses", n_conf_p, NULL,
               caption = "Points: estimate; bars: Wald 95% interval.", height_mm = 140)

  # F07 the illumination control (§5 item 1: "Plot ambient_lux_measured across sittings: it should be a
  # tight cluster at 300 lux"; Round 103). Each confirmatory sitting's readings, coloured by the app's own
  # in-band verdict; the band itself is the app's (src/experiment/illumination.ts) and is not drawn here,
  # so no constant is copied.
  lx <- R_$lux
  f7 <- if (!is.null(lx) && nrow(lx) && any(c("lux_start", "lux_middle", "lux_end") %in% names(lx))) {
    long <- lx %>% mutate(sitting = factor(seq_len(n()))) %>%
      tidyr::pivot_longer(any_of(c("lux_start", "lux_middle", "lux_end")), names_to = "reading", values_to = "lux") %>%
      mutate(lux = suppressWarnings(as.numeric(lux)), reading = sub("^lux_", "", reading),
             in_band = ifelse(as.character(lux_logged_all_in_range) %in% c("TRUE", "true", "1"), "every logged reading in band", "a logged reading out of band")) %>%
      filter(is.finite(lux))
    if (!nrow(long)) NULL else
      # The axis starts at zero: a constancy check zoomed to its own spread makes 4 lux look like a range.
      ggplot(long, aes(sitting, lux, shape = reading, colour = in_band)) + geom_point(size = 2) + expand_limits(y = 0) +
        scale_colour_manual(values = c("every logged reading in band" = "grey25", "a logged reading out of band" = "#c0392b")) +
        labs(x = "Sitting (confirmatory set, in the order read)", y = "Ambient illuminance (lux)", colour = NULL, shape = "Reading") +
        theme_thesis + theme(axis.text.x = element_blank(), axis.ticks.x = element_blank())
  } else NULL
  write_figure("F07", "Illumination across sittings", f7,
               "Each confirmatory sitting's ambient-light readings (start, middle, end), coloured by the app's own verdict on whether every logged reading was in band. It should be a tight cluster: illuminance was held constant, not manipulated.",
               "housekeeping (the illumination control)", "ANALYSIS_PLAN.md §5 item 1", "Chapter 4, 4.1 Participants and data quality",
               n_conf_p, if (is.null(lx)) NULL else nrow(lx),
               why_not = "no lux readings in this data",
               caption = "The accepted band is the app's (src/experiment/illumination.ts) and is not drawn; lux_complete and how late an end reading was logged are in T19 (5.1).")

  register("--", "not computed", NA_character_, "Agreement of automated blink classification with manual annotation",
           "Objective 4's criterion validity against manual annotation of video.", "Objective 4", "ANALYSIS_PLAN.md §5",
           "Chapter 4, 4.6 Objective 4", NULL, NULL,
           "not computed by the analysis template: it needs the annotated video, which the template does not read", "")
}

# --- thesis_map.csv ---------------------------------------------------------------------------
tm <- if (length(ITEMS)) bind_rows(lapply(ITEMS, function(i) tibble(
  id = i$id, kind = i$kind, file = ifelse(is.na(i$file), "", i$file), title = i$title, what_it_shows = i$what,
  addresses = i$addresses, plan_section = i$plan, suggested_thesis_place = i$place,
  n_participants = suppressWarnings(as.numeric(i$n_participants)), n_rows = suppressWarnings(as.numeric(i$n_rows)),
  rule_versions = RULES, status = i$status))) else
  tibble(id = character(0), kind = character(0), file = character(0), title = character(0), what_it_shows = character(0),
         addresses = character(0), plan_section = character(0), suggested_thesis_place = character(0),
         n_participants = numeric(0), n_rows = numeric(0), rule_versions = character(0), status = character(0))
write_csv(tm, file.path(OUT, "thesis_map.csv"), na = "")

# --- Optional Word file of the tables ---------------------------------------------------------
docx_note <- "[SKIPPED: officer/flextable not installed] tables.docx"
if (length(ITEMS) && requireNamespace("officer", quietly = TRUE) && requireNamespace("flextable", quietly = TRUE)) {
  docx_note <- tryCatch({
    doc <- officer::read_docx()
    for (i in ITEMS) if (i$kind == "table" && !is.null(i$df)) {
      doc <- officer::body_add_par(doc, paste(i$id, i$title), style = "heading 2")
      doc <- flextable::body_add_flextable(doc, flextable::autofit(flextable::flextable(head(as.data.frame(i$df), 200))))
    }
    print(doc, target = file.path(OUT, "tables.docx"))
    "tables.docx written (the same tables as the CSV files)"
  }, error = function(err) paste("[SKIPPED: tables.docx could not be written]", conditionMessage(err)))
}
cat(docx_note, "\n")

# --- 00_START_HERE.html -----------------------------------------------------------------------
section <- function(i) {
  body <- if (i$kind == "table" && !is.null(i$df)) html_table(i$df)
          else if (i$kind == "figure" && identical(i$status, "written")) sprintf("<img src='%s' alt='%s'>", esc(i$file), esc(i$title))
          else if (i$kind == "text" && !is.null(i$text)) paste0("<pre>", paste(esc(i$text), collapse = "\n"), "</pre>")
          else ""
  sprintf(paste0("<section id='%s'><h2>%s %s</h2>",
                 "<p class='meta'><b>Addresses:</b> %s &middot; <b>Plan:</b> %s &middot; <b>Suggested place:</b> %s</p>",
                 "<p class='meta'><b>N:</b> %s participants, %s rows &middot; <b>File:</b> %s</p>",
                 "<p>%s</p>%s<p class='cap'>%s</p>%s</section>"),
          esc(i$id), esc(i$id), esc(i$title), esc(i$addresses), esc(i$plan), esc(i$place),
          ifelse(is.na(i$n_participants), "-", i$n_participants), ifelse(is.na(i$n_rows), "-", i$n_rows),
          ifelse(is.na(i$file), "-", esc(i$file)), esc(i$what), body, esc(i$caption),
          if (identical(i$status, "written")) "" else sprintf("<p class='skip'>%s</p>", esc(i$status)))
}
banner <- if (!is.null(stop_message)) sprintf(paste0(
  "<div class='stop'><h2>The analysis stopped</h2><p>%s</p>",
  "<p>The template's whole output is in <a href='analysis_log.txt'>analysis_log.txt</a>. ",
  "ANALYSIS_GUIDE.md, part 6, lists the messages the analysis can stop with.%s</p></div>"),
  esc(stop_message), if (length(ITEMS)) " The results below are what was computed before it stopped." else "") else ""
summary_html <- if (!is.null(R_)) sprintf(paste0(
  "<p>Read: <b>%d</b> sittings of <b>%d</b> participants. Confirmatory set: <b>%d</b> condition-runs of <b>%d</b> participants. ",
  "Sensitivity set: <b>%d</b> condition-runs of <b>%d</b> participants.</p><p>Rules: %s.</p>"),
  nrow(R_$sittings), n_distinct(R_$sittings$participant_id), nrow(R_$runs[R_$runs$confirmatory, ]),
  n_distinct(R_$runs$participant_id[R_$runs$confirmatory]), nrow(R_$runs[R_$runs$sensitivity, ]),
  n_distinct(R_$runs$participant_id[R_$runs$sensitivity]), esc(RULES)) else ""
skipped_html <- if (length(SKIPPED)) paste0("<div class='skiplist'><b>Not produced in this run:</b><ul>",
                                            paste0("<li>", esc(SKIPPED), "</li>", collapse = ""), "</ul></div>") else ""
toc <- if (length(ITEMS)) paste0("<ol class='toc'>", paste0(vapply(ITEMS, function(i)
  sprintf("<li><a href='#%s'>%s %s</a> <span class='where'>%s</span></li>", esc(i$id), esc(i$id), esc(i$title), esc(i$place)), ""),
  collapse = ""), "</ol>") else ""
html <- paste0(
  "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>VisuLab analysis results</title><style>",
  "body{font:15px/1.5 Georgia,serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#1a1a1a}",
  "h1{font-size:26px}h2{font-size:19px;margin-top:34px;border-top:1px solid #ccc;padding-top:14px}",
  "table{border-collapse:collapse;font:13px/1.35 Arial,sans-serif;margin:8px 0}th,td{border:1px solid #bbb;padding:3px 7px;text-align:left;vertical-align:top}",
  "th{background:#eee}.scroll{overflow-x:auto}.meta{font:13px Arial,sans-serif;color:#444;margin:2px 0}.cap{font-style:italic;color:#444}",
  ".stop{border:2px solid #a00;background:#fff3f3;padding:6px 16px}.skip{color:#a00;font:13px Arial,sans-serif}",
  ".skiplist{border:1px solid #c80;background:#fffaf0;padding:4px 16px;font:13px Arial,sans-serif}",
  ".none{color:#666;font:13px Arial,sans-serif}.where{color:#666;font:12px Arial,sans-serif}img{max-width:100%;border:1px solid #ddd}",
  "pre{font:12px/1.35 Consolas,Menlo,monospace;background:#f6f6f6;border:1px solid #ddd;padding:8px;overflow-x:auto}",
  "@media print{.scroll{overflow:visible}section{page-break-inside:avoid}}</style></head><body>",
  "<h1>VisuLab analysis results</h1>",
  "<p>Written by run_analysis.R from the output of analysis_template.R. Every estimate, interval and p-value is the template's own; ",
  "descriptive tables are computed from the rows each model was fitted on. This page gives numbers, labels and where each item ",
  "might go in the thesis; it gives no interpretation. The suggested places are suggestions.</p>",
  "<p>Data: ", esc(DATA), "<br>Full printed output of the template: <a href='analysis_log.txt'>analysis_log.txt</a> &middot; ",
  "Every item and its suggested place: <a href='thesis_map.csv'>thesis_map.csv</a> &middot; Tables: tables/ &middot; Figures: figures/</p>",
  banner, summary_html, skipped_html, if (nzchar(toc)) "<h2>Contents</h2>" else "", toc,
  paste(vapply(ITEMS, section, ""), collapse = "\n"),
  "<h2>Provenance</h2><p>R, package versions, the checksums of the two scripts, the rule versions and the builds that collected the data are in T17 and at the top of <a href='analysis_log.txt'>analysis_log.txt</a> (the PROVENANCE block). ",
  "Keep them with any number taken from this page. ", esc(docx_note), "</p></body></html>")
writeLines(html, file.path(OUT, "00_START_HERE.html"), useBytes = TRUE)

cat("\nResults are in ", OUT, "\n  open 00_START_HERE.html first\n", sep = "")
if (length(SKIPPED)) cat("  not produced in this run: ", length(SKIPPED), " item(s), listed at the top of that page\n", sep = "")
if (!is.null(stop_message)) {
  cat("\nTHE ANALYSIS STOPPED: ", stop_message, "\n", sep = "")
  if (interactive()) stop("the analysis stopped: ", stop_message, call. = FALSE) else quit(status = 1)
}
