import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { comedyPack, type Calibration, type EffectInstance } from '../shared/comedy';
import { effectGeometry } from '../shared/comedyGeometry';
import type { Settings } from '../shared/types';
import './comedy.css';
export function ComedyLayer({
  instances,
  camera,
  serverNow,
  calibration,
  calibrated,
  onImpact,
}: {
  instances: EffectInstance[];
  camera: Settings['webcam'];
  serverNow: number;
  calibration: Calibration;
  calibrated: boolean;
  onImpact: (id: string) => void;
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
        <Prop
          key={instance.id}
          instance={instance}
          camera={camera}
          serverNow={serverNow}
          calibration={calibration}
          calibrated={calibrated}
          onImpact={onImpact}
        />
      ))}
    </div>
  );
}
function Prop({
  instance,
  camera,
  serverNow,
  calibration,
  calibrated,
  onImpact,
}: {
  instance: EffectInstance;
  camera: Settings['webcam'];
  serverNow: number;
  calibration: Calibration;
  calibrated: boolean;
  onImpact: (id: string) => void;
}) {
  const delay = useRef(Math.max(0, serverNow - instance.startedAt));
  const image = useRef<HTMLImageElement>(null),
    [burst, setBurst] = useState(false);
  const effect = comedyPack.effects.find((e) => e.id === instance.effectId)!;
  const box = effectGeometry(effect, instance.placement, calibration, camera);
  useLayoutEffect(() => {
    if (!burst) return;
    const frame = requestAnimationFrame(() => onImpact(instance.id));
    return () => cancelAnimationFrame(frame);
  }, [burst, instance.id, onImpact]);
  useEffect(() => {
    if (!effect.impact || !image.current) return;
    const impact = effect.impact.atMs,
      duration = effect.durationMs,
      elapsed = Math.max(0, serverNow - instance.startedAt);
    setBurst(false);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (elapsed < impact + effect.impact.durationMs) {
      if (elapsed >= impact) setBurst(true);
      else timers.push(setTimeout(() => setBurst(true), impact - elapsed));
      timers.push(setTimeout(() => setBurst(false), impact + effect.impact.durationMs - elapsed));
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const animation = !motion.matches
      ? image.current.animate(
          [
            { offset: 0, opacity: 0, transform: 'translate(20px,-30px) rotate(20deg)' },
            {
              offset: (impact - 300) / duration,
              opacity: 1,
              transform: 'translate(32px,-45px) rotate(30deg)',
            },
            { offset: impact / duration, opacity: 1, transform: 'none' },
            { offset: (impact + 150) / duration, opacity: 1, transform: 'none' },
            {
              offset: Math.min(1, (impact + 500) / duration),
              opacity: 0,
              transform: 'translate(50px,-100px) rotate(35deg)',
            },
            { offset: 1, opacity: 0, transform: 'translate(50px,-100px) rotate(35deg)' },
          ],
          { duration, fill: 'both', easing: 'linear' },
        )
      : undefined;
    if (animation) animation.currentTime = elapsed;
    const reduce = () => {
      if (motion.matches) animation?.cancel();
    };
    motion.addEventListener('change', reduce);
    return () => {
      timers.forEach(clearTimeout);
      animation?.cancel();
      motion.removeEventListener('change', reduce);
    };
  }, [effect, box.fits, calibrated]);
  if (effect.target !== 'camera' && (!calibrated || !box.fits))
    return (
      <p
        className="comedy-fit-warning"
        style={{ left: camera.x + 8, top: camera.y + camera.h - 40, maxWidth: camera.w - 16 }}
      >
        {effect.label} paused · {calibrated ? 'reframe for headroom' : 'save head calibration'}
      </p>
    );
  return (
    <div
      className="comedy-position"
      data-effect={effect.id}
      data-instance={instance.id}
      data-anchor-x={box.x}
      data-anchor-y={box.y}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
      }}
    >
      <img
        ref={image}
        className={`comedy-sprite gag-${effect.animation}`}
        src={effect.asset}
        alt=""
        draggable={false}
        style={
          {
            '--gag-duration': `${effect.durationMs || 700}ms`,
            animationDelay: `-${delay.current}ms`,
            transformOrigin: `${effect.anchor.x * 100}% ${effect.anchor.y * 100}%`,
            ...(effect.impact ? { animationName: 'none' } : {}),
          } as CSSProperties
        }
      />
      {burst && effect.impact && (
        <img
          className="comedy-impact"
          src={effect.impact.asset}
          alt=""
          data-impact-at={instance.startedAt + effect.impact.atMs}
          style={{
            left: box.width * effect.anchor.x,
            top: box.height * effect.anchor.y,
            width: (box.width / effect.widthRatio) * effect.impact.widthRatio,
            transform: `translate(-${effect.impact.anchor.x * 100}%, -${effect.impact.anchor.y * 100}%)`,
          }}
        />
      )}
    </div>
  );
}
