import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { Snapshot } from '../web/src/shared/types.js';
import { defaultCalibration, type Calibration } from '../web/src/shared/comedy.js';
export async function dragCalibration(panel: Page, marker: string, x: number, y: number) {
  const area = panel.locator('.calibration-preview'),
    handle = panel.getByRole('button', { name: marker, exact: true });
  await area.scrollIntoViewIfNeeded();
  await handle.focus();
  const box = (await area.boundingBox())!,
    button = (await handle.boundingBox())!;
  await panel.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
  await panel.mouse.up();
}
export async function setHead(panel: Page, head: Calibration) {
  const details = panel.locator('.head-calibration');
  if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open)))
    await details.locator('summary').click();
  await dragCalibration(panel, 'Head crown', head.crown.x, head.crown.y);
  await dragCalibration(
    panel,
    'Head width',
    head.crown.x + head.headWidth / 2,
    head.crown.y + 0.08,
  );
  await dragCalibration(panel, 'BONK contact', head.contact.x, head.contact.y);
  await panel.getByRole('button', { name: 'Save head calibration', exact: true }).click();
  await panel.waitForFunction(async (expected) => {
    const s = await (await fetch('/api/state')).json(),
      actual = s.comedy.calibration;
    return (
      Math.abs(actual.crown.x - expected.crown.x) < 0.015 &&
      Math.abs(actual.crown.y - expected.crown.y) < 0.015 &&
      Math.abs(actual.headWidth - expected.headWidth) < 0.02 &&
      Math.abs(actual.contact.x - expected.contact.x) < 0.015 &&
      Math.abs(actual.contact.y - expected.contact.y) < 0.015
    );
  }, head);
}
export async function verifyCalibration(
  panel: Page,
  overlay: Page,
  get: () => Promise<Snapshot>,
  post: (path: string, body: unknown) => Promise<unknown>,
) {
  const desk = panel.getByRole('region', { name: 'Comedy desk' }),
    initial = await get();
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await panel.locator('.head-calibration summary').click();
  const fixture = resolve('artifacts/streamer-rehearsal/streamer.mp4');
  if (existsSync(fixture)) {
    await panel.getByLabel('Preview photo or video').setInputFiles(fixture);
    await panel.locator('.calibration-camera').evaluate((e) => (e as HTMLVideoElement).play());
  }
  await setHead(panel, { ...defaultCalibration, crown: { x: 0.5, y: 0.02 } });
  assert.ok(
    await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).isDisabled(),
  );
  assert.ok((await desk.innerText()).includes('headroom'));
  assert.equal(await overlay.locator('[data-effect="silly_hat"]').count(), 0);
  await setHead(panel, {
    crown: { x: 0.4, y: 0.4 },
    headWidth: 0.2,
    contact: { x: 0.46, y: 0.42 },
  });
  const head = (await get()).comedy.calibration;
  await desk.getByRole('button', { name: 'Trigger SILLY HAT', exact: true }).click();
  await overlay.locator('[data-effect="silly_hat"]').waitFor();
  await panel.reload();
  await panel.getByRole('heading', { name: 'The court is yours.' }).waitFor();
  assert.deepEqual((await get()).comedy.calibration, head);
  await overlay.reload();
  await overlay.locator('[data-effect="silly_hat"]').waitFor();
  const changedCamera = { x: 80, y: 300, w: 720, h: 540 };
  await post('settings', { ...initial.settings, webcam: changedCamera });
  await overlay.waitForFunction(
    ({ head, c }) =>
      Math.abs(
        Number(document.querySelector('[data-effect="silly_hat"]')?.getAttribute('data-anchor-x')) -
          (c.x + c.w * (head.crown.x + 0.05)),
      ) < 1,
    { head, c: changedCamera },
  );
  // Reset the optional M8 offset so the sequence test uses calibrated contact directly.
  await post('comedy', {
    action: 'place',
    effectId: 'silly_hat',
    placement: { x: 0.5, y: 0.5, scale: 1 },
  });
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await desk.getByRole('button', { name: 'BONK → stars', exact: true }).click();
  const mallet = overlay.locator('[data-effect="bonk"]');
  await mallet.waitFor();
  assert.equal(
    await overlay.locator('.comedy-impact').count(),
    0,
    'Burst must not appear during anticipation',
  );
  await overlay.locator('.comedy-impact').waitFor();
  assert.ok(
    Math.abs(
      Number(await mallet.getAttribute('data-anchor-x')) -
        (changedCamera.x + head.contact.x * changedCamera.w),
    ) < 1,
  );
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await overlay.waitForTimeout(1500);
  assert.equal(await overlay.locator('.comedy-layer').count(), 0, 'Clear cancels the future stars');
  await desk.getByRole('button', { name: 'BONK → stars', exact: true }).click();
  await overlay.locator('[data-effect="bonk"]').waitFor();
  await overlay.reload();
  await overlay.locator('.docket-ticker').waitFor();
  await overlay.waitForTimeout(1500);
  assert.equal(
    await overlay.locator('.comedy-layer').count(),
    0,
    'Reconnect must ignore pending steps from an old sequence',
  );
  await desk.getByRole('button', { name: 'Clear all effects' }).click();
  await post('settings', { ...initial.settings, webcam: initial.settings.webcam });
  return {
    manualMarkerDrag: true,
    headroomWarning: true,
    calibrationPersists: true,
    cameraAdapts: true,
    separateBurstAtContact: true,
    sequenceClear: true,
    sequenceReconnectNoReplay: true,
    movingFixturePreview: existsSync(fixture),
  };
}
