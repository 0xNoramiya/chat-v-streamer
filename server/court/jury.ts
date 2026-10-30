import type { Verdict, Vote } from '../../web/src/shared/types.js';
export function tally(votes: Record<string, Vote>): {
  guilty: number;
  notGuilty: number;
  share: number;
  verdict: Verdict;
} {
  const v = Object.values(votes),
    guilty = v.filter((x) => x === 'guilty').length,
    notGuilty = v.length - guilty;
  return {
    guilty,
    notGuilty,
    share: v.length ? guilty / v.length : 0,
    verdict: !v.length ? 'mistrial' : guilty > notGuilty ? 'guilty' : 'not_guilty',
  };
}
export function severityCap(share: number) {
  return share >= 0.8 ? 3 : share >= 0.6 ? 2 : 1;
}
