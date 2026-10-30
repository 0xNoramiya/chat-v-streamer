import {config} from '../config.js';
import type {Settings,Trial,User} from '../../web/src/shared/types.js';
import type {TwitchAdapter} from '../adapters/twitch/types.js';
import type {Store} from '../db.js';
import {severityCap,tally} from './jury.js';
export const allowedSentences=(s:Settings,t:Trial)=>s.penalCode.filter(p=>p.approved&&p.severity<=severityCap(tally(t.votes).share));
interface RevertRow {case_id:number;sentence_id:string;payload_json:string}
export class Sentencer {
 private reverting=false;
 constructor(private store:Store,private twitch:TwitchAdapter,private log:(kind:string,message:string)=>void){}
 async execute(t:Trial,s:Settings,plaintiff:User,now:number,active=()=>true){
  if(t.verdict==='guilty'){
   const chosen=allowedSentences(s,t).find(p=>p.id===t.verdictScript?.sentence_id);
   if(chosen&&!this.store.get('SELECT 1 FROM sentences_applied WHERE case_id=? AND sentence_id=?',t.caseId,chosen.id)&&active()){
    if(chosen.type==='title'){
     const stream=await this.twitch.getStream();if(!active())return;
     const earlier=this.store.get<{payload_json:string}>('SELECT payload_json FROM sentences_applied WHERE reverted=0 AND revert_at_ms IS NOT NULL ORDER BY revert_at_ms LIMIT 1');
     const originalTitle=earlier?(JSON.parse(earlier.payload_json) as {originalTitle:string}).originalTitle:stream.title;
     const title=t.verdictScript?.title_text?.startsWith('[CONVICTED]')?t.verdictScript.title_text.slice(0,140):'[CONVICTED] The First Try Affair';
     this.store.run('INSERT INTO sentences_applied VALUES(?,?,?,?,0)',t.caseId,chosen.id,JSON.stringify({originalTitle,title,dryRun:config.DRY_RUN}),now+chosen.duration_ms);
     await this.twitch.setTitle(title);
     this.store.run('UPDATE sentences_applied SET reverted=1 WHERE case_id<>? AND revert_at_ms IS NOT NULL AND reverted=0',t.caseId);
     if(!active()){await this.cancel(t.caseId);return}
    }else{
     this.store.run('INSERT INTO sentences_applied VALUES(?,?,?,?,0)',t.caseId,chosen.id,JSON.stringify({text:chosen.text,endsAt:now+chosen.duration_ms,dryRun:config.DRY_RUN}),null);
     this.log('sentence',chosen.text);
    }
   }
   if(s.clipOnGuilty&&active())await this.twitch.createClip();
   if(s.markerOnGuilty&&active())await this.twitch.createMarker(t.caseName);
  }else if(t.verdict==='not_guilty'&&s.contempt&&active())await this.twitch.timeout(plaintiff,60,'Contempt of court: frivolous lawsuit');
 }
 async cancel(caseId:number){for(const row of this.store.all<RevertRow>('SELECT * FROM sentences_applied WHERE case_id=? AND reverted=0',caseId)){if(this.store.get<{revert_at_ms:number|null}>('SELECT revert_at_ms FROM sentences_applied WHERE case_id=? AND sentence_id=?',row.case_id,row.sentence_id)?.revert_at_ms!==null)await this.restore(row);else this.store.run('UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND sentence_id=?',row.case_id,row.sentence_id)}}
 private async restore(row:RevertRow){const payload=JSON.parse(row.payload_json) as {originalTitle:string;dryRun?:boolean};
  if(payload.dryRun===false&&config.DRY_RUN)return;
  if(payload.dryRun!==true||config.DRY_RUN)await this.twitch.setTitle(payload.originalTitle);
  this.store.run('UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND sentence_id=?',row.case_id,row.sentence_id);
  this.log('sentence',`Title restored for case #${row.case_id}`);
 }
 async reverts(now:number){if(this.reverting)return;this.reverting=true;try{for(const row of this.store.all<RevertRow>('SELECT * FROM sentences_applied WHERE revert_at_ms<=? AND reverted=0 ORDER BY revert_at_ms',now)){try{await this.restore(row)}catch{this.log('error',`Title restore failed for case #${row.case_id}; retrying`)}}}finally{this.reverting=false}}
}
