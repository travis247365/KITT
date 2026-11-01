import { Icon } from '../icons';
import { Scanner } from '../kit';
import { useMemo } from 'react';
import { buildCards } from '../engine';
import { mmss, useCountdown, useStore } from '../state';
import { briefItems } from './shared';

export function Car() {
  const { world, themeFor, state } = useStore();
  const theme = themeFor('car');
  const left = useCountdown(world.pending);
  const talk = state.talk.device === 'car' ? state.talk : null;
  const busy = talk && (talk.phase === 'listening' || talk.phase === 'thinking');
  const total = useMemo(() => briefItems(buildCards(world)).total, [world]);
  const secs = Number(total.split(':')[0]) * 60 + Number(total.split(':')[1]); const done = Math.round(secs * 0.34);
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  return (
    <div className="car" data-theme={theme}>
      <div className="car-top"><span className="eyebrow">CarPlay · display only</span><span className="eyebrow">{world.offline ? 'Hub offline · cached' : 'Hub online'}</span></div>
      <div className="car-main">
        <section className="car-np" aria-label="Now playing">
          <div className="car-art" role="img" aria-label="KITT Briefings artwork"><span className="car-bar" /><span className="car-bar car-bar--w" /></div>
          <div className="car-np-body">
            <p className="eyebrow muted">Podcasts · KITT Briefings</p>
            <h2 className="car-title">Morning brief · {world.date}</h2>
            <p className="t-body muted">Rendered {world.asOf} · {total}</p>
            <div className="car-prog"><i /></div>
            <div className="car-times"><span>{fmt(done)}</span><span>−{fmt(secs - done)}</span></div>
            <div className="car-ctrl" role="group" aria-label="Transport (use Siri or the car controls)">
              <span className="car-c"><Icon name="back" size={34} /></span><span className="car-c car-c--main"><Icon name="pause" size={46} /></span><span className="car-c"><Icon name="skip" size={34} /></span>
            </div>
          </div>
        </section>
        <section className={`car-la${world.pending ? ' car-la--inv' : ''}`} aria-label="Live activity">
          {world.pending ? (
            <>
              <p className="eyebrow">Waiting for your OK · {left !== null ? `expires in ${mmss(left)}` : ''}</p>
              <h2 className="car-la-title">{world.pending.summary}</h2>
              <p className="car-la-say">Say “Kit, confirm” or “Kit, cancel”.</p>
              <p className="t-small car-la-note"><Icon name="lock" size={14} /> Buttons are inactive in CarPlay. Voice only.</p>
            </>
          ) : world.critical ? (
            <>
              <p className="eyebrow">Security · critical</p>
              <h2 className="car-la-title">A repository became public</h2>
              <p className="car-la-say">Say “Kit, security status”.</p>
            </>
          ) : (
            <>
              <p className="eyebrow muted">KITT</p>
              <h2 className="car-la-title">{world.offline ? 'Reading from the cached copy' : 'Nothing is waiting for you'}</h2>
              <p className="car-la-say">Say “Hey Siri, ask Kit”.</p>
            </>
          )}
        </section>
      </div>
      <div className="car-siri" aria-live="polite">
        {busy ? <Scanner /> : <span className="car-siri-bar" />}
        {talk && talk.phase !== 'idle' ? (
          <div><p className="car-said">“{talk.transcript || '…'}”</p>{talk.phase === 'answer' && <p className="car-ans">{talk.answer?.speak}</p>}</div>
        ) : <p className="car-said muted">Hey Siri, ask Kit</p>}
      </div>
    </div>
  );
}

export function CarControls() {
  const { say } = useStore();
  return (
    <div className="proto-chips" role="group" aria-label="Simulate what you say to Siri">
      <span className="eyebrow">Say to Siri</span>
      {["What's on my plate", 'Cash position', 'Kit, confirm', 'Kit, cancel'].map((t) => <button key={t} type="button" onClick={() => say(t, 'car')}>{t}</button>)}
    </div>
  );
}
