/**
 * No university name or logo anywhere in the app (investigator's decision, Round 78).
 *
 * The participant and the operator see only the app's own plain VisuLab mark
 * (components/VisuLabLogo.tsx: "no institutional mark"). The thesis, the consent form and the ethics
 * paperwork carry the institution; the app does not. This keeps it that way: any screen text, page
 * title or install manifest naming a university fails here. If a name is ever wanted on a screen,
 * that is a protocol change for the investigator to decide, recorded in docs/PROTOCOL.md §2a.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const walk = (dir: string, ext: RegExp): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name === '__pycache__' ? [] : walk(p, ext);
  return ext.test(e.name) ? [p] : [];
});
const NAMES = /universit(y|ies)|\bAdtU\b|assam\s*down\s*town/i;

describe('no university name or logo in the app', () => {
  it('is in no source file, page, style sheet or install manifest the app ships', () => {
    const files = [
      ...walk(join(ROOT, 'src'), /\.(ts|tsx|css|html|json)$/),
      ...walk(join(ROOT, 'public'), /\.(css|html|json|webmanifest|svg)$/),
      join(ROOT, 'index.html'),
      join(ROOT, 'vite.config.ts'),
    ];
    expect(files.length).toBeGreaterThan(50);
    const hits = files.filter((f) => NAMES.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });

  it('shows only the app\'s own mark as a logo', () => {
    const logos = walk(join(ROOT, 'src'), /\.tsx$/).filter((f) => /Logo\.tsx$/.test(f)).map((f) => f.slice(ROOT.length + 1));
    expect(logos).toEqual(['src/components/VisuLabLogo.tsx']);
    expect(readFileSync(join(ROOT, 'src/components/VisuLabLogo.tsx'), 'utf8')).toMatch(/no institutional mark/);
  });
});
