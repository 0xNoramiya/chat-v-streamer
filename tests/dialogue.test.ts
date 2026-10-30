import { expect, it } from 'vitest';
import { Store } from '../server/db.js';
import { CourtRunner } from '../server/court/runner.js';
import { CannedAI, fallbackVerdict } from '../server/ai/service.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import { announcements } from '../server/court/machine.js';
import { defaults } from '../server/config.js';
import { ManualClock, flush } from './manual-clock.js';
import type { CourtEvent, VerdictScript } from '../web/src/shared/types.js';
class DelayedSpeech extends CannedAI {
  delayed = false;
  complete: (() => void)[] = [];
  calls: string[] = [];
  cachedVerdict = false;
  verdictResult?: Promise<VerdictScript>;
  async speak(text: string) {
    this.calls.push(text);
    if (this.cachedVerdict && text === announcements.guilty) return '/tts/cached-verdict.mp3';
    if (this.delayed) await new Promise<void>((r) => this.complete.push(r));
    return this.delayed ? '/tts/fixture.mp3' : undefined;
  }
  override async verdict(...args: Parameters<CannedAI['verdict']>) {
    return this.verdictResult ?? super.verdict(...args);
  }
}
async function fixture(ai = new DelayedSpeech()) {
  const clock = new ManualClock(),
    store = new Store(':memory:', 0),
    runner = new CourtRunner(store, new SimTwitch(() => {}), new SimObs(() => {}), ai, clock),
    events: CourtEvent[] = [];
  runner.onEvent = (e) => events.push(e);
  await runner.demo();
  await flush();
  await runner.settle();
  events.length = 0;
  ai.delayed = true;
  const skip = () => {
    clock.advance(runner.state.trial!.deadline);
    runner.dispatch({ type: 'SKIP', now: clock.now() });
  };
  return {
    runner,
    store,
    ai,
    events,
    clock,
    skip,
    close: async () => {
      runner.close();
      await flush();
      await runner.settle();
      store.close();
    },
  };
}
it('shows the moderated caption before delayed speech is ready', async () => {
  const f = await fixture();
  try {
    f.skip();
    expect(f.events.some((e) => e.type === 'caption')).toBe(true);
    expect(f.events.some((e) => e.type === 'speech')).toBe(false);
  } finally {
    await f.close();
  }
});
it('discards speech from the prior exhibit even though the phase name has not changed', async () => {
  const f = await fixture();
  try {
    f.skip();
    await flush();
    const first = f.events.find((e) => e.type === 'caption')!;
    f.clock.advance(f.clock.now() + 1000);
    f.runner.dispatch({ type: 'SKIP', now: f.clock.now() });
    await flush();
    const next = f.events.filter((e) => e.type === 'caption').at(-1)!;
    expect(first).not.toHaveProperty('scope', next.type === 'caption' ? next.scope : '');
    f.events.length = 0;
    f.ai.complete[0]?.();
    await flush();
    expect(f.events.filter((e) => e.type === 'speech')).toHaveLength(0);
  } finally {
    await f.close();
  }
});
it('keeps hard clocks and the jury result when verdict generation consumes six seconds', async () => {
  const ai = new DelayedSpeech();
  let complete!: (v: VerdictScript) => void;
  ai.verdictResult = new Promise((r) => (complete = r));
  const f = await fixture(ai);
  try {
    while (f.runner.state.trial?.phase !== 'JURY') {
      f.skip();
      await flush();
    }
    f.runner.dispatch({ type: 'VOTE', userId: 'juror', vote: 'guilty', now: f.clock.now() });
    f.events.length = 0;
    f.skip();
    await flush();
    const start = f.clock.now();
    expect(f.runner.state.trial?.verdict).toBe('guilty');
    expect(f.events.find((e) => e.type === 'caption')).toHaveProperty('text', announcements.guilty);
    f.clock.advance(start + 5900);
    complete({
      ...fallbackVerdict('guilty', defaults.penalCode),
      verdict_line: 'Not guilty. An invented reversal.',
    });
    await flush();
    expect(f.runner.state.trial?.verdict).toBe('guilty');
    expect(f.events.filter((e) => e.type === 'caption')).toHaveLength(1);
    expect(f.events.filter((e) => e.type === 'speech')).toHaveLength(0);
    f.clock.advance(start + 8000);
    await f.runner.tick();
    await flush();
    expect(f.runner.state.trial?.phase).toBe('SENTENCING');
  } finally {
    await f.close();
  }
});
it('reuses a warmed fixed verdict announcement immediately', async () => {
  const ai = new DelayedSpeech();
  ai.cachedVerdict = true;
  const f = await fixture(ai);
  try {
    while (f.runner.state.trial?.phase !== 'JURY') {
      f.skip();
      await flush();
    }
    f.runner.dispatch({ type: 'VOTE', userId: 'juror', vote: 'guilty', now: f.clock.now() });
    f.events.length = 0;
    f.skip();
    expect(f.events.some((e) => e.type === 'speech' && e.url === '/tts/cached-verdict.mp3')).toBe(
      true,
    );
    expect(ai.calls.filter((t) => t === announcements.guilty)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it('cancels pending speech on mistrial and ignores its eventual provider result', async () => {
  const f = await fixture();
  try {
    f.skip();
    await flush();
    f.runner.dispatch({ type: 'MISTRIAL', now: f.clock.now() + 1 });
    f.events.length = 0;
    f.ai.complete[0]?.();
    await flush();
    expect(f.events.filter((e) => e.type === 'speech')).toHaveLength(0);
    expect(f.runner.state.trial).toBeNull();
  } finally {
    await f.close();
  }
});
