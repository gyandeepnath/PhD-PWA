# Operator manual

> **PROTOCOL AMENDMENT — READ THIS FIRST.** Ambient illumination is no longer varied. Every sitting
> runs at **300 lux** (accept 250–350), and each participant attends **ONCE** for all ten
> conditions. Instructions below that name 10 or 150 lux, or a second session 48–72 hours later,
> describe the superseded protocol — **the app will reject a 150 lux reading** and force you to
> record a protocol deviation. Everything else is unchanged. See `ILLUMINATION_AMENDMENT.md`.

For the research assistant running a session. It assumes you are a trained optometry student, not a
developer. Read it once end to end before your first participant, then use section 9 at the bench.

The scientific rationale for the protocol is in [`PROTOCOL.md`](PROTOCOL.md). Device and hosting
setup is in [`DEPLOYMENT.md`](DEPLOYMENT.md), and must already be done.

---

## 1. What you are measuring, and why the details matter

Each participant reads under ten display conditions, twice: once with the room dim, once with it at
a moderate level. The manipulated variables are **display polarity**, **text colour** and **ambient
illumination**. Everything else has to be held constant, because anything that varies alongside a
condition becomes indistinguishable from it.

The primary outcome is the **proportion of blinks that fail to close fully**, measured by the
tablet's own camera during the reading task. Two consequences for you:

- **If the camera is not working, the session has no primary outcome.** Everything else can be
  collected and the session will still be a loss. Check the camera before you start, not after.
- **The reading task is the measurement window.** Do not interrupt it, do not talk during it, and
  do not let the participant stop early.

### What the camera measures, and when (Round 80)

The camera runs from camera setup to the end of the sitting, but its frames are **kept only in four
windows**: the open-eye baseline and the gaze check (calibration), the camera check, and each reading
window. Everywhere else the researcher panel shows the camera live and nothing is stored. The panel
says which, in words: *Recording: reading window* (or *camera check*, *open-eye baseline*, *gaze
check*), or *Live only — not recorded*. The blink count on the panel is the same count the data will
hold: the live graph, the live count and the stored record use one classifier, one baseline and the
same two lines (0.75 and 0.60 of the open eye). A blink is counted when the eye reopens, so the count
rises just after each blink, never during it.

<!-- measurement-schedule:start (generated from src/tracking/measurementSchedule.ts; tests/measurementSchedule.test.ts checks this copy) -->
| Measure | How often | When | Kept in | Shown live |
|---|---|---|---|---|
| Eye openness, face found, head position, iris position | Continuously | Every frame the tracker processes, from camera setup to the end of the sitting | Only in the 4 windows below (reading, camera check, open-eye baseline, gaze check); on every other screen shown live and discarded | Card: picture, last-10-s graph, eye openness, on screen now; on the set-up screens it says "Live only — not recorded" |
| Picture brightness | Continuously | 4 times a second | Mean per reading window (07 mean_face_luma) | Card |
| Camera health | Continuously | Every frame: picture black or covered, camera muted, no face | Totals per reading window (07) | Panel dot and words; notices that stop the sitting |
| Ruler, viewing distance, camera mode, fixed exposure, tracker, bench check (if run) | Once per sitting | Pre-flight and camera setup | 01_session_info | On those screens |
| Open-eye baseline and head-pitch zero | Once per sitting | Calibration, centre dot on the grey field: at least 6 s, on until 30 usable frames, at most 12 s; again on a retry or a resume | Calibration record; 01 calibration_ear_baseline | Calibration screen: eyes found / steady / done. The panel stays a plain dot while it runs |
| Gaze check | Once per sitting | After the baseline: 3 dots across a reading line, each sampled 1 s after 0.5 s to settle; a short dot is shown again (up to 3 times in all) | Calibration record; 01 gaze_calibration_valid | Calibration screen: a tick per dot. The panel stays a plain dot while it runs |
| Camera check | Once per sitting | After calibration: about 18 s, 5 flashes on the grey field | 01 selftest_*; its blinks and frames in 07b and 07c (window = selftest) | The dot screen counts the flashes; then the result screen shows each flash and the trace. The panel stays a plain dot while it runs |
| Blinks (start, end, depth, complete or incomplete, page) | Each blink | The reading window only: from the "Begin reading" tap to the last page's Next | 07b, one row per blink; 07c, every frame's eye openness | Panel strip on the reading page (tap the dot): "Recording", blinks this reading, incomplete beside (a blink is counted when the eye reopens) |
| Incomplete-blink ratio, Blink rate, Inter-blink interval, PERCLOS, Long closures, Eye sampling rate, Face in view, On-screen ratio, Head position | Each reading window | Summarised when the last page is turned | 07_eye_metrics, one row per condition | Panel "last reading" on the screens after it |
| Annotation video (validation subsample only, its own consent) | Each polarity | The first reading window of each polarity: up to 3 min from "Begin reading"; kept only if that reading is completed | A video file, one per polarity (15_media_inventory, reading_segment) | Nothing on screen |
| Setup photographs (their own consent) | Start and end | One after the camera check, one at the end of the sitting | Two photo files (15_media_inventory, session_start and session_end) | Nothing on screen |
| Questions, ratings, fatigue scale, word search, reaction task, grey field, breaks | Not measured | The camera keeps running | Not kept | Panel: "Live only — not recorded" |
| Live picture, last-10-s graph and its blink marks, live frame rates | Live only | While the researcher card is open (4 updates a second) | Never kept (the only camera images kept are the two consented items above) | Card |
<!-- measurement-schedule:end -->

---

## 2. Before the participant arrives

**Room**

- Exclude daylight. Curtains or blinds closed; no window contribution that changes through the day.
- Set the room to **300 lux** (acceptable 250 to 350). This is the same for every participant and
  every sitting — there is no longer a level to look up or assign.
- Measure with the lux meter at **two points**: the participant's eye position, facing the display,
  and the display plane. If either is outside the accepted range, adjust the lighting before the
  participant arrives, not during the session. The app has one lux field and it is the **eye-position**
  reading; record the display-plane reading on the session sheet.
- Keep the lamp type and colour temperature identical across every session in the study.
  Illuminance is held constant, so ANY variation in the room's light is unwanted, not just a change
  in brightness.

**Tablet**

- Clean the screen.
- Brightness fixed at the study value. **Auto-brightness off.**
- **Night Shift / Night Light / blue-light filter off.** These change the rendered colour of every
  condition, which is the independent variable, and they invalidate the red-green colour-vision
  plates.
- Screen timeout disabled. Do Not Disturb on. Aeroplane mode on.
- Landscape, fullscreen, launched from the home-screen icon. **This now matters for the stimulus,
  not only for tidiness.** Every screen is laid out on a 16:10 canvas and, since version 2.2.0,
  enlarged or shrunk to fill the screen it is shown on. In the installed app it fills the tablet's
  whole screen, which is the size the protocol's stimuli are defined at. In a browser tab the address
  bar takes part of the height and everything is drawn smaller by that fraction. Pre-flight shows
  the fraction ("Display size", and "Layout scale" in the *This device* box). Pre-flight checks how
  the app was launched; if it is not the installed full-screen app it shows a warning you must tick
  to continue, and that tick is recorded as a protocol deviation (`display_mode_acknowledged`).
  Close the tab and open the app from its icon instead. **The same check is made again when you
  resume a sitting** (see *Exit — resume later* below) and at a break if the way the app is
  displayed has changed, and each display records which launch it ran in.
