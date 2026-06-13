/**
 * Simulation CLI: `npm run sim`.
 *
 * Generates a synthetic cohort, recovers the injected effects (a self-check that the analysis
 * pipeline works), and runs a Monte-Carlo power curve. Prints a human-readable report.
 */
import { generateCohort } from './participant';
import { GROUND_TRUTH as GT } from './effects';
import { cohortRows, ols, powerForN } from './analysis';

// Minimal Node CLI globals (this file runs via tsx, not in the browser bundle).
declare const process: { argv: string[] };


function fmt(n: number, d = 2): string {
  return n.toFixed(d);
}

function main(): void {
  const N = Number(process.argv[2] ?? 40);
  const seed = Number(process.argv[3] ?? 20260613);

  console.log('='.repeat(72));
  console.log(`VisuLab simulation — N=${N} synthetic participants (seed ${seed})`);
  console.log('='.repeat(72));

  const cohort = generateCohort(N, seed);
  const rows = cohortRows(cohort);
  console.log(`Condition rows with valid RT: ${rows.length} (of ${N * 8})\n`);

  // --- Effect recovery: RT model ---
  const rt = ols(['log_contrast', 'negative_polarity', 'session_position'], rows, 'mean_rt_hits_ms');
  console.log('RT (ms) ~ log_contrast + negative_polarity + session_position');
  console.log(`  R² = ${fmt(rt.rSquared, 3)}`);
  console.log(
    `  log_contrast        coef=${fmt(rt.terms.log_contrast.coef)}  (true ${GT.rt.beta_log_contrast})  t=${fmt(rt.terms.log_contrast.t)}`,
  );
  console.log(
    `  negative_polarity   coef=${fmt(rt.terms.negative_polarity.coef)}  (true ${GT.rt.beta_negative_polarity})  t=${fmt(rt.terms.negative_polarity.t)}`,
  );
  console.log(
    `  session_position    coef=${fmt(rt.terms.session_position.coef)}  (true ${GT.rt.beta_position})  t=${fmt(rt.terms.session_position.t)}`,
  );

  // --- Effect recovery: fatigue model ---
  const fatigueRows = cohort.flatMap((p) =>
    p.rows.map((r) => ({
      fatigue_mean: r.fatigue_mean,
      session_position: r.session_position,
      below_wcag_aa: r.below_wcag_aa,
    })),
  );
  const fat = ols(['session_position', 'below_wcag_aa'], fatigueRows, 'fatigue_mean');
  console.log('\nFatigue (0-10) ~ session_position + below_wcag_aa');
  console.log(
    `  session_position    coef=${fmt(fat.terms.session_position.coef)}  (true ${GT.fatigue.beta_position})  t=${fmt(fat.terms.session_position.t)}`,
  );
  console.log(
    `  below_wcag_aa       coef=${fmt(fat.terms.below_wcag_aa.coef)}  (true ${GT.fatigue.beta_below_aa})  t=${fmt(fat.terms.below_wcag_aa.t)}`,
  );

  // --- d' aggregation reduces SE (the 24-trial instability point) ---
  const meanPerCondSE =
    rows.reduce((s, r) => s + (r.d_prime_se as number), 0) / rows.length;
  console.log(`\nMean per-condition d' SE = ${fmt(meanPerCondSE, 3)} (flagged unstable if > 0.30)`);

  // --- Power curve for the log-contrast RT effect ---
  console.log('\nMonte-Carlo power for the log-contrast RT effect (α=0.05, 150 reps):');
  for (const n of [8, 16, 24, 32, 48]) {
    console.log(`  N=${String(n).padStart(3)}  power=${fmt(powerForN(n, 150, 7), 3)}`);
  }
  console.log('\nDone.');
}

main();
