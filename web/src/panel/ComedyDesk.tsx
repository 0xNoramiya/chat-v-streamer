import { useEffect, useRef, useState } from 'react';
import { api } from '../shared/client';
import { comedyPack, type ComedyCommand, type ComedySnapshot } from '../shared/comedy';
import './comedyDesk.css';
import { HeadCalibration } from './HeadCalibration';
import { effectGeometry } from '../shared/comedyGeometry';
import type { Settings } from '../shared/types';
export function ComedyDesk({
  state,
  now,
  connected,
  run,
  camera,
}: {
  state: ComedySnapshot;
  now: number;
  connected: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  camera: Settings['webcam'];
}) {
  const [selected, setSelected] = useState('silly_hat'),
    [muted, setMuted] = useState(state.sound.muted),
    [volume, setVolume] = useState(state.sound.volume);
  const effect = comedyPack.effects.find((e) => e.id === selected)!;
  const position = state.placements[selected] ?? effect.placement;
  const [draft, setDraft] = useState(position);
  const soundTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setDraft(position), [selected, position.x, position.y, position.scale]);
  useEffect(() => setVolume(state.sound.volume), [state.sound.volume]);
  useEffect(() => setMuted(state.sound.muted), [state.sound.muted]);
  useEffect(() => () => clearTimeout(soundTimer.current), []);
  const send = (command: ComedyCommand) => run(() => api('comedy', command));
  const sound = (muted: boolean, level: number) => {
    clearTimeout(soundTimer.current);
    setMuted(muted);
    void run(async () => {
      try {
        await api('comedy', { action: 'sound', muted, volume: level });
      } catch (error) {
        setMuted(state.sound.muted);
        setVolume(state.sound.volume);
        throw error;
      }
    });
  };
  return (
    <section className="paper-card comedy-desk" aria-label="Comedy desk">
      <div className="card-heading">
        <span className="section-tag">COMEDY DESK</span>
        <button className="clear-comedy" onClick={() => void send({ action: 'clear' })}>
          Clear all effects
        </button>
      </div>
      <div className="comedy-buttons">
        {comedyPack.effects.map((e) => (
          <button
            key={e.id}
            disabled={
              !connected ||
              (state.cooldowns[e.id] ?? 0) > now ||
              (e.kind === 'transient' && !!state.sequence) ||
              (e.target !== 'camera' &&
                (!state.calibrated ||
                  !effectGeometry(
                    e,
                    state.placements[e.id] ?? e.placement,
                    state.calibration,
                    camera,
                  ).fits))
            }
            title={
              e.target === 'camera'
                ? e.label
                : effectGeometry(
                    e,
                    state.placements[e.id] ?? e.placement,
                    state.calibration,
                    camera,
                  ).guidance || e.label
            }
            onClick={() => void send({ action: 'trigger', effectId: e.id })}
            aria-label={`Trigger ${e.label}`}
          >
            <img src={e.asset} alt="" />
            <b>{e.label}</b>
            <small>{e.kind === 'prop' ? 'Attach prop' : `${e.durationMs / 1000}s gag`}</small>
          </button>
        ))}
      </div>
      <button
        className="bonk-sequence"
        disabled={
          !connected ||
          !state.calibrated ||
          !!state.sequence ||
          (state.cooldowns.bonk_stars ?? 0) > now ||
          ['bonk', 'seeing_stars'].some((id) => {
            const e = comedyPack.effects.find((e) => e.id === id)!;
            return !effectGeometry(
              e,
              state.placements[id] ?? e.placement,
              state.calibration,
              camera,
            ).fits;
          })
        }
        onClick={() => void send({ action: 'sequence', sequenceId: 'bonk_stars' })}
      >
        BONK → stars
      </button>
      {state.sequence && (
        <p role="status" className="sequence-status">
          Anticipation → impact → stunned beat → stars · Clear all cancels the sequence.
        </p>
      )}
      {!state.calibrated && (
        <p role="status" className="headroom-warning">
          Save head calibration below before using the hat, BONK or stars. No head position is
          guessed.
        </p>
      )}
      {comedyPack.effects
        .filter((e) => e.target !== 'camera')
        .map((e) => {
          const fit = effectGeometry(
            e,
            state.placements[e.id] ?? e.placement,
            state.calibration,
            camera,
          );
          return fit.fits ? null : (
            <p className="headroom-warning" key={e.id}>
              {fit.guidance}
            </p>
          );
        })}
      <HeadCalibration state={state} camera={camera} run={run} />
      <div className="comedy-controls">
        <form
          className="prop-placement"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ action: 'place', effectId: selected, placement: draft });
          }}
        >
          <label>
            Position prop
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {comedyPack.effects
                .filter((e) => e.kind === 'prop')
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Horizontal %
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(draft.x * 100)}
              onChange={(e) =>
                setDraft({ ...draft, x: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })
              }
            />
          </label>
          <label>
            Vertical %
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(draft.y * 100)}
              onChange={(e) =>
                setDraft({ ...draft, y: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })
              }
            />
          </label>
          <label>
            Scale %
            <input
              type="number"
              min="30"
              max="150"
              step="5"
              value={Math.round(draft.scale * 100)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  scale: Math.min(1.5, Math.max(0.3, Number(e.target.value) / 100)),
                })
              }
            />
          </label>
          <button type="submit" disabled={!connected}>
            Apply position
          </button>
          <button
            type="button"
            disabled={!connected || !state.props.some((p) => p.effectId === selected)}
            onClick={() => void send({ action: 'remove', effectId: selected })}
          >
            Remove prop
          </button>
        </form>
        <div className="comedy-sound-controls">
          <label>
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => sound(e.target.checked, volume)}
            />{' '}
            Mute effect sounds
          </label>
          <label>
            Effect volume · {Math.round(volume * 100)}%
            <input
              aria-label="Effect volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                const level = Number(e.target.value);
                setVolume(level);
                clearTimeout(soundTimer.current);
                soundTimer.current = setTimeout(() => sound(muted, level), 150);
              }}
            />
          </label>
        </div>
      </div>
      <p className="comedy-hint">
        Hat and cloud stay until removed. For head props, 50% / 50% uses the calibrated anchor;
        offsets and scale are optional. One big gag at a time; no automatic cues.
      </p>
    </section>
  );
}
