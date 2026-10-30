import { useEffect, useRef, useState } from 'react';
import { api } from '../shared/client';
import { comedyPack, type ComedyCommand, type ComedySnapshot } from '../shared/comedy';
import './comedyDesk.css';
export function ComedyDesk({
  state,
  now,
  connected,
  run,
}: {
  state: ComedySnapshot;
  now: number;
  connected: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
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
            disabled={!connected || (state.cooldowns[e.id] ?? 0) > now}
            onClick={() => void send({ action: 'trigger', effectId: e.id })}
            aria-label={`Trigger ${e.label}`}
          >
            <img src={e.asset} alt="" />
            <b>{e.label}</b>
            <small>{e.kind === 'prop' ? 'Attach prop' : `${e.durationMs / 1000}s gag`}</small>
          </button>
        ))}
      </div>
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
        Hat and cloud stay until removed. Position is relative to your camera. One big gag at a
        time; no automatic cues.
      </p>
    </section>
  );
}
