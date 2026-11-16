VisuLab analysis scripts
========================

These are the scripts of the app build that wrote this archive. They read the data folder beside
them and write every table, figure and number the analysis plan asks for into a folder called
"results". You do not need to edit any of them.

WHAT YOU NEED (once)
  1. R (free): https://cran.r-project.org  -  install it with the default choices.
  2. RStudio Desktop (free): https://posit.co/download/rstudio-desktop/
  3. In RStudio, paste this line into the Console (bottom left) and press Enter:
       install.packages(c("tidyverse","lme4","lmerTest","emmeans","performance"))
     It takes a few minutes and needs the internet. Answer "Yes" if it asks about a personal library.

HOW TO RUN IT
  1. Unzip the archive (right-click, "Extract All"). Keep the folders as they are.
  2. In RStudio: File > Open File > analysis/run_analysis.R
  3. Press the "Source" button (top right of the script).
     If it asks for the data folder, choose the folder called "data" beside "analysis".
  4. Wait. Nothing is shown until it has finished: on 130 simulated sittings the analysis took about
     five minutes on a desktop computer; a laptop may take longer. It then prints where the results are.

WHAT YOU GET
  results/00_START_HERE.html   open this first: every table and figure, with what each one is for
                               and where it belongs in the thesis
  results/tables/              each table as a .csv file (opens in Excel or Word)
  results/figures/             each figure as a .png file at print quality
  results/analysis_log.txt     the complete printed output; keep it with any number you report

IF IT STOPS
  It prints a line in capitals inside square brackets, such as [NO VERDICT] or [DUPLICATED EXPORT],
  and says what to do. ANALYSIS_GUIDE.md in this folder explains every one of them.

THE FULL GUIDE
  analysis/ANALYSIS_GUIDE.md: from the tablet to the thesis, step by step.
