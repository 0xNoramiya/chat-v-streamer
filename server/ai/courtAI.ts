import type {Store} from '../db.js';
import {config} from '../config.js';
import {CannedAI,type AIService,fallbackVerdict} from './service.js';
import {AIClient} from './client.js';
import {Moderator} from './moderation.js';
import {TTS} from './tts.js';
import {clerk} from './clerk.js';
import {trialScript} from './trialScript.js';
import {rebuttal} from './rebuttal.js';
import {verdict} from './verdict.js';
import {precedents,formatCandidates} from './retrieval.js';
import {validateExhibits,validateRebuttal} from './schemas.js';
import type {Case,Exhibit,PenalEntry,Segment,Verdict} from '../../web/src/shared/types.js';
export class CourtAI implements AIService {
 status:string;
 readonly client?:AIClient;
 readonly moderator:Moderator;
 private tts?:TTS;
 private canned=new CannedAI();
 constructor(private store:Store,log:(kind:string,message:string)=>void){if(config.OPENAI_API_KEY){this.client=new AIClient(log);this.tts=new TTS(this.client.sdk);this.status='OpenAI configured';void this.client.checkModels()}else this.status='canned lines';this.moderator=new Moderator(this.client?.sdk)}
 async clerk(charge:string,open:string[]){const safe=await this.moderator.safe(charge);const fallback=await this.canned.clerk(charge,open);if(!safe)return {...fallback,admissible:false,reason_code:'harassment',formal_charge:'',short_title:''};const result=this.client?await clerk(this.client,{raw_charge:charge,streamer:this.store.settings().streamerName,open_case_titles:open},fallback):fallback;
  if(!result.admissible)return {...result,formal_charge:'',short_title:''};const moderated=await this.moderator.safe(result.formal_charge+' '+result.short_title);if(!moderated||result.short_title.trim().split(/\s+/).length<2||result.short_title.trim().split(/\s+/).length>5||result.search_hints.length<3)return {...fallback,admissible:false,reason_code:'outside_jurisdiction',formal_charge:'',short_title:''};return result}
 async trial(c:Case,candidates:Segment[]){const safeCandidates=await this.safeCandidates(candidates);const p=precedents(this.store,c.formal_charge);const fallback=await this.canned.trial(c,safeCandidates);const result=this.client?await trialScript(this.client,{case_name:c.name,formal_charge:c.formal_charge,category:c.category,candidates:formatCandidates(safeCandidates),precedents:p.map(x=>`[${x.id}] ${x.summary}`)},fallback):fallback;
  const validated=validateExhibits(result,safeCandidates,p.map(x=>x.id));const [opening_line,defense_prompt,exhibit_lines,exhibits]=await Promise.all([this.moderator.line(validated.opening_line,fallback.opening_line),this.moderator.line(validated.defense_prompt,fallback.defense_prompt),Promise.all(validated.exhibit_lines.map((l,i)=>this.moderator.line(l,`Exhibit ${String.fromCharCode(65+i)}. The record speaks for itself.`))),Promise.all(validated.exhibits.map(async e=>({...e,framing:await this.moderator.line(e.framing,'Entered into the on-stream record.')})))]);return {...validated,opening_line,defense_prompt,exhibit_lines,exhibits}}
 async rebuttal(c:Case,exhibits:Exhibit[],defense:string,candidates:Segment[]){const safeCandidates=await this.safeCandidates(candidates);const fallback=await this.canned.rebuttal();const result=this.client?await rebuttal(this.client,{formal_charge:c.formal_charge,exhibits,defense_text:defense,candidates:formatCandidates(safeCandidates)},fallback):fallback;const validated=validateRebuttal(result,safeCandidates,exhibits.map(e=>e.segment_id));const [line,framing]=await Promise.all([this.moderator.line(validated.rebuttal_line,fallback.rebuttal_line),validated.new_exhibit?this.moderator.line(validated.new_exhibit.framing,'The record offers a final receipt.'):Promise.resolve('')]);return {...validated,rebuttal_line:line,new_exhibit:validated.new_exhibit?{...validated.new_exhibit,framing}:null}}
 async verdict(c:Case,v:Verdict,votes:{guilty:number;notGuilty:number},exhibits:Exhibit[],defense:string,allowed:PenalEntry[]){const fallback=fallbackVerdict(v,allowed);const result=this.client?await verdict(this.client,{verdict:v,votes,margin:votes.guilty-votes.notGuilty,formal_charge:c.formal_charge,exhibits,defense_text:defense,allowed_penal_code:allowed,contempt_enabled:this.store.settings().contempt},fallback):fallback;const sentence=v==='guilty'?allowed.find(s=>s.id===result.sentence_id):undefined;const [verdict_line,sentence_flavor,precedent_summary,title_text]=await Promise.all([this.moderator.line(result.verdict_line,fallback.verdict_line),this.moderator.line(result.sentence_flavor,fallback.sentence_flavor),this.moderator.line(result.precedent_summary,fallback.precedent_summary),result.title_text?this.moderator.line(result.title_text,'[CONVICTED] The receipts were conclusive'):Promise.resolve(null)]);return {...result,verdict_line,sentence_flavor,precedent_summary:precedent_summary.startsWith('Established:')?precedent_summary:fallback.precedent_summary,sentence_id:sentence?.id??fallback.sentence_id,title_text:sentence?.type==='title'&&title_text?.startsWith('[CONVICTED]')?title_text:sentence?.type==='title'?fallback.title_text:null}}
 async speak(text:string,speaker:string){if(!this.tts||!await this.moderator.safe(text))return undefined;return this.tts.generate(text,speaker)}
 private async safeCandidates(candidates:Segment[]){const safety=await Promise.all(candidates.map(c=>this.moderator.safe(c.text)));return candidates.filter((_,i)=>safety[i])}
}
