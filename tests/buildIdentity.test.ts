/**
 * The build is named so a person can tell two deployments apart from the tablet's screen.
 *
 * The investigator reported that "the PWA versions keep updating, the version remains the same". The
 * on-screen stamp was `v2.1.0 · <hash>` and package.json had read 2.1.0 since the first commit, so
 * every deployment looked the same. The identity now carries the build time, which changes on every
 * build, and the version is bumped by hand for a round that changes the stimulus or the export.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIdentity, formatBuildTime } from '@/lib/env';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('buildIdentity', () => {
  it('names the version, the build time in UTC and the commit, in that order', () => {
    expect(buildIdentity('2.2.0', '2026-10-04T09:33:41.123Z', 'e05d3c4'))
      .toBe('VisuLab 2.2.0 · built 4 Oct 2026 09:33 UTC · e05d3c4');
  });

  it('two builds of the same version and commit differ by their time', () => {
    const a = buildIdentity('2.2.0', '2026-10-04T09:33:00Z', 'e05d3c4');
    const b = buildIdentity('2.2.0', '2026-10-05T14:02:00Z', 'e05d3c4');
    expect(a).not.toBe(b);
  });

  it('says the time is unknown rather than printing an invalid date', () => {
    expect(formatBuildTime('')).toBeNull();
    expect(formatBuildTime('test')).toBeNull();
    expect(buildIdentity('2.2.0', '', 'abc1234')).toBe('VisuLab 2.2.0 · build time unknown · abc1234');
  });

  it('pads the clock and does not shift the date into the tablet\'s zone', () => {
    expect(formatBuildTime('2026-01-09T03:07:00Z')).toBe('9 Jan 2026 03:07 UTC');
    expect(formatBuildTime('2026-12-31T23:59:59Z')).toBe('31 Dec 2026 23:59 UTC');
  });
});

describe('where the version and the build come from', () => {
  it('package.json is 2.2.0 — Round 74 changed the stimulus geometry', () => {
    const pkg = JSON.parse(src('package.json'));
    expect(pkg.version).toBe('2.2.0');
    const lock = JSON.parse(src('package-lock.json'));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('the version is read from package.json, not from an npm-only environment variable', () => {
    // npm_package_version is set only when the build runs through an npm script; `npx vite build`
    // stamped 0.0.0.
    const cfg = src('vite.config.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(cfg).not.toMatch(/npm_package_version/);
    expect(cfg).toMatch(/readFileSync\(resolve\(__dirname, 'package\.json'\)/);
    expect(cfg).toMatch(/__BUILD_TIME__: JSON\.stringify\(new Date\(\)\.toISOString\(\)\)/);
    // A checkout with no git metadata still has the commit in CI.
    expect(cfg).toMatch(/GITHUB_SHA/);
  });

  it('the identity is on every screen an operator starts from, and in the export', () => {
    expect(src('src/start/LandingPage.tsx')).toMatch(/<BuildInfo auto \/>/);
    expect(src('src/start/SessionManager.tsx')).toMatch(/<BuildInfo testId="manager-build" \/>/);
    expect(src('src/start/setupStages.tsx')).toMatch(/<BuildInfo testId="preflight-build" \/>/);
    expect(src('src/dashboard/Dashboard.tsx')).toMatch(/<BuildIdentity testId="dashboard-build"/);
    expect(src('src/storage/export.ts')).toMatch(/build_time: session\.provenance\.build_time/);
  });
});
