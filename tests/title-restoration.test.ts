import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/db.js';
import { Sentencer } from '../server/court/sentencing.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { config, defaults } from '../server/config.js';
import { reducer } from '../server/court/machine.js';
import { fallbackVerdict } from '../server/ai/service.js';
import type { Trial } from '../web/src/shared/types.js';
const originalMode = config.DRY_RUN;
afterEach(() => {
  config.DRY_RUN = originalMode;
});
class LiveFixture extends SimTwitch {
  override execution() {
    return {
      mode: config.DRY_RUN ? ('dry_run' as const) : ('live' as const),
      channelId: 'channel-fixture',
    };
  }
  override status = 'connected';
  override title = 'Original broadcast title';
  writes: string[] = [];
  override async setTitle(title: string) {
    if (!config.DRY_RUN) {
      this.title = title;
      this.writes.push(title);
    }
  }
}
function trial(id: number): Trial {
  const t = reducer(
    { trial: null, now: 0, cooldownUntil: 0 },
    {
      type: 'START',
      caseId: id,
      name: `Chat v. Fixture: Case ${id}`,
      formalCharge: 'An on-stream guarantee.',
      script: {
        has_case: true,
        exhibits: [],
        cited_precedent_id: null,
        opening_line: 'All rise.',
        exhibit_lines: [],
        defense_prompt: 'Defend.',
      },
      exhibits: [],
      now: 0,
    },
    defaults,
  ).state.trial!;
  t.verdict = 'guilty';
  t.votes = { a: 'guilty' };
  t.verdictScript = {
    ...fallbackVerdict(
      'guilty',
      defaults.penalCode.filter((p) => p.approved),
    ),
    title_text: `[CONVICTED] Case ${id}`,
  };
  return t;
}
const settings = { ...defaults, clipOnGuilty: false, markerOnGuilty: false };
it('preserves an actual title restoration through a dry-run conviction and two restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'court-title-')),
    path = join(dir, 'court.db'),
    twitch = new LiveFixture(() => {});
  let store = new Store(path, 0);
  try {
    config.DRY_RUN = false;
    await new Sentencer(store, twitch, () => {}).execute(
      trial(1),
      settings,
      { id: 'p', login: 'p' },
      1000,
    );
    expect(twitch.title).toBe('[CONVICTED] Case 1');
    store.close();
    store = new Store(path, 2000);
    config.DRY_RUN = true;
    await new Sentencer(store, twitch, () => {}).execute(
      trial(2),
      settings,
      { id: 'p', login: 'p' },
      3000,
    );
    expect(
      store.get<{ reverted: number }>('SELECT reverted FROM sentences_applied WHERE case_id=1')
        ?.reverted,
    ).toBe(0);
    store.close();
    store = new Store(path, 2000000);
    config.DRY_RUN = false;
    const executor = new Sentencer(store, twitch, () => {});
    await executor.reverts(2000000);
    await executor.reverts(2000001);
    expect(twitch.title).toBe('Original broadcast title');
    expect(twitch.writes.filter((s) => s === 'Original broadcast title')).toHaveLength(1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('extends overlapping live convictions without claiming either was restored early', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {}),
    executor = new Sentencer(store, twitch, () => {});
  try {
    await executor.execute(trial(1), settings, { id: 'p', login: 'p' }, 1000);
    await executor.execute(trial(2), settings, { id: 'p', login: 'p' }, 100000);
    expect(
      store
        .all<{ reverted: number }>('SELECT reverted FROM sentences_applied')
        .map((r) => r.reverted),
    ).toEqual([0, 0]);
    await executor.reverts(901001);
    expect(twitch.title).toBe('[CONVICTED] Case 2');
    await executor.reverts(1000001);
    await executor.reverts(1000002);
    expect(twitch.title).toBe('Original broadcast title');
    expect(twitch.writes.filter((s) => s === 'Original broadcast title')).toHaveLength(1);
  } finally {
    store.close();
  }
});
it('a simulator with DRY_RUN=false cannot satisfy a live or legacy-unknown obligation', async () => {
  const store = new Store(':memory:', 0),
    live = new LiveFixture(() => {});
  try {
    config.DRY_RUN = false;
    await new Sentencer(store, live, () => {}).execute(
      trial(1),
      settings,
      { id: 'p', login: 'p' },
      1000,
    );
    store.run(
      'INSERT INTO sentences_applied VALUES(?,?,?,?,0)',
      3,
      'legacy_unknown',
      JSON.stringify({ originalTitle: 'Legacy original' }),
      1000,
    );
    const sim = new SimTwitch(() => {}),
      executor = new Sentencer(store, sim, () => {});
    await executor.execute(trial(2), settings, { id: 'p', login: 'p' }, 2000);
    await executor.reverts(2000000);
    expect(live.title).toBe('[CONVICTED] Case 1');
    expect(
      store
        .all<{ reverted: number }>('SELECT reverted FROM sentences_applied WHERE case_id IN (1,3)')
        .map((r) => r.reverted),
    ).toEqual([0, 0]);
    const payload = JSON.parse(
      store.get<{ payload_json: string }>(
        'SELECT payload_json FROM sentences_applied WHERE case_id=2',
      )!.payload_json,
    );
    expect(payload.execution.mode).toBe('simulated');
  } finally {
    store.close();
  }
});
it('failed restoration remains pending for retry and cannot affect another broadcaster', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {}),
    executor = new Sentencer(store, twitch, () => {});
  try {
    await executor.execute(trial(1), settings, { id: 'p', login: 'p' }, 1000);
    const set = twitch.setTitle.bind(twitch);
    let fail = true;
    twitch.setTitle = async (title) => {
      if (fail) {
        fail = false;
        throw Error('Disconnected');
      }
      await set(title);
    };
    await executor.reverts(2000000);
    expect(
      store.get<{ reverted: number }>('SELECT reverted FROM sentences_applied')!.reverted,
    ).toBe(0);
    const other = new LiveFixture(() => {});
    other.execution = () => ({ mode: 'live', channelId: 'different-channel' });
    await new Sentencer(store, other, () => {}).reverts(2000000);
    expect(other.writes).toHaveLength(0);
    await executor.reverts(2000001);
    await executor.reverts(2000002);
    expect(twitch.title).toBe('Original broadcast title');
    expect(twitch.writes).toHaveLength(2);
  } finally {
    store.close();
  }
});
it('mistrial during title preparation prevents the title and later consequences', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {});
  let complete!: () => void;
  const gate = new Promise<void>((r) => (complete = r));
  const get = twitch.getStream.bind(twitch);
  twitch.getStream = async () => {
    await gate;
    return get();
  };
  let active = true;
  const executor = new Sentencer(store, twitch, () => {});
  const work = executor.execute(trial(1), settings, { id: 'p', login: 'p' }, 1000, () => active);
  active = false;
  complete();
  await work;
  expect(twitch.writes).toHaveLength(0);
  expect(store.all('SELECT * FROM sentences_applied')).toHaveLength(0);
  store.close();
});

