# Operator manual

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
- Set the room to the level for *this* sitting:
  - **Dim: 10 lux** (acceptable 5 to 15)
  - **Moderate: 150 lux** (acceptable 130 to 170)
- Measure with the lux meter at **two points**: the participant's eye position, facing the display,
  and the display plane. If either is outside the accepted range, adjust the lighting before the
  participant arrives, not during the session. The app has one lux field and it is the **eye-position**
  reading; record the display-plane reading on the session sheet.
- Keep the lamp type and colour temperature identical between the two sittings. Only the
  illuminance is meant to differ.

**Tablet**

- Clean the screen.
- Brightness fixed at the study value. **Auto-brightness off.**
- **Night Shift / Night Light / blue-light filter off.** These change the rendered colour of every
  condition, which is the independent variable, and they invalidate the red-green colour-vision
  plates.
- Screen timeout disabled. Do Not Disturb on. Aeroplane mode on.
- Landscape, fullscreen, launched from the home-screen icon.
- Battery above 80 per cent, or keep it on charge.
- **Never run a session in a private or incognito window.** The data is thrown away when the window
  closes and nothing warns you at the time. Always launch from the home-screen icon. Pre-flight
  checks this and will refuse to start if it finds ephemeral storage; if it does, close the window
  and reopen the app properly rather than trying to continue.

**Seating**

- Chair and table height fixed. Same setup for every participant.
- Tablet in its stand at a **viewing distance of 50 to 60 cm**. Measure it; do not judge by eye.
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
   If a participant changes their mind, that is a change of consent and has to be taken again from
   the consent screen.
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

Alongside the app, complete the clinical screening: visual acuity, non-cycloplegic refraction, cover
test, near point of convergence.

**Eligibility.** The profile form accepts ages **18 to 35**, the protocol's range. Contact-lens wear
on a test day and colour-vision deficiency are exclusions, and the app records them as such: a
participant who reports either is written out with `eligible=false` and the reasons listed, so the
confirmatory analysis can drop them. Enter what is true rather than what will let you proceed.

**If screening turns up an abnormality** — reduced acuity, uncorrected refractive error, a binocular
anomaly, a colour-vision deficiency:

- Record it. It is a covariate, and for colour vision it bears directly on the text-colour factor.
- Tell the participant, in plain terms, and give them written advice to seek a full optometric or
  ophthalmological examination.
- Log it as an incidental finding. Do not treat, and do not reassure beyond the referral.

**Calibration** establishes this participant's own open-eye baseline, gaze mapping and head
posture. Every blink threshold is expressed as a fraction of their baseline, not a population
default, so a rushed calibration degrades every ocular measure for the whole session. Take the time.

---

## 5. Running the ten conditions

Each condition runs the same six measured stages, in this order:

| Stage | What happens | Your job |
|---|---|---|
| `READING_TASK` | Four pages, about 600 words, in the active condition | **Silence.** This is the measurement window. |
| `COMPREHENSION` | Three questions: gist, inference, detail | Do not hint. Do not confirm answers. |
| `DISPLAY_PERCEPTION` | Comfort and clarity ratings | Do not comment on the display. |
| `POST_FATIGUE` | Five visual-fatigue items, 0 to 10 | Let them answer at their own pace. |
| `VISUAL_SEARCH` | Tap every occurrence of a target word, fixed time limit | Do not point. |
| `REACTION_TIME` | Go/no-go, 32 trials | Nothing. |
| `ADAPTATION` | Neutral grey field, 60 s (120 s when polarity switches) | Nothing. Let it run. |

`ADAPTATION` closes each condition rather than opening it, and it is skipped after the last one, so
it runs nine times across the ten conditions. There is no grey screen before the first condition.
The ratings come immediately after reading, while the impression is fresh, and before the search and
reaction-time tasks.

A self-paced rest break is offered **after every two conditions**. Let the participant take it.

**Pausing.** The ⏸ Pause button exits to the Session Manager and the session resumes later. Where
you pause matters, and the confirmation box tells you which case you are in: pausing *during* a
condition restarts that condition on resume, so its measurements are taken again; pausing on the
grey rest screen keeps the condition you have just finished and resumes at the next one. Prefer the
rest screen.

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
| Participant withdraws | Their right, at any time | Stop immediately. Do not ask why. Session Manager → the session under **In progress** → **Export**. The export records the sitting as incomplete and lists only the conditions that ran. |
| Participant reports significant symptoms | | Stop if they wish. Advise a full optometric examination. Record it. |

---

## 7. Ending the session

1. The app runs the closing CVS-Q and the NASA Task Load Index. Let it finish; a session closed
   early loses the key secondary outcome, which is the change in CVS-Q from baseline. The sitting is
   recorded as complete the moment the last Task Load Index slider is submitted, so closing the app
   on the thank-you screen no longer leaves it looking unfinished.
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
6. Book session 2 for **48 to 72 hours** later, at a similar time of day.

**If a tablet is lost or wiped:** the `backup_*.json` from the last export restores the session on
any device — Session Manager → *Restore session from backup file*. The plain `session_*.json` is
**not** a backup and cannot restore reaction-time trials; the app will refuse it and explain why.

---

## 8. Session 2

Same participant, same everything, except:

- The **other** illumination level. The app knows which and assigns it; do not override.
- The condition order is different by design. Do not try to repeat session 1's order.
- Re-measure and re-set the room to the new level before they arrive.
- Re-run calibration. Do not reuse session 1's.

---

## 9. Bench checklist

Print this.

**Before**
- [ ] Daylight excluded; lamp type unchanged from the other sitting
- [ ] Lux measured at eye position (entered in the app) and display plane (on the sheet), both in range
- [ ] Screen cleaned; brightness fixed; auto-brightness OFF; blue-light filter OFF
- [ ] Screen timeout off; Do Not Disturb on; aeroplane mode on
- [ ] Landscape, fullscreen, launched from home screen
- [ ] Viewing distance measured at 50 to 60 cm
- [ ] Battery above 80 per cent or on charge
- [ ] Launched from the home-screen icon, NOT a private window; pre-flight storage check reads ok

**Consent**
- [ ] Participation consented in writing
- [ ] Camera measurement offered as a separate, refusable grant
- [ ] Setup photographs offered separately (default no)
- [ ] Annotation video offered separately, validation subsample only (default no)

**Setup**
- [ ] Clinical screening complete; any abnormality recorded and referred
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
- [ ] Session 2 booked for 48 to 72 hours later

Participant code: ............  Session: 1 / 2  Illumination: dim / moderate

Operator: ............  Date: ............  Deviations: ...............................
