import { useState } from 'react';
import { Icon } from '../icons';
import { Btn, Delta, Kpis, ProvChip, Scanner, Spark } from '../kit';
import { skillMeta, type Device, type SkillId } from '../data';
import type { CardModel } from '../engine';
import { SUGGESTIONS } from '../engine';
import { speak } from '../speech';
import { mmss, useCountdown, useStore } from '../state';

export type CardDensity = 'comfort' | 'glance' | 'desk';

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}><i /></button>;
}

/** One card of the priority stack. The index chip is the "why is this here" control (explainable ranking). */
export function StackCard({ card, index, density, device, onOpen }: { card: CardModel; index: number; density: CardDensity; device: Device; onOpen: (skill: SkillId) => void }) {
  const { world, act } = useStore();
  const [why, setWhy] = useState(false);
  const pending = card.skill === 'confirm';
  const left = useCountdown(pending ? world.pending : null);
  const glance = density === 'glance';
  const open = () => { if (!pending) onOpen(card.skill as SkillId); };
  return (
    <article className={`card card--pad-r${card.inverse ? ' card--inverse' : ''}${card.stale ? ' card--stale' : ''}${glance ? ' card--glance' : ''}`} data-level={card.level} aria-label={`${card.eyebrow}: ${card.headline}`}>
      <button type="button" className="idx-chip" aria-expanded={why} aria-label={`Priority ${index + 1}. Show why this card is here.`} onClick={() => setWhy(!why)}>{index + 1}</button>
      <div className="card-head">
        <Icon name={card.icon} size={16} />
        <span className="eyebrow">{card.eyebrow}</span>
        {card.stale && <span className="t-micro">· {card.stale}</span>}
        {pending && left !== null && <span className="t-micro tab-num">· expires in {mmss(left)}</span>}
      </div>
      {glance ? (
        <button type="button" className="card-open" onClick={open}><span className="card-title">{card.headline}</span></button>
      ) : (
        <button type="button" className="card-open" onClick={open} disabled={pending}><span className="card-title">{card.headline}</span><span className="card-sub">{card.sub}</span></button>
      )}
      {!glance && pending && (
        <div className="card-foot">
          <div className="actions">
            <Btn kind="primary" icon="check" disabled={world.offline} onClick={() => act('confirm', device)}>Confirm</Btn>
            <Btn kind="ghost" onClick={() => act('cancel', device)}>Cancel</Btn>
          </div>
          <span className="t-micro">{world.offline ? 'Hub unreachable: nothing can be confirmed.' : 'Or say “Kit, confirm”.'}</span>
        </div>
      )}
      {!glance && !pending && (card.prov || card.delta) && (
        <div className="card-foot">
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{card.prov && <ProvChip kind={card.prov} />}{card.delta && <Delta {...card.delta} />}</span>
          <button type="button" className="link-btn" onClick={() => speak(card.speak)} aria-label={`Read ${card.eyebrow} aloud`}><Icon name="play" size={12} /> Read</button>
        </div>
      )}
      {why && (
        <ul className="why" aria-label="How this card was ranked">
          {card.why.map((w, i) => <li key={i}>{w}</li>)}
          <li><b>= {card.score} points</b> · ranking is recomputed from live data</li>
        </ul>
      )}
    </article>
  );
}

/** Talk surface shared by the phone sheet, the iPad panel and the watch/car states. Deterministic grammar first, so it says so. */
export function TalkPanel({ device, onClose, onOpen }: { device: Device; onClose: () => void; onOpen?: (s: SkillId) => void }) {
  const { state, say, act, world } = useStore();
  const [text, setText] = useState('');
  const t = state.talk.device === device ? state.talk : null;
  const a = t?.answer;
  const busy = t && (t.phase === 'listening' || t.phase === 'thinking');
  return (
    <div className="talk-panel">
      <div className="tp-head"><span className="eyebrow">{!t || t.phase === 'idle' ? 'Talk to Kit' : t.phase === 'listening' ? 'Listening' : t.phase === 'thinking' ? 'Matching a rule' : 'Answer'}</span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button></div>
      {busy && <Scanner />}
      {t && t.transcript && <p className="tp-said">“{t.transcript}”</p>}
      {t?.phase === 'answer' && a && (
        <>
          <p className="tp-answer">{a.speak}</p>
          <div className="tp-meta">
            <span className={`prov ${a.via === 'unknown' ? 'prov--assumed' : 'prov--measured'}`}>{a.via === 'unknown' ? 'No rule matched' : 'Matched by rule'}</span>
            <span className="t-micro muted">{a.via === 'unknown' ? 'the language brain would try next' : 'no model call'} · {a.intent}</span>
          </div>
          {world.pending && a.needsConfirm && (
            <div className="actions" style={{ marginTop: 12 }}>
              <Btn kind="primary" icon="check" onClick={() => act('confirm', device)}>Confirm</Btn><Btn kind="ghost" onClick={() => act('cancel', device)}>Cancel</Btn>
            </div>
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <Btn kind="ghost" size="sm" icon="play" onClick={() => speak(a.speak)}>Speak aloud</Btn>
            {a.open && onOpen && <Btn kind="ghost" size="sm" onClick={() => { onOpen(a.open!); onClose(); }}>Open {skillMeta(a.open).name}</Btn>}
            <Btn kind="ghost" size="sm" onClick={() => say('help', device)}>Help</Btn>
          </div>
        </>
      )}
      {(!t || t.phase === 'idle' || t.phase === 'answer') && (
        <div style={{ marginTop: 14 }}>
          <p className="eyebrow muted" style={{ marginBottom: 8 }}>Try saying</p>
          <div className="sugg">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => say(s, device)}>{s}</button>)}</div>
          <form className="tp-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { say(text.trim(), device); setText(''); } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a command" aria-label="Type a command for Kit" />
            <Btn kind="solid" size="sm" icon="right" label="Send">Send</Btn>
          </form>
        </div>
      )}
    </div>
  );
}

export function HubHealth() {
  const { world } = useStore(); const h = world.hub;
  return (
    <div>
      <Kpis cols={2} items={[
        { label: 'Hub coverage, 7 days', value: `${h.coverage}%`, prov: 'measured', sub: 'gate: 80% or more' },
        { label: 'Siri success', value: `${h.siri}%`, prov: 'measured', sub: 'gate: 80% or more' },
        { label: 'On power', value: `${h.onAc}%`, prov: 'measured' },
        { label: 'Brain latency', value: `${h.brainSec}s`, prov: 'measured', sub: `${h.routinesOk}/${h.routinesTotal} routines ok` },
      ]} />
      <div style={{ marginTop: 12 }}><Spark points={h.spark} width={200} height={36} label="Hub coverage over the last 7 days" /></div>
    </div>
  );
}

export interface BriefItem { at: string; title: string; text: string }
export function briefItems(cards: CardModel[]): { items: BriefItem[]; total: string } {
  let t = 3; const items: BriefItem[] = [{ at: '0:00', title: 'Greeting', text: 'Good morning, Travis.' }];
  for (const c of cards.filter((x) => x.skill !== 'confirm').slice(0, 7)) {
    items.push({ at: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, title: c.eyebrow, text: c.speak });
    t += Math.max(5, Math.round(c.speak.split(/\s+/).length / 2.7));
  }
  return { items, total: `${Math.floor((t + 3) / 60)}:${String((t + 3) % 60).padStart(2, '0')}` };
}
