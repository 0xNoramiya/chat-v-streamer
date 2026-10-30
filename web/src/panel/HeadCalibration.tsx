import { useEffect, useRef, useState } from 'react';
import { comedyPack, type ComedySnapshot } from '../shared/comedy';
import { effectGeometry } from '../shared/comedyGeometry';
import type { Settings } from '../shared/types';
import { api } from '../shared/client';
export function HeadCalibration({
  state,
  camera,
  run,
}: {
  state: ComedySnapshot;
  camera: Settings['webcam'];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(state.calibration),
    [activeMarker, setActiveMarker] = useState('crown'),
    [cameraActive, setCameraActive] = useState(false),
    [source, setSource] = useState(''),
    [isImage, setIsImage] = useState(false),
    [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream>(null),
    url = useRef(''),
    preview = useRef<HTMLDivElement>(null),
    dragging = useRef<string | null>(null),
    disposed = useRef(false);
  const previewRequest = useRef(0);
  useEffect(
    () => setDraft(state.calibration),
    [
      state.calibration.crown.x,
      state.calibration.crown.y,
      state.calibration.headWidth,
      state.calibration.contact.x,
      state.calibration.contact.y,
    ],
  );
  const stop = () => {
    previewRequest.current++;
    setCameraActive(false);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  useEffect(
    () => () => {
      disposed.current = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const update = (marker: string, x: number, y: number) => {
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    setDraft((current) =>
      marker === 'width'
        ? {
            ...current,
            headWidth: Math.max(0.08, Math.min(0.7, Math.abs(x - current.crown.x) * 2)),
          }
        : { ...current, [marker]: { x: clamp(x), y: clamp(y) } },
    );
  };
  const hat = comedyPack.effects.find((e) => e.id === 'silly_hat')!;
  const box = effectGeometry(hat, state.placements[hat.id] ?? hat.placement, draft, {
    ...camera,
    x: 0,
    y: 0,
  });
  const markers = [
    { key: 'crown', label: 'Head crown', x: draft.crown.x, y: draft.crown.y },
    {
      key: 'width',
      label: 'Head width',
      x: draft.crown.x + draft.headWidth / 2,
      y: draft.crown.y + 0.08,
    },
    { key: 'contact', label: 'BONK contact', x: draft.contact.x, y: draft.contact.y },
  ];
  return (
    <details className="head-calibration">
      <summary>Calibrate head · crown, width &amp; BONK target</summary>
      <p>
        Match your OBS framing. Drag the crown to the top of your hair, the width marker to the
        right edge of your head, and the contact point to the intended bonk. No tracking.
      </p>
      <div className="calibration-media">
        <label>
          Preview photo or video
          <input
            type="file"
            accept=".mp4,.webm,.png,.jpg,.jpeg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              stop();
              if (url.current) URL.revokeObjectURL(url.current);
              url.current = URL.createObjectURL(file);
              setSource(url.current);
              setIsImage(file.type.startsWith('image/'));
              setError('');
            }}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              try {
                stop();
                const request = previewRequest.current;
                setIsImage(false);
                setSource('');
                const media = await navigator.mediaDevices.getUserMedia({
                  video: true,
                  audio: false,
                });
                if (disposed.current || request !== previewRequest.current) {
                  media.getTracks().forEach((t) => t.stop());
                  return;
                }
                stream.current = media;
                setCameraActive(true);
                if (video.current) {
                  video.current.srcObject = media;
                  await video.current.play();
                }
                setError('');
              } catch {
                setError(
                  'Camera preview unavailable. Choose a local photo/video, or use the guide.',
                );
              }
            })
          }
        >
          Use camera preview
        </button>
        <button type="button" onClick={stop}>
          Stop preview camera
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <label>
        Active marker
        <select value={activeMarker} onChange={(event) => setActiveMarker(event.target.value)}>
          <option value="crown">Head crown</option>
          <option value="width">Head width</option>
          <option value="contact">BONK contact</option>
        </select>
      </label>
      <div
        ref={preview}
        className="calibration-preview"
        style={{ aspectRatio: `${camera.w}/${camera.h}` }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const r = preview.current!.getBoundingClientRect();
          update(
            dragging.current,
            (event.clientX - r.left) / r.width,
            (event.clientY - r.top) / r.height,
          );
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
      >
        {isImage ? (
          <img className="calibration-camera" src={source} alt="Local camera reference" />
        ) : (
          <video
            className="calibration-camera"
            ref={video}
            src={source || undefined}
            autoPlay
            playsInline
            loop
            muted
          />
        )}
        {!source && !cameraActive && (
          <div className="calibration-guide">
            Load your camera preview
            <br />
            or calibrate against this guide.
          </div>
        )}
        {box.fits && (
          <img
            className="calibration-hat"
            src={hat.asset}
            alt="Hat placement preview"
            style={{
              left: `${(box.left / camera.w) * 100}%`,
              top: `${(box.top / camera.h) * 100}%`,
              width: `${(box.width / camera.w) * 100}%`,
            }}
          />
        )}
        <div
          className="head-width-guide"
          style={{
            left: `${(draft.crown.x - draft.headWidth / 2) * 100}%`,
            top: `${(draft.crown.y + 0.08) * 100}%`,
            width: `${draft.headWidth * 100}%`,
          }}
        />
        {markers.map((marker) => (
          <button
            type="button"
            className={`calibration-marker marker-${marker.key}`}
            key={marker.key}
            aria-label={marker.label}
            style={{
              left: `${marker.x * 100}%`,
              top: `${marker.y * 100}%`,
              zIndex: activeMarker === marker.key ? 4 : 2,
            }}
            onFocus={() => setActiveMarker(marker.key)}
            onPointerDown={(event) => {
              setActiveMarker(marker.key);
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging.current = marker.key;
              event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              update(
                marker.key,
                marker.x +
                  (event.key === 'ArrowRight' ? 0.01 : event.key === 'ArrowLeft' ? -0.01 : 0),
                marker.y + (event.key === 'ArrowDown' ? 0.01 : event.key === 'ArrowUp' ? -0.01 : 0),
              );
            }}
          >
            <span>{marker.label}</span>
          </button>
        ))}
      </div>
      <output className="calibration-values">
        Crown {Math.round(draft.crown.x * 100)}%, {Math.round(draft.crown.y * 100)}% · width{' '}
        {Math.round(draft.headWidth * 100)}% · contact {Math.round(draft.contact.x * 100)}%,{' '}
        {Math.round(draft.contact.y * 100)}%
      </output>
      {!box.fits && (
        <p role="status" className="headroom-warning">
          {box.guidance} A hat cannot sit above the crown without visible space there. The overlay
          pauses it rather than cropping it.
        </p>
      )}
      <button
        type="button"
        onClick={() => void run(() => api('comedy', { action: 'calibrate', calibration: draft }))}
      >
        Save head calibration
      </button>
      <small>
        Preview stays in this browser. Coordinates follow your camera rectangle; changes do not
        modify court settings.
      </small>
    </details>
  );
}
