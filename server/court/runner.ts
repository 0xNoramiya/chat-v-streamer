import { CaptureReadiness } from '../adapters/transcript/readiness.js';
import { ComedyDesk } from '../comedy/desk.js';
import { deadline } from '../ai/deadline.js';
import fallback from '../ai/prompts/fallbacks.json';
import type { Store } from '../db.js';
import { nearestFrame } from '../adapters/obs/frames.js';
import { retrieve } from '../ai/retrieval.js';
import { validateExhibits } from '../ai/schemas.js';
import { localSafe } from '../ai/moderation.js';
import { config } from '../config.js';
import type { AIService } from '../ai/service.js';
import { SpeechCache } from '../ai/speech.js';
import { speechScope, speechDurationMs } from '../../web/src/shared/speech.js';
import { fallbackVerdict } from '../ai/service.js';
import type { TwitchAdapter, StreamInfo } from '../adapters/twitch/types.js';
import type { ObsAdapter } from '../adapters/obs/types.js';
import { reducer, announcements, defenseAnnouncement, type Event, type Effect } from './machine.js';
import { parseCommand } from './commands.js';
import { cosignThreshold, filingError, canCosign, openStatuses } from './docket.js';
import { tally } from './jury.js';
import { Sentencer, allowedSentences } from './sentencing.js';
import type {
  Case,
  CourtState,
  CourtEvent,
  Exhibit,
  LogEntry,
  Segment,
  Settings,
  Snapshot,
  Trial,
  TrialScript,
  User,
} from '../../web/src/shared/types.js';

