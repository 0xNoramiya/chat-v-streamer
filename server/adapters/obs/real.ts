import OBSWebSocket from 'obs-websocket-js/json';
import { config } from '../../config.js';
import type { Store } from '../../db.js';
import type { ObsAdapter } from './types.js';
export function bounded<T>(promise: Promise<T>, ms = 3500): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('OBS request timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
export class RealObs implements ObsAdapter {
  status = 'disconnected';
  private socket = new OBSWebSocket();
  private original: string | null = null;
  private desiredCourt = false;
  private connected = false;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private serial: Promise<void> = Promise.resolve();
  private evidence = {
    connections: 0,
    disconnects: 0,
    sceneEntries: 0,
    sceneRestores: 0,
    screenshots: 0,
  };
  diagnostics() {
    return structuredClone(this.evidence);
  }
  constructor(
    private store: Store,
    private log: (kind: string, text: string) => void,
  ) {
    this.original =
      store.get<{ value_json: string }>(
        "SELECT value_json FROM settings WHERE key='obs_restore_scene'",
      )?.value_json ?? null;
    this.socket.on('ConnectionClosed', () => {
      this.evidence.disconnects++;
      this.connected = false;
      this.status = 'reconnecting';
      this.schedule();
    });
    this.socket.on('ConnectionError', () => {
      this.status = 'disconnected';
    });
  }
  async connect() {
    if (this.closed) return;
    try {
      await bounded(
        this.socket.connect(config.OBS_WS_URL, config.OBS_WS_PASSWORD, { rpcVersion: 1 }),
      );
      this.connected = true;
      this.evidence.connections++;
      this.status = 'connected';
      this.log('obs', 'OBS WebSocket connected.');
      if (this.original && !this.desiredCourt) await this.restore();
    } catch {
      this.connected = false;
      this.status = 'disconnected';
      void this.socket.disconnect().catch(() => {});
      this.log('obs', 'OBS unavailable. Enable WebSocket v5 and check OBS_WS_URL/password.');
      this.schedule();
    }
  }
  private schedule() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.connect();
    }, 5000);
  }
  private enqueue(fn: () => Promise<void>) {
    const task = this.serial.catch(() => {}).then(fn);
    this.serial = task;
    return task;
  }
  async enterCourt(scene: string) {
    this.desiredCourt = true;
    await this.enqueue(async () => {
      if (!this.connected || !scene) return;
      try {
        const current = await bounded(this.socket.call('GetCurrentProgramScene'));
        if (!this.original) {
          this.original = current.currentProgramSceneName;
          this.store.run(
            'INSERT OR REPLACE INTO settings VALUES(?,?)',
            'obs_restore_scene',
            this.original,
          );
        }
        if (!this.desiredCourt) return;
        await bounded(this.socket.call('SetCurrentProgramScene', { sceneName: scene }));
        this.evidence.sceneEntries++;
        this.log('obs', `Court scene: ${scene}`);
      } catch {
        this.log('obs', 'Could not switch court scene. The trial continues.');
      }
    });
  }
  async restore() {
    this.desiredCourt = false;
    await this.enqueue(async () => {
      if (!this.original) return;
      if (!this.connected) {
        this.log('obs', 'Scene restore deferred until OBS reconnects.');
        return;
      }
      try {
        await bounded(this.socket.call('SetCurrentProgramScene', { sceneName: this.original }));
        this.evidence.sceneRestores++;
        this.original = null;
        this.store.run("DELETE FROM settings WHERE key='obs_restore_scene'");
        this.log('obs', 'Original scene restored.');
      } catch {
        this.log('obs', 'Scene restoration will retry after OBS reconnects.');
      }
    });
  }
  async capture(source: string) {
    if (!this.connected) return null;
    try {
      const scene =
        source ||
        (await bounded(this.socket.call('GetCurrentProgramScene'))).currentProgramSceneName;
      const result = await bounded(
        this.socket.call('GetSourceScreenshot', {
          sourceName: scene,
          imageFormat: 'jpg',
          imageWidth: 640,
          imageCompressionQuality: 75,
        }),
      );
      this.evidence.screenshots++;
      return result.imageData;
    } catch {
      this.log('obs', 'Screenshot unavailable. Evidence uses the no-photo placeholder.');
      return null;
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.retry);
    void this.socket.disconnect().catch(() => {});
  }
}
