import { clerkSchema } from './schemas.js';
import type { AIClient } from './client.js';
import type { ClerkResult } from '../../web/src/shared/types.js';
export const clerk = (client: AIClient, input: unknown, fallback: ClerkResult) =>
  client.call('clerk', input, clerkSchema, fallback, 2000);
