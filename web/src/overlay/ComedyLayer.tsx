import { useRef, type CSSProperties } from 'react';
import { comedyPack, type EffectInstance } from '../shared/comedy';
import type { Settings } from '../shared/types';
import './comedy.css';
export function ComedyLayer({
  instances,
  camera,
  serverNow,
}: {
  instances: EffectInstance[];
  camera: Settings['webcam'];
  serverNow: number;
}) {
  if (!instances.length) return null;
  return (
    <div
      className="comedy-layer"
      aria-hidden="true"
      style={{
        clipPath: `inset(${camera.y}px ${1920 - camera.x - camera.w}px ${1080 - camera.y - camera.h}px ${camera.x}px)`,
      }}
    >
      {instances.map((instance) => (
        <Prop key={instance.id} instance={instance} camera={camera} serverNow={serverNow} />
      ))}
    </div>
  );
}
function Prop({
  instance,
  camera,
  serverNow,
}: {
  instance: EffectInstance;
  camera: Settings['webcam'];
  serverNow: number;
}) {
  const delay = useRef(Math.max(0, serverNow - instance.startedAt));
  const effect = comedyPack.effects.find((e) => e.id === instance.effectId);
  if (!effect) return null;
  const width = Math.min(camera.w * 0.85, camera.w * effect.widthRatio * instance.placement.scale);
  return (
    <div
      className="comedy-position"
      data-effect={effect.id}
      data-instance={instance.id}
      style={{
        left: camera.x + camera.w * instance.placement.x,
        top: camera.y + camera.h * instance.placement.y,
        width,
      }}
    >
      <img
        className={`comedy-sprite gag-${effect.animation}`}
        src={effect.asset}
        alt=""
        draggable={false}
        style={
          {
            '--gag-duration': `${effect.durationMs || 700}ms`,
            animationDelay: `-${delay.current}ms`,
          } as CSSProperties
        }
      />
    </div>
  );
}
