export type ProviderOperation =
  | 'models'
  | 'clerk'
  | 'trialScript'
  | 'rebuttal'
  | 'verdict'
  | 'moderation'
  | 'speech'
  | 'transcription';
export type ProviderFailure =
  'auth' | 'rate_limit' | 'provider' | 'request' | 'timeout' | 'invalid_output' | 'connection';
export function providerFailure(error: unknown): ProviderFailure {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (typeof status === 'number' && status >= 500) return 'provider';
  if (typeof status === 'number' && status >= 400) return 'request';
  if (error instanceof Error && /abort|timeout/i.test(error.name)) return 'timeout';
  if (error instanceof Error && /syntax|zod/i.test(error.name)) return 'invalid_output';
  return 'connection';
}
interface Observation {
  success: number;
  failure: number;
  fallback: number;
  cached: number;
  lastAt: number;
  lastFailure?: ProviderFailure;
}
// Counters deliberately contain no prompts, provider payloads, identifiers or credentials.
export class ProviderEvidence {
  private observations: Partial<Record<ProviderOperation, Observation>> = {};
  record(
    operation: ProviderOperation,
    result: 'success' | 'failure' | 'fallback' | 'cached',
    error?: unknown,
  ) {
    const row = (this.observations[operation] ??= {
      success: 0,
      failure: 0,
      fallback: 0,
      cached: 0,
      lastAt: 0,
    });
    row[result]++;
    row.lastAt = Date.now();
    if (result === 'failure') row.lastFailure = providerFailure(error);
  }
  snapshot() {
    return structuredClone(this.observations);
  }
}
