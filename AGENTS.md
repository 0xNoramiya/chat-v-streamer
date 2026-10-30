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

## UI and verification

- Panel development URL: `http://localhost:5173/panel`; overlay: `/overlay` on that port. Production/OBS uses `http://localhost:8787/overlay` after building.
- `npm run browser:check` uses a temporary isolated server/database, verifies the full demo and transparent camera pixels, and writes ignored `artifacts/` screenshots. Install Chromium with `npx playwright install chromium` once.
- Use `npm run format` / `npm run format:check` for the established formatting.
- Keep the overlay HTML root transparent as well as the body. Test actual PNG alpha; a transparent body alone is insufficient because panel CSS is in the shared bundle.
- JSON runtime settings are validated and stored in SQLite. Do not add an action that bypasses sentence approval, severity limits or DRY_RUN.
- A configured OpenAI key enables AI even with simulated Twitch/OBS. Live moderation failures fail closed. The offline clerk supports conservative rehearsal cases, not general personal allegations.
- Native polls supplement chat commands; never merge anonymous poll counts into identity-based chat votes.
- Do not delete the database to recover a crash: it holds title and OBS restoration jobs. Boot marks interrupted/open cases as mistrial/expired instead of resuming timers unsafely.

## Reliable trial invariants

- SQLite schema v2 persists broadcast identity on evidence. Eligibility is checked again at preparation, trial start, rebuttal insertion and snapshot publication. Never bring legacy/unverified or other-broadcast receipts into court; precedents remain independent history.
- Sentence payloads persist execution mode and channel. Never mark an actual restore complete because a rehearsal ran. Unknown legacy jobs stay pending unless the recorded convicted title is verified live; do not guess their provenance.
- Captions and speech are separate events with line IDs, phase/exhibit scope and absolute expiration. Use `server/ai/speech.ts` for bounded preparation/cache; an obsolete or over-budget clip cannot play. The clock never waits for it.
- `browser:check` includes all-phase long-text fixtures and full camera-interior PNG alpha scans. Keep the receipts, camera, prompts and caption zones disjoint. Long quotes remain verbatim and page automatically within their remaining window, including rebuttal and reduced motion. Verify unattended behavior without overlay clicks.
- Default trial pacing is 94–110 seconds. Keep defense at 30 seconds, jury at 20, and the absolute cap at 180 seconds.

## Comedy effects

- `web/public/comedy/manifest.json` is the validated pack definition; production transparent PNGs, provenance and art direction live beside it. One generic overlay renderer uses animation presets. New local assets should reuse those presets.
- `server/comedy/desk.ts` owns a separate state domain. Never use comedy to change court state, jury votes, approval, sentencing or DRY_RUN. The runtime settings table stores attachments, placement and sound separately from court settings.
- Transients exist only as unique timed events, never reconnect snapshots or persisted queues. Clear epochs invalidate late events; expired events are discarded. One large gag/two total transients maximum. Mistrials clear transients; Clear all also removes props.
- Actual alpha is required. Generated RGB checkerboards must be removed and verified before shipping. `browser:check` uses real panel controls for every effect, reconnect/removal and cleanup; camera pixels must return to alpha zero with no effects DOM layer.
- Veto is allowed throughout pretrial. Guard every asynchronous moderation/clerk/script boundary against a changed status. Approval remains gated behind successful screening.
