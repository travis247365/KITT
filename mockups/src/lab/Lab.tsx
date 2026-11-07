import { useState, type ReactNode } from 'react';
import { Btn, Seg } from '../kit';
import { SCENARIOS } from '../data';
import type { LayoutPref } from '../engine';
import { useStore, type Appearance } from '../state';
import { CAR, PAD, PHONE, CarFrame, PadFrame, PhoneFrame, WatchFrame } from '../devices/Frames';
import { ScaledBox } from '../devices/Stage';
import { Switch } from '../surfaces/shared';
import { Phone } from '../surfaces/Phone';
import { Pad } from '../surfaces/Pad';
import { Watch, WATCH_PAGES, type WatchPage } from '../surfaces/Watch';
import { Car, CarControls } from '../surfaces/Car';
import { Island, Widgets } from '../surfaces/Surfaces';

export const WATCH_FRAME = { w: 250, h: 336 };

export function ProtoControls() {
  const { state, set, scenario, reset } = useStore();
  const hint = SCENARIOS.find((s) => s.id === state.scenario)?.hint;
  return (
    <div className="proto-body" data-theme="dark">
      <div className="proto-grp"><span className="eyebrow">Scenario</span>
        <div className="proto-chips">{SCENARIOS.map((s) => <button key={s.id} type="button" aria-pressed={state.scenario === s.id} onClick={() => scenario(s.id)}>{s.label}</button>)}</div>
        <span className="t-micro proto-hint">{hint}</span></div>
      <div className="proto-grp"><span className="eyebrow">Layout</span>
        <Seg<LayoutPref> label="Layout" value={state.layout} onChange={(v) => set({ layout: v })} options={[{ value: 'auto', label: 'Auto' }, { value: 'drive', label: 'Drive' }, { value: 'glance', label: 'Glance' }, { value: 'desk', label: 'Desk' }]} /></div>
      <div className="proto-grp"><span className="eyebrow">Appearance</span>
        <Seg<Appearance> label="Appearance" value={state.appearance} onChange={(v) => set({ appearance: v })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
      <div className="proto-grp"><span className="eyebrow">Large type</span><Switch on={state.large} onChange={(v) => set({ large: v })} label="Large type" /></div>
      <div className="proto-grp"><span className="eyebrow">Demo data</span><Btn kind="ghost" size="sm" onClick={reset}>Reset</Btn></div>
    </div>
  );
}

/** Floating controls for the full-size device routes. */
export function ProtoBar() {
  const [open, setOpen] = useState(false);
  const { isLive } = useStore();
  if (isLive) return null;   // the scenario switches mean nothing on the hub's data
  return (
    <div className="proto" data-theme="dark">
      <button type="button" className="proto-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide controls' : 'Prototype controls'}</button>
      {open && <ProtoControls />}
    </div>
  );
}

function Dev({ title, link, children, w, h, scale, extra }: { title: string; link?: string; children: ReactNode; w: number; h: number; scale: number; extra?: ReactNode }) {
  return (
    <section className="dev">
      <div className="dev-cap"><h2 className="eyebrow">{title}</h2>{link && <a href={link}>Open full size</a>}</div>
      <ScaledBox width={w} height={h} scale={scale}>{children}</ScaledBox>
      {extra}
    </section>
  );
}

export function Lab() {
  const [wp, setWp] = useState<WatchPage>('face');
  return (
    <div className="lab" data-theme="dark">
      <header className="lab-head">
        <div className="lab-title">
          <span className="accent-block" />
          <h1 className="t-title">KITT <b>mockups</b></h1>
          <p className="t-body lab-lede">One hub, four surfaces. Interactive, with synthetic data. Change the scenario and every device re-ranks, re-lays out and re-themes; ask Kit something on any device and the others follow.</p>
        </div>
        <ProtoControls />
      </header>
      <main className="lab-grid">
        <Dev title="iPad · Desk" link="#/ipad" w={PAD.w + 20} h={PAD.h + 20} scale={0.6}><PadFrame><Pad /></PadFrame></Dev>
        <Dev title="iPhone · live" link="#/iphone" w={PHONE.w + 20} h={PHONE.h + 20} scale={0.58}><PhoneFrame><Phone /></PhoneFrame></Dev>
        <Dev title="iPhone · Drive" w={PHONE.w + 20} h={PHONE.h + 20} scale={0.58}><PhoneFrame><Phone layout="drive" /></PhoneFrame></Dev>
        <Dev title="Apple Watch" link="#/watch" w={WATCH_FRAME.w} h={WATCH_FRAME.h} scale={1.25}
          extra={<div style={{ marginTop: 10 }}><Seg<WatchPage> label="Watch page" value={wp} onChange={setWp} options={WATCH_PAGES.map((p) => ({ value: p.id, label: p.label }))} /></div>}>
          <WatchFrame><Watch page={wp} onPage={setWp} /></WatchFrame>
        </Dev>
        <Dev title="CarPlay · display only" link="#/car" w={CAR.w + 20} h={CAR.h + 20} scale={0.52} extra={<div style={{ marginTop: 10 }}><CarControls /></div>}><CarFrame><Car /></CarFrame></Dev>
        <section className="dev dev--wide">
          <div className="dev-cap"><h2 className="eyebrow">Beyond the app</h2><a href="#/surfaces">Open Lock Screen, widgets, StandBy</a></div>
          <div style={{ display: 'grid', gap: 22 }}><Island /><Widgets /></div>
        </section>
      </main>
      <footer className="lab-foot t-small">
        <p><b>How the stack is ranked:</b> every card gets points from live data (a pending action outranks everything, then critical findings, then overdue work). Tap a card’s number to see its points.</p>
        <p><b>What is real:</b> the layout logic, ranking, confirm-anywhere flow and the pattern grammar. <b>What is not:</b> every figure is invented, and nothing leaves this page.</p>
      </footer>
    </div>
  );
}
