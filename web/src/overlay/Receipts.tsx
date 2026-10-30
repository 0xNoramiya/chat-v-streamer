import { useEffect, useRef, useState } from 'react';
import type { Trial } from '../shared/types';
import { rectStyle, type Rect } from './layout';
export function Receipts({ trial, area, now }: { trial: Trial; area: Rect; now: number }) {
  const presented =
    trial.phase === 'CALL_TO_ORDER'
      ? []
      : trial.exhibits.filter(
          (e, i) =>
            e.added_in === 'rebuttal' || trial.phase !== 'EXHIBITS' || i <= trial.exhibitIndex,
        );
  const preferred =
    trial.phase === 'EXHIBITS' ? trial.exhibitIndex : Math.max(0, presented.length - 1);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(
    () => setSelected(null),
    [trial.caseId, trial.phase, trial.exhibitIndex, presented.length],
  );
  const index = selected ?? preferred,
    exhibit = presented[index];
  return (
    <section
      className="exhibit-stack receipt-zone"
      aria-label="Stored receipts"
      style={rectStyle(area)}
    >
      <nav className="receipt-tabs" aria-label="Exhibits">
        {trial.exhibits.map((e, i) => (
          <button
            key={e.segment_id}
            disabled={!presented.includes(e)}
            aria-pressed={index === i && !!exhibit}
            onClick={() => setSelected(i)}
          >
            EXHIBIT {String.fromCharCode(65 + i)}
            {e.struck ? ' · STRICKEN' : ''}
          </button>
        ))}
      </nav>
      {exhibit ? (
        <Receipt
          key={`${exhibit.segment_id}:${trial.phase}:${trial.phaseStartedAt}`}
          exhibit={exhibit}
          index={index}
          now={now}
          trial={trial}
        />
      ) : (
        <div className="receipts-waiting">
          <span>THE CHARGE</span>
          <h2>{trial.formalCharge}</h2>
          <p>The prosecution will present the stored receipts.</p>
        </div>
      )}
    </section>
  );
}
function Receipt({
  exhibit: e,
  index,
  now,
  trial,
}: {
  exhibit: Trial['exhibits'][number];
  index: number;
  now: number;
  trial: Trial;
}) {
  const scroll = useRef<HTMLQuoteElement>(null),
    [pages, setPages] = useState(1),
    [page, setPage] = useState(1),
    [manual, setManual] = useState(false);
  useEffect(() => {
    const element = scroll.current!;
    const measure = () =>
      setPages(Math.max(1, Math.ceil(element.scrollHeight / element.clientHeight)));
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts.ready.then(measure);
    measure();
    return () => observer.disconnect();
  }, [e.text]);
  useEffect(() => {
    const element = scroll.current;
    if (
      !element ||
      manual ||
      trial.phase !== 'EXHIBITS' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const step = Math.floor(
      (now - trial.phaseStartedAt) /
        Math.max(2500, (trial.deadline - trial.phaseStartedAt) / pages),
    );
    element.scrollTop = Math.min(step, pages - 1) * element.clientHeight;
  }, [now, manual, pages, trial]);
  const turn = (direction: number) => {
    setManual(true);
    const element = scroll.current!;
    element.scrollTop += direction * element.clientHeight;
  };
  return (
    <article className={`exhibit ${e.struck ? 'struck' : ''}`}>
      <div className="exhibit-label">
        EXHIBIT {String.fromCharCode(65 + index)}
        <time>STREAM {e.timestamp}</time>
      </div>
      <blockquote
        ref={scroll}
        className="quote-scroll"
        tabIndex={0}
        aria-label="Verbatim stored transcript"
        onWheel={() => setManual(true)}
        onScroll={() =>
          setPage(
            Math.min(
              pages,
              scroll.current &&
                scroll.current.scrollTop + scroll.current.clientHeight >=
                  scroll.current.scrollHeight - 1
                ? pages
                : Math.floor(
                    (scroll.current?.scrollTop ?? 0) / (scroll.current?.clientHeight ?? 1),
                  ) + 1,
            ),
          )
        }
      >
        “<span className="quote-verbatim">{e.text}</span>”
      </blockquote>
      <div className="receipt-meta">
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
          <p>{e.framing}</p>
          <small>
            STORED {e.source?.toUpperCase() ?? 'TRANSCRIPT'} · {e.segment_id}
          </small>
        </div>
      </div>
      <footer className="receipt-pages">
        <span>
          {pages > 1 ? `Full receipt · Page ${page} of ${pages}` : 'Full receipt · Verbatim'}
        </span>
        {pages > 1 && (
          <div>
            <button onClick={() => turn(-1)} disabled={page === 1} aria-label="Previous quote page">
              ←
            </button>
            <button onClick={() => turn(1)} disabled={page >= pages} aria-label="Next quote page">
              →
            </button>
          </div>
        )}
      </footer>
      {e.struck && <b className="strike-stamp">STRICKEN</b>}
    </article>
  );
}
