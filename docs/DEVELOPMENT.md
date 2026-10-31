# Development and verification

```sh
npm run typecheck
npm test
npm run demo:check
npm run build
npx playwright install chromium   # once, for the browser check
npm run browser:check
npm run format:check
npm audit
```

| Command                           | What it does                                               |
| --------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                     | Server on 8787 plus Vite on 5173                           |
| `npm run build`                   | Strict typecheck, then the production bundle               |
| `npm start`                       | Production server, everything on 8787                      |
| `npm test`                        | 100 Vitest tests in 16 files                               |
| `npm run demo:check`              | A complete trial on an injected clock, instantly           |
| `npm run browser:check`           | Chromium against an isolated server and temporary database |
| `npm run rehearsal:check`         | Moving-streamer comedy rehearsal, recorded with FFmpeg     |
| `npm run connected:readiness`     | Presence, status and counters — no secrets                 |
| `npm run connected:check`         | Real OpenAI in an isolated SIM_MODE/DRY_RUN app            |
| `npm run connected:observe`       | Read-only attach to the running real-adapter app           |
| `npm run format` / `format:check` | Prettier                                                   |

## What the checks actually cover

`browser:check` starts an isolated simulator server on a temporary SQLite database, opens both
routes in Chromium, runs the demo, verifies the title sentence and records, checks malformed
settings and the mistrial button, and checks the mobile layout. Its overlay fixtures cover every
phase, three opening receipts plus a rebuttal, long permitted text, quote paging, four camera
layouts, and **every PNG pixel in each configured camera interior**. Screenshots go to `artifacts/`
without touching your local data.

Rule tests cover deadlines, transitions, co-sign thresholds and cooldowns, parser aliases, ties and
zero votes, invalid IDs, FTS, moderation, late transcription, title reverts and protected users,
plus real/dry-run/simulator restarts, legacy obligations, broadcast scoping, delayed providers,
stale speech and capture readiness. Complete operating fixtures cover guilty, acquittal, zero-vote
mistrial and unavailable AI.

OBS protocol fixtures cover restoration after disconnect and restart — these are local fixtures,
not an authenticated OBS session. The official SDK request contract is tested with a fake
transport.

Comedy browser checks use the actual panel buttons for every generated asset, placement and
removal, clear, mistrial and reconnect, and exercise WebAudio nodes and mute cancellation. They
scan PNG alpha before use and after cleanup.

**Authenticated Twitch, OBS and OpenAI behaviour still needs a rehearsal with your own accounts and
OBS instance.** See the matrix in [BUILD_LOG.md](../BUILD_LOG.md).

## Moving-streamer rehearsal

Install FFmpeg and Chromium, build, then:

```sh
npm run rehearsal:check -- /path/to/streamer.mp4
```

With the supplied fixture available, `npm run rehearsal:check` writes
`artifacts/m9-rehearsal/after.mp4`, `before-after.mp4` (when the M8 recording is present),
screenshots and a timing/alpha report. It uses an isolated database, real panel controls and
captured WebAudio. The fixture-only zoom-out simulates OBS reframing; no ignored media is required
by the application.

## Connected rehearsal

Keep `DRY_RUN=true` throughout. Never start a broadcast for the check. Secrets belong in your local
`.env`, never in chat, screenshots or reports.

1. **`npm run connected:readiness`** reports configuration presence, the running app's connection
   status and OBS TCP availability. It does not validate or refresh tokens, send chat, or mutate
   settings. `/api/readiness` contains counts and status only — no prompts, chat text, account IDs,
   tokens or OBS password. Provider success, fallback and cache counters are separate. EventSub
   counters originate inside the real adapter; `/api/chat` and the simulator cannot increment them.

2. **`npm run build && npm run connected:check`** starts one isolated SIM_MODE/DRY_RUN app and
   temporary database with no Twitch authorization client. It exercises all four AI roles,
   moderation, speech and a known recorded-audio transcription through the app, then guilty,
   acquittal and mistrial trials. FFmpeg and `espeak-ng` are prerequisites. Recorded input is local
   synthesised speech, **not physical mic capture**; trial speech comes from OpenAI in this mode.
   Both recorded audio tracks must contain non-silent samples. A missing key exits with code 2 and
   writes a blocked report — a fallback does not become proof of a successful provider call.

3. **`npm run connected:check -- --fixture`** runs the same workflow against a local HTTP protocol
   fixture and local synthesised speech. Its output is explicitly labelled **local fixture**, stored
   separately, and never counts as real OpenAI, transcription accuracy, Twitch or OBS evidence. It
   leaves your working database, tokens, calibration and restoration jobs intact.

   > A Codex OAuth proxy needs a separate capability check. The helper inspected for this build
   > supports authenticated Responses text generation but returns 404 for moderation, speech and
   > transcription. A working Codex login does not supply a Platform API key or prove those
   > endpoints work. Keep moderation fail-closed and report text-only results separately.

4. **Connect Twitch.** Stop the existing app first. Do not copy token files into another running
   app or launch parallel refresh clients; keep the existing single owner of `data/tokens.json`.
   Set `SIM_MODE=false`, retain `DRY_RUN=true`, restart, and connect the broadcaster and optionally
   a separate bot. Existing refresh counters report only refreshes actually observed — loaded
   tokens alone do not prove refresh behaviour. Never delete the database to retry.

5. **OBS.** Create a dedicated rehearsal scene with the browser source and camera arrangement.
   Select its name in Court settings and note the prior setting so you can restore it. Verify
   transparent camera pixels, the hat, BONK → stars, Clear all and Mistrial. Confirm scene entry
   and original-scene restoration, then disconnect, reconnect and repeat. Scene counters represent
   acknowledged requests; visual review in real OBS is still required.

6. **`npm run connected:observe -- http://127.0.0.1:8787 60`** while participants send real Twitch
   chat. This attaches read-only to the one running app and refuses `SIM_MODE` or `DRY_RUN=false`.
   Verify EventSub receipt, then `!sue`, `!cosign`, jury commands and authorized moderator
   controls. Outgoing chat, title, timeout, clip, marker and poll mutations are logged dry runs. If
   Twitch is offline, a real `!sue` must leave the docket unchanged and report that a verified live
   broadcast is required. Simulator commands never prove Twitch identities or votes.

Before live sign-off, separately verify account refresh, physical mic capture, the real OBS
browser-source audio mix, and disconnect/restart recovery. Keep saved restoration jobs — a dry-run
rehearsal cannot fulfil a real title-restoration obligation. The rehearsal scripts never enable
live Twitch actions. Record which rows are authenticated service tests and which are fixtures in
[BUILD_LOG.md](../BUILD_LOG.md).
