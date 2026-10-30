import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { Browser } from '@playwright/test';
import { phases, type Snapshot, type Phase } from '../web/src/shared/types.js';
import { speechScope } from '../web/src/shared/speech.js';
export async function verifyOverlayFixtures(browser: Browser, source: Snapshot) {
  const app = express(),
    server = createServer(app);
  app.use(express.static(resolve('web/dist')));
  app.get('/overlay', (_req, res) => res.sendFile(resolve('web/dist/index.html')));
  const wss = new WebSocketServer({ server, path: '/ws' });
  let state = structuredClone(source);
  wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'snapshot', data: state })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      reducedMotion: 'reduce',
    }),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const broadcast = () => {
    for (const ws of wss.clients)
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'snapshot', data: state }));
  };
  const noOverlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
    Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y);
  try {
    await page.goto(`http://127.0.0.1:${address.port}/overlay`);
    await page.locator('.courtroom').waitFor();
    const original = structuredClone(state.court.trial!);
    assert.ok(original.exhibits.length === 3);
    const long = (label: string) =>
      `${label} ` +
      'The stored transcript remains exactly as it was recorded, including these words and punctuation. '.repeat(
        20,
      );
    const receipts = original.exhibits.map((e, i) => ({
      ...e,
      text: long(i === 2 ? 'That was the sixth attempt.' : 'First try guaranteed.'),
      framing:
        'The defendant entered this on-stream statement into the record, and the original text is retained verbatim.'.slice(
          0,
          120,
        ),
    }));
    const rebuttal = {
      ...receipts[0],
      segment_id: 'seg_fixture_rebuttal',
      text: long('The defense supplied another contradiction.'),
      added_in: 'rebuttal' as const,
    };
    const variants: [string, Phase, 'guilty' | 'not_guilty' | 'mistrial'][] = phases.map(
      (phase) => [phase, phase, 'guilty'],
    );
    variants.splice(
      7,
      0,
      ['VERDICT_acquittal', 'VERDICT', 'not_guilty'],
      ['VERDICT_mistrial', 'VERDICT', 'mistrial'],
    );
    for (const [label, phase, verdict] of variants) {
      state = structuredClone(source);
      const now = Date.now();
      state.court.now = now;
      state.court.trial = {
        ...structuredClone(original),
        phase,
        phaseStartedAt: now,
        deadline: now + 20000,
        exhibitIndex: 2,
        exhibits:
          phase === 'CALL_TO_ORDER' || phase === 'EXHIBITS' || phase === 'DEFENSE'
            ? receipts
            : [...receipts, rebuttal],
        verdict,
        caseName: 'Chat v. StreamerDisplayName: The Extremely Confident First Try Guarantee Affair',
        formalCharge:
          'The plaintiff alleges the defendant repeatedly guaranteed an effortless first-try victory, contradicted their own gameplay claims, and supplied further on-stream assurances that the stored record disproves.'.slice(
            0,
            200,
          ),
        verdictScript: {
          verdict_line: 'The jury has spoken.',
          sentence_id: verdict === 'guilty' ? 'title_shame' : null,
          sentence_flavor: 'The approved consequence follows the jury verdict.',
          title_text: verdict === 'guilty' ? '[CONVICTED] A guarantee under oath' : null,
          precedent_summary: 'Established: the jury decides.',
        },
      };
      state.caption = {
        type: 'caption',
        id: `fixture-${label}`,
        scope: speechScope(state.court.trial),
        speaker: 'Judge Docket',
        text: 'The clerk has entered every word of the on-stream record into evidence. The jury alone will decide whether this particular guarantee survives cross-examination, and the defendant retains the right to explain the receipts.'.slice(
          0,
          220,
        ),
        sentAt: now,
        expiresAt: now + 20000,
      };
      state.status.capture = {
        state: 'unavailable',
        detail: 'Mic transcription unavailable · manual entry works',
      };
      state.settings.penalCode = state.settings.penalCode.map((p) =>
        p.id === 'title_shame'
          ? {
              ...p,
              text: 'The approved consequence is to carry a convicted title for fifteen minutes, after which the original title is restored automatically from the saved obligation. This sentence was approved by the streamer.'.slice(
                0,
                200,
              ),
            }
          : p,
      );
      broadcast();
      await page.waitForFunction(
        (expected) => document.querySelector('.phase-clock span')?.textContent === expected,
        (
          {
            CALL_TO_ORDER: 'All rise',
            EXHIBITS: 'The receipts',
            DEFENSE: 'The defense',
            REBUTTAL: 'Cross-examination',
            JURY: 'The jury decides',
            VERDICT: 'The verdict',
            SENTENCING: 'The sentence',
            ADJOURN: 'Court adjourned',
          } as Record<Phase, string>
        )[phase],
      );
      await page.waitForFunction(
        (id) => document.querySelector('.caption')?.getAttribute('data-line-id') === id,
        state.caption.id,
      );
      const zones = await Promise.all(
        ['.receipt-zone', '.phase-rail', '.defendant-window', '.caption'].map((selector) =>
          page.locator(selector).boundingBox(),
        ),
      );
      for (let a = 0; a < zones.length; a++)
        for (let b = a + 1; b < zones.length; b++) {
          assert.ok(zones[a] && zones[b]);
          assert.ok(noOverlap(zones[a]!, zones[b]!), `${label}: reserved zones ${a}/${b} overlap`);
        }
      if (phase !== 'CALL_TO_ORDER') {
        const expected =
          phase === 'EXHIBITS' || phase === 'DEFENSE' ? receipts[2].text : rebuttal.text;
        await page.waitForFunction(
          (text) => document.querySelector('.quote-verbatim')?.textContent === text,
          expected,
        );
        assert.equal(await page.locator('.quote-verbatim').textContent(), expected);
        await page.getByRole('button', { name: 'Next quote page' }).waitFor();
        for (let i = 0; i < 30; i++) {
          const before = await page.locator('.quote-scroll').evaluate((e) => ({
            top: e.scrollTop,
            bottom: e.scrollTop + e.clientHeight >= e.scrollHeight - 2,
          }));
          if (before.bottom) break;
          await page.getByRole('button', { name: 'Next quote page' }).click();
          await page.waitForFunction(
            (top) => (document.querySelector('.quote-scroll')?.scrollTop ?? 0) > top,
            before.top,
          );
        }
        assert.ok(
          await page
            .locator('.quote-scroll')
            .evaluate((e) => e.scrollTop + e.clientHeight >= e.scrollHeight - 2),
          'The end of the stored quote must be reachable',
        );
        assert.equal(await page.locator('.quote-verbatim').textContent(), expected);
      }
      if (phase === 'DEFENSE') {
        assert.ok(
          !(await page.locator('.defense-card').innerText()).includes('transcript is listening'),
        );
        assert.equal(
          await page
            .getByRole('button', { name: 'EXHIBIT C', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
      }
      for (const selector of ['.defense-card', '.jury', '.sentence-card', '.caption'])
        if (await page.locator(selector).count()) {
          const size = await page.locator(selector).evaluate((e) => ({
            scroll: e.scrollHeight,
            client: e.clientHeight,
            text: e.textContent,
          }));
          if (size.scroll > size.client + 1)
            await page.screenshot({
              path: resolve(`artifacts/overflow-${label}.png`),
              omitBackground: true,
            });
          assert.ok(
            size.scroll <= size.client + 1,
            `${label}: phase prompt text overflows ${JSON.stringify(size)}`,
          );
        }
      await assertCameraAlpha(label);
    }
    for (const [label, camera] of [
      ['camera-left', { x: 80, y: 400, w: 600, h: 450 }],
      ['camera-wide', { x: 1040, y: 400, w: 800, h: 450 }],
      ['camera-raised', { x: 1180, y: 300, w: 600, h: 450 }],
    ] as const) {
      state.settings.webcam = { ...camera };
      state.court.trial!.phase = 'DEFENSE';
      state.court.trial!.phaseStartedAt = Date.now();
      state.court.now = Date.now();
      state.caption = {
        ...state.caption!,
        id: label,
        scope: speechScope(state.court.trial),
        sentAt: state.court.now,
        expiresAt: state.court.now + 20000,
      };
      broadcast();
      await page.waitForFunction(
        (x) => document.querySelector('.defendant-window')?.getBoundingClientRect().x === x - 8,
        camera.x,
      );
      await page.waitForFunction(
        (id) => document.querySelector('.caption')?.getAttribute('data-line-id') === id,
        label,
      );
      const zones = await Promise.all(
        ['.receipt-zone', '.phase-rail', '.defendant-window', '.caption'].map((selector) =>
          page.locator(selector).boundingBox(),
        ),
      );
      for (let a = 0; a < zones.length; a++)
        for (let b = a + 1; b < zones.length; b++)
          assert.ok(
            zones[a] && zones[b] && noOverlap(zones[a]!, zones[b]!),
            `${label}: reserved zones collide`,
          );
      await assertCameraAlpha(label);
    }
    assert.deepEqual(errors, []);
    return {
      phases: variants.length,
      cameraLayouts: 4,
      fullQuotePages: true,
      allCameraPixelsTransparent: true,
    };
  } finally {
    await page.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
  async function assertCameraAlpha(label: string) {
    const r = state.settings.webcam;
    const png = await page.screenshot({
      path: resolve(`artifacts/phase-${label.toLowerCase()}.png`),
      omitBackground: true,
      animations: 'disabled',
    });
    const nonzero = await page.evaluate(
      async ({ base64, r }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + base64;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(r.x, r.y, r.w, r.h).data;
        let count = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
        return count;
      },
      { base64: png.toString('base64'), r },
    );
    assert.equal(nonzero, 0, `${label}: opaque camera-interior pixels`);
  }
}
