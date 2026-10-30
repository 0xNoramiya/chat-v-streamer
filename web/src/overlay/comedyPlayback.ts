import {
  comedyPack,
  instanceSchema,
  type ComedyEvent,
  type ComedySnapshot,
  type EffectInstance,
} from '../shared/comedy';
import { ComedySounds } from './comedySounds';
export class ComedyPlayback {
  private epoch = '';
  private offset = 0;
  private seen = new Set<string>();
  private active = new Map<string, EffectInstance>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly sounds = new ComedySounds();
  constructor(private show: (instances: EffectInstance[]) => void) {}
  sync(snapshot: ComedySnapshot) {
    this.offset = snapshot.serverNow - Date.now();
    if (snapshot.epoch !== this.epoch) {
      this.clear();
      this.epoch = snapshot.epoch;
    }
    this.sounds.configure(snapshot.sound);
  }
  get serverNow() {
    return Date.now() + this.offset;
  }
  accept(event: ComedyEvent) {
    const result = instanceSchema.safeParse(event.instance);
    if (!result.success || event.epoch !== this.epoch) return;
    const instance = result.data,
      effect = comedyPack.effects.find((e) => e.id === instance.effectId),
      now = this.serverNow;
    if (
      !effect ||
      this.seen.has(instance.id) ||
      instance.startedAt > now + 250 ||
      (effect.kind === 'transient' &&
        (instance.expiresAt !== instance.startedAt + effect.durationMs ||
          instance.expiresAt <= now)) ||
      (effect.kind === 'prop' && instance.expiresAt !== null)
    )
      return;
    this.seen.add(instance.id);
    if (this.seen.size > 100) this.seen.delete(this.seen.values().next().value!);
    if (effect.kind === 'transient') {
      if (this.active.size >= 2) return;
      this.active.set(instance.id, instance);
      this.timers.set(
        instance.id,
        setTimeout(() => {
          this.active.delete(instance.id);
          this.timers.delete(instance.id);
          this.publish();
        }, instance.expiresAt! - now),
      );
      this.publish();
    }
    const soundDelay = instance.startedAt + effect.soundAtMs - now;
    if (soundDelay > -200) this.sounds.play(effect.sound, soundDelay);
  }
  private publish() {
    this.show([...this.active.values()]);
  }
  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.active.clear();
    this.sounds.clear();
    this.publish();
  }
  close() {
    this.clear();
    this.sounds.close();
  }
}
