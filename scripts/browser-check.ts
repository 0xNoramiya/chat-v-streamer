import { verifyOverlayFixtures } from './overlay-fixtures.js';
import { verifyComedy } from './comedy-check.js';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import type { Snapshot } from '../web/src/shared/types.js';
const root = resolve('.'),
  temporary = await mkdtemp(join(tmpdir(), 'court-browser-'));
await mkdir(join(temporary, 'web'));
await symlink(resolve('web/dist'), join(temporary, 'web/dist'), 'dir');
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
const address = reservation.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>((r) => reservation.close(() => r()));
const processServer = spawn(
  process.execPath,
  [resolve('node_modules/tsx/dist/cli.mjs'), resolve('server/index.ts')],
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
let output = '';
processServer.stdout.on('data', (b) => (output += b));
processServer.stderr.on('data', (b) => (output += b));
const base = `http://127.0.0.1:${port}`;
const get = async () => (await (await fetch(base + '/api/state')).json()) as Snapshot;
const post = async (path: string, body: unknown = {}) => {
  const r = await fetch(base + '/api/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
};
const waitFor = async (fn: () => Promise<boolean>, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Browser check timed out. ' + output);
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await waitFor(async () => {
    try {
      return (await fetch(base + '/api/state')).ok;
    } catch {
      return false;
    }
  });
  const original = await get();
  await post('settings', {
    ...original.settings,
    phaseMs: {
      CALL_TO_ORDER: 1200,
      EXHIBITS: 1300,
      DEFENSE: 2000,
      REBUTTAL: 1200,
      JURY: 2200,
      VERDICT: 1700,
      SENTENCING: 1700,
      ADJOURN: 1200,
    },
    betweenTrialsMs: 0,
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const panel = await context.newPage(),
    errors: string[] = [];
  panel.on('pageerror', (e) => errors.push(e.message));
  await panel.goto(base + '/panel');
  await panel.getByRole('heading', { name: 'The court is yours.' }).waitFor();
  await mkdir(resolve('artifacts'), { recursive: true });
  await panel.screenshot({ path: resolve('artifacts/panel.png'), fullPage: true });
  const overlay = await context.newPage();
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  overlay.on('pageerror', (e) => errors.push(e.message));
  await overlay.goto(base + '/overlay');
  await panel.getByRole('button', { name: 'Run full demo trial →' }).first().click();
  await overlay.getByText('THE HONORABLE JUDGE DOCKET', { exact: true }).waitFor();
  await waitFor(async () => {
    const s = await get();
    return s.court.trial?.phase === 'EXHIBITS';
  });
  await overlay.getByText('“This boss is easy, first try guaranteed.”', { exact: true }).waitFor();
  const demoSnapshot = await get();
  const png = await overlay.screenshot({
    path: resolve('artifacts/overlay.png'),
    omitBackground: true,
    animations: 'disabled',
  });
  const cameraAlpha = await overlay.evaluate(async (base64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(1480, 625, 1, 1).data[3];
  }, png.toString('base64'));
  assert.equal(cameraAlpha, 0, 'Defendant camera window must be truly transparent');
  assert.ok(
    !(await overlay.locator('body').innerText()).includes(
      'he said first try guaranteed and died like six times',
    ),
  );
  await waitFor(async () => {
    const s = await get();
    return !s.court.trial && s.records.precedents.length === 1;
  }, 25000);
  const result = await get();
  assert.equal(result.records.convictions[0].guilty_votes, 5);
  assert.equal(result.records.convictions[0].not_guilty_votes, 2);
  assert.ok(result.logs.some((l) => l.message.includes('setTitle: [CONVICTED]')));
  await panel
    .locator('nav')
    .getByRole('button', { name: /Settings/ })
    .click();
  await panel.getByLabel('Penal code JSON').fill('{bad json');
  await panel.getByRole('button', { name: 'Validate and save court rules' }).click();
  await panel.getByRole('alert').filter({ hasText: 'Penal code must be valid JSON' }).waitFor();
  await panel.locator('nav').getByRole('button', { name: /Court/ }).first().click();
  await panel.getByRole('button', { name: 'Run full demo trial →' }).first().click();
  await panel.getByRole('button', { name: 'Declare mistrial' }).click();
  await waitFor(async () => !(await get()).court.trial);
  assert.equal((await get()).cases[0].status, 'mistrial');
  await panel.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({ path: resolve('artifacts/panel-mobile.png'), fullPage: true });
  assert.equal(
    await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  assert.deepEqual(errors, []);
  const comedyChecks = await verifyComedy(panel, overlay, get);
  await post('chat', { user: 'viewer8', text: '!sue parrying is his specialty' });
  const filing = panel
    .locator('.case-row')
    .filter({ hasText: 'Raw filing: parrying is his specialty' });
  await filing.waitFor();
  assert.ok(await filing.getByRole('button', { name: 'Approve', exact: true }).isDisabled());
  await filing.getByRole('button', { name: 'Veto', exact: true }).click();
  await filing.waitFor({ state: 'detached' });
  assert.equal((await get()).cases[0].reject_reason, 'streamer_veto');
  assert.deepEqual(errors, []);
  const phaseChecks = await verifyOverlayFixtures(browser, demoSnapshot);
  console.log(
    JSON.stringify({
      ok: true,
      phaseChecks,
      comedyChecks,
      checks: [
        'panel route',
        'overlay route',
        'WebSocket snapshots',
        'verbatim exhibit',
        'full demo',
        'automatic sentence',
        'records',
        'settings validation',
        'mistrial button',
        'pretrial veto and approval gate',
        'mobile layout',
      ],
      artifacts: resolve('artifacts'),
    }),
  );
} finally {
  await browser?.close();
  processServer.kill('SIGTERM');
  await new Promise<void>((r) => {
    if (processServer.exitCode !== null) r();
    else processServer.once('exit', () => r());
  });
  await rm(temporary, { recursive: true, force: true });
}
