import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { nativePost, onNative } from '../native';
import { Icon, type IconName } from '../icons';
import { Btn, KMark, ProvChip, Scanner, Seg } from '../kit';
import { SCENARIOS, skillMeta, type SkillId } from '../data';
import { buildCards, type Layout, type LayoutPref } from '../engine';
import { SkillScreen } from '../renderer';
import { skillView } from '../views';
import { speak, stopSpeaking } from '../speech';
import { useStore, type Appearance } from '../state';
import { HubHealth, StackCard, Switch, TalkPanel, briefItems } from './shared';
import { LiveBriefs, LiveSettings } from '../app/connect';

type Tab = 'now' | 'briefs' | 'skills' | 'settings';
const TABS: { id: Tab; label: string; icon: IconName }[] = [{ id: 'now', label: 'Now', icon: 'home' }, { id: 'briefs', label: 'Briefs', icon: 'play' }, { id: 'skills', label: 'Skills', icon: 'grid' }, { id: 'settings', label: 'Settings', icon: 'sliders' }];

export function Phone({ bleed = false, initialTab = 'now', initialSkill = null, openTalk = false, layout: layoutProp }: { bleed?: boolean; initialTab?: Tab; initialSkill?: SkillId | null; openTalk?: boolean; layout?: Layout }) {
  const { state, world, themeFor, layoutFor, dismissTalk, say } = useStore();
  const theme = themeFor('phone'); const layout = layoutProp ?? layoutFor('phone');
  const cards = useMemo(() => buildCards(world), [world]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [skill, setSkill] = useState<SkillId | null>(initialSkill);
  const [sheet, setSheet] = useState(openTalk);
  useEffect(() => onNative('kitt:listening', () => setSheet(true)), []);
  const talkActive = state.talk.device === 'phone' && state.talk.phase !== 'idle';
  const open = (s: SkillId) => { setSkill(s); setTab('skills'); };
  const close = () => { dismissTalk(); setSheet(false); };
  useEffect(() => () => stopSpeaking(), []);

  return (
    <div className={`phone${bleed ? ' phone--bleed' : ''}`} data-theme={theme} style={{ '--fs': state.large ? 1.2 : 1 } as CSSProperties}>
      {layout === 'drive' ? (
        <Drive onTalk={() => setSheet(true)} />
      ) : (
        <>
          <div className="ph-body" key={`${tab}-${skill ?? ''}`}>
            {tab === 'now' && <NowTab cards={cards} glance={layout === 'glance'} onOpen={open} onSettings={() => setTab('settings')} />}
            {tab === 'briefs' && (world.live ? <LiveBriefs /> : <BriefsTab cards={cards} />)}
            {tab === 'skills' && <SkillsTab cards={cards} skill={skill} setSkill={setSkill} />}
            {tab === 'settings' && <SettingsTab />}
          </div>
          <button type="button" className="talkbar" onClick={() => { close(); setSheet(true); if (!nativePost({ type: 'mic' })) say('', 'phone'); }} aria-label="Talk to Kit">
            <Icon name="mic" size={24} />
            <span>Talk to Kit<small>Or say “Hey Siri, ask Kit”</small></span>
          </button>
          <nav className="tabbar" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); if (t.id === 'skills') setSkill(null); }}>
                <Icon name={t.icon} size={22} /><span>{t.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      {(sheet || talkActive) && (
        <>
          <div className="sheet-scrim" onClick={close} />
          <div className="sheet" role="dialog" aria-label="Talk to Kit"><TalkPanel device="phone" onClose={close} onOpen={open} /></div>
        </>
      )}
      {!bleed && <i className="home-ind" aria-hidden="true" />}
    </div>
  );
}

function NowTab({ cards, glance, onOpen, onSettings }: { cards: ReturnType<typeof buildCards>; glance: boolean; onOpen: (s: SkillId) => void; onSettings: () => void }) {
  const { world, themeFor } = useStore();
  const theme = themeFor('phone');
  const quiet = cards.every((c) => c.score < 20);
  return (
    <>
      <header className="hdr">
        <div className="hdr-l">
          <span className="accent-block" />
          <div>
            <p className="eyebrow muted">{world.date} · {world.clock}</p>
            <h1 className="t-title" style={{ marginTop: 8 }}>What <b>needs you</b> today</h1>
          </div>
        </div>
        <button type="button" className="hub-chip" onClick={onSettings} aria-label={world.offline ? `Hub offline, cached from ${world.asOf}` : `Hub online, ${world.hub.coverage} percent coverage`}>
          {world.offline ? <><span className="dot-off" />Offline · {world.asOf}</> : <><span className="dot-live" />Hub {world.hub.coverage}%</>}
        </button>
      </header>
      {world.offline && <div className="notice" style={{ marginBottom: 12 }}><Icon name="off" size={18} /><span>Hub unreachable since {world.asOf}. Showing the cached copy; nothing can be sent, confirmed or saved until the Mac is back.</span></div>}
      {quiet && (
        <div className="card card--outline" style={{ marginBottom: 12 }}>
          <p className="eyebrow">Quiet</p>
          <p className="t-h2" style={{ marginTop: 8 }}>{theme === 'light' ? <>Nothing <b>needs you</b></> : 'Nothing needs you'}</p>
          <p className="card-sub">Last checked {world.clock}. The stack below is for reference.</p>
        </div>
      )}
      <div className={`stack${glance || quiet ? ' stack--glance' : ''}`}>
        {cards.map((c, i) => <StackCard key={c.id} card={c} index={i} device="phone" density={glance || quiet ? 'glance' : 'comfort'} onOpen={onOpen} />)}
      </div>
      <p className="t-micro muted" style={{ marginTop: 16 }}>{world.live ? 'Live from your hub, refreshed every 20 seconds. Tap a number to see why a card is where it is.' : 'Demo data, synthetic. Tap a number to see why a card is where it is.'}</p>
    </>
  );
}

function BriefsTab({ cards }: { cards: ReturnType<typeof buildCards> }) {
  const { world } = useStore();
  const { items, total } = useMemo(() => briefItems(cards), [cards]);
  const [playing, setPlaying] = useState(false);
  const toggle = () => { if (playing) { stopSpeaking(); setPlaying(false); } else { speak(items.map((i) => i.text).join(' '), () => setPlaying(false)); setPlaying(true); } };
  return (
    <>
      <header className="hdr"><div className="hdr-l"><span className="accent-block" /><h1 className="t-title">Today’s <b>brief</b></h1></div></header>
      <div className="player">
        <p className="eyebrow">Morning brief · {world.date}</p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 16 }}>
          <button type="button" className="play-btn" aria-label={playing ? 'Pause brief' : 'Play brief'} onClick={toggle}><Icon name={playing ? 'pause' : 'play'} size={28} /></button>
          <div><p className="card-title">{total} · {world.offline ? 'cached copy' : 'rendered 07:05'}</p><p className="t-small" style={{ opacity: 0.8, marginTop: 4 }}>Plays in the car, on AirPods or here</p></div>
        </div>
        <div className={`prog${playing ? ' on' : ''}`}><i /></div>
      </div>
      <h2 className="eyebrow muted" style={{ margin: '24px 0 14px' }}>Transcript</h2>
      <ul className="timeline">{items.map((i) => <li key={i.at + i.title}><div className="eyebrow">{i.at} · {i.title}</div><p className="t-body" style={{ marginTop: 4 }}>{i.text}</p></li>)}</ul>
      <div className="rule-h" style={{ margin: '22px 0 4px' }} />
      <div className="row"><div className="row-main"><div className="row-title">Evening recap</div><div className="row-sub">17:45 · rendered automatically</div></div><Icon name="right" size={18} /></div>
      <div className="row"><div className="row-main"><div className="row-title">KITT Briefings podcast feed</div><div className="row-sub">Apple Podcasts, Follow a Show by URL. Appears in CarPlay like any show.</div></div><ProvChip kind="assumed" /></div>
    </>
  );
}

