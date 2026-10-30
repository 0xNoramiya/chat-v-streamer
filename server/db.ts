import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { defaults, settingsSchema } from './config.js';
import type {
  Case,
  Segment,
  Settings,
  Precedent,
  Plaintiff,
  Exhibit,
  ActiveSentence,
} from '../web/src/shared/types.js';
export class Store {
  db: Database.Database;
  sessionId: number;
  sessionStart: number;
  constructor(path = 'data/court.db', now = Date.now()) {
    mkdirSync('data', { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY,started_at_ms INTEGER,stream_started_at_ms INTEGER);
 CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY,session_id INTEGER,started_at_ms INTEGER,ended_at_ms INTEGER,text TEXT,source TEXT);
 CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(id UNINDEXED,text);
 CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN INSERT INTO segments_fts(id,text) VALUES(new.id,new.text); END;
 CREATE TABLE IF NOT EXISTS frames(id INTEGER PRIMARY KEY,captured_at_ms INTEGER,path TEXT);
 CREATE TABLE IF NOT EXISTS cases(id INTEGER PRIMARY KEY,case_no INTEGER,status TEXT,plaintiff_id TEXT,plaintiff_login TEXT,raw_charge TEXT,raw_flagged INTEGER DEFAULT 0,formal_charge TEXT DEFAULT '',short_title TEXT DEFAULT '',category TEXT DEFAULT '',reject_reason TEXT,cosigners_json TEXT DEFAULT '[]',threshold INTEGER DEFAULT 2,created_at_ms INTEGER,trial_started_at_ms INTEGER,verdict TEXT,guilty_votes INTEGER DEFAULT 0,not_guilty_votes INTEGER DEFAULT 0,defense_text TEXT DEFAULT '',search_hints_json TEXT DEFAULT '[]');
 CREATE TABLE IF NOT EXISTS exhibits(case_id INTEGER,idx INTEGER,segment_id TEXT,framing TEXT,frame_id INTEGER,struck INTEGER,added_in TEXT,PRIMARY KEY(case_id,idx));
 CREATE TABLE IF NOT EXISTS votes(case_id INTEGER,user_id TEXT,vote TEXT,PRIMARY KEY(case_id,user_id));
 CREATE TABLE IF NOT EXISTS precedents(id TEXT PRIMARY KEY,case_id INTEGER UNIQUE,case_name TEXT,verdict TEXT,summary TEXT,created_at_ms INTEGER);
 CREATE VIRTUAL TABLE IF NOT EXISTS precedents_fts USING fts5(id UNINDEXED,summary);
 CREATE TRIGGER IF NOT EXISTS precedents_ai AFTER INSERT ON precedents BEGIN INSERT INTO precedents_fts(id,summary) VALUES(new.id,new.summary); END;
 CREATE TRIGGER IF NOT EXISTS precedents_au AFTER UPDATE ON precedents BEGIN DELETE FROM precedents_fts WHERE id=old.id; INSERT INTO precedents_fts(id,summary) VALUES(new.id,new.summary); END;
 CREATE TABLE IF NOT EXISTS sentences_applied(case_id INTEGER,sentence_id TEXT,payload_json TEXT,revert_at_ms INTEGER,reverted INTEGER DEFAULT 0,PRIMARY KEY(case_id,sentence_id));
 CREATE TABLE IF NOT EXISTS plaintiffs(user_id TEXT PRIMARY KEY,login TEXT,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,contempts INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value_json TEXT);
 `);
    this.db.pragma('user_version = 1');
    this.sessionStart = now;
    this.sessionId = Number(
      this.db.prepare('INSERT INTO sessions(started_at_ms) VALUES(?)').run(now).lastInsertRowid,
    );
    this.db
      .prepare("UPDATE cases SET status='mistrial',verdict='mistrial' WHERE status='in_trial'")
      .run();
    this.db
      .prepare(
        "UPDATE cases SET status='expired' WHERE status IN ('filing','screening','queued','pending_approval')",
      )
      .run();
  }
  get<T>(sql: string, ...args: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T>(sql: string, ...args: unknown[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).run(...args);
  }
  settings(): Settings {
    const saved = this.get<{ value_json: string }>(
      'SELECT value_json FROM settings WHERE key=?',
      'runtime',
    );
    try {
      return settingsSchema.parse({ ...defaults, ...(saved ? JSON.parse(saved.value_json) : {}) });
    } catch {
      return structuredClone(defaults);
    }
  }
  saveSettings(s: Settings) {
    this.run('INSERT OR REPLACE INTO settings VALUES(?,?)', 'runtime', JSON.stringify(s));
  }
  cases(name = 'Noramiya'): Case[] {
    return this.all<Record<string, unknown>>('SELECT * FROM cases ORDER BY id DESC').map(
      (r) =>
        ({
          ...r,
          raw_flagged: !!r.raw_flagged,
          cosigners: JSON.parse(String(r.cosigners_json)),
          search_hints: JSON.parse(String(r.search_hints_json)),
          name: `Chat v. ${name}: ${r.short_title || 'Filing under review'}`,
        }) as unknown as Case,
    );
  }
  updateCase(id: number, values: Record<string, unknown>) {
    const keys = Object.keys(values);
    if (!keys.every((k) => /^[a-z_]+$/.test(k))) throw Error('Invalid column');
    this.run(
      `UPDATE cases SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`,
      ...Object.values(values),
      id,
    );
  }
  addSegment(text: string, start: number, end: number, source: Segment['source']): Segment {
    const count = this.get<{ n: number }>('SELECT COUNT(*) n FROM segments')!.n;
    const id = `seg_${String(count + 1).padStart(6, '0')}`;
    this.run(
      'INSERT INTO segments VALUES(?,?,?,?,?,?)',
      id,
      this.sessionId,
      start,
      end,
      text,
      source,
    );
    return this.segment(id)!;
  }
  streamStart(session = this.sessionId) {
    return (
      this.get<{ t: number }>(
        'SELECT COALESCE(stream_started_at_ms,started_at_ms) t FROM sessions WHERE id=?',
        session,
      )?.t ?? this.sessionStart
    );
  }
  segment(id: string): Segment | undefined {
    const s = this.get<Segment>('SELECT * FROM segments WHERE id=?', id);
    return s
      ? { ...s, timestamp: timestamp(s.started_at_ms - this.streamStart(s.session_id)) }
      : undefined;
  }
  segments(): Segment[] {
    return this.all<{ id: string }>(
      'SELECT id FROM segments ORDER BY started_at_ms DESC LIMIT 100',
    ).map((s) => this.segment(s.id)!);
  }
  saveExhibits(caseId: number, exhibits: Exhibit[]) {
    exhibits.forEach((e, i) =>
      this.run(
        'INSERT OR REPLACE INTO exhibits VALUES(?,?,?,?,?,?,?)',
        caseId,
        i,
        e.segment_id,
        e.framing,
        e.frame_url
          ? (this.get<{ id: number }>('SELECT id FROM frames WHERE path=?', `data${e.frame_url}`)
              ?.id ?? null)
          : null,
        +e.struck,
        e.added_in,
      ),
    );
  }
  activeSentences(): ActiveSentence[] {
    return this.all<{ case_id: number; sentence_id: string; payload_json: string }>(
      'SELECT * FROM sentences_applied WHERE revert_at_ms IS NULL AND reverted=0',
    ).map((r) => ({ ...r, ...JSON.parse(r.payload_json) }));
  }
  records() {
    return {
      precedents: this.all<Precedent>(
        'SELECT * FROM precedents ORDER BY created_at_ms DESC LIMIT 50',
      ),
      plaintiffs: this.all<Plaintiff>(
        'SELECT * FROM plaintiffs ORDER BY wins DESC,contempts DESC LIMIT 30',
      ),
      convictions: this.cases(this.settings().streamerName).filter((c) => c.verdict === 'guilty'),
    };
  }
  close() {
    this.db.close();
  }
}
export function timestamp(ms: number) {
  return new Date(Math.max(0, ms)).toISOString().slice(11, 19);
}
