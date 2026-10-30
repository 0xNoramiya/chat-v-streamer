import { randomUUID } from 'node:crypto';
import { effectGeometry } from '../../web/src/shared/comedyGeometry.js';
import type { Settings } from '../../web/src/shared/types.js';
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
  private sequence: ComedySnapshot['sequence'] = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  constructor(
    saved: unknown,
    private persist: (value: ComedySaved) => void,
    private emit: (event: ComedyEvent) => void,
    private changed: () => void,
    private options: {
      camera?: () => Settings['webcam'];
      clock?: {
        now(): number;
        setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
        clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
      };
    } = {},
  ) {
    const parsed = comedySavedSchema.safeParse(saved);
    this.saved = parsed.success ? parsed.data : emptyComedy();
    this.saved.props = this.saved.props.filter(
      (p) =>
        comedyPack.effects.some((e) => e.id === p.effectId && e.kind === 'prop') &&
        p.expiresAt === null,
    );
    if (saved && typeof saved === 'object' && !('anchorVersion' in saved)) {
      for (const effect of comedyPack.effects.filter((e) => e.target !== 'camera')) {
        delete this.saved.placements[effect.id];
        this.saved.props = this.saved.props.map((p) =>
          p.effectId === effect.id ? { ...p, placement: effect.placement } : p,
        );
      }
    }
  }
  snapshot(now: number): ComedySnapshot {
    this.active = this.active.filter((e) => e.expiresAt! > now);
    if (this.sequence && now >= this.sequence.endsAt) this.sequence = null;
    this.cooldowns = Object.fromEntries(
      Object.entries(this.cooldowns).filter(([, until]) => until > now),
    );
    return structuredClone({
      ...this.saved,
      serverNow: now,
      epoch: this.epoch,
      cooldowns: this.cooldowns,
      sequence: this.sequence,
    });
  }
  command(input: unknown, now: number) {
    const command = comedyCommandSchema.parse(input);
    this.snapshot(now);
    if (command.action === 'clear') {
      this.clear(false);
      return;
    }
    if (command.action === 'sequence') {
      this.startSequence(command.sequenceId, now);
      return;
    }
    if (command.action === 'calibrate') {
      this.saved.calibration = command.calibration;
      this.saved.calibrated = true;
    } else if (command.action === 'sound')
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
        if (effect.kind === 'transient' && this.sequence)
          throw Error('Let the BONK sequence finish or clear it first.');
        this.checkFit(effect.id);
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
  private checkFit(effectId: string) {
    const effect = comedyPack.effects.find((e) => e.id === effectId)!;
    if (effect.target === 'camera') return;
    if (!this.saved.calibrated)
      throw Error('Save head calibration before using head-anchored effects.');
    const geometry = effectGeometry(
      effect,
      this.saved.placements[effect.id] ?? effect.placement,
      this.saved.calibration,
      this.options.camera?.() ?? { x: 1180, y: 400, w: 600, h: 450 },
    );
    if (!geometry.fits) throw Error(geometry.guidance);
  }
  private schedule(fn: () => void, delay: number) {
    const timer = (this.options.clock?.setTimeout ?? setTimeout)(() => {
      this.timers.delete(timer);
      fn();
    }, delay);
    this.timers.add(timer);
  }
  private startSequence(id: string, now: number) {
    const definition = comedyPack.sequences.find((s) => s.id === id);
    if (!definition) throw Error('Unknown comedy sequence.');
    if (this.sequence || this.active.length) throw Error('Let the current gag land first.');
    if ((this.cooldowns[id] ?? 0) > now) throw Error('That sequence is cooling down.');
    for (const step of definition.steps) this.checkFit(step.effectId);
    const sequenceId = randomUUID(),
      epoch = this.epoch;
    const endsAt =
      now +
      Math.max(
        ...definition.steps.map(
          (step) => step.atMs + comedyPack.effects.find((e) => e.id === step.effectId)!.durationMs,
        ),
      );
    this.sequence = { id: sequenceId, label: definition.label, startedAt: now, endsAt };
    this.cooldowns[id] = now + definition.cooldownMs;
    this.changed();
    for (const step of definition.steps) {
      const effect = comedyPack.effects.find((e) => e.id === step.effectId)!;
      const instance: EffectInstance = {
        id: randomUUID(),
        effectId: effect.id,
        sequenceId,
        placement: this.saved.placements[effect.id] ?? effect.placement,
        startedAt: now + step.atMs,
        expiresAt: now + step.atMs + effect.durationMs,
      };
      const run = () => {
        const actualNow = this.options.clock?.now() ?? Date.now();
        if (
          this.sequence?.id !== sequenceId ||
          this.epoch !== epoch ||
          actualNow >= instance.expiresAt!
        )
          return;
        this.active = this.active.filter((e) => e.expiresAt! > actualNow);
        this.active.push(instance);
        this.emit({ type: 'comedy_trigger', epoch, instance });
      };
      if (step.atMs === 0) run();
      else this.schedule(run, step.atMs);
    }
    this.schedule(() => {
      if (this.sequence?.id === sequenceId) {
        this.sequence = null;
        this.changed();
      }
    }, endsAt - now);
  }
  close() {
    for (const timer of this.timers) (this.options.clock?.clearTimeout ?? clearTimeout)(timer);
    this.timers.clear();
    this.sequence = null;
    this.active = [];
  }
  clear(transientOnly: boolean) {
    this.close();
    this.epoch = randomUUID();
    if (!transientOnly) this.saved.props = [];
    this.persist(this.saved);
    this.changed();
  }
}
