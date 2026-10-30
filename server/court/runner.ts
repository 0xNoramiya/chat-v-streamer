import type {Store} from '../db.js';
import {retrieve} from '../ai/retrieval.js';
import {localSafe} from '../ai/moderation.js';
import {config} from '../config.js';
import type {AIService} from '../ai/service.js';
import {fallbackVerdict} from '../ai/service.js';
import type {TwitchAdapter} from '../adapters/twitch/types.js';
import type {ObsAdapter} from '../adapters/obs/types.js';
import {reducer, type Event, type Effect} from './machine.js';
import {parseCommand} from './commands.js';
import {cosignThreshold, filingError, canCosign, openStatuses} from './docket.js';
import {tally} from './jury.js';
import {Sentencer, allowedSentences} from './sentencing.js';
import type {Case, CourtState, CourtEvent, Exhibit, LogEntry, Segment, Settings, Snapshot, Trial, TrialScript, User} from '../../web/src/shared/types.js';

export interface Clock {
 now():number;
 setInterval(fn:()=>void, ms:number):ReturnType<typeof setInterval>;
 clearInterval(id:ReturnType<typeof setInterval>):void;
}
export const systemClock:Clock={now:Date.now,setInterval,clearInterval};
interface Prepared {script:TrialScript; exhibits:Exhibit[]}
export class CourtRunner {
 state:CourtState;
 settings:Settings;
 logs:LogEntry[]=[];
 onChange=()=>{};
 onEvent=(_event:CourtEvent)=>{};
 readonly sentencer:Sentencer;
 private timer?:ReturnType<typeof setInterval>;
 private prepared=new Map<number,Prepared>();
 private chatters=new Map<string,number>();
 private users=new Map<string,User>();
 private demoCase:number|null=null;
 private demoInjected=new Set<string>();
 private ticking=false;
 private pending=new Set<Promise<unknown>>();
 constructor(readonly store:Store,readonly twitch:TwitchAdapter,readonly obs:ObsAdapter,readonly ai:AIService,readonly clock:Clock=systemClock){
  this.settings=store.settings();this.state={trial:null,now:clock.now(),cooldownUntil:0};
  this.sentencer=new Sentencer(store,twitch,this.log);
  twitch.onMessage=(u,text)=>{this.track(this.chat(u,text))};
  twitch.onRedemption=(u,text)=>{if(this.settings.channelPoints)this.track(this.file(u,text,true))};
 }
 log=(kind:string,message:string)=>{this.logs.unshift({at:this.clock.now(),kind,message});this.logs=this.logs.slice(0,100);this.onChange()};
 track<T>(promise:Promise<T>):Promise<T>{this.pending.add(promise);void promise.catch(()=>this.log('error','An operation failed; the court remains available.')).finally(()=>this.pending.delete(promise));return promise}
 async settle(){while(this.pending.size)await Promise.allSettled([...this.pending])}
 start(){this.timer=this.clock.setInterval(()=>{void this.tick()},250);this.track(this.sentencer.reverts(this.clock.now()))}
 close(){if(this.timer)this.clock.clearInterval(this.timer);this.twitch.close?.();this.obs.close?.()}
 cases(){return this.store.cases(this.settings.streamerName)}
 snapshot(panel=true):Snapshot {const cases=this.cases().map(c=>panel?c:({...c,raw_charge:undefined,plaintiff_id:'',plaintiff_login:'a concerned citizen',defense_text:'',search_hints:[]}));return {court:this.state,cases,settings:this.settings,segments:panel?this.store.segments():[],records:panel?this.store.records():{precedents:[],plaintiffs:[],convictions:[]},logs:panel?this.logs:[],status:{sim:config.SIM_MODE,dryRun:config.DRY_RUN,twitch:this.twitch.status,eventsub:this.twitch.eventsubStatus,obs:this.obs.status,ai:this.ai.status},chunkMs:config.CHUNK_MS}}
 async tick(){if(this.ticking)return;this.ticking=true;try{
  const now=this.clock.now();
  for(const c of this.cases())if(c.status==='filing'&&now>=c.created_at_ms+this.settings.cosignWindowMs){this.store.updateCase(c.id,{status:'expired'});this.track(this.twitch.sendChat(`Case #${c.case_no} could not find co-signers. The plaintiff stands alone.`))}
  this.dispatch({type:'TICK',now});
  const t=this.state.trial;
  if(t?.caseId===this.demoCase){if(t.phase==='DEFENSE'&&!this.demoInjected.has('defense')){this.demoInjected.add('defense');this.addSegment("Okay that was lag, the game lagged, that doesn't count.",now,now+1000,'sim')}
   if(t.phase==='JURY'&&!this.demoInjected.has('jury')){this.demoInjected.add('jury');for(let i=1;i<=7;i++)this.dispatch({type:'VOTE',userId:`viewer${i}`,vote:i<=5?'guilty':'not_guilty',now})}}
  if(!this.state.trial&&now>=this.state.cooldownUntil&&this.settings.courtOn)this.startNext();
  if(Math.floor(now/1000)!==Math.floor((now-250)/1000))this.track(this.sentencer.reverts(now));
 }finally{this.ticking=false}}
 dispatch(event:Event){const previous=this.state.trial;const beforePhase=previous?.phase;const result=reducer(this.state,event,this.settings);this.state=result.state;const t=this.state.trial;
  if(previous&&event.type==='MISTRIAL'){this.store.updateCase(previous.caseId,{status:'mistrial',verdict:'mistrial',defense_text:previous.defense_text});this.log('court',`Case #${previous.caseId}: mistrial`)}
  if(t){this.store.saveExhibits(t.caseId,t.exhibits);if(event.type==='VOTE'&&t.phase==='JURY')this.store.run('INSERT OR REPLACE INTO votes VALUES(?,?,?)',t.caseId,event.userId,event.vote);if(t.phase!==beforePhase)this.log('phase',`Case #${t.caseId}: ${t.phase}`)}
  this.onChange();for(const effect of result.effects)this.track(this.effect(effect,t??previous));
 }
 private async effect(effect:Effect,t:Trial|null){switch(effect.type){
  case 'speak':{const phase=this.state.trial?.phase,caseId=this.state.trial?.caseId;let url:string|undefined;try{if(this.settings.tts)url=await this.ai.speak?.(effect.text,effect.speaker)}catch{/* Captions carry speech when audio is unavailable. */}if(this.state.trial?.caseId!==caseId||this.state.trial?.phase!==phase)return;this.onEvent({type:'caption',speaker:effect.speaker,text:effect.text,url,duration:Math.min(8000,Math.max(2200,effect.text.length*42))});break}
  case 'sfx':this.onEvent({type:'sfx',name:effect.name});break;
  case 'switchScene':await this.obs.enterCourt(this.settings.obsCourtScene);break;
  case 'restoreScene':await this.obs.restore();break;
  case 'callRebuttal':if(t){const result=await this.ai.rebuttal(this.getCase(t.caseId),t.exhibits.filter(e=>!e.struck),this.captureDefense(t),this.candidates().filter(s=>!t.exhibits.some(e=>e.struck&&e.segment_id===s.id)));if(this.state.trial?.caseId===t.caseId)this.dispatch({type:'REBUTTAL_READY',result,exhibit:result.new_exhibit?this.exhibit(result.new_exhibit,'rebuttal'):undefined,now:this.clock.now()})}break;
  case 'callVerdict':if(t){const c=this.getCase(t.caseId),votes=tally(t.votes),allowed=allowedSentences(this.settings,t);const result=await this.ai.verdict(c,votes.verdict,votes,t.exhibits.filter(e=>!e.struck),t.defense_text,allowed);if(this.state.trial?.caseId===t.caseId)this.dispatch({type:'VERDICT_READY',result,now:this.clock.now()})}break;
  case 'executeSentence':if(t){const current=this.state.trial;if(!current||current.caseId!==t.caseId)break;current.verdictScript??=fallbackVerdict(t.verdict!,allowedSentences(this.settings,t));const c=this.getCase(t.caseId);await this.sentencer.execute(current,this.settings,this.users.get(c.plaintiff_id)??{id:c.plaintiff_id,login:c.plaintiff_login},this.clock.now());this.onChange()}break;
  case 'savePrecedent':if(t)this.finish(t);break;
  case 'juryOpened':if(this.settings.polls&&this.twitch.createPoll)await this.twitch.createPoll().catch(()=>this.log('twitch','Poll unavailable; chat voting remains open.'));break;
  case 'end':this.demoCase=null;break;
  case 'showExhibit':break;
 }}
 getCase(id:number){const c=this.cases().find(x=>x.id===id);if(!c)throw Error('Case not found');return c}
 candidates(hints:string[]=[]):Segment[]{return retrieve(this.store,hints,this.clock.now())}
 exhibit(pick:{segment_id:string;framing:string},added_in:Exhibit['added_in']):Exhibit|undefined{const s=this.store.segment(pick.segment_id);if(!s)return undefined;return {...pick,text:s.text,timestamp:s.timestamp,frame_url:null,struck:false,added_in}}
 async file(user:User,charge:string,skipCosign=false){const error=filingError(charge,user.id,this.cases(),this.settings,this.clock.now());if(error){await this.twitch.sendChat(error);return null}
  const now=this.clock.now(),count=this.store.get<{n:number}>('SELECT COUNT(*) n FROM cases')!.n+1;const threshold=cosignThreshold(this.uniqueChatters(),this.settings);
  const id=Number(this.store.run('INSERT INTO cases(case_no,status,plaintiff_id,plaintiff_login,raw_charge,threshold,created_at_ms) VALUES(?,?,?,?,?,?,?)',count,'filing',user.id,user.login,charge,threshold,now).lastInsertRowid);
  this.users.set(user.id,user);this.onChange();if(skipCosign){this.store.updateCase(id,{status:'screening'});await this.screen(id)}else await this.twitch.sendChat(`Case #${count} filed: Chat v. ${this.settings.streamerName}. Needs ${threshold} co-signers in ${Math.round(this.settings.cosignWindowMs/1000)}s. Type !cosign ${count}`);return id;
 }
 private uniqueChatters(){const cutoff=this.clock.now()-600000;for(const [id,at]of this.chatters)if(at<cutoff)this.chatters.delete(id);return this.chatters.size}
 async chat(user:User,text:string){if(user.id===this.twitch.botId)return;this.users.set(user.id,user);this.chatters.set(user.id,this.clock.now());const cmd=parseCommand(text);if(!cmd)return;
  const privileged=user.broadcaster||user.mod;
  switch(cmd.type){case 'sue':await this.file(user,cmd.charge);break;
   case 'cosign':{const filings=this.cases().filter(c=>c.status==='filing'),c=cmd.id?filings.find(c=>c.case_no===cmd.id):filings.length===1?filings[0]:undefined;if(c&&canCosign(c,user.id,this.clock.now(),this.settings)){const cosigners=[...c.cosigners,user.id];this.store.updateCase(c.id,{cosigners_json:JSON.stringify(cosigners)});if(cosigners.length>=c.threshold){this.store.updateCase(c.id,{status:'screening'});await this.screen(c.id)}}break}
   case 'vote':this.dispatch({type:'VOTE',userId:user.id,vote:cmd.vote,now:this.clock.now()});break;
   case 'objection':this.dispatch({type:'OBJECTION',userId:user.id,now:this.clock.now()});break;
   case 'court':if(privileged)this.updateSettings({...this.settings,courtOn:cmd.on});break;
   case 'approve':case 'veto':if(privileged)this.approve(cmd.id,cmd.type==='approve');break;
   case 'mistrial':if(privileged)this.dispatch({type:'MISTRIAL',now:this.clock.now()});break;
   case 'strike':if(user.broadcaster)this.dispatch({type:'STRIKE',index:cmd.index,now:this.clock.now()});break;
   case 'docket':await this.twitch.sendChat(this.cases().filter(c=>['queued','pending_approval'].includes(c.status)).map(c=>`#${c.case_no} ${c.name}`).join(' | ')||'The docket is clear.');break;
   case 'record':{const convictions=this.cases().filter(c=>c.verdict==='guilty');await this.twitch.sendChat(`${convictions.length} convictions. ${convictions.slice(0,3).map(c=>c.name).join(' | ')}`);break}
  }this.onChange();
 }
 async screen(id:number){const c=this.getCase(id);this.store.updateCase(id,{raw_flagged:+!localSafe(c.raw_charge!)});const result=await this.ai.clerk(c.raw_charge!,this.cases().filter(x=>x.id!==id&&openStatuses.includes(x.status)).map(x=>x.short_title));
  this.store.updateCase(id,{formal_charge:result.formal_charge,short_title:result.short_title,category:result.category,search_hints_json:JSON.stringify(result.search_hints),reject_reason:result.admissible?null:result.reason_code,status:result.admissible?(this.settings.autoApprove?'queued':'pending_approval'):'rejected'});
  if(result.admissible)await this.prepare(id);else await this.twitch.sendChat(`Case #${c.case_no} dismissed: outside this court's jurisdiction.`);this.onChange();
 }
 async prepare(id:number){const c=this.getCase(id),candidates=this.candidates(c.search_hints);const script=await this.ai.trial(c,candidates);const ids=new Set(candidates.map(s=>s.id));const exhibits=script.exhibits.filter(e=>ids.has(e.segment_id)).slice(0,3).map(e=>this.exhibit(e,'opening')).filter((e):e is Exhibit=>!!e);
  if(!script.has_case||!exhibits.length){this.store.updateCase(id,{status:'dismissed',reject_reason:'insufficient_evidence'});await this.twitch.sendChat('The prosecution has nothing. Case dismissed.');this.onChange();return}
  script.exhibits=script.exhibits.filter(e=>exhibits.some(x=>x.segment_id===e.segment_id));this.store.saveExhibits(id,exhibits);
  if(this.ai.speak&&this.settings.tts)await Promise.allSettled([this.ai.speak(script.opening_line,'Judge Docket'),this.ai.speak(script.defense_prompt,'Judge Docket'),...script.exhibit_lines.map(line=>this.ai.speak!(line,'D.A. Receipts'))]);
  if(['queued','pending_approval'].includes(this.getCase(id).status))this.prepared.set(id,{script,exhibits});this.onChange();
 }
 approve(id:number,approve:boolean){const c=this.cases().find(c=>c.case_no===id);if(!c||!['pending_approval','queued'].includes(c.status))return;this.store.updateCase(c.id,{status:approve?'queued':'rejected',reject_reason:approve?null:'streamer_veto'});this.onChange()}
 startNext(){if(this.state.trial||!this.settings.courtOn||this.clock.now()<this.state.cooldownUntil)return;const c=this.cases().reverse().find(c=>c.status==='queued'&&this.prepared.has(c.id));if(!c)return;const prepared=this.prepared.get(c.id)!;this.store.updateCase(c.id,{status:'in_trial',trial_started_at_ms:this.clock.now()});this.dispatch({type:'START',caseId:c.id,name:c.name,formalCharge:c.formal_charge,...prepared,now:this.clock.now()})}
 addSegment(text:string,start:number,end:number,source:Segment['source']){const s=this.store.addSegment(text,start,end,source);const t=this.state.trial;if(t&&t.defenseStartedAt!==null&&start>=t.defenseStartedAt&&start<(t.defenseEndedAt??t.deadline))this.dispatch({type:'DEFENSE',text,startedAt:start,now:this.clock.now()});this.onChange();return s}
 captureDefense(t:Trial){const defenseStart=t.defenseStartedAt??0;const segments=this.store.all<{text:string}>('SELECT text FROM segments WHERE session_id=? AND started_at_ms>=? AND started_at_ms<? ORDER BY started_at_ms',this.store.sessionId,defenseStart,t.defenseEndedAt??this.clock.now());const text=segments.map(s=>s.text).join(' ')||t.defense_text;if(this.state.trial)this.state.trial.defense_text=text;this.store.updateCase(t.caseId,{defense_text:text});return text}
 finish(t:Trial){const votes=tally(t.votes);this.store.updateCase(t.caseId,{status:t.verdict,verdict:t.verdict,guilty_votes:votes.guilty,not_guilty_votes:votes.notGuilty,defense_text:t.defense_text});const c=this.getCase(t.caseId);const id=`P-${String(this.store.get<{n:number}>('SELECT COUNT(*) n FROM precedents')!.n+1).padStart(3,'0')}`;this.store.run('INSERT OR IGNORE INTO precedents VALUES(?,?,?,?,?,?)',id,c.id,c.name,t.verdict,t.verdictScript?.precedent_summary??fallbackVerdict(t.verdict!,[]).precedent_summary,this.clock.now());this.store.run('INSERT OR IGNORE INTO plaintiffs(user_id,login) VALUES(?,?)',c.plaintiff_id,c.plaintiff_login);this.store.run('UPDATE plaintiffs SET wins=wins+?,losses=losses+?,contempts=contempts+? WHERE user_id=?',+(t.verdict==='guilty'),+(t.verdict==='not_guilty'),+(t.verdict==='not_guilty'&&this.settings.contempt),c.plaintiff_id);this.onEvent({type:'precedent',text:`New precedent ${id} established`})}
 updateSettings(s:Settings){this.settings=s;this.store.saveSettings(s);this.onChange()}
 async demo(){if(this.state.trial)throw Error('Finish the current trial before starting a demo.');this.demoInjected.clear();this.state.cooldownUntil=0;
  const now=this.clock.now();['This boss is easy, first try guaranteed.','I never die to this guy, trust me.','Parrying is my specialty, watch this.','The gate opens on the left.','That was the sixth attempt.'].forEach((text,i)=>this.addSegment(text,now-(5-i)*6000,now-(5-i)*6000+2000,'sim'));
  const user={id:`viewer1_demo_${now}`,login:'viewer1'};const id=await this.file(user,'he said first try guaranteed and died like six times');if(!id)throw Error('The docket is full or court is closed.');this.demoCase=id;
  for(let i=0;i<this.getCase(id).threshold;i++)await this.chat({id:`viewer${i+2}`,login:`viewer${i+2}`},`!cosign ${this.getCase(id).case_no}`);
  if(this.getCase(id).status==='pending_approval')this.approve(this.getCase(id).case_no,true);this.startNext();return id;
 }
}
