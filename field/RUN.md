# VisuLab — complete build

Everything needed to run the instrument and time it yourself. No installation, no `npm install`,
no network. You need Node.js (v18 or newer) and nothing else.

```
visulab-build/
  app/              the built PWA — 42 files, self-contained
  serve.mjs         a zero-dependency web server (no packages to install)
  RUN.md            this file
  TIMING-SHEET.md   a stopwatch worksheet with my predictions to check against
  reference/        the timing model, its output, and the citation record
```

---

## 1. Run it

### On this computer

```
node serve.mjs
```

Open **http://localhost:8080**. The camera works here — `localhost` counts as a secure context
even over plain HTTP.

### On the tablet (what you actually want for timing)

```
node serve.mjs --https
```

It prints an address like `https://192.168.1.42:8443`. Open that on the tablet, on the same Wi-Fi.
The tablet will warn about the certificate — accept it once.

**Do not use plain HTTP on the tablet.** Browsers only allow camera access on a secure context, and
`localhost` is the only exception. Over LAN HTTP the app will load and look completely normal, but
`getUserMedia` is never granted, so every blink, EAR and PERCLOS field comes out empty. You would
finish a full session and discover the primary outcome was never recorded. That is exactly the
failure the `--https` flag exists to prevent.

Other options: `--port 3000` to change the port.

---

## 2. Before you start the stopwatch — read this

**Never put `?e2e` in the URL when timing.** That query flag switches the app to end-to-end test
timings: reading floor drops from 20 s to 150 ms per page, adaptation from 60/120 s to 200/300 ms,
the go/no-go block from 32 trials to 4. A session runs in about two minutes and every number you
measure will be meaningless. It exists so the automated tests can run quickly. Plain URL only.

**Use a real tablet in the real room.** Reading speed on a 10-inch tablet held at reading distance
is not reading speed on a laptop. (An earlier draft of this note also cited the 10 lux condition as a source of slowing; that level has been withdrawn from the protocol and the claim no longer applies.)

**Landscape.** The app blocks portrait with an overlay; that is deliberate, not a bug.

---

## 3. What I predict, so you can check me

For one sitting, ten conditions, an average university participant:

| | minutes |
|---|---|
| Setup before the first condition | 17.4 |
| Waiting/admin between conditions | 19.6 |
| Closing after the last condition | 4.5 |
| **Overhead subtotal** | **41.5** |
| Actual testing | 56.9 |
| **Total** | **98.4** |

The overhead splits like this:

| Before the first condition | | Between conditions | | After the last |  |
|---|---|---|---|---|---|
| CVS-Q baseline (16 items) | 3.5 | Adaptation (grey screen) | 15.0 | CVS-Q end (16 items) | 2.9 |
| Consent | 2.8 | Breaks | 3.1 | NASA-TLX | 1.0 |
| Calibration | 2.5 | RT instructions | 1.5 | Session complete | 0.6 |
| Participant profile | 1.9 | | | | |
| Session init (researcher) | 1.8 | | | | |
| Camera setup | 1.5 | | | | |
| Colour vision (5 plates) | 1.3 | | | | |
| Instructions | 0.9 | | | | |
| Preflight checklist | 0.9 | | | | |
| Baseline fatigue sliders | 0.3 | | | | |

**Where I am most likely to be wrong.** Two of the three tiers are not estimates at all: adaptation
and the RT blocks are read straight from the config and the app will not advance sooner, and reading
is the corpus word count (5,851 words) divided by a reading rate. The genuinely estimated part is
42.5 minutes — the questionnaires, sliders, consent, calibration and breaks. If my per-item guesses
are 30% too generous the session is 85.6 minutes; if they are 50% too generous it is 77.1. That is
the range I would expect your stopwatch to land in if I have over-estimated.

`TIMING-SHEET.md` has a blank column to fill in.

---

## 4. Getting the data out afterwards

The app stores everything locally in IndexedDB — nothing leaves the tablet. When a session ends,
use the export screen; it writes a bundle with checksums. The export is byte-reproducible: it
contains no timestamps, so exporting the same session twice gives identical files and the checksums
certify content rather than time of export.

If you are timing rather than collecting real data, you can clear everything between runs from the
dashboard.

---

## 5. If you want to try the shorter variants

The two changes that cost nothing are in `src/experiment/config.ts` in the repository (not in this
built package — a rebuild is needed):

- `ADAPTATION_SWITCH_POLARITY_MS: 120000` → `90000` — saves 2.5 min/sitting
- Move the CVS-Q to once per participant instead of twice per session — saves 6.4 min/sitting

Together about 9 minutes off every sitting with no effect on any outcome. I have **not** applied
either to this build: they change the protocol, and that is your decision, not mine. This build is
exactly the protocol as it currently stands, so your stopwatch measures the real thing.

---

## 6. Reproducing the predictions

From the repository (not from this package):

```
npm run simulate:timing      # the full timing model, 2000 simulated participants
npx tsx scripts/protocolFrontier.ts   # what each way of shortening a sitting costs
```

Both read every app-controlled duration from the real config, so they cannot drift from what the
instrument actually does. `reference/` here holds the saved output of both.

---

## Build provenance

Built from branch `claude/build-review-refinement-3z0nrm`. The commit is recorded in
`reference/BUILD-INFO.txt` along with the verification-gate results at build time.
