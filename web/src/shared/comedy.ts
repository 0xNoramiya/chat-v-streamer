import { z } from 'zod';
import source from '../../public/comedy/manifest.json';
export const placementSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().min(0.3).max(1.5),
  })
  .strict();
export const soundSettingsSchema = z
  .object({ muted: z.boolean(), volume: z.number().min(0).max(1) })
  .strict();
export const effectSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().min(1).max(40),
    asset: z.string().regex(/^\/comedy\/[a-z0-9-]+\.png$/),
    kind: z.enum(['transient', 'prop']),
    durationMs: z.number().int().min(0).max(10000),
    animation: z.enum(['puff', 'swing', 'orbit', 'settle', 'drizzle', 'stamp']),
    sound: z.enum(['poof', 'bonk', 'stars', 'hat', 'cloud', 'stamp']).optional(),
    soundAtMs: z.number().int().min(0).max(1000),
    cooldownMs: z.number().int().min(500).max(60000),
    large: z.boolean(),
    widthRatio: z.number().min(0.1).max(0.8),
    placement: placementSchema,
  })
  .strict()
  .refine(
    (e) => (e.kind === 'prop' ? e.durationMs === 0 : e.durationMs >= 500),
    'Invalid effect duration',
  );
export const manifestSchema = z
  .object({
    version: z.literal(1),
    name: z.string(),
    effects: z.array(effectSchema).min(1).max(30),
  })
  .strict()
  .refine(
    (p) => new Set(p.effects.map((e) => e.id)).size === p.effects.length,
    'Duplicate effect ID',
  );
export const comedyPack = manifestSchema.parse(source);
export const comedyCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('trigger'), effectId: z.string().max(40) }).strict(),
  z
    .object({
      action: z.literal('place'),
      effectId: z.string().max(40),
      placement: placementSchema,
    })
    .strict(),
  z.object({ action: z.literal('remove'), effectId: z.string().max(40) }).strict(),
  z.object({ action: z.literal('clear') }).strict(),
  z.object({ action: z.literal('sound'), ...soundSettingsSchema.shape }).strict(),
]);
export const instanceSchema = z
  .object({
    id: z.string().uuid(),
    effectId: z.string().max(40),
    placement: placementSchema,
    startedAt: z.number().finite(),
    expiresAt: z.number().finite().nullable(),
  })
  .strict();
export const comedySavedSchema = z
  .object({
    props: z.array(instanceSchema).max(4),
    placements: z.record(z.string(), placementSchema),
    sound: soundSettingsSchema,
  })
  .strict();
export type ComedyCommand = z.infer<typeof comedyCommandSchema>;
export type ComedyEffect = z.infer<typeof effectSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type EffectInstance = z.infer<typeof instanceSchema>;
export type ComedySaved = z.infer<typeof comedySavedSchema>;
export interface ComedySnapshot extends ComedySaved {
  serverNow: number;
  epoch: string;
  cooldowns: Record<string, number>;
}
export interface ComedyEvent {
  type: 'comedy_trigger';
  epoch: string;
  instance: EffectInstance;
}
export const emptyComedy = (): ComedySaved => ({
  props: [],
  placements: {},
  sound: { muted: false, volume: 0.35 },
});
