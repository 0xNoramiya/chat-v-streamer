import {readFileSync} from 'node:fs';
import type OpenAI from 'openai';
const words=readFileSync(new URL('./blocklist.txt',import.meta.url),'utf8').split(/\r?\n/).filter(s=>s&&!s.startsWith('#'));
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const deny=new RegExp(`\\b(?:${words.map(escape).join('|')})\\b`,'i');
export function localSafe(text:string){return !deny.test(text.normalize('NFKC'))&&!/[\u0000-\u0008]/.test(text)}
export class Moderator {private cache=new Map<string,boolean>();constructor(private sdk?:OpenAI){}
 async safe(text:string):Promise<boolean>{if(!localSafe(text))return false;if(!text.trim())return true;if(!this.sdk)return true;const cached=this.cache.get(text);if(cached!==undefined)return cached;try{const result=await this.sdk.moderations.create({model:'omni-moderation-latest',input:text},{timeout:1800,signal:AbortSignal.timeout(1800)});const ok=result.results.every(r=>!r.flagged);if(this.cache.size>2000)this.cache.clear();this.cache.set(text,ok);return ok}catch{return false}}
 async line(text:string,fallback:string){return await this.safe(text)?text:fallback}
}
