import type { Case, Settings } from '../../web/src/shared/types.js';
export const openStatuses = ['filing', 'screening', 'pending_approval', 'queued', 'in_trial'];
export function cosignThreshold(unique: number, s: Settings) {
  return Math.max(s.minCosigners, Math.min(s.maxCosigners, Math.ceil(unique * s.cosignRatio)));
}
export function filingError(
  charge: string,
  userId: string,
  cases: Case[],
  s: Settings,
  now: number,
) {
  if (!s.courtOn) return 'Court is closed.';
  if (charge.length < 5 || charge.length > 300) return 'Charges must contain 5 to 300 characters.';
  if (cases.filter((c) => openStatuses.includes(c.status)).length >= s.maxOpenCases)
    return 'The docket is full.';
  if (cases.some((c) => c.plaintiff_id === userId && now - c.created_at_ms < s.sueCooldownMs))
    return 'The plaintiff must wait before filing again.';
  return null;
}
export function canCosign(c: Case, userId: string, now: number, s: Settings) {
  return (
    c.status === 'filing' &&
    now < c.created_at_ms + s.cosignWindowMs &&
    c.plaintiff_id !== userId &&
    !c.cosigners.includes(userId)
  );
}
