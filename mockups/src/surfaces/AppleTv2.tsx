// Apple TV (tvOS) in Design System v2 "Scanner Grid". 1920 x 1080 tvOS points.
// Siri Remote mapping used by the interactive route: arrows = swipe on the clickpad (focus moves), Enter = Select (click),
// Escape = Menu / Back, Space = Play/Pause. Voice is the system Siri button, not an in-app microphone.
import { useEffect, useId, useMemo, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { buildCards, type CardModel } from '../engine';
import { useStore } from '../state';
import type { World } from '../data';
import { useBriefPlayer } from '../app/connect';

export type TvVariant = 'hybrid' | 'scanner' | 'grid';
export type Tv2Screen = 'now' | 'ok' | 'pair' | 'shelf';
export const TV2 = { w: 1920, h: 1080 };
export const TV2_VARIANTS: { id: TvVariant; label: string; what: string }[] = [
  { id: 'scanner', label: 'Red scanner lean', what: 'Void black, red-edged panels, amber LED figures, no grid.' },
  { id: 'grid', label: 'Neon grid lean', what: 'Wireframe panels, cyan neon rules, a visible perspective grid floor.' },
  { id: 'hybrid', label: 'Hybrid (the v2 spec)', what: 'Cockpit panels, white LED figures, a faint grid.' },
];
export const TV2_SCREENS: { id: Tv2Screen; label: string; what: string }[] = [
  { id: 'now', label: 'Now', what: 'The glance board: the top item in big type, five LED tiles, status chips. Select opens a tile, Play/Pause reads the brief.' },
  { id: 'ok', label: 'Needs your decision', what: 'A drafted reply waits for a yes. Select on Confirm or Cancel; or hold the Siri button and say it.' },
  { id: 'pair', label: 'Pair this Apple TV', what: 'No typing on the remote: the TV shows a code, you approve it in KITT on your iPhone.' },
  { id: 'shelf', label: 'Top Shelf', what: 'The strip above the app row on the Apple TV home screen: a summary without opening the app.' },
];

/** The mark: a light bar on a grid. */
export function Mark({ size = 64 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="KITT mark" style={{ display: 'block', flex: 'none' }}>
      <defs><linearGradient id={id} x1="0" x2="1"><stop offset="0" stopColor="#ff2a2a" /><stop offset="0.5" stopColor="#ffffff" /><stop offset="1" stopColor="#19e6ff" /></linearGradient></defs>
      <rect width="100" height="100" fill="#050507" />
      <g stroke="#19e6ff" strokeOpacity="0.14" strokeWidth="1"><path d="M0 70H100M0 82H100M0 94H100M20 60L4 100M40 60L32 100M60 60L68 100M80 60L96 100" /></g>
      <path d="M10 41H90M10 59H90" stroke="#19e6ff" strokeOpacity="0.5" strokeWidth="1" />
      <rect x="10" y="46" width="80" height="8" fill={`url(#${id})`} />
    </svg>
  );
}

/** Status level: it picks the colours and the speed of the animated top border and KITT name.
 *  Critical = red / blue / white (red leads), amber = blue / white, green = blue only. */
export type Level = 'critical' | 'amber' | 'green';
export const LEVELS: { id: Level; label: string; rule: string; when: string }[] = [
  { id: 'critical', label: 'Critical', rule: 'Red, blue and white, red leads. Fast sweep.', when: 'A critical finding is open.' },
  { id: 'amber', label: 'Amber', rule: 'Blue and white. Medium sweep.', when: 'Something needs you: a decision waiting, items overdue, a medium finding, or the hub offline.' },
  { id: 'green', label: 'Green', rule: 'Blue only. Slow sweep.', when: 'All clear.' },
];
export const statusLevel = (w: World): Level =>
  w.critical ? 'critical' : w.pending || w.offline || w.actionable > 0 || w.board.overdue.length > 0 ? 'amber' : 'green';
const LEVEL_CHIP: Record<Level, string> = { critical: 'Critical finding', amber: 'Needs attention', green: 'All systems nominal' };

/** The top border: a light bar that sweeps all the time (frozen at the centre with Reduce Motion). */
export function ScannerBar({ level = 'green' }: { level?: Level }) {
  return <div className="sb" data-level={level} role="presentation"><i /></div>;
}

/** The KITT name, with a light band that sweeps through the letters in step with the bar. */
export function KittName({ level = 'green', className = '' }: { level?: Level; className?: string }) {
  return <span className={`kn ${className}`.trim()} data-level={level}>KITT</span>;
}

const LED: Record<string, { label: string; value: (w: World) => string }> = {
  security: { label: 'Findings', value: (w) => String(w.actionable) },
  chief: { label: 'Overdue', value: (w) => String(w.board.overdue.length) },
  money: { label: 'Cash', value: (w) => `K${(w.cashTotal / 1000).toFixed(1)}k` },
  receptionist: { label: 'Need reply', value: (w) => String(w.inbox.needsReply) },
  whatsapp: { label: 'Unread', value: (w) => String(w.wa.unread.reduce((a, u) => a + u.n, 0)) },
};
const TILE_SKILLS = ['security', 'chief', 'money', 'receptionist', 'whatsapp'] as const;
const pick = (cards: CardModel[], id: string) => cards.find((c) => c.skill === id)!;

function Top({ hideClock, level }: { hideClock?: boolean; level: Level }) {
  const { world } = useStore();
  return (
    <header className="tv2-top">
      <div className="tv2-brand"><Mark size={72} /><KittName level={level} className="tv2-word" /></div>
      {!hideClock && <div className="tv2-clock"><b>{world.clock}</b><span>{world.date}</span></div>}
    </header>
  );
}

function Now({ interactive, variant }: { interactive: boolean; variant: TvVariant }) {
  const { world, act, state } = useStore();
  const brief = useBriefPlayer();
  const cards = useMemo(() => buildCards(world), [world]);
  const top = cards[0];
  const tiles = TILE_SKILLS.map((id) => pick(cards, id));
  const [focus, setFocus] = useState(1);
  const [detail, setDetail] = useState<number | null>(null);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const playing = world.live ? brief.playing : demoPlaying;   // live: the hub's newest brief through the shared player
  useEffect(() => {
    if (!interactive) return;
    const f = (e: KeyboardEvent) => {
      if (detail !== null) { if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); setDetail(null); } return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); setFocus((i) => Math.min(tiles.length - 1, i + 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setFocus((i) => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); setDetail(focus); }
      else if (e.key === ' ') { e.preventDefault(); if (world.live) brief.toggle().catch(() => { /* shown by the chip below */ }); else setDemoPlaying((p) => !p); }
      else if (world.live && world.pending && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); act('confirm', 'pad'); }
      else if (world.live && world.pending && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); act('cancel', 'pad'); }
    };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [interactive, tiles.length, focus, detail, world.live, world.pending, brief, act]);
  const level = statusLevel(world);
  const d = detail !== null ? tiles[detail] : null;
  const liveNote = world.live && state.talk.phase === 'answer' && state.talk.answer ? state.talk.answer.speak : null;
  return (
    <div className={`tv2 ds2 tv2--${variant}`}>
      <div className="gridfloor" />
      <Top level={level} />
      <ScannerBar level={level} />
      {world.offline && <div className="tv2-notice"><Icon name="off" size={36} />Hub unreachable since {world.asOf}. Showing the cached copy.</div>}
      <main className="tv2-main">
        <p className="tv2-eyebrow">{playing ? (world.live && brief.current ? `Playing · ${brief.current.title}` : 'Reading the brief…') : brief.loading ? 'Loading the brief…' : world.pending ? 'Needs your decision' : world.live ? `Now · ${world.date}` : `Morning brief · ${world.date}`}</p>
        <h1 className="tv2-headline">{world.pending ? world.pending.summary : top.headline}</h1>
        <p className="tv2-sub">{world.pending ? (world.live ? 'Press Y to confirm or N to cancel, or say “Hey Siri, confirm with Kitt”.' : 'Press Select to review, or hold the Siri button and say “Ask Kit to confirm”.') : top.sub}</p>
      </main>
      <ul className="tv2-tiles" aria-label="Skills">
        {tiles.map((c, i) => (
          <li key={c.id}>
            <button type="button" className={`pn tv2-tile${focus === i ? ' is-focus' : ''}`} onMouseEnter={() => interactive && setFocus(i)} onFocus={() => setFocus(i)} onClick={() => interactive && setDetail(i)}>
              <span className="tv2-t-head"><Icon name={c.icon as IconName} size={32} /><span>{c.eyebrow}</span></span>
              <span className="led"><span className="led-v">{LED[c.skill as string].value(world)}</span><span className="led-l">{LED[c.skill as string].label}</span></span>
              <span className="tv2-t-sub">{c.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      <footer className="tv2-foot">
        <div className="tv2-chips">
          <span className={`tv2-chip${world.critical ? ' tv2-chip--alert' : ''}`}>{LEVEL_CHIP[level]}</span>
          {world.pending && <span className="tv2-chip tv2-chip--alert">1 needs your decision</span>}
          <span className="tv2-chip tv2-chip--quiet">Hub {world.hub.coverage}% · 7 days{world.live && world.hub.version ? ` · ${world.hub.version}` : ''}</span>
          {liveNote && <span className="tv2-chip tv2-chip--quiet">{liveNote.slice(0, 90)}</span>}
        </div>
        <p className="tv2-hint"><span><b>Select</b>open</span><span><b>Play/Pause</b>{playing ? 'pause' : 'hear the brief'}</span>{world.live && world.pending && <span><b>Y / N</b>decide</span>}<span><b>Siri</b>“Ask Kit …”</span></p>
      </footer>
      {d && (
        <div className="tv2-detail" role="dialog" aria-label={`${d.eyebrow} detail`}>
          <p className="tv2-eyebrow">{d.eyebrow}</p>
          <div className="led"><span className="led-v">{LED[d.skill as string].value(world)}</span><span className="led-l">{LED[d.skill as string].label}</span></div>
          <h1 className="tv2-headline">{d.headline}</h1>
          <p className="tv2-sub">{d.sub}</p>
          <p className="tv2-hint"><span><b>Menu</b>back</span></p>
        </div>
      )}
    </div>
  );
}

function Ask({ interactive, variant }: { interactive: boolean; variant: TvVariant }) {
  const [sel, setSel] = useState<0 | 1>(0);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!interactive) return;
    const f = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setSel(1); else if (e.key === 'ArrowLeft') setSel(0);
      else if (e.key === 'Enter') setDone(sel === 0 ? 'Confirmed. Draft saved in Gmail, not sent.' : 'Cancelled. Nothing was changed.');
      else if (e.key === 'Escape') setDone(null);
    };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [interactive, sel]);
  return (
    <div className={`tv2 ds2 tv2--${variant}`}>
      <div className="gridfloor" />
      <Top level="amber" />
      <section className="tv2-ask" aria-label="Needs your decision">
        <ScannerBar level="amber" />
        <p className="tv2-ask-eyebrow"><Icon name="alert" size={34} /> Needs your decision · expires in 9:41</p>
        <h1>Draft reply to the insurance broker</h1>
        <p className="tv2-ask-quote">“Yes, please proceed with the renewal. I will pay today.” Saved as a Gmail draft, never sent.</p>
        {done ? <p className="tv2-ask-quote" style={{ color: 'var(--cyan)' }}>{done}</p> : (
          <div className="tv2-actions">
            <button type="button" className={`tv2-btn tv2-btn--primary${sel === 0 ? ' is-focus' : ''}`} onMouseEnter={() => interactive && setSel(0)}><Icon name="check" size={46} />Confirm</button>
            <button type="button" className={`tv2-btn tv2-btn--ghost${sel === 1 ? ' is-focus' : ''}`} onMouseEnter={() => interactive && setSel(1)}>Cancel</button>
          </div>
        )}
        <p className="tv2-ask-hint">Or hold the Siri button and say “Ask Kit to confirm” or “Ask Kit to cancel”.</p>
      </section>
    </div>
  );
}

