import { expect, it } from 'vitest';
import { Store } from '../server/db.js';
import { CourtRunner } from '../server/court/runner.js';
import { CannedAI } from '../server/ai/service.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import { ManualClock } from './manual-clock.js';

type Stage = 'filing' | 'screening' | 'clerk' | 'script';
class DelayedAI extends CannedAI {
  release!: () => void;
  private entered!: () => void;
  reached = new Promise<void>((resolve) => {
    this.entered = resolve;
  });
  private gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  private moderationCalls = 0;
  clerkCalls = 0;
  constructor(private stage: Stage) {
    super();
  }
  private async pause(stage: Stage) {
    if (this.stage !== stage) return;
    this.entered();
    await this.gate;
  }
  async moderate() {
    await this.pause(++this.moderationCalls === 1 ? 'filing' : 'screening');
    return true;
  }
  override async clerk(...args: Parameters<CannedAI['clerk']>) {
    this.clerkCalls++;
    await this.pause('clerk');
    return super.clerk(...args);
  }
  override async trial(...args: Parameters<CannedAI['trial']>) {
    await this.pause('script');
    return super.trial(...args);
  }
}
function fixture(ai = new CannedAI()) {
  const store = new Store(':memory:', 0),
    clock = new ManualClock(),
    runner = new CourtRunner(store, new SimTwitch(() => {}), new SimObs(() => {}), ai, clock);
  runner.updateSettings({ ...runner.settings, tts: false });
  runner.addSegment(
    'This boss is easy, first try guaranteed.',
    clock.now() - 2000,
    clock.now() - 1000,
    'sim',
  );
  return {
    store,
    runner,
    close() {
      runner.close();
      store.close();
    },
  };
}
const plaintiff = { id: 'plaintiff', login: 'plaintiff' },
  charge = 'he said first try guaranteed and died like six times';

it('vetoes a filing so later cosign commands cannot screen or start it', async () => {
  const f = fixture();
  try {
    const id = (await f.runner.file(plaintiff, charge))!;
    f.runner.approve(f.runner.getCase(id).case_no, false);
    await f.runner.chat({ id: 'viewer2', login: 'viewer2' }, '!cosign');
    await f.runner.chat({ id: 'viewer3', login: 'viewer3' }, '!cosign');
    await f.runner.startNext();
    expect(f.runner.getCase(id)).toMatchObject({
      status: 'rejected',
      reject_reason: 'streamer_veto',
    });
    expect(f.runner.state.trial).toBeNull();
  } finally {
    f.close();
  }
});

for (const stage of ['filing', 'screening', 'clerk', 'script'] as const)
  it(`does not revive a veto after delayed ${stage} work returns`, async () => {
    const ai = new DelayedAI(stage),
      f = fixture(ai);
    try {
      const work = f.runner.file(plaintiff, charge, true);
      await ai.reached;
      const c = f.runner.cases()[0];
      await f.runner.chat({ id: 'mod', login: 'mod', mod: true }, `!veto ${c.case_no}`);
      ai.release();
      const id = (await work)!;
      await f.runner.startNext();
      expect(f.runner.getCase(id)).toMatchObject({
        status: 'rejected',
        reject_reason: 'streamer_veto',
      });
      expect(f.runner.state.trial).toBeNull();
      if (stage === 'filing' || stage === 'screening') expect(ai.clerkCalls).toBe(0);
    } finally {
      ai.release();
      f.close();
    }
  });

it('keeps approval gated until successful screening, then permits approval or veto', async () => {
  const ai = new DelayedAI('clerk'),
    f = fixture(ai);
  try {
    f.runner.updateSettings({ ...f.runner.settings, autoApprove: false });
    const id = (await f.runner.file(plaintiff, charge))!;
    const number = f.runner.getCase(id).case_no;
    f.runner.approve(number, true);
    expect(f.runner.getCase(id).status).toBe('filing');
    await f.runner.chat({ id: 'viewer2', login: 'viewer2' }, '!cosign');
    const screening = f.runner.chat({ id: 'viewer3', login: 'viewer3' }, '!cosign');
    await ai.reached;
    f.runner.approve(number, true);
    expect(f.runner.getCase(id).status).toBe('screening');
    ai.release();
    await screening;
    expect(f.runner.getCase(id).status).toBe('pending_approval');
    f.runner.approve(number, true);
    expect(f.runner.getCase(id).status).toBe('queued');
    f.runner.approve(number, false);
    await f.runner.startNext();
    expect(f.runner.getCase(id).status).toBe('rejected');
    f.runner.approve(number, true);
    expect(f.runner.getCase(id).status).toBe('rejected');
    expect(f.runner.state.trial).toBeNull();
  } finally {
    ai.release();
    f.close();
  }
});