- **Font size and display size at the tablet's default**, in the system settings and in Chrome's
  accessibility settings (text scaling 100%). The reading text is drawn at one fixed size for every
  condition. Since Round 84 the app measures the size it actually drew on page 1 of every display
  (`reading_line_px_rendered`); if a setting enlarged it, the data-integrity check says so
  (`reading_text_size`).
- Battery above 80 per cent, or keep it on charge.
- **Never run a session in a private or incognito window.** The data is thrown away when the window
  closes and nothing warns you at the time. Always launch from the home-screen icon. Pre-flight
  checks this and will refuse to start if it finds ephemeral storage; if it does, close the window
  and reopen the app properly rather than trying to continue.

**Which build is running, and updating it**

The app names its build on the landing page, the Session Manager, pre-flight and the dashboard, in
one line:

> `VisuLab 2.2.0 · built 4 Oct 2026 09:33 UTC · e05d3c4`

The **version** (2.2.0) changes only when a change alters what a participant sees or what the export
means. The **build time** (always in UTC) changes with every deployment, so it is the part that tells
you whether the tablet has the newest build. The **commit** (seven characters) is what the export
records as `git_hash`. The same three are in `01_session_info.csv` (`app_version`, `build_time`,
`git_hash`), and the dashboard shows both the build drawing it and the build that recorded the sitting.

How an update reaches the tablet. The installed app keeps a copy of itself so it works offline. A
newer build is downloaded in the background and then **waits**; it never replaces the running app
by itself, because that would reload the app in the middle of a sitting. So:

1. **At the start of each study day, before New Session**, open the app from its icon (with the
   tablet online, before switching on aeroplane mode) and stay on the landing page. It checks for a
   newer build by itself; you can also tap **Check for updates**. It answers *This is the newest
   build the server has*, *A newer build was found and is downloading*, or *Could not reach the
   server*.
2. If a newer build is ready, a dark notice appears at the bottom: **A newer version of VisuLab is
   ready — Update now.** Tap **Update now**. The app reloads into the new build; check that the build
   line now shows the new build time.
3. **Update now is offered only when no sitting is open** in any window — not one paused, not one
   at pre-flight. While one is open the notice says which, and waits; finish that sitting first (a
   practice or abandoned sitting left open also blocks it: export it if it holds anything, then
   delete it in the Session Manager). This is why step 1 comes before New Session. If a newer build
   is waiting when you reach pre-flight, a dark notice at the **top of pre-flight** says so: it has
   no Update button, because this sitting is open; the sitting runs, and is recorded, on the build
   named in pre-flight's *This device* box. Update from the landing page after it.
4. If the notice never appears although a newer build has been published (the build line still
   shows the old time after **Check for updates** says it is downloading and you have waited a
   minute): close the app from recent apps and open it again from its icon, then repeat. Only as a
   last resort, and only with every sitting exported and copied off the tablet, clear the site's
   data in Chrome's settings — that deletes every session stored on the tablet.

**Seating**

- Chair and table height fixed. Same setup for every participant.
- Tablet in its stand at a **viewing distance of 50 to 60 cm**. Measure it with a tape, from the
  participant's eye to the centre of the screen, seated as they will read; do not judge by eye.
  **Type the measured distance into pre-flight.** The field starts empty and pre-flight will not
  continue until a distance is typed — it is never filled in for you, because a figure nobody
  measured would be saved as the participant's distance. Every "at distance" angle in the export
  uses it.
- The participant should be able to sit comfortably without leaning in. If they lean, head-pose and
  face-size measures drift and the camera loses them.

---

## 3. Consent

Consent is **layered**, and the layers are independent. Do not merge them, and do not present the
later ones as if they follow from the first.

1. **Participation.** Written informed consent for the study itself.
2. **Camera measurement.** Separate, and refusable. Say plainly:
   > "The tablet's camera measures how you blink while you read. Nothing is recorded or saved as a
   > picture: the camera produces numbers and the images are discarded as they are processed. You
   > can decline this and still take part in everything else."

   A participant who declines is **still fully enrolled**. Every questionnaire, reading,
   comprehension, search and reaction-time measure still runs. Record the refusal; do not try to
   persuade.

   The app enforces the refusal itself: instead of the camera-setup screen it shows *Camera
   measurement declined* and moves on. There is no button to enable the camera anyway, by design.

   **If the participant changes their mind before calibration**, press **← Back to consent** (on
   the profile screen, the camera-setup screen or the *Camera measurement declined* screen). The
   whole consent screen comes back with every box unticked, exactly as the first time; the
   participant decides again, and the app returns to the screen you came from. From the camera
   screen that means straight back to it: the profile, pre-flight and colour-vision plates are not
   repeated. The earlier choice is kept on the session
   record (`consent_revisions` in the export), so the change is visible later. Do not use this to
   talk a participant round: it is for a participant who asks.

   **The Back button is offered only while nothing has yet been recorded under the consent** — no
   calibration, no photograph, no display. On a resumed sitting that already holds any of these it
   is not there, and the choice stands for this sitting; the next sitting presents the consent
   screen afresh with every grant defaulting to no. Do not start a second
   session for the same visit to work around this — it would record one visit as two sittings and
   corrupt the counterbalancing. Destroying media already captured IS available at any time, and
   does not require ending the session: see the withdrawal row in §6.
3. **Setup photographs.** A separate grant, defaulting to no. Two photographs, at the start and end
   of the session, showing seating distance and room lighting, so that setup compliance is evidenced
   rather than asserted.
4. **Annotation video.** A separate grant, defaulting to no, and only for participants in the
   validation subsample. A short segment of reading video, coded frame by frame by a human, which is
   what lets us check the automatic blink measure against a person.

   **You do not choose who is in the validation subsample.** Membership follows from the enrolment
   number and is fixed before the participant arrives, so the checkbox simply appears for those
   participants and not for others. This is deliberate: choosing at the bench would select the
   subsample on whatever you happened to notice about the participant, which is precisely the
   sample the validation must not be conditioned on. If the checkbox is not there, this participant
   is not in the subsample.

Granting 3 does not imply 4, and neither is implied by 2. The permission in force at the moment of
capture is stored with each file, so a recording can never be separated from the basis on which it
was taken.

---

## 4. Screening and profiling

The app runs these in order and will not let you skip ahead:

`CONSENT → PARTICIPANT_PROFILE → PREFLIGHT → COLOR_VISION → CAMERA_SETUP → CALIBRATION →
CVSQ_BASELINE → BASELINE_FATIGUE → INSTRUCTIONS`

Pre-flight comes **before** the colour-vision plates on purpose: a blue-light filter left on would
invalidate the red-green plates.

