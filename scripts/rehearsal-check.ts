import { strict as assert } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { prepareRehearsalAudio, startRehearsal } from './rehearsal-media.js';
import { setHead } from './calibration-check.js';
import type { Snapshot } from '../web/src/shared/types.js';
const run = promisify(execFile),
  root = resolve('.'),
  fixture = resolve(process.argv[2] ?? 'artifacts/streamer-rehearsal/streamer.mp4'),
  output = resolve('artifacts/m9-rehearsal');
assert.ok(
  existsSync(fixture),
  'Pass a local generated streamer MP4 to rehearsal:check; it is never required by production.',
);
await mkdir(output, { recursive: true });
// Fixture-only reframe: simulate zooming out an OBS camera source, without tracking a face.
await run('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-i',
  fixture,
  '-vf',
  'scale=384:288,pad=600:450:108:132:color=0x243b38',
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  join(output, 'reframed-streamer.mp4'),
]);
await run('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-i',
  fixture,
  '-vf',
  'scale=384:288,pad=600:450:48:132:color=0x243b38',
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  join(output, 'shifted-streamer.mp4'),
]);
const temporary = await mkdtemp(join(tmpdir(), 'court-m9-'));
await mkdir(join(temporary, 'web'));
await mkdir(join(temporary, 'data/frames'), { recursive: true });
await symlink(join(root, 'web/dist'), join(temporary, 'web/dist'));
await symlink(fixture, join(temporary, 'data/frames/tight.mp4'));
await symlink(join(output, 'reframed-streamer.mp4'), join(temporary, 'data/frames/reframed.mp4'));
await symlink(join(output, 'shifted-streamer.mp4'), join(temporary, 'data/frames/shifted.mp4'));
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
const address = reservation.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((r) => reservation.close(() => r()));
const server = spawn(
  process.execPath,
  [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'server/index.ts')],
  {
    cwd: temporary,
    env: {
      ...process.env,
      PORT: String(port),
      SIM_MODE: 'true',
      DRY_RUN: 'true',
      OPENAI_API_KEY: '',
      TWITCH_CLIENT_ID: '',
      TWITCH_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let logs = '';
server.stdout.on('data', (b) => {
  logs += b;
});
server.stderr.on('data', (b) => {
  logs += b;
});
const base = `http://127.0.0.1:${port}`,
  get = async () => (await (await fetch(base + '/api/state')).json()) as Snapshot;
const post = async (path: string, body: unknown = {}) => {
  const response = await fetch(base + '/api/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, await response.text());
};
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/state')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const initial = await get();
  await post('settings', { ...initial.settings, betweenTrialsMs: 0 });
  const panel = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
    overlay = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: 'no-preference',
    }),
    errors: string[] = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  overlay.on('pageerror', (e) => errors.push(e.message));
  await prepareRehearsalAudio(overlay);
  await Promise.all([panel.goto(base + '/panel'), overlay.goto(base + '/overlay')]);
  await panel.getByRole('heading', { name: 'The court is yours.' }).waitFor();
  await overlay.locator('.docket-ticker').waitFor();
  const camera = initial.settings.webcam;
  await overlay.evaluate(async (camera) => {
    const background = document.createElement('div');
    background.id = 'fixture-background';
    Object.assign(background.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '-2',
      background: '#172d2b',
    });
    const video = document.createElement('video');
    video.id = 'fixture-streamer';
    video.src = '/frames/tight.mp4';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    Object.assign(video.style, {
      position: 'absolute',
      left: camera.x + 'px',
      top: camera.y + 'px',
      width: camera.w + 'px',
      height: camera.h + 'px',
      objectFit: 'fill',
    });
    background.append(video);
    document.body.prepend(background);
    await video.play();
  }, camera);
  await overlay.getByRole('button', { name: 'Enable audio' }).click();
  const finish = await startRehearsal(overlay, output),
    desk = panel.getByRole('region', { name: 'Comedy desk' });
  await panel.getByRole('button', { name: 'Run full demo trial →' }).first().click();
  await overlay.locator('.courtroom').waitFor();
  await panel.getByRole('button', { name: 'Skip phase →', exact: true }).click();
  await panel.locator('.head-calibration summary').click();
  await panel.getByLabel('Preview photo or video').setInputFiles(fixture);
  await setHead(panel, {
    crown: { x: 0.5, y: 0.02 },
    headWidth: 0.25,
    contact: { x: 0.52, y: 0.04 },
  });
  assert.ok(
    await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).isDisabled(),
  );
  await panel.screenshot({ path: join(output, '01-tight-framing-guidance.png'), fullPage: true });
  await overlay.waitForTimeout(700);
  await overlay.evaluate(async () => {
    const video = document.getElementById('fixture-streamer') as HTMLVideoElement;
    video.src = '/frames/reframed.mp4';
    await video.play();
  });
  await panel
    .getByLabel('Preview photo or video')
    .setInputFiles(join(output, 'reframed-streamer.mp4'));
  await setHead(panel, {
    crown: { x: 0.5, y: 0.3 },
    headWidth: 0.17,
    contact: { x: 0.52, y: 0.32 },
  });
  await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).click();
  await overlay.waitForTimeout(850);
  await overlay.screenshot({ path: join(output, '02-hat-crown.png') });
  await overlay.waitForTimeout(2200);
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  const events: { label: string; at: number }[] = [];
  await desk.getByRole('button', { name: 'BONK → stars', exact: true }).click();
  events.push({ label: 'sequence click', at: Date.now() });
  await overlay.locator('[data-effect="bonk"]').waitFor();
  assert.equal(await overlay.locator('.comedy-impact').count(), 0);
  await overlay.waitForTimeout(250);
  await overlay.screenshot({ path: join(output, '03-anticipation.png') });
  await overlay.locator('.comedy-impact').waitFor();
  events.push({ label: 'visible impact', at: Date.now() });
  await overlay.screenshot({ path: join(output, '04-contact-burst.png') });
  await overlay.locator('[data-effect="seeing_stars"]').waitFor();
  await overlay.waitForTimeout(400);
  await overlay.screenshot({ path: join(output, '05-stars-upper-head.png') });
  await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
  await overlay.waitForTimeout(350);
  const alternateCamera = { x: 80, y: 300, w: 720, h: 540 };
  const reframe = async (rect: typeof camera, source: string) => {
    await panel
      .locator('nav')
      .getByRole('button', { name: /Settings/ })
      .click();
    for (const [key, value] of Object.entries(rect))
      await panel.getByLabel(`Camera ${key}`, { exact: true }).fill(String(value));
    await panel.getByRole('button', { name: 'Validate and save court rules' }).click();
    await panel.waitForFunction(async (expected) => {
      const settings = (await (await fetch('/api/state')).json()).settings;
      return settings.webcam.x === expected.x && settings.webcam.w === expected.w;
    }, rect);
    await panel.locator('nav').getByRole('button', { name: /Court/ }).first().click();
    await overlay.evaluate(
      async ({ rect, source }) => {
        const video = document.getElementById('fixture-streamer') as HTMLVideoElement;
        Object.assign(video.style, {
          left: rect.x + 'px',
          top: rect.y + 'px',
          width: rect.w + 'px',
          height: rect.h + 'px',
        });
        video.src = source;
        await video.play();
      },
      { rect, source },
    );
  };
  await reframe(alternateCamera, '/frames/shifted.mp4');
  await panel.locator('.head-calibration summary').click();
  await panel
    .getByLabel('Preview photo or video')
    .setInputFiles(join(output, 'shifted-streamer.mp4'));
  await setHead(panel, {
    crown: { x: 0.4, y: 0.3 },
    headWidth: 0.17,
    contact: { x: 0.42, y: 0.32 },
  });
  await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).click();
  await overlay.waitForTimeout(800);
  await overlay.screenshot({ path: join(output, '06-alternate-head-and-camera.png') });
  await panel.reload();
  await panel.getByRole('heading', { name: 'The court is yours.' }).waitFor();
  assert.ok(Math.abs((await get()).comedy.calibration.crown.x - 0.4) < 0.01);
  await overlay.waitForTimeout(600);
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await reframe(camera, '/frames/reframed.mp4');
  await setHead(panel, {
    crown: { x: 0.5, y: 0.3 },
    headWidth: 0.17,
    contact: { x: 0.52, y: 0.32 },
  });
  // Actual panel interruption before the next scheduled stars step.
  await desk.getByRole('button', { name: 'BONK → stars', exact: true }).click();
  await overlay.waitForTimeout(300);
  await panel.getByRole('button', { name: 'Declare mistrial', exact: true }).click();
  await overlay.waitForTimeout(1500);
  assert.equal(await overlay.locator('.comedy-layer').count(), 0);
  await overlay.evaluate(() => {
    document.getElementById('fixture-background')!.style.visibility = 'hidden';
  });
  const png = await overlay.screenshot({
    path: join(output, '07-clean-alpha.png'),
    omitBackground: true,
  });
  const opaque = await overlay.evaluate(
    async ({ png, camera }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(camera.x, camera.y, camera.w, camera.h).data;
      let count = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
      return count;
    },
    { png: png.toString('base64'), camera },
  );
  assert.equal(opaque, 0);
  await overlay.evaluate(() => {
    document.getElementById('fixture-background')!.style.visibility = 'visible';
  });
  const recording = await finish();
  const impactFrame = recording.impactFrames[0];
  assert.ok(impactFrame, 'The overlay must render a measured impact frame');
  const impactSound = recording.audioStarts.find(
    (s) => s.at >= impactFrame.targetAt - 30 && Math.abs(s.at + s.delayMs - impactFrame.at) < 100,
  );
  assert.ok(impactSound, 'The bonk must have a captured sound scheduled at impact');
  const impactSoundOffsetMs = Math.round(impactFrame.at - impactSound.at - impactSound.delayMs);
  assert.ok(
    Math.abs(impactSoundOffsetMs) < 100,
    'Visible contact and audio must align within a recorded frame',
  );
  assert.ok(recording.audioStarts.length > 5);
  assert.deepEqual(errors, []);
  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(output, 'frames.ffconcat'),
    '-ss',
    String(recording.audioTrim),
    '-i',
    join(output, 'effects-audio.webm'),
    '-vf',
    'fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    join(output, 'after.mp4'),
  ]);
  const before = resolve('artifacts/streamer-rehearsal/rehearsal.mp4');
  if (existsSync(before))
    await run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      before,
      '-i',
      join(output, 'after.mp4'),
      '-filter_complex',
      "[0:v]drawtext=text='BEFORE M8':x=40:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=0x172d2b[v0];[1:v]drawtext=text='AFTER M9 - MANUAL CALIBRATION':x=40:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=0x172d2b[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]",
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      join(output, 'before-after.mp4'),
    ]);
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        fixture,
        syntheticCamera: true,
        simulatedTwitchAndObs: true,
        camera,
        alternateCamera,
        calibration: (await get()).comedy.calibration,
        ...recording,
        events,
        impactSoundOffsetMs,
        cleanupAlphaPixels: opaque,
        sequenceMistrialCancelsFuture: true,
        errors,
        limitations: [
          'Manual calibration; no face tracking.',
          'Reframed generated webcam loop simulates an OBS source zoom-out.',
          'No physical webcam/mic or authenticated Twitch/OpenAI/OBS session.',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, output, frames: recording.frames, cleanupAlphaPixels: opaque }),
  );
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await new Promise<void>((r) => (server.exitCode !== null ? r() : server.once('exit', () => r())));
  await rm(temporary, { recursive: true, force: true });
  await writeFile(join(output, 'server.log'), logs);
}
