import type { Page, CDPSession } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
interface AudioTake {
  base64: string;
  speechBase64: string;
  effectsBase64: string;
  mediaPlays: { at: number; duration: number }[];
  clockSeconds: number;
  wallSeconds: number;
  clockSamples: { wall: number; audio: number }[];
  starts: { at: number; delayMs: number }[];
  impacts: { at: number; targetAt: number }[];
}
declare global {
  interface Window {
    rehearsalAudio: { start(): Promise<number>; stop(): Promise<AudioTake> };
  }
}
export async function prepareRehearsalAudio(page: Page) {
  await page.addInitScript(() => {
    const mix = new AudioContext(),
      destination = mix.createMediaStreamDestination(),
      speechDestination = mix.createMediaStreamDestination(),
      effectsDestination = mix.createMediaStreamDestination(),
      media = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>(),
      taps = new WeakMap<BaseAudioContext, MediaStreamAudioDestinationNode>();
    const starts: AudioTake['starts'] = [],
      mediaPlays: AudioTake['mediaPlays'] = [],
      impacts: AudioTake['impacts'] = [],
      connect = AudioNode.prototype.connect;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLImageElement) || !node.matches('.comedy-impact')) continue;
          void node.decode().then(() =>
            requestAnimationFrame(() => {
              if (node.isConnected)
                impacts.push({ at: Date.now(), targetAt: Number(node.dataset.impactAt) });
            }),
          );
        }
    }).observe(document, { childList: true, subtree: true });
    AudioNode.prototype.connect = new Proxy(connect, {
      apply(original, receiver: AudioNode, args) {
        const result = Reflect.apply(original, receiver, args);
        if (args[0] instanceof AudioDestinationNode && receiver.context !== mix) {
          let tap = taps.get(receiver.context);
          if (!tap) {
            tap = (receiver.context as AudioContext).createMediaStreamDestination();
            taps.set(receiver.context, tap);
            Reflect.apply(connect, mix.createMediaStreamSource(tap.stream), [destination]);
            Reflect.apply(connect, mix.createMediaStreamSource(tap.stream), [effectsDestination]);
          }
          Reflect.apply(connect, receiver, [tap]);
        }
        return result;
      },
    });
    HTMLMediaElement.prototype.play = new Proxy(HTMLMediaElement.prototype.play, {
      apply(original, receiver: HTMLMediaElement, args) {
        if (receiver instanceof HTMLAudioElement && !media.has(receiver)) {
          const source = mix.createMediaElementSource(receiver);
          media.set(receiver, source);
          source.connect(mix.destination);
          source.connect(destination);
          source.connect(speechDestination);
        }
        return (Reflect.apply(original, receiver, args) as Promise<void>).then(() => {
          if (receiver instanceof HTMLAudioElement)
            mediaPlays.push({ at: Date.now(), duration: receiver.duration });
        });
      },
    });
    OscillatorNode.prototype.start = new Proxy(OscillatorNode.prototype.start, {
      apply(original, receiver: OscillatorNode, args) {
        starts.push({
          at: Date.now(),
          delayMs: Math.max(
            0,
            ((args[0] ?? receiver.context.currentTime) - receiver.context.currentTime) * 1000,
          ),
        });
        return Reflect.apply(original, receiver, args);
      },
    });
    const takes = [destination, speechDestination, effectsDestination].map((node) => ({
      recorder: new MediaRecorder(node.stream, { mimeType: 'audio/webm;codecs=opus' }),
      chunks: [] as Blob[],
    }));
    let clockStart = 0,
      wallStart = 0,
      clockTimer: ReturnType<typeof setInterval>;
    const clockSamples: AudioTake['clockSamples'] = [];
    window.rehearsalAudio = {
      async start() {
        await mix.resume();
        const silence = mix.createConstantSource();
        silence.offset.value = 0;
        silence.connect(mix.destination);
        silence.start();
        clockStart = mix.currentTime;
        wallStart = performance.now();
        clockTimer = setInterval(
          () =>
            clockSamples.push({
              wall: (performance.now() - wallStart) / 1000,
              audio: mix.currentTime - clockStart,
            }),
          1000,
        );
        for (const take of takes) {
          take.recorder.ondataavailable = (e) => {
            if (e.data.size) take.chunks.push(e.data);
          };
          take.recorder.start(100);
        }
        return Date.now();
      },
      async stop() {
        clearInterval(clockTimer);
        await Promise.all(
          takes.map(
            (take) =>
              new Promise<void>((resolve) => {
                take.recorder.onstop = () => resolve();
                take.recorder.stop();
              }),
          ),
        );
        const [base64, speechBase64, effectsBase64] = await Promise.all(
          takes.map(async (take) => {
            const bytes = new Uint8Array(await new Blob(take.chunks).arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 16384)
              binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
            return btoa(binary);
          }),
        );
        return {
          base64,
          speechBase64,
          effectsBase64,
          mediaPlays,
          starts,
          impacts,
          clockSeconds: mix.currentTime - clockStart,
          wallSeconds: (performance.now() - wallStart) / 1000,
          clockSamples,
        };
      },
    };
  });
}
export async function startRehearsal(page: Page, output: string) {
  await mkdir(join(output, 'frames'), { recursive: true });
  const client: CDPSession = await page.context().newCDPSession(page);
  const frames: { filename: string; timestamp: number }[] = [],
    writes: Promise<void>[] = [];
  client.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
    const filename = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({
      filename,
      timestamp: performance.now(),
    });
    writes.push(writeFile(join(output, 'frames', filename), Buffer.from(event.data, 'base64')));
    void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  const beforeAudioStart = performance.now();
  await page.evaluate(() => window.rehearsalAudio.start());
  const audioStart = (beforeAudioStart + performance.now()) / 2;
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });
  return async () => {
    await client.send('Page.stopScreencast');
    await Promise.all(writes);
    const audio = await page.evaluate(() => window.rehearsalAudio.stop());
    await writeFile(join(output, 'effects-audio.webm'), Buffer.from(audio.base64, 'base64'));
    await writeFile(join(output, 'speech-only.webm'), Buffer.from(audio.speechBase64, 'base64'));
    await writeFile(join(output, 'effects-only.webm'), Buffer.from(audio.effectsBase64, 'base64'));
    const concat = ['ffconcat version 1.0'];
    frames.forEach((frame, i) => {
      concat.push(
        `file 'frames/${frame.filename}'`,
        `duration ${Math.max(0.01, ((frames[i + 1]?.timestamp ?? frame.timestamp + 67) - frame.timestamp) / 1000).toFixed(6)}`,
      );
    });
    concat.push(`file 'frames/${frames.at(-1)!.filename}'`);
    await writeFile(join(output, 'frames.ffconcat'), concat.join('\n'));
    return {
      frames: frames.length,
      audioTrim: Math.max(0, (frames[0].timestamp - audioStart) / 1000),
      audioStarts: audio.starts,
      mediaPlays: audio.mediaPlays,
      clockSeconds: audio.clockSeconds,
      wallSeconds: audio.wallSeconds,
      clockSamples: audio.clockSamples,
      impactFrames: audio.impacts,
    };
  };
}