**Tick all (builds after 2.3.1).** The seven room-and-device items on the right of pre-flight
(brightness, blue-light filter, screen cleaned, lux, lenses, backlight, stand) can be ticked one by
one, or all at once with **Tick all**. Tick all asks first; answer **I have checked each of these**
only if you have. The sitting records which way the list was ticked (`preflight_bulk_ticked` in
`01_session_info.csv`). It does not tick the warning boxes on the left or skip the ruler check; those
are answered one at a time.

**The ruler check on pre-flight (version 2.2.0 onwards).** Near the bottom of pre-flight is a black
bar with an end mark at each side. Lay a ruler (millimetres) flat on the screen along it, with the
ruler's **zero exactly at the bar's left end**, read where the bar ends, and type that length, to
the nearest half millimetre, into **Bar length (mm)**. Do it with the tablet in its stand and the app
as the participant will see it — launched from its icon, full-screen — because the bar is drawn at
the size the screen is drawn at. On the study tablet it reads about **103 mm**; the screen shows the
figure to expect. The app works out from it how large the screen's pixels are and shows the result:
the reading text's x-height in millimetres and in minutes of arc at the distance you typed (about
2.4 mm and 15′ at 55 cm on the study tablet). Every physical size and visual angle in the export is
computed from this reading, so take it on every sitting.

- If the app says the length is outside the accepted range, you have most likely read centimetres
  or started from the wrong end of the ruler: measure again.
- If it says the length is more than 10% off the study tablet's figure, measure again; if it is
  right, the sitting is running on a different device, and the export records it as measured.
- If the display size changes after you typed it (the app was rotated or the address bar came
  back), the app asks you to measure again.
- **No ruler?** Tick *No ruler: run without the measurement*. The sitting can go on, but it is
  recorded as a deviation (`calibration_skipped`), and every physical size in its export is then
  an assumption, flagged as such (`physical_size_source`). Keep a 15 cm ruler and a tape measure
  with the tablet.

The *This device* box above it shows what the browser reports — viewport, pixel ratio, screen,
layout scale, display mode — and the build. If anyone asks what the tablet actually reports, read
it from there.

**Going back, and stopping part-way through set-up.** The white button at the **top left** of every
set-up screen is always the way out, and it always says what it does:

- On the *New Session* form it reads **← Cancel — back to sessions**. Nothing is saved until you
  press *Begin setup*, so cancelling loses only what you typed (the app asks first if you typed
  anything).
- On every other set-up screen it reads **Exit — resume later**. The app asks you to confirm, then
  returns to the Session Manager. Everything already completed is saved, and the sitting stays under
  *In progress*. **Resume** carries on at the first screen that was not finished — and shows the
  participant the instructions again if they had not yet started the first display. If the camera
  is being used, camera set-up and calibration are always done again on a resume. **If the sitting
  is resumed anywhere but the installed app** — a Chrome tab, say, after the tablet restarted — the
  first screen is *Before this sitting continues*, the pre-flight display check again. Tap **Exit —
  resume later**, close the tab, open the app from its home-screen icon and Resume there; or tick the
  warning to carry on in the tab, which is recorded against every display that follows. In a participant's
  **second sitting** the profile and the colour-vision plates count as finished only once *that*
  sitting has done them: each sitting records its own caffeine, hours since waking, correction and
  colour-vision answers, so stopping on the profile brings you back to the profile.
- The button disappears while the colour-vision plates are on screen, while the calibration dots
  are running and while the camera self-test dot is flashing. It comes back as soon as that step
  ends. Leaving in the middle of those would mean repeating them, and a second look at the same
  colour-vision plates tests memory rather than colour vision.

A **← Back** button sits next to *Continue* on three screens only:

- the **profile** screen (**← Back to consent**) and the **camera** screens (**← Back to consent**),
  to change a consent choice — see §3;
- the **pre-flight** screen (**← Back to the profile**), to correct a mistyped answer. The profile
  comes back filled in with what you entered; change what is wrong and press *Continue*. The
  corrected answers replace the first ones.

There is deliberately **no Back** on the colour-vision plates, the calibration, a questionnaire
that has been submitted, anything inside a display, the break or the thank-you screen: going back
there would change what is being measured.

Alongside the app, complete the clinical screening: visual acuity, non-cycloplegic refraction, cover
test, near point of convergence.

**Eligibility.** The profile form accepts ages **18 to 35**, the protocol's range. Contact-lens wear
on a test day and colour-vision deficiency are exclusions, and the app records them as such: a
participant who reports either is written out with `eligible=false` and the reasons listed, so the
confirmatory analysis can drop them. Enter what is true rather than what will let you proceed.

**Colour vision — two separate things, and only one of them excludes.**

- The **formal plates you administer** (Ishihara or Farnsworth, part of the clinical screening) are
  the basis for exclusion. Record the result in the profile form: normal, deficient, or not done.
  Record *not done* honestly if you did not do it; it is not a pass.
- The **app's own colour-vision screen** — seven plates: a greyscale control plus six coloured ones
  — is a screening aid and a covariate. It is not the Ishihara test, it has no published sensitivity
  or specificity, and it never excludes anyone on its own. Its digits, plate order and colours are
  re-randomised on every administration by design, so a participant cannot pass the second one from
  memory; for the same reason the two scores are not directly comparable with each other. Half the
  coloured plates are built to be invisible to one kind of red-green deficiency and half to the
  other, and in practice a participant with either kind sees very little on **any** of them. What
  matters is the **first, grey plate**: grey plate right and most of the coloured ones wrong is the
  pattern of a colour-vision deficiency, and it is not carelessness. Someone who misses the grey
  plate as well was not attending, and the app records that separately as no result rather than as
  a failure.

If the two disagree, record both and note it. The formal result is what the analysis uses.

**If the app's screen does not pass**, the tablet stops and tells you so before going on. Nothing has
gone wrong and nobody is excluded — the result is already saved. What it is asking you to do is
**administer the formal plates now, while the participant is still with you**, and record the result
on the profile form. That is the only moment the question can be settled: the app's screen cannot
settle it, and after the session there is no participant to screen. If you genuinely cannot run the
plates, record *not done* — it is not a pass, and the analysis will treat it as unresolved. Do not
tell the participant they have a colour-vision deficiency on the strength of the app's screen; if the
formal plates show one, follow the incidental-findings steps below.

You will see the same notice when the app's screen gives **no result** — that means the greyscale
control plate was missed, usually a mis-tap on the first of the seven screens, so the attempt measured
nothing. It is neither a pass nor a failure, the app will not re-present the screen, and the formal
plates are again the remedy.

**If screening turns up an abnormality** — reduced acuity, uncorrected refractive error, a binocular
anomaly, a colour-vision deficiency:

- Record it. It is a covariate, and for colour vision it bears directly on the text-colour factor.
- Tell the participant, in plain terms, and give them written advice to seek a full optometric or
  ophthalmological examination.
- Log it as an incidental finding. Do not treat, and do not reassure beyond the referral.

