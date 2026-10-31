import { readFileSync } from 'node:fs';
import type OpenAI from 'openai';
import type { ProviderEvidence } from './evidence.js';
const words = readFileSync(new URL('./blocklist.txt', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((s) => s && !s.startsWith('#'));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const deny = new RegExp(`\\b(?:${words.map(escape).join('|')})\\b`, 'i');
export function localSafe(text: string) {
  return !deny.test(text.normalize('NFKC')) && !/[\u0000-\u0008]/.test(text);
}
export class Moderator {
  private cache = new Map<string, boolean>();
  constructor(
    private sdk?: OpenAI,
    private evidence?: ProviderEvidence,
  ) {}
  async safe(text: string): Promise<boolean> {
    return (await this.safeMany([text]))[0];
  }
  async safeMany(texts: string[]): Promise<boolean[]> {
    const result = texts.map((text) =>
      !localSafe(text) ? false : !text.trim() || !this.sdk ? true : this.cache.get(text),
    );
    const pending = texts
      .map((text, index) => ({ text, index }))
      .filter(({ index }) => result[index] === undefined);
    const tasks: Promise<void>[] = [];
    for (let offset = 0; offset < pending.length; offset += 32) {
      const batch = pending.slice(offset, offset + 32);
      tasks.push(
        (async () => {
          try {
            const response = await this.sdk!.moderations.create(
              { model: 'omni-moderation-latest', input: batch.map((b) => b.text) },
              { timeout: 1800, signal: AbortSignal.timeout(1800) },
            );
            this.evidence?.record('moderation', 'success');
            batch.forEach((b, i) => {
              const ok = response.results[i]?.flagged === false;
              result[b.index] = ok;
              if (this.cache.size > 2000) this.cache.clear();
              this.cache.set(b.text, ok);
            });
          } catch (error) {
            this.evidence?.record('moderation', 'failure', error);
            batch.forEach((b) => {
              result[b.index] = false;
            });
          }
        })(),
      );
    }
    await Promise.all(tasks);
    return result.map(Boolean);
  }
  async line(text: string, fallback: string) {
    return (await this.safe(text)) ? text : fallback;
  }
}
