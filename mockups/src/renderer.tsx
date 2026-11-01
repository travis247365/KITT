import { useMemo, useState } from 'react';
import { Bars, Btn, Kpis, LineChart, ProvChip, Seg, SevTag, Table } from './kit';
import { Icon } from './icons';
import { zmw } from './data';
import { useStore } from './state';
import type { ListRow, Section, SkillView } from './views';

export type Density = 'comfort' | 'desk' | 'glance';

function Rows({ rows, empty }: { rows: ListRow[]; empty?: string }) {
  if (!rows.length) return <p className="t-small muted" style={{ padding: '12px 0' }}>{empty ?? 'Nothing here.'}</p>;
  return (
    <ul>
      {rows.map((r, i) => (
        <li className="row" key={`${r.title}-${i}`}>
          <div className="row-main">
            <div className="row-title">{r.title}</div>
            {r.sub && <div className="row-sub">{r.sub}</div>}
          </div>
          {r.level && <SevTag level={r.level} />}
          {r.tag && <span className="tag">{r.tag}</span>}
          {r.prov && !r.right && <ProvChip kind={r.prov} />}
          {r.right && <div className="row-right">{r.right}</div>}
        </li>
      ))}
    </ul>
  );
}

function LinkEditor({ density }: { density: Density }) {
  const { world, moveLink, toggleLink, setLinkOrder } = useStore();
  const [drag, setDrag] = useState<string | null>(null);
  const ids = world.links.map((l) => l.id);
  const drop = (target: string) => {
    if (!drag || drag === target) return;
    const next = ids.filter((x) => x !== drag); next.splice(next.indexOf(target), 0, drag); setLinkOrder(next); setDrag(null);
  };
  return (
    <div>
      <h3 className="eyebrow sec-title">Link order {density === 'desk' ? '· drag the handle' : ''}</h3>
      <ul>
        {world.links.map((l, i) => (
          <li className="row" key={l.id} draggable={density === 'desk'} onDragStart={() => setDrag(l.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(l.id)} style={{ opacity: l.hidden ? 0.5 : 1 }}>
            {density === 'desk' && <span className="muted" aria-hidden="true" style={{ cursor: 'grab' }}><Icon name="grip" size={18} /></span>}
            <span className="idx-chip" style={{ width: 28, height: 28, fontSize: 12 }}>{i + 1}</span>
            <div className="row-main"><div className="row-title">{l.title}</div><div className="row-sub">{l.clicks} clicks · {l.hidden ? 'hidden' : 'live'}</div></div>
            <button type="button" className="icon-btn" aria-label={`Move ${l.title} up`} disabled={i === 0} onClick={() => moveLink(l.id, -1)}><Icon name="up" size={18} /></button>
            <button type="button" className="icon-btn" aria-label={`Move ${l.title} down`} disabled={i === world.links.length - 1} onClick={() => moveLink(l.id, 1)}><Icon name="down" size={18} /></button>
            <button type="button" className="icon-btn" aria-label={`${l.hidden ? 'Show' : 'Hide'} ${l.title}`} onClick={() => toggleLink(l.id)}><Icon name={l.hidden ? 'eye' : 'x'} size={18} /></button>
          </li>
        ))}
      </ul>
      <p className="t-micro muted" style={{ marginTop: 8 }}>On the real hub every change waits for “Kit, confirm”; the mockup applies it instantly.</p>
    </div>
  );
}

const RULES: [RegExp, string][] = [[/Acme Telecom/g, 'a telecom client'], [/\b\d{1,3}(\.\d+)?%/g, 'a measurable share'], [/\bK\s?\d[\d,]*/g, 'an undisclosed amount']];
function scrub(text: string): { text: string; hit: boolean }[] {
  let segs: { text: string; hit: boolean }[] = [{ text, hit: false }];
  for (const [re, rep] of RULES) {
    segs = segs.flatMap((s) => {
      if (s.hit) return [s];
      const out: { text: string; hit: boolean }[] = []; let last = 0; let m: RegExpExecArray | null; const r = new RegExp(re.source, 'g');
      while ((m = r.exec(s.text))) { if (m.index > last) out.push({ text: s.text.slice(last, m.index), hit: false }); out.push({ text: rep, hit: true }); last = m.index + m[0].length; }
      if (last < s.text.length) out.push({ text: s.text.slice(last), hit: false }); return out.length ? out : [s];
    });
  }
  return segs;
}

function ScrubEditor({ density }: { density: Density }) {
  const [text, setText] = useState('Shipped v1.4 of the Acme Telecom collections dashboard: 62% faster reconciliation, K18,900 of arrears surfaced in week one.');
  const [published, setPublished] = useState(false);
  const segs = useMemo(() => scrub(text), [text]);
  return (
    <div>
      <h3 className="eyebrow sec-title" style={{ marginBottom: 12 }}>Write privately, publish scrubbed</h3>
      <div className={density === 'desk' ? 'scrub scrub--2' : 'scrub'}>
        <label className="scrub-col"><span className="eyebrow muted">Private</span>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setPublished(false); }} rows={density === 'desk' ? 6 : 5} aria-label="Private shop log entry" /></label>
        <div className="scrub-col"><span className="eyebrow muted">Public preview</span>
          <p className="scrub-prev" aria-live="polite">{segs.map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}</p></div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <Btn kind="primary" size="sm" icon="check" onClick={() => setPublished(true)}>Publish (needs confirm)</Btn>
        <span className="t-micro muted">{published ? 'Published in the mockup only. Nothing leaves the Mac on the real hub until you say so.' : 'Client names, amounts and percentages are replaced before anything is public.'}</span>
      </div>
    </div>
  );
}

