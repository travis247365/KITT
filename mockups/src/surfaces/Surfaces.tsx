import { useMemo, type CSSProperties } from 'react';
import { Icon } from '../icons';
import { KMark, ProvChip, Spark } from '../kit';
import { zmw } from '../data';
import { buildCards } from '../engine';
import { PhoneFrame, PHONE } from '../devices/Frames';
import { ScaledBox } from '../devices/Stage';
import { mmss, useCountdown, useStore } from '../state';
import { briefItems } from './shared';

export function LockScreen() {
  const { world, themeFor, state } = useStore();
  const theme = themeFor('phone'); const left = useCountdown(world.pending);
  const cards = useMemo(() => buildCards(world), [world]);
  return (
    <div className="lock" data-theme={theme} style={{ '--fs': state.large ? 1.2 : 1 } as CSSProperties}>
      <div className="lock-head"><Icon name="lock" size={18} /><p className="eyebrow">{world.date}</p><p className="lock-time num">7:12</p></div>
      <div className="lock-widgets" role="group" aria-label="Lock Screen widgets">
        <div className="lw" role="img" aria-label={`${world.pending ? 1 : 0} waiting`}><Icon name="check" size={18} /><b>{world.pending ? 1 : 0}</b><span>OK</span></div>
        <div className="lw" role="img" aria-label={`Security ${world.critical ? 'critical' : world.actionable}`}><Icon name="shield" size={18} /><b>{world.critical ? '!' : world.actionable}</b><span>SEC</span></div>
        <div className="lw" role="img" aria-label={`Cash ${zmw(world.cashTotal)}`}><Icon name="wallet" size={18} /><b>{(world.cashTotal / 1000).toFixed(0)}k</b><span>CASH</span></div>
      </div>
      <div className={`la${world.pending ? ' la--inv' : ''}`} aria-label="Live Activity">
        <div className="la-head"><KMark small /><p className="eyebrow">{world.pending ? 'Waiting for your OK' : 'Morning brief ready'}</p>{world.pending && left !== null && <span className="t-micro tab-num" style={{ marginLeft: 'auto' }}>{mmss(left)}</span>}</div>
        {world.pending ? (
          <>
            <p className="la-title">{world.pending.summary}</p>
            <div className="la-btns"><span className="la-btn la-btn--primary"><Icon name="lock" size={14} />Confirm</span><span className="la-btn">Cancel</span></div>
            <p className="t-micro la-note">Unlock to confirm. Buttons are inactive on a locked phone.</p>
          </>
        ) : (
          <>
            <p className="la-title">{cards[0].headline}</p>
            <p className="t-small muted">{briefItems(cards).total} · tap to play</p>
          </>
        )}
      </div>
      <div className="banner" aria-label="Notification">
        <div className="la-head"><KMark small /><p className="eyebrow">KITT · now</p></div>
        <p className="la-title" style={{ fontSize: 15 }}>{world.critical ? 'Security critical: a repository became public' : `Security: ${world.actionable} ${world.actionable === 1 ? 'finding needs' : 'findings need'} attention`}</p>
        <p className="t-micro muted">Counts only, no client names. Hold for Confirm · Cancel · Later.</p>
      </div>
      <p className="lock-foot t-micro">Action button: press to talk to Kit</p>
    </div>
  );
}

export function Island() {
  const { world } = useStore(); const left = useCountdown(world.pending);
  return (
    <div className="islands">
      <div>
        <p className="eyebrow muted">Compact</p>
        <div className="isl isl--c"><KMark small /><span className="tab-num">{left !== null ? mmss(left) : 'Brief'}</span></div>
      </div>
      <div>
        <p className="eyebrow muted">Expanded (unlocked)</p>
        <div className="isl isl--x">
          <div className="la-head"><KMark small /><p className="eyebrow" style={{ color: '#fff' }}>{world.pending ? 'Waiting for your OK' : 'Morning brief'}</p>{left !== null && <span className="t-micro tab-num" style={{ marginLeft: 'auto' }}>{mmss(left)}</span>}</div>
          <p className="la-title" style={{ color: '#fff' }}>{world.pending ? world.pending.summary : 'Security: 1 finding needs attention'}</p>
          {world.pending ? <div className="la-btns"><span className="la-btn la-btn--primary" style={{ background: '#00bcd4' }}>Confirm</span><span className="la-btn" style={{ borderColor: '#fff', color: '#fff' }}>Cancel</span></div> : <span className="la-btn" style={{ borderColor: '#fff', color: '#fff', width: 120 }}><Icon name="play" size={12} />Play</span>}
        </div>
      </div>
    </div>
  );
}

