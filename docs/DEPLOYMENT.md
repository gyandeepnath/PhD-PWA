# Deployment

How to build VisuLab and put it on a tablet for real data collection.

Everything below was checked against this repository as it stands. Figures come from an actual
build (`npm run build`) on the current commit.

---

## 1. Build

```bash
npm ci          # exact dependency tree from package-lock.json
npm run verify  # lint, typecheck, tests, corpus, codebook, export gates
npm run build   # prebuild vendors MediaPipe, then tsc -b && vite build
```

`npm run build` writes `dist/`, which is about **21 MB on disk**. Most of that is the self-hosted
MediaPipe FaceMesh runtime and the source maps. The service worker precaches **31 entries, roughly
17 MB**; that number is printed at the end of the build and is worth reading, because it is what
determines whether the app works with the network off.

`dist/` is a plain static directory. There is no server-side component and no database: everything
the app stores lives in the browser's IndexedDB on that device.

`vite.config.ts` sets `base: './'`, so the build works from a subdirectory
(`https://host/visulab/`) as well as from a domain root. It also stamps the git hash and app version
into the bundle, and those travel into every export as provenance.

---

## 2. The one constraint that will ruin a session

**The camera only works in a secure context.** `getUserMedia` is available on `https://` and on
`http://localhost` (and `http://127.0.0.1`). It is **not** available on a plain `http://` address,
including a LAN address such as `http://192.168.1.20:5180`.

This matters more than it sounds. On an insecure origin the app still loads, the participant still
reads the passages, every questionnaire and every task still records — and the camera silently
produces nothing. Ocular behaviour is the **primary outcome**. A session run this way is not a
degraded session; it is a session with no primary outcome in it.

**Check before every first-use of a device**, not once at the start of the study:

1. Open the app.
2. The URL bar must show `https://` with a padlock, or `localhost`.
3. Start a session and reach the camera-setup stage. The preview must show a face box.
4. If the browser never asks for camera permission, the origin is insecure. Stop and fix the
   hosting before collecting anything.

The app records `camera_active` per condition and `face_presence_ratio` alongside it, so a session
run without a camera is identifiable after the fact — but only after the participant has gone home.

---

## 3. Hosting

Pick one. All three produce the same app.

### (a) Static host — recommended

Netlify, Vercel, GitHub Pages, Cloudflare Pages. All serve HTTPS by default, which removes the
problem in section 2 entirely.

Publish directory: `dist`. Build command: `npm run build`.

The app is a single-page app, so unknown paths must fall back to `index.html`:

- **Netlify** — create `public/_redirects` containing:
  ```
  /*  /index.html  200
  ```
- **Vercel** — `vercel.json`:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
- **GitHub Pages** — copy `dist/index.html` to `dist/404.html` after building.

### (b) University server (nginx)

Use this when the data must not leave institutional infrastructure. It needs a real certificate;
a self-signed one will make the tablet browser refuse the camera unless the certificate is
installed and trusted on the device itself.