it('recovers a legacy obligation incorrectly superseded by an old rehearsal only when its title is still active', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {});
  try {
    twitch.title = '[CONVICTED] Legacy actual action';
    store.run(
      'INSERT INTO sentences_applied VALUES(?,?,?,?,1)',
      1,
      'title_shame',
      JSON.stringify({ originalTitle: 'Before the court', title: twitch.title, dryRun: false }),
      1000,
    );
    await new Sentencer(store, new SimTwitch(() => {}), () => {}).reverts(2000);
    expect(twitch.writes).toHaveLength(0);
    const executor = new Sentencer(store, twitch, () => {});
    await executor.reverts(2000);
    await executor.reverts(2001);
    expect(twitch.title).toBe('Before the court');
    expect(twitch.writes).toEqual(['Before the court']);
  } finally {
    store.close();
  }
});
it('does not replay an already-restored legacy job against a normal current title', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {});
  try {
    store.run(
      'INSERT INTO sentences_applied VALUES(?,?,?,?,1)',
      1,
      'title_shame',
      JSON.stringify({
        originalTitle: 'Earlier original',
        title: '[CONVICTED] Earlier',
        dryRun: false,
      }),
      1000,
    );
    await new Sentencer(store, twitch, () => {}).reverts(2000);
    expect(twitch.writes).toHaveLength(0);
  } finally {
    store.close();
  }
});

it('a later live conviction takes its root from the real title, never from an earlier rehearsal', async () => {
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {});
  try {
    config.DRY_RUN = true;
    await new Sentencer(store, twitch, () => {}).execute(
      trial(1),
      settings,
      { id: 'p', login: 'p' },
      1000,
    );
    twitch.title = 'A fresh title chosen by the streamer';
    config.DRY_RUN = false;
    const executor = new Sentencer(store, twitch, () => {});
    await executor.execute(trial(2), settings, { id: 'p', login: 'p' }, 2000);
    await executor.reverts(2000000);
    expect(twitch.title).toBe('A fresh title chosen by the streamer');
    expect(twitch.writes).toEqual(['[CONVICTED] Case 2', 'A fresh title chosen by the streamer']);
  } finally {
    store.close();
  }
});

it('does not turn an ambiguous legacy simulator job into a real title mutation', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {});
  try {
    store.run(
      'INSERT INTO sentences_applied VALUES(?,?,?,?,0)',
      1,
      'title_shame',
      JSON.stringify({
        originalTitle: 'A simulated original',
        title: '[CONVICTED] Rehearsal only',
        dryRun: false,
      }),
      1000,
    );
    await new Sentencer(store, twitch, () => {}).reverts(2000);
    expect(twitch.writes).toHaveLength(0);
    expect(
      store.get<{ reverted: number }>('SELECT reverted FROM sentences_applied')?.reverted,
    ).toBe(0);
  } finally {
    store.close();
  }
});
it('binds and restores a pending legacy real action only after its recorded title is verified', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {});
  try {
    twitch.title = '[CONVICTED] A legacy actual action';
    store.run(
      'INSERT INTO sentences_applied VALUES(?,?,?,?,0)',
      1,
      'title_shame',
      JSON.stringify({
        originalTitle: 'Original before legacy court',
        title: twitch.title,
        dryRun: false,
      }),
      1000,
    );
    await new Sentencer(store, twitch, () => {}).reverts(2000);
    expect(twitch.title).toBe('Original before legacy court');
    const payload = JSON.parse(
      store.get<{ payload_json: string }>('SELECT payload_json FROM sentences_applied')!
        .payload_json,
    );
    expect(payload.execution).toEqual({ mode: 'live', channelId: 'channel-fixture' });
  } finally {
    store.close();
  }
});

