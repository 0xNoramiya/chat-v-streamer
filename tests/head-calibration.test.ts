import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComedyDesk } from '../server/comedy/desk.js';
import {
  comedyPack,
  defaultCalibration,
  type ComedyEvent,
  type EffectInstance,
} from '../web/src/shared/comedy.js';
import { effectGeometry } from '../web/src/shared/comedyGeometry.js';
import { ComedyPlayback } from '../web/src/overlay/comedyPlayback.js';
import { ManualClock } from './manual-clock.js';
import { Store } from '../server/db.js';
import { CourtRunner } from '../server/court/runner.js';
import { CannedAI } from '../server/ai/service.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
const camera = { x: 1180, y: 400, w: 600, h: 450 };
const effect = (id: string) => comedyPack.effects.find((e) => e.id === id)!;
afterEach(() => vi.useRealTimers());
it('puts the brim at the crown and mallet contact at the calibrated target, with metadata anchors', () => {
  const hat = effect('silly_hat'),
    box = effectGeometry(hat, hat.placement, defaultCalibration, camera);
  expect(box.left + hat.anchor.x * box.width).toBeCloseTo(
    camera.x + camera.w * defaultCalibration.crown.x,
  );
  expect(box.top + hat.anchor.y * box.height).toBeCloseTo(
    camera.y + camera.h * defaultCalibration.crown.y,
  );
  expect(box.top + box.height - box.y).toBeLessThan(40);
  const bonk = effectGeometry(effect('bonk'), effect('bonk').placement, defaultCalibration, camera);
  expect(bonk.x).toBeCloseTo(camera.x + camera.w * defaultCalibration.contact.x);
  expect(bonk.y).toBeCloseTo(camera.y + camera.h * defaultCalibration.contact.y);
  expect(effect('bonk').impact!.atMs).toBe(effect('bonk').soundAtMs);
});
it('adapts to moved/resized cameras and different head positions without rewriting calibration', () => {
  const hat = effect('silly_hat'),
    head = { crown: { x: 0.4, y: 0.4 }, headWidth: 0.2, contact: { x: 0.45, y: 0.42 } };
  const a = effectGeometry(hat, hat.placement, head, camera),
    moved = { x: 80, y: 280, w: 720, h: 540 },
    b = effectGeometry(hat, hat.placement, head, moved);
  expect((a.x - camera.x) / camera.w).toBeCloseTo((b.x - moved.x) / moved.w);
  expect((a.y - camera.y) / camera.h).toBeCloseTo((b.y - moved.y) / moved.h);
  expect(b.width / a.width).toBeCloseTo(1.2);
  expect(b.fits).toBe(true);
});
it('rejects a wearable hat with inadequate room and returns actionable reframing guidance', () => {
  const desk = new ComedyDesk(
    undefined,
    () => {},
    () => {},
    () => {},
  );
  desk.command(
    { action: 'calibrate', calibration: { ...defaultCalibration, crown: { x: 0.5, y: 0.02 } } },
    1000,
  );
  expect(() => desk.command({ action: 'trigger', effectId: 'silly_hat' }, 1000)).toThrow(
    /headroom.*OBS/,
  );
  expect(desk.snapshot(1000).props).toEqual([]);
});
it('persists calibration independently in SQLite across runner restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'court-head-')),
    path = join(directory, 'court.db');
  let store = new Store(path, 0),
    runner = new CourtRunner(store, new SimTwitch(() => {}), new SimObs(() => {}), new CannedAI());
  try {
    const settings = store.settings(),
      calibration = { ...defaultCalibration, headWidth: 0.18, crown: { x: 0.4, y: 0.4 } };
    runner.comedy.command({ action: 'calibrate', calibration }, 1000);
    runner.close();
    store.close();
    store = new Store(path, 2000);
    runner = new CourtRunner(store, new SimTwitch(() => {}), new SimObs(() => {}), new CannedAI());
    expect(runner.comedy.snapshot(2000).calibration).toEqual(calibration);
    expect(store.settings()).toEqual(settings);
  } finally {
    runner.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
function sequenceFixture() {
  const clock = new ManualClock(),
    events: ComedyEvent[] = [],
    desk = new ComedyDesk(
      undefined,
      () => {},
      (e) => events.push(e),
      () => {},
      { clock },
    );
  desk.command({ action: 'calibrate', calibration: defaultCalibration }, clock.now());
  return { clock, events, desk };
}
it('stages mallet then stars after contact and the stunned pause, with no extra transient queue', () => {
  const f = sequenceFixture(),
    start = f.clock.now();
  f.desk.command({ action: 'sequence', sequenceId: 'bonk_stars' }, start);
  expect(f.events.map((e) => e.instance.effectId)).toEqual(['bonk']);
  expect(() => f.desk.command({ action: 'trigger', effectId: 'poof' }, start + 100)).toThrow(
    /sequence/,
  );
  f.clock.advance(start + 1249);
  expect(f.events).toHaveLength(1);
  f.clock.advance(start + 1250);
  expect(f.events.map((e) => e.instance.effectId)).toEqual(['bonk', 'seeing_stars']);
  expect(f.events[1].instance.sequenceId).toBe(f.events[0].instance.sequenceId);
  f.clock.advance(start + 6000);
  expect(f.desk.snapshot(f.clock.now()).sequence).toBeNull();
  f.desk.close();
});
for (const transientOnly of [false, true])
  it(`cancels current and future sequence steps on ${transientOnly ? 'transient cancellation' : 'clear all'}`, () => {
    const f = sequenceFixture(),
      start = f.clock.now();
    f.desk.command({ action: 'sequence', sequenceId: 'bonk_stars' }, start);
    f.clock.advance(start + 500);
    const epoch = f.desk.snapshot(f.clock.now()).epoch;
    f.desk.clear(transientOnly);
    f.clock.advance(start + 10000);
    expect(f.events).toHaveLength(1);
    expect(f.desk.snapshot(f.clock.now()).epoch).not.toBe(epoch);
    expect(f.desk.snapshot(f.clock.now()).sequence).toBeNull();
  });
it('a reconnected overlay ignores the future steps of a sequence already in flight', () => {
  vi.useFakeTimers();
  const f = sequenceFixture();
  vi.setSystemTime(f.clock.now());
  let oldRender: EffectInstance[] = [],
    joinedRender: EffectInstance[] = [];
  const old = new ComedyPlayback((v) => {
      oldRender = v;
    }),
    joined = new ComedyPlayback((v) => {
      joinedRender = v;
    });
  vi.spyOn(old.sounds, 'play').mockImplementation(() => {});
  vi.spyOn(joined.sounds, 'play').mockImplementation(() => {});
  old.sync(f.desk.snapshot(f.clock.now()), true);
  f.desk.command({ action: 'sequence', sequenceId: 'bonk_stars' }, f.clock.now());
  old.accept(f.events[0]);
  joined.sync(f.desk.snapshot(f.clock.now()), true);
  vi.advanceTimersByTime(1250);
  f.clock.advance(f.clock.now() + 1250);
  old.accept(f.events[1]);
  joined.accept(f.events[1]);
  expect(oldRender).toHaveLength(2);
  expect(joinedRender).toEqual([]);
  old.close();
  joined.close();
  f.desk.close();
});
it('migrates old center-based placements without reusing face-covering offsets', () => {
  const legacy = {
    props: [],
    placements: { silly_hat: { x: 0.5, y: 0.14, scale: 0.5 } },
    sound: { muted: true, volume: 0.2 },
  };
  const desk = new ComedyDesk(
    legacy,
    () => {},
    () => {},
    () => {},
  );
  expect(desk.snapshot(0).placements).not.toHaveProperty('silly_hat');
  expect(desk.snapshot(0).calibration).toEqual(defaultCalibration);
  expect(desk.snapshot(0).sound).toEqual(legacy.sound);
});
it('mistrial through the court runner cancels the pending stars without changing hard deadlines', async () => {
  const clock = new ManualClock(),
    store = new Store(':memory:', 0),
    runner = new CourtRunner(
      store,
      new SimTwitch(() => {}),
      new SimObs(() => {}),
      new CannedAI(),
      clock,
    ),
    events: ComedyEvent[] = [];
  runner.onEvent = (event) => {
    if (event.type === 'comedy_trigger') events.push(event);
  };
  try {
    await runner.demo();
    runner.comedy.command({ action: 'calibrate', calibration: defaultCalibration }, clock.now());
    const deadline = runner.state.trial!.deadline;
    runner.comedy.command({ action: 'sequence', sequenceId: 'bonk_stars' }, clock.now());
    expect(runner.state.trial!.deadline).toBe(deadline);
    clock.advance(clock.now() + 300);
    runner.dispatch({ type: 'MISTRIAL', now: clock.now() });
    clock.advance(clock.now() + 10000);
    await runner.settle();
    expect(events.map((event) => event.instance.effectId)).toEqual(['bonk']);
    expect(runner.state.trial).toBeNull();
    expect(store.all('SELECT * FROM sentences_applied')).toEqual([]);
  } finally {
    runner.close();
    store.close();
  }
});
it('requires an explicitly saved calibration before guessing any head placement', () => {
  const desk = new ComedyDesk(
    undefined,
    () => {},
    () => {},
    () => {},
  );
  expect(() => desk.command({ action: 'trigger', effectId: 'silly_hat' }, 0)).toThrow(
    /calibration/,
  );
  expect(() => desk.command({ action: 'sequence', sequenceId: 'bonk_stars' }, 0)).toThrow(
    /calibration/,
  );
  expect(desk.snapshot(0).calibrated).toBe(false);
});
it('sounds BONK once on the rendered impact frame instead of scheduling audio ahead of painting', () => {
  vi.useFakeTimers();
  const f = sequenceFixture();
  vi.setSystemTime(f.clock.now());
  const player = new ComedyPlayback(() => {}),
    sound = vi.spyOn(player.sounds, 'play').mockImplementation(() => {});
  player.sync(f.desk.snapshot(f.clock.now()));
  f.desk.command({ action: 'trigger', effectId: 'bonk' }, f.clock.now());
  player.accept(f.events[0]);
  expect(sound).not.toHaveBeenCalled();
  vi.advanceTimersByTime(670);
  player.impact(f.events[0].instance.id);
  player.impact(f.events[0].instance.id);
  expect(sound).toHaveBeenCalledExactlyOnceWith('bonk', 0);
  player.clear();
  player.impact(f.events[0].instance.id);
  expect(sound).toHaveBeenCalledTimes(1);
  player.close();
  f.desk.close();
});