export interface Clock {
  now(): number;
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  setTimeout?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout?(id: ReturnType<typeof setTimeout>): void;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}
export const systemClock: Clock = {
  now: Date.now,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
};
interface Prepared {
  script: TrialScript;
  exhibits: Exhibit[];
}
export class CourtRunner {
  state: CourtState;
  settings: Settings;
  logs: LogEntry[] = [];
  onChange = () => {};
  onEvent = (_event: CourtEvent) => {};
  readonly sentencer: Sentencer;
  readonly speech: SpeechCache;
  readonly capture: CaptureReadiness;
  readonly comedy: ComedyDesk;
  private caption?: Extract<CourtEvent, { type: 'caption' }>;
  private speechSequence = 0;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  private prepared = new Map<number, Prepared>();
  private chatters = new Map<string, number>();
  private users = new Map<string, User>();
  private demoCase: number | null = null;
  private demoStarting = false;
  private demoInjected = new Set<string>();
  private ticking = false;
  private starting = false;
  private pending = new Set<Promise<unknown>>();
  constructor(
    readonly store: Store,
    readonly twitch: TwitchAdapter,
    readonly obs: ObsAdapter,
    readonly ai: AIService,
    readonly clock: Clock = systemClock,
  ) {
    this.settings = store.settings();
    this.state = { trial: null, now: clock.now(), cooldownUntil: 0 };
    this.sentencer = new Sentencer(store, twitch, this.log);
    this.speech = new SpeechCache(ai, clock);
    this.capture = new CaptureReadiness(!!ai.transcriptionConfigured, () => this.clock.now());
    const comedy = store.get<{ value_json: string }>(
      "SELECT value_json FROM settings WHERE key='comedy'",
    );
    this.comedy = new ComedyDesk(
      comedy ? JSON.parse(comedy.value_json) : undefined,
      (value) =>
        store.run(
          "INSERT OR REPLACE INTO settings(key,value_json) VALUES('comedy',?)",
          JSON.stringify(value),
        ),
      (event) => this.onEvent(event),
      () => this.onChange(),
      { camera: () => this.settings.webcam, clock },
    );
    twitch.onStreamInfo = (info) => this.adoptBroadcast(info);
    twitch.onMessage = (u, text) => {
      this.track(this.chat(u, text));
    };
    twitch.onRedemption = (u, text) => {
      if (this.settings.channelPoints) this.track(this.file(u, text, true));
    };
  }
  log = (kind: string, message: string) => {
    this.logs.unshift({ at: this.clock.now(), kind, message });
    this.logs = this.logs.slice(0, 100);
    this.onChange();
  };
  track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise
      .catch(() => this.log('error', 'An operation failed; the court remains available.'))
      .finally(() => this.pending.delete(promise));
    return promise;
  }
  async settle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
  start() {
    this.timer = this.clock.setInterval(() => {
      void this.tick();
    }, 250);
    this.track(this.sentencer.reverts(this.clock.now()));
  }
  close() {
    this.closed = true;
    this.comedy.close();
    this.speech.close();
    if (this.timer) this.clock.clearInterval(this.timer);
    this.twitch.close?.();
    this.obs.close?.();
  }
  captureStatus() {
    const t = this.state.trial;
    return this.capture.status(
      !!t && t.caseId === this.demoCase,
      !!t?.defense_text &&
        !this.store
          .all<{ source: string }>(
            'SELECT source FROM segments WHERE broadcast_id=? AND started_at_ms>=?',
            this.store.broadcastId,
            t.defenseStartedAt ?? Infinity,
          )
          .some((s) => s.source === 'mic'),
    );
  }
  cases() {
    return this.store.cases(this.settings.streamerName);
  }
  private evidenceCurrent(t: Trial) {
    return (
      this.getCase(t.caseId).broadcast_id === this.store.broadcastId &&
      t.exhibits.every((e) => {
        const segment = this.store.segment(e.segment_id);
        return !!segment && this.store.eligibleSegment(segment, this.clock.now());
      })
    );
  }
  snapshot(panel = true): Snapshot {
    const safeState =
      this.state.trial && !this.evidenceCurrent(this.state.trial)
        ? { ...this.state, trial: null }
        : this.state;
    const cases = this.cases().map((c) =>
      panel
        ? c
        : {
            ...c,
            raw_charge: undefined,
            plaintiff_id: '',
            plaintiff_login: 'a concerned citizen',
            defense_text: '',
            search_hints: [],
          },
    );
    return {
      comedy: this.comedy.snapshot(this.clock.now()),
      caption:
        this.caption &&
        this.caption.scope === speechScope(safeState.trial) &&
        this.caption.expiresAt > this.clock.now()
          ? this.caption
          : undefined,
      sentences: this.store.activeSentences(),
      court: panel
        ? safeState
        : {
            ...safeState,
            trial: safeState.trial ? { ...safeState.trial, defense_text: '' } : null,
          },
      cases,
      settings: this.settings,
      segments: panel ? this.store.segments() : [],
      records: panel ? this.store.records() : { precedents: [], plaintiffs: [], convictions: [] },
      logs: panel ? this.logs : [],
      status: {
        broadcastId: this.store.broadcastId,
        evidence:
          this.store.broadcast()?.kind === 'twitch'
            ? 'Active Twitch broadcast verified'
            : this.twitch.execution().mode === 'simulated'
              ? 'Local rehearsal evidence'
              : 'Live broadcast identity not verified',
        capture: this.captureStatus(),
        transcriptionConfigured: !!this.ai.transcriptionConfigured,
        pendingUnverifiedRestores: this.store
          .all<{ payload_json: string }>(
            'SELECT payload_json FROM sentences_applied WHERE revert_at_ms IS NOT NULL AND reverted=0',
          )
          .filter((row) => {
            const p = JSON.parse(row.payload_json);
            return !p.execution && p.dryRun !== true;
          }).length,
        pendingRealRestores: this.store
          .all<{ payload_json: string }>(
            'SELECT payload_json FROM sentences_applied WHERE revert_at_ms IS NOT NULL AND reverted=0',
          )
          .filter((r) => {
            const p = JSON.parse(r.payload_json);
            return p.execution?.mode === 'live';
          }).length,
        sim: config.SIM_MODE,
        dryRun: config.DRY_RUN,
        twitch: this.twitch.status,
        eventsub: this.twitch.eventsubStatus,
        obs: this.obs.status,
        ai: this.ai.status,
      },
      chunkMs: config.CHUNK_MS,
    };
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock.now();
      if (this.state.trial && !this.evidenceCurrent(this.state.trial))
        this.dispatch({ type: 'MISTRIAL', now });
      for (const c of this.cases())
        if (c.status === 'filing' && now >= c.created_at_ms + this.settings.cosignWindowMs) {
          this.store.updateCase(c.id, { status: 'expired' });
          this.track(
            this.twitch.sendChat(
              `Case #${c.case_no} could not find co-signers. The plaintiff stands alone.`,
            ),
          );
        }
      this.dispatch({ type: 'TICK', now });
      const t = this.state.trial;
      if (t?.caseId === this.demoCase) {
        if (t.phase === 'DEFENSE' && !this.demoInjected.has('defense')) {
          this.demoInjected.add('defense');
          this.addSegment(
            "Okay that was lag, the game lagged, that doesn't count.",
            now,
            now + 1000,
            'sim',
          );
        }
        if (t.phase === 'JURY' && !this.demoInjected.has('jury')) {
          this.demoInjected.add('jury');
          for (let i = 1; i <= 7; i++)
            this.dispatch({
              type: 'VOTE',
              userId: `viewer${i}`,
              vote: i <= 5 ? 'guilty' : 'not_guilty',
              now,
            });
        }
      }
      if (
        !this.demoStarting &&
        !this.state.trial &&
        now >= this.state.cooldownUntil &&
        this.settings.courtOn
      )
        this.track(this.startNext());
      if (Math.floor(now / 1000) !== Math.floor((now - 250) / 1000))
        this.track(this.sentencer.reverts(now));
    } finally {
      this.ticking = false;
    }
  }
  dispatch(event: Event) {
    const previous = this.state.trial;
    const beforePhase = previous?.phase;
    const result = reducer(this.state, event, this.settings);
    this.state = result.state;
    const t = this.state.trial;
    if (
      previous &&
      (event.type === 'MISTRIAL' ||
        (event.type === 'TICK' && event.now - previous.startedAt >= 180000))
    ) {
      this.comedy.clear(false);
      this.store.updateCase(previous.caseId, {
        status: 'mistrial',
        verdict: 'mistrial',
        defense_text: previous.defense_text,
      });
      this.log('court', `Case #${previous.caseId}: mistrial`);
      this.track(this.sentencer.cancel(previous.caseId, this.clock.now()));
      this.finish({
        ...previous,
        verdict: 'mistrial',
        verdictScript: fallbackVerdict('mistrial', []),
      });
    }
    if (t?.verdict === 'mistrial' && previous?.verdict !== 'mistrial') this.comedy.clear(false);
    if (t) {
      this.store.saveExhibits(t.caseId, t.exhibits);
      if (event.type === 'VOTE' && t.phase === 'JURY' && event.now < t.deadline)
        this.store.run(
          'INSERT OR REPLACE INTO votes VALUES(?,?,?)',
          t.caseId,
          event.userId,
          event.vote,
        );
      if (t.phase !== beforePhase) this.log('phase', `Case #${t.caseId}: ${t.phase}`);
    }
    this.onChange();
    for (const effect of result.effects) this.track(this.effect(effect, t ?? previous));
  }
  private async effect(effect: Effect, t: Trial | null) {
    switch (effect.type) {
      case 'speak': {
        const now = this.clock.now(),
          scope = speechScope(this.state.trial),
          expiresAt = this.state.trial?.deadline ?? now + 6000;
        const caption = {
          type: 'caption' as const,
          id: `line_${++this.speechSequence}`,
          scope,
          speaker: effect.speaker,
          text: effect.text,
          sentAt: now,
          expiresAt,
        };
        this.caption = caption;
        this.onEvent(caption);
        this.onChange();
        const readingMs = speechDurationMs(effect.text),
          remaining = expiresAt - now;
        if (!this.settings.tts || !this.ai.speak || remaining < readingMs + 300) break;
        const url =
          this.speech.peek(effect.text, effect.speaker) ??
          (await this.speech.get(
            effect.text,
            effect.speaker,
            Math.min(2500, remaining - readingMs - 300),
          ));
        if (
          !url ||
          this.closed ||
          this.caption?.id !== caption.id ||
          speechScope(this.state.trial) !== scope ||
          expiresAt - this.clock.now() < readingMs + 300
        )
          break;
        this.onEvent({
          type: 'speech',
          captionId: caption.id,
          scope,
          url,
          sentAt: this.clock.now(),
          expiresAt,
        });
        break;
      }
      case 'sfx':
        this.onEvent({ type: 'sfx', name: effect.name });
        break;
      case 'switchScene':
        await this.obs.enterCourt(this.settings.obsCourtScene);
        break;
      case 'restoreScene':
        await this.obs.restore();
        break;
      case 'callRebuttal':
        if (t) {
          const candidates = this.candidates().filter(
            (s) => !t.exhibits.some((e) => e.struck && e.segment_id === s.id),
          );
          const scope = speechScope(this.state.trial);
          const result = await deadline(
            this.ai.rebuttal(
              { ...this.getCase(t.caseId), defense_capture: this.captureStatus().detail },
              t.exhibits.filter((e) => !e.struck),
              this.captureDefense(t),
              candidates,
            ),
            Math.min(4000, Math.max(0, t.deadline - this.clock.now() - 5000)),
            async () => ({ rebuttal_line: fallback.rebuttal[0], new_exhibit: null }),
            this.clock,
          );
          if (
            this.state.trial?.caseId === t.caseId &&
            speechScope(this.state.trial) === scope &&
            this.getCase(t.caseId).broadcast_id === this.store.broadcastId
          )
            this.dispatch({
              type: 'REBUTTAL_READY',
              result,
              exhibit: result.new_exhibit
                ? candidates.some((s) => s.id === result.new_exhibit!.segment_id)
                  ? this.exhibit(result.new_exhibit, 'rebuttal')
                  : undefined
                : undefined,
              now: this.clock.now(),
            });
        }
        break;
      case 'callVerdict':
        if (t) {
          const c = this.getCase(t.caseId),
            votes = tally(t.votes),
            allowed = allowedSentences(this.settings, t);
          const scope = speechScope(this.state.trial);
          const result = await deadline(
            this.ai.verdict(
              { ...c, defense_capture: this.captureStatus().detail },
              votes.verdict,
              votes,
              t.exhibits.filter((e) => !e.struck),
              t.defense_text,
              allowed,
            ),
            Math.min(6000, Math.max(0, t.deadline - this.clock.now() - 300)),
            async () => fallbackVerdict(votes.verdict, allowed),
            this.clock,
          );
          if (this.state.trial?.caseId === t.caseId && speechScope(this.state.trial) === scope)
            this.dispatch({ type: 'VERDICT_READY', result, now: this.clock.now() });
        }
        break;
      case 'executeSentence':
        if (t) {
          const current = this.state.trial;
          if (!current || current.caseId !== t.caseId) break;
          current.verdictScript ??= fallbackVerdict(t.verdict!, allowedSentences(this.settings, t));
          const c = this.getCase(t.caseId);
          current.sentenceState = {
            state: 'pending',
            detail: 'Applying the approved consequence…',
          };
          this.onChange();
          try {
            await this.sentencer.execute(
              current,
              this.settings,
              this.users.get(c.plaintiff_id) ?? { id: c.plaintiff_id, login: c.plaintiff_login },
              this.clock.now(),
              () =>
                this.state.trial?.caseId === t.caseId &&
                this.getCase(t.caseId).status !== 'mistrial' &&
                this.getCase(t.caseId).broadcast_id === this.store.broadcastId,
            );
            if (this.state.trial?.caseId === t.caseId) {
              const chosen = allowedSentences(this.settings, current).find(
                (s) => s.id === current.verdictScript?.sentence_id,
              );
              this.state.trial.sentenceState =
                current.verdict !== 'guilty' || !chosen
                  ? {
                      state: 'none',
                      detail:
                        current.verdict === 'guilty'
                          ? 'No approved sentence selected.'
                          : 'No conviction sentence.',
                    }
                  : this.twitch.execution().mode === 'live'
                    ? {
                        state: 'applied',
                        detail:
                          chosen.type === 'title'
                            ? 'Title action confirmed · restoration saved'
                            : 'Manual sentence awaits streamer confirmation',
                      }
                    : {
                        state: 'rehearsed',
                        detail: 'Rehearsal consequence · no live Twitch mutation',
                      };
            }
          } catch {
            if (this.state.trial?.caseId === t.caseId)
              this.state.trial.sentenceState = {
                state: 'failed',
                detail: 'Consequence not confirmed · any saved restoration remains pending',
              };
            this.log(
              'sentence',
              'Consequence could not be confirmed; restoration obligations are retained.',
            );
          }
          this.onChange();
        }
        break;
      case 'savePrecedent':
        if (t) this.finish(t);
        break;
      case 'juryOpened':
        if (this.settings.polls && this.twitch.createPoll)
          await this.twitch
            .createPoll()
            .catch(() => this.log('twitch', 'Poll unavailable; chat voting remains open.'));
        break;
      case 'end':
        this.demoCase = null;
        break;
      case 'showExhibit':
        break;
    }
  }
  getCase(id: number) {
    const c = this.cases().find((x) => x.id === id);
    if (!c) throw Error('Case not found');
    return c;
  }
  candidates(hints: string[] = []): Segment[] {
    return retrieve(this.store, hints, this.clock.now());
  }
  exhibit(
    pick: { segment_id: string; framing: string },
    added_in: Exhibit['added_in'],
  ): Exhibit | undefined {
    const s = this.store.segment(pick.segment_id);
    if (!s || !this.store.eligibleSegment(s, this.clock.now())) return undefined;
    return {
      ...pick,
      source: s.source,
      broadcast_id: s.broadcast_id,
      text: s.text,
      timestamp: s.timestamp,
      frame_url: nearestFrame(this.store, s.started_at_ms)?.url ?? null,
      struck: false,
      added_in,
    };
  }
  async file(user: User, charge: string, skipCosign = false) {
    if (this.twitch.execution().mode !== 'simulated' && !(await this.verifyBroadcast())) {
      await this.twitch.sendChat('The court awaits a verified live broadcast.');
      return null;
    }
    const error = filingError(charge, user.id, this.cases(), this.settings, this.clock.now());
    if (error) {
      await this.twitch.sendChat(error);
      return null;
    }
    const now = this.clock.now(),
      count = this.store.get<{ n: number }>('SELECT COUNT(*) n FROM cases')!.n + 1;
    const threshold = cosignThreshold(this.uniqueChatters(), this.settings);
    const id = Number(
      this.store.run(
        'INSERT INTO cases(case_no,status,plaintiff_id,plaintiff_login,raw_charge,threshold,created_at_ms,broadcast_id) VALUES(?,?,?,?,?,?,?,?)',
        count,
        'filing',
        user.id,
        user.login,
        charge,
        threshold,
        now,
        this.store.broadcastId,
      ).lastInsertRowid,
    );
    this.users.set(user.id, user);
    this.store.updateCase(id, { raw_flagged: 1 });
    this.onChange();
    const safe = this.ai.moderate ? await this.ai.moderate(charge) : localSafe(charge);
    this.store.updateCase(id, { raw_flagged: +!safe });
    if (this.getCase(id).status !== 'filing') return id;
    if (skipCosign) {
      this.store.updateCase(id, { status: 'screening' });
      await this.screen(id);
    } else
      await this.twitch.sendChat(
        `Case #${count} filed: Chat v. ${this.settings.streamerName}. Needs ${threshold} co-signers in ${Math.round(this.settings.cosignWindowMs / 1000)}s. Type !cosign ${count}`,
      );
    return id;
  }
  private uniqueChatters() {
    const cutoff = this.clock.now() - 600000;
    for (const [id, at] of this.chatters) if (at < cutoff) this.chatters.delete(id);
    return this.chatters.size;
  }
  async chat(user: User, text: string) {
    if (user.id === this.twitch.botId) return;
    this.users.set(user.id, user);
    this.chatters.set(user.id, this.clock.now());
    const cmd = parseCommand(text);
    if (!cmd) return;
    const privileged = user.broadcaster || user.mod;
    switch (cmd.type) {
      case 'sue':
        await this.file(user, cmd.charge);
        break;
      case 'cosign': {
        const filings = this.cases().filter((c) => c.status === 'filing'),
          c = cmd.id
            ? filings.find((c) => c.case_no === cmd.id)
            : filings.length === 1
              ? filings[0]
              : undefined;
        if (c && canCosign(c, user.id, this.clock.now(), this.settings)) {
          const cosigners = [...c.cosigners, user.id];
          this.store.updateCase(c.id, { cosigners_json: JSON.stringify(cosigners) });
          if (cosigners.length >= c.threshold) {
            this.store.updateCase(c.id, { status: 'screening' });
            await this.screen(c.id);
          }
        }
        break;
      }
      case 'vote':
        this.dispatch({ type: 'VOTE', userId: user.id, vote: cmd.vote, now: this.clock.now() });
        break;
      case 'objection':
        this.dispatch({ type: 'OBJECTION', userId: user.id, now: this.clock.now() });
        break;
      case 'court':
        if (privileged) this.updateSettings({ ...this.settings, courtOn: cmd.on });
        break;
      case 'approve':
      case 'veto':
        if (privileged) this.approve(cmd.id, cmd.type === 'approve');
        break;
      case 'mistrial':
        if (privileged) this.dispatch({ type: 'MISTRIAL', now: this.clock.now() });
        break;
      case 'strike':
        if (user.broadcaster)
          this.dispatch({ type: 'STRIKE', index: cmd.index, now: this.clock.now() });
        break;
      case 'docket':
        await this.twitch.sendChat(
          this.cases()
            .filter((c) => ['queued', 'pending_approval'].includes(c.status))
            .map((c) => `#${c.case_no} ${c.name}`)
            .join(' | ') || 'The docket is clear.',
        );
        break;
      case 'record': {
        const convictions = this.cases().filter((c) => c.verdict === 'guilty');
        await this.twitch.sendChat(
          `${convictions.length} convictions. ${convictions
            .slice(0, 3)
            .map((c) => c.name)
            .join(' | ')}`,
        );
        break;
      }
    }
    this.onChange();
  }
  async screen(id: number) {
    const c = this.getCase(id);
    if (c.status !== 'screening') return;
    this.store.updateCase(id, {
      raw_flagged: +!(this.ai.moderate
        ? await this.ai.moderate(c.raw_charge!)
        : localSafe(c.raw_charge!)),
    });
    if (this.getCase(id).status !== 'screening') return;
    const result = await this.ai.clerk(
      c.raw_charge!,
      this.cases()
        .filter((x) => x.id !== id && openStatuses.includes(x.status))
        .map((x) => x.short_title),
    );
    if (this.getCase(id).status !== 'screening') return;
    this.store.updateCase(id, {
      formal_charge: result.formal_charge,
      short_title: result.short_title,
      category: result.category,
      search_hints_json: JSON.stringify(result.search_hints),
      reject_reason: result.admissible ? null : result.reason_code,
      status: result.admissible
        ? this.settings.autoApprove
          ? 'queued'
          : 'pending_approval'
        : 'rejected',
    });
    if (result.admissible) await this.prepare(id);
    else
      await this.twitch.sendChat(
        `Case #${c.case_no} dismissed: outside this court's jurisdiction.`,
      );
    this.onChange();
  }
  async prepare(id: number) {
    const c = this.getCase(id),
      candidates = this.candidates(c.search_hints);
    const script = validateExhibits(
      await this.ai.trial(c, candidates),
      candidates,
      this.store.records().precedents.map((p) => p.id),
    );
    if (!['queued', 'pending_approval'].includes(this.getCase(id).status)) return;
    if (c.broadcast_id !== this.store.broadcastId) {
      this.store.updateCase(id, { status: 'dismissed', reject_reason: 'broadcast_changed' });
      return;
    }
    const ids = new Set(candidates.map((s) => s.id));
    const exhibits = script.exhibits
      .filter((e) => ids.has(e.segment_id))
      .slice(0, 3)
      .map((e) => this.exhibit(e, 'opening'))
      .filter((e): e is Exhibit => !!e);
    if (!script.has_case || !exhibits.length) {
      this.store.updateCase(id, { status: 'dismissed', reject_reason: 'insufficient_evidence' });
      await this.twitch.sendChat('The prosecution has nothing. Case dismissed.');
      this.track(
        this.effect(
          {
            type: 'speak',
            speaker: 'Judge Docket',
            text: 'The prosecution has nothing. Case dismissed.',
          },
          null,
        ),
      );
      this.onChange();
      return;
    }
    script.exhibits = script.exhibits.filter((e) =>
      exhibits.some((x) => x.segment_id === e.segment_id),
    );
    this.store.saveExhibits(id, exhibits);
    if (this.ai.speak && this.settings.tts) {
      for (const [text, speaker] of [
        [script.opening_line, 'Judge Docket'],
        [defenseAnnouncement(this.settings.phaseMs.DEFENSE), 'Judge Docket'],
        ...script.exhibit_lines.map((line) => [line, 'D.A. Receipts']),
        ...Object.values(announcements).map((line) => [line, 'Judge Docket']),
        [fallback.rebuttal[0], 'D.A. Receipts'],
        [fallback.sentence[0], 'Judge Docket'],
      ])
        this.track(this.speech.warm(text, speaker));
    }
    if (['queued', 'pending_approval'].includes(this.getCase(id).status))
      this.prepared.set(id, { script, exhibits });
    this.onChange();
  }
  approve(id: number, approve: boolean) {
    const c = this.cases().find((c) => c.case_no === id);
    const eligible = approve
      ? ['pending_approval', 'queued']
      : ['filing', 'screening', 'pending_approval', 'queued'];
    if (!c || !eligible.includes(c.status)) return;
    if (!approve) this.prepared.delete(c.id);
    this.store.updateCase(c.id, {
      status: approve ? 'queued' : 'rejected',
      reject_reason: approve ? null : 'streamer_veto',
    });
    this.onChange();
  }
  adoptBroadcast(info: StreamInfo) {
    const before = this.store.broadcastId;
    if (info.live && info.broadcastId && info.channelId && info.startedAt !== null)
      this.store.bindBroadcast({
        id: `twitch:${info.channelId}:${info.broadcastId}`,
        channelId: info.channelId,
        startedAt: info.startedAt,
        kind: 'twitch',
      });
    else if (!info.live && this.store.broadcast()?.kind === 'twitch')
      this.store.useLocalBroadcast();
    if (before !== this.store.broadcastId) {
      if (this.state.trial) this.dispatch({ type: 'MISTRIAL', now: this.clock.now() });
      this.store.run(
        "UPDATE cases SET status='expired' WHERE broadcast_id<>? AND status IN ('filing','screening','queued','pending_approval')",
        this.store.broadcastId,
      );
      this.onChange();
    }
  }
  private async verifyBroadcast() {
    const info = await deadline(this.twitch.getStream(), 2500, async () => null, this.clock);
    if (!info) return false;
    this.adoptBroadcast(info);
    return !!info.live && !!info.broadcastId && !!info.channelId && info.startedAt !== null;
  }
  async startNext() {
    if (this.starting) return;
    this.starting = true;
    try {
      if (this.state.trial || !this.settings.courtOn || this.clock.now() < this.state.cooldownUntil)
        return;
      const c = this.cases()
        .reverse()
        .find(
          (c) =>
            c.status === 'queued' &&
            c.broadcast_id === this.store.broadcastId &&
            this.prepared.has(c.id),
        );
      if (!c) return;
      if (this.twitch.execution().mode !== 'simulated' && !(await this.verifyBroadcast())) return;
      if (c.broadcast_id !== this.store.broadcastId || this.getCase(c.id).status !== 'queued')
        return;
      const prepared = this.prepared.get(c.id)!;
      if (
        prepared.exhibits.some((e) => {
          const s = this.store.segment(e.segment_id);
          return !s || !this.store.eligibleSegment(s, this.clock.now());
        })
      ) {
        this.store.updateCase(c.id, { status: 'dismissed', reject_reason: 'broadcast_changed' });
        this.prepared.delete(c.id);
        return;
      }
      prepared.exhibits = prepared.exhibits.map((e) => ({
        ...e,
        frame_url:
          nearestFrame(this.store, this.store.segment(e.segment_id)!.started_at_ms)?.url ?? null,
      }));
      this.prepared.delete(c.id);
      this.store.updateCase(c.id, { status: 'in_trial', trial_started_at_ms: this.clock.now() });
      this.dispatch({
        type: 'START',
        caseId: c.id,
        name: c.name,
        formalCharge: c.formal_charge,
        ...prepared,
        now: this.clock.now(),
      });
    } finally {
      this.starting = false;
    }
  }
  addSegment(
    text: string,
    start: number,
    end: number,
    source: Segment['source'],
    broadcastId = this.store.broadcastId,
  ) {
    const s = this.store.addSegment(text, start, end, source, broadcastId);
    const t = this.state.trial;
    if (
      t &&
      this.store.eligibleSegment(s, this.clock.now()) &&
      t.defenseStartedAt !== null &&
      start >= t.defenseStartedAt &&
      start < (t.defenseEndedAt ?? t.deadline)
    )
      this.dispatch({ type: 'DEFENSE', text, startedAt: start, now: this.clock.now() });
    this.onChange();
    return s;
  }
  captureDefense(t: Trial) {
    const defenseStart = t.defenseStartedAt ?? 0;
    const segments = this.store.all<{ text: string }>(
      'SELECT text FROM segments WHERE broadcast_id=? AND started_at_ms>=? AND started_at_ms<? ORDER BY started_at_ms',
      this.getCase(t.caseId).broadcast_id,
      defenseStart,
      t.defenseEndedAt ?? this.clock.now(),
    );
    const text = segments.map((s) => s.text).join(' ') || t.defense_text;
    if (this.state.trial) this.state.trial.defense_text = text;
    this.store.updateCase(t.caseId, { defense_text: text });
    return text;
  }
  finish(t: Trial) {
    const previous = this.store.get<{ id: string; verdict: string }>(
      'SELECT id,verdict FROM precedents WHERE case_id=?',
      t.caseId,
    );
    const votes = tally(t.votes);
    this.store.updateCase(t.caseId, {
      status: t.verdict,
      verdict: t.verdict,
      guilty_votes: votes.guilty,
      not_guilty_votes: votes.notGuilty,
      defense_text: t.defense_text,
    });
    const c = this.getCase(t.caseId),
      summary =
        t.verdictScript?.precedent_summary ?? fallbackVerdict(t.verdict!, []).precedent_summary;
    const id =
      previous?.id ??
      `P-${String(this.store.get<{ n: number }>('SELECT COUNT(*) n FROM precedents')!.n + 1).padStart(3, '0')}`;
    if (previous)
      this.store.run(
        'UPDATE precedents SET verdict=?,summary=? WHERE case_id=?',
        t.verdict,
        summary,
        c.id,
      );
    else
      this.store.run(
        'INSERT INTO precedents VALUES(?,?,?,?,?,?)',
        id,
        c.id,
        c.name,
        t.verdict,
        summary,
        this.clock.now(),
      );
    this.store.run(
      'INSERT OR IGNORE INTO plaintiffs(user_id,login) VALUES(?,?)',
      c.plaintiff_id,
      c.plaintiff_login,
    );
    this.store.run(
      'UPDATE plaintiffs SET wins=wins+?,losses=losses+?,contempts=contempts+? WHERE user_id=?',
      +(t.verdict === 'guilty') - +(previous?.verdict === 'guilty'),
      +(t.verdict === 'not_guilty') - +(previous?.verdict === 'not_guilty'),
      +(t.verdict === 'not_guilty' && this.settings.contempt) -
        +(previous?.verdict === 'not_guilty' && this.settings.contempt),
      c.plaintiff_id,
    );
    this.onEvent({ type: 'precedent', text: `New precedent ${id} established` });
  }
  serveSentence(id?: number) {
    const caseId = id ?? this.state.trial?.caseId ?? this.store.activeSentences()[0]?.case_id;
    if (caseId === undefined || !this.store.activeSentences().some((s) => s.case_id === caseId))
      return;
    if (caseId !== undefined)
      this.store.run(
        'UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND revert_at_ms IS NULL',
        caseId,
      );
    if (this.state.trial?.caseId === caseId)
      this.dispatch({ type: 'SERVED', now: this.clock.now() });
    this.onChange();
  }
  updateSettings(s: Settings) {
    this.settings = s;
    this.store.saveSettings(s);
    this.onChange();
  }
  async demo() {
    if (this.demoStarting || this.state.trial)
      throw Error('Finish the current trial before starting a demo.');
    this.demoStarting = true;
    try {
      this.demoInjected.clear();
      this.state.cooldownUntil = 0;
      const now = this.clock.now();
      if (this.twitch.execution().mode !== 'simulated')
        throw Error(
          'Use SIM_MODE=true for the full demo; live trials require active-broadcast evidence.',
        );
      this.store.useLocalBroadcast(now - 40000);
      [
        'This boss is easy, first try guaranteed.',
        'I never die to this guy, trust me.',
        'Parrying is my specialty, watch this.',
        'The gate opens on the left.',
        'That was the sixth attempt.',
      ].forEach((text, i) =>
        this.addSegment(text, now - (5 - i) * 6000, now - (5 - i) * 6000 + 2000, 'sim'),
      );
      const user = { id: `viewer1_demo_${now}`, login: 'viewer1' };
      const id = await this.file(user, 'he said first try guaranteed and died like six times');
      if (!id) throw Error('The docket is full or court is closed.');
      this.demoCase = id;
      for (let i = 0; i < this.getCase(id).threshold; i++)
        await this.chat(
          { id: `viewer${i + 2}`, login: `viewer${i + 2}` },
          `!cosign ${this.getCase(id).case_no}`,
        );
      if (this.getCase(id).status === 'pending_approval')
        this.approve(this.getCase(id).case_no, true);
      await this.startNext();
      return id;
    } finally {
      this.demoStarting = false;
    }
  }
}