export function Widgets() {
  const { world, themeFor } = useStore(); const theme = themeFor('phone');
  const cards = useMemo(() => buildCards(world), [world]);
  return (
    <div className="widgets" data-theme={theme}>
      <div className="wg wg--s">
        <p className="eyebrow muted">Now</p>
        <p className="wg-big num">{world.pending ? 1 : world.actionable}</p>
        <p className="t-small">{world.pending ? 'waiting for your OK' : world.actionable === 1 ? 'finding to review' : 'findings to review'}</p>
        <p className="t-micro muted">{world.critical ? 'Critical' : 'None critical'}</p>
      </div>
      <div className="wg wg--s">
        <p className="eyebrow muted">Cash</p>
        <p className="wg-big num" style={{ fontSize: 28 }}>{zmw(world.cashTotal)}</p>
        <Spark points={world.spendDaily.slice(-14)} width={120} height={28} label="Spend over 14 days" />
        <ProvChip kind="measured" />
      </div>
      <div className="wg wg--m">
        <div><p className="eyebrow muted">Morning brief · {briefItems(cards).total}</p><p className="la-title" style={{ marginTop: 8 }}>{cards[0].headline}</p><p className="t-small muted" style={{ marginTop: 4 }}>{cards[0].sub}</p></div>
        <span className="wg-play"><Icon name="play" size={26} /></span>
      </div>
    </div>
  );
}

export function StandBy() {
  const { world } = useStore(); const cards = useMemo(() => buildCards(world), [world]);
  return (
    <div className="standby" data-theme="dark">
      <div><p className="standby-time num">7:12</p><p className="eyebrow">{world.date}</p></div>
      <div className="standby-r"><span className="accent-block" /><p className="standby-h">{cards[0].headline}</p><p className="t-small muted">{cards[0].sub}</p></div>
    </div>
  );
}

export function NotifActions() {
  const { world } = useStore();
  return (
    <div className="notif-x">
      <div className="banner banner--x">
        <div className="la-head"><KMark small /><p className="eyebrow">KITT · now</p></div>
        <p className="la-title" style={{ fontSize: 15 }}>{world.pending ? 'Draft ready: reply to the insurance broker' : 'Your morning brief is ready'}</p>
        <div className="nx-actions">{(world.pending ? ['Confirm', 'Cancel', 'Later'] : ['Play', 'Later']).map((a, i) => <span key={a} className={`nx${i === 0 ? ' nx--primary' : ''}`}>{a}</span>)}</div>
      </div>
      <p className="t-micro muted">Long-press the banner. On the watch the same three actions appear under the message.</p>
    </div>
  );
}

export function Surfaces() {
  return (
    <div className="surf" data-theme="dark">
      <header className="surf-head"><span className="accent-block" /><h1 className="t-title">Surfaces <b>beyond the app</b></h1><p className="t-body muted">Lock Screen, Dynamic Island, widgets, StandBy and notification actions. All read the same hub state as the app.</p></header>
      <div className="surf-grid">
        <section><h2 className="eyebrow">Lock Screen + Live Activity</h2><ScaledBox width={PHONE.w + 20} height={PHONE.h + 20} scale={0.6}><PhoneFrame><LockScreen /></PhoneFrame></ScaledBox></section>
        <section className="surf-col">
          <div><h2 className="eyebrow">Dynamic Island</h2><Island /></div>
          <div><h2 className="eyebrow">Home Screen widgets</h2><Widgets /></div>
          <div><h2 className="eyebrow">StandBy</h2><StandBy /></div>
          <div><h2 className="eyebrow">Notification actions</h2><NotifActions /></div>
        </section>
      </div>
    </div>
  );
}
