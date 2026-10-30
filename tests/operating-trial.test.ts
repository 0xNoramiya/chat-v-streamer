import { expect, it } from 'vitest';
import { Store } from '../server/db.js';
import { CourtRunner } from '../server/court/runner.js';
import { CannedAI } from '../server/ai/service.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import { ManualClock, flush } from './manual-clock.js';
import type { Verdict } from '../web/src/shared/types.js';
for (const verdict of ['guilty', 'not_guilty', 'mistrial'] as const)
  it(`runs an entire ${verdict} trial through chat commands and approved consequences`, async () => {
    const clock = new ManualClock(),
      store = new Store(':memory:', 0),
      logs: string[] = [],
      runner = new CourtRunner(
        store,
        new SimTwitch((_k, m) => logs.push(m)),
        new SimObs((_k, m) => logs.push(m)),
        new CannedAI(),
        clock,
      );
    try {
      runner.addSegment('This boss is easy, first try guaranteed.', 90000, 91000, 'sim');
      runner.addSegment('That was the sixth attempt.', 92000, 93000, 'sim');
      const id = await runner.file(
        { id: 'plaintiff', login: 'plaintiff' },
        'he said first try guaranteed and died like six times',
        true,
      );
      expect(id).not.toBeNull();
      await runner.startNext();
      const started = clock.now();
      let injected = false;
      for (let step = 0; step < 20 && runner.state.trial; step++) {
        const t = runner.state.trial;
        if (t.phase === 'DEFENSE' && !injected) {
          runner.addSegment('My timing was wrong.', clock.now(), clock.now() + 1000, 'manual');
          injected = true;
        }
        if (t.phase === 'JURY') {
          if (verdict !== 'mistrial') {
            await runner.chat({ id: 'juror1', login: 'juror1' }, '!g');
            await runner.chat({ id: 'juror2', login: 'juror2' }, '!g');
            if (verdict === 'not_guilty') {
              await runner.chat({ id: 'juror1', login: 'juror1' }, '!ng');
              await runner.chat({ id: 'juror2', login: 'juror2' }, '!innocent');
            }
          }
        }
        clock.advance(t.deadline);
        await runner.tick();
        await flush();
      }
      await runner.settle();
      expect(runner.getCase(id!).verdict).toBe(verdict);
      expect(clock.now() - started).toBe(102000);
      expect(logs.some((l) => l.includes('restore previous scene'))).toBe(true);
      expect(store.records().precedents[0].verdict).toBe(verdict);
      expect(
        store.all('SELECT * FROM sentences_applied WHERE revert_at_ms IS NOT NULL'),
      ).toHaveLength(verdict === 'guilty' ? 1 : 0);
      expect(logs.some((l) => l.includes('setTitle: [CONVICTED]'))).toBe(verdict === 'guilty');
      expect(logs.some((l) => l.includes('timeout plaintiff'))).toBe(verdict === 'not_guilty');
    } finally {
      runner.close();
      store.close();
    }
  });
it('finishes with jury guilt and an approved fallback when both live-style AI providers never return', async () => {
  class NeverAI extends CannedAI {
    override rebuttal(): Promise<Awaited<ReturnType<CannedAI['rebuttal']>>> {
      return new Promise(() => {});
    }
    override verdict(): Promise<Awaited<ReturnType<CannedAI['verdict']>>> {
      return new Promise(() => {});
    }
  }
  const clock = new ManualClock(),
    store = new Store(':memory:', 0),
    runner = new CourtRunner(
      store,
      new SimTwitch(() => {}),
      new SimObs(() => {}),
      new NeverAI(),
      clock,
    );
  try {
    const id = await runner.demo();
    const started = clock.now();
    for (let step = 0; step < 20 && runner.state.trial; step++) {
      clock.advance(runner.state.trial.deadline);
      await runner.tick();
      await flush();
    }
    await runner.settle();
    expect(runner.getCase(id).verdict).toBe('guilty');
    expect(clock.now() - started).toBe(110000);
    expect(store.get<{ sentence_id: string }>('SELECT * FROM sentences_applied')?.sentence_id).toBe(
      'title_shame',
    );
  } finally {
    runner.close();
    store.close();
  }
});
