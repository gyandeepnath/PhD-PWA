# Field deployment

What goes on the tablet, and how to run and time a session from a laptop, with no internet.

**The tablet stays tied to the laptop.** A tablet that opens the app from `serve.mjs --https` gets
**no offline copy**: Chrome does not install the app's service worker from a site whose certificate it
does not trust, and this server's certificate is self-signed — accepting the browser's warning lets the
page load, not the offline copy install (audit 86 P9; measured in desktop Chromium, expected on the tablet,
not tested there). The app runs, but every reload, and the dashboard the first time it opens, needs the
laptop: a Wi-Fi drop or a laptop gone to sleep mid-sitting can leave the tablet unable to load the app.
The landing page says so — "Offline copy: NOT installed". For sittings without any network, open the
study's deployed HTTPS address once (docs/DEPLOYMENT.md §4) and wait until the landing page says
"Offline copy: ready"; or install a locally trusted certificate authority on the tablet (for example
mkcert's), which this package does not do for you.

- `serve.mjs` — zero-dependency static server. Serves `dist/` over HTTP (localhost) or HTTPS
  (LAN, for tablet testing). No `npm install` needed; Node 18+ and nothing else.
- `RUN.md` — how to run the build, what not to do while timing, and the predicted timings.
- `TIMING-SHEET.md` — stopwatch worksheet with predictions to check against.

## Making a distributable package

```
npm run build
npm run package
```

That produces `visulab-build.tar.gz`: the built app, the server, both documents, a SHA-256 for
every file, and a provenance record naming the commit and the verification-gate result.

## Why the server exists at all

`vite preview` would serve the build, but it needs the repository and `node_modules` present, and it
does not do HTTPS. Camera access requires a secure context, and `localhost` is the only origin
browsers exempt — so a tablet reaching the machine over LAN HTTP loads the app perfectly and is
then silently denied `getUserMedia`. Every ocular measurement comes out empty and nothing warns you
until the export. `serve.mjs --https` generates a self-signed certificate covering the machine's LAN
addresses, which is the one thing that makes tablet testing actually record data.