**If camera set-up says the camera or the face tracker could not be started**, the box ends with
*Details: …* — the library's own words. Copy them for the investigator. Words such as
*activeTexture*, *loadGraph* or *kGpuService* mean the browser gave the app no working WebGL: all
three trackers need it (even the "CPU" one takes the picture in through WebGL), so none can start and
the camera cannot be used on that browser until WebGL works (Chrome's *chrome://gpu* page shows
whether it does). This was found in a test browser; it has not been seen on the study tablet.

**Camera set-up: the picture and the numbers (version 2.3.0 onwards).** *Enable camera* starts the
camera and the face tracker the whole sitting will use — there is no separate preview camera any
more. The picture is the tracker's own: a green box round the face and yellow points on the eyelids,
which are the six points per eye the blink measure is computed from. If the yellow points do not sit
on the lid margins, the blink data will not either: fix the light or the seating first.

Beside the picture, **CAMERA AND TRACKER** gives three rates and says which one is short:

| Line | What it means | If it is low |
|---|---|---|
| *Camera delivers* N fps · W×H | Frames the camera hands to the app each second, and their size | The **camera** is the limit. Most tablet cameras slow down in dim light: add light on the face (not behind it), and close any other app that may hold the camera. |
| *Tracker processes* N fps · M ms | Frames the face tracker gets through each second, and the time one frame takes | The **processor** is the limit: close other apps, plug in the charger and switch battery saver off, let a hot tablet cool, and use the fastest tracker (below). |
| *Eye sampling rate* N fps | Frames in which the face was found, a second: the rate the blink measures are sampled at (per reading, `sampling_fps_observed`; the same name on the panel, the camera check and the dashboard) | Seating, distance, light on the face, glare on spectacles, something in front of the face. |
| *Face width* N px | How wide the face is in the camera's picture | The face model enlarges a crop around the face to 192 or 256 px before it finds the eyelids, so a face much narrower than that is being magnified and the lids carry few real pixels. It depends on the distance **and** on the picture size the camera gave (the *Asked for … the camera gave …* line): a small value with the participant at 50 to 60 cm means the camera gave a small picture — note both numbers for the investigator rather than moving the participant closer than the protocol distance. No minimum has been validated; this is a reading to record. |

The sentence under them names the stage that is short. It blames the camera alone only while the
tracker keeps up with what the camera delivers (processes at least 80% of it). When both are short —
for example the camera at 20 and the tracker at 11 — it says *the camera AND the tracker are short*:
more light alone will not fix that, because the tracker would still process only about 11 frames a
second; do the processor steps as well. It also gives the eye sampling rate's verdict under the
**frame-rate gate** the whole study uses (from Round 79): **adequate** at 20 face frames a second or
more (green); **reduced** at 15 to 20 (amber: blinks are measured, and a reading at that rate is kept
and flagged); **too slow** under 15 (amber: blink data from it are exploratory only). Earlier builds
asked for 30 here and were amber at almost every rate the tablet delivers; the 20 comes from a
simulation of the app's own blink measure (docs/FPS_GATE_SIMULATION.md). If it says *reduced* or *too
slow* with every participant, tell the investigator; do not change anything to make it go away. Below the rates is the last ten seconds of
eye openness: a white line that dips at each blink. After calibration it carries two dashed lines,
yellow at 0.75 and red at 0.60 of this participant's open eye: a dip below yellow is counted as a
blink, below red as a complete one.

**The face tracker on this tablet.** There are three: Face Landmarker on the GPU, Face Landmarker on
the CPU, and the older FaceMesh. Which is fastest depends on the tablet and has not been measured on
the study tablet yet. The first time the camera is set up on a tablet, the app runs each for a few
seconds on the picture (*Measuring 1 of 3…*) and keeps the fastest for that tablet; keep a face in
view while it does. If no tracker saw a face for at least half its few seconds, nothing is kept and
the screen says so: the tracker in use is unchanged and the next camera setup measures again — seat
someone in front of the camera and press **Measure trackers again**. The table shows what each achieved, and the one in use is in bold. **Measure
trackers again** repeats it — do that only at the bench, never between a participant's sittings,
because a participant measured on two trackers is flagged in the data (the trackers are not
interchangeable instruments). Before the pilot the investigator fixes the tracker for the study; the
screen then says *Fixed:* and there is nothing to measure.

**Fixing the camera's exposure (every sitting, from Round 79).** *My face is centred — continue*
first shows the grey field with a dot for about 10 seconds: the participant looks at the dot and keeps
still. Under automatic exposure a tablet camera can run slower on a dark page than on a light one,
and the frame rate changes the blink measure, so the app fixes the exposure here, under the light
every condition starts from. It keeps the fixed exposure only if the camera stays as fast (within 1
frame a second) and the picture at least 70% as bright as under automatic exposure; otherwise it goes back to
automatic exposure and records why. There is nothing to do. The camera check's result says which
(*exposure fixed (30 ms)* or *automatic exposure*).

*From Round 82 (rule `exp-r2`).* Chrome on an Android tablet reports a fixed exposure as "none",
not "manual". Before Round 82 the app read "none" as a refusal and went back to automatic exposure,
so on the tablet the exposure was never kept fixed. An export from those builds shows this in
`camera_exposure_reason` as *it reports "none"*. The app now counts "none" as fixed and records what
the camera said (`camera_exposure_mode_readback`). This comes from Chrome's source code; it has not
been seen on the tablet yet — the bench check below is how to see it.

**The bench check (researcher only, before the pilot).** On camera setup, *Run: white, grey, black
(2 min)* shows white, grey and black screens for about 20 seconds each under automatic exposure, then
tries to fix the exposure and shows the three screens again. It gives one row per screen: camera fps,
tracker fps, eye sampling fps, brightness, exposure time, and what the camera says its exposure mode
is. No participant is needed. Read it this way:

- **First look at the Exposure column of the last three rows.** It says what the app achieved:
  *fixed (30 ms)*, *compensated*, or *automatic (not fixed)*. If it is not *fixed*, a line under the
  table says why, and the last three rows are not fixed-exposure rows: they cannot answer the
  question below. (Before Round 82 these rows were labelled "fixed" whatever happened.)
- **Camera says:** *continuous* means automatic exposure; *manual*, or *none* on an Android tablet,
  means fixed.
- **Automatic rows:** if the camera delivers fewer frames on black than on white, its rate follows
  the screen (it is limited by its exposure). That is the reason the exposure is fixed.
- **Fixed rows** (only when the Exposure column says *fixed*): these should be the same on all three
  screens.
- **Camera about 30 but tracker about 24 on every screen:** the processor is the limit, not the light.

Photograph the table for the investigator. Run it again after a change of tablet, room lighting or
Chrome version. Nothing about the study tablet's camera has been measured yet.

**The frame-interval check (investigator, on an export).** On a computer with the project,
`npm run frame-intervals -- <export folder>` reads `07c_ear_trace.csv` and says, per condition,
whether the gaps between frames are mostly about 40 ms (the camera itself runs at about 25: limited by
exposure) or a mix of about 33 and 67 ms (the camera runs at 30 and the tracker skips frames), and how
much the white-page and black-page conditions differ. It only reads; nothing is changed.

