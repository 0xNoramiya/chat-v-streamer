import type { Calibration, ComedyEffect, Placement } from './comedy';
import type { Settings } from './types';
export function effectGeometry(
  effect: ComedyEffect,
  placement: Placement,
  head: Calibration,
  camera: Settings['webcam'],
) {
  const headPixels = camera.w * head.headWidth;
  const requestedWidth =
    (effect.sizeBasis === 'head' ? headPixels : camera.w) * effect.widthRatio * placement.scale;
  const width =
    effect.target === 'camera' ? Math.min(camera.w * 0.85, requestedWidth) : requestedWidth;
  const height = (width * effect.dimensions.h) / effect.dimensions.w;
  const point = effect.target === 'crown' ? head.crown : head.contact;
  const x =
    camera.x +
    (effect.target === 'camera' ? placement.x : point.x + placement.x - 0.5) * camera.w +
    effect.targetOffset.x * headPixels;
  const y =
    camera.y +
    (effect.target === 'camera' ? placement.y : point.y + placement.y - 0.5) * camera.h +
    effect.targetOffset.y * headPixels;
  const left = x - effect.anchor.x * width,
    top = y - effect.anchor.y * height;
  const missingTop = Math.max(0, Math.ceil(camera.y + 4 - top));
  const fits =
    top >= camera.y + 4 &&
    left >= camera.x + 4 &&
    left + width <= camera.x + camera.w - 4 &&
    top + height <= camera.y + camera.h - 4;
  return {
    x,
    y,
    left,
    top,
    width,
    height,
    fits,
    missingTop,
    guidance: fits
      ? ''
      : missingTop > 0
        ? `${effect.label} needs ${missingTop}px more headroom. Zoom out or add space above your hair in OBS, then recalibrate the crown.`
        : `${effect.label} reaches the camera edge. Reframe in OBS or reduce its scale.`,
  };
}
