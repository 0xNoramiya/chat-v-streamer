import {trialSchema} from './schemas.js';
import type {AIClient} from './client.js';
import type {TrialScript} from '../../web/src/shared/types.js';
export const trialScript=(client:AIClient,input:unknown,fallback:TrialScript)=>client.call('trialScript',input,trialSchema,fallback,11000);
