# Chat v. Streamer

Local-first Twitch courtroom. Node 20+, strict TypeScript, Express + ws + SQLite/FTS5 server; React/Vite panel and transparent 1920×1080 overlay.

## Architecture
- `server/court/machine.ts` is a pure reducer. Inject time into the runner; timers never wait for AI.
- `server/court/` pure rules are isolated from adapter I/O; the runner coordinates persistence and effects.
- `server/adapters/` has explicit real/simulator interfaces. SIM_MODE defaults true; DRY_RUN defaults true.
- `server/ai/` owns schemas, moderation, candidate-ID validation, bounded calls and safe fallbacks. Exhibits always render stored transcript text; AI supplies IDs only.
- `web/src/overlay` receives sanitized snapshots. Raw filings exist only in the panel/audit database.
- `data/` contains local tokens, database, audio and frames. Never commit it or log secrets.

## Commands
`npm install`, `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run typecheck`, `npm run demo:check`.

## Conventions
Small typed modules, Zod at HTTP/AI boundaries, no `any`, no franchise art/audio. Jury votes determine guilt. Mistrial restores OBS and prevents sentencing. Keep runnable at every milestone. Add tests for behavior and regressions; use injected clocks for complete trials. Read installed integration typings and official docs before writing API calls.

## Delivery
Complete M1–M6 in order, append decisions/validation/Codex usage to BUILD_LOG.md and commit each milestone. Preserve verbatim evidence, moderation, streamer control, and automatic sentencing above optional polish.
