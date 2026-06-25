# VisuLab — Deploying & running on the tablet

VisuLab is a static PWA (`dist/`). The camera (`getUserMedia`) requires a **secure context**:
`http://localhost` is treated as secure, but any other host **must be HTTPS**.

## Build

```bash
npm install
npm run build     # outputs dist/ (PWA: service worker, manifest, precached MediaPipe assets)
```

`base` is `./`, so `dist/` works from any host or sub-path. Icons live at `public/icon-{192,512}.png`
(regenerate with `npm run icons`).

## Option A — host on the web (simplest, HTTPS for free)

Deploy `dist/` to any static host with HTTPS (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
On the tablet, open the URL in Chrome → **⋮ → Add to Home screen** to install it as a fullscreen,
landscape, offline-capable app.

## Option B — run locally on the tablet's own LAN (no internet)

The camera needs HTTPS even on a LAN IP, so serve `dist/` over TLS:

```bash
# one-time self-signed cert (researcher laptop on the same Wi-Fi as the tablet)
npx http-server dist -S -C cert.pem -K key.pem -p 8443 -a 0.0.0.0
# then open https://<laptop-LAN-IP>:8443 on the tablet and accept the certificate
```

Or use `vite preview --host` behind a local TLS proxy (e.g. `caddy`, `local-ssl-proxy`). Once loaded
once, the service worker caches everything (incl. MediaPipe), so subsequent runs work fully offline.

## Pre-session device checklist (also enforced in-app at PREFLIGHT)

- Brightness fixed; **auto-brightness OFF**; **night-shift / blue-light filter OFF**.
- Landscape orientation; screen cleaned; ~50–60 cm viewing distance; no backlight behind participant.
- Grant camera permission when prompted (or choose "continue without camera" to run performance +
  questionnaire measures only).

## Data

Everything is stored **on the device** in IndexedDB (`VisualErgonomicsDB`). Export per session from
the dashboard (14 CSVs + JSON + codebook + provenance manifest). Back up exports off-device; the
container/browser storage is the only copy until exported.
