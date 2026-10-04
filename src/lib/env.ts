/**
 * Build-time provenance. These globals are injected by Vite (`define`) and Vitest config.
 * Stamped into every session record + export so any dataset can be traced to a build.
 */
declare global {
  // eslint-disable-next-line no-var
  var __APP_VERSION__: string;
  // eslint-disable-next-line no-var
  var __GIT_HASH__: string;
  // eslint-disable-next-line no-var
  var __BUILD_TIME__: string;
}

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
export const GIT_HASH: string = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : 'unknown';
export const BUILD_TIME: string = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "4 Oct 2026 09:33 UTC" from an ISO timestamp, or null if it is not one.
 *
 * In UTC, not the tablet's zone, so the same build reads the same on every device and matches the
 * deployment log and `build_time` in 01_session_info.csv character for character.
 */
export function formatBuildTime(iso: string): string | null {
  const t = Date.parse(iso);
  if (!iso || !Number.isFinite(t)) return null;
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

/**
 * Which build this is, in one line: "VisuLab 2.2.0 · built 4 Oct 2026 09:33 UTC · e05d3c4".
 *
 * WHY THE BUILD TIME IS IN IT. The investigator reported that "the PWA versions keep updating, the
 * version remains the same" — and on screen it did: the only stamp was `v2.1.0 · <hash>`, and
 * package.json's version had been 2.1.0 since the first commit of this source tree. The hash changed,
 * but seven hex characters do not read as a version to anyone, and nothing on the tablet said when its
 * build was made. The build time changes on EVERY deployment and needs no git history (the CI checkout
 * is shallow; `git rev-parse` of its one commit is all the hash needs). The version number is bumped
 * by hand when a round changes what a participant sees or what the export means.
 */
export function buildIdentity(
  version = APP_VERSION, builtAt = BUILD_TIME, hash = GIT_HASH,
): string {
  const when = formatBuildTime(builtAt);
  return [`VisuLab ${version}`, when ? `built ${when}` : 'build time unknown', hash].join(' · ');
}

export {};