```nginx
server {
    listen 443 ssl;
    server_name visulab.example.ac.in;

    ssl_certificate     /etc/ssl/certs/visulab.crt;
    ssl_certificate_key /etc/ssl/private/visulab.key;

    root /var/www/visulab;   # contents of dist/
    index index.html;

    # SPA fallback.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # The service worker must never be served stale, or a device can be pinned
    # to an old build indefinitely.
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Hashed assets are immutable.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

### (c) Fully offline

Load the app once over HTTPS on the tablet, let the service worker finish precaching, then add it
to the home screen. After that it runs with no network at all. This is the configuration to use in
a lab room with no reliable connection, and it is the one section 5 assumes.

---

## 4. Offline and the service worker

`vite-plugin-pwa` runs in `generateSW` mode and precaches every `js, css, html, ico, png, svg, wasm,
tflite, binarypb, data` asset up to 12 MB each. That glob is what pulls in the MediaPipe model
files, which is deliberate: MediaPipe is normally fetched from a CDN, and a CDN fetch in a room
with no network means no face tracking and therefore no primary outcome.

**Confirming a device is genuinely offline-ready** — do this once per tablet, before it is used:

1. Load the app over HTTPS and wait. First load pulls roughly 17 MB and is not instant.
2. Run one throwaway session all the way through the camera-setup stage, so the FaceMesh model is
   actually exercised rather than merely downloaded.
3. Put the device in aeroplane mode.
4. Force-close the browser and reopen the app.
5. It must load, and the camera preview must still find a face.

If step 5 fails, the precache did not complete; repeat from step 1 on a better connection.

---

## 5. Updates during data collection

`registerType` is `autoUpdate`. A new deployment will be picked up and activated by any device that
touches the network. That is right for ordinary web apps and wrong for a study in progress: it means
the instrument can change between participant 40 and participant 41 without anyone deciding that it
should.

**The rule for a live study: install once, then keep the tablet offline for the duration.** Run
section 3(c), then leave the device in aeroplane mode except when exporting.

If an update genuinely must go out mid-study:

- Do it between participants, never between the two sittings of one participant.
- Record the git hash before and after. Every export carries `app_version` and `git_hash`, so the
  break point is recoverable in analysis, but only if you know to look for it.
- Re-run the offline check in section 4 afterwards.

---

## 6. Device setup

Requirements:

| Requirement | Why |
|---|---|
| Chrome, Edge or Safari, current version | `getUserMedia`, IndexedDB, `requestAnimationFrame` timing |
| Front camera, 720p or better, 30 fps | Blink detection is unreliable below ~25 fps; the achieved rate is recorded as `effective_fps` and gates the duration-based metrics |
| Screen large enough for a full passage page | Line length affects reading; keep it identical across participants |
| Landscape orientation, locked | The manifest requests landscape; a rotation mid-task disturbs the reading measure |

Settings that **must** be changed on the tablet, because each one silently corrupts the display
manipulation the study exists to measure:

- **Auto-brightness off.** Display luminance is a controlled variable and is recorded per session.
- **Night Shift / Night Light / blue-light filter off.** These alter the rendered colour of every
  condition, which is the independent variable.
- **True Tone / adaptive colour off**, for the same reason.
- **Screen timeout: never**, or longer than a full sitting. A screen sleeping mid-condition ends
  the exposure window.
- **Notifications off / Do Not Disturb on.** A banner during a reading task is an uncontrolled
  interruption.
- **Fullscreen.** Add to home screen and launch from there; the manifest requests fullscreen.

---

## 7. Data safety

Everything lives in IndexedDB (`VisualErgonomicsDB`) on the tablet until it is exported. A wiped,
reset, lost or failed device destroys every unexported session on it, and the participants cannot
be asked to sit the protocol again.

Every export therefore contains **`backup_<participant>_<session>.json`**, a complete copy of the
session including the trial-level reaction-time rows. Session Manager → *Restore session from
backup file* reads it back on any device.

Two things to know:

- The `session_*.json` inside an export is **not** a backup. It carries `reaction_trials_count`
  rather than the trials themselves, because it is written to be read alongside the CSVs. Restoring
  from it would lose every reaction trial. The app refuses it and says so.
- Photo and video **blobs are not in the backup** — they are binary and stay on the device. The
  inventory rows are carried, flagged `blob_present: false`, so a restored session reports its media
  as missing rather than appearing to still have it. Copy consented media off the device separately.

**Export after every session, and copy the export off the device the same day.** Not at the end of
the week.

---

## 8. Pre-deployment checklist

Sign this off once per device, before it is used with a participant.

- [ ] `npm run verify` passes on the commit being deployed
- [ ] Deployed over HTTPS; padlock visible on the tablet
- [ ] Camera permission granted; face box appears at camera setup
- [ ] Offline check (section 4) completed and passed
- [ ] Auto-brightness off, blue-light filter off, adaptive colour off
- [ ] Brightness set to the study value and recorded
- [ ] Screen timeout disabled; Do Not Disturb on
- [ ] Landscape locked; app launched fullscreen from the home screen
- [ ] Display white-point luminance measured and recorded
- [ ] Lux meter present, and the room reaches both target levels
- [ ] One complete throwaway session run, exported, and the export opened and checked
- [ ] Backup restore tested: import that throwaway export onto a second device
- [ ] Device left in aeroplane mode

Device ID: ................  Checked by: ................  Date: ................
