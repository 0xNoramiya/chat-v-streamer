import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import pino from 'pino';
import multer from 'multer';
import { chunkTiming, transcribe } from './adapters/transcript/ingest.js';
import { z } from 'zod';
import { config, defaults, settingsSchema } from './config.js';
import { Store } from './db.js';
import { CourtRunner } from './court/runner.js';
import type { TwitchAdapter, StreamInfo } from './adapters/twitch/types.js';
import { RealTwitch } from './adapters/twitch/real.js';
import { SimTwitch, simUser } from './adapters/twitch/sim.js';
import { SimObs } from './adapters/obs/sim.js';
import { RealObs } from './adapters/obs/real.js';
import { FrameBuffer } from './adapters/obs/frames.js';
import type { ObsAdapter } from './adapters/obs/types.js';
import { CourtAI } from './ai/courtAI.js';
import { attachWS } from './ws.js';
import { diagnostics } from './diagnostics.js';
const logger = pino({
  redact: ['req.headers.authorization', 'token', 'accessToken', 'refreshToken'],
});
const store = new Store();
let runner: CourtRunner;
const log = (kind: string, message: string) => {
  logger.info({ kind }, message);
  runner?.log(kind, message);
};
const twitch: TwitchAdapter = config.SIM_MODE
  ? new SimTwitch(log)
  : new RealTwitch(log, () => runner?.settings ?? store.settings());
const obs: ObsAdapter = config.SIM_MODE ? new SimObs(log) : new RealObs(store, log),
  ai = new CourtAI(store, log);
runner = new CourtRunner(store, twitch, obs, ai);
async function syncStream(info: StreamInfo) {
  runner.adoptBroadcast(info);
  if (
    info.displayName &&
    runner.settings.streamerName === defaults.streamerName &&
    (await ai.moderator.safe(info.displayName))
  ) {
    const updated = settingsSchema.safeParse({
      ...runner.settings,
      streamerName: info.displayName,
    });
    if (updated.success) runner.updateSettings(updated.data);
  }
}
const app = express(),
  server = createServer(app);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        return res.status(403).json({ error: 'Local control only.' });
    } catch {
      return res.status(403).end();
    }
  }
  next();
});
if (twitch instanceof RealTwitch) twitch.registerAuth(app);
else
  app.get(['/auth/broadcaster', '/auth/bot'], (_req, res) =>
    res
      .status(400)
      .send(
        'Set SIM_MODE=false and configure Twitch credentials in .env, then restart to connect accounts.',
      ),
  );
