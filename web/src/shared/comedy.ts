import { z } from 'zod';
import source from '../../public/comedy/manifest.json';
const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export const calibrationSchema = z
  .object({
    crown: pointSchema,
    headWidth: z.number().min(0.08).max(0.7),
    contact: pointSchema,
  })
  .strict();
export const defaultCalibration = {
  crown: { x: 0.5, y: 0.42 },
  headWidth: 0.23,
  contact: { x: 0.57, y: 0.43 },
};
const assetSchema = z.string().regex(/^\/comedy\/[a-z0-9-]+\.png$/);
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
    asset: assetSchema,
    dimensions: z.object({ w: z.number().positive(), h: z.number().positive() }).strict(),
    anchor: pointSchema,
    target: z.enum(['camera', 'crown', 'contact']),
    sizeBasis: z.enum(['camera', 'head']),
    targetOffset: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }).strict(),
    impact: z
      .object({
        asset: assetSchema,
        anchor: pointSchema,
        dimensions: z.object({ w: z.number().positive(), h: z.number().positive() }).strict(),
        atMs: z.number().min(100).max(1000),
        durationMs: z.number().min(100).max(500),
        widthRatio: z.number().min(0.1).max(2),
      })
      .strict()
      .optional(),
    kind: z.enum(['transient', 'prop']),
    durationMs: z.number().int().min(0).max(10000),
    animation: z.enum(['puff', 'swing', 'orbit', 'settle', 'drizzle', 'stamp']),
    sound: z.enum(['poof', 'bonk', 'stars', 'hat', 'cloud', 'stamp']).optional(),
    soundAtMs: z.number().int().min(0).max(1000),
    cooldownMs: z.number().int().min(500).max(60000),
    large: z.boolean(),
    widthRatio: z.number().min(0.1).max(3),
    placement: placementSchema,
  })
  .strict()
  .refine(
    (e) => (e.kind === 'prop' ? e.durationMs === 0 : e.durationMs >= 500),
    'Invalid effect duration',
  )
  .refine((e) => !e.impact || e.soundAtMs === e.impact.atMs, 'Impact sound must match contact time')
  .refine(
    (e) =>
      !e.impact || (e.impact.atMs >= 300 && e.impact.atMs + e.impact.durationMs < e.durationMs),
    'Impact must fit inside the animation deadline',
  );
export const manifestSchema = z
  .object({
    version: z.literal(1),
    name: z.string(),
    effects: z.array(effectSchema).min(1).max(30),
    sequences: z
      .array(
        z
          .object({
            id: z.string().max(40),
            label: z.string().max(40),
            cooldownMs: z.number().min(1000).max(30000),
            steps: z
              .array(
                z
                  .object({ effectId: z.string().max(40), atMs: z.number().min(0).max(10000) })
                  .strict(),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .refine(
    (p) => new Set(p.effects.map((e) => e.id)).size === p.effects.length,
    'Duplicate effect ID',
  )
  .refine(
    (p) =>
      p.sequences.every(
        (s) =>
          s.steps[0].atMs === 0 &&
          s.steps.every(
            (step, i) =>
              (i === 0 || step.atMs > s.steps[i - 1].atMs) &&
              p.effects.some((e) => e.id === step.effectId && e.kind === 'transient'),
          ),
      ),
    'Invalid sequence steps',
  )
  .refine(
    (p) =>
      p.sequences.every((s) =>
        s.steps.every((step) => {
          const overlapping = s.steps.filter(
            (other) =>
              other.atMs <= step.atMs &&
              other.atMs + (p.effects.find((e) => e.id === other.effectId)?.durationMs ?? 0) >
                step.atMs,
          );
          return (
            overlapping.length <= 2 &&
            overlapping.filter((other) => p.effects.find((e) => e.id === other.effectId)?.large)
              .length <= 1
          );
        }),
      ),
    'Sequence exceeds overlap limit',
  );
export const comedyPack = manifestSchema.parse(source);
export const comedyCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('calibrate'), calibration: calibrationSchema }).strict(),
  z.object({ action: z.literal('sequence'), sequenceId: z.string().max(40) }).strict(),
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
    sequenceId: z.string().uuid().optional(),
  })
  .strict();
export const comedySavedSchema = z
  .object({
    anchorVersion: z.literal(2).default(2),
    calibrated: z.boolean().default(false),
    calibration: calibrationSchema.default(defaultCalibration),
    props: z.array(instanceSchema).max(4),
    placements: z.record(z.string(), placementSchema),
    sound: soundSettingsSchema,
  })
  .strict();
export type ComedyCommand = z.infer<typeof comedyCommandSchema>;
export type ComedyEffect = z.infer<typeof effectSchema>;
export type Calibration = z.infer<typeof calibrationSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type EffectInstance = z.infer<typeof instanceSchema>;
export type ComedySaved = z.infer<typeof comedySavedSchema>;
export interface ComedySnapshot extends ComedySaved {
  serverNow: number;
  epoch: string;
  cooldowns: Record<string, number>;
  sequence: { id: string; label: string; startedAt: number; endsAt: number } | null;
}
export interface ComedyEvent {
  type: 'comedy_trigger';
  epoch: string;
  instance: EffectInstance;
}
export const emptyComedy = (): ComedySaved => ({
  anchorVersion: 2,
  calibrated: false,
  calibration: structuredClone(defaultCalibration),
  props: [],
  placements: {},
  sound: { muted: false, volume: 0.35 },
});
