// Apple TV (tvOS) mockups for KITT: a 10-foot, remote-driven version of the same hub data. 1920 x 1080 tvOS points.
// Four screens: Now (glance board), Waiting for your OK, Pair this Apple TV, and the Top Shelf strip on the Apple TV home screen.
// In the interactive route the arrow keys move focus the way the Siri Remote's touch surface would; Enter selects; nothing is sent anywhere.
import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { KMark, Scanner } from '../kit';
import { buildCards } from '../engine';
import { useStore } from '../state';
import { zmw } from '../data';

export type TvScreen = 'now' | 'ok' | 'pair' | 'shelf';
export const TV = { w: 1920, h: 1080 };
export const TV_SCREENS: { id: TvScreen; label: string; what: string }[] = [
  { id: 'now', label: 'Now', what: 'The always-on glance board: today’s top item in big type, five skill tiles, health pills.' },
  { id: 'ok', label: 'Waiting for your OK', what: 'A drafted reply needs a yes: Confirm and Cancel on the remote, or say it to Siri.' },
  { id: 'pair', label: 'Pair this Apple TV', what: 'No token typing: the TV shows a short code, you approve it in KITT on your iPhone.' },
  { id: 'shelf', label: 'Top Shelf', what: 'The strip above the app row on the Apple TV home screen: a summary without opening the app.' },
];
const TILE_SKILLS = ['security', 'chief', 'money', 'receptionist', 'whatsapp'] as const;

function Top({ hideClock }: { hideClock?: boolean }) {
  const { world } = useStore();
  return (
    <header className="tv-top">
      <div className="tv-brand"><span className="tv-mark"><KMark /></span><span>KITT</span></div>
      {!hideClock && <div className="tv-clock"><b>{world.clock}</b><span>{world.date}</span></div>}
    </header>
  );
}

