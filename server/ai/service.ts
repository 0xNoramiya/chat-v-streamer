import type {
  Case,
  ClerkResult,
  TrialScript,
  Rebuttal,
  VerdictScript,
  Exhibit,
  Segment,
  PenalEntry,
  Verdict,
} from '../../web/src/shared/types.js';
import fallback from './prompts/fallbacks.json';
import { localSafe } from './moderation.js';
export interface AIService {
  status: string;
  transcriptionConfigured?: boolean;
  moderate?(text: string): Promise<boolean>;
  clerk(charge: string, open: string[]): Promise<ClerkResult>;
  trial(c: Case, candidates: Segment[]): Promise<TrialScript>;
  rebuttal(c: Case, exhibits: Exhibit[], defense: string, candidates: Segment[]): Promise<Rebuttal>;
  verdict(
    c: Case,
    verdict: Verdict,
    votes: { guilty: number; notGuilty: number },
    exhibits: Exhibit[],
    defense: string,
    allowed: PenalEntry[],
  ): Promise<VerdictScript>;
  speak?(text: string, speaker: string): Promise<string | undefined>;
}
export function fallbackVerdict(verdict: Verdict, allowed: PenalEntry[]): VerdictScript {
  const sentence = verdict === 'guilty' ? allowed[0] : undefined;
  return {
    verdict_line: fallback[verdict][0],
    sentence_id: sentence?.id ?? null,
    sentence_flavor: verdict === 'guilty' ? fallback.sentence[0] : '',
    title_text: sentence?.type === 'title' ? '[CONVICTED] The receipts were conclusive' : null,
    precedent_summary: `Established: ${verdict === 'guilty' ? 'On-stream guarantees are subject to the receipt.' : verdict === 'mistrial' ? 'A silent jury cannot establish guilt.' : 'Doubt belongs to the defendant.'}`,
  };
}
const excluded =
  /\b(family|mother|father|parents|sister|brother|money|dollars|debt|health|ugly|sex|sexual|slur|crime|criminal|off.stream|other streamer|kill|hate|identity|wife|husband|girlfriend|boyfriend|disease|cancer|religion|race|racist|gender|gay|transgender|fat|skinny|appearance|chatters?|mods?|moderator|steal|fraud|abuse|address|dox|looks|face|body|disability|autism|mental|suicide)\b|@[a-z0-9_]+/i;
export class CannedAI implements AIService {
  status = 'canned lines';
  async clerk(raw: string, open: string[]): Promise<ClerkResult> {
    const allowedWords = new Set(
      'he she they his her their it the a an is was said says claimed claims promised promises d ll i never easy parry parrying specialty watch trust me that then guarantee guarantees guaranteed victory first try boss game gameplay beat win won die died times six 6 failed and but like on stream this of to attempt attempts defeat defeated kept losing lost skill could can actually supposed been would had has repeatedly for at in said'.split(
        ' ',
      ),
    );
    const safe =
      localSafe(raw) &&
      !excluded.test(raw) &&
      (raw.toLowerCase().match(/[a-z0-9]+/g) ?? []).every((word) => allowedWords.has(word));
    const firstTry = /first.try|guarantee|boss.*(easy|attempt|six)|never die|died.*times/i.test(
      raw,
    );
    const parry = /parry|parrying/i.test(raw);
    const acceptable = safe && (firstTry || parry);
    const title = firstTry ? 'The First Try Affair' : 'The Parrying Claim Affair';
    const duplicate = acceptable && open.includes(title);
    return {
      admissible: acceptable && !duplicate,
      reason_code: duplicate ? 'duplicate' : acceptable ? 'ok' : 'outside_jurisdiction',
      category: 'gameplay_claim',
      formal_charge: acceptable
        ? firstTry
          ? 'The plaintiff alleges the defendant guaranteed a first-try victory and failed to deliver.'
          : 'The plaintiff alleges the defendant overstated their parrying ability on this stream.'
        : '',
      short_title: acceptable ? title : '',
      search_hints: firstTry
        ? ['boss', 'first', 'try', 'guaranteed']
        : ['parry', 'parrying', 'specialty'],
    };
  }
  async trial(c: Case, candidates: Segment[]): Promise<TrialScript> {
    const firstTry = c.short_title === 'The First Try Affair';
    const picked = candidates
      .filter(
        (s) =>
          localSafe(s.text) &&
          (firstTry ? /boss|first try|never die|sixth attempt/i : /parry|parrying/i).test(s.text),
      )
      .slice(0, 3);
    const opening = `${c.name}. Your claim is under oath.`;
    return {
      has_case: !!picked.length,
      exhibits: picked.map((s) => ({
        segment_id: s.id,
        framing: 'The defendant entered this claim into the live record.',
      })),
      cited_precedent_id: null,
      opening_line: opening.length > 220 ? opening.slice(0, 220).replace(/\s+\S*$/, '') : opening,
      exhibit_lines: picked.map(
        (_, i) => `Exhibit ${String.fromCharCode(65 + i)}. ${fallback.exhibit[(i + 1) % 3]}`,
      ),
      defense_prompt: fallback.defense[c.id % 3],
    };
  }
  async rebuttal(): Promise<Rebuttal> {
    return { rebuttal_line: fallback.rebuttal[0], new_exhibit: null };
  }
  async verdict(
    _c: Case,
    v: Verdict,
    _votes: unknown,
    _e: Exhibit[],
    _d: string,
    allowed: PenalEntry[],
  ) {
    return fallbackVerdict(v, allowed);
  }
}
