import type { CourtEvent } from '../shared/types';
type Caption = Extract<CourtEvent, { type: 'caption' }>;
export class CourtAudio {
  private context?: AudioContext;
  private queue: Caption[] = [];
  private playing = false;
  private audio?: HTMLAudioElement;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  constructor(private show: (caption: Caption | null) => void) {}
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }
  enqueue(caption: Caption) {
    this.queue.push(caption);
    void this.next();
  }
  clear() {
    this.generation++;
    this.queue = [];
    this.playing = false;
    this.audio?.pause();
    if (this.audio) this.audio.src = '';
    clearTimeout(this.timer);
    this.show(null);
  }
  private async next() {
    if (this.playing || !this.queue.length) return;
    this.playing = true;
    const caption = this.queue.shift()!,
      generation = this.generation;
    this.show(caption);
    let done = false;
    const finish = () => {
      if (done || generation !== this.generation) return;
      done = true;
      clearTimeout(this.timer);
      this.playing = false;
      this.show(null);
      void this.next();
    };
    this.timer = setTimeout(finish, caption.url ? 12000 : (caption.duration ?? 6000));
    if (caption.url) {
      const audio = new Audio(caption.url);
      this.audio = audio;
      audio.onended = finish;
      audio.onerror = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(finish, caption.duration ?? 6000);
      };
      try {
        await audio.play();
      } catch {
        clearTimeout(this.timer);
        this.timer = setTimeout(finish, caption.duration ?? 6000);
      }
    }
  }
  sfx(name: string) {
    try {
      this.unlock();
      const context = this.context!;
      if (context.state !== 'running') return;
      const now = context.currentTime;
      const tone = (
        frequency: number,
        start: number,
        length: number,
        type: OscillatorType = 'sine',
        volume = 0.12,
      ) => {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, now + start);
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(35, frequency * 0.45),
          now + start + length,
        );
        gain.gain.setValueAtTime(volume, now + start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + length);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + start);
        oscillator.stop(now + start + length);
      };
      if (name === 'gavel') {
        tone(230, 0, 0.12, 'triangle', 0.3);
        tone(210, 0.2, 0.13, 'triangle', 0.3);
      } else if (name === 'stamp') {
        tone(90, 0, 0.25, 'sine', 0.4);
        tone(150, 0, 0.1, 'triangle', 0.15);
      } else if (name === 'gasp') {
        tone(360, 0, 0.3, 'sawtooth', 0.04);
        tone(470, 0.06, 0.3, 'sawtooth', 0.03);
      } else {
        tone(220, 0, 0.6, 'triangle');
        tone(277, 0, 0.6, 'triangle');
        tone(330, 0, 0.6, 'triangle');
      }
    } catch {
      /* Captions and visual cues remain available when browser audio is blocked. */
    }
  }
  close() {
    this.clear();
    void this.context?.close();
  }
}
