import type { AIService } from './service.js';
import type { Clock } from '../court/runner.js';
export class SpeechCache {
  private ready = new Map<string, string>();
  private pending = new Map<string, Promise<string | undefined>>();
  private timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  constructor(
    private ai: AIService,
    private clock: Clock,
  ) {}
  peek(text: string, speaker: string) {
    return this.ready.get(`${speaker}:${text}`);
  }
  private bounded(work: Promise<string | undefined>, ms: number) {
    return new Promise<string | undefined>((resolve) => {
      let done = false;
      const finish = (url?: string) => {
        if (done) return;
        done = true;
        (this.clock.clearTimeout ?? clearTimeout)(timer);
        this.timers.delete(timer);
        resolve(url);
      };
      const timer = (this.clock.setTimeout ?? setTimeout)(() => finish(), ms);
      this.timers.set(timer, () => finish());
      void work.then(finish, () => finish());
    });
  }
  warm(text: string, speaker: string) {
    const key = `${speaker}:${text}`;
    if (this.ready.has(key)) return Promise.resolve(this.ready.get(key));
    let work = this.pending.get(key);
    if (!work) {
      work = this.bounded(
        Promise.resolve().then(() => this.ai.speak?.(text, speaker)),
        5000,
      )
        .then((url) => {
          if (url) this.ready.set(key, url);
          return url;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, work);
    }
    return work;
  }
  get(text: string, speaker: string, budgetMs: number) {
    const ready = this.peek(text, speaker);
    if (ready) return Promise.resolve(ready);
    if (budgetMs < 250) return Promise.resolve(undefined);
    return this.bounded(this.warm(text, speaker), budgetMs);
  }
  close() {
    for (const finish of this.timers.values()) finish();
    this.timers.clear();
  }
}