**An external camera.** Use the tablet's front camera. The app always asks for the camera facing the
participant and has no camera picker, so a USB camera would not be used without a change to the app.
Consider one only if, with the exposure fixed, the front camera cannot give 20 or more face frames a
second, or gives white-page and black-page conditions rates more than 2 apart. Whether the Xiaomi Pad
6 offers a USB camera to Chrome at all is not verified (test: plug one in and see whether a second
camera appears). It goes through the same browser camera path, so it would not by itself avoid the
exposure problem, and a different camera changes the protocol and the consent: tell the investigator,
who would notify the ethics committee.

**The camera check** after calibration (*Quick camera check*: blink when the dot flashes). From
Round 79 it runs on the grey field — the same mid-grey as before each display — and the dot turns
from black to white for each flash. It takes about 18 seconds. It passes when all three hold:

| What is checked | Needed |
|---|---|
| Blinks seen | at least 4 of the 5 flashes, each blink beginning in the 1.2 s after its flash (from Round 82; before, 1.2 s either side) |
| Face in view | at least 90% of the time |
| Eye sampled (face frames a second while the face was seen) | 15 or more: 20 or more is *The camera is working*; 15 to 20 is *working, at a reduced frame rate* (a pass) |

The result screen shows each line with a tick or a cross, each flash with whether a blink was seen
and when it began, and a trace of eye openness through the check with the five flashes marked
(light bands are the 1.2 s after each flash, where a blink counts). Read it this way:

- **No dip at a flash**: the participant did not blink, or blinked late. Explain again and try again.
- **"too early"** under a flash: the participant blinked just before the flash, guessing its rhythm.
  A blink before a flash is not an answer to it, so it does not count. Ask them to wait for each
  flash, then blink, and try again.
- **A dip that does not reach the dashed line**: the blink was too shallow for the camera to count.
  Check the light on the face and glare on spectacles.
- **Two dips in one band**: each flash counts one blink, the one nearest to it; the other is an
  extra. Nothing to fix unless extras are many.
- **A gap in the trace**: the face was lost. Check seating, distance and that nothing is in front of
  the camera.
- **Too slow**: the sentence under the trace names the stage that is short — "the CAMERA delivered
  only …" (light), "the TRACKER processed only …" (processor), "BOTH the camera and the tablet's
  processor are short" (both: light alone will not fix it), or "found the face in only some of them"
  (seating) — as on camera setup. Follow that advice. Do not lower anything to make it pass.

*Try again* runs another attempt; the earlier ones are listed on the screen and kept with the one
recorded. A *reduced* pass is a pass: continue, or improve the light and try again. Before Round 79
the check failed whenever the camera ran below 25 frames a second, which on the study tablet was
almost always: that was the rule, not the participant.

**Why only blinks after the flash (Round 82, rule `st-r3`).** Before, a blink up to 1.2 s before a
flash also counted. In a simulation, a participant who ignored the flashes and blinked only on their
own passed that rule in about 1 attempt in 6 at 15 blinks a minute, and 2 in 5 at 20. Counting only
blinks after the flash cuts this to about 1 in 40 and 1 in 12, and a participant who blinks at every
flash passes as before (`docs/FPS_GATE_SIMULATION.md`; the blink rates are assumptions of the
simulation). So a pass can still, now and then, come from ordinary blinking — it still shows the camera
sees this person's blinks, which is what the check is for. Watch that the participant blinks at the
flashes.

**What to send the investigator from the tablet** the first time the new version runs (photograph
the screens or copy the numbers): from camera set-up, the three rates, the face width, the line
*Asked for … the camera gave … (its maximum: …)*, and the whole tracker table; from the camera check's
result, the line under the verdict (*Camera delivered … · tracker processed …*). Do it once in the
study room with the lights as they will be, and once more with the tablet on charge and nothing else
open.

**Calibration** (from Round 80, rules `cal-r2` and `gaze-r2`) measures this participant's own
open eye, the head's straight-ahead position, and where the eyes point at the two ends of a line of
text. Every blink line is a fraction of the open-eye baseline, not a population default, so a rushed
calibration spoils the blink measures for the whole sitting. Take the time. It runs on the grey field
(the same mid-grey as before each display), in two steps:

1. **The centre dot: the eye at rest.** The participant looks straight at it, sits as they will sit
   to read, and blinks normally. Do not ask them to hold their eyes open — the measure is designed
   around normal blinking, and a forced stare gives a wider eye than they will ever read with. Under
   the dot the screen says how it is going:
   - *Looking for the eyes…* — no face yet: check seating and framing;
   - *Face found · the eyes are not clear yet* — usually glare on spectacles or a lamp behind;
   - *Eyes found · hold still* — the eyes are found in fewer than half the camera's frames;
   - *Eyes found · steady* — all is well.

   It runs at least 6 seconds, then on until it has 30 good frames, and stops at 12 seconds
   whatever it has. The step row at the foot of the screen ticks it (*eyes at rest*) when it is done.
2. **Three dots along a line: the gaze check.** The dot moves to the middle, the left end and the
   right end of a line of text. Head still, eyes only; nothing to touch. Each dot is shown for 1.5
   seconds. If the eyes were not found often enough at a dot, that dot alone is shown again (*Once
   more — look at the dot*), up to three times. Each dot gets a tick.

**If a step falls short, the screen says why and repeats only that step.**

| Screen | What it means | What to do |
|---|---|---|
| *No eye baseline* | No blink can be counted in this sitting without it. The reason is on the screen: no frames, a face in under half the frames, the eyes not measured (glare, spectacles, half-closed eyes), or too few frames. | Fix the cause (light, seating, glare) and press **Try the eye baseline again**. **Continue without blink measures** is allowed, but only as a deliberate choice. |
| *Gaze check incomplete* | Only the on-screen ratio — a quality check — is affected. The baseline was measured and every blink is counted. The reason is on the screen: a dot where the eyes were not found often enough (✗ on the tick row), or, with every dot ticked, eyes that did not move far enough between the two ends of the line (the head turned instead, or the eyes did not follow the dot). | Press **Repeat the gaze check** (the three dots only), or **Continue**. |

The old calibration (nine tap targets on a dark screen) failed in good light on the study tablet: at
55 cm the eye moves only a few camera pixels between targets, and the vertical direction almost never
passed. Its failure screen also said the primary outcome would be empty when only the gaze part had
failed. That is gone.

**If the tablet is turned to portrait while the dots are running**, or while the camera-check dot is
flashing, the app **stops that step** and keeps nothing from it: with the tablet on its side the
camera sees the face turned through 90 degrees. The screen says so. Turn the tablet back; the
step's start screen returns with a note, and you press **Begin calibration** (or **Start**) to run it
again from the beginning. On the other set-up screens, turning the tablet loses nothing.

---

## 5. Running the ten conditions

Each condition runs the same six measured stages, in this order:

