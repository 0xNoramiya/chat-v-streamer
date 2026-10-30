# Build log

## Plan

1. M1: runnable offline court, SQLite, reducer/runner, docket/votes, simulator, overlay/panel and instant full-trial checks.
2. M2: strict OpenAI roles, retrieval, moderation, TTS, bounded fallbacks and evidence validation.
3. M3: standalone mic chunks, manual transcript and defense capture.
4. M4: Twitch OAuth/EventSub, actions, persistent title restoration and DRY_RUN.
5. M5: OBS reconnect, screenshots and scene restoration.
6. M6: records, settings, sound/motion, optional Twitch features and complete setup docs.

## Initial decisions

- Build the requested local repository application, with no hosted-service dependency.
- Default to simulator and DRY_RUN; real AI can be used independently of simulator Twitch/OBS.
- Default streamer display name is Noramiya, editable in settings.
- Demo uses a short timing profile; ordinary trials use the specified timers. Automated demo uses an injected clock.
- Codex is implementing and validating all milestones autonomously; no subagents are used.

## M1 — Offline end-to-end

+- Built strict TypeScript skeleton, Express/ws, SQLite/FTS5 schema, pure trial reducer, injected-clock runner, filing/co-signing/cooldowns, jury, sentencing and simulator adapters.
+- Built original SVG owl, CSS courtroom with transparent defendant window, captions, exhibit cards, verdicts, docket ticker, responsive panel, simulator, manual record and full demo.
+- Decisions: demo follows configured normal timings; use Skip phase or injected-clock `demo:check` for speed. Only title_shame is approved by default; manual punishments require an explicit settings approval. No unscreened chat is included in overlay snapshots.
+- Initial workspace mounted `.git` read-only. Permissions changed during work; moved temporary metadata back to `.git` and normal commits are now available.
+- Validation: 9 Vitest tests pass; full demo reports all eight phases, 5–2 guilty, defense capture, automatic title sentence, scene restore and precedent; strict typecheck and production build pass.
+- Codex implemented the slice and used installed package types plus official OpenAI docs to prepare M2. No external credentials used.

## M2 — Real AI

+- Added official OpenAI SDK Responses calls with strict JSON schemas generated from matching Zod schemas, one bounded retry, role prompts, moderation/local blocklist, candidate/precedent/sentence ID validation and word-boundary length handling.
+- Added current-session recent-window + previous-two-session FTS retrieval, moderated verbatim candidate selection, TTS mp3 caching and queued-case audio pre-generation. OPENAI_API_KEY enables AI independently of Twitch/OBS simulation.
+- Read installed SDK declarations for Responses `text.format`, model listing, speech instructions, audio uploads and moderation; checked official structured-output documentation at https://developers.openai.com/api/docs/guides/structured-outputs.
+- Decisions: when moderation is unavailable in live AI mode, generated content fails closed to original canned lines. Offline clerk is deliberately conservative. Invalid evidence dismisses; invalid sentence IDs fall back to an approved severity-appropriate sentence.
+- Validation: 15 tests pass including invalid IDs, invalid precedents, length bounds, local moderation and cross-session FTS; complete offline demo and production build pass. Real API execution requires user credentials and has not been represented as tested.
+- Codex wrote integrations after inspecting installed declarations; upgraded Zod to address the dependency audit. A Vitest upgrade is in progress to address its audit findings.

## M3 — Transcription

+- Added MediaRecorder restart-per-chunk capture, RMS silence skipping, bounded pending uploads, multipart size/type/timestamp validation, official SDK transcription and live transcript broadcasts.
+- Manual lines work offline. Mic uploads explain the missing OpenAI key; no fake transcription is generated.
+- Defense uses actual phase entry/exit times, including skipped phases; late chunks are captured based on recording start time rather than arrival time.
+- Validation: 17 tests, complete offline demo, strict build all pass. Mic hardware/API requires credentials and browser permission. Installed Vitest latest passed but declared newer Node engines; pinning the audited v4 release to preserve Node 20 support.
+- Codex implemented browser recording and ingestion after reading the installed transcription declarations.