it('cancelling an overlapping conviction restores the earlier sentence until its own expiry', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {}),
    executor = new Sentencer(store, twitch, () => {});
  try {
    await executor.execute(trial(1), settings, { id: 'p', login: 'p' }, 1000);
    await executor.execute(trial(2), settings, { id: 'p', login: 'p' }, 100000);
    await executor.cancel(2, 100100);
    expect(twitch.title).toBe('[CONVICTED] Case 1');
    expect(
      store.get<{ reverted: number }>('SELECT reverted FROM sentences_applied WHERE case_id=1')
        ?.reverted,
    ).toBe(0);
    await executor.reverts(901001);
    await executor.reverts(901002);
    expect(twitch.writes).toEqual([
      '[CONVICTED] Case 1',
      '[CONVICTED] Case 2',
      '[CONVICTED] Case 1',
      'Original broadcast title',
    ]);
  } finally {
    store.close();
  }
});

it('persists cancellation while a title write is in flight and retains it after acknowledgment', async () => {
  config.DRY_RUN = false;
  const store = new Store(':memory:', 0),
    twitch = new LiveFixture(() => {}),
    executor = new Sentencer(store, twitch, () => {});
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const set = twitch.setTitle.bind(twitch);
  let first = true,
    active = true;
  twitch.setTitle = async (title) => {
    if (first) {
      first = false;
      await gate;
    }
    await set(title);
  };
  try {
    const work = executor.execute(trial(1), settings, { id: 'p', login: 'p' }, 1000, () => active);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(first).toBe(false);
    active = false;
    const cancel = executor.cancel(1, 2000);
    const payload = () =>
      JSON.parse(
        store.get<{ payload_json: string }>('SELECT payload_json FROM sentences_applied')!
          .payload_json,
      );
    expect(payload().cancelRequestedAt).toBe(2000);
    release();
    await work;
    await cancel;
    expect(payload().cancelRequestedAt).toBe(2000);
    expect(twitch.title).toBe('Original broadcast title');
  } finally {
    release();
    store.close();
  }
});

it('restores a title immediately after boot marks an interrupted trial as mistrial', async () => {
  config.DRY_RUN = false;
  const directory = mkdtempSync(join(tmpdir(), 'court-interrupted-')),
    path = join(directory, 'court.db'),
    twitch = new LiveFixture(() => {});
  let store = new Store(path, 0);
  try {
    store.run(
      "INSERT INTO cases(id,case_no,status,plaintiff_id,plaintiff_login,raw_charge,created_at_ms) VALUES(1,1,'in_trial','p','p','first try guaranteed',1000)",
    );
    await new Sentencer(store, twitch, () => {}).execute(
      trial(1),
      settings,
      { id: 'p', login: 'p' },
      1000,
    );
    store.close();
    store = new Store(path, 2000);
    const executor = new Sentencer(store, twitch, () => {});
    await executor.reverts(2000);
    await executor.reverts(2001);
    expect(twitch.title).toBe('Original broadcast title');
    expect(twitch.writes).toHaveLength(2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it('retries a failed mistrial restoration after restart without waiting for the original sentence expiry', async () => {
  config.DRY_RUN = false;
  const directory = mkdtempSync(join(tmpdir(), 'court-cancel-restart-')),
    path = join(directory, 'court.db'),
    twitch = new LiveFixture(() => {});
  let store = new Store(path, 0);
  try {
    store.run(
      "INSERT INTO cases(id,case_no,status,plaintiff_id,plaintiff_login,raw_charge,created_at_ms) VALUES(1,1,'in_trial','p','p','first try guaranteed',1000)",
    );
    const executor = new Sentencer(store, twitch, () => {});
    await executor.execute(trial(1), settings, { id: 'p', login: 'p' }, 1000);
    store.updateCase(1, { status: 'mistrial' });
    const set = twitch.setTitle.bind(twitch);
    let fail = true;
    twitch.setTitle = async (title) => {
      if (fail) {
        fail = false;
        throw Error('Disconnected during mistrial restore');
      }
      await set(title);
    };
    await expect(executor.cancel(1, 2000)).rejects.toThrow(/Disconnected/);
    store.close();
    store = new Store(path, 3000);
    await new Sentencer(store, twitch, () => {}).reverts(3000);
    expect(twitch.title).toBe('Original broadcast title');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
