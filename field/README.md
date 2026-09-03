# Field deployment

What goes on the tablet, and how to run a session without a network.

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
