import {
  phases,
  type CourtState,
  type Trial,
  type Settings,
  type TrialScript,
  type Exhibit,
  type Vote,
  type VerdictScript,
  type Rebuttal,
} from '../../web/src/shared/types.js';
import { tally } from './jury.js';
export const defenseAnnouncement = (ms: number) =>
  `Defendant, you have ${Math.ceil(ms / 1000)} seconds. State your defense.`;
export const announcements = {
  jury: 'Members of the jury: vote guilty or not guilty. The decision is yours.',
  guilty: 'The jury finds the defendant guilty.',
  not_guilty: 'Not guilty. The benefit of doubt prevails.',
  mistrial: 'Mistrial. No jury votes were recorded.',
  adjourn: 'Court adjourned. Keep your receipts.',
  order: 'Order in the court!',
  contempt: 'The plaintiff is held in contempt for a frivolous filing.',
};
export type Event =
  | {
      type: 'START';
      caseId: number;
      name: string;
      formalCharge: string;
      script: TrialScript;
      exhibits: Exhibit[];
      now: number;
    }
  | { type: 'TICK' | 'SKIP' | 'MISTRIAL'; now: number }
  | { type: 'VOTE'; userId: string; vote: Vote; now: number }
  | { type: 'STRIKE'; index: number; now: number }
  | { type: 'OBJECTION'; userId: string; now: number }
  | { type: 'DEFENSE'; text: string; startedAt?: number; now: number }
  | { type: 'REBUTTAL_READY'; result: Rebuttal; exhibit?: Exhibit; now: number }
  | { type: 'VERDICT_READY'; result: VerdictScript; now: number }
  | { type: 'SERVED'; now: number };
export type Effect =
  | { type: 'speak'; speaker: 'Judge Docket' | 'D.A. Receipts'; text: string }
  | {
      type:
        | 'switchScene'
        | 'restoreScene'
        | 'callRebuttal'
        | 'callVerdict'
        | 'executeSentence'
        | 'savePrecedent'
        | 'showExhibit'
        | 'juryOpened'
        | 'end';
    }
  | { type: 'sfx'; name: string };
