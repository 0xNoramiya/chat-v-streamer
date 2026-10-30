import { randomUUID } from 'node:crypto';
import {
  comedyCommandSchema,
  comedySavedSchema,
  comedyPack,
  emptyComedy,
  type ComedyEvent,
  type ComedySaved,
  type EffectInstance,
  type ComedySnapshot,
} from '../../web/src/shared/comedy.js';

export class ComedyDesk {
  private saved: ComedySaved;
  private epoch = randomUUID();
  private active: EffectInstance[] = [];
  private cooldowns: Record<string, number> = {};
  constructor(
    saved: unknown,
    private persist: (value: ComedySaved) => void,
    private emit: (event: ComedyEvent) => void,
    private changed: () => void,
  ) {
    const parsed = comedySavedSchema.safeParse(saved);
    this.saved = parsed.success ? parsed.data : emptyComedy();
    this.saved.props = this.saved.props.filter(
      (p) =>
        comedyPack.effects.some((e) => e.id === p.effectId && e.kind === 'prop') &&
        p.expiresAt === null,
    );
  }
  snapshot(now: number): ComedySnapshot {
    this.active = this.active.filter((e) => e.expiresAt! > now);
    this.cooldowns = Object.fromEntries(
      Object.entries(this.cooldowns).filter(([, until]) => until > now),
    );
    return structuredClone({
      ...this.saved,
      serverNow: now,
      epoch: this.epoch,
      cooldowns: this.cooldowns,
    });
  }
  command(input: unknown, now: number) {
    const command = comedyCommandSchema.parse(input);
    this.snapshot(now);
    if (command.action === 'clear') {
      this.clear(false);
      return;
    }
    if (command.action === 'sound')
      this.saved.sound = { muted: command.muted, volume: command.volume };
    else {
      const effect = comedyPack.effects.find((e) => e.id === command.effectId);
      if (!effect) throw Error('Unknown comedy effect.');
      if (command.action === 'remove')
        this.saved.props = this.saved.props.filter((p) => p.effectId !== effect.id);
      else if (command.action === 'place') {
        if (effect.kind !== 'prop') throw Error('Only attachable props can be positioned.');
        this.saved.placements[effect.id] = command.placement;
        this.saved.props = this.saved.props.map((p) =>
          p.effectId === effect.id ? { ...p, placement: command.placement } : p,
        );
      } else {
        if ((this.cooldowns[effect.id] ?? 0) > now) throw Error('That gag is cooling down.');
        if (
          effect.kind === 'prop' &&
          this.saved.props.length >= 4 &&
          !this.saved.props.some((p) => p.effectId === effect.id)
        )
          throw Error('Remove a prop before adding another.');
        if (
          effect.kind === 'transient' &&
          (this.active.length >= 2 ||
            (effect.large &&
              this.active.some((a) => comedyPack.effects.find((e) => e.id === a.effectId)?.large)))
        )
          throw Error('Let the current gag land first.');
        const instance: EffectInstance = {
          id: randomUUID(),
          effectId: effect.id,
          startedAt: now,
          expiresAt: effect.kind === 'prop' ? null : now + effect.durationMs,
          placement: this.saved.placements[effect.id] ?? effect.placement,
        };
        this.cooldowns[effect.id] = now + effect.cooldownMs;
        if (effect.kind === 'prop')
          this.saved.props = [
            ...this.saved.props.filter((p) => p.effectId !== effect.id),
            instance,
          ];
        else this.active.push(instance);
        this.persist(this.saved);
        this.changed();
        this.emit({ type: 'comedy_trigger', epoch: this.epoch, instance });
        return;
      }
    }
    this.persist(this.saved);
    this.changed();
  }
  clear(transientOnly: boolean) {
    this.active = [];
    this.epoch = randomUUID();
    if (!transientOnly) this.saved.props = [];
    this.persist(this.saved);
    this.changed();
  }
}
