import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useCourt } from '../shared/client';
import { CourtAudio } from './audio';
import { Owl } from '../shared/Owl';
import type { CourtEvent } from '../shared/types';
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
  if (!audio.current) audio.current = new CourtAudio(setCaption);
  const onEvent = useCallback((e: CourtEvent) => {
    if (e.type === 'caption') audio.current?.enqueue(e);
    if (e.type === 'sfx') audio.current?.sfx(e.name);
    if (e.type === 'precedent') {
      setToast(e.text);
      setTimeout(() => setToast(''), 5000);
    }
  }, []);
  const { snapshot: s, connected } = useCourt(false, onEvent);
  useEffect(() => {
    audio.current?.clear();
  }, [s?.court.trial?.caseId, s?.court.trial?.phase]);
  useEffect(() => {
    document.body.classList.add('overlay-body');
    document.documentElement.classList.add('overlay-html');
    return () => {
      document.body.classList.remove('overlay-body');
      document.documentElement.classList.remove('overlay-html');
      audio.current?.close();
    };
  }, []);
  if (!s) return <div className="overlay-connection">Connecting to the court…</div>;
  const t = s.court.trial;
  const seconds = t ? Math.max(0, Math.ceil((t.deadline - s.court.now) / 1000)) : 0;
  if (!t)
    return s.settings.courtOn ? (
      <>
        {s.sentences.map((sentence) => (
          <div className="sentence-active" key={`${sentence.case_id}-${sentence.sentence_id}`}>
            Case #{sentence.case_id} · {sentence.text}
            <strong>
              {Math.max(0, Math.ceil((sentence.endsAt - s.court.now) / 1000))}s remaining · Awaiting
              sentence served
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
      </>
    ) : null;
  const guilty = Object.values(t.votes).filter((v) => v === 'guilty').length,
    total = Object.keys(t.votes).length;
  const sentence = s.settings.penalCode.find((p) => p.id === t.verdictScript?.sentence_id);
  const rect = s.settings.webcam;
  return (
    <main
      className={`courtroom ${new URLSearchParams(location.search).has('debug') ? 'debug' : ''}`}
    >
      <button className="audio-enable" onClick={() => audio.current?.unlock()}>
        Enable audio
      </button>
      <div
        className="court-backdrop"
        style={{
          clipPath: `polygon(evenodd, 0 0,1920px 0,1920px 1080px,0 1080px,0 0,${rect.x}px ${rect.y}px,${rect.x + rect.w}px ${rect.y}px,${rect.x + rect.w}px ${rect.y + rect.h}px,${rect.x}px ${rect.y + rect.h}px,${rect.x}px ${rect.y}px)`,
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
      <div className="judge">
        <Owl talking={caption?.speaker === 'Judge Docket'} />
        <div className="judge-bench">THE HONORABLE JUDGE DOCKET</div>
      </div>
      <div
        className="defendant-window"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        <span>THE DEFENDANT</span>
      </div>
      <div className="exhibit-stack">
        {t.exhibits
          .filter(
            (e, i) =>
              e.added_in === 'rebuttal' ||
              (t.phase !== 'CALL_TO_ORDER' && (t.phase !== 'EXHIBITS' || i <= t.exhibitIndex)),
          )
          .map((e, i) => (
            <article key={e.segment_id} className={`exhibit ${e.struck ? 'struck' : ''}`}>
              <div className="exhibit-label">
                EXHIBIT {String.fromCharCode(65 + i)}
                <time>STREAM {e.timestamp}</time>
              </div>
              <div className="receipt">
                <div className="photo">
                  {e.frame_url ? (
                    <img src={e.frame_url} alt={`Stream at ${e.timestamp}`} />
                  ) : (
                    <span>
                      NO PHOTO
                      <br />
                      ON FILE
                    </span>
                  )}
                </div>
                <div>
                  <blockquote>“{e.text}”</blockquote>
                  <p>{e.framing}</p>
                </div>
              </div>
              {e.struck && <b className="strike-stamp">STRICKEN</b>}
            </article>
          ))}
      </div>
      {t.phase === 'DEFENSE' && (
        <div className="defense-card">
          <span>THE FLOOR IS YOURS</span>
          <strong>{seconds}s</strong>
          <p>The transcript is listening.</p>
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
          <small>Last vote counts. A tie acquits. No votes: mistrial.</small>
        </section>
      )}
      {t.phase === 'VERDICT' && (
        <div key={t.phase} className={`verdict-stamp ${t.verdict}`}>
          {t.verdict?.replace('_', ' ')}
        </div>
      )}
      {t.phase === 'SENTENCING' && (
        <div className="sentence-card">
          <span>BY ORDER OF THE COURT</span>
          <h2>
            {t.verdict === 'guilty'
              ? (sentence?.text ?? 'The conviction is entered into the record.')
              : t.verdict === 'not_guilty'
                ? 'The defendant is free to stream.'
                : 'No sentence. Mistrial.'}
          </h2>
          <p>{t.verdictScript?.sentence_flavor}</p>
          {sentence?.type === 'manual' && (
            <strong>
              {t.sentenceServed
                ? 'SENTENCE SERVED'
                : `${Math.max(0, Math.ceil(((s.sentences.find((p) => p.case_id === t.caseId)?.endsAt ?? s.court.now) - s.court.now) / 1000))}s · Awaiting sentence served`}
            </strong>
          )}
        </div>
      )}
      <aside className="objection">
        <span>OBJECTION!</span>
        <progress max={s.settings.objectionThreshold} value={t.objections.length} />
        <small>
          {t.objections.length}/{s.settings.objectionThreshold}
        </small>
      </aside>
      {caption && (
        <div className="caption" key={caption.text}>
          <b>{caption.speaker}</b>
          <TypedCaption text={caption.text} />
        </div>
      )}
      {toast && <div className="precedent-toast">{toast}</div>}
      {!connected && <span className="overlay-connection">Reconnecting…</span>}
    </main>
  );
}

function TypedCaption({ text }: { text: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const timer = setInterval(
      () =>
        setCount((n) => {
          if (n >= text.length) clearInterval(timer);
          return Math.min(n + 3, text.length);
        }),
      30,
    );
    return () => clearInterval(timer);
  }, [text]);
  return (
    <p aria-label={text}>
      <span aria-hidden="true">{text.slice(0, count)}</span>
    </p>
  );
}