function SkillsTab({ cards, skill, setSkill }: { cards: ReturnType<typeof buildCards>; skill: SkillId | null; setSkill: (s: SkillId | null) => void }) {
  const { world, say } = useStore();
  if (skill) {
    const v = skillView(skill, world); const m = skillMeta(skill);
    return (
      <>
        <div className="subhdr"><button type="button" className="back-btn" onClick={() => setSkill(null)}><Icon name="left" size={20} />Skills</button></div>
        <header className="hdr"><div className="hdr-l"><span className="accent-block" /><div><p className="eyebrow muted">{m.name}</p><h1 className="t-title" style={{ marginTop: 8, fontSize: 'calc(24px * var(--fs))' }}>{v.headline}</h1></div></div></header>
        <SkillScreen view={v} density="comfort" onSay={(t) => say(t, 'phone')} />
      </>
    );
  }
  return (
    <>
      <header className="hdr"><div className="hdr-l"><span className="accent-block" /><h1 className="t-title">All <b>twelve</b> skills</h1></div></header>
      <div className="tiles">
        {cards.filter((c) => c.skill !== 'confirm').map((c) => (
          <button type="button" className="tile" key={c.id} onClick={() => setSkill(c.skill as SkillId)}>
            {c.level >= 2 && <span className="badge" aria-label="needs attention">!</span>}
            <Icon name={c.icon} size={24} />
            <span><span className="tile-name" style={{ display: 'block' }}>{c.eyebrow}</span><span className="tile-sub" style={{ display: 'block', marginTop: 4 }}>{c.headline}</span></span>
          </button>
        ))}
      </div>
      <p className="t-micro muted" style={{ marginTop: 16 }}>Each screen is drawn from a descriptor the hub sends, so a new skill appears here without an app release.</p>
    </>
  );
}