| Stage | What happens | Your job |
|---|---|---|
| `READING_TASK` | Three pages, about 585 words, in the active condition | **Silence.** This is the measurement window. |
| `COMPREHENSION` | Three questions: gist, inference, detail | Do not hint. Do not confirm answers. |
| `DISPLAY_PERCEPTION` | Comfort and clarity: two rating lines to tap | Do not comment on the display. |
| `POST_FATIGUE` | Five visual-fatigue items, each a rating line from "None" to "Severe" | Let them answer at their own pace. Do not mention numbers. |
| `VISUAL_SEARCH` | Tap every occurrence of a target word, fixed time limit | Do not point. |
| `REACTION_TIME` | Go/no-go, 32 trials; the dot appears at one of eight places around the central cross. The card asks the participant to keep their eyes on the cross between dots | Before **Start**, check the participant's hand rests just below the bottom edge of the screen, as the card asks: a hand on the screen covers the lower dots. Then nothing: do not repeat or add to the card's words, which are the same in every condition. |
| `ADAPTATION` | Neutral grey field. A **Continue** button appears after 30 s; the field moves on by itself at 60 s (120 s when polarity switches) | Let the participant decide when to continue after 30 s. Do not prompt them to hurry: how long they rest is recorded (`adaptation_ms_before`, `adaptation_ended_by`) and analysed. |

**The rating lines (from Round 84).** The fatigue and comfort/clarity ratings are 10 cm lines, not
sliders:

- Each line is drawn **100 mm long on the glass**, using the ruler check from pre-flight. Skip the ruler
  check and the app uses the tablet's published screen size instead, and records that it did.
- There is **no marker until the participant taps**. They tap where it feels right, and can tap again or
  slide to change it.
- **No numbers are shown.** If asked what a position means, say only: *"Anywhere between the two ends
  — wherever it feels right."*
- Continue stays grey until every line is marked.
- In the data each row says which kind of rating made it (`slider_version`: `vas-v2` for the line,
  `sl-v1` for the old sliders). Do not mix the two in one study: switch before data collection.

`ADAPTATION` runs a grey field **before the first condition** and then after every condition except
the last, so it appears ten times across the ten conditions. The one before the first exists because
without it condition 1 would begin from the light cream setup screen: a dark-background condition
would start light-adapted while a light-background one started already matched, making adaptation
state at the start of the sitting depend on the very factor the study is trying to isolate.
The ratings come immediately after reading, while the impression is fresh, and before the search and
reaction-time tasks.

A self-paced rest break is offered **after every two conditions**. Let the participant take it.

**Pausing.** During a display, the **Pause** button at the top left exits to the Session Manager and
the session resumes later. It is outlined in the display's own colour, with no fill, so it adds
nothing to the display. It asks first, in a box drawn in the display's own colours: **Pause and exit**
leaves, **Keep going** carries on. Answer the box promptly — while it is open it covers part of the
screen, and that time is recorded against the display (`condition_notice_ms`). Where you pause
matters, and the box tells you which case you are in: pausing *during* a condition restarts that
condition on resume, so its measurements are taken again; pausing on the grey rest screen keeps the
condition you have just finished and resumes at the next one. Pause is offered on the reaction
task's instruction card, disappears when the participant taps **Start**, and comes back once the last
dot has been shown, while the results are saved.

**The researcher panel** sits at the bottom left. On set-up, break and closing screens it is a dark
chip with the sitting clock and a coloured camera dot; tap it for the full panel, which takes a
column at the left and moves the screen's content over rather than covering it. With the camera on,
the full panel opens with whether anything is being recorded now (*Recording: …* or *Live only — not
recorded*; see §1), the **live picture** (the same picture as camera set-up, with the eyelid points),
the ten-second eye-openness trace and the three rates — camera, tracker, eye sampling — and then the
blink counts: *this reading* while one runs, *last reading* on the screens after it (the count the
data hold). *On screen now* says whether this frame passes the gaze check's test (— with no passed
gaze check, or the eyes closed). It can be opened on the calibration and camera-check screens before and after the
dots run, which is where to look when one of them has just failed. It never shows the picture on a
display screen: there the participant would be watching their own face. During a display, on
the grey field, and while the calibration, the camera self-test or the colour-vision plates run, it
is only a small square outline in that screen's own colour with a dot inside — no clock, no colour
of its own, no words. A **filled** dot means the camera is working (or off by consent); an **empty
ring** means a problem that has lasted: the camera stopped or sees black, no frames, no face for 8
seconds, or blinks not being counted because calibration fitted no eye baseline. A face lost for a
moment does not change it. Before calibration the panel says *eye baseline is measured at
calibration*, and after a good calibration *blinks are counted from the first reading*; neither is a
problem (version 2.3.0 onwards; earlier builds showed both in red as "no eye baseline"). On the reading
pages and the grey field a tap opens a two-line strip in the bottom-left corner with the details (on
a reading page the time it is open is recorded against the display); on the questions, the ratings,
the word search and the reaction task it cannot be opened, because there it would sit where the
participant answers or looks. While the reaction-time trials run — from **Start** to the last dot —
it is not shown at all, because it is drawn in the display's own colour and that is the colour the
participant is looking for; it is back when "Block complete" appears. While the calibration dots,
the camera self-test or the colour-vision plates are running it does not change at all. The
camera-stopped and black-picture notices are what to act on, and they still appear by themselves —
during the reaction task, on its instruction card and once the trials are over.

On the **break** screen the way out is the same white **Exit — resume later** button as in set-up;
the display just finished is kept and the sitting resumes at the next one. The break is the best
place to stop. If the app has stopped being the installed full-screen app since you last confirmed
it, the break shows the display check too, and *I'm ready — continue* waits until it is ticked. The small grey line at the top right of the break names the display that comes
**next** ("Next: Display 3 of 10").

**Things you must not do, at any point:**

- Give performance feedback of any kind. Not "well done", not "you got that one". Feedback changes
  effort, and if it varies across conditions it becomes a condition effect.
- Comment on the display, its colours or its readability. Do not agree that one is nicer.
- Coach, hint, or answer questions about the content of a passage.
- Let the participant skim to finish faster. The app flags skimming, but a flagged condition is a
  condition you may have to discard.

**Lux checkpoints.** Illuminance is logged three times: `start`, `middle` and `end`. The app will
prompt you. Take the reading properly each time, at the eye position, and enter what the meter says
— not what it said an hour ago. Room light drifts, and a session verified once at the start and
never re-checked is a session where you do not know what the illuminance was.

---

**Do not let the tablet leave the app during a condition.**

Aeroplane mode and Do Not Disturb are on the pre-flight list for this reason, but the common causes
are closer to hand: answering a message on the tablet, the operator opening something to check a
detail, or the screen timing out while a participant reads slowly.

It costs more than the seconds it takes. A backgrounded tab has its timers slowed down by the
operating system, so every timed measure in that condition — the visual-search limit, the response
times, and the whole reaction-time block, whose trials are about a second each — records the
throttling rather than the participant. The app now records how long and how often this happened
for each condition, and the integrity report flags the condition rather than silently keeping it.
If it does happen, note it on the session sheet; do not re-run the condition.

