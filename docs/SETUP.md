# Setup

Everything below is optional. The app runs end to end with no accounts at all — see the
[quickstart](../README.md#try-it-in-a-minute).

The server binds to loopback. Keep it local.

|                        | URL                                           |
| ---------------------- | --------------------------------------------- |
| Panel (dev)            | http://localhost:5173/panel                   |
| Overlay (dev)          | http://localhost:5173/overlay                 |
| Panel (production)     | http://localhost:8787/panel                   |
| **OBS browser source** | **http://localhost:8787/overlay** — 1920×1080 |
| OAuth callback         | http://localhost:8787/auth/callback           |

In development Vite proxies `/api`, `/ws`, `/auth`, `/tts` and `/frames` to port 8787; changing
`PORT` also means updating the Vite proxy. Production serves `web/dist` and every integration from
one port. Runtime settings persist in SQLite and take precedence over environment defaults for OBS
scene names.

---

## AI and speech

```sh
cp .env.example .env
```

Set `OPENAI_API_KEY` and restart. Leave `SIM_MODE=true` to rehearse with real AI against a
simulated Twitch and OBS.

| Variable                  | Default             |
| ------------------------- | ------------------- |
| `OPENAI_MODEL_FAST`       | `gpt-5-mini`        |
| `OPENAI_MODEL_SMART`      | `gpt-5`             |
| `OPENAI_TRANSCRIBE_MODEL` | `gpt-4o-transcribe` |
| `OPENAI_TTS_MODEL`        | `gpt-4o-mini-tts`   |
| `TTS_VOICE_JUDGE`         | `onyx`              |
| `TTS_VOICE_DA`            | `ash`               |

Boot checks model availability and names the exact variable to change when one is unavailable. TTS
instructions are omitted for legacy `tts-1` models.

Every role uses strict JSON-schema output with matching Zod validation. Total role deadlines are
6s clerk, 15s script, 8s rebuttal and 6s verdict, with at most one retry inside that budget; the
runner further limits rebuttal generation to four seconds to reserve readable delivery time.
Captions appear immediately after moderation without waiting for TTS, and generated audio plays
only if it fits the remaining phase deadline. Fixed jury and verdict announcements are cached. The
jury verdict is announced immediately while AI prepares sentence flavour and precedent.

**Quotes are read from SQLite, never generated.** Candidate transcript IDs, precedent IDs and
sentence IDs are all validated server-side. No valid evidence means dismissal. A failed moderation
service rejects unsafe or unknown filings, or falls back to original written dialogue rather than
displaying unreviewed generated text.

## Microphone and transcription

Open **Transcript → Start mic** and allow access on localhost. Keep the panel open.

It records standalone complete files every `CHUNK_MS` (default 6000), skips quiet chunks using RMS
energy, and uploads to the transcription endpoint. **Stop mic** flushes the final chunk. The panel
reports recording heartbeats, unverified or failed transcription, and unavailable capture
separately — the overlay never equates a missing transcript with a silent defense. Heartbeats
expire after ten seconds without a live panel. Start mic is disabled when transcription is not
configured, and manual lines work offline.

Defense capture uses each segment's recording start timestamp, including chunks that arrive after
the defense window closes. Rebuttal uses the transcript available at the deadline; later chunks
still join the saved defense and the verdict input.

## Twitch

1. Register an application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps),
   category **Chat Bot**, with **http://localhost:8787/auth/callback** as the exact OAuth redirect
   URI.
2. Put `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_CHANNEL_LOGIN` and the same
   `TWITCH_REDIRECT_URI` in `.env`. Set `SIM_MODE=false`; keep `DRY_RUN=true` for the first live
   rehearsal. Restart.
3. Open **Diagnostics → Connect broadcaster**. Log in as the channel owner and grant scopes.
   `TWITCH_CHANNEL_LOGIN`, if configured, must match that account.
4. Optionally **Connect bot** while logged in as a separate bot account, then `/mod your_bot_login`
   in chat. Without a bot, the broadcaster reads and sends chat.
5. Tokens are stored atomically in `data/tokens.json` with mode 0600 and refreshed with Twurple.
   Both accounts share the callback; single-use OAuth state identifies and binds the account flow.
6. Inspect the connection lights and test buttons. `DRY_RUN` logs outgoing Twitch actions in Court
   activity. To execute real actions, set **`DRY_RUN=false` in `.env` and restart**.

**Scopes.** The bot has `user:read:chat`, `user:write:chat` and `user:bot`. The broadcaster has
chat access, `channel:bot`, broadcast and title management, clips and contempt permissions.
Additional `moderation:read` and `channel:read:vips` let the server verify protected accounts
immediately before timeouts.

**Filing limits.** 5–300 characters, two co-signers by default, a 60-second co-sign window, a
120-second per-user filing cooldown, at most five open cases, and a 120-second gap between trials.
Thresholds scale with unique chatters in the last ten minutes and are adjustable in Settings. The
plaintiff cannot co-sign their own filing. With **auto-approve off**, the streamer or a mod must
approve the formal charge; preparation begins as soon as the clerk admits a case. Vetoed cases
cannot be revived by late AI responses.

