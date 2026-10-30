import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ObsAdapter } from './types.js';
import type { Store } from '../../db.js';
export function nearestFrame(store: Store, startedAt: number) {
  const row = store.get<{ id: number; path: string }>(
    'SELECT id,path FROM frames WHERE broadcast_id=? AND captured_at_ms BETWEEN ? AND ? ORDER BY ABS(captured_at_ms-?) LIMIT 1',
    store.broadcastId,
    startedAt - 20000,
    startedAt + 20000,
    startedAt,
  );
  return row ? { id: row.id, url: `/frames/${basename(row.path)}` } : null;
}
export class FrameBuffer {
  private timer?: ReturnType<typeof setInterval>;
  private capturing = false;
  constructor(
    private store: Store,
    private obs: ObsAdapter,
    private source: () => string,
    private log: (kind: string, text: string) => void,
  ) {}
  start(interval: number) {
    this.timer = setInterval(() => {
      void this.captureAt(Date.now());
    }, interval);
    void this.captureAt(Date.now());
  }
  async captureAt(now: number) {
    if (this.capturing) return;
    this.capturing = true;
    try {
      const broadcastId = this.store.broadcastId;
      const image = await this.obs.capture?.(this.source());
      if (image) {
        if (!/^data:image\/(jpeg|jpg);base64,/.test(image) || image.length > 4 * 1024 * 1024)
          throw Error('Invalid screenshot');
        const path = `data/frames/${now}-${randomUUID()}.jpg`;
        await mkdir('data/frames', { recursive: true });
        await writeFile(path, Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'));
        this.store.run(
          'INSERT INTO frames(captured_at_ms,path,broadcast_id) VALUES(?,?,?)',
          now,
          path,
          broadcastId,
        );
      }
      await this.prune(now);
    } catch {
      this.log('obs', 'Screenshot capture failed; the trial continues.');
    } finally {
      this.capturing = false;
    }
  }
  async prune(now: number) {
    for (const f of this.store.all<{ id: number; path: string }>(
      'SELECT id,path FROM frames WHERE captured_at_ms<?',
      now - 3 * 3600000,
    )) {
      await unlink(f.path).catch(() => {});
      this.store.run('DELETE FROM frames WHERE id=?', f.id);
    }
  }
  close() {
    clearInterval(this.timer);
  }
}
