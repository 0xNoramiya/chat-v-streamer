import { expect, it } from 'vitest';
import { Store } from '../server/db.js';
import { retrieve } from '../server/ai/retrieval.js';
it('does not reuse an eight-hour-old receipt from another broadcast', () => {
  const now = 9 * 3600000,
    store = new Store(':memory:', 0);
  store.run('UPDATE sessions SET stream_started_at_ms=0 WHERE id=?', store.sessionId);
  const old = store.addSegment('first try guaranteed', 1000, 2000, 'mic');
  store.sessionId = Number(
    store.run('INSERT INTO sessions(started_at_ms,stream_started_at_ms) VALUES(?,?)', now, now)
      .lastInsertRowid,
  );
  expect(retrieve(store, ['first', 'try'], now).map((s) => s.id)).not.toContain(old.id);
  store.close();
});

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatCandidates, precedents } from '../server/ai/retrieval.js';
import { CourtRunner } from '../server/court/runner.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import { CannedAI } from '../server/ai/service.js';
const broadcast = {
  id: 'twitch:channel:stream-one',
  channelId: 'channel',
  startedAt: 1000,
  kind: 'twitch' as const,
};
it('keeps same-broadcast receipts across app restarts, even without matching search hints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'court-broadcast-')),
    path = join(dir, 'court.db');
  let store = new Store(path, 1000);
  try {
    store.bindBroadcast(broadcast);
    const receipt = store.addSegment('A first-try guarantee.', 2000, 3000, 'mic');
    store.close();
    store = new Store(path, 4000);
    store.bindBroadcast(broadcast);
    expect(retrieve(store, [], 5000).map((s) => s.id)).toEqual([receipt.id]);
    expect(formatCandidates(retrieve(store, [], 5000))).toContain(
      'source=mic | broadcast=twitch:channel:stream-one',
    );
    store.bindBroadcast({ ...broadcast, id: 'twitch:channel:stream-two', startedAt: 5000 });
    expect(retrieve(store, ['first', 'guarantee'], 6000)).toEqual([]);
    const runner = new CourtRunner(
      store,
      new SimTwitch(() => {}),
      new SimObs(() => {}),
      new CannedAI(),
      { now: () => 6000, setInterval, clearInterval },
    );
    expect(
      runner.exhibit({ segment_id: receipt.id, framing: 'Old receipt' }, 'opening'),
    ).toBeUndefined();
    runner.close();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('historical precedent remains searchable while old receipts and simulated live evidence are excluded', () => {
  const store = new Store(':memory:', 1000);
  store.bindBroadcast(broadcast);
  const old = store.addSegment('first try guaranteed', 2000, 3000, 'mic');
  store.run(
    'INSERT INTO precedents VALUES(?,?,?,?,?,?)',
    'P-001',
    1,
    'Chat v. Previous: First Try',
    'guilty',
    'Established: first try guarantees require receipts.',
    3000,
  );
  store.bindBroadcast({
    ...broadcast,
    id: 'twitch:other:stream-new',
    channelId: 'other',
    startedAt: 4000,
  });
  store.addSegment('first try in simulator', 5000, 6000, 'sim');
  expect(retrieve(store, ['first', 'try'], 7000)).toEqual([]);
  expect(precedents(store, 'first try')).toHaveLength(1);
  expect(store.segment(old.id)?.text).toBe('first try guaranteed');
  store.close();
});
it('rejects unverified legacy receipts without deleting their audit record', () => {
  const store = new Store(':memory:', 1000);
  const receipt = store.addSegment('first try guaranteed', 2000, 3000, 'mic');
  store.run('UPDATE segments SET broadcast_id=NULL WHERE id=?', receipt.id);
  store.bindBroadcast(broadcast);
  expect(retrieve(store, ['first'], 4000)).toEqual([]);
  expect(store.segment(receipt.id)).toBeDefined();
  store.close();
});

it('a late transcription keeps its upload broadcast and cannot become evidence for the next stream', () => {
  const store = new Store(':memory:', 1000);
  store.bindBroadcast(broadcast);
  const uploadBroadcast = store.broadcastId;
  store.bindBroadcast({ ...broadcast, id: 'twitch:channel:stream-two', startedAt: 4000 });
  const late = store.addSegment('first try guaranteed', 3000, 3500, 'mic', uploadBroadcast);
  expect(late.broadcast_id).toBe(broadcast.id);
  expect(retrieve(store, ['first'], 6000)).toEqual([]);
  store.close();
});
it('a broadcast change hides old courtroom exhibits before the next timer tick', async () => {
  const store = new Store(':memory:', 0),
    runner = new CourtRunner(store, new SimTwitch(() => {}), new SimObs(() => {}), new CannedAI(), {
      now: () => 100000,
      setInterval,
      clearInterval,
    });
  await runner.demo();
  expect(runner.snapshot(false).court.trial?.exhibits).toHaveLength(3);
  store.bindBroadcast({ ...broadcast, id: 'twitch:channel:different', startedAt: 100000 });
  expect(runner.snapshot(false).court.trial).toBeNull();
  await runner.tick();
  await runner.settle();
  expect(runner.state.trial).toBeNull();
  runner.close();
  store.close();
});