function SettingsTab() {
  const { state, world, set, scenario, reset } = useStore();
  const [face, setFace] = useState(true); const [counts, setCounts] = useState(true);
  return (
    <>
      <header className="hdr"><div className="hdr-l"><span className="accent-block" /><h1 className="t-title"><b>Settings</b></h1></div></header>
      {world.live ? <LiveSettings /> : (
        <>
          <h2 className="eyebrow muted">Hub</h2>
          <div className="set-row"><div><div className="row-title">kitt-mac.your-tailnet.ts.net</div><div className="row-sub">Private tunnel, no public address</div></div><span className="hub-chip">{world.offline ? <><span className="dot-off" />Offline</> : <><span className="dot-live" />Online</>}</span></div>
          <div className="set-row"><div><div className="row-title">This iPhone</div><div className="row-sub">App scope: ask and confirm, no admin · paired 26 Oct</div></div><Btn kind="ghost" size="sm">Revoke</Btn></div>
        </>
      )}

      <div className="set-sec"><h2 className="eyebrow muted" style={{ marginBottom: 8 }}>{world.live ? 'Hub health' : 'Reachability gate'}</h2><HubHealth /></div>

      <div className="set-sec">
        <h2 className="eyebrow muted">Display</h2>
        <div className="set-row"><span className="row-title">Layout</span><Seg<LayoutPref> label="Layout" value={state.layout} onChange={(v) => set({ layout: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'drive', label: 'Drive' }, { value: 'glance', label: 'Glance' }]} /></div>
        <div className="set-row"><span className="row-title">Appearance</span><Seg<Appearance> label="Appearance" value={state.appearance} onChange={(v) => set({ appearance: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
        <div className="set-row"><span className="row-title">Large type</span><Switch on={state.large} onChange={(v) => set({ large: v })} label="Large type" /></div>
      </div>

      <div className="set-sec">
        <h2 className="eyebrow muted">Privacy</h2>
        <div className="set-row"><span className="row-title">Lock Money and Inbox with Face ID</span><Switch on={face} onChange={setFace} label="Lock Money and Inbox with Face ID" /></div>
        <div className="set-row"><span className="row-title">Notifications show counts only</span><Switch on={counts} onChange={setCounts} label="Notifications show counts only" /></div>
      </div>

      <div className="set-sec">
        <h2 className="eyebrow muted" style={{ marginBottom: 6 }}>Last commands</h2>
        <ul>{world.audit.slice(0, 5).map((a, i) => <li className="row" key={i}><div className="row-main"><div className="row-title">{a.intent}</div><div className="row-sub">{a.ts} · {a.source}</div></div><span className="tag">{a.outcome}</span></li>)}</ul>
      </div>

      {!world.live && (
        <div className="set-sec" style={{ paddingBottom: 8 }}>
          <h2 className="eyebrow muted" style={{ marginBottom: 8 }}>Prototype controls · mock only</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SCENARIOS.map((s) => <button key={s.id} type="button" className="sugg-btn" aria-pressed={state.scenario === s.id} onClick={() => scenario(s.id)}>{s.label}</button>)}
          </div>
          <p className="t-micro muted" style={{ marginTop: 8 }}>{SCENARIOS.find((s) => s.id === state.scenario)?.hint}</p>
          <div style={{ marginTop: 12 }}><Btn kind="ghost" size="sm" onClick={reset}>Reset demo data</Btn></div>
        </div>
      )}
    </>
  );
}

function Drive({ onTalk }: { onTalk: () => void }) {
  const { world, state, set } = useStore();
  const cards = useMemo(() => buildCards(world), [world]);
  const top = cards[0];
  const pending = Boolean(world.pending);
  return (
    <div className="drive">
      <div className="drive-top"><span className="eyebrow">Drive · voice only</span><button type="button" className="btn btn--ghost btn--sm" onClick={() => set({ layout: 'auto' })} aria-label="Leave drive layout">Exit</button></div>
      <div className="drive-main">
        <span className="accent-block" />
        <p className="drive-headline">{pending ? 'A draft is waiting for your OK' : top.headline}</p>
        <p className="drive-body muted">{pending ? 'Say “Kit, confirm” or “Kit, cancel”.' : top.sub}</p>
        {state.large && <KMark />}
      </div>
      <div className="drive-foot">
        <Scanner />
        <p className="drive-say">Say “Hey Siri, ask Kit”</p>
        <p className="t-small muted">The screen stays quiet while you drive. Nothing here needs a touch.</p>
        <Btn kind="ghost" size="sm" icon="mic" onClick={onTalk}>Passenger? Tap to talk</Btn>
      </div>
    </div>
  );
}
