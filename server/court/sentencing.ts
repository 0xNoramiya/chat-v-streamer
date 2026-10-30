import type { Settings, Trial, User } from '../../web/src/shared/types.js';
import type { TwitchAdapter, TwitchExecution } from '../adapters/twitch/types.js';
import type { Store } from '../db.js';
import { severityCap, tally } from './jury.js';
export const allowedSentences = (s: Settings, t: Trial) =>
  s.penalCode.filter((p) => p.approved && p.severity <= severityCap(tally(t.votes).share));
interface TitlePayload {
  originalTitle: string;
  title?: string;
  execution?: TwitchExecution;
  dryRun?: boolean;
  appliedAt?: number;
  cancelRequestedAt?: number;
}
interface RevertRow {
  case_id: number;
  sentence_id: string;
  payload_json: string;
  revert_at_ms: number;
}
export class Sentencer {
  private legacyAudited = false;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private store: Store,
    private twitch: TwitchAdapter,
    private log: (kind: string, message: string) => void,
  ) {}
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.serial.catch(() => {}).then(fn);
    this.serial = task;
    return task;
  }
  private jobs() {
    return this.store.all<RevertRow>(
      'SELECT * FROM sentences_applied WHERE revert_at_ms IS NOT NULL AND reverted=0 ORDER BY revert_at_ms,case_id',
    );
  }
  private payload(row: RevertRow): TitlePayload {
    return JSON.parse(row.payload_json) as TitlePayload;
  }
  private compatible(payload: TitlePayload, context: TwitchExecution) {
    if (payload.execution)
      return (
        payload.execution.mode === context.mode && payload.execution.channelId === context.channelId
      );
    // Old dry-run jobs are virtual. Missing/false flags could describe a real mutation:
    // retain them until the recorded mutation is verified against a live title, never rehearse them away.
    return payload.dryRun === true ? context.mode !== 'live' : false;
  }
  execute(t: Trial, s: Settings, plaintiff: User, now: number, active = () => true) {
    return this.enqueue(async () => {
      if (t.verdict === 'guilty') {
        const chosen = allowedSentences(s, t).find((p) => p.id === t.verdictScript?.sentence_id);
        if (
          chosen &&
          !this.store.get(
            'SELECT 1 FROM sentences_applied WHERE case_id=? AND sentence_id=?',
            t.caseId,
            chosen.id,
          ) &&
          active()
        ) {
          if (chosen.type === 'title')
            await this.applyTitleInSequence(
              t.caseId,
              chosen.id,
              t.verdictScript?.title_text ?? '[CONVICTED] The receipts were conclusive',
              chosen.duration_ms,
              now,
              active,
            );
          else {
            this.store.run(
              'INSERT INTO sentences_applied VALUES(?,?,?,?,0)',
              t.caseId,
              chosen.id,
              JSON.stringify({
                text: chosen.text,
                endsAt: now + chosen.duration_ms,
                execution: this.twitch.execution(),
              }),
              null,
            );
            this.log('sentence', chosen.text);
          }
        }
        if (s.clipOnGuilty && active()) await this.twitch.createClip(active);
        if (s.markerOnGuilty && active()) await this.twitch.createMarker(t.caseName, active);
      } else if (t.verdict === 'not_guilty' && s.contempt && active())
        await this.twitch.timeout(plaintiff, 60, 'Contempt of court: frivolous lawsuit', active);
    });
  }
  applyTitle(
    caseId: number,
    sentenceId: string,
    title: string,
    duration: number,
    now: number,
    active = () => true,
  ) {
    return this.enqueue(() =>
      this.applyTitleInSequence(caseId, sentenceId, title, duration, now, active),
    );
  }
  private async applyTitleInSequence(
    caseId: number,
    sentenceId: string,
    title: string,
    duration: number,
    now: number,
    active: () => boolean,
  ) {
    const stream = await this.twitch.getStream();
    if (!active()) return;
    const execution = this.twitch.execution();
    if (execution.mode === 'live' && !execution.channelId)
      throw Error('Title mutation requires a connected broadcaster.');
    await this.auditLegacy(execution, stream.title);
    if (!active()) return;
    const previous = this.jobs().filter((row) => this.compatible(this.payload(row), execution));
    const originalTitle = previous.length ? this.payload(previous[0]).originalTitle : stream.title;
    const payload: TitlePayload = {
      originalTitle,
      title: title.startsWith('[CONVICTED]')
        ? title.slice(0, 140)
        : '[CONVICTED] The receipts were conclusive',
      execution,
    };
    // Persist before attempting the mutation: even an ambiguous network failure owes a restore.
    this.store.run(
      'INSERT INTO sentences_applied VALUES(?,?,?,?,0)',
      caseId,
      sentenceId,
      JSON.stringify(payload),
      now + duration,
    );
    await this.twitch.setTitle(payload.title!);
    const persisted = this.store.get<{ payload_json: string }>(
      'SELECT payload_json FROM sentences_applied WHERE case_id=? AND sentence_id=?',
      caseId,
      sentenceId,
    )!;
    this.store.run(
      'UPDATE sentences_applied SET payload_json=? WHERE case_id=? AND sentence_id=?',
      JSON.stringify({ ...JSON.parse(persisted.payload_json), appliedAt: now }),
      caseId,
      sentenceId,
    );
    if (!active()) await this.cancelInSequence(caseId, now);
  }
  cancel(caseId: number, now = Date.now()) {
    // Record intent even while a network mutation is still in flight.
    this.requestCancellation(caseId, now);
    return this.enqueue(() => this.cancelInSequence(caseId, now));
  }
  private requestCancellation(caseId: number, now: number) {
    for (const row of this.jobs().filter((r) => r.case_id === caseId)) {
      const payload = this.payload(row);
      if (payload.cancelRequestedAt !== undefined) continue;
      this.store.run(
        'UPDATE sentences_applied SET payload_json=? WHERE case_id=? AND sentence_id=?',
        JSON.stringify({ ...payload, cancelRequestedAt: now }),
        row.case_id,
        row.sentence_id,
      );
    }
  }
  private async cancelInSequence(caseId: number, now: number) {
    this.requestCancellation(caseId, now);
    const context = this.twitch.execution();
    const rows = this.jobs();
    for (const row of rows.filter((r) => r.case_id === caseId)) {
      const payload = this.payload(row);
      if (!this.compatible(payload, context)) continue;
      const others = rows.filter(
        (r) => r.case_id !== caseId && this.compatible(this.payload(r), context),
      );
      const mostRecent = others
        .filter((r) => {
          const p = this.payload(r);
          return (
            r.revert_at_ms > now && p.appliedAt !== undefined && p.cancelRequestedAt === undefined
          );
        })
        .sort((a, b) => this.payload(b).appliedAt! - this.payload(a).appliedAt!)[0];
      await this.restore(row, context, mostRecent ? this.payload(mostRecent).title : undefined);
    }
    this.store.run(
      'UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND revert_at_ms IS NULL',
      caseId,
    );
  }
  private async restore(row: RevertRow, context: TwitchExecution, title?: string) {
    const payload = this.payload(row);
    if (!this.compatible(payload, context)) return false;
    // Virtual receipts can be retired in any virtual environment, never on the live channel.
    await this.twitch.setTitle(title ?? payload.originalTitle);
    this.store.run(
      'UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND sentence_id=?',
      row.case_id,
      row.sentence_id,
    );
    this.log(
      'sentence',
      `${context.mode === 'live' ? 'Title restored' : 'Rehearsal title restored'} for case #${row.case_id}`,
    );
    return true;
  }
  private async auditLegacy(context: TwitchExecution, currentTitle?: string) {
    if (
      (this.legacyAudited && currentTitle === undefined) ||
      context.mode !== 'live' ||
      !context.channelId
    )
      return;
    const legacy = this.store
      .all<RevertRow>(
        'SELECT * FROM sentences_applied WHERE revert_at_ms IS NOT NULL ORDER BY revert_at_ms DESC',
      )
      .filter((row) => {
        const p = this.payload(row);
        return !p.execution && p.dryRun !== true && typeof p.title === 'string';
      });
    if (legacy.length) {
      const title = currentTitle ?? (await this.twitch.getStream()).title;
      const row = legacy.find(
        (r) => this.payload(r).title === title && this.payload(r).originalTitle !== title,
      );
      if (row) {
        const payload = { ...this.payload(row), execution: context, recoveredLegacy: true };
        this.store.run(
          'UPDATE sentences_applied SET reverted=0,payload_json=? WHERE case_id=? AND sentence_id=?',
          JSON.stringify(payload),
          row.case_id,
          row.sentence_id,
        );
        this.log(
          'sentence',
          `Recovered legacy title obligation #${row.case_id}: the recorded convicted title is still active.`,
        );
      }
    }
    this.legacyAudited = true;
  }
  reverts(now: number) {
    return this.enqueue(async () => {
      try {
        await this.auditLegacy(this.twitch.execution());
      } catch {
        this.log('error', 'Legacy title recovery awaits Twitch reconnection.');
        return;
      }

      // Boot marks interrupted trials as mistrials. Their reversible effects must
      // recover immediately, including a crash before cancel() could persist intent.
      for (const row of this.store.all<{ case_id: number }>(
        "SELECT DISTINCT s.case_id FROM sentences_applied s JOIN cases c ON c.id=s.case_id WHERE s.reverted=0 AND c.status='mistrial'",
      ))
        this.requestCancellation(row.case_id, now);
      this.store.run(
        "UPDATE sentences_applied SET reverted=1 WHERE revert_at_ms IS NULL AND case_id IN (SELECT id FROM cases WHERE status='mistrial')",
      );
      const context = this.twitch.execution();
      const cancelled = this.jobs().filter((r) => {
        const p = this.payload(r);
        return p.cancelRequestedAt !== undefined && this.compatible(p, context);
      });
      try {
        for (const caseId of new Set(cancelled.map((r) => r.case_id)))
          await this.cancelInSequence(caseId, now);
      } catch {
        this.log(
          'error',
          'Mistrial title restoration failed; cancellation remains pending for retry.',
        );
        return;
      }
      const rows = this.jobs();
      for (const row of rows) {
        const p = this.payload(row);
        if (
          row.revert_at_ms <= now &&
          (p.execution ? p.execution.mode !== 'live' : p.dryRun === true) &&
          !this.compatible(p, context)
        )
          this.store.run(
            'UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND sentence_id=?',
            row.case_id,
            row.sentence_id,
          );
      }
      const eligible = rows.filter((r) => this.compatible(this.payload(r), context));
      // An overlapping conviction extends the same obligation; no earlier job is called reverted.
      if (!eligible.length || eligible.some((r) => r.revert_at_ms > now)) return;
      try {
        const first = eligible[0];
        if (await this.restore(first, context))
          this.store.db.transaction(() => {
            for (const row of eligible.slice(1))
              this.store.run(
                'UPDATE sentences_applied SET reverted=1 WHERE case_id=? AND sentence_id=?',
                row.case_id,
                row.sentence_id,
              );
          })();
      } catch {
        this.log('error', 'Title restoration failed; the persisted obligation remains pending.');
      }
    });
  }
}
