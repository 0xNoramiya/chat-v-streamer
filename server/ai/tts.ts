import {createHash} from 'node:crypto';
import {mkdir,writeFile,access} from 'node:fs/promises';
import type OpenAI from 'openai';
import {config} from '../config.js';
export class TTS {private pending=new Map<string,Promise<string|undefined>>();constructor(private sdk:OpenAI){}
 generate(text:string,speaker:string):Promise<string|undefined>{const voice=speaker==='Judge Docket'?config.TTS_VOICE_JUDGE:config.TTS_VOICE_DA;const hash=createHash('sha256').update([config.OPENAI_TTS_MODEL,voice,text].join('|')).digest('hex');const existing=this.pending.get(hash);if(existing)return existing;const task=this.write(hash,text,speaker,voice).finally(()=>this.pending.delete(hash));this.pending.set(hash,task);return task}
 private async write(hash:string,text:string,speaker:string,voice:string){const path=`data/tts/${hash}.mp3`;try{await access(path);return `/tts/${hash}.mp3`}catch{/* Generate uncached speech. */}try{const response=await this.sdk.audio.speech.create({model:config.OPENAI_TTS_MODEL,voice,input:text,response_format:'mp3',...(!['tts-1','tts-1-hd'].includes(config.OPENAI_TTS_MODEL)?{instructions:speaker==='Judge Docket'?'Deep, deadpan courtroom judge, dramatic pauses.':'Smug, fast, theatrical prosecutor.'}:{})},{timeout:5000,signal:AbortSignal.timeout(5000)});await mkdir('data/tts',{recursive:true});await writeFile(path,Buffer.from(await response.arrayBuffer()));return `/tts/${hash}.mp3`}catch{return undefined}}
}
