import { useEffect, useRef, useState } from 'react';
import { SettingsEditor } from './SettingsEditor';
import { ComedyDesk } from './ComedyDesk';
import { MicCapture } from './mic';
import { api, useCourt } from '../shared/client';
import { Owl } from '../shared/Owl';
import type { Settings } from '../shared/types';
import './panel.css';
export function Panel() {
  const [diagnosticResult, setDiagnosticResult] = useState(''),
    [testUser, setTestUser] = useState('');
  const mic = useRef<MicCapture | null>(null);
  const [micState, setMicState] = useState('Mic stopped');
  useEffect(() => () => mic.current?.stop(), []);
  const { snapshot: s, connected } = useCourt(true);
  const [tab, setTab] = useState('Court'),
    [user, setUser] = useState('viewer1'),
    [message, setMessage] = useState('!sue he said first try guaranteed and died like six times'),
    [manual, setManual] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setError('');
    try {
      await fn();
      if (ok) {
        setNotice(ok);
        setTimeout(() => setNotice(''), 4000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    }
  };
  if (!s) return <main className="loading">Opening the clerk’s office…</main>;
  const t = s.court.trial;
  const update = (partial: Partial<Settings>) =>
    run(() => api('settings', { ...s.settings, ...partial }));
  const action = (type: string, extra = {}) => run(() => api('action', { type, ...extra }));
  const send = () => run(() => api('chat', { user, text: message }));
  const batch = (text: string, n: number, start = 2) =>
    run(async () => {
      for (let i = start; i < start + n; i++) await api('chat', { user: `viewer${i}`, text });
    });
  return (
    <div className="panel-shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="/panel">
          <span className="brand-seal">§</span>
          <span>
            Chat v.
            <br />
            <b>Streamer</b>
          </span>
        </a>
        <span className="nav-label">CLERK’S OFFICE</span>
        <nav>
          {['Court', 'Transcript', 'Simulator', 'Settings', 'Records', 'Diagnostics'].map(
            (item) => (
              <button
                key={item}
                className={tab === item ? 'active' : ''}
                onClick={() => setTab(item)}
              >
                <span>
                  {
                    (
                      {
                        Court: '⚖',
                        Transcript: '≡',
                        Simulator: '▷',
                        Settings: '⚙',
                        Records: '▤',
                        Diagnostics: '⌁',
                      } as Record<string, string>
                    )[item]
                  }
                </span>
                {item}
                {item === 'Court' && (
                  <small>
                    {
                      s.cases.filter((c) =>
                        ['queued', 'filing', 'pending_approval'].includes(c.status),
                      ).length
                    }
                  </small>
                )}
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <Owl />
          <p>
            The Honorable
            <br />
            <strong>Judge Docket</strong>
          </p>
          <a href="/overlay" target="_blank" rel="noreferrer">
            Open overlay ↗
          </a>
          <small>1920 × 1080 · OBS browser source</small>
        </div>
      </aside>
      <main id="content" className="panel-main">
        <header className="panel-header">
          <div>
            <div className="eyebrow">COURT OF CHAT / {tab.toUpperCase()}</div>
            <h1>
              {tab === 'Court'
                ? 'The court is yours.'
                : tab === 'Simulator'
                  ? 'Rehearse the chaos.'
                  : tab === 'Transcript'
                    ? 'Let the record show.'
                    : tab === 'Records'
                      ? 'The permanent record.'
                      : tab === 'Settings'
                        ? 'Rules of the court.'
                        : 'Check the connections.'}
            </h1>
            <p>
              {tab === 'Court'
                ? 'You run the courtroom. Chat decides the verdict.'
                : 'Every good courtroom keeps its paperwork in order.'}
            </p>
          </div>
          <span className={`dry-badge ${s.status.dryRun ? '' : 'live'}`}>
            {s.status.sim
              ? `SIMULATOR · ${s.status.dryRun ? 'DRY RUN' : 'dry run off'}`
              : s.status.dryRun
                ? 'DRY RUN'
                : 'LIVE ACTIONS'}
          </span>
        </header>
        <div className="status-strip">
          {[
            ['Server', connected ? 'connected' : 'reconnecting'],
            ['Twitch', s.status.twitch],
            ['EventSub', s.status.eventsub],
            ['OBS', s.status.obs],
            ['AI', s.status.ai],
            ['Evidence', s.status.evidence ?? 'Evidence scope unknown'],
            ['Mic', s.status.capture?.detail ?? micState],
          ].map(([k, v]) => (
            <span key={k}>
              <i
                className={
                  /disconnected|unavailable|reconnecting|missing|failed|expired|unverified|not yet verified|not verified|fallback|connect broadcaster|off/.test(
                    v,
                  )
                    ? 'warn'
                    : ''
                }
              />
              <b>{k}</b> {v}
            </span>
          ))}
        </div>
        {!!s.status.pendingRealRestores && (
          <p className="notice">
            {s.status.pendingRealRestores} live title restoration obligation(s) saved. Rehearsal
            cannot satisfy these jobs.
          </p>
        )}
        {!!s.status.pendingUnverifiedRestores && (
          <p className="notice">
            {s.status.pendingUnverifiedRestores} unverified legacy title job(s) retained for audit.
            Recovery waits for a matching recorded live title.
          </p>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {tab === 'Court' && (
          <>
            {s.sentences.map((sentence) => (
              <section className="paper-card" key={`${sentence.case_id}-${sentence.sentence_id}`}>
                <span className="section-tag">SENTENCE IN PROGRESS · CASE #{sentence.case_id}</span>
                <h3>{sentence.text}</h3>
                <p>
                  {Math.max(0, Math.ceil((sentence.endsAt - s.court.now) / 1000))} seconds remaining
                </p>
                <button onClick={() => action('SERVED', { id: sentence.case_id })}>
                  Sentence served
                </button>
              </section>
            ))}
            <section className="court-toolbar">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.settings.courtOn}
                  onChange={(e) => update({ courtOn: e.target.checked })}
                />
                <span />
                Court {s.settings.courtOn ? 'open' : 'closed'}
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={s.settings.autoApprove}
                  onChange={(e) => update({ autoApprove: e.target.checked })}
                />
                <span />
                Auto-approve
              </label>
              <button className="primary" disabled={!!t} onClick={() => action('START')}>
                Call next case →
              </button>
            </section>
            <div className="court-columns">
              <div className="court-case-column">
                <section className="paper-card live-trial">
                  <div className="card-heading">
                    <span className="section-tag">NOW IN SESSION</span>
                    <span className="live-dot">{t ? '● LIVE' : '○ STANDBY'}</span>
                  </div>
                  {t ? (
                    <>
                      <h2>{t.caseName}</h2>
                      <p>{t.formalCharge}</p>
                      <div className="phase-display">
                        <strong>{t.phase.replaceAll('_', ' ')}</strong>
                        <span>{Math.max(0, Math.ceil((t.deadline - s.court.now) / 1000))}s</span>
                      </div>
                      <div className="mini-jury">
                        <span>
                          Guilty{' '}
                          <b>{Object.values(t.votes).filter((v) => v === 'guilty').length}</b>
                        </span>
                        <span>
                          Not guilty{' '}
                          <b>{Object.values(t.votes).filter((v) => v === 'not_guilty').length}</b>
                        </span>
                      </div>
                      <div className="button-row">
                        <button onClick={() => action('SKIP')}>Skip phase →</button>
                        <button
                          disabled={!s.sentences.some((sentence) => sentence.case_id === t.caseId)}
                          onClick={() => action('SERVED')}
                        >
                          Sentence served
                        </button>
                      </div>
                      <div className="button-row">
                        {t.exhibits.map((e, i) => (
                          <button
                            disabled={t.strikeUsed}
                            key={e.segment_id}
                            onClick={() => action('STRIKE', { index: i })}
                          >
                            Strike {String.fromCharCode(65 + i)}
                            {e.struck ? ' ✓' : ''}
                          </button>
                        ))}
                      </div>
                      <button className="danger" onClick={() => action('MISTRIAL')}>
                        Declare mistrial
                      </button>
                    </>
                  ) : (
                    <div className="empty-court">
                      <div className="gavel-symbol">⚖</div>
                      <h2>All quiet in the courtroom.</h2>
                      <p>File a case in chat, or run a demo to see the court in action.</p>
                      <button
                        className="primary"
                        onClick={() => run(() => api('demo'), 'Demo trial started')}
                      >
                        Run full demo trial →
                      </button>
                      <small>Works offline. No accounts or microphone needed.</small>
                    </div>
                  )}
                </section>
                <section className="paper-card docket-panel">
                  <div className="card-heading">
                    <span className="section-tag">THE DOCKET</span>
                    <span>
                      {
                        s.cases.filter((c) =>
                          ['filing', 'screening', 'queued', 'pending_approval'].includes(c.status),
                        ).length
                      }{' '}
                      open
                    </span>
                  </div>
                  {s.cases
                    .filter((c) =>
                      ['filing', 'screening', 'queued', 'pending_approval'].includes(c.status),
                    )
                    .map((c) => (
                      <article className="case-row" key={c.id}>
                        <span className="case-status">
                          #{String(c.case_no).padStart(3, '0')} · {c.status.replace('_', ' ')}
                        </span>
                        <h3>{c.name}</h3>
                        <p className={c.raw_flagged ? 'raw-flagged' : ''}>
                          Raw filing: {c.raw_charge}
                        </p>
                        <p>{c.formal_charge}</p>
                        {c.status === 'filing' && (
                          <>
                            <progress value={c.cosigners.length} max={c.threshold} />
                            <small>
                              {c.cosigners.length}/{c.threshold} co-signers
                            </small>
                          </>
                        )}
                        <div className="button-row">
                          <button
                            disabled={!['pending_approval', 'queued'].includes(c.status)}
                            onClick={() => action('APPROVE', { id: c.case_no })}
                          >
                            Approve
                          </button>
                          <button onClick={() => action('VETO', { id: c.case_no })}>Veto</button>
                        </div>
                      </article>
                    ))}
                  {!s.cases.some((c) =>
                    ['filing', 'screening', 'queued', 'pending_approval'].includes(c.status),
                  ) && (
                    <div className="docket-empty">
                      <span>THE DOCKET IS CLEAR</span>
                      <p>
                        Chat files a case with <code>!sue</code>.<br />
                        Co-signers bring it to the bench.
                      </p>
                    </div>
                  )}
                  <footer>
                    <b>House rule № 1</b>
                    <p>
                      Only on-stream claims with transcript receipts. The clerk screens every
                      filing.
                    </p>
                  </footer>
                </section>
              </div>
              <ComedyDesk
                state={s.comedy}
                now={s.court.now}
                connected={connected}
                run={run}
                camera={s.settings.webcam}
              />
            </div>
            <section className="quick-demo">
              <div>
                <span className="section-tag">DRESS REHEARSAL</span>
                <h3>A first-try promise. Six attempts. Seven jurors.</h3>
                <p>Inject receipts, file a lawsuit, hear the defense, and let chat decide.</p>
              </div>
              <button onClick={() => run(() => api('demo'), 'Demo trial started')} disabled={!!t}>
                Run full demo trial →
              </button>
            </section>
          </>
        )}
        {tab === 'Simulator' && (
          <section className="paper-card">
            <div className="card-heading">
              <span className="section-tag">FAKE CHAT, REAL COURT</span>
              <button className="primary" disabled={!!t} onClick={() => run(() => api('demo'))}>
                Run full demo trial →
              </button>
            </div>
            <label>
              Speaking as
              <select value={user} onChange={(e) => setUser(e.target.value)}>
                {[
                  'viewer1',
                  'viewer2',
                  'viewer3',
                  'viewer4',
                  'viewer5',
                  'viewer6',
                  'viewer7',
                  'viewer8',
                  'broadcaster',
                  'mod1',
                  'vip1',
                ].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label>
              Chat message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <button className="primary" onClick={send}>
              Send message →
            </button>
            <div className="button-row">
              <button onClick={() => batch('!cosign', 3)}>Cosign ×3</button>
              <button onClick={() => batch('!guilty', 5, 1)}>Vote guilty ×5</button>
              <button onClick={() => batch('!notguilty', 2, 6)}>Vote not guilty ×2</button>
              <button onClick={() => batch('!objection', 7, 1)}>Spam objection</button>
            </div>
            <p className="muted">
              Demo uses your current phase timers. Use Skip phase to speed up rehearsal.
            </p>
          </section>
        )}
        {tab === 'Transcript' && (
          <section className="paper-card">
            <span className="section-tag">LIVE TRANSCRIPT</span>
            <div className="button-row">
              <button
                className="primary"
                disabled={!s.status.transcriptionConfigured}
                onClick={() =>
                  run(async () => {
                    mic.current?.stop();
                    mic.current = new MicCapture(s.chunkMs, s.court.now - Date.now(), setMicState);
                    await mic.current.start();
                  })
                }
              >
                Start mic
              </button>
              <button onClick={() => mic.current?.stop()}>Stop mic</button>
              <span role="status">{micState}</span>
            </div>
            <p>Manual lines become stored, verbatim evidence.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api('transcript', { text: manual });
                  setManual('');
                });
              }}
            >
              <label>
                Manual line
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  required
                  maxLength={2000}
                />
              </label>
              <button className="primary">Enter into the record</button>
            </form>
            <div className="transcript-list">
              {s.segments.map((seg) => (
                <article key={seg.id}>
                  <time>{seg.timestamp}</time>
                  <p>{seg.text}</p>
                  <small>
                    {seg.id} · {seg.source}
                    {seg.broadcast_id !== s.status.broadcastId
                      ? ' · audit only: outside the active broadcast'
                      : ''}
                  </small>
                </article>
              ))}
            </div>
          </section>
        )}
        {tab === 'Settings' && (
          <SettingsEditor
            settings={s.settings}
            onSave={(settings) => run(() => api('settings', settings), 'Court rules saved')}
          />
        )}
        {tab === 'Records' && (
          <>
            <section className="paper-card">
              <span className="section-tag">
                RAP SHEET · {s.records.convictions.length} CONVICTIONS
              </span>
              {s.records.convictions.map((c) => (
                <article className="case-row" key={c.id}>
                  <h3>{c.name}</h3>
                  <p>
                    {c.guilty_votes} guilty · {c.not_guilty_votes} not guilty
                  </p>
                </article>
              ))}
              {!s.records.convictions.length && (
                <p>No convictions on record. The defendant enjoys a clean slate.</p>
              )}
            </section>
            <section className="paper-card">
              <span className="section-tag">PRECEDENTS</span>
              {s.records.precedents.map((p) => (
                <article className="case-row" key={p.id}>
                  <small>
                    {p.id} · {p.verdict.replace('_', ' ')}
                  </small>
                  <h3>{p.case_name}</h3>
                  <p>{p.summary}</p>
                </article>
              ))}
            </section>
            <section className="paper-card">
              <span className="section-tag">PLAINTIFF LEADERBOARD</span>
              <table>
                <thead>
                  <tr>
                    <th>Plaintiff</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Contempt</th>
                  </tr>
                </thead>
                <tbody>
                  {s.records.plaintiffs.map((p) => (
                    <tr key={p.user_id}>
                      <td>{p.login}</td>
                      <td>{p.wins}</td>
                      <td>{p.losses}</td>
                      <td>{p.contempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
        {tab === 'Diagnostics' && (
          <section className="paper-card">
            <span className="section-tag">CONNECTIONS</span>
            <p>
              Simulator adapters are active by default. Credentials are stored locally and never
              sent to the overlay.
            </p>
            <div className="button-row">
              <a className="button" href="/auth/broadcaster">
                Connect broadcaster
              </a>
              <a className="button" href="/auth/bot">
                Connect bot
              </a>
            </div>
            <label>
              Timeout test account (numeric Twitch ID)
              <input
                value={testUser}
                onChange={(e) => setTestUser(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <div className="button-row">
              {[
                'sendChat',
                'setTitle',
                'timeout',
                'createClip',
                'createMarker',
                'getStream',
                'createPoll',
                'clerk',
                'trialScript',
                'rebuttal',
                'verdict',
                'tts',
              ].map((name) => (
                <button
                  key={name}
                  onClick={() =>
                    run(async () => {
                      const result = await api('test', {
                        action: name,
                        ...(name === 'timeout' ? { userId: testUser } : {}),
                      });
                      setDiagnosticResult(JSON.stringify(result, null, 2));
                      if (result.url) await new Audio(result.url).play();
                    })
                  }
                >
                  Test {name}
                </button>
              ))}
            </div>
            <p className="muted">
              Title test reverts after 30 seconds. Live actions respect DRY_RUN. Audio is AI
              generated.
            </p>
            <pre className="diagnostic-result">{diagnosticResult}</pre>
          </section>
        )}
        <section className="activity">
          <div className="card-heading">
            <span className="section-tag">COURT ACTIVITY</span>
            <span>LOCAL AUDIT LOG</span>
          </div>
          {s.logs.slice(0, 12).map((l, i) => (
            <div key={`${l.at}-${i}`}>
              <time>{new Date(l.at).toLocaleTimeString()}</time>
              <b>{l.kind}</b>
              <span>{l.message}</span>
            </div>
          ))}
          {!s.logs.length && <p>The clerk is ready. Activity will appear here.</p>}
        </section>
        <footer className="panel-footer">
          COURT OF CHAT <span>Original characters. Verbatim receipts. Jury justice.</span>
        </footer>
      </main>
    </div>
  );
}
