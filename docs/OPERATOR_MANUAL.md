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
   at pre-flight. While one is open the notice says which, and waits; finish that sitting first.
   This is why step 1 comes before New Session. Pre-flight also says when a newer
   build is waiting: the sitting you are starting will run, and be recorded, on the build named
   there.
4. If the notice never appears although a newer build has been published (the build line still
   shows the old time after **Check for updates** says it is downloading and you have waited a
   minute): close the app from recent apps and open it again from its icon, then repeat. Only as a
   last resort, and only with every sitting exported and copied off the tablet, clear the site's
   data in Chrome's settings — that deletes every session stored on the tablet.

**Seating**

- Chair and table height fixed. Same setup for every participant.
- Tablet in its stand at a **viewing distance of 50 to 60 cm**. Measure it with a tape, from the
  participant's eye to the centre of the screen, seated as they will read; do not judge by eye.
  **Type the measured distance into pre-flight** (the field starts at 55): every "at distance"
  angle in the export uses it.
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

**Calibration** establishes this participant's own open-eye baseline, gaze mapping and head
posture. Every blink threshold is expressed as a fraction of their baseline, not a population
default, so a rushed calibration degrades every ocular measure for the whole session. Take the time.

It runs in two parts, and the first one matters more than it looks:

1. **A single dot in the centre, six seconds.** The participant looks straight at it, sits as they
   will sit to read, and blinks normally. Do not ask them to hold their eyes open — the measure is
   designed around normal blinking, and a forced stare gives a wider eye than they will ever read
   with. This window alone sets the open-eye baseline, so posture here is the posture the whole
   sitting is scored against: seated square to the tablet, head level, eyes on the dot, not above
   or below it.
2. **The nine targets.** Head still, eyes only. These fit the gaze mapping and nothing else.

If the screen reports that the gaze mapping fitted but no open-eye baseline could be measured, it is
almost always glare across the lid margin — spectacles, a window or a lamp behind the tablet. Move
the light or the tablet and retry before continuing.

**If the tablet is turned to portrait while the dots are running**, or while the camera-check dot is
flashing, the app **stops that step** and keeps nothing from it: with the tablet on its side the
camera sees the face turned through 90 degrees. The dark screen says so. Turn the tablet back; the
step's start screen returns with a note, and you press **Begin calibration** (or **Start**) to run it
again from the beginning. On the other set-up screens, turning the tablet loses nothing.

---

## 5. Running the ten conditions

Each condition runs the same six measured stages, in this order:

| Stage | What happens | Your job |
|---|---|---|
| `READING_TASK` | Three pages, about 585 words, in the active condition | **Silence.** This is the measurement window. |
| `COMPREHENSION` | Three questions: gist, inference, detail | Do not hint. Do not confirm answers. |
| `DISPLAY_PERCEPTION` | Comfort and clarity ratings | Do not comment on the display. |
| `POST_FATIGUE` | Five visual-fatigue items, 0 to 10 | Let them answer at their own pace. |
| `VISUAL_SEARCH` | Tap every occurrence of a target word, fixed time limit | Do not point. |
| `REACTION_TIME` | Go/no-go, 32 trials; the dot appears at one of eight places around the central cross. The card asks the participant to keep their eyes on the cross between dots | Before **Start**, check the participant's hand rests just below the bottom edge of the screen, as the card asks: a hand on the screen covers the lower dots. Then nothing: do not repeat or add to the card's words, which are the same in every condition. |
| `ADAPTATION` | Neutral grey field. A **Continue** button appears after 30 s; the field moves on by itself at 60 s (120 s when polarity switches) | Let the participant decide when to continue after 30 s. Do not prompt them to hurry: how long they rest is recorded (`adaptation_ms_before`, `adaptation_ended_by`) and analysed. |

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
column at the left and moves the screen's content over rather than covering it. During a display, on
the grey field, and while the calibration, the camera self-test or the colour-vision plates run, it
is only a small square outline in that screen's own colour with a dot inside — no clock, no colour
of its own, no words. A **filled** dot means the camera is working (or off by consent); an **empty
ring** means a problem that has lasted: the camera stopped or sees black, no frames, no face for 8
seconds, or blinks not being counted. A face lost for a moment does not change it. On the reading
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
| "Low frame rate" or a QC warning | Tablet under load | Close other apps, reboot, retry. Below about 25 fps the duration-based blink measures are gated off. |
| Glasses reflecting the screen | Lamp or screen reflecting off the lenses | Tilt the tablet slightly, or move the lamp. Do not ask them to remove correction. |
| App reloads mid-session | Browser reclaimed memory, or the tablet slept | Reopen. Session Manager offers **Resume** for every session still in progress, each at its own next condition. Data already written is safe. Note the interruption. |
| After a resume, the app asks for the camera and runs calibration again | Expected | The blink thresholds are fractions of *this participant's* own open-eye baseline, and a reload clears it. Re-running calibration is required for the resumed conditions to carry any ocular data at all. Take it at the normal pace. |
| Battery low | Not charged | Plug in. Do not let it die mid-condition. |
| Participant wants a break outside the scheduled one | Fatigue, discomfort | Allow it. Take it **between** conditions, never inside the reading task. Note it. |
| Participant withdraws | Their right, at any time | Stop immediately. Do not ask why. **Then ask one question: "Would you like the data from this session deleted?"** The consent form they signed says it can be, so this must be offered, not waited for. **If yes:** Session Manager → the session → **Delete** → open the **Recycle bin** → **Purge**. Then delete any media files and any `backup_*.json` for that session already copied off the tablet — Purge cannot reach those. **If no:** Session Manager → press **Withdrew** on that session FIRST, then **Export** it from the **Withdrawn** list. In that order: the export then carries `withdrawn = TRUE`, which is what makes both analysis templates and the pooled export leave the participant out — an export taken before the button is pressed carries `withdrawn = FALSE` and reads like an ordinary paused sitting. Pressing it also destroys any photographs or video, and the sitting can no longer be resumed. The measurements are kept. If an export was already taken before the button was pressed, take it again and discard the earlier one. The mark travels with the data and survives a restore from a backup, so the sitting cannot re-enter the analysis by accident — but copies of media files already taken off the tablet are not covered, so delete those by hand. |
| Participant reports significant symptoms | | Stop if they wish. Advise a full optometric examination. Record it. |

---

## 7. Ending the session

1. The app runs the closing CVS-Q and the NASA Task Load Index. Let it finish; a session closed
   early loses the key secondary outcome, which is the change in CVS-Q from baseline. The sitting is
   recorded as complete the moment the last Task Load Index slider is submitted, so closing the app
   on the thank-you screen no longer leaves it looking unfinished. If the participant has to stop
   during these two questionnaires, use **Exit — resume later**: Resume returns to the questionnaire
   that was not yet answered, and a questionnaire already answered is not asked again.
2. Take the closing setup photograph if that grant was given.
3. **Export.** Dashboard → Export. This writes 18 CSVs, an analysis JSON, a codebook, a provenance
   manifest and a `backup_*.json`. If the session was consented for photographs or video, a second
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
- [ ] Camera preview shows a face box
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
