import { rebuttalSchema } from './schemas.js';
import type { AIClient } from './client.js';
import type { Rebuttal } from '../../web/src/shared/types.js';
export const rebuttal = (client: AIClient, input: unknown, fallback: Rebuttal) =>
  client.call('rebuttal', input, rebuttalSchema, fallback, 4000);