export function reducer(
  previous: CourtState,
  event: Event,
  s: Settings,
): { state: CourtState; effects: Effect[] } {
  if (event.type === 'TICK' && previous.trial && event.now - previous.trial.startedAt >= 180000)
    return reducer(previous, { type: 'MISTRIAL', now: event.now }, s);
  const state = structuredClone(previous);
  const effects: Effect[] = [];
  state.now = event.now;
  const speak = (text: string, speaker: 'Judge Docket' | 'D.A. Receipts' = 'Judge Docket') =>
    effects.push({ type: 'speak', text, speaker });
  const enter = (t: Trial) => {
    t.phaseStartedAt = event.now;
    t.deadline = event.now + s.phaseMs[t.phase];
    switch (t.phase) {
      case 'CALL_TO_ORDER':
        effects.push({ type: 'switchScene' }, { type: 'sfx', name: 'gavel' });
        speak(t.script.opening_line);
        break;
      case 'EXHIBITS':
        effects.push(
          { type: 'showExhibit' },
          { type: 'sfx', name: t.exhibitIndex === 0 ? 'sting' : 'gasp' },
        );
        speak(
          t.script.exhibit_lines[t.exhibitIndex] ?? 'A receipt has been entered into evidence.',
          'D.A. Receipts',
        );
        break;
      case 'DEFENSE':
        t.defenseStartedAt = event.now;
        speak(defenseAnnouncement(s.phaseMs.DEFENSE));
        break;
      case 'REBUTTAL':
        t.defenseEndedAt = event.now;
        effects.push({ type: 'callRebuttal' });
        break;
      case 'JURY':
        effects.push({ type: 'juryOpened' });
        speak(announcements.jury);
        break;
      case 'VERDICT':
        t.verdict = tally(t.votes).verdict;
        effects.push({ type: 'callVerdict' }, { type: 'sfx', name: 'stamp' });
        speak(announcements[t.verdict]);
        break;
      case 'SENTENCING':
        if (t.verdict === 'not_guilty' && s.contempt) speak(announcements.contempt);
        if (t.verdict === 'guilty' && t.verdictScript?.sentence_flavor)
          speak(t.verdictScript.sentence_flavor);
        effects.push({ type: 'executeSentence' });
        break;
      case 'ADJOURN':
        effects.push({ type: 'savePrecedent' }, { type: 'restoreScene' });
        speak(announcements.adjourn);
        break;
    }
  };
  const advance = () => {
    const t = state.trial!;
    if (
      t.phase === 'EXHIBITS' &&
      t.exhibitIndex + 1 < t.exhibits.filter((e) => e.added_in === 'opening').length
    ) {
      t.exhibitIndex++;
      enter(t);
      return;
    }
    const next = phases[phases.indexOf(t.phase) + 1];
    if (!next) {
      state.trial = null;
      state.cooldownUntil = event.now + s.betweenTrialsMs;
      effects.push({ type: 'end' });
      return;
    }
    t.phase = next;
    enter(t);
  };
  if (event.type === 'START') {
    if (state.trial || event.now < state.cooldownUntil) return { state, effects };
    state.trial = {
      caseId: event.caseId,
      caseName: event.name,
      formalCharge: event.formalCharge,
      phase: 'CALL_TO_ORDER',
      startedAt: event.now,
      phaseStartedAt: event.now,
      deadline: 0,
      exhibitIndex: 0,
      exhibits: event.exhibits,
      script: event.script,
      defense_text: '',
      defenseStartedAt: null,
      defenseEndedAt: null,
      votes: {},
      verdict: null,
      verdictScript: null,
      strikeUsed: false,
      objections: [],
      objectionLastAt: -Infinity,
      sentenceServed: false,
    };
    enter(state.trial);
    return { state, effects };
  }
  const t = state.trial;
  if (!t) return { state, effects };
  switch (event.type) {
    case 'MISTRIAL':
      t.verdict = 'mistrial';
      effects.push({ type: 'restoreScene' }, { type: 'end' });
      speak('Mistrial. The court will reconvene.');
      state.trial = null;
      state.cooldownUntil = event.now + s.betweenTrialsMs;
      break;
    case 'SKIP':
      advance();
      break;
    case 'TICK':
      if (event.now >= t.deadline) advance();
      break;
    case 'VOTE':
      if (t.phase === 'JURY' && event.now < t.deadline) t.votes[event.userId] = event.vote;
      break;
    case 'STRIKE':
      if (!t.strikeUsed && t.exhibits[event.index]) {
        t.exhibits[event.index].struck = true;
        t.strikeUsed = true;
        effects.push({ type: 'sfx', name: 'stamp' });
      }
      break;
    case 'DEFENSE':
      if (
        t.defenseStartedAt !== null &&
        (event.startedAt ?? event.now) >= t.defenseStartedAt &&
        (event.startedAt ?? event.now) < (t.defenseEndedAt ?? t.deadline)
      )
        t.defense_text = [t.defense_text, event.text].filter(Boolean).join(' ');
      break;
    case 'OBJECTION':
      if (t.phase !== 'DEFENSE') break;
      if (!t.objections.includes(event.userId)) t.objections.push(event.userId);
      if (t.objections.length >= s.objectionThreshold && event.now - t.objectionLastAt >= 20000) {
        t.objectionLastAt = event.now;
        t.objections = [];
        speak(announcements.order);
        effects.push({ type: 'sfx', name: 'gavel' });
      }
      break;
    case 'REBUTTAL_READY':
      if (t.phase === 'REBUTTAL' && event.now < t.deadline) {
        speak(event.result.rebuttal_line, 'D.A. Receipts');
        if (event.exhibit && !t.exhibits.some((e) => e.segment_id === event.exhibit!.segment_id))
          t.exhibits.push(event.exhibit);
      }
      break;
    case 'VERDICT_READY':
      if (t.phase === 'VERDICT' && event.now < t.deadline) {
        t.verdictScript = event.result;
        // The jury announcement is immediate and fixed; AI flavor belongs to sentencing.
      }
      break;
    case 'SERVED':
      t.sentenceServed = true;
      break;
  }
  return { state, effects };
}
