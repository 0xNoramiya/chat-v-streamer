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
