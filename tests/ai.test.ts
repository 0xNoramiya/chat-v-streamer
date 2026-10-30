import { it, expect } from 'vitest';
import {
  validateExhibits,
  validateRebuttal,
  normalizeLengths,
  trialSchema,
} from '../server/ai/schemas.js';
import { Store } from '../server/db.js';
import { retrieve } from '../server/ai/retrieval.js';
import { Moderator, localSafe } from '../server/ai/moderation.js';
import type { TrialScript, Segment } from '../web/src/shared/types.js';
const segment = {
  id: 'seg_000001',
  broadcast_id: 'local:test',
  text: 'first try guaranteed',
  timestamp: '00:00:01',
  session_id: 1,
  started_at_ms: 1000,
  ended_at_ms: 2000,
  source: 'sim',
} satisfies Segment;
const script: TrialScript = {
  has_case: true,
  exhibits: [
    { segment_id: 'invented_id', framing: 'Fake.' },
    { segment_id: segment.id, framing: 'Real.' },
  ],
  exhibit_lines: ['Fake intro', 'Real intro'],
  opening_line: 'Court is open.',
  defense_prompt: 'Defend yourself.',
  cited_precedent_id: 'P-invented',
};
it('drops hallucinated IDs with matching narration and invalid precedent', () => {
  const result = validateExhibits(script, [segment]);
  expect(result.exhibits).toEqual([{ segment_id: segment.id, framing: 'Real.' }]);
  expect(result.exhibit_lines).toEqual(['Real intro']);
  expect(result.cited_precedent_id).toBeNull();
});
it('all-invalid exhibits dismiss instead of inventing a receipt', () => {
  expect(
    validateExhibits({ ...script, exhibits: script.exhibits.slice(0, 1) }, [segment]).has_case,
  ).toBe(false);
});
it('invalid and excluded rebuttal IDs are dropped', () => {
  expect(
    validateRebuttal(
      { rebuttal_line: 'A line', new_exhibit: { segment_id: 'made-up', framing: 'No' } },
      [segment],
      [],
    ).new_exhibit,
  ).toBeNull();
  expect(
    validateRebuttal(
      { rebuttal_line: 'A line', new_exhibit: { segment_id: segment.id, framing: 'No' } },
      [segment],
      [segment.id],
    ).new_exhibit,
  ).toBeNull();
});
it('trims slight overlength at word boundary and rejects excessive length', () => {
  const value = normalizeLengths({ ...script, opening_line: 'word '.repeat(46) });
  expect(trialSchema.parse(value).opening_line.length).toBeLessThanOrEqual(220);
  expect(() => normalizeLengths({ opening_line: 'x'.repeat(300) })).toThrow(/Overlong/);
});
it('FTS retrieval unions older-session matches and current recent window', () => {
  const db = new Store(':memory:', 0);
  db.addSegment('A parrying specialty', 1000, 2000, 'sim');
  const broadcast = db.broadcastId!;
  db.sessionId = Number(
    db.run('INSERT INTO sessions(started_at_ms) VALUES(?)', 3000000).lastInsertRowid,
  );
  db.run('UPDATE sessions SET broadcast_id=? WHERE id=?', broadcast, db.sessionId);
  db.addSegment('A neutral recent line', 3000100, 3000200, 'manual');
  const result = retrieve(db, ['parrying'], 3001000);
  expect(result.map((s) => s.text)).toEqual(['A parrying specialty', 'A neutral recent line']);
  db.close();
});
it('blocks unsafe language locally and accepts original canned lines', async () => {
  expect(localSafe('kill yourself')).toBe(false);
  expect(await new Moderator().line('kill yourself', 'Order in the court.')).toBe(
    'Order in the court.',
  );
  expect(localSafe('The record speaks for itself.')).toBe(true);
});
