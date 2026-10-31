import 'dotenv/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
export const readinessSchema = z.object({
  checkedAt: z.number(),
  modes: z.object({ sim: z.boolean(), dryRun: z.boolean() }),
  configurationPresent: z.record(z.string(), z.boolean()),
  connections: z.object({
    ai: z.string(),
    twitch: z.string(),
    eventsub: z.string(),
    obs: z.string(),
  }),
  capture: z.string().optional(),
  pendingRestorations: z.object({ real: z.number(), unverified: z.number() }),
  activeTrial: z.boolean(),
  docketCaseCount: z.number(),
  obs: z
    .object({
      connections: z.number(),
      disconnects: z.number(),
      sceneEntries: z.number(),
      sceneRestores: z.number(),
      screenshots: z.number(),
    })
    .nullable(),
  openaiProvider: z.enum(['none', 'official_openai', 'custom']),
  openai: z.record(
    z.string(),
    z.object({
      success: z.number(),
      failure: z.number(),
      fallback: z.number(),
      cached: z.number(),
      lastAt: z.number(),
      lastFailure: z.string().optional(),
    }),
  ),
  twitch: z
    .object({
      broadcasterTokenLoaded: z.boolean(),
      botTokenLoaded: z.boolean(),
      refreshes: z.number(),
      refreshFailures: z.number(),
      eventsubMessages: z.number(),
      observedCommands: z.object({
        filings: z.number(),
        cosigns: z.number(),
        votes: z.number(),
        controls: z.number(),
      }),
      dryRunActions: z.number(),
      liveActionAttempts: z.number(),
      stream: z.enum(['unverified', 'offline', 'live']),
    })
    .nullable(),
});
export type Readiness = z.infer<typeof readinessSchema>;
export async function appReadiness(base: string) {
  return readinessSchema.parse(
    await (await fetch(base + '/api/readiness', { signal: AbortSignal.timeout(3000) })).json(),
  );
}
export async function inspectReadiness(base = 'http://127.0.0.1:8787') {
  const configurationPresent = Object.fromEntries(
    [
      'OPENAI_API_KEY',
      'TWITCH_CLIENT_ID',
      'TWITCH_CLIENT_SECRET',
      'TWITCH_CHANNEL_LOGIN',
      'OBS_WS_PASSWORD',
    ].map((key) => [key, !!process.env[key]?.trim()]),
  );
  let tokens = { filePresent: false, validShape: false, broadcaster: false, bot: false };
  try {
    const data: unknown = JSON.parse(await readFile('data/tokens.json', 'utf8'));
    tokens.filePresent = true;
    const parsed = z
      .object({
        broadcaster: z.object({ token: z.object({ accessToken: z.string().min(1) }) }).optional(),
        bot: z.object({ token: z.object({ accessToken: z.string().min(1) }) }).optional(),
      })
      .safeParse(data);
    tokens.validShape = parsed.success;
    if (parsed.success) {
      tokens.broadcaster = !!parsed.data.broadcaster;
      tokens.bot = !!parsed.data.bot;
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      tokens.filePresent = true;
  }
  let app: Readiness | null = null;
  try {
    app = await appReadiness(base);
  } catch {
    /* An unavailable/older server is not authenticated evidence. */
  }
  let obsTcp = false;
  try {
    const url = new URL(process.env.OBS_WS_URL || 'ws://127.0.0.1:4455');
    obsTcp = await new Promise<boolean>((done) => {
      const socket = connect({
        host: url.hostname,
        port: Number(url.port || (url.protocol === 'wss:' ? 443 : 4455)),
      });
      const finish = (ok: boolean) => {
        socket.destroy();
        done(ok);
      };
      socket.setTimeout(2000);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    });
  } catch {
    /* Invalid OBS configuration remains unavailable. */
  }
  return {
    checkedAt: new Date().toISOString(),
    configurationPresent,
    tokens,
    app,
    obsTcp,
    note: 'TCP availability is not OBS authorization. Token presence is not validated authorization. This probe creates no refresh clients and performs no mutations.',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await inspectReadiness(process.argv[2]);
  await mkdir('artifacts/m10-connected', { recursive: true });
  await writeFile('artifacts/m10-connected/readiness.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
