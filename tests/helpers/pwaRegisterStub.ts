/**
 * Stand-in for vite-plugin-pwa's `virtual:pwa-register`, which exists only inside a Vite build.
 *
 * Unit tests that render a screen showing the build (components/BuildInfo.tsx — the landing page,
 * the session manager, pre-flight) reach src/lib/swUpdate.ts, whose dynamic import of the virtual
 * module Vitest's import analysis cannot resolve. Aliased in vitest.config.ts. It registers nothing
 * and never reports a waiting build, which is what a page with no service worker sees.
 */
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => {};
}