**`!sue` requires a verified live broadcast.** In non-simulated mode both filing and trial start
call the Twitch API and refuse to proceed unless the channel is actually live.

**Optional features.** Native polls are supplementary — chat commands remain the canonical vote, so
anonymous poll votes cannot be counted twice. Enable polls or Channel Points in Settings, save, and
reconnect the broadcaster to grant the optional scopes. Twitch Affiliate or Partner access is
required. For Channel Points, create a reward named exactly **File a lawsuit** with user input
enabled. Redemptions skip co-signing but keep screening, filing limits and streamer approval.
Optional-feature failures leave chat filing and voting available.

## OBS

1. Enable **Tools → WebSocket Server Settings → Enable WebSocket server**, port 4455, with a
   password. This app uses protocol v5. Set `OBS_WS_URL` and `OBS_WS_PASSWORD` in `.env`; real OBS
   needs `SIM_MODE=false`.
2. Create a scene called **Courtroom** (or change it in Settings). Add your gameplay or camera
   sources _below_ a browser source.
3. Add a browser source at **http://localhost:8787/overlay**, 1920×1080. Enable browser-source
   audio and use **Control audio via OBS** if you want a separate mixer channel. Keep the source
   running rather than shutting it down when hidden. Load `/overlay?debug=1` to inspect layout
   bounds.
4. Place the camera underneath the browser source at **x=1180, y=400, width=600, height=450**. The
   defendant window is transparent, including the courtroom background cutout. The rectangle is
   editable in Settings.
5. The server remembers the active scene before a trial, switches to the Courtroom scene and
   restores on adjournment or mistrial. If OBS disconnects, restoration is deferred and persisted
   for reconnect and boot recovery.
6. Set an `OBS_SCREENSHOT_SOURCE` — prefer the gameplay source, avoiding recursive browser captures
   — or leave it blank for the current program scene. Every 10 seconds by default the app stores a
   640px JPEG, retains three hours, and picks the nearest within 20 seconds for each exhibit.
   Missing frames show **NO PHOTO ON FILE**.

The overlay displays full moderated subtitles immediately, plays one matching clip at a time, drops
obsolete speech on phase or exhibit changes, measures actual audio duration before playback, and
respects reduced-motion preferences. Receipts, camera, phase prompts and captions occupy separate
regions. The last opening receipt stays selected for the defense and a rebuttal receipt gets its
own tab. Long transcripts stay verbatim in a scrollable card with visible page controls — no quote
is rewritten or silently truncated. Click **Enable audio** when previewing in a normal browser if
autoplay is blocked.

---

## Troubleshooting

| Symptom                                     | Check                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port 8787 `/panel` returns 404              | Run `npm run build` before `npm start`; the dev UI is on 5173.                                                                                                   |
| OAuth redirect mismatch                     | Match `TWITCH_REDIRECT_URI` exactly in the Twitch app settings. Both accounts use the same callback. Restart after env changes.                                  |
| Bot cannot read or send chat                | Connect both accounts, mod the bot, verify chat scopes and EventSub status; reconnect to refresh grants.                                                         |
| Native poll or reward fails                 | Affiliate/Partner required. Enable before reauth. Chat votes and plain `!sue` remain as fallback.                                                                |
| Title does not change                       | The simulator and `DRY_RUN` only log. Check the broadcaster connection and `channel:manage:broadcast`.                                                           |
| Title did not restore while `DRY_RUN` is on | Real jobs defer until you disable `DRY_RUN`. Keep `data/court.db` so recovery jobs survive restarts.                                                             |
| OpenAI model unavailable                    | Change the exact variable named in Court activity, verify account access and billing, restart.                                                                   |
| No speech                                   | Check TTS enabled, voice/model access, OBS and browser audio, autoplay. Captions work without audio.                                                             |
| No mic transcript                           | Allow mic on localhost, keep the panel open, check `OPENAI_API_KEY` and the energy threshold — quiet chunks are skipped. Use a manual line to test the pipeline. |
| No screenshot                               | Check the OBS source and scene name, the WebSocket password, timing within 20s, and `FRAME_INTERVAL_MS`. A placeholder is expected in the simulator.             |
| Court scene remains after an interruption   | Reconnect OBS; persisted scene restoration retries. Confirm the original scene still exists.                                                                     |
| SQLite install fails                        | Use a supported Node LTS. Without a prebuilt `better-sqlite3` binary you need Python and C/C++ build tools.                                                      |
| Nothing starts                              | Check court is on, the co-sign threshold, streamer approval, available evidence, and the between-trials cooldown.                                                |

**Do not commit `.env` or `data/`.** Back up the data directory if you want to keep court records
and pending revert jobs. No secrets are written to application logs.

**Do not delete the database to recover from a crash** — it holds title and OBS restoration jobs.
Boot marks interrupted or open cases as mistrial/expired rather than resuming timers unsafely.
