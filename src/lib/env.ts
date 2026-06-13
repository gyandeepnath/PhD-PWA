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

export {};
