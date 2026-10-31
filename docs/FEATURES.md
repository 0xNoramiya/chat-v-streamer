# Features

## Sentencing

Only penal entries with `approved: true` can run. `title_shame` is approved out of the box; manual
punishments default to unapproved until the streamer edits the validated penal-code JSON. You may
revoke any entry at any time.

The guilty share caps severity: below 60% → 1, 60–79% → 2, at least 80% → 3.

A guilty title sentence saves the original title **before** changing it, schedules a 15-minute
restore, and persists the job. Multiple overlapping real convictions preserve the original
pre-court title and extend the restoration deadline; earlier jobs stay pending until a real
restoration succeeds.

Every job records its execution mode — live, dry-run or simulator — and its channel identity. A
rehearsal never supersedes a real job or supplies a later live sentence's original title. Expired
jobs are processed on boot, including after a crash. Jobs created under `DRY_RUN` cannot turn into
real title mutations after a config change. Restoration of a real job defers while `DRY_RUN` or the
simulator is enabled, or while another broadcaster is connected.

Legacy jobs without reliable provenance are retained for audit. A legacy live obligation is bound
and restored only when the current live title matches its recorded convicted title — the same check
recovers an obligation incorrectly marked reverted by an earlier implementation. Unverifiable
legacy jobs stay visible as pending review rather than risking a live title write.

Mistrial title cancellation is persisted immediately, including during an in-flight action. A
failed restoration retries after reconnect or restart without waiting for the original sentence
deadline. Boot also restores reversible effects of interrupted trials; an earlier sentence that is
still valid remains in force until its own deadline.

Manual sentences appear on the overlay with a countdown and remain in the panel and idle overlay
after adjournment until **Sentence served** is clicked. Guilty verdicts can create live-only clips
and markers; errors are logged without stopping the trial.

Contempt is enabled by default per the demo specification and can be disabled in Settings. It is an
explicit runtime switch and never times out the broadcaster, mods or VIPs. If protected status
cannot be verified, the timeout is skipped.

## Records

Every concluded verdict, including a mistrial, saves a searchable precedent. Records shows
convictions, case law, and plaintiff wins, losses and contempt counts. Future AI scripts receive
the five most relevant precedents and may cite a validated ID.

## Jurisdiction and the raw-text boundary

The court hears only claims about what the streamer said or did on the current stream that voice
transcripts can prove or disprove: gameplay claims, promises, contradictions, predictions,
hypocrisy and taste.

Rejected: personal life, appearance, identity, health, family, money, real-world allegations, third
parties, sexual content, slurs, harassment and spam. Rejections never repeat the raw filing back.

Raw charge text is stored for local audit and shown only in the streamer panel, blurred if
moderation fails. Overlay snapshots omit raw filings, the defense transcript, audit logs and full
transcripts. Stored verbatim exhibits remain moderated receipts.

Receipt eligibility is tied to the verified Twitch channel and broadcast ID, not to the last few
app sessions. Restarting during the same broadcast retains eligible receipts; a new broadcast
cannot retrieve or display old ones. Live filing and trial start verify broadcast identity, and a
broadcast change aborts an active trial. Transcript uploads and frames retain their request's
broadcast even if processing finishes later. Legacy transcript rows without verifiable broadcast
identity are kept for audit and excluded from courtroom evidence; historical precedents remain
searchable separately.

## Comedy desk

On the **Court** panel, the comedy desk sits beside the trial controls. Click a preview to trigger
**POOF**, **BONK**, **SEEING STARS** or **CASE CLOSED** immediately. **SILLY HAT** and **SAD LITTLE
CLOUD** attach until removed.

Pick a prop, set horizontal and vertical percentages and scale, then **Apply position**;
coordinates follow the configured camera rectangle. **Remove prop** removes the selected
attachment. **Clear all effects** removes everything immediately, even with court closed. Mute and
volume apply only to comedy sounds.

Gags stay inside the camera area so receipts, captions and jury commands remain readable. Stars sit
along its upper edge; props have transparent surroundings. Only one large gag and two transient
gags in total can play at once — extra clicks are rejected, never queued. Mistrial clears all
current gags and attachments, including a zero-vote jury, and cancels future sequence steps. There
are no automatic comedy cues.

**Comedy has no effect on votes, case approval, sentences or `DRY_RUN`.** It is a separate state
domain by design.

One-shot events have unique IDs, epochs and server deadlines; they expire locally and are never
included in reconnect snapshots, so explosions cannot replay after a reconnect or restart. Reduced
motion uses static cutouts with the same cleanup deadlines.

### Adding an asset

Place a transparent PNG in `web/public/comedy/` and add an entry to `manifest.json` with a unique
ID, label, path, camera placement, duration, an existing animation preset, optional sound and
cooldown. The shared schema validates the manifest and the HTTP commands. The server persists prop
placement, attachments and sound settings in SQLite.

## Head calibration and BONK timing

Expand **Calibrate head** in the comedy desk. Head effects require an explicitly saved calibration
— the app does not guess a head position, and there is no face tracking.

Load a local photo or video, or choose **Use camera preview** (video only). Match the framing you
use in OBS. Drag **Head crown** to the top of the hair, **Head width** to the right edge of the
head, and **BONK contact** to the intended contact point. If markers overlap, choose **Active
marker**; keyboard arrows also move the focused marker. Click **Save head calibration**. Preview
files stay in the browser. **Stop preview camera** releases the camera, including a request still
awaiting permission.

The coordinates are percentages of the camera rectangle and survive reconnect and restart
independently of court settings. Moving or resizing that rectangle moves and scales the props. The
hat attaches by its brim, stars surround the upper head, and the mallet's contact surface reaches
the selected point. Head props use neutral **50% / 50%** position offsets; scale remains
adjustable. Old M8 center-based head offsets migrate to neutral values to avoid covering the face.
Recalibrate if the person or source crop moves.

If there is not enough space above the crown, the desk disables the affected trigger and explains
how much extra headroom is required. Reframe or zoom out in OBS and recalibrate — the app does not
turn a wearable hat into a tiny forehead accessory or crop it silently. Existing attachments pause
visibly when framing becomes unsuitable.

**BONK → stars** performs anticipation and swing, contact at 600 ms with a separate 240 ms burst,
then a short stunned beat before stars at 1,250 ms. The BONK sound is released on the rendered
impact frame rather than scheduled ahead of painting. Standalone BONK and SEEING STARS remain
available. Clear all and mistrial cancel current effects, sound and future sequence steps.
Reconnecting cannot restart or join an existing sequence. Reduced motion keeps the timed contact
burst and cleanup without the swing movement.

## Asset provenance

The six production PNGs in `web/public/comedy/` were generated through authenticated **Higgsfield /
GPT Image 2**, using the original owl as a style reference. The provider returned a painted
checkerboard despite `background=transparent`; it was removed locally and the shipped files have
measured RGBA transparency. No stand-in assets are shipped.

`provenance.json` records generation, cropping, alpha counts and SHA-256 hashes; `ART_DIRECTION.md`
records the prompt, and `BONK_REVISION.md` records the mallet revision. Original squeaks, boings,
impacts and whistles are synthesised with WebAudio. No generated video or franchise media is used.

All other character artwork is original SVG. The owl wears an original judge's wig.
