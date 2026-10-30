import type { Trial } from './types';
export function speechScope(trial: Trial | null) {
  return trial
    ? `${trial.caseId}:${trial.phase}:${trial.phaseStartedAt}:${trial.exhibitIndex}`
    : 'idle';
}
export function speechDurationMs(text: string) {
  return Math.ceil((text.trim().split(/\s+/).filter(Boolean).length / 2.7) * 1000 + 400);
}
