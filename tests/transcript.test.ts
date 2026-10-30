import { it, expect } from 'vitest';
import { chunkTiming } from '../server/adapters/transcript/ingest.js';
import { reducer } from '../server/court/machine.js';
import { defaults } from '../server/config.js';
import type { CourtState, TrialScript } from '../web/src/shared/types.js';
it('validates complete chunk timing and rejects future, reversed and excessive chunks', () => {
  expect(chunkTiming({ started_at_ms: '9000', ended_at_ms: '10000' }, 10000)).toEqual({
    started_at_ms: 9000,
    ended_at_ms: 10000,
  });
  expect(() => chunkTiming({ started_at_ms: 11000, ended_at_ms: 10000 }, 10000)).toThrow();
  expect(() => chunkTiming({ started_at_ms: 100000, ended_at_ms: 101000 }, 10000)).toThrow();
});
it('captures late transcript chunks by their actual defense start window', () => {
  const script: TrialScript = {
    has_case: true,
    exhibits: [],
    cited_precedent_id: null,
    opening_line: 'Open',
    exhibit_lines: [],
    defense_prompt: 'Defend',
  };
  let s: CourtState = { trial: null, now: 0, cooldownUntil: 0 };
  s = reducer(
    s,
    { type: 'START', caseId: 1, name: 'case', formalCharge: 'claim', script, exhibits: [], now: 0 },
    defaults,
  ).state;
  s = reducer(s, { type: 'SKIP', now: 1000 }, defaults).state;
  s = reducer(s, { type: 'SKIP', now: 2000 }, defaults).state;
  expect(s.trial?.phase).toBe('DEFENSE');
  s = reducer(s, { type: 'SKIP', now: 5000 }, defaults).state;
  s = reducer(
    s,
    { type: 'DEFENSE', text: 'A late chunk.', startedAt: 3000, now: 6000 },
    defaults,
  ).state;
  expect(s.trial?.defense_text).toBe('A late chunk.');
  s = reducer(
    s,
    { type: 'DEFENSE', text: 'Not defense.', startedAt: 5000, now: 7000 },
    defaults,
  ).state;
  expect(s.trial?.defense_text).toBe('A late chunk.');
});
