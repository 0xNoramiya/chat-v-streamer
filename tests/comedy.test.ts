import { afterEach, expect, it, vi } from 'vitest';
import { ComedyDesk } from '../server/comedy/desk.js';
import { ComedyPlayback } from '../web/src/overlay/comedyPlayback.js';
import {
  comedyPack,
  defaultCalibration,
  emptyComedy,
  manifestSchema,
  type ComedyEvent,
  type ComedySaved,
  type EffectInstance,
} from '../web/src/shared/comedy.js';
import { Store } from '../server/db.js';
import { CourtRunner } from '../server/court/runner.js';
import { CannedAI } from '../server/ai/service.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import { ManualClock } from './manual-clock.js';
afterEach(() => vi.useRealTimers());
function desk() {
  const events: ComedyEvent[] = [],
    saved: ComedySaved[] = [];
  const desk = new ComedyDesk(
    undefined,
    (value) => saved.push(structuredClone(value)),
    (event) => events.push(event),
    () => {},
  );
  desk.command({ action: 'calibrate', calibration: defaultCalibration }, 0);
  return { events, saved, desk };
}
it('validates manifests and commands without accepting arbitrary asset paths or animation code', () => {
  expect(comedyPack.effects).toHaveLength(6);
  expect(() =>
    manifestSchema.parse({
      ...comedyPack,
      effects: [{ ...comedyPack.effects[0], asset: 'https://untrusted.test/asset.png' }],
    }),
  ).toThrow();
  const f = desk();
  expect(() => f.desk.command({ action: 'trigger', effectId: 'unknown' }, 0)).toThrow(/Unknown/);
  expect(() =>
    f.desk.command({ action: 'trigger', effectId: 'poof', durationMs: 99999 }, 0),
  ).toThrow();
  expect(() =>
    f.desk.command(
      { action: 'place', effectId: 'silly_hat', placement: { x: 4, y: 0, scale: 1 } },
      0,
    ),
  ).toThrow();
  expect(() =>
    f.desk.command({ action: 'place', effectId: 'poof', placement: { x: 0, y: 0, scale: 1 } }, 0),
  ).toThrow(/attachable/);
});
it('triggers immediately, enforces cooldowns and a bounded overlap limit, and never queues gags', () => {
  const f = desk();
  f.desk.command({ action: 'trigger', effectId: 'poof' }, 1000);
  expect(f.events[0].instance).toMatchObject({
    startedAt: 1000,
    expiresAt: 2300,
    effectId: 'poof',
  });
  expect(() => f.desk.command({ action: 'trigger', effectId: 'poof' }, 1100)).toThrow(/cooling/);
  expect(() => f.desk.command({ action: 'trigger', effectId: 'bonk' }, 1100)).toThrow(/land/);
  f.desk.command({ action: 'trigger', effectId: 'seeing_stars' }, 1100);
  expect(() => f.desk.command({ action: 'trigger', effectId: 'case_closed' }, 1200)).toThrow(
    /land/,
  );
  f.desk.command({ action: 'trigger', effectId: 'bonk' }, 2300);
  expect(f.events).toHaveLength(3);
  expect(new Set(f.events.map((e) => e.instance.id)).size).toBe(3);
  f.desk.snapshot(99999);
  expect(f.events).toHaveLength(3);
});
it('persists only props, placement and sound; reconnects/restarts never replay explosions', () => {
  const f = desk();
  f.desk.command({ action: 'trigger', effectId: 'poof' }, 1000);
  f.desk.command({ action: 'trigger', effectId: 'silly_hat' }, 1000);
  f.desk.command(
    { action: 'place', effectId: 'silly_hat', placement: { x: 0.3, y: 0.2, scale: 0.8 } },
    1200,
  );
  f.desk.command({ action: 'sound', muted: true, volume: 0.2 }, 1200);
  const restored = new ComedyDesk(
    f.saved.at(-1),
    () => {},
    () => {
      throw Error('must not replay');
    },
    () => {},
  );
  const snapshot = restored.snapshot(1300);
  expect(snapshot.props).toHaveLength(1);
  expect(snapshot.props[0].placement).toEqual({ x: 0.3, y: 0.2, scale: 0.8 });
  expect(snapshot.sound).toEqual({ muted: true, volume: 0.2 });
  expect(snapshot).not.toHaveProperty('active');
  expect(snapshot.epoch).not.toBe(f.events[0].epoch);
  restored.command({ action: 'remove', effectId: 'silly_hat' }, 1400);
  expect(restored.snapshot(1400).props).toEqual([]);
});
it('clear-all always clears props and cancels previously emitted transient events', () => {
  const f = desk();
  f.desk.command({ action: 'trigger', effectId: 'poof' }, 0);
  f.desk.command({ action: 'trigger', effectId: 'silly_hat' }, 0);
  const epoch = f.events[0].epoch;
  f.desk.command({ action: 'clear' }, 100);
  expect(f.desk.snapshot(100)).toMatchObject({ props: [] });
  expect(f.desk.snapshot(100).epoch).not.toBe(epoch);
  f.desk.command({ action: 'clear' }, 100);
  expect(f.desk.snapshot(100).props).toEqual([]);
});
it('ignores expired/duplicate/obsolete events, removes completed DOM instances, and reconnects without replay', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  let rendered: EffectInstance[] = [];
  const player = new ComedyPlayback((instances) => {
    rendered = instances;
  });
  const play = vi.spyOn(player.sounds, 'play').mockImplementation(() => {}),
    f = desk();
  player.sync(f.desk.snapshot(1000));
  f.desk.command({ action: 'trigger', effectId: 'poof' }, 1000);
  player.accept(f.events[0]);
  player.accept(f.events[0]);
  expect(rendered).toHaveLength(1);
  expect(play).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1300);
  expect(rendered).toEqual([]);
  player.accept(f.events[0]);
  expect(rendered).toEqual([]);
  f.desk.command({ action: 'trigger', effectId: 'bonk' }, 2300);
  const obsolete = f.events[1];
  f.desk.clear(true);
  player.sync(f.desk.snapshot(2300));
  player.accept(obsolete);
  expect(rendered).toEqual([]);
  const reconnected = new ComedyPlayback((instances) => {
    rendered = instances;
  });
  reconnected.sync(f.desk.snapshot(2300));
  expect(rendered).toEqual([]);
  player.close();
  reconnected.close();
});
it('mistrial clears current gags and props, and comedy commands never change the trial', async () => {
  const store = new Store(':memory:', 0),
    clock = new ManualClock(),
    runner = new CourtRunner(
      store,
      new SimTwitch(() => {}),
      new SimObs(() => {}),
      new CannedAI(),
      clock,
    );
  try {
    await runner.demo();
    runner.comedy.command({ action: 'calibrate', calibration: defaultCalibration }, clock.now());
    const before = structuredClone(runner.state);
    runner.comedy.command({ action: 'trigger', effectId: 'silly_hat' }, clock.now());
    runner.comedy.command({ action: 'trigger', effectId: 'poof' }, clock.now());
    expect(runner.state).toEqual(before);
    const epoch = runner.comedy.snapshot(clock.now()).epoch;
    runner.dispatch({ type: 'MISTRIAL', now: clock.now() });
    await runner.settle();
    expect(runner.comedy.snapshot(clock.now()).epoch).not.toBe(epoch);
    expect(runner.comedy.snapshot(clock.now()).props).toHaveLength(0);
    runner.comedy.command({ action: 'clear' }, clock.now());
    expect(runner.comedy.snapshot(clock.now()).props).toEqual([]);
    expect(store.all('SELECT * FROM sentences_applied')).toEqual([]);
  } finally {
    runner.close();
    store.close();
  }
});
it('muted and zero-volume sounds never start an AudioContext', () => {
  const player = new ComedyPlayback(() => {}),
    unlock = vi.spyOn(player.sounds, 'unlock');
  player.sounds.configure({ muted: true, volume: 1 });
  player.sounds.play('bonk', 0);
  player.sounds.configure({ muted: false, volume: 0 });
  player.sounds.play('poof', 0);
  expect(unlock).not.toHaveBeenCalled();
  player.close();
});
it('a zero-vote jury mistrial clears gags as soon as its verdict is computed', async () => {
  const store = new Store(':memory:', 0),
    clock = new ManualClock(),
    runner = new CourtRunner(
      store,
      new SimTwitch(() => {}),
      new SimObs(() => {}),
      new CannedAI(),
      clock,
    );
  try {
    await runner.demo();
    while (runner.state.trial?.phase !== 'JURY') {
      clock.advance(clock.now() + 1000);
      runner.dispatch({ type: 'SKIP', now: clock.now() });
    }
    runner.comedy.command({ action: 'trigger', effectId: 'poof' }, clock.now());
    const epoch = runner.comedy.snapshot(clock.now()).epoch;
    clock.advance(clock.now() + 100);
    runner.dispatch({ type: 'SKIP', now: clock.now() });
    expect(runner.state.trial?.verdict).toBe('mistrial');
    expect(runner.comedy.snapshot(clock.now()).epoch).not.toBe(epoch);
    await runner.settle();
  } finally {
    runner.close();
    store.close();
  }
});
