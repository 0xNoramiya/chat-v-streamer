import { expect, it } from 'vitest';
import OpenAI from 'openai';
import { ProviderEvidence, providerFailure } from '../server/ai/evidence.js';
import { AIClient } from '../server/ai/client.js';
import { clerkSchema } from '../server/ai/schemas.js';
import { Moderator } from '../server/ai/moderation.js';
it('stores only bounded failure categories, never provider messages or payloads', () => {
  const evidence = new ProviderEvidence();
  const secret = 'sensitive provider body and token';
  evidence.record('clerk', 'failure', Object.assign(new Error(secret), { status: 401 }));
  evidence.record('speech', 'cached');
  evidence.record('clerk', 'fallback');
  expect(evidence.snapshot()).toMatchObject({
    clerk: { failure: 1, fallback: 1, lastFailure: 'auth' },
    speech: { cached: 1, success: 0 },
  });
  expect(JSON.stringify(evidence.snapshot())).not.toContain(secret);
  const snapshot = evidence.snapshot();
  snapshot.clerk!.success = 90;
  expect(evidence.snapshot().clerk!.success).toBe(0);
  expect(providerFailure(Object.assign(new Error(secret), { status: 429 }))).toBe('rate_limit');
  expect(providerFailure(Object.assign(new Error(secret), { status: 503 }))).toBe('provider');
  expect(providerFailure(Object.assign(new Error(secret), { status: 400 }))).toBe('request');
  expect(providerFailure(new DOMException(secret, 'AbortError'))).toBe('timeout');
  expect(providerFailure(new SyntaxError(secret))).toBe('invalid_output');
});
it('marks Responses failure/fallback distinctly from a successful SDK call', async () => {
  const sdk = new OpenAI({
    apiKey: 'fixture-only',
    maxRetries: 0,
    fetch: async () =>
      new Response(
        JSON.stringify({ error: { message: 'secret body', type: 'invalid_request_error' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  });
  const client = new AIClient(() => {}, sdk);
  const fallback = {
    admissible: false,
    reason_code: 'outside_jurisdiction' as const,
    category: 'other' as const,
    formal_charge: '',
    short_title: '',
    search_hints: [],
  };
  expect(await client.call('clerk', {}, clerkSchema, fallback, 1000)).toEqual(fallback);
  expect(client.evidence.snapshot().clerk).toMatchObject({
    success: 0,
    failure: 2,
    fallback: 1,
    lastFailure: 'auth',
  });
  expect(JSON.stringify(client.evidence.snapshot())).not.toContain('secret body');
});
it('moderation evidence fails closed without echoing a provider failure', async () => {
  const sdk = new OpenAI({
    apiKey: 'fixture-only',
    maxRetries: 0,
    fetch: async () => new Response('', { status: 503 }),
  });
  const evidence = new ProviderEvidence();
  expect(await new Moderator(sdk, evidence).safe('A benign first try guarantee.')).toBe(false);
  expect(evidence.snapshot().moderation).toMatchObject({
    success: 0,
    failure: 1,
    lastFailure: 'provider',
  });
});
