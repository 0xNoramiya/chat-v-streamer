import { it, expect } from 'vitest';
import { Store } from '../server/db.js';
import { nearestFrame } from '../server/adapters/obs/frames.js';
it('matches nearest frame only within twenty seconds of evidence', () => {
  const db = new Store(':memory:', 0);
  db.run('INSERT INTO frames(captured_at_ms,path) VALUES(?,?)', 10000, 'data/frames/a.jpg');
  db.run('INSERT INTO frames(captured_at_ms,path) VALUES(?,?)', 20000, 'data/frames/b.jpg');
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
