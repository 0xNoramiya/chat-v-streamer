import {z} from 'zod';
import {toFile} from 'openai';
import type OpenAI from 'openai';
import {config} from '../../config.js';
export function chunkTiming(input:unknown,now:number){return z.object({started_at_ms:z.coerce.number().int().min(now-300000).max(now+2000),ended_at_ms:z.coerce.number().int().max(now+2000)}).refine(t=>t.ended_at_ms>=t.started_at_ms&&t.ended_at_ms-t.started_at_ms<=35000,'Invalid chunk duration').parse(input)}
export async function transcribe(sdk:OpenAI,audio:Buffer,mimetype:string){const extension=mimetype.includes('mp4')?'mp4':mimetype.includes('ogg')?'ogg':mimetype.includes('wav')?'wav':'webm';const response=await sdk.audio.transcriptions.create({model:config.OPENAI_TRANSCRIBE_MODEL,file:await toFile(audio,`chunk.${extension}`,{type:mimetype}),language:config.TRANSCRIBE_LANGUAGE,response_format:'json'},{timeout:12000,signal:AbortSignal.timeout(12000)});return response.text.trim()}
