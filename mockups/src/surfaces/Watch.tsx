import { useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { Scanner } from '../kit';
import { zmw } from '../data';
import { buildCards } from '../engine';
import { speak } from '../speech';
import { mmss, useCountdown, useStore } from '../state';
import { briefItems } from './shared';

export type WatchPage = 'face' | 'now' | 'brief' | 'idea' | 'notif';
export const WATCH_PAGES: { id: WatchPage; label: string }[] = [{ id: 'face', label: 'Face' }, { id: 'now', label: 'Now' }, { id: 'brief', label: 'Brief' }, { id: 'idea', label: 'Idea' }, { id: 'notif', label: 'Alert' }];

function Comp({ icon, label, value, hot }: { icon: IconName; label: string; value: string; hot?: boolean }) {
  return (
    <div className={`wcomp${hot ? ' wcomp--hot' : ''}`} role="img" aria-label={`${label} ${value}`}>
      <Icon name={icon} size={16} /><span className="eyebrow">{label}</span><span className="wcomp-v">{value}</span>
    </div>
  );
}

export function Watch({ page: pageProp, onPage }: { page?: WatchPage; onPage?: (p: WatchPage) => void }) {
  const { world, themeFor, say, act, state } = useStore();
  const [inner, setInner] = useState<WatchPage>('face');
  const page = pageProp ?? inner; const setPage = (p: WatchPage) => { setInner(p); onPage?.(p); };
  const theme = themeFor('watch');
  const cards = useMemo(() => buildCards(world), [world]);
  const left = useCountdown(world.pending);
  const lastWheel = useRef(0);
  const talk = state.talk.device === 'watch' ? state.talk : null;
  const top = cards[0];
  const onWheel = (e: React.WheelEvent) => {
    const now = Date.now(); if (now - lastWheel.current < 350) return; lastWheel.current = now;
    const i = WATCH_PAGES.findIndex((p) => p.id === page); const n = Math.max(0, Math.min(WATCH_PAGES.length - 1, i + (e.deltaY > 0 ? 1 : -1))); setPage(WATCH_PAGES[n].id);
  };
  const cash = `K${(world.cashTotal / 1000).toFixed(1)}k`;

  return (
    <div className="watch" data-theme={theme} onWheel={onWheel}>
      {page === 'face' && (
        <div className="wf">
          <div className="wf-top"><span className="eyebrow">{world.date}</span>{world.offline && <span className="eyebrow">Offline</span>}</div>
          <div className="wf-time num">7:12</div>
          <div className="wf-grid">
            <Comp icon="check" label="OK" value={world.pending ? '1' : '0'} hot={Boolean(world.pending)} />
            <Comp icon="shield" label="Sec" value={world.critical ? '!' : world.actionable ? String(world.actionable) : 'OK'} hot={Boolean(world.critical)} />
            <Comp icon="wallet" label="Cash" value={cash} />
            <Comp icon="plane" label="Trip" value="9 JAN" />
          </div>
        </div>
      )}
      {page === 'now' && (
        <div className="wn">
          <p className="eyebrow">Now · 7:12</p>
          {world.pending ? (
            <div className="wcard wcard--inv">
              <p className="eyebrow">Waiting for OK{left !== null ? ` · ${mmss(left)}` : ''}</p>
              <p className="wtitle">Reply to the insurance broker</p>
              <button type="button" className="wbtn wbtn--primary" disabled={world.offline} onClick={() => act('confirm', 'watch')}><Icon name="check" size={16} />Confirm</button>
              <button type="button" className="wbtn" onClick={() => act('cancel', 'watch')}>Cancel</button>
            </div>
          ) : (
            <div className="wcard">
              <p className="eyebrow">{top.eyebrow}</p>
              <p className="wtitle">{top.headline}</p>
              <button type="button" className="wbtn" onClick={() => speak(top.speak)}><Icon name="play" size={12} />Read</button>
            </div>
          )}
          {cards.filter((c) => c.skill !== 'confirm').slice(world.pending ? 0 : 1, world.pending ? 0 : 3).map((c) => (
            <div className="wrow" key={c.id}><Icon name={c.icon} size={16} /><span>{c.headline}</span></div>
          ))}
        </div>
      )}
      {page === 'brief' && (
        <div className="wb">
          <p className="eyebrow">Morning brief</p>
          <button type="button" className="wplay" aria-label="Play brief" onClick={() => speak(briefItems(cards).items.map((i) => i.text).join(' '))}><Icon name="play" size={34} /></button>
          <p className="wtitle" style={{ textAlign: 'center' }}>{briefItems(cards).total} · {world.offline ? 'cached' : '07:05'}</p>
          <p className="t-micro muted" style={{ textAlign: 'center' }}>Plays over AirPods. Long audio needs a Bluetooth route.</p>
        </div>
      )}
      {page === 'idea' && (
        <div className="wi">
          <p className="eyebrow">Idea</p>
          <button type="button" className="wmic" aria-label="Dictate an idea" onClick={() => say('idea: turn the brief into a podcast', 'watch')}><Icon name="mic" size={36} /></button>
          {talk && talk.phase !== 'idle' ? (
            <>
              {(talk.phase === 'listening' || talk.phase === 'thinking') && <Scanner />}
              {talk.transcript && <p className="t-small" style={{ textAlign: 'center' }}>“{talk.transcript}”</p>}
              {talk.phase === 'answer' && <p className="wtitle" style={{ textAlign: 'center' }}>{talk.answer?.via === 'unknown' ? 'No match' : 'Captured'}</p>}
            </>
          ) : <p className="t-small muted" style={{ textAlign: 'center' }}>Tap, then speak</p>}
        </div>
      )}
      {page === 'notif' && (
        <div className="wnot">
          <p className="eyebrow">KITT · now</p>
          <p className="wtitle">{world.pending ? 'Draft ready: reply to the insurance broker' : world.critical ? 'Security critical: a repository became public' : 'Your morning brief is ready'}</p>
          {world.pending ? (
            <>
              <button type="button" className="wbtn wbtn--primary" disabled={world.offline} onClick={() => act('confirm', 'watch')}>Confirm</button>
              <button type="button" className="wbtn" onClick={() => act('cancel', 'watch')}>Cancel</button>
              <button type="button" className="wlink">Later</button>
            </>
          ) : (
            <><button type="button" className="wbtn wbtn--primary" onClick={() => setPage('now')}>Open</button><button type="button" className="wlink">Dismiss</button></>
          )}
        </div>
      )}
      <span className="wdots" aria-hidden="true">{WATCH_PAGES.map((p) => <i key={p.id} className={p.id === page ? 'on' : ''} />)}</span>
      <span className="sr-only">Page {page}. Scroll the Digital Crown to change pages.</span>
      {world.offline && page !== 'face' && <span className="woff" aria-label="Offline"><Icon name="off" size={14} /></span>}
      <span className="sr-only">{zmw(world.cashTotal)}</span>
    </div>
  );
}
