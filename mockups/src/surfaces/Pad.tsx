import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon } from '../icons';
import { Kpis, KMark, Seg } from '../kit';
import { skillMeta, zmw, type SkillId } from '../data';
import { buildCards } from '../engine';
import { SkillScreen } from '../renderer';
import { skillView } from '../views';
import { useStore } from '../state';
import { HubHealth, StackCard, TalkPanel } from './shared';
import { LiveSettings } from '../app/connect';

type Sel = 'now' | 'hub' | SkillId;

export function Pad({ initialSel = 'now' }: { initialSel?: Sel }) {
  const { state, world, themeFor, layoutFor, set, say, act, dismissTalk } = useStore();
  const theme = themeFor('pad'); const layout = layoutFor('pad');
  const cards = useMemo(() => buildCards(world), [world]);
  const [sel, setSel] = useState<Sel>(initialSel);
  const skillCards = cards.filter((c) => c.skill !== 'confirm');
  const glance = layout === 'glance';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === 'k') { e.preventDefault(); document.querySelector<HTMLInputElement>('.pd-inspect .tp-form input')?.focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); act('confirm', 'pad'); }
      else if (e.key === 'Backspace') { e.preventDefault(); act('cancel', 'pad'); }
      else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); const n = Number(e.key); if (n === 0) setSel('now'); else if (skillCards[n - 1]) setSel(skillCards[n - 1].skill as SkillId); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [act, skillCards]);

  const flagged = (lvl: number) => lvl >= 2;
  return (
    <div className="pad" data-theme={theme} style={{ '--fs': state.large ? 1.15 : 1 } as CSSProperties}>
      <aside className="pd-side">
        <div className="side-head"><KMark /><div><p className="eyebrow">KITT</p><p className="t-micro muted" style={{ marginTop: 4 }}>{world.offline ? `Offline · ${world.asOf}` : `Hub online · ${world.hub.coverage}%`}</p></div></div>
        <nav className="side-nav" aria-label="Destinations">
          <button type="button" className="side-item" aria-current={sel === 'now' ? 'page' : undefined} onClick={() => setSel('now')}>
            <Icon name="home" size={18} />Now{world.pending && <span className="flag" aria-label="confirmation waiting" />}<span className="kbd">⌘0</span>
          </button>
          <p className="eyebrow muted side-label">Skills · by priority</p>
          {skillCards.map((c, i) => (
            <button type="button" key={c.id} className="side-item" aria-current={sel === c.skill ? 'page' : undefined} onClick={() => setSel(c.skill as SkillId)}>
              <Icon name={c.icon} size={18} />{c.eyebrow}{flagged(c.level) && <span className="flag" aria-label="needs attention" />}{i < 9 && <span className="kbd">⌘{i + 1}</span>}
            </button>
          ))}
          {world.live && (
            <>
              <p className="eyebrow muted side-label">Hub</p>
              <button type="button" className="side-item" aria-current={sel === 'hub' ? 'page' : undefined} onClick={() => setSel('hub')}><Icon name="sliders" size={18} />Connection{world.offline && <span className="flag" aria-label="hub unreachable" />}</button>
            </>
          )}
        </nav>
        <p className="t-micro muted side-foot">⌘K talk · ⌘↩ confirm · ⌘⌫ cancel</p>
      </aside>

      <main className="pd-main" key={sel}>
        <header className="pd-top">
          <div style={{ display: 'grid', gap: 12 }}>
            <span className="accent-block" />
            <div>
              <p className="eyebrow muted">{sel === 'now' ? `${world.date} · ${world.clock}` : sel === 'hub' ? 'Hub' : skillMeta(sel).name}</p>
              <h1 className="t-title" style={{ marginTop: 8 }}>{sel === 'now' ? <>Priority <b>board</b></> : sel === 'hub' ? <b>Connection</b> : <b>{skillView(sel, world).headline}</b>}</h1>
            </div>
          </div>
          <Seg<'desk' | 'glance'> label="Density" value={glance ? 'glance' : 'desk'} onChange={(v) => set({ layout: v })} options={[{ value: 'desk', label: 'Desk' }, { value: 'glance', label: 'Glance' }]} />
        </header>
        {world.offline && <div className="notice" style={{ marginBottom: 16 }}><Icon name="off" size={18} /><span>Hub unreachable since {world.asOf}. Reads come from the cached copy; writes are disabled.</span></div>}
        {sel === 'now' ? <NowBoard cards={cards} glance={glance} open={(s) => setSel(s)} /> : sel === 'hub' ? <div style={{ maxWidth: 640 }}><LiveSettings /></div> : <SkillScreen view={skillView(sel, world)} density={glance ? 'glance' : 'desk'} onSay={(t) => say(t, 'pad')} />}
      </main>

      <aside className="pd-inspect">
        <TalkPanel device="pad" onClose={dismissTalk} onOpen={(s) => setSel(s)} />
        <div className="rule-h" style={{ margin: '22px 0 16px' }} />
        <p className="eyebrow muted" style={{ marginBottom: 10 }}>Reachability gate</p>
        <HubHealth />
        <div className="rule-h" style={{ margin: '20px 0 8px' }} />
        <p className="eyebrow muted" style={{ marginBottom: 4 }}>Last commands</p>
        <ul>{world.audit.slice(0, 4).map((a, i) => <li className="row" key={i} style={{ minHeight: 44, padding: '8px 0' }}><div className="row-main"><div className="row-title" style={{ fontSize: 13 }}>{a.intent}</div><div className="row-sub">{a.ts} · {a.source}</div></div><span className="tag">{a.outcome}</span></li>)}</ul>
      </aside>
    </div>
  );
}

function NowBoard({ cards, glance, open }: { cards: ReturnType<typeof buildCards>; glance: boolean; open: (s: SkillId) => void }) {
  const { world } = useStore();
  const pending = cards.find((c) => c.skill === 'confirm'); const rest = cards.filter((c) => c.skill !== 'confirm');
  return (
    <>
      <Kpis cols={4} items={[
        { label: 'Cash position', value: zmw(world.cashTotal), prov: 'measured', sub: `${world.wallets.length} wallets` },
        { label: 'Overdue items', value: String(world.board.overdue.length), prov: 'measured', sub: `${world.board.blocked.length} blocked` },
        { label: 'Findings', value: String(world.actionable), prov: 'measured', sub: world.critical ? 'one critical' : 'none critical' },
        { label: 'Hub coverage', value: `${world.hub.coverage}%`, prov: 'measured', sub: '7 days' },
      ]} />
      <div style={{ height: 20 }} />
      {pending && <div style={{ marginBottom: 12 }}><StackCard card={pending} index={0} density="comfort" device="pad" onOpen={open} /></div>}
      <div className={`pd-grid${glance ? ' pd-grid--glance' : ''}`}>
        {rest.map((c, i) => <StackCard key={c.id} card={c} index={i + (pending ? 1 : 0)} density={glance ? 'glance' : 'comfort'} device="pad" onOpen={open} />)}
      </div>
      <p className="t-micro muted" style={{ marginTop: 18 }}>Ranking is recomputed from live data every time; tap a number to see the points behind it. {world.live ? 'Live from your hub, refreshed every 20 seconds.' : 'Demo data, synthetic.'}</p>
    </>
  );
}
