/**
 * Every reason the screen can give for there being no offline copy of the app (Round 92, follows audit 86
 * P4, P9). lib/swUpdate.ts decides which applies; components/BuildInfo.tsx words the line.
 *
 * A closed set, not free text, so the status line can keep room for the longest wording from the start:
 * the line used to grow from one line to three when the state settled — eight seconds after start-up on a
 * server with no worker — and push down every control under it, on the landing page, the session manager
 * and pre-flight, while the operator might be reaching for one. The browser's own error text, which
 * varies, goes to the console instead. A module of its own, with nothing else in it, so a test that
 * replaces swUpdate wholesale still has the wordings.
 */
export const OFFLINE_NONE_REASONS = {
  noServiceWorkers: 'this browser has no service workers',
  certificate: 'the browser refused this site\'s certificate for the offline copy',
  refused: 'the browser would not install the offline copy here',
  installFailed: 'the offline copy started to download and failed',
  notRegistered: 'no service worker was registered from this server',
  devServer: 'this server provides no service worker (a development server)',
} as const;
