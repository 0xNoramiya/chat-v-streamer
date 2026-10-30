import { it, expect, vi } from 'vitest';
import { RealTwitch, protectedUser } from '../server/adapters/twitch/real.js';
import { defaults } from '../server/config.js';
import { Store } from '../server/db.js';
import { Sentencer } from '../server/court/sentencing.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
it('never permits protected accounts for contempt', () => {
  expect(protectedUser({ id: 'b', login: 'b' }, 'b')).toBe(true);
  for (const badge of ['broadcaster', 'mod', 'vip'])
    expect(protectedUser({ id: 'u', login: 'u', [badge]: true }, 'b')).toBe(true);
  expect(protectedUser({ id: 'u', login: 'u' }, 'b')).toBe(false);
});
it('real adapter DRY_RUN logs title mutation without credentials or Helix calls', async () => {
  const logs: string[] = [];
  const adapter = new RealTwitch(
    (_k, m) => logs.push(m),
    () => defaults,
  );
  await adapter.setTitle('[CONVICTED] Dry run');
  expect(logs).toContain('DRY_RUN setTitle: [CONVICTED] Dry run');
  adapter.close();
});
it('restores overdue persisted title jobs exactly once after boot', async () => {
  const db = new Store(':memory:', 0),
    logs: string[] = [];
  const twitch = new SimTwitch((_k, m) => logs.push(m));
  db.run(
    'INSERT INTO sentences_applied VALUES(?,?,?,?,0)',
    1,
    'title_shame',
    JSON.stringify({ originalTitle: 'The original title', dryRun: true }),
    1000,
  );
  const executor = new Sentencer(db, twitch, () => {});
  await executor.reverts(1001);
  await executor.reverts(2000);
  expect(logs.filter((s) => s.includes('setTitle'))).toEqual(['SIM setTitle: The original title']);
  expect(db.get<{ reverted: number }>('SELECT reverted FROM sentences_applied')?.reverted).toBe(1);
  db.close();
});

it('paces queued outgoing messages at least 1.5 seconds apart', async () => {
  vi.useFakeTimers();
  const sent: { at: number; text: string }[] = [];
  const adapter = new RealTwitch(
    (_kind, text) => {
      if (text.startsWith('DRY_RUN sendChat')) sent.push({ at: Date.now(), text });
    },
    () => defaults,
  );
  try {
    const first = adapter.sendChat('First safe line.'),
      second = adapter.sendChat('Second safe line.');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1499);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(sent).toHaveLength(2);
    expect(sent[1].at - sent[0].at).toBeGreaterThanOrEqual(1500);
  } finally {
    adapter.close();
    vi.useRealTimers();
  }
});

it('does not issue clip or marker mutations if a mistrial occurs during the live-status lookup', async () => {
  const { config } = await import('../server/config.js');
  const before = config.DRY_RUN;
  config.DRY_RUN = false;
  const logs: string[] = [],
    adapter = new RealTwitch(
      (_kind, text) => logs.push(text),
      () => defaults,
    );
  let finish!: (value: { live: boolean; title: string; startedAt: null }) => void;
  const stream = new Promise<{ live: boolean; title: string; startedAt: null }>(
    (r) => (finish = r),
  );
  vi.spyOn(adapter, 'getStream').mockImplementation(() => stream);
  let active = true;
  try {
    const clip = adapter.createClip(() => active),
      marker = adapter.createMarker('Case fixture', () => active);
    active = false;
    finish({ live: true, title: 'Original', startedAt: null });
    await Promise.all([clip, marker]);
    expect(logs).toEqual([]);
  } finally {
    adapter.close();
    config.DRY_RUN = before;
  }
});
