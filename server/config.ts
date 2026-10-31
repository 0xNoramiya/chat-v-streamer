import 'dotenv/config';
import { z } from 'zod';
import type { Settings } from '../web/src/shared/types.js';
const bool = z.preprocess(
  (v) => (v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().default(true),
);
export const config = z
  .object({
    PORT: z.coerce.number().default(8787),
    // Loopback by default: this is a local-first app and the panel has no authentication.
    // Only set HOST=0.0.0.0 for a deliberately public demo with no credentials configured.
    HOST: z.string().default('127.0.0.1'),
    DRY_RUN: bool,
    SIM_MODE: bool,
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_MODEL_FAST: z.string().default('gpt-5-mini'),
    OPENAI_MODEL_SMART: z.string().default('gpt-5'),
    OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-transcribe'),
    OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
    TTS_VOICE_JUDGE: z.string().default('onyx'),
    TTS_VOICE_DA: z.string().default('ash'),
    TRANSCRIBE_LANGUAGE: z.string().default('en'),
    TWITCH_CLIENT_ID: z.string().default(''),
    TWITCH_CLIENT_SECRET: z.string().default(''),
    TWITCH_REDIRECT_URI: z.string().default('http://localhost:8787/auth/callback'),
    TWITCH_CHANNEL_LOGIN: z.string().default(''),
    OBS_WS_URL: z.string().default('ws://127.0.0.1:4455'),
    OBS_WS_PASSWORD: z.string().default(''),
    OBS_COURT_SCENE: z.string().default('Courtroom'),
    OBS_SCREENSHOT_SOURCE: z.string().default(''),
    FRAME_INTERVAL_MS: z.coerce.number().min(1000).default(10000),
    CHUNK_MS: z.coerce.number().min(1000).max(30000).default(6000),
  })
  .parse(process.env);
const phaseSchema = z.object({
  CALL_TO_ORDER: z.number().min(500).max(30000),
  EXHIBITS: z.number().min(500).max(20000),
  DEFENSE: z.number().min(500).max(60000),
  REBUTTAL: z.number().min(500).max(20000),
  JURY: z.number().min(500).max(60000),
  VERDICT: z.number().min(500).max(15000),
  SENTENCING: z.number().min(500).max(20000),
  ADJOURN: z.number().min(500).max(10000),
});
export const settingsSchema = z
  .object({
    courtOn: z.boolean(),
    autoApprove: z.boolean(),
    streamerName: z
      .string()
      .min(1)
      .max(30)
      .regex(/^[\p{L}\p{N}_ ]+$/u),
    cosignWindowMs: z.number().min(1000).max(180000),
    cosignRatio: z.number().min(0).max(1),
    minCosigners: z.number().int().min(1).max(50),
    maxCosigners: z.number().int().min(1).max(50),
    sueCooldownMs: z.number().min(0).max(3600000),
    betweenTrialsMs: z.number().min(0).max(600000),
    maxOpenCases: z.number().int().min(1).max(20),
    objectionThreshold: z.number().int().min(1).max(100),
    contempt: z.boolean(),
    polls: z.boolean(),
    channelPoints: z.boolean(),
    tts: z.boolean(),
    clipOnGuilty: z.boolean(),
    markerOnGuilty: z.boolean(),
    phaseMs: phaseSchema,
    penalCode: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_]+$/),
          type: z.enum(['title', 'manual']),
          severity: z.number().int().min(1).max(3),
          text: z.string().min(1).max(200),
          duration_ms: z.number().min(1000).max(3600000),
          approved: z.boolean(),
        }),
      )
      .max(30),
    webcam: z.object({
      x: z.number().min(0).max(1920),
      y: z.number().min(0).max(1080),
      w: z.number().min(100).max(1920),
      h: z.number().min(100).max(1080),
    }),
    obsCourtScene: z.string().max(100),
    obsScreenshotSource: z.string().max(100),
  })
  .refine(
    (s) =>
      Object.entries(s.phaseMs).reduce(
        (total, [phase, ms]) => total + ms * (phase === 'EXHIBITS' ? 3 : 1),
        0,
      ) <= 180000,
    'A trial must fit within three minutes',
  )
  .refine((s) => s.minCosigners <= s.maxCosigners, 'Minimum co-signers must not exceed maximum')
  .refine(
    (s) => new Set(s.penalCode.map((p) => p.id)).size === s.penalCode.length,
    'Sentence IDs must be unique',
  );
export const defaults: Settings = {
  courtOn: true,
  autoApprove: true,
  streamerName: config.TWITCH_CHANNEL_LOGIN || 'Noramiya',
  cosignWindowMs: 60000,
  cosignRatio: 0.05,
  minCosigners: 2,
  maxCosigners: 8,
  sueCooldownMs: 120000,
  betweenTrialsMs: 120000,
  maxOpenCases: 5,
  objectionThreshold: 5,
  contempt: true,
  polls: false,
  channelPoints: false,
  tts: true,
  clipOnGuilty: true,
  markerOnGuilty: true,
  phaseMs: {
    CALL_TO_ORDER: 7000,
    EXHIBITS: 8000,
    DEFENSE: 30000,
    REBUTTAL: 10000,
    JURY: 20000,
    VERDICT: 8000,
    SENTENCING: 8000,
    ADJOURN: 3000,
  },
  penalCode: [
    {
      id: 'title_shame',
      type: 'title',
      severity: 1,
      text: 'Wear a convicted stream title for 15 minutes',
      duration_ms: 900000,
      approved: true,
    },
    ...(
      [
        ['pushups_10', 1, '10 push-ups on camera', 60000],
        ['hydrate', 1, 'Drink a full glass of water on camera', 30000],
        ['no_excuses', 1, 'No excuses for 10 minutes. Each excuse costs 5 push-ups', 600000],
        ['nature_doc', 2, 'Narrate gameplay like a nature documentary for 3 minutes', 180000],
        ['inverted_5', 2, 'Play with inverted camera for 5 minutes', 300000],
        ['chat_loadout', 3, 'Chat picks your next loadout or character', 180000],
      ] as const
    ).map(([id, severity, text, duration_ms]) => ({
      id,
      type: 'manual' as const,
      severity,
      text,
      duration_ms,
      approved: false,
    })),
  ],
  webcam: { x: 1180, y: 400, w: 600, h: 450 },
  obsCourtScene: config.OBS_COURT_SCENE,
  obsScreenshotSource: config.OBS_SCREENSHOT_SOURCE,
};
