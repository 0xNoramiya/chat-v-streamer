import { verdictSchema } from './schemas.js';
import type { AIClient } from './client.js';
import type { VerdictScript } from '../../web/src/shared/types.js';
export const verdict = (client: AIClient, input: unknown, fallback: VerdictScript) =>
  client.call('verdict', input, verdictSchema, fallback, 4000);
