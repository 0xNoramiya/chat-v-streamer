import type { Clock } from '../server/court/runner.js';
export class ManualClock implements Clock {
  time = 100000;
  private sequence = 0;
  private timers = new Map<ReturnType<typeof setTimeout>, { at: number; fn: () => void }>();
  now = () => this.time;
  setInterval = setInterval;
  clearInterval = clearInterval;
  setTimeout = (fn: () => void, ms: number) => {
    const id = { sequence: ++this.sequence } as unknown as ReturnType<typeof setTimeout>;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return id;
  };
  clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    this.timers.delete(id);
  };
  advance(to: number) {
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, t]) => t.at <= to)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
    }
    this.time = to;
  }
}
export async function flush() {
  for (let i = 0; i < 16; i++) await Promise.resolve();
}
