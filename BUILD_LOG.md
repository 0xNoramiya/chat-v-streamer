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
