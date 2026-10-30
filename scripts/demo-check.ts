import assert from 'node:assert/strict';
import { Store } from '../server/db.js';
import { CourtRunner, type Clock } from '../server/court/runner.js';
import { SimTwitch } from '../server/adapters/twitch/sim.js';
import { SimObs } from '../server/adapters/obs/sim.js';
import { CannedAI } from '../server/ai/service.js';
let now = Date.now();
const clock: Clock = { now: () => now, setInterval, clearInterval };
const store = new Store(':memory:', now - 60000);
const logs: { kind: string; text: string }[] = [];
const log = (kind: string, text: string) => logs.push({ kind, text });
const runner = new CourtRunner(store, new SimTwitch(log), new SimObs(log), new CannedAI(), clock);
const phases: string[] = [];
const id = await runner.demo();
for (let step = 0; step < 20 && runner.state.trial; step++) {
  await runner.settle();
  phases.push(runner.state.trial.phase);
  now = runner.state.trial.deadline;
  await runner.tick();
}
await runner.settle();
const result = runner.getCase(id);
assert.equal(result.verdict, 'guilty');
assert.equal(result.guilty_votes, 5);
assert.equal(result.not_guilty_votes, 2);
assert.match(result.defense_text, /lag/);
assert.equal(runner.state.trial, null);
assert.equal(store.records().precedents.length, 1);
assert.ok(logs.some((l) => l.text.includes('SIM setTitle: [CONVICTED]')));
assert.ok(logs.some((l) => l.text.includes('restore previous scene')));
const safe = JSON.stringify(runner.snapshot(false));
assert.ok(!safe.includes('he said first try guaranteed and died like six times'));
console.log(
  JSON.stringify({
    ok: true,
    phases,
    verdict: result.verdict,
    votes: [5, 2],
    sentence: 'title_shame',
    precedents: store.records().precedents.length,
  }),
);
runner.close();
store.close();
