import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, symlink, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import type { Snapshot, Phase } from '../web/src/shared/types.js';
import { appReadiness } from './connected-readiness.js';
import { startOpenAIFixture } from './openai-fixture.js';
import { prepareRehearsalAudio, startRehearsal } from './rehearsal-media.js';
import { setHead } from './calibration-check.js';
const fixtureMode = process.argv.includes('--fixture'),
  root = resolve('.'),
  output = resolve('artifacts/m10-connected', fixtureMode ? 'local-fixture' : 'real-openai'),
  run = promisify(execFile);
await mkdir(output, { recursive: true });
if (!fixtureMode && !process.env.OPENAI_API_KEY?.trim()) {
  const report = {
    status: 'blocked',
    realOpenAI: false,
    reason: 'OPENAI_API_KEY is absent. Configure it in local .env, never in chat.',
    sim: true,
    dryRun: true,
    realTwitch: false,
    realObs: false,
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} else {
  const temporary = await mkdtemp(join(tmpdir(), 'court-m10-'));
  await mkdir(join(temporary, 'web'));
  await mkdir(join(temporary, 'data/frames'), { recursive: true });
  await symlink(join(root, 'web/dist'), join(temporary, 'web/dist'));
  const fixture = fixtureMode ? await startOpenAIFixture(temporary) : undefined;
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((done) => reservation.close(() => done()));
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
        OPENAI_API_KEY: fixtureMode ? 'local-fixture-only' : process.env.OPENAI_API_KEY,
        OPENAI_BASE_URL: fixture?.baseURL ?? 'https://api.openai.com/v1',
        TWITCH_CLIENT_ID: '',
        TWITCH_CLIENT_SECRET: '',
        TWITCH_CHANNEL_LOGIN: '',
      },
      stdio: 'ignore',
    },
  );
  const base = `http://127.0.0.1:${port}`;
  const get = async () => (await (await fetch(base + '/api/state')).json()) as Snapshot;
  const post = async (path: string, body: unknown = {}) => {
    const response = await fetch(base + '/api/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.ok(
      response.ok,
      `App action ${path} failed (${response.status}); inspect local Diagnostics.`,
    );
    return response.json();
  };
  const wait = async (check: () => Promise<boolean>, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw Error(
      'Rehearsal condition timed out; inspect the sanitized report, not provider payloads.',
    );
  };
  const results: unknown[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let failed = false;
  try {
    await wait(async () => {
      try {
        return (await fetch(base + '/api/readiness')).ok;
      } catch {
        return false;
      }
    });
    const initial = await get();
    assert.ok(initial.status.sim && initial.status.dryRun);
    await post('settings', {
      ...initial.settings,
      autoApprove: false,
      betweenTrialsMs: 0,
      sueCooldownMs: 0,
    });
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const panel = await browser.newPage({ viewport: { width: 1440, height: 1050 } }),
      overlay = await browser.newPage({ viewport: { width: 1920, height: 1080 } }),
      errors: string[] = [];
    panel.on('pageerror', () => errors.push('panel pageerror'));
    overlay.on('pageerror', () => errors.push('overlay pageerror'));
    await prepareRehearsalAudio(overlay);
    await panel.goto(base + '/panel');
    await overlay.goto(base + '/overlay');
    await overlay.getByRole('button', { name: 'Enable audio', exact: true }).click();
    await setHead(panel, {
      crown: { x: 0.5, y: 0.3 },
      headWidth: 0.17,
      contact: { x: 0.52, y: 0.32 },
    });
    const streamer = join(root, 'artifacts/streamer-rehearsal/streamer.mp4');
    await run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      streamer,
      '-vf',
      'scale=384:288,pad=600:450:108:132:color=0x243b38',
      '-an',
      join(temporary, 'data/frames/streamer.mp4'),
    ]);
    await overlay.evaluate(
      async ({ camera, fixtureMode }) => {
        const video = document.createElement('video');
        video.id = 'rehearsal-streamer';
        video.src = '/frames/streamer.mp4';
        video.muted = true;
        video.loop = true;
        Object.assign(video.style, {
          position: 'absolute',
          left: camera.x + 'px',
          top: camera.y + 'px',
          width: camera.w + 'px',
          height: camera.h + 'px',
          zIndex: '-1',
        });
        document.body.prepend(video);
        await video.play();
        const label = document.createElement('aside');
        label.textContent = fixtureMode
          ? 'LOCAL PROTOCOL FIXTURE · LOCAL SPEECH · SIMULATED TWITCH/OBS'
          : 'OPENAI REHEARSAL · AI VOICES · SIMULATED TWITCH/OBS';
        Object.assign(label.style, {
          position: 'absolute',
          left: '32px',
          top: '12px',
          zIndex: '99',
          color: 'white',
          background: '#172d2b',
          padding: '8px',
          fontSize: '18px',
        });
        document.body.append(label);
      },
      { camera: initial.settings.webcam, fixtureMode },
    );
    // Standalone recorded audio upload, not physical microphone capture.
    const known = join(temporary, 'known.wav');
    await run('espeak-ng', ['-s', '165', '-w', known, 'This boss is easy, first try guaranteed.']);
    const form = new FormData(),
      now = Date.now();
    form.set('audio', new Blob([await readFile(known)], { type: 'audio/wav' }), 'known.wav');
    // Imported recording enters this local rehearsal now; it is not a mic chunk recorded before app boot.
    form.set('started_at_ms', String(now));
    form.set('ended_at_ms', String(now));
    const upload = await fetch(base + '/api/transcribe', { method: 'POST', body: form });
    assert.ok(upload.ok, `Recorded-audio transcription failed (${upload.status})`);
    const transcript = (await upload.json()) as { text: string };
    assert.match(transcript.text, /first[ -]try/i);
    results.push({
      check: 'recorded-audio transcription',
      source: 'local espeak-ng recording, no physical mic',
      matchedKnownPhrase: true,
      provider: fixtureMode ? 'local fixture' : 'OpenAI',
    });
    for (const text of ['I never die to this guy, trust me.', 'That was the sixth attempt.'])
      await post('transcript', { text });
    const finish = await startRehearsal(overlay, output);
    for (const verdict of ['guilty', 'not_guilty', 'mistrial'] as const) {
      if (verdict === 'not_guilty') {
        const take = await finish();
        assert.ok(
          take.mediaPlays.length > 0,
          'Actual speech playback is required, captions alone do not count',
        );
        assert.ok(take.audioStarts.length > 0, 'WebAudio effects must play');
        const timeline = await readFile(join(output, 'frames.ffconcat'), 'utf8');
        const recordedSeconds = [...timeline.matchAll(/duration (.+)/g)].reduce(
          (sum, m) => sum + Number(m[1]),
          0,
        );
        const { stderr: audioProbe } = await run('ffmpeg', [
          '-hide_banner',
          '-i',
          join(output, 'effects-audio.webm'),
          '-f',
          'null',
          '-',
        ]);
        const times = [...audioProbe.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
        const last = times.at(-1);
        assert.ok(last, 'Recorded audio must have a measured duration');
        const audioSeconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
        results.push({
          check: 'capture clocks',
          videoSeconds: recordedSeconds,
          audioSeconds,
          clockSeconds: take.clockSeconds,
          wallSeconds: take.wallSeconds,
          clockSamples: take.clockSamples,
        });
        assert.ok(
          Math.abs(recordedSeconds - take.audioTrim - audioSeconds) < 1.5,
          'Capture clocks diverged; refusing a truncated or desynchronized recording. Inspect the capture clock evidence.',
        );
        for (const path of ['speech-only.webm', 'effects-only.webm']) {
          const { stderr } = await run('ffmpeg', [
            '-hide_banner',
            '-i',
            join(output, path),
            '-af',
            'volumedetect',
            '-f',
            'null',
            '-',
          ]);
          const mean = Number(stderr.match(/mean_volume: ([-\d.]+) dB/)?.[1]);
          assert.ok(
            Number.isFinite(mean) && mean > -80,
            `${path} must contain non-silent captured samples`,
          );
        }
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
          String(take.audioTrim),
          '-i',
          join(output, 'effects-audio.webm'),
          '-vf',
          'fps=30',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-shortest',
          join(output, 'trial.mp4'),
        ]);
        results.push({
          check: 'dual audio path capture',
          mediaPlays: take.mediaPlays.length,
          webAudioStarts: take.audioStarts.length,
          separateTracksNonSilent: true,
          frames: take.frames,
          videoTimelineSeconds: recordedSeconds,
          audioSeconds,
        });
      }
      await post('chat', {
        user: 'viewer1',
        text: '!sue he said first try guaranteed and died like six times',
      });
      await post('chat', { user: 'viewer2', text: '!cosign' });
      await post('chat', { user: 'viewer3', text: '!cosign' });
      const c = (await get()).cases[0];
      assert.equal(
        c.status,
        'pending_approval',
        'Successful clerk screening and evidence preparation required',
      );
      // A short queue dwell lets actual TTS warm; trial clocks never wait for it.
      await overlay.waitForTimeout(5500);
      await panel
        .locator('.case-row')
        .filter({ hasText: `#${String(c.case_no).padStart(3, '0')}` })
        .getByRole('button', { name: 'Approve', exact: true })
        .click();
      await wait(async () => !!(await get()).court.trial);
      const phases: Phase[] = [],
        started = Date.now();
      let defended = false,
        voted = false,
        gag = false;
      while ((await get()).court.trial) {
        const s = await get(),
          t = s.court.trial;
        if (!t) break;
        if (phases.at(-1) !== t.phase) {
          phases.push(t.phase);
          console.log(JSON.stringify({ scenario: verdict, phase: t.phase }));
        }
        for (const exhibit of t.exhibits) {
          assert.equal(
            exhibit.text,
            s.segments.find((x) => x.id === exhibit.segment_id)?.text,
            'Receipt text must be stored verbatim',
          );
          assert.equal(exhibit.broadcast_id, s.status.broadcastId);
        }
        if (t.phase === 'DEFENSE' && !defended) {
          defended = true;
          await post('transcript', {
            text: "Okay that was lag, the game lagged, that doesn't count.",
          });
        }
        if (t.phase === 'DEFENSE' && !gag) {
          gag = true;
          await panel.getByRole('button', { name: 'BONK → stars', exact: true }).click();
        }
        if (t.phase === 'DEFENSE' && verdict === 'mistrial') {
          await panel.getByRole('button', { name: 'Declare mistrial', exact: true }).click();
          await overlay.waitForTimeout(1700);
          assert.equal(await overlay.locator('.comedy-layer').count(), 0);
          break;
        }
        if (t.phase === 'JURY' && !voted) {
          voted = true;
          for (let i = 1; i <= 7; i++)
            await post('chat', {
              user: `viewer${i}`,
              text: verdict === 'guilty' ? (i <= 5 ? '!g' : '!ng') : i <= 2 ? '!g' : '!ng',
            });
        }
        assert.ok(Date.now() - started < 181500, 'Hard trial ceiling exceeded');
        await overlay.waitForTimeout(150);
      }
      const result = (await get()).cases.find((x) => x.id === c.id)!;
      assert.equal(result.verdict, verdict);
      if (verdict !== 'mistrial') {
        assert.equal(result.guilty_votes, verdict === 'guilty' ? 5 : 2);
        assert.equal(result.not_guilty_votes, verdict === 'guilty' ? 2 : 5);
        assert.match(result.defense_text, /lag/);
      }
      results.push({
        check: verdict,
        verdict: result.verdict,
        guiltyVotes: result.guilty_votes,
        notGuiltyVotes: result.not_guilty_votes,
        elapsedMs: Date.now() - started,
        phases,
        chatOrigin: 'simulated /api/chat, not Twitch',
      });
      if (verdict === 'guilty')
        assert.ok((await get()).logs.some((x) => x.message.includes('setTitle: [CONVICTED]')));
    }
    assert.deepEqual(errors, []);
    await panel.getByRole('button', { name: 'Clear all effects', exact: true }).click();
    await overlay.evaluate(() => {
      document.getElementById('rehearsal-streamer')!.style.visibility = 'hidden';
    });
    const png = await overlay.screenshot({
      path: join(output, 'cleanup-alpha.png'),
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
      { png: png.toString('base64'), camera: initial.settings.webcam },
    );
    assert.equal(opaque, 0);
    assert.equal(await overlay.locator('.comedy-layer').count(), 0);
    results.push({ check: 'cleanup', opaqueCameraPixels: opaque, effectsLayers: 0 });
    const ready = await appReadiness(base);
    for (const role of [
      'clerk',
      'trialScript',
      'rebuttal',
      'verdict',
      'moderation',
      'speech',
      'transcription',
    ])
      assert.ok(
        (ready.openai[role]?.success ?? 0) > 0,
        `${role} must have a successful provider response`,
      );
    assert.equal(ready.twitch, null, 'The rehearsal must never create a real Twitch auth client');
    assert.equal(
      ready.capture,
      'off',
      'Recorded uploads must not claim a physical mic is recording',
    );
    results.push({ check: 'service evidence', readiness: ready });
  } catch (error) {
    failed = true;
    results.push({
      check: 'failure',
      detail: error instanceof Error ? error.message : 'Rehearsal failed',
    });
    try {
      results.push({ check: 'failure diagnostics', readiness: await appReadiness(base) });
    } catch {
      /* An unreachable app has no provider evidence to report. */
    }
    console.error(
      'Connected rehearsal failed; see the sanitized report. No live Twitch/OBS actions were enabled.',
    );
    process.exitCode = 1;
  } finally {
    await writeFile(
      join(output, 'report.json'),
      JSON.stringify(
        {
          status: failed ? 'failed' : 'passed',
          provider: fixtureMode ? 'local protocol fixture' : 'official OpenAI',
          realOpenAI: !fixtureMode,
          physicalMic: false,
          realTwitch: false,
          realObs: false,
          sim: true,
          dryRun: true,
          results,
        },
        null,
        2,
      ),
    );
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise<void>((done) =>
      server.exitCode !== null ? done() : server.once('exit', () => done()),
    );
    await fixture?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
