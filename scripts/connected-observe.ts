import { mkdir, writeFile } from 'node:fs/promises';
import { appReadiness, type Readiness } from './connected-readiness.js';
const base = process.argv[2] ?? 'http://127.0.0.1:8787',
  seconds = Math.min(120, Math.max(5, Number(process.argv[3] ?? 60)));
if (!Number.isFinite(seconds)) throw Error('Observation duration must be seconds.');
const samples: Readiness[] = [];
let status = 'observed';
try {
  const end = Date.now() + seconds * 1000;
  do {
    const sample = await appReadiness(base);
    if (sample.modes.sim || !sample.modes.dryRun)
      throw Error(
        'Requires the existing connected app with SIM_MODE=false and DRY_RUN=true. No new auth client was started.',
      );
    if (sample.twitch?.liveActionAttempts)
      throw Error('Live action attempts were observed; stop rehearsal and inspect locally.');
    samples.push(sample);
    await new Promise((done) => setTimeout(done, 1000));
  } while (Date.now() < end);
} catch {
  status = 'blocked_or_interrupted';
  process.exitCode = 2;
}
const first = samples[0],
  last = samples.at(-1);
const report = {
  status,
  noMutationsPerformedByProbe: true,
  samples,
  eventsubMessageDelta:
    first?.twitch && last?.twitch
      ? Math.max(0, last.twitch.eventsubMessages - first.twitch.eventsubMessages)
      : 0,
  note: 'Only adapter-origin EventSub counters count as incoming Twitch evidence. Command counters measure receipt, not acceptance. A scene counter is an OBS acknowledgement, not proof of the physical camera layout. Counter resets require a fresh observation. No broadcast was started.',
};
await mkdir('artifacts/m10-connected', { recursive: true });
await writeFile('artifacts/m10-connected/observation.json', JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    status,
    observedSamples: samples.length,
    eventsubMessageDelta: report.eventsubMessageDelta,
  }),
);
