import type { Settings } from '../shared/types';
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function cameraCutout(r: Rect) {
  return `polygon(evenodd, 0 0,1920px 0,1920px 1080px,0 1080px,0 0,${r.x}px ${r.y}px,${r.x + r.w}px ${r.y}px,${r.x + r.w}px ${r.y + r.h}px,${r.x}px ${r.y + r.h}px,${r.x}px ${r.y}px)`;
}
export function courtLayout(camera: Settings['webcam']) {
  const body = { x: 48, y: 254, w: 1824, h: 634 };
  const free: Rect[] = [
    { ...body, w: Math.max(0, camera.x - body.x - 36) },
    { ...body, x: camera.x + camera.w + 36, w: Math.max(0, 1872 - camera.x - camera.w - 36) },
  ];
  const receipts = free.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const above = camera.y - 234 - 10;
  const rail: Rect = {
    x: Math.max(48, Math.min(camera.x, 1872 - Math.max(500, camera.w))),
    y: above >= 120 ? 234 : Math.min(camera.y + camera.h + 24, 738),
    w: Math.min(1824, Math.max(500, camera.w)),
    h: above >= 120 ? Math.min(above, 156) : 150,
  };
  if (above < 120) {
    receipts.h -= 172;
    rail.x = receipts.x;
    rail.y = receipts.y + receipts.h + 16;
    rail.w = receipts.w;
    rail.h = 156;
  }
  return { receipts, rail, caption: { x: 48, y: 928, w: 1824, h: 128 } };
}
export const rectStyle = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
