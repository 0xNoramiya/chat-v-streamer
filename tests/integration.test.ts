import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { AIClient } from '../server/ai/client.js';
import { trialSchema } from '../server/ai/schemas.js';
import { deadline } from '../server/ai/deadline.js';
import { Store } from '../server/db.js';
import { CannedAI } from '../server/ai/service.js';
import { CourtRunner, type Clock } from '../server/court/runner.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import type { TrialScript, Settings } from '../web/src/shared/types.js';
const script: TrialScript = {
  has_case: true,
  exhibits: [{ segment_id: 'fake_id', framing: 'An invented receipt.' }],
  cited_precedent_id: null,
  opening_line: 'All rise.',
  exhibit_lines: ['A receipt.'],
  defense_prompt: 'Defend yourself.',
};
function fixture(ai = new CannedAI()) {
  let now = 100000;
  const store = new Store(':memory:', 0),
    clock: Clock = { now: () => now, setInterval, clearInterval };
  const logs: string[] = [];
  const runner = new CourtRunner(
    store,
    new SimTwitch((_k, m) => logs.push(m)),
    new SimObs(() => {}),
    ai,
    clock,
  );
  return {
    runner,
    store,
    logs,
    advance: async () => {
      now = runner.state.trial?.deadline ?? now + 1000;
      await runner.tick();
      await runner.settle();
    },
  };
}
describe('integration boundaries', () => {
  it('official SDK emits a strict Responses schema and validates returned JSON', async () => {
    let payload: Record<string, unknown> = {};
    const sdk = new OpenAI({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async (_url, init) => {
        payload = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: 'resp_test',
            object: 'response',
            status: 'completed',
            output: [
              {
                id: 'msg_test',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: JSON.stringify(script), annotations: [] }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const client = new AIClient(() => {}, sdk);
    expect(
      await client.call('trialScript', { case_name: 'sample' }, trialSchema, script, 1000),
    ).toEqual(script);
    expect(payload).toHaveProperty('text.format.type', 'json_schema');
    expect(payload).toHaveProperty('text.format.strict', true);
    expect(payload).toHaveProperty('text.format.schema.additionalProperties', false);
  });
  it('enforces the outer AI deadline even if a provider never resolves', async () => {
    vi.useFakeTimers();
    const work = deadline(new Promise<string>(() => {}), 8000, async () => 'canned');
    await vi.advanceTimersByTimeAsync(8000);
    expect(await work).toBe('canned');
    vi.useRealTimers();
  });
  it('dismisses an actual queued case when every exhibit ID is invented', async () => {
    class InventedAI extends CannedAI {
      override async trial() {
        return script;
      }
    }
    const { runner, store } = fixture(new InventedAI());
    const id = await runner.demo();
    expect(runner.getCase(id).status).toBe('dismissed');
    expect(runner.state.trial).toBeNull();
    expect(store.all('SELECT * FROM exhibits')).toEqual([]);
    runner.close();
    store.close();
  });
  it('does not expose raw chat or defenses on the overlay socket snapshot', async () => {
    const { runner, store } = fixture();
    const id = await runner.demo();
    const overlay = JSON.stringify(runner.snapshot(false));
    expect(overlay).not.toContain(runner.getCase(id).raw_charge);
    expect(runner.snapshot(false).segments).toEqual([]);
    expect(runner.snapshot(false).logs).toEqual([]);
    runner.close();
    store.close();
  });
  it('keeps an approved manual sentence after adjourn and clears it only when served', async () => {
    const { runner, store, advance } = fixture();
    const settings: Settings = {
      ...runner.settings,
      streamerName: 'TestCaster',
      penalCode: runner.settings.penalCode.map((p) => ({ ...p, approved: p.id === 'hydrate' })),
    };
    runner.updateSettings(settings);
    const id = await runner.demo();
    for (let i = 0; i < 20 && runner.state.trial; i++) await advance();
    expect(runner.getCase(id).verdict).toBe('guilty');
    expect(store.records().convictions[0].name).toContain('TestCaster');
    expect(store.activeSentences()).toMatchObject([{ case_id: id, sentence_id: 'hydrate' }]);
    runner.serveSentence(id);
    expect(store.activeSentences()).toEqual([]);
    runner.close();
    store.close();
  });
  it('mistrial cancels a prepared sentence and late AI cannot resurrect a trial', async () => {
    const { runner, store } = fixture();
    const id = await runner.demo();
    runner.dispatch({ type: 'MISTRIAL', now: 100001 });
    runner.dispatch({
      type: 'VERDICT_READY',
      result: {
        verdict_line: 'Guilty',
        sentence_id: 'title_shame',
        sentence_flavor: '',
        title_text: '[CONVICTED]',
        precedent_summary: 'Established: sample',
      },
      now: 100002,
    });
    await runner.settle();
    expect(runner.state.trial).toBeNull();
    expect(runner.getCase(id).verdict).toBe('mistrial');
    expect(store.all('SELECT * FROM sentences_applied')).toHaveLength(0);
    runner.close();
    store.close();
  });
  it('offline jurisdiction is conservative and does not repeat personal allegations', async () => {
    const ai = new CannedAI();
    for (const raw of [
      'he said his mother is ugly',
      'he said he stole money',
      'he said another streamer committed a crime',
      'he said my address on stream',
    ]) {
      const result = await ai.clerk(raw, []);
      expect(result.admissible).toBe(false);
      expect(result.formal_charge).toBe('');
    }
  });
});
