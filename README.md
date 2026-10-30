# Chat v. Streamer

A local Twitch courtroom. Chat files a lawsuit, transcript receipts go on trial, the streamer defends aloud, and chat alone decides guilt. Original Judge Docket owl artwork and synthesized audio.

```sh
npm install
npm run dev
```

Open http://localhost:5173/panel and http://localhost:5173/overlay in development. Click **Run full demo trial**. No credentials, microphone or OBS required. Default timings follow the full trial; **Skip phase** advances rehearsal. For production run `npm run build && npm start`, then use http://localhost:8787/panel and http://localhost:8787/overlay.

Copy `.env.example` to `.env` for live integrations. Simulator and DRY_RUN default on. `npm test` checks rules and a complete trial; `npm run demo:check` exercises SQLite, defense, voting, automatic title sentencing, scene restoration and precedent creation with an injected clock.

See BUILD_LOG.md for milestone progress. Live integration setup will be added as those milestones ship.