---

**If a red bar appears saying the device has run out of storage**

Stop the sitting. Not at the end of the condition — now. From the moment that message appears
nothing the participant does is being recorded, and the tablet is the only copy, so the rest of the
sitting would be work done for nothing.

What is already saved is safe. Export the sessions on the tablet, copy the files off it and open
them to check they are really there, then delete those sessions from the Session Manager to free
space. Re-run the pre-flight check before starting anyone else; it reports free space and will block
you if there is not enough.

Prevent it rather than meet it: export and clear the tablet regularly instead of letting sessions
accumulate. Video consent is what fills a tablet — a three-minute clip is larger than everything
else a sitting produces put together.

---

## 6. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| No camera permission prompt at all | Page is not on a secure origin | **Stop.** The camera cannot work. See DEPLOYMENT.md section 2. Do not run the session. |
| Permission denied by mistake | Participant or previous operator tapped Block | Site settings → allow camera → reload → resume. |
| Face not detected at setup | Too dark, too far, backlit, camera covered | Check the lens, the distance, and that the participant is not silhouetted against a lamp. |
| "Low frame rate" or a QC warning | Read **which** rate is low (camera set-up, the camera check's result, or the researcher panel) | *Camera delivers* low: more light on the face, close other camera apps. *Tracker processes* low: close other apps, charge, let it cool, use the fastest tracker. *Eye sampling rate* low (the face found in too few frames): seating and light. Under 20 face frames a second a reading is flagged *reduced*; under 15, *too slow* (its blink data are exploratory only). |
| Glasses reflecting the screen | Lamp or screen reflecting off the lenses | Tilt the tablet slightly, or move the lamp. Do not ask them to remove correction. |
| App reloads mid-session | Browser reclaimed memory, or the tablet slept | Reopen. Session Manager offers **Resume** for every session still in progress, each at its own next condition. Data already written is safe. Note the interruption. |
| After a resume, the app asks for the camera and runs calibration again | Expected | The blink thresholds are fractions of *this participant's* own open-eye baseline, and a reload clears it. Re-running calibration is required for the resumed conditions to carry any ocular data at all. Take it at the normal pace. |
| Battery low | Not charged | Plug in. Do not let it die mid-condition. |
| Participant wants a break outside the scheduled one | Fatigue, discomfort | Allow it. Take it **between** conditions, never inside the reading task. Note it. |
| Participant withdraws | Their right, at any time | Stop immediately. Do not ask why. **Then ask one question: "Would you like the data from this session deleted?"** The consent form they signed says it can be, so this must be offered, not waited for. **If yes:** Session Manager → the session → **Delete** → open the **Recycle bin** → **Purge**. Then delete any media files and any `backup_*.json` for that session already copied off the tablet — Purge cannot reach those. **If no:** Session Manager → press **Withdrew** on that session FIRST, then **Export** it from the **Withdrawn** list. In that order: the export then carries `withdrawn = TRUE`, which is what makes both analysis templates and the pooled export leave the participant out — an export taken before the button is pressed carries `withdrawn = FALSE` and reads like an ordinary paused sitting. Pressing it also destroys any photographs or video, and the sitting can no longer be resumed. The measurements are kept. If an export was already taken before the button was pressed, take it again and discard the earlier one. The mark travels with the data and survives a restore from a backup, so the sitting cannot re-enter the analysis by accident — but copies of media files already taken off the tablet are not covered, so delete those by hand. |
| Participant reports significant symptoms | | Stop if they wish. Advise a full optometric examination. Record it. |
| Export says **"The data files were not written"** | The sitting's participant code is longer than the 20 characters the app gives, so the record was changed or damaged after it was made | Press **Save the backup file**. It keeps every measurement. Send it to the investigator with a note. The sitting stays on the tablet and is not deleted automatically. |

---

## 7. Ending the session

1. The app runs the closing CVS-Q and the NASA Task Load Index. Let it finish; a session closed
   early loses the key secondary outcome, which is the change in CVS-Q from baseline. The sitting is
   recorded as complete the moment the last Task Load Index slider is submitted, so closing the app
   on the thank-you screen no longer leaves it looking unfinished. If the participant has to stop
   during these two questionnaires, use **Exit — resume later**: Resume returns to the questionnaire
   that was not yet answered, and a questionnaire already answered is not asked again.
2. Take the closing setup photograph if that grant was given.
3. **Export.** Dashboard → Export. This writes 20 CSVs (two of them, 07b and 07c, are per-blink validation files the main analysis does not need), an analysis JSON, a codebook, a provenance
   manifest and a `backup_*.json`. A full camera sitting comes to about 6 MB, most of it `07c`; the
   backup alone is about 2 MB. If the session was consented for photographs or video, a second
   button, **Download media files**, writes the picture and video files themselves; they are not in
   the data bundle. Each is named in `15_media_inventory.csv`, so a file can always be traced back
   to the condition and the consent it was taken under. Those files show the participant's face:
   keep them under the terms of the grant that was given, not with the CSVs.

   A session that did **not** finish can be exported too — Session Manager → **In progress** →
   **Export**. It carries `session_complete=false` and only the conditions that actually ran.
4. **Check the export before the participant leaves the building.** Open:
   - `16_integrity_report.csv` — should read `all_checks_passed`. Anything else, read it.
   - `12_quality_flags.csv` — look at `engagement_flag` and `reasons`.
   - `01_session_info.csv` — confirm `lux_complete` and that the three readings are what you took.
   - `07_eye_metrics.csv` — confirm `camera_active` is true and `face_presence_ratio` is high.
   - On the tablet, Dashboard → **Data Quality / QC** — how many conditions are **✕ Not usable**,
     and the reason under each (see *Reading the dashboard*, below).
5. **Copy the export off the tablet the same day.** Not at the end of the week. Everything lives in
   the tablet's browser storage until you do, and a wiped or failed device destroys it.

   **For the analysis, the per-sitting folders are not enough on their own.** The analysis templates
   decide who may be analysed from the pooled export's verdict: Dashboard → **Download analysis
   dataset ↓** writes `analysis_long.csv`, `analysis_join_report.csv` and their companions. Take it from
   the tablet after the last sitting has been collected and put its folder beside the per-sitting
   folders. Without it, both templates stop and say so (`[NO VERDICT]`); with two of them, they stop
   too (`[TWO VERDICTS]`) — keep only the latest. A sitting exported into two folders also stops the
   run (`[DUPLICATED EXPORT]`), naming both. Keep a template's whole printed output with any result
   taken from it: it opens with a `PROVENANCE` block — the R or Python version, the package versions,
   the template's own checksum and the builds that collected the data — which is the only record of
   how those numbers were produced.
6. There is no second session to book. If the sitting had to be **split** for scheduling, book the
   remaining half as soon as the participant can manage — the ten conditions belong to one
   protocol, and a long gap between halves adds a period effect the design does not model.

**Reading the dashboard** (Round 83). Every tab opens with a short blue box, *How to read this
page*. Long explanations are folded: a line or two is shown, and **More ▾** opens the rest. Nothing
was removed; it is one tap away.

On **Data Quality / QC**, *Is the blink data reliable?* gives each reading condition one row and one
verdict. The verdict follows the analysis's own checks (rule `rel-r1`), so it says what the analysis
will do with that condition:

| Verdict | What it means | What the analysis does |
|---|---|---|
| **✓ Good** | Every check passed. | Uses it. |
| **! Usable** | One check is flagged: eye sampling rate 15–20 a second, or more than 2 from this participant's usual; face in view under 90%; head turned away over 20% of the time; the camera saw under 90% of the reading. | Uses it, and leaves it out of one pre-planned re-check. |
| **✕ Not usable** | The camera was off or stopped; no blinks were counted (for example, no open-eye baseline at calibration); or the eye sampling rate was under 15 a second. | Leaves it out of the eye-data analysis. The other measures of that condition (reading, questions, ratings, reaction time) are not affected. |

- Above the rows, **Before the readings** shows the sitting's open-eye baseline, camera check and
  gaze check, each as its own screen judged it. No baseline means no blinks were counted. A gaze
  check that did not pass only means there is no on-screen ratio.
- Each column of the row is one check: **✓** passed, **!** flagged, **✕** failed, **–** not measured.
  The line under the row names the check that was not met. **Details ▾** shows every check: what
  was measured, what was needed, the rule, and what the analysis does.
- A **Note** (few blinks, a dim or over-lit face, the camera covered, the open eye narrower than at
  calibration) is worth knowing but never changes the verdict. **Engagement** is about the
  participant, not the camera, and does not change it either.
- In the three eye charts a **grey** bar is a Not-usable condition: its value is drawn, and the chart
  names it.
- **Every number, as tables ▾** at the bottom of the tab opens the full tables.
- The same verdict is in the export: `ocular_reliability`, `ocular_reliability_checks` and
  `reliability_rule_version` in `analysis_long.csv` and `10_wide_summary.csv`. The older column
  `qc_overall` is still written but is superseded: do not use it.
- What to do: a Not-usable condition is recorded as it is. Use its reason to fix the cause before the
  next participant (camera stopped or no face: seating, the lens, light; rate too slow: the
  troubleshooting row on frame rate, §6; no open-eye baseline: let calibration finish).

**The Session Manager.** The white **← Back to home** button is at the top left, like the way out
on every other screen. In-progress and withdrawn sittings are always listed; **Completed** sittings
are folded away under a heading with their count ("Completed (12) — tap to show") so that the list
stays short as the study grows. The list scrolls: a dark **More below ↓** label at the bottom means
there is more under it. Every button that deletes or changes something asks first in a box whose
buttons say what they do — for example **Move to recycle bin** / **Keep it**, or **Delete
permanently** / **Keep it in the bin**. Read the button, not just its colour.

**If a tablet is lost or wiped:** the `backup_*.json` from the last export restores the session on
any device — Session Manager → *Restore session from backup file*. The plain `session_*.json` is
**not** a backup and cannot restore reaction-time trials; the app will refuse it and explain why.

---

## 8. Split sittings

There is no second session in the standard protocol. A participant attends once and completes all
ten conditions.

The app does offer a **split**, for a participant who cannot sit the full ~100 minutes in one go. It
divides the same ten conditions across two shorter visits. If you use it:

- Choose *split* on the setup screen **before** starting. It cannot be applied afterwards.
- The room is set to **300 lux** for both halves, exactly as for a single sitting. Nothing about the
  lighting changes between them.
- The condition order continues where the first half stopped. Do not restart it, and do not try to
  repeat the first half's order.
- Re-run calibration for the second half. Do not reuse the first half's.
- Keep the gap short. The design treats the two halves as one sitting.

**If the setup screen says the ID already has a record**

Entering a participant ID that already exists now shows what is on file — conditions completed,
sittings, enrolment number — before you can go any further. Read it.

- *Part of the protocol completed* (for example 5 of 10): this is the second half of a split. Carry
  on; the condition order and enrolment number continue from where they stopped.
- *All ten completed*: **stop and check the ID.** Starting anyway runs the entire protocol a second
  time — every passage re-read, every search text already familiar, every comprehension question
  already seen — and those are not first-exposure measurements. Nine times out of ten it is a
  mistyped ID that collided with someone else's.

If the repeat is deliberate — the first sitting was voided, say, because the camera failed
throughout — the app will let you proceed, but only after you type the reason. It is stored on the
session and exported, so write something a stranger reading the data in a year could act on: "first
sitting voided, camera failed throughout", not "redo". If instead the earlier sitting should simply
not exist, delete it in the dashboard first and start clean.

---

## 9. Bench checklist

Print this.

**Before**
- [ ] Daylight excluded; lamp type and colour temperature unchanged from every other session
- [ ] Lux measured at eye position (entered in the app) and display plane (on the sheet), both in range
- [ ] Screen cleaned; brightness fixed; auto-brightness OFF; blue-light filter OFF
- [ ] Screen timeout off; Do Not Disturb on; aeroplane mode on
- [ ] Landscape, fullscreen, launched from home screen
- [ ] Landing page: **Check for updates**; if a newer build is ready, **Update now** before New Session; build line noted on the sheet
- [ ] Viewing distance measured at 50 to 60 cm with a tape, and typed into pre-flight
- [ ] Pre-flight ruler check: bar measured in mm (about 103 mm on the study tablet) and typed in
- [ ] Battery above 80 per cent or on charge
- [ ] Launched from the home-screen icon, NOT a private window; pre-flight storage check reads ok

**Consent**
- [ ] Participation consented in writing
- [ ] Camera measurement offered as a separate, refusable grant
- [ ] Setup photographs offered separately (default no)
- [ ] Annotation video offered separately, validation subsample only (default no)

**Setup**
- [ ] Need to stop? Top-left **Exit — resume later**, never closing the app; mistyped profile → **← Back to the profile** on pre-flight
- [ ] Clinical screening complete; any abnormality recorded and referred
- [ ] Formal colour-vision plates administered, and the result entered in the profile form
- [ ] Camera preview shows a face box, and the yellow points sit on the eyelids
- [ ] Camera set-up: camera, tracker and eye sampling rates read and noted; the sentence under them names no stage as short
- [ ] Calibration completed unhurried
- [ ] Baseline CVS-Q and fatigue done

**During**
- [ ] Silence during every reading task
- [ ] No performance feedback given at any point
- [ ] No comment made about the display
- [ ] Lux logged at start, middle and end, each measured fresh
- [ ] Breaks allowed after every two conditions

**After**
- [ ] Closing CVS-Q and NASA-TLX completed
- [ ] Closing photograph taken if consented
- [ ] Export produced
- [ ] Integrity report reads `all_checks_passed`
- [ ] `camera_active` true; face presence high
- [ ] Export copied off the tablet **today**
- [ ] If the sitting was split, the second half is booked as soon as the participant can manage

Participant code: ............  Sitting: single / split (half 1 / half 2)  Room: 300 lux (250–350)

Operator: ............  Date: ............  Deviations: ...............................