## M4 — Twitch live adapter

+- Added local OAuth authorization-code flow for broadcaster and optional bot, one-use state with browser binding, atomic mode-0600 tokens, RefreshingAuthProvider, EventSub chat/badge parsing, deduplication and subscription recovery.
+- Added paced bounded outgoing chat, title mutations, protected contempt timeout, live-only clip/marker, getStream, DRY_RUN and panel diagnostic buttons. Title test has a 30-second persisted restore job.
+- Revert jobs preserve the original pre-conviction title across successive trials. Simulated jobs cannot become real mutations after toggling DRY_RUN; actual jobs defer restoration while DRY_RUN is on. Mistrial cancels outstanding sentence jobs.
+- Decisions: request moderation:read and channel:read:vips in addition to specified scopes so timeout protection can be checked authoritatively. If checks fail, skip the timeout. Native polls remain supplementary to canonical per-user chat votes, avoiding double counting; optional rewards match the exact title “File a lawsuit”.
+- Read Twurple declarations for auth, EventSub and every Helix call and official Twitch WebSocket documentation at https://dev.twitch.tv/docs/eventsub/handling-websocket-events/.
+- Codex implemented the adapter and credential-free contract tests. Authenticated Twitch actions require accounts and a live broadcast; these are not claimed as exercised.

## M5 — OBS

+- Added real OBS WebSocket v5 connection/reconnect, bounded requests, serialized scene transitions, persisted original-scene recovery and deferred restoration if OBS disconnects during a mistrial.
+- Added 640px JPEG capture, three-hour pruning, nearest screenshot within 20 seconds and stored exhibit/frame associations; absent OBS or frames uses the original placeholder.
+- Read installed request/response declarations and official obs-websocket-js/protocol documentation before authoring requests.
+- Validation: strict build, 21 tests including screenshot matching bounds, complete offline trial; actual OBS requires an OBS instance and has not been claimed as tested.
+- Codex implemented the real adapter and ring buffer; no downloaded art or audio.

## M6 — Records, settings and presentation

- Added visible precedent citations, conviction records and plaintiff leaderboard; editable validated penal-code JSON plus forms for every runtime rule, timer, OBS source, camera rectangle and optional feature. Manual sentence countdowns persist after adjournment until “Sentence served”.
- Added sequential MP3/caption queue, typewriter fallback, original WebAudio gavel/sting/stamp/gasp, talking owl, countdown ring, jury bars, verdict shake and stricken stamp, reduced-motion handling and browser audio activation.
- Added supplemental native Twitch polls and exact-name Channel Points redemption support; both default off. Chat commands always decide the jury verdict, avoiding anonymous poll/chat double counting. The reward is created by the streamer in Twitch dashboard; enable optional settings before reconnecting for scopes.
- Hardened asynchronous veto handling, raw-filing moderation before display, late AI results, protected timeouts, overlapping title restores, actual three-minute cutoff and votes at the jury deadline. Mistrials create precedent and revoke outstanding reversible sentence jobs.
- Added comprehensive README setup/troubleshooting for Twitch apps/scopes/both accounts, OBS v5/court scene/browser source/camera rectangle, mic, AI voices/models, DRY_RUN and crash recovery. Added Prettier to make the implementation readable for continuation.
- Browser inspection caught a root-background leak into the camera cutout; fixed it and added an actual PNG alpha-pixel assertion. The overlay screenshot is RGBA with camera-center pixel (0,0,0,0).
- The real OBS adapter now explicitly uses the package’s JSON export after a local v5 protocol fixture revealed the Node default is MessagePack. The fixture verifies handshake, scene switch, screenshot request and original-scene restoration.
- Codex implemented and reviewed the full slice, ran Chromium on the production build in an isolated temporary database, checked the Vite development routes/proxy, inspected desktop/mobile/transparent-overlay screenshots, and used a fake transport to verify the official OpenAI Responses request contract.

