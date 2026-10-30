import { describe, it, expect } from 'vitest';
import { reducer } from '../server/court/machine.js';
import { defaults } from '../server/config.js';
import { tally, severityCap } from '../server/court/jury.js';
import { parseCommand } from '../server/court/commands.js';
import { cosignThreshold, filingError, canCosign } from '../server/court/docket.js';
import { Store } from '../server/db.js';
import { CourtRunner, type Clock } from '../server/court/runner.js';
import { CannedAI } from '../server/ai/service.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import type { Case, CourtState, TrialScript } from '../web/src/shared/types.js';
const script: TrialScript = {
  has_case: true,
  exhibits: [],
  cited_precedent_id: null,
  opening_line: 'Court is in session.',
  exhibit_lines: ['A receipt.'],
  defense_prompt: 'Thirty seconds.',
};
const start = () =>
  reducer(
    { trial: null, now: 0, cooldownUntil: 0 },
    {
      type: 'START',
      caseId: 1,
      name: 'Chat v. Test: The First Try Affair',
      formalCharge: 'A guarantee was broken.',
      script,
      exhibits: [
        {
          segment_id: 'seg_1',
          text: 'first try guaranteed',
          timestamp: '00:00:01',
          framing: 'The claim.',
          frame_url: null,
          struck: false,
          added_in: 'opening',
        },
      ],
      now: 0,
    },
    defaults,
  ).state;
describe('jury', () => {
  it('ties acquit, silence causes mistrial, last vote counts', () => {
    expect(tally({ a: 'guilty', b: 'not_guilty' }).verdict).toBe('not_guilty');
    expect(tally({}).verdict).toBe('mistrial');
    const votes = { a: 'guilty' as const };
    expect(tally({ ...votes, a: 'not_guilty' }).notGuilty).toBe(1);
  });
  it('caps severity from guilty share', () => {
    expect([0.59, 0.6, 0.799, 0.8].map(severityCap)).toEqual([1, 2, 2, 3]);
  });
});
describe('parser', () => {
  it('handles aliases, case numbers and strict arguments', () => {
    expect(parseCommand('!g')).toEqual({ type: 'vote', vote: 'guilty' });
    expect(parseCommand('!innocent')).toEqual({ type: 'vote', vote: 'not_guilty' });
    expect(parseCommand('!cosign 17')).toEqual({ type: 'cosign', id: 17 });
    expect(parseCommand('!strike b')).toEqual({ type: 'strike', index: 1 });
    expect(parseCommand('!court off')).toEqual({ type: 'court', on: false });
    expect(parseCommand('!g garbage')).toBeNull();
    expect(parseCommand('hello')).toBeNull();
  });
});
describe('docket', () => {
  it('clamps thresholds and enforces cooldowns', () => {
    expect([0, 100, 1000].map((n) => cosignThreshold(n, defaults))).toEqual([2, 5, 8]);
    const c = {
      id: 1,
      plaintiff_id: 'a',
      created_at_ms: 1000,
      status: 'filing',
      cosigners: [],
    } as unknown as Case;
    expect(filingError('a charge', 'a', [c], defaults, 2000)).toMatch(/wait/);
    expect(canCosign(c, 'a', 2000, defaults)).toBe(false);
    expect(canCosign(c, 'b', 2000, defaults)).toBe(true);
    expect(canCosign(c, 'b', 61000, defaults)).toBe(false);
  });
});
describe('machine', () => {
  it('is pure and advances at exact deadlines', () => {
    const state = start();
    const next = reducer(
      state,
      { type: 'TICK', now: defaults.phaseMs.CALL_TO_ORDER - 1 },
      defaults,
    );
    expect(next.state.trial?.phase).toBe('CALL_TO_ORDER');
    expect(
      reducer(state, { type: 'TICK', now: defaults.phaseMs.CALL_TO_ORDER }, defaults).state.trial
        ?.phase,
    ).toBe('EXHIBITS');
    expect(state.trial?.phase).toBe('CALL_TO_ORDER');
  });
  it('mistrial immediately restores and prevents sentence', () => {
    const result = reducer(start(), { type: 'MISTRIAL', now: 1 }, defaults);
    expect(result.state.trial).toBeNull();
    expect(result.effects.map((e) => e.type)).toContain('restoreScene');
    expect(result.effects.map((e) => e.type)).not.toContain('executeSentence');
  });
  it('ignores votes outside jury and allows one strike', () => {
    let s = start();
    s = reducer(s, { type: 'VOTE', userId: 'a', vote: 'guilty', now: 1 }, defaults).state;
    expect(s.trial?.votes).toEqual({});
    s = reducer(s, { type: 'STRIKE', index: 0, now: 2 }, defaults).state;
    expect(s.trial?.strikeUsed).toBe(true);
    expect(s.trial?.exhibits[0].struck).toBe(true);
  });
  it('finishes even when no AI results arrive', () => {
    let s: CourtState = start();
    let sentenceCount = 0;
    for (let i = 0; i < 15 && s.trial; i++) {
      const result = reducer(s, { type: 'TICK', now: s.trial.deadline }, defaults);
      sentenceCount += result.effects.filter((e) => e.type === 'executeSentence').length;
      s = result.state;
    }
    expect(s.trial).toBeNull();
    expect(sentenceCount).toBe(1);
  });
});
it('runs the complete offline demo with persistence and automatic sentence', async () => {
  let now = 100000;
  const clock: Clock = { now: () => now, setInterval, clearInterval };
  const db = new Store(':memory:', 0);
  const actions: string[] = [];
  const log = (_k: string, m: string) => actions.push(m);
  const runner = new CourtRunner(db, new SimTwitch(log), new SimObs(log), new CannedAI(), clock);
  const id = await runner.demo();
  for (let i = 0; i < 20 && runner.state.trial; i++) {
    await runner.settle();
    now = runner.state.trial.deadline;
    await runner.tick();
  }
  await runner.settle();
  expect(runner.getCase(id)).toMatchObject({
    verdict: 'guilty',
    guilty_votes: 5,
    not_guilty_votes: 2,
  });
  expect(actions.some((a) => a.includes('setTitle: [CONVICTED]'))).toBe(true);
  expect(db.records().precedents).toHaveLength(1);
  runner.close();
  db.close();
});

it('rejects a vote at the exact jury deadline and applies the absolute three-minute cap', () => {
  let state = start();
  for (let i = 0; i < 4; i++)
    state = reducer(state, { type: 'SKIP', now: 1000 + i * 1000 }, defaults).state;
  expect(state.trial?.phase).toBe('JURY');
  const deadline = state.trial!.deadline;
  const late = reducer(
    state,
    { type: 'VOTE', userId: 'late', vote: 'guilty', now: deadline },
    defaults,
  );
  expect(late.state.trial?.votes).toEqual({});
  const hard = reducer(state, { type: 'TICK', now: 180000 }, defaults);
  expect(hard.state.trial).toBeNull();
  expect(hard.effects.map((e) => e.type)).toContain('restoreScene');
  expect(hard.effects.map((e) => e.type)).not.toContain('executeSentence');
});

it('defaults to 94–110 seconds for one to three receipts without shortening defense or voting', () => {
  const { EXHIBITS, ...fixed } = defaults.phaseMs;
  const base = Object.values(fixed).reduce((sum, ms) => sum + ms, 0);
  expect([1, 2, 3].map((n) => base + n * EXHIBITS)).toEqual([94000, 102000, 110000]);
  expect(defaults.phaseMs.DEFENSE).toBe(30000);
  expect(defaults.phaseMs.JURY).toBe(20000);
});
