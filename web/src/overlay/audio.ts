import type { CourtEvent } from '../shared/types';
type Caption = Extract<CourtEvent, { type: 'caption' }>;
export class CourtAudio {
  private context?: AudioContext;
  private scope = 'idle';
  private current?: Caption;
  private audio?: HTMLAudioElement;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private offset = 0;
  constructor(private show: (caption: Caption | null) => void) {}
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }
  sync(scope: string, serverNow: number) {
    this.offset = serverNow - Date.now();
    if (this.scope !== scope) {
      this.clear();
      this.scope = scope;
    }
  }
  enqueue(caption: Caption) {
    if (
      caption.scope !== this.scope ||
      caption.expiresAt <= Date.now() + this.offset ||
      this.current?.id === caption.id
    )
      return;
    this.clear();
    this.current = caption;
    this.show(caption);
    this.timer = setTimeout(
      () => this.clear(),
      Math.max(0, caption.expiresAt - Date.now() - this.offset),
    );
  }
  attach(event: Extract<CourtEvent, { type: 'speech' }>) {
    if (
      this.current?.id !== event.captionId ||
      event.scope !== this.scope ||
      event.expiresAt <= Date.now() + this.offset
    )
      return;
    const generation = this.generation,
      audio = new Audio(event.url);
    this.audio = audio;
    audio.preload = 'auto';
    audio.onloadedmetadata = async () => {
      if (generation !== this.generation || this.current?.id !== event.captionId) return;
      const remaining = event.expiresAt - Date.now() - this.offset;
      if (!Number.isFinite(audio.duration) || audio.duration * 1000 + 150 > remaining) return;
      try {
        await audio.play();
        if (generation !== this.generation) audio.pause();
      } catch {
        /* Keep the already-visible caption if autoplay is blocked. */
      }
    };
  }
  clear() {
    this.generation++;
    this.current = undefined;
    this.audio?.pause();
    if (this.audio) this.audio.src = '';
    this.audio = undefined;
    clearTimeout(this.timer);
    this.show(null);
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
