import { useState } from 'react';
import type { Settings } from '../shared/types';
export function SettingsEditor({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings)),
    [penal, setPenal] = useState(JSON.stringify(settings.penalCode, null, 2)),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const field = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((s) => ({ ...s, [key]: value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const penalCode = JSON.parse(penal);
          setError('');
          setSaving(true);
          void onSave({ ...draft, penalCode }).finally(() => setSaving(false));
        } catch {
          setError('Penal code must be valid JSON. Check commas, quotes and brackets.');
        }
      }}
    >
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      <section className="paper-card">
        <span className="section-tag">COURT POLICY</span>
        <div className="settings-grid">
          <label>
            Streamer display name
            <input
              value={draft.streamerName}
              maxLength={30}
              onChange={(e) => field('streamerName', e.target.value)}
            />
          </label>
          {(
            [
              'cosignWindowMs',
              'cosignRatio',
              'minCosigners',
              'maxCosigners',
              'sueCooldownMs',
              'betweenTrialsMs',
              'maxOpenCases',
              'objectionThreshold',
            ] as const
          ).map((key) => (
            <label key={key}>
              {
                {
                  cosignWindowMs: 'Co-sign window (ms)',
                  cosignRatio: 'Co-sign ratio',
                  minCosigners: 'Minimum co-signers',
                  maxCosigners: 'Maximum co-signers',
                  sueCooldownMs: 'Filing cooldown (ms)',
                  betweenTrialsMs: 'Between trials (ms)',
                  maxOpenCases: 'Maximum open cases',
                  objectionThreshold: 'Objection threshold',
                }[key]
              }
              <input
                type="number"
                step={key === 'cosignRatio' ? 0.01 : 1}
                value={draft[key]}
                onChange={(e) => field(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <div className="settings-toggles">
          {(
            [
              'courtOn',
              'autoApprove',
              'contempt',
              'polls',
              'channelPoints',
              'tts',
              'clipOnGuilty',
              'markerOnGuilty',
            ] as const
          ).map((key) => (
            <label className="toggle" key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) => field(key, e.target.checked)}
              />
              {
                {
                  courtOn: 'Court open',
                  autoApprove: 'Auto-approve cases',
                  contempt: 'Contempt timeouts (opt-in)',
                  polls: 'Native jury poll (supplementary)',
                  channelPoints: 'Channel Points lawsuits',
                  tts: 'AI speech',
                  clipOnGuilty: 'Clip convictions',
                  markerOnGuilty: 'Mark convictions',
                }[key]
              }
            </label>
          ))}
        </div>
        <p className="muted">
          Polls and Channel Points require Affiliate/Partner access. Save, then reconnect the
          broadcaster to grant optional scopes. Native polls are supplementary; !g and !ng decide
          the verdict.
        </p>
      </section>
      <section className="paper-card">
        <span className="section-tag">PHASE TIMERS · MILLISECONDS</span>
        <div className="settings-grid">
          {Object.entries(draft.phaseMs).map(([key, value]) => (
            <label key={key}>
              {key.replaceAll('_', ' ')}
              <input
                type="number"
                value={value}
                min={500}
                onChange={(e) =>
                  field('phaseMs', { ...draft.phaseMs, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            field('phaseMs', {
              CALL_TO_ORDER: 1500,
              EXHIBITS: 2000,
              DEFENSE: 4000,
              REBUTTAL: 2500,
              JURY: 4000,
              VERDICT: 2000,
              SENTENCING: 2500,
              ADJOURN: 1500,
            })
          }
        >
          Use quick rehearsal timers
        </button>
        <button
          type="button"
          onClick={() =>
            field('phaseMs', {
              CALL_TO_ORDER: 6000,
              EXHIBITS: 10000,
              DEFENSE: 30000,
              REBUTTAL: 12000,
              JURY: 20000,
              VERDICT: 8000,
              SENTENCING: 12000,
              ADJOURN: 5000,
            })
          }
        >
          Use normal timers
        </button>
      </section>
      <section className="paper-card">
        <span className="section-tag">OBS & CAMERA</span>
        <div className="settings-grid">
          <label>
            Court scene
            <input
              value={draft.obsCourtScene}
              onChange={(e) => field('obsCourtScene', e.target.value)}
            />
          </label>
          <label>
            Screenshot source (blank = program scene)
            <input
              value={draft.obsScreenshotSource}
              onChange={(e) => field('obsScreenshotSource', e.target.value)}
            />
          </label>
          {(['x', 'y', 'w', 'h'] as const).map((key) => (
            <label key={key}>
              Camera {key}
              <input
                type="number"
                value={draft.webcam[key]}
                onChange={(e) =>
                  field('webcam', { ...draft.webcam, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
      </section>
      <section className="paper-card">
        <span className="section-tag">APPROVED PENAL CODE</span>
        <p className="muted">
          Set approved to true only for punishments you agree to. Severity is capped by the jury’s
          guilty share. Title shame is the default approved sentence.
        </p>
        <label>
          Penal code JSON
          <textarea
            className="json-editor"
            value={penal}
            onChange={(e) => setPenal(e.target.value)}
            spellCheck={false}
          />
        </label>
      </section>
      <button className="primary" disabled={saving}>
        {saving ? 'Saving…' : 'Validate and save court rules'}
      </button>
    </form>
  );
}