## Final requirement audit

| Requirement                                               | Authoritative evidence                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline app without credentials                           | `npm run demo:check`; isolated Chromium demo with OPENAI_API_KEY empty, SIM_MODE/DRY_RUN true                                                             |
| Full phase sequence, hard clocks, jury-only verdict       | reducer tests including absolute 180s cutoff, boundary vote rejection, tie/zero/last vote; complete 5–2 demo                                              |
| Verbatim receipts and raw-chat boundary                   | candidate/precedent ID tests; actual all-invalid case dismissal; sanitized snapshot tests; Chromium quote assertion                                       |
| AI schemas, bounded retries/fallbacks, moderation and TTS | installed declarations, strict request contract test, deadline test, local blocklist tests; MP3 pre-generation/cache code                                 |
| Transcription and defense window                          | timing validation and late chunk tests; standalone MediaRecorder implementation and manual UI route                                                       |
| Twitch auth/actions/recovery                              | strict compilation against installed Twurple, OAuth state/token handling code, DRY_RUN and protected-user tests, queue pacing and persisted restore tests |
| OBS screenshots/scenes                                    | local real v5 socket fixture, nearest-frame bounds test; capture/prune buffer implementation                                                              |
| Panel/overlay and streamer controls                       | Chromium full demo, mobile overflow check, settings validation, actual mistrial button, transparent camera alpha                                          |
| Records/penal code/manual sentences                       | SQLite-backed records, manual sentence integration test through adjournment and served action                                                             |
| Setup docs and original assets                            | README, AGENTS.md, original Owl.tsx, CSS courtroom, WebAudio synthesis; no external art/audio assets                                                      |
| Milestone commits and runnable app                        | M1–M5 commits plus M6 commit; production build, dev route check and test commands                                                                         |

Authenticated OpenAI speech/transcription and Twitch actions have not been exercised with real credentials. OBS is exercised against a protocol fixture rather than an installed OBS application. Those deployment rehearsals require the streamer's accounts/hardware; their configuration and diagnostics are documented. Screenshots in ignored `artifacts/` are regenerated by `npm run browser:check`.

Final validation: 31 tests pass; `npm run build`, `npm run demo:check`, `npm run browser:check`, development routes/proxy/WebSocket check, `npm run format:check` and `npm audit` pass (zero vulnerabilities). Records follow the configured streamer name; live channel display names are loaded when no override is set. The browser artifacts include panel, mobile panel and a truly transparent 1920×1080 overlay. The final repository has one commit for each milestone.

## M7 — One reliable, readable on-stream trial

Plan: reproduce each evaluator finding before changing its implementation, then fix title restoration provenance, broadcast-bound evidence, overlay zoning, deadline-aware dialogue and truthful readiness/pacing. Preserve the existing reducer/runner/adapters and original courtroom art. Finish with deterministic regressions, all-phase browser/alpha checks, the full acceptance commands and one milestone commit. Higgsfield artwork work is superseded by this reliability milestone; no new assets have been generated.

M7 reproduction evidence (before fixes):

- Title regression failed with expected reverted=0, actual=1 after a dry-run conviction following a real one. Added disk-backed restart/mode coverage; removed cross-mode supersession and persisted execution mode/channel provenance.
- Broadcast regression retrieved seg_000001 from eight hours before the new application/broadcast session. Migrating to explicit broadcast identity on sessions, segments and cases; historical unknown identity is retained for audit but excluded from courtroom evidence.
- Chromium reproduction measured a 660×172px collision between Exhibit C and the defense card (artifacts/repro-defense.png); it also claimed “The transcript is listening” with no mic/key.
- Delayed speech regressions failed: no immediate caption, and an obsolete prior-exhibit speech result appeared after advancement within EXHIBITS. Introducing deadline-scoped captions/audio and nonblocking speech preparation.
- Final recovery review reproduced a failed mistrial title restoration surviving restart until the old sentence deadline. Cancellation intent is now persisted before waiting for an in-flight write, retained after acknowledgment, and retried immediately on boot; interrupted trials also trigger immediate recovery. An overlapping, still-valid earlier sentence is preserved.
- All-phase screenshot review reproduced maximum-length caption overflow (173px of content in a 128px bar). A separate speaker column and bounded typography now fit the complete line, with an explicit browser overflow assertion.

