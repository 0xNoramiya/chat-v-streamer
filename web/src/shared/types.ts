export const phases = ['CALL_TO_ORDER','EXHIBITS','DEFENSE','REBUTTAL','JURY','VERDICT','SENTENCING','ADJOURN'] as const;
export type Phase = typeof phases[number];
export type Verdict = 'guilty' | 'not_guilty' | 'mistrial';
export type Vote = 'guilty' | 'not_guilty';
export interface User {id:string; login:string; broadcaster?:boolean; mod?:boolean; vip?:boolean}
export interface Segment {id:string; session_id:number; started_at_ms:number; ended_at_ms:number; text:string; source:'mic'|'manual'|'sim'; timestamp:string}
export interface Case {id:number; case_no:number; status:string; plaintiff_id:string; plaintiff_login:string; raw_charge?:string; raw_flagged?:boolean; formal_charge:string; short_title:string; category:string; reject_reason:string|null; cosigners:string[]; threshold:number; created_at_ms:number; trial_started_at_ms:number|null; verdict:Verdict|null; guilty_votes:number; not_guilty_votes:number; defense_text:string; search_hints:string[]; name:string}
export interface Exhibit {segment_id:string; framing:string; text:string; timestamp:string; frame_url:string|null; struck:boolean; added_in:'opening'|'rebuttal'}
export interface TrialScript {has_case:boolean; exhibits:{segment_id:string; framing:string}[]; cited_precedent_id:string|null; opening_line:string; exhibit_lines:string[]; defense_prompt:string}
export interface VerdictScript {verdict_line:string; sentence_id:string|null; sentence_flavor:string; title_text:string|null; precedent_summary:string}
export interface Rebuttal {rebuttal_line:string; new_exhibit:{segment_id:string; framing:string}|null}
export interface ClerkResult {admissible:boolean; reason_code:string; category:string; formal_charge:string; short_title:string; search_hints:string[]}
export interface PenalEntry {id:string; type:'title'|'manual'; severity:number; text:string; duration_ms:number; approved:boolean}
export interface Settings {courtOn:boolean; autoApprove:boolean; streamerName:string; cosignWindowMs:number; cosignRatio:number; minCosigners:number; maxCosigners:number; sueCooldownMs:number; betweenTrialsMs:number; maxOpenCases:number; objectionThreshold:number; contempt:boolean; polls:boolean; channelPoints:boolean; tts:boolean; clipOnGuilty:boolean; markerOnGuilty:boolean; phaseMs:Record<Phase,number>; penalCode:PenalEntry[]; webcam:{x:number;y:number;w:number;h:number}; obsCourtScene:string; obsScreenshotSource:string}
export interface Trial {caseId:number; caseName:string; formalCharge:string; phase:Phase; startedAt:number; phaseStartedAt:number; deadline:number; exhibitIndex:number; exhibits:Exhibit[]; script:TrialScript; defense_text:string; votes:Record<string,Vote>; verdict:Verdict|null; verdictScript:VerdictScript|null; strikeUsed:boolean; objections:string[]; objectionLastAt:number; sentenceServed:boolean}
export interface CourtState {trial:Trial|null; now:number; cooldownUntil:number}
export interface LogEntry {at:number; kind:string; message:string}
export interface Snapshot {court:CourtState; cases:Case[]; settings:Settings; segments:Segment[]; records:{precedents:Precedent[]; plaintiffs:Plaintiff[]; convictions:Case[]}; logs:LogEntry[]; status:{sim:boolean; dryRun:boolean; twitch:string; obs:string; ai:string; eventsub:string}; chunkMs:number}
export interface Precedent {id:string;case_id:number;case_name:string;verdict:string;summary:string;created_at_ms:number}
export interface Plaintiff {user_id:string;login:string;wins:number;losses:number;contempts:number}
export type CourtEvent = {type:'caption';speaker:string;text:string;url?:string;duration?:number}|{type:'sfx';name:string}|{type:'precedent';text:string};
