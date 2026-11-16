/**
 * The analysis scripts as the whole-tablet archive carries them (storage/exportArchive.ts, Round 97).
 *
 * The files themselves, read at build time, so the archive holds the scripts of the build that wrote
 * it: the analyst does not have to find the repository, and cannot run a template of another build
 * against this build's export. Imported only where the archive is built (the dashboard's export tab,
 * lazily), because the `?raw` imports need the bundler: nothing the Node scripts load may import this.
 */
import templateR from './analysis_template.R?raw';
import templatePy from './analysis_template.py?raw';
import runAnalysis from './run_analysis.R?raw';
import readMe from './READ_ME_FIRST.txt?raw';
import guide from '../../docs/ANALYSIS_GUIDE.md?raw';

export const ANALYSIS_KIT: { path: string; content: string }[] = [
  { path: 'READ_ME_FIRST.txt', content: readMe },
  { path: 'run_analysis.R', content: runAnalysis },
  { path: 'analysis_template.R', content: templateR },
  { path: 'analysis_template.py', content: templatePy },
  { path: 'ANALYSIS_GUIDE.md', content: guide },
];
