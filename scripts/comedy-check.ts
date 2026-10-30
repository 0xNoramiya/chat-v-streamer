import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { comedyPack } from '../web/src/shared/comedy.js';
import { effectGeometry } from '../web/src/shared/comedyGeometry.js';
import type { Snapshot } from '../web/src/shared/types.js';
export async function verifyComedy(panel: Page, overlay: Page, get: () => Promise<Snapshot>) {
  await panel.setViewportSize({ width: 1440, height: 1050 });
  await panel.locator('nav').getByRole('button', { name: /Court/ }).first().click();
  const desk = panel.getByRole('region', { name: 'Comedy desk' });
  await desk.waitFor();
  await desk.locator('.head-calibration summary').click();
  await desk.getByRole('button', { name: 'Save head calibration', exact: true }).click();
  await panel.waitForFunction(
    async () => (await (await fetch('/api/state')).json()).comedy.calibrated,
  );
  await desk.locator('.head-calibration summary').click();
  await overlay.addInitScript(() => {
    const metrics = { starts: 0, cancelled: 0 };
    (window as unknown as { comedyAudioMetrics: typeof metrics }).comedyAudioMetrics = metrics;
    const createOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const node = createOscillator.call(this),
        start = node.start.bind(node),
        stop = node.stop.bind(node);
      node.start = (when) => {
        metrics.starts++;
        start(when);
      };
      node.stop = (when) => {
        if (when === undefined) metrics.cancelled++;
        stop(when);
      };
      return node;
    };
  });
  await overlay.reload();
  await overlay.locator('.docket-ticker').waitFor();
  await desk.getByLabel('Mute effect sounds').check();
  const volume = desk.getByRole('slider', { name: 'Effect volume' });
  await volume.focus();
  await volume.press('Home');
  await volume.press('ArrowRight');
  await panel.waitForTimeout(300);
  assert.deepEqual((await get()).comedy.sound, { muted: true, volume: 0.05 });
  await overlay.getByRole('button', { name: 'Enable audio' }).click();
  // Exercise the browser's real WebAudio nodes, then mute before scheduled impact.
  await desk.getByLabel('Mute effect sounds').uncheck();
  await panel.waitForFunction(
    async () => (await (await fetch('/api/state')).json()).comedy.sound.muted === false,
  );
  await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).click();
  await overlay.waitForFunction(
    () =>
      (window as unknown as { comedyAudioMetrics: { starts: number } }).comedyAudioMetrics.starts >=
      2,
  );
  await desk.getByLabel('Mute effect sounds').check();
  await overlay.waitForFunction(
    () =>
      (window as unknown as { comedyAudioMetrics: { cancelled: number } }).comedyAudioMetrics
        .cancelled >= 2,
  );
  const files = await overlay.evaluate(
    async (assets) => {
      const output = [];
      for (const asset of assets) {
        const image = new Image();
        image.src = asset;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
        let transparent = 0,
          opaque = 0,
          borderOpaque = 0;
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const alpha = pixels[(y * image.width + x) * 4 + 3];
            if (alpha === 0) transparent++;
            if (alpha === 255) opaque++;
            if ((x === 0 || x === image.width - 1 || y === 0 || y === image.height - 1) && alpha)
              borderOpaque++;
          }
        output.push({ asset, transparent, opaque, borderOpaque });
      }
      return output;
    },
    comedyPack.effects.flatMap((e) => (e.impact ? [e.asset, e.impact.asset] : [e.asset])),
  );
  for (const image of files) {
    assert.ok(
      image.transparent > 1000 && image.opaque > 1000,
      `Actual RGBA cutout: ${image.asset}`,
    );
    assert.equal(image.borderOpaque, 0, `Transparent outer border: ${image.asset}`);
  }
  const camera = (await get()).settings.webcam;
  const alpha = async (label: string) => {
    const png = await overlay.screenshot({
      path: resolve(`artifacts/comedy-${label}.png`),
      omitBackground: true,
    });
    return overlay.evaluate(
      async ({ base64, camera }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(camera.x, camera.y, camera.w, camera.h).data;
        let nonzero = 0;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) nonzero++;
        return nonzero;
      },
      { base64: png.toString('base64'), camera },
    );
  };
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
  assert.equal(await alpha('baseline'), 0);
  for (const effect of comedyPack.effects) {
    await desk.getByRole('button', { name: `Trigger ${effect.label}`, exact: true }).click();
    const sprite = overlay.locator(`[data-effect="${effect.id}"]`);
    await sprite.waitFor();
    await sprite.locator('img').evaluate((image) => (image as HTMLImageElement).decode());
    await overlay.waitForTimeout(effect.kind === 'prop' ? 750 : effect.soundAtMs + 150);
    const count = await alpha(effect.id);
    assert.ok(
      count > 100 && count < camera.w * camera.h * 0.9,
      `${effect.label} paints a transparent prop, not an opaque rectangle`,
    );
    if (effect.kind === 'prop') {
      await desk.getByLabel('Position prop').selectOption(effect.id);
      const placement = {
        x: effect.target === 'camera' ? 0.35 : 0.55,
        y: effect.target === 'camera' ? 0.4 : 0.55,
        scale: 0.8,
      };
      await desk.getByLabel('Horizontal %').fill(String(placement.x * 100));
      await desk.getByLabel('Vertical %').fill(String(placement.y * 100));
      await desk.getByLabel('Scale %').fill('80');
      await desk.getByRole('button', { name: 'Apply position' }).click();
      await overlay.waitForFunction(
        ({ id, x }) =>
          (document.querySelector(`[data-effect="${id}"]`) as HTMLElement)?.style.left === `${x}px`,
        {
          id: effect.id,
          x: effectGeometry(effect, placement, (await get()).comedy.calibration, camera).left,
        },
      );
      const instance = await sprite.getAttribute('data-instance');
      await overlay.reload();
      await sprite.waitFor();
      assert.equal(
        await sprite.getAttribute('data-instance'),
        instance,
        'Persistent prop survives overlay reconnect',
      );
      await desk.getByRole('button', { name: 'Remove prop' }).click();
    }
    await sprite.waitFor({ state: 'detached' });
    await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
    assert.equal(await alpha(`${effect.id}-clean`), 0);
  }
  // A reconnect during a one-shot does not start it again.
  await desk.getByRole('button', { name: 'Trigger SEEING STARS', exact: true }).click();
  await overlay.locator('[data-effect="seeing_stars"]').waitFor();
  await overlay.reload();
  await overlay.locator('.docket-ticker').waitFor();
  assert.equal(await overlay.locator('.comedy-position').count(), 0);
  // Clear is immediate and works while a persistent prop and a large gag overlap.
  await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).click();
  await desk.getByRole('button', { name: 'Trigger POOF', exact: true }).click();
  await overlay.locator('[data-effect="poof"]').waitFor();
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
  assert.equal(await alpha('clear-all'), 0);
  // Actual trial interruption clears a currently playing gag.
  await panel.getByRole('button', { name: 'Run full demo trial →' }).first().click();
  await overlay.locator('.courtroom').waitFor();
  await desk.getByRole('button', { name: 'Trigger CASE CLOSED', exact: true }).click();
  await overlay.locator('[data-effect="case_closed"]').waitFor();
  await overlay.waitForTimeout(500);
  assert.ok(await alpha('trial-stamp'));
  await panel.getByRole('button', { name: 'Declare mistrial' }).click();
  await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
  assert.equal(await alpha('mistrial-clean'), 0);
  // Reduced motion removes movement, while expiration/cleanup remains functional.
  await overlay.emulateMedia({ reducedMotion: 'reduce' });
  await desk.getByRole('button', { name: 'Trigger BONK', exact: true }).click();
  await overlay.locator('[data-effect="bonk"]').waitFor();
  assert.equal(
    await overlay
      .locator('[data-effect="bonk"] img')
      .evaluate((e) => getComputedStyle(e).animationName),
    'none',
  );
  await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
  assert.equal(await alpha('reduced-clean'), 0);
  // Effects and their emergency clear remain available even when court is closed.
  const courtToggle = panel.getByLabel(/^Court (open|closed)$/);
  await courtToggle.click();
  await panel.getByLabel('Court closed', { exact: true }).waitFor();
  await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).click();
  await overlay.locator('[data-effect="silly_hat"]').waitFor();
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await overlay.locator('.comedy-layer').waitFor({ state: 'detached' });
  assert.equal(await alpha('court-off-clean'), 0);
  await courtToggle.click();
  await panel.getByLabel('Court open', { exact: true }).waitFor();
  await panel.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await panel.screenshot({ path: resolve('artifacts/comedy-desk.png'), fullPage: true });
  return {
    generatedAssets: files.length,
    panelTriggers: 6,
    placementAndRemoval: true,
    reconnectNoReplay: true,
    clearAndMistrial: true,
    cameraAlphaRestored: true,
    reducedMotion: true,
    webAudioAndMute: true,
  };
}