M7 decisions and implementation:

- Restoration jobs now carry execution mode/channel. Rehearsals cannot inherit, supersede, retire or fulfill a live obligation. Overlapping live convictions extend the pending group; restoration is marked only after a confirmed write. Legacy unknown jobs are retained unless the recorded convicted title matches the live channel; that check also recovers previously superseded legacy jobs. Failed writes remain pending, repeated processing is idempotent, and a different channel cannot fulfill a known job.
- Schema v2 adds persisted broadcast identity. Same-broadcast restarts retain receipts; different-broadcast and unverified legacy receipts are excluded while historical precedents remain searchable. Candidate context includes source/broadcast/session provenance. Eligibility is rechecked at display boundaries. Late transcription uploads and OBS captures keep their original broadcast identity.
- The courtroom keeps its palette/original owl and gives receipts, camera, prompts and captions separate zones. Defense selects the contradiction; the rebuttal has a fourth tab. Long stored text is unchanged and fully accessible with visible quote page controls. The camera mask applies to all painted UI, including verdicts and idle content.
- Moderated captions publish immediately and reconnect snapshots retain the current caption. Audio has trial/phase/exhibit/line identity, expiration and remaining-time checks, including actual browser media duration. Fixed announcements are warmed/cached; speech preparation and rebuttal generation have injected-clock budgets. The jury announcement never waits for verdict AI; its sentence flavor is delivered during sentencing.
- Capture readiness distinguishes unavailable/off/unverified/failed/recording/manual/simulated, with sequenced heartbeat expiration and no resurrection by late uploads. Consequence status distinguishes pending, confirmed, rehearsal and failed. Live broadcast identity is verified before filing/start. Defaults changed from 123 seconds to 94–110 seconds without reducing the 30-second defense, 20-second jury or 180-second ceiling.
- Codex reproduced the evaluator’s failures before implementation, inspected installed Twurple stream typings and the official Twitch Get Streams reference, added deterministic delayed-provider and full operating trials, and inspected actual phase screenshots. No unrelated asset generation or franchise media was introduced.
- Integration scope: this workspace has no OpenAI key, Twitch credentials/tokens or OBS credentials. OpenAI transport, Twitch actions/modes and OBS v5 disconnect/restart are local fixtures; authenticated live rehearsal still requires the streamer's accounts/hardware. Unknown legacy jobs that cannot be verified remain pending review rather than being silently discarded.

M7 final validation: `npm test` passes all 71 tests in 12 files (31 existing plus 40 regression/operating tests). `npm run build`, `npm run demo:check`, `npm run browser:check`, `npm run format:check` and `git diff --check` pass. The demo traverses every phase, records the 5–2 jury verdict, applies the approved title consequence and saves precedent. Browser verification covers ten phase/verdict variants with three opening exhibits plus a rebuttal, complete long quote paging, maximum permitted captions/prompts, four camera layouts and zero opaque pixels across every configured camera interior. Local operating tests cover guilt, acquittal, zero-vote mistrial, unavailable/delayed providers and title/OBS disconnect/restart restoration. Screenshot and temporary database fixtures are ignored; no secrets or local data are committed. The remaining deployment check is an authenticated live rehearsal with OpenAI speech/transcription, Twitch title change/revert and an actual OBS camera/scene setup.
