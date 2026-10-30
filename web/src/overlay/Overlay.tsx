import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useCourt } from '../shared/client';
import { CourtAudio } from './audio';
import { ComedyPlayback } from './comedyPlayback';
import { ComedyLayer } from './ComedyLayer';
import { comedyPack, type EffectInstance } from '../shared/comedy';
import { Receipts } from './Receipts';
import { cameraCutout, courtLayout, rectStyle } from './layout';
import { Owl } from '../shared/Owl';
import { speechScope } from '../shared/speech';
import type { Snapshot, CourtEvent } from '../shared/types';
import './overlay.css';
const labels: Record<string, string> = {
  CALL_TO_ORDER: 'All rise',
  EXHIBITS: 'The receipts',
  DEFENSE: 'The defense',
  REBUTTAL: 'Cross-examination',
  JURY: 'The jury decides',
  VERDICT: 'The verdict',
  SENTENCING: 'The sentence',
  ADJOURN: 'Court adjourned',
};
export function Overlay() {
  const [caption, setCaption] = useState<Extract<CourtEvent, { type: 'caption' }> | null>(null),
    [toast, setToast] = useState('');
  const audio = useRef<CourtAudio | null>(null);
  const [gags, setGags] = useState<EffectInstance[]>([]);
  const comedy = useRef<ComedyPlayback | null>(null);
  if (!comedy.current) comedy.current = new ComedyPlayback(setGags);
  if (!audio.current) audio.current = new CourtAudio(setCaption);
  const onEvent = useCallback((e: CourtEvent) => {
    if (e.type === 'comedy_trigger') comedy.current?.accept(e);
    if (e.type === 'caption') audio.current?.enqueue(e);
    if (e.type === 'speech') audio.current?.attach(e);
    if (e.type === 'sfx') audio.current?.sfx(e.name);
    if (e.type === 'precedent') {
      setToast(e.text);
      setTimeout(() => setToast(''), 5000);
    }
  }, []);
  const sync = useCallback((snapshot: Snapshot) => {
    comedy.current?.sync(snapshot.comedy);
    audio.current?.sync(speechScope(snapshot.court.trial), snapshot.court.now);
    if (snapshot.caption) audio.current?.enqueue(snapshot.caption);
  }, []);
  const { snapshot: s, connected } = useCourt(false, onEvent, sync);
  useEffect(() => {
    for (const effect of comedyPack.effects) {
      const image = new Image();
      image.src = effect.asset;
    }
    document.body.classList.add('overlay-body');
    document.documentElement.classList.add('overlay-html');
    return () => {
      document.body.classList.remove('overlay-body');
      document.documentElement.classList.remove('overlay-html');
      audio.current?.close();
      comedy.current?.close();
    };
  }, []);
  if (!s) return <div className="overlay-connection">Connecting to the court…</div>;
  const t = s.court.trial;
  const effects = (
    <ComedyLayer
      instances={[...s.comedy.props, ...gags]}
      camera={s.settings.webcam}
      serverNow={comedy.current.serverNow}
    />
  );
  const seconds = t ? Math.max(0, Math.ceil((t.deadline - s.court.now) / 1000)) : 0;
  if (!t)
    return (
      <>
        {s.settings.courtOn ? (
          <div className="idle-stage" style={{ clipPath: cameraCutout(s.settings.webcam) }}>
            <button
              className="audio-enable"
              onClick={() => {
                audio.current?.unlock();
                comedy.current?.sounds.unlock();
              }}
            >
              Enable audio
            </button>
            {s.sentences.map((sentence) => (
              <div className="sentence-active" key={`${sentence.case_id}-${sentence.sentence_id}`}>
                Case #{sentence.case_id} · {sentence.text}
                <strong>
                  {Math.max(0, Math.ceil((sentence.endsAt - s.court.now) / 1000))}s remaining ·
                  Awaiting sentence served
                </strong>
              </div>
            ))}
            {caption && (
              <div className="idle-caption">
                <b>{caption.speaker}</b>
                <p>{caption.text}</p>
              </div>
            )}
            <aside className="docket-ticker">
              <b>COURT OF CHAT</b>
              <span>
                {s.cases
                  .filter((c) =>
                    ['filing', 'queued', 'pending_approval', 'screening'].includes(c.status),
                  )
                  .slice(0, 3)
                  .map((c) => (
                    <div key={c.id}>
                      <strong>
                        #{c.case_no} {c.name}
                      </strong>
                      {c.status === 'filing' ? (
                        <>
                          <progress value={c.cosigners.length} max={c.threshold} />
                          <small>
                            {c.cosigners.length}/{c.threshold} co-signers ·{' '}
                            {Math.max(
                              0,
                              Math.ceil(
                                (c.created_at_ms + s.settings.cosignWindowMs - s.court.now) / 1000,
                              ),
                            )}
                            s
                          </small>
                        </>
                      ) : (
                        <small>{c.status.replace('_', ' ')}</small>
                      )}
                    </div>
                  ))}
                {!s.cases.some((c) =>
                  ['filing', 'queued', 'pending_approval', 'screening'].includes(c.status),
                ) && 'The docket is open. Type !sue to file a case.'}
              </span>
            </aside>
          </div>
        ) : null}
        {effects}
      </>
    );
  const guilty = Object.values(t.votes).filter((v) => v === 'guilty').length,
    total = Object.keys(t.votes).length;
  const sentence = s.settings.penalCode.find((p) => p.id === t.verdictScript?.sentence_id);
  const rect = s.settings.webcam,
    layout = courtLayout(rect);
  return (
    <>
      <main
        className={`courtroom ${new URLSearchParams(location.search).has('debug') ? 'debug' : ''}`}
      >
        <div className="court-content" style={{ clipPath: cameraCutout(rect) }}>
          <button
            className="audio-enable"
            onClick={() => {
              audio.current?.unlock();
              comedy.current?.sounds.unlock();
            }}
          >
            Enable audio
          </button>
          <div
            className="court-backdrop"
            style={{
              clipPath: cameraCutout(rect),
            }}
          />
          <header className="court-header">
            <div className="seal">
              COURT
              <br />
              <span>OF</span> CHAT
            </div>
            <div>
              <span className="eyebrow">THE PEOPLE HAVE RECEIPTS</span>
              <h1>{t.caseName}</h1>
              <p>{t.formalCharge}</p>
            </div>
            <div
              className="phase-clock"
              style={
                {
                  '--progress': `${Math.max(0, ((t.deadline - s.court.now) / (t.deadline - t.phaseStartedAt)) * 100)}%`,
                } as CSSProperties
              }
            >
              <strong>{seconds}</strong>
              <span>{labels[t.phase]}</span>
            </div>
          </header>
          {t.script.cited_precedent_id && (
            <div className="cited-precedent">
              Citing precedent {t.script.cited_precedent_id} · Established case law
            </div>
          )}
          <div
            className="defendant-window"
            style={{ left: rect.x - 8, top: rect.y - 8, width: rect.w + 16, height: rect.h + 16 }}
          >
            <span>THE DEFENDANT</span>
          </div>
          <Receipts trial={t} area={layout.receipts} now={s.court.now} />
          <aside className="phase-rail" style={rectStyle(layout.rail)}>
            <div className="judge">
              <Owl talking={caption?.speaker === 'Judge Docket'} />
              <div className="judge-bench">THE HONORABLE JUDGE DOCKET</div>
            </div>
            <div className="phase-content">
              {t.phase === 'DEFENSE' && (
                <div className="defense-card">
                  <span>THE FLOOR IS YOURS</span>
                  <strong>{seconds}s</strong>
                  <p>{s.status.capture?.detail ?? 'Mic capture status unavailable'}</p>{' '}
                  <aside className="objection">
                    <span>OBJECTION!</span>
                    <progress max={s.settings.objectionThreshold} value={t.objections.length} />
                    <small>
                      {t.objections.length}/{s.settings.objectionThreshold}
                    </small>
                  </aside>
                </div>
              )}
              {t.phase === 'JURY' && (
                <section className="jury">
                  <h2>CHAT, REACH YOUR VERDICT.</h2>
                  <div>
                    <span>!guilty</span>
                    <b>{guilty}</b>
                    <span>!notguilty</span>
                    <b>{total - guilty}</b>
                  </div>
                  <div className="jury-bars">
                    <i style={{ width: `${total ? (guilty / total) * 100 : 50}%` }} />
                    <i style={{ width: `${total ? ((total - guilty) / total) * 100 : 50}%` }} />
                  </div>
                  <small>
                    {s.status.sim
                      ? 'Simulated jury · last vote counts'
                      : s.status.eventsub === 'connected'
                        ? 'Last vote counts. A tie acquits.'
                        : 'Chat disconnected · only received votes count'}
                  </small>
                </section>
              )}
              {t.phase === 'VERDICT' && (
                <div key={t.phase} className={`verdict-stamp ${t.verdict}`}>
                  {t.verdict?.replace('_', ' ')}
                </div>
              )}
              {t.phase === 'SENTENCING' && (
                <div className="sentence-card">
                  <h2>
                    {t.verdict === 'guilty'
                      ? (sentence?.text ?? 'The conviction is entered into the record.')
                      : t.verdict === 'not_guilty'
                        ? 'The defendant is free to stream.'
                        : 'No sentence. Mistrial.'}
                  </h2>
                </div>
              )}
            </div>
          </aside>
          {t.phase === 'SENTENCING' && (
            <div
              className={`sentence-outcome ${t.sentenceState?.state ?? 'pending'}`}
              style={{ left: rect.x, top: rect.y + rect.h + 56, width: rect.w }}
            >
              {t.sentenceState?.detail ?? 'Awaiting consequence confirmation'}{' '}
              {sentence?.type === 'manual' && (
                <strong>
                  {t.sentenceServed
                    ? 'SENTENCE SERVED'
                    : `${Math.max(0, Math.ceil(((s.sentences.find((p) => p.case_id === t.caseId)?.endsAt ?? s.court.now) - s.court.now) / 1000))}s · Awaiting sentence served`}
                </strong>
              )}
            </div>
          )}
          {caption && (
            <div
              className="caption"
              data-line-id={caption.id}
              key={caption.id}
              style={rectStyle(layout.caption)}
            >
              <b>{caption.speaker}</b>
              <p>{caption.text}</p>
            </div>
          )}
          {toast && (
            <div className="precedent-toast" style={{ left: layout.receipts.x }}>
              {toast}
            </div>
          )}
          {!connected && <span className="overlay-connection">Reconnecting…</span>}
        </div>
      </main>
      {effects}
    </>
  );
}