function Now({ interactive }: { interactive: boolean }) {
  const { world } = useStore();
  const cards = useMemo(() => buildCards(world), [world]);
  const top = cards[0];
  const tiles = TILE_SKILLS.map((id) => cards.find((c) => c.skill === id)!).filter(Boolean);
  const [focus, setFocus] = useState(1);
  useEffect(() => {
    if (!interactive) return;
    const f = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); setFocus((i) => Math.min(tiles.length - 1, i + 1)); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); setFocus((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [interactive, tiles.length]);
  const allOk = !world.critical;
  return (
    <div className="tv tv--now" data-theme="dark">
      <Top />
      {world.offline && <div className="tv-notice"><Icon name="off" size={36} />Hub unreachable since {world.asOf}. Showing the cached copy.</div>}
      <main className="tv-main">
        <p className="tv-eyebrow">{world.pending ? 'Waiting for your OK' : `Morning brief · ${world.date}`}</p>
        <h1 className="tv-headline">{world.pending ? world.pending.summary : top.headline}</h1>
        <p className="tv-sub">{world.pending ? 'Press Select to review, or say “Kit, confirm”.' : top.sub}</p>
      </main>
      <ul className="tv-tiles" aria-label="Skills">
        {tiles.map((c, i) => (
          <li key={c.id}>
            <button type="button" className={`tv-tile${focus === i ? ' is-focus' : ''}`} onMouseEnter={() => interactive && setFocus(i)} onFocus={() => setFocus(i)}>
              <span className="tv-t-head"><Icon name={c.icon as IconName} size={34} /><span>{c.eyebrow}</span></span>
              <span className="tv-t-title">{c.headline}</span>
              <span className="tv-t-sub">{c.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      <footer className="tv-foot">
        <div className="tv-pills">
          <span className={`tv-pill${allOk ? '' : ' tv-pill--alert'}`}>{allOk ? 'All systems nominal' : 'Critical finding'}</span>
          {world.pending && <span className="tv-pill tv-pill--alert">1 waiting for your OK</span>}
          <span className="tv-pill tv-pill--quiet">Hub {world.hub.coverage}% · 7 days</span>
        </div>
        <p className="tv-hint"><Icon name="play" size={26} /> Play: hear the brief<span className="tv-dot" />Hold <Icon name="mic" size={26} /> and say “Hey Kit”</p>
      </footer>
    </div>
  );
}

function Ok({ interactive }: { interactive: boolean }) {
  const [sel, setSel] = useState<0 | 1>(0);
  useEffect(() => {
    if (!interactive) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') setSel(1); if (e.key === 'ArrowLeft') setSel(0); };
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f);
  }, [interactive]);
  return (
    <div className="tv tv--ok" data-theme="dark">
      <Top />
      <section className="tv-ask" aria-label="Waiting for your OK">
        <p className="tv-ask-eyebrow"><Icon name="check" size={32} /> Waiting for your OK · expires in 9:41</p>
        <h1>Draft reply to the insurance broker</h1>
        <p className="tv-ask-quote">“Yes, please proceed with the renewal. I will pay today.” Saved as a Gmail draft, never sent.</p>
        <div className="tv-actions">
          <button type="button" className={`tv-btn tv-btn--primary${sel === 0 ? ' is-focus' : ''}`} onMouseEnter={() => interactive && setSel(0)}><Icon name="check" size={46} />Confirm</button>
          <button type="button" className={`tv-btn tv-btn--ghost${sel === 1 ? ' is-focus' : ''}`} onMouseEnter={() => interactive && setSel(1)}>Cancel</button>
        </div>
        <p className="tv-ask-hint">Or hold the Siri button and say “Kit, confirm” or “Kit, cancel”.</p>
      </section>
    </div>
  );
}

function Pair() {
  return (
    <div className="tv tv--pair" data-theme="dark">
      <Top hideClock />
      <section className="tv-pair" aria-label="Pair this Apple TV">
        <div className="tv-pair-l">
          <p className="tv-eyebrow">Pair this Apple TV</p>
          <h1 className="tv-pair-title">Approve this TV in KITT on your iPhone</h1>
          <ol className="tv-steps">
            <li><b>1</b>Open KITT on your iPhone.</li>
            <li><b>2</b>Go to Settings, then Add Apple TV.</li>
            <li><b>3</b>Type the code shown here.</li>
          </ol>
          <p className="tv-found"><Icon name="check" size={34} /> Found your hub on this network: kitt-mac.local</p>
        </div>
        <div className="tv-pair-r">
          <p className="tv-eyebrow">Your code</p>
          <p className="tv-code" aria-label="4 8 2, 9 1 3">482<i />913</p>
          <Scanner />
          <p className="tv-pair-note">Waiting for approval. The code expires in 4:58.</p>
        </div>
      </section>
    </div>
  );
}

const DOCK: { n: string; t?: string; i?: IconName }[] = [{ n: 'TV', t: 'TV' }, { n: 'Music', t: 'M' }, { n: 'Photos', t: 'P' }, { n: 'Search', i: 'search' }, { n: 'Settings', i: 'sliders' }];
const dockIcon = (d: (typeof DOCK)[number]) => (d.i ? <Icon name={d.i} size={84} /> : d.t);
function Shelf() {
  const { world } = useStore();
  const cards = useMemo(() => buildCards(world), [world]);
  const pick = (id: string) => cards.find((c) => c.skill === id)!;
  const strip = [pick('chief'), pick('security'), pick('money')];
  return (
    <div className="tv tv--shelf" data-theme="dark">
      <div className="tv-shelf-strip" aria-label="Top Shelf">
        <p className="tv-shelf-tag"><span className="tv-mark tv-mark--sm"><KMark small /></span>KITT · {world.clock}</p>
        <div className="tv-shelf-cards">
          {strip.map((c) => (
            <div className="tv-shelf-card" key={c.id}>
              <span className="tv-t-head"><Icon name={c.icon as IconName} size={36} /><span>{c.eyebrow}</span></span>
              <span className="tv-shelf-title">{c.skill === 'money' ? `Cash ${zmw(world.cashTotal)}` : c.headline}</span>
              <span className="tv-t-sub">{c.sub}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="tv-dock" aria-label="App row">
        {DOCK.slice(0, 2).map((d) => <div className="tv-app" key={d.n}><span className="tv-app-icon">{dockIcon(d)}</span><span>{d.n}</span></div>)}
        <div className="tv-app tv-app--focus"><span className="tv-app-icon tv-app-icon--kitt"><span className="tv-mark tv-mark--lg"><KMark /></span></span><span>KITT</span></div>
        {DOCK.slice(2).map((d) => <div className="tv-app" key={d.n}><span className="tv-app-icon">{dockIcon(d)}</span><span>{d.n}</span></div>)}
      </div>
    </div>
  );
}

export function AppleTv({ screen, interactive = false }: { screen: TvScreen; interactive?: boolean }) {
  if (screen === 'ok') return <Ok interactive={interactive} />;
  if (screen === 'pair') return <Pair />;
  if (screen === 'shelf') return <Shelf />;
  return <Now interactive={interactive} />;
}
