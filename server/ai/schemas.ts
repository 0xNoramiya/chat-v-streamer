import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import type { TrialScript, Segment, Rebuttal } from '../../web/src/shared/types.js';
const line = (n: number) => z.string().max(n);
const pick = z.object({ segment_id: line(40), framing: line(120) }).strict();
export const clerkSchema = z
  .object({
    admissible: z.boolean(),
    reason_code: z.enum([
      'ok',
      'outside_jurisdiction',
      'harassment',
      'identity',
      'real_world',
      'third_party',
      'duplicate',
      'nonsense',
    ]),
    category: z.enum([
      'broken_promise',
      'contradiction',
      'bad_prediction',
      'hypocrisy',
      'crime_against_taste',
      'gameplay_claim',
      'other',
    ]),
    formal_charge: line(200),
    short_title: line(60),
    search_hints: z.array(line(40)).max(8),
  })
  .strict();
export const trialSchema = z
  .object({
    has_case: z.boolean(),
    exhibits: z.array(pick).max(3),
    cited_precedent_id: line(40).nullable(),
    opening_line: line(220),
    exhibit_lines: z.array(line(160)).max(3),
    defense_prompt: line(120),
  })
  .strict();
export const rebuttalSchema = z
  .object({ rebuttal_line: line(200), new_exhibit: pick.nullable() })
  .strict();
export const verdictSchema = z
  .object({
    verdict_line: line(200),
    sentence_id: line(60).nullable(),
    sentence_flavor: line(140),
    title_text: line(100).nullable(),
    precedent_summary: line(160),
  })
  .strict();
export const jsonSchemas = {
  clerk: zodTextFormat(clerkSchema, 'clerk'),
  trialScript: zodTextFormat(trialSchema, 'trial_script'),
  rebuttal: zodTextFormat(rebuttalSchema, 'rebuttal'),
  verdict: zodTextFormat(verdictSchema, 'verdict'),
};
const limits: Record<string, number> = {
  formal_charge: 200,
  short_title: 60,
  framing: 120,
  opening_line: 220,
  exhibit_lines: 160,
  defense_prompt: 120,
  rebuttal_line: 200,
  verdict_line: 200,
  sentence_flavor: 140,
  title_text: 100,
  precedent_summary: 160,
};
export function normalizeLengths(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && limits[key] && value.length > limits[key]) {
    const max = limits[key];
    if (value.length > max + Math.max(12, max * 0.15)) throw Error(`Overlong ${key}`);
    const cropped = value.slice(0, max);
    const boundary = cropped.lastIndexOf(' ');
    return boundary > max * 0.7 ? cropped.slice(0, boundary) : cropped;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeLengths(v, key));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeLengths(v, k)]));
  return value;
}
export function validateExhibits(
  script: TrialScript,
  candidates: Segment[],
  precedentIds: string[] = [],
): TrialScript {
  const ids = new Set(candidates.map((s) => s.id));
  const seen = new Set<string>();
  const valid = script.exhibits
    .map((e, i) => ({ e, line: script.exhibit_lines[i] }))
    .filter(({ e, line }) => {
      if (!ids.has(e.segment_id) || seen.has(e.segment_id) || !line) return false;
      seen.add(e.segment_id);
      return true;
    })
    .slice(0, 3);
  return {
    ...script,
    has_case: script.has_case && valid.length > 0,
    exhibits: valid.map((v) => v.e),
    exhibit_lines: valid.map((v) => v.line),
    cited_precedent_id:
      script.cited_precedent_id && precedentIds.includes(script.cited_precedent_id)
        ? script.cited_precedent_id
        : null,
  };
}
export function validateRebuttal(
  result: Rebuttal,
  candidates: Segment[],
  excluded: string[],
): Rebuttal {
  return {
    ...result,
    new_exhibit:
      result.new_exhibit &&
      candidates.some((s) => s.id === result.new_exhibit!.segment_id) &&
      !excluded.includes(result.new_exhibit.segment_id)
        ? result.new_exhibit
        : null,
  };
}
