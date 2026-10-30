import type { ComedyEffect, ComedySaved } from '../shared/comedy';
export class ComedySounds {
  private context?: AudioContext;
  private gain?: GainNode;
  private nodes = new Set<OscillatorNode>();
  private settings: ComedySaved['sound'] = { muted: false, volume: 0.35 };
  configure(settings: ComedySaved['sound']) {
    this.settings = settings;
    if (this.gain) this.gain.gain.value = settings.muted ? 0 : settings.volume;
    if (settings.muted) this.clear();
  }
  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
        this.configure(this.settings);
      }
      void this.context.resume();
    } catch {
      /* Visual gags also work without browser audio. */
    }
  }
  play(sound: ComedyEffect['sound'], delayMs: number) {
    if (!sound || this.settings.muted || this.settings.volume === 0) return;
    this.unlock();
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const at = ctx.currentTime + Math.max(0, delayMs) / 1000;
    const tone = (
      from: number,
      to: number,
      offset: number,
      duration: number,
      type: OscillatorType,
      volume = 0.15,
    ) => {
      const oscillator = ctx.createOscillator(),
        envelope = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, at + offset);
      oscillator.frequency.exponentialRampToValueAtTime(to, at + offset + duration);
      envelope.gain.setValueAtTime(0.001, at + offset);
      envelope.gain.exponentialRampToValueAtTime(volume, at + offset + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + offset + duration);
      oscillator.connect(envelope);
      envelope.connect(this.gain!);
      this.nodes.add(oscillator);
      oscillator.onended = () => {
        this.nodes.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(at + offset);
      oscillator.stop(at + offset + duration);
    };
    if (sound === 'bonk') {
      tone(180, 65, 0, 0.18, 'sine', 0.3);
      tone(720, 240, 0.04, 0.23, 'triangle');
    } else if (sound === 'poof') {
      tone(110, 45, 0, 0.25, 'triangle', 0.25);
      tone(700, 150, 0.03, 0.16, 'sawtooth', 0.035);
    } else if (sound === 'stars')
      [660, 830, 990].forEach((f, i) => tone(f, f * 1.08, i * 0.09, 0.14, 'sine', 0.09));
    else if (sound === 'hat') {
      tone(180, 540, 0, 0.12, 'triangle');
      tone(540, 250, 0.12, 0.2, 'sine');
    } else if (sound === 'cloud') tone(780, 160, 0, 0.6, 'sine', 0.1);
    else {
      tone(120, 50, 0, 0.2, 'sine', 0.3);
      tone(400, 95, 0.12, 0.14, 'triangle', 0.08);
    }
  }
  clear() {
    for (const node of this.nodes) node.stop();
    this.nodes.clear();
  }
  close() {
    this.clear();
    void this.context?.close();
  }
}
