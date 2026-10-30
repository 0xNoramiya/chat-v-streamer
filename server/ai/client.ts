import OpenAI from 'openai';
import type {ZodType} from 'zod';
import {readFileSync} from 'node:fs';
import {config} from '../config.js';
import {jsonSchemas,normalizeLengths} from './schemas.js';
export type Role=keyof typeof jsonSchemas;
const style=readFileSync(new URL('./prompts/style.md',import.meta.url),'utf8');
export class AIClient {
 readonly sdk:OpenAI;
 constructor(private log:(kind:string,message:string)=>void){this.sdk=new OpenAI({apiKey:config.OPENAI_API_KEY||'not-configured',maxRetries:0})}
 async checkModels(){try{const list=await this.sdk.models.list({timeout:5000});const ids=new Set(list.data.map(m=>m.id));for(const [env,id]of Object.entries({OPENAI_MODEL_FAST:config.OPENAI_MODEL_FAST,OPENAI_MODEL_SMART:config.OPENAI_MODEL_SMART}))if(!ids.has(id))this.log('ai',`Model ${id} unavailable. Change ${env} in .env; canned fallback stays active.`)}catch{this.log('ai','Unable to list OpenAI models. Check OPENAI_API_KEY; bounded fallbacks remain available.')}}
 async call<T>(role:Role,input:unknown,schema:ZodType<T>,fallback:T,budget:number):Promise<T>{const deadline=Date.now()+budget;for(let attempt=0;attempt<2;attempt++){const remaining=deadline-Date.now();if(remaining<200)break;const timeout=attempt===0?Math.floor(remaining*.6):remaining;try{const instructions=style+'\n'+readFileSync(new URL(`./prompts/${role}.md`,import.meta.url),'utf8');const response=await this.sdk.responses.create({model:role==='trialScript'?config.OPENAI_MODEL_SMART:config.OPENAI_MODEL_FAST,instructions,input:JSON.stringify(input),text:{format:jsonSchemas[role]},max_output_tokens:2400},{timeout,signal:AbortSignal.timeout(timeout)});return schema.parse(normalizeLengths(JSON.parse(response.output_text)))}catch{this.log('ai',`${role} attempt ${attempt+1} failed or timed out; using bounded retry/fallback.`)}}return fallback}
}