function Pair({ variant }: { variant: TvVariant }) {
  return (
    <div className={`tv2 ds2 tv2--${variant}`}>
      <div className="gridfloor" />
      <Top hideClock level="green" />
      <section className="tv2-pair" aria-label="Pair this Apple TV">
        <div className="tv2-pair-l">
          <p className="tv2-eyebrow">Pair this Apple TV</p>
          <h1 className="tv2-pair-title">Approve this TV in KITT on your iPhone</h1>
          <ol className="tv2-steps">
            <li><b>1</b>Open KITT on your iPhone.</li>
            <li><b>2</b>Go to Settings, then Add Apple TV.</li>
            <li><b>3</b>Enter the code shown here.</li>
          </ol>
          <p className="tv2-found"><Icon name="check" size={34} /> Found your hub on this network: kitt-mac.local</p>
        </div>
        <div className="tv2-pair-r">
          <p className="tv2-eyebrow">Your code</p>
          <p className="tv2-code" aria-label="4 8 2, 9 1 3">482 913</p>
          <ScannerBar level="green" />
          <p className="tv2-pair-note">Waiting for approval. The code expires in 4:58.</p>
        </div>
      </section>
    </div>
  );
}

const DOCK: { n: string; t?: string; i?: IconName }[] = [{ n: 'TV', t: 'TV' }, { n: 'Music', t: 'M' }, { n: 'Photos', t: 'P' }, { n: 'Search', i: 'search' }, { n: 'Settings', i: 'sliders' }];
const dockGlyph = (d: (typeof DOCK)[number]) => (d.i ? <Icon name={d.i} size={80} /> : d.t);
function Shelf({ variant }: { variant: TvVariant }) {
  const { world } = useStore();
  const cards = useMemo(() => buildCards(world), [world]);
  const strip = ['chief', 'security', 'money'].map((id) => pick(cards, id));
  const level = statusLevel(world);
  return (
    <div className={`tv2 tv2--shelfpage ds2 tv2--${variant}`}>
      <div className="tv2-shelf-strip">
        <p className="tv2-shelf-tag"><Mark size={56} /><KittName level={level} /></p>
        <div className="tv2-shelf-cards">
          {strip.map((c) => (
            <div className="pn tv2-shelf-card" key={c.id}>
              <span className="tv2-t-head"><Icon name={c.icon as IconName} size={32} /><span>{c.eyebrow}</span></span>
              <span className="led"><span className="led-v">{LED[c.skill as string].value(world)}</span><span className="led-l">{LED[c.skill as string].label}</span></span>
            </div>
          ))}
        </div>
      </div>
      <div className="tv2-dock" aria-label="App row">
        {DOCK.slice(0, 2).map((d) => <div className="tv2-app" key={d.n}><span className="tv2-app-icon">{dockGlyph(d)}</span><span>{d.n}</span></div>)}
        <div className="tv2-app tv2-app--focus"><span className="tv2-app-icon"><Mark size={220} /></span><span>KITT</span></div>
        {DOCK.slice(2).map((d) => <div className="tv2-app" key={d.n}><span className="tv2-app-icon">{dockGlyph(d)}</span><span>{d.n}</span></div>)}
      </div>
    </div>
  );
}

export function AppleTv2({ screen, variant = 'hybrid', interactive = false }: { screen: Tv2Screen; variant?: TvVariant; interactive?: boolean }) {
  if (screen === 'ok') return <Ask interactive={interactive} variant={variant} />;
  if (screen === 'pair') return <Pair variant={variant} />;
  if (screen === 'shelf') return <Shelf variant={variant} />;
  return <Now interactive={interactive} variant={variant} />;
}
