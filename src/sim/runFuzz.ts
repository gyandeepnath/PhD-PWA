/** Fuzz CLI: `npm run fuzz [iterations] [seed]`. Exits non-zero if any invariant/throw is found. */
import { runFuzz } from './fuzz';

declare const process: { argv: string[]; exit: (code: number) => void };

const iterations = Number(process.argv[2] ?? 50000);
const seed = Number(process.argv[3] ?? 1);

console.log(`Running fuzz: ${iterations} iterations (seed ${seed})…`);
const t0 = Date.now();
const failures = runFuzz(iterations, seed);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (failures.length === 0) {
  console.log(`✓ No failures across ${iterations} iterations in ${secs}s.`);
} else {
  console.log(`✗ ${failures.length} failures in ${secs}s:`);
  const byCheck = new Map<string, number>();
  for (const f of failures) byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + 1);
  for (const [check, n] of byCheck) console.log(`  ${check}: ${n}`);
  console.log('First 10:');
  for (const f of failures.slice(0, 10)) console.log(`  [${f.check} @${f.iteration}] ${f.detail}`);
  process.exit(1);
}