diagnostics(app, runner);
app.get('/api/readiness', (_req, res) => {
  const status = runner.snapshot().status;
  res.json({
    checkedAt: Date.now(),
    modes: { sim: config.SIM_MODE, dryRun: config.DRY_RUN },
    configurationPresent: {
      openaiKey: !!config.OPENAI_API_KEY,
      twitchClientId: !!config.TWITCH_CLIENT_ID,
      twitchClientSecret: !!config.TWITCH_CLIENT_SECRET,
      twitchChannel: !!config.TWITCH_CHANNEL_LOGIN,
      obsPassword: !!config.OBS_WS_PASSWORD,
    },
    connections: {
      ai: ai.status,
      twitch: twitch.status,
      eventsub: twitch.eventsubStatus,
      obs: obs.status,
    },
    capture: status.capture?.state,
    pendingRestorations: {
      real: status.pendingRealRestores ?? 0,
      unverified: status.pendingUnverifiedRestores ?? 0,
    },
    activeTrial: !!runner.state.trial,
    openai: ai.client?.evidence.snapshot() ?? {},
    openaiProvider: !ai.client
      ? 'none'
      : ai.client.sdk.baseURL === 'https://api.openai.com/v1'
        ? 'official_openai'
        : 'custom',
    twitch: twitch instanceof RealTwitch ? twitch.diagnostics() : null,
    obs: obs instanceof RealObs ? obs.diagnostics() : null,
    docketCaseCount: runner.cases().length,
  });
});
app.get('/api/state', (req, res) => res.json(runner.snapshot(req.query.role !== 'overlay')));
app.post('/api/chat', async (req, res) => {
  const body = z
    .object({
      user: z.string().regex(/^(viewer[1-8]|broadcaster|mod1|vip1)$/),
      text: z.string().max(500),
    })
    .parse(req.body);
  await runner.chat(simUser(body.user), body.text);
  res.json({ ok: true });
});
app.post('/api/demo', async (_req, res) => res.json({ id: await runner.demo() }));
app.post('/api/comedy', (req, res) => {
  runner.comedy.command(req.body, Date.now());
  res.json({ ok: true });
});
app.post('/api/action', async (req, res) => {
  const action = z
    .object({
      type: z.enum(['MISTRIAL', 'SKIP', 'SERVED', 'START', 'STRIKE', 'APPROVE', 'VETO']),
      id: z.number().optional(),
      index: z.number().int().min(0).max(3).optional(),
    })
    .parse(req.body);
  if (action.type === 'START') await runner.startNext();
  else if (action.type === 'APPROVE' || action.type === 'VETO')
    runner.approve(action.id!, action.type === 'APPROVE');
  else if (action.type === 'SERVED') runner.serveSentence(action.id);
  else if (action.type === 'STRIKE')
    runner.dispatch({ type: 'STRIKE', index: action.index!, now: Date.now() });
  else runner.dispatch({ type: action.type, now: Date.now() });
  res.json({ ok: true });
});
app.post('/api/settings', async (req, res) => {
  const settings = settingsSchema.parse(req.body);
  if (
    !(await ai.moderator.safe(
      settings.streamerName + ' ' + settings.penalCode.map((p) => p.text).join(' '),
    ))
  )
    throw Error('Penal code did not pass moderation.');
  runner.updateSettings(settings);
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 },
  fileFilter: (_req, file, cb) =>
    cb(null, /^audio\/(webm|ogg|mp4|wav|x-wav|mpeg)/.test(file.mimetype)),
});
app.post('/api/capture', (req, res) => {
  const body = z
    .object({
      clientId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      state: z.enum(['starting', 'recording', 'stopped', 'error']),
      sequence: z.number().int().min(0),
    })
    .parse(req.body);
  runner.capture.update(body.clientId, body.state, body.sequence);
  runner.onChange();
  res.json({ ok: true });
});
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!ai.client)
    return res
      .status(503)
      .json({ error: 'Set OPENAI_API_KEY to transcribe mic audio. Manual lines work offline.' });
  if (!req.file) throw Error('A standalone audio chunk is required.');
  const timing = chunkTiming(req.body, Date.now());
  const clientId = z.string().max(80).optional().parse(req.body.clientId);
  const broadcastId = store.broadcastId;
  let text: string;
  try {
    text = await transcribe(ai.client.sdk, req.file.buffer, req.file.mimetype);
    ai.client.evidence.record('transcription', 'success');
  } catch (error) {
    ai.client.evidence.record('transcription', 'failure', error);
    if (clientId) runner.capture.result(clientId, false);
    runner.onChange();
    return res.status(502).json({
      error:
        'Transcription unavailable. Check the OpenAI key, model and connection; manual lines remain available.',
    });
  }
  if (clientId) runner.capture.result(clientId, true);
  runner.onChange();
  res.json(
    text
      ? runner.addSegment(text, timing.started_at_ms, timing.ended_at_ms, 'mic', broadcastId)
      : { skipped: true },
  );
});
app.post('/api/transcript', (req, res) => {
  const body = z.object({ text: z.string().min(1).max(2000) }).parse(req.body);
  res.json(runner.addSegment(body.text, Date.now(), Date.now(), 'manual'));
});
for (const dir of ['tts', 'frames']) {
  mkdirSync(`data/${dir}`, { recursive: true });
  app.use(`/${dir}`, express.static(resolve(`data/${dir}`)));
}
if (existsSync('web/dist/index.html')) {
  app.use(express.static(resolve('web/dist')));
  app.get(['/', '/panel', '/overlay'], (_req, res) => res.sendFile(resolve('web/dist/index.html')));
} else app.get('/', (_req, res) => res.redirect('http://localhost:5173/panel'));
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError)
      res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    else res.status(400).json({ error: error instanceof Error ? error.message : 'Request failed' });
  },
);
attachWS(server, runner);
runner.start();
if (twitch.connect)
  void twitch.connect().then(async () => {
    try {
      const stream = await twitch.getStream();
      await syncStream(stream);
    } catch {
      log('twitch', 'Stream status unavailable until broadcaster connects.');
    }
  });
server.listen(config.PORT, '127.0.0.1', () =>
  log(
    'boot',
    `Court ready at http://localhost:${config.PORT}/panel; overlay /overlay. SIM=${config.SIM_MODE} DRY_RUN=${config.DRY_RUN}`,
  ),
);
const streamRefresh = setInterval(() => {
  if (!config.SIM_MODE && twitch.status === 'connected')
    void twitch
      .getStream()
      .then(syncStream)
      .catch(() => {});
}, 30000);
const frames = new FrameBuffer(store, obs, () => runner.settings.obsScreenshotSource, log);
frames.start(config.FRAME_INTERVAL_MS);
if (obs instanceof RealObs) void obs.connect();
function close() {
  clearInterval(streamRefresh);
  frames.close();
  runner.close();
  server.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