const CITIES: { code: string; x: number; y: number; major?: boolean }[] = [
  { code: 'LUN', x: 144.5, y: 153.3, major: true }, { code: 'JNB', x: 142.3, y: 261.4, major: true }, { code: 'CPT', x: 44.2, y: 339.2 },
  { code: 'DUR', x: 170.2, y: 298.6 }, { code: 'HRE', x: 170.5, y: 178.3 }, { code: 'WDH', x: 30.8, y: 225.6 }, { code: 'NBO', x: 228.2, y: 12.9 },
];
function TripMap() {
  return (
    <div>
      <h3 className="eyebrow sec-title">Route · Lusaka to Johannesburg</h3>
      <svg viewBox="0 0 260 360" className="tripmap" role="img" aria-label="Route map from Lusaka (LUN) to Johannesburg (JNB), about 1,200 kilometres. Other airports shown for orientation.">
        <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><rect x="9" y="9" width="2" height="2" className="map-dot" /></pattern></defs>
        <rect width="260" height="360" fill="url(#dots)" />
        <path d="M144.5 153.3 Q 196 207 142.3 261.4" className="map-route" />
        {CITIES.map((c) => (
          <g key={c.code}>
            <rect x={c.x - (c.major ? 5 : 3)} y={c.y - (c.major ? 5 : 3)} width={c.major ? 10 : 6} height={c.major ? 10 : 6} className={c.major ? 'map-pin' : 'map-city'} />
            <text x={c.x + (c.code === 'CPT' || c.code === 'WDH' ? 10 : c.major ? 12 : 9)} y={c.y + 4} className={c.major ? 'map-label map-label--major' : 'map-label'}>{c.code}</text>
          </g>
        ))}
        <text x="186" y="210" className="map-label map-label--major">≈1,200 km</text>
      </svg>
    </div>
  );
}

function LineSection({ s }: { s: Extract<Section, { type: 'line' }> }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const total = s.points.reduce((a, b) => a + b, 0);
  return (
    <section className="sk-sec" data-span="1">
      <div className="sec-row"><h3 className="eyebrow sec-title">{s.title}</h3><Seg<'chart' | 'table'> label="Chart or table view" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} /></div>
      {view === 'chart' ? <LineChart points={s.points} label={s.label} labels={s.labels} format={zmw} /> : (
        <div className="tbl-scroll"><Table cols={[{ key: 'd', label: 'Day' }, { key: 'v', label: 'Spend', align: 'r' }]} rows={s.points.map((p, i) => ({ d: `Day ${i + 1}`, v: zmw(p) }))} total={{ d: 'Total', v: zmw(total) }} /></div>
      )}
      {s.note && <p className="t-micro muted" style={{ marginTop: 6 }}>{s.note}</p>}
    </section>
  );
}

function Sec({ s, density, onSay }: { s: Section; density: Density; onSay: (t: string) => void }) {
  const title = (t?: string) => (t ? <h3 className="eyebrow sec-title">{t}</h3> : null);
  switch (s.type) {
    case 'kpis': return <section className="sk-sec" data-span="2"><Kpis items={s.items} cols={density === 'desk' ? Math.min(4, s.items.length) : (s.cols ?? 2)} /></section>;
    case 'list': return <section className="sk-sec" data-span="1">{title(s.title)}<Rows rows={s.rows} empty={s.empty} /></section>;
    case 'table': return <section className="sk-sec" data-span="1">{title(s.title)}<Table cols={s.cols} rows={s.rows} total={s.total} /></section>;
    case 'bars': return <section className="sk-sec" data-span="1">{title(s.title)}<Bars items={s.items} unit={s.unit} />{s.note && <p className="t-micro muted" style={{ marginTop: 8 }}>{s.note}</p>}</section>;
    case 'line': return <LineSection s={s} />;
    case 'timeline': return <section className="sk-sec" data-span="1">{title(s.title)}<ul className="timeline">{s.items.map((t, i) => <li key={i}><div className="eyebrow">{t.time}</div><div className="row-title" style={{ marginTop: 4 }}>{t.title}</div>{t.sub && <div className="row-sub">{t.sub}</div>}</li>)}</ul></section>;
    case 'actions': return <section className="sk-sec" data-span="2"><div className="actions">{s.items.map((a) => <Btn key={a.label} kind={a.kind ?? 'ghost'} size="sm" icon="mic" onClick={() => onSay(a.utterance)}>{a.label}</Btn>)}</div></section>;
    case 'notice': return <section className="sk-sec" data-span="2"><div className={`notice${s.tone === 'attention' ? ' notice--attention' : ''}`}><Icon name={s.tone === 'offline' ? 'off' : s.tone === 'attention' ? 'warn' : 'lock'} size={18} /><span>{s.text}</span></div></section>;
    case 'links': return <section className="sk-sec" data-span="2"><LinkEditor density={density} /></section>;
    case 'scrub': return <section className="sk-sec" data-span="2"><ScrubEditor density={density} /></section>;
    case 'map': return <section className="sk-sec" data-span="1"><TripMap /></section>;
  }
}

export function SkillScreen({ view, density, onSay }: { view: SkillView; density: Density; onSay: (t: string) => void }) {
  return (
    <div className={`sk sk--${density}`}>
      {view.sections.map((s, i) => <Sec key={i} s={s} density={density} onSay={onSay} />)}
    </div>
  );
}
