import { it, expect } from 'vitest';
import { Store } from '../server/db.js';
import { nearestFrame } from '../server/adapters/obs/frames.js';
it('matches nearest frame only within twenty seconds of evidence', () => {
  const db = new Store(':memory:', 0);
  db.run('INSERT INTO frames(captured_at_ms,path) VALUES(?,?)', 10000, 'data/frames/a.jpg');
  db.run('INSERT INTO frames(captured_at_ms,path) VALUES(?,?)', 20000, 'data/frames/b.jpg');
  db.run('UPDATE frames SET broadcast_id=?', db.broadcastId);
  expect(nearestFrame(db, 18000)?.url).toBe('/frames/b.jpg');
  expect(nearestFrame(db, 41000)).toBeNull();
  db.close();
});

it('uses real OBS v5 requests to switch, capture and restore against a protocol fixture', async () => {
  const { WebSocketServer } = await import('ws');
  const { RealObs } = await import('../server/adapters/obs/real.js');
  const { config } = await import('../server/config.js');
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address();
  if (typeof address === 'string' || !address) throw Error('Fixture port missing');
  const oldUrl = config.OBS_WS_URL;
  config.OBS_WS_URL = `ws://127.0.0.1:${address.port}`;
  const requests: string[] = [],
    scenes: string[] = [];
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.op === 1) ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      if (msg.op === 6) {
        const { requestId, requestType, requestData } = msg.d;
        requests.push(requestType);
        let responseData: unknown = {};
        if (requestType === 'GetCurrentProgramScene')
          responseData = {
            currentProgramSceneName: 'Gameplay',
            currentProgramSceneUuid: 'scene-gameplay',
          };
        if (requestType === 'SetCurrentProgramScene') scenes.push(requestData.sceneName);
        if (requestType === 'GetSourceScreenshot')
          responseData = { imageData: 'data:image/jpeg;base64,/9j/2Q==' };
        ws.send(
          JSON.stringify({
            op: 7,
            d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData },
          }),
        );
      }
    });
  });
  const store = new Store(':memory:', 0),
    obs = new RealObs(store, () => {});
  try {
    await obs.connect();
    expect(obs.status).toBe('connected');
    await obs.enterCourt('Courtroom');
    expect(
      store.get<{ value_json: string }>(
        "SELECT value_json FROM settings WHERE key='obs_restore_scene'",
      )?.value_json,
    ).toBe('Gameplay');
    expect(await obs.capture('Gameplay')).toMatch(/^data:image\/jpeg/);
    await obs.restore();
    expect(scenes).toEqual(['Courtroom', 'Gameplay']);
    expect(obs.diagnostics()).toMatchObject({
      connections: 1,
      sceneEntries: 1,
      sceneRestores: 1,
      screenshots: 1,
    });
    expect(requests).toContain('GetSourceScreenshot');
    expect(store.get("SELECT 1 FROM settings WHERE key='obs_restore_scene'")).toBeUndefined();
  } finally {
    obs.close();
    config.OBS_WS_URL = oldUrl;
    for (const client of server.clients) client.terminate();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  }
});

it('restores the persisted original scene after disconnect, deferred mistrial restoration and app restart', async () => {
  const { WebSocketServer } = await import('ws'),
    { RealObs } = await import('../server/adapters/obs/real.js'),
    { config } = await import('../server/config.js'),
    { mkdtempSync, rmSync } = await import('node:fs'),
    { join } = await import('node:path'),
    { tmpdir } = await import('node:os');
  const fixture = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => fixture.once('listening', r));
  const address = fixture.address();
  if (typeof address === 'string' || !address) throw Error('Missing fixture address');
  const previous = config.OBS_WS_URL;
  config.OBS_WS_URL = `ws://127.0.0.1:${address.port}`;
  let scene = 'Gameplay';
  const switches: string[] = [];
  fixture.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } }));
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.op === 1) ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      if (event.op === 6) {
        const { requestType, requestId, requestData } = event.d;
        let responseData: unknown = {};
        if (requestType === 'GetCurrentProgramScene')
          responseData = { currentProgramSceneName: scene, currentProgramSceneUuid: scene };
        if (requestType === 'SetCurrentProgramScene') {
          scene = requestData.sceneName;
          switches.push(scene);
        }
        ws.send(
          JSON.stringify({
            op: 7,
            d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData },
          }),
        );
      }
    });
  });
  const directory = mkdtempSync(join(tmpdir(), 'court-obs-restart-')),
    path = join(directory, 'court.db');
  let store = new Store(path, 0),
    obs = new RealObs(store, () => {});
  try {
    await obs.connect();
    await obs.enterCourt('Courtroom');
    for (const ws of fixture.clients) ws.terminate();
    for (let i = 0; i < 100 && obs.status === 'connected'; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(obs.status).not.toBe('connected');
    await obs.restore();
    expect(store.get("SELECT 1 FROM settings WHERE key='obs_restore_scene'")).toBeDefined();
    obs.close();
    store.close();
    store = new Store(path, 1000);
    obs = new RealObs(store, () => {});
    await obs.connect();
    await obs.restore();
    expect(scene).toBe('Gameplay');
    expect(switches).toEqual(['Courtroom', 'Gameplay']);
    expect(store.get("SELECT 1 FROM settings WHERE key='obs_restore_scene'")).toBeUndefined();
  } finally {
    obs.close();
    store.close();
    config.OBS_WS_URL = previous;
    for (const ws of fixture.clients) ws.terminate();
    await new Promise<void>((r) => fixture.close(() => r()));
    rmSync(directory, { recursive: true, force: true });
  }
});
