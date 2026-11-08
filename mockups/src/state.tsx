import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { nativePost, onNative } from './native';
import { answer, resolveLayout, type Answer, type Layout, type LayoutPref } from './engine';
import { buildWorld, SKILLS, type CashLog, type Device, type IdeaAdd, type Pending, type ScenarioId, type SkillId, type World } from './data';
import { HubError, type AskReply } from './hub';
import { useLive, type Live } from './live';
import { buildLiveWorld } from './liveWorld';

export type Appearance = 'system' | 'light' | 'dark';
export interface Talk { phase: 'idle' | 'listening' | 'thinking' | 'answer'; device: Device | null; transcript: string; answer: Answer | null }
interface Persist { scenario: ScenarioId; layout: LayoutPref; appearance: Appearance; large: boolean }
interface State extends Persist { cashLogs: CashLog[]; ideasAdded: IdeaAdd[]; linkOrder: string[]; hiddenLinks: string[]; pending: Pending | null; audit: World['audit']; talk: Talk }

const KEY = 'kitt.mockups.v1';
const IDLE: Talk = { phase: 'idle', device: null, transcript: '', answer: null };
const draftPending = (): Pending => ({ id: 'draft', kind: 'draft', skill: 'receptionist', summary: 'Draft reply to the insurance broker', speak: 'Saying: "Yes, please proceed with the renewal. I will pay today." Saved as a Gmail draft, never sent.', source: 'phone', createdAt: Date.now(), ttlSec: 600 });

function load(): Persist {
  const d: Persist = { scenario: 'morning', layout: 'auto', appearance: 'system', large: false };
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...d, ...JSON.parse(raw) }; } catch { /* private mode */ }
  return d;
}

type Action =
  | { t: 'set'; patch: Partial<Persist> }
  | { t: 'scenario'; id: ScenarioId }
  | { t: 'talk'; talk: Talk }
  | { t: 'apply'; a: Answer; device: Device; text: string }
  | { t: 'moveLink'; id: string; dir: -1 | 1; ids: string[] }
  | { t: 'toggleLink'; id: string }
  | { t: 'order'; ids: string[] }
  | { t: 'reset' };

const stamp = () => 'Tue 07:13';

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case 'set': return { ...s, ...a.patch };
    case 'scenario': return { ...s, scenario: a.id, pending: a.id === 'pending' ? draftPending() : null, talk: IDLE };
    case 'talk': return { ...s, talk: a.talk };
    case 'apply': {
      let next: State = { ...s, audit: [{ ts: '07:13', source: a.device, intent: a.a.intent, outcome: a.a.via === 'unknown' ? 'unknown' : 'ok' }, ...s.audit].slice(0, 8) };
      if (a.a.needsConfirm) next = { ...next, pending: { ...a.a.needsConfirm, source: a.device, createdAt: Date.now() } };
      if (a.a.effect?.type === 'confirm' && s.pending) {
        if (s.pending.kind === 'log_cash') next = { ...next, cashLogs: [...next.cashLogs, { amount: s.pending.payload?.amount ?? 0, note: s.pending.payload?.note ?? 'cash', ts: stamp() }] };
        next = { ...next, pending: null };
      }
      if (a.a.effect?.type === 'cancel') next = { ...next, pending: null };
      if (a.a.effect?.type === 'idea' && a.a.effect.text) next = { ...next, ideasAdded: [...next.ideasAdded, { text: a.a.effect.text, ts: stamp() }] };
      return next;
    }
    case 'moveLink': {
      const i = a.ids.indexOf(a.id); const j = i + a.dir; if (i < 0 || j < 0 || j >= a.ids.length) return s;
      const ids = [...a.ids]; [ids[i], ids[j]] = [ids[j], ids[i]]; return { ...s, linkOrder: ids };
    }
    case 'order': return { ...s, linkOrder: a.ids };
    case 'toggleLink': return { ...s, hiddenLinks: s.hiddenLinks.includes(a.id) ? s.hiddenLinks.filter((x) => x !== a.id) : [...s.hiddenLinks, a.id] };
    case 'reset': return init(load());
  }
}

function init(p: Persist): State {
  return { ...p, cashLogs: [], ideasAdded: [], linkOrder: [], hiddenLinks: [], pending: p.scenario === 'pending' ? draftPending() : null, audit: [
    { ts: '07:05', source: 'cron', intent: 'brief:morning', outcome: 'ok' }, { ts: '06:58', source: 'siri', intent: 'security.brief', outcome: 'ok' }, { ts: 'Mon 21:10', source: 'siri', intent: 'ideas.capture', outcome: 'ok' },
  ], talk: IDLE };
}

interface Ctx {
  state: State; world: World; set: (patch: Partial<Persist>) => void; scenario: (id: ScenarioId) => void;
  say: (text: string, device: Device) => void; act: (what: 'confirm' | 'cancel', device: Device) => void; dismissTalk: () => void;
  moveLink: (id: string, dir: -1 | 1) => void; setLinkOrder: (ids: string[]) => void; toggleLink: (id: string) => void; reset: () => void;
  layoutFor: (device: Device) => Layout; themeFor: (device: Device) => 'light' | 'dark'; systemDark: boolean;
  /** True when the screens show the hub's data (the live app); false on the design prototype's routes. */
  isLive: boolean; live: Live;
}
const C = createContext<Ctx | null>(null);

/** The prototype's routes keep the synthetic world even while a hub is connected; everything else is live when it is. */
const DEMO_ROUTE = /^(demo|lab|iphone|ipad|watch|car|surfaces|appletv|appletv-v1|frame)(\/|$)/;
function useDemoRoute(): boolean {
  const read = () => DEMO_ROUTE.test(window.location.hash.replace(/^#\/?/, '').split('?')[0]);
  const [demo, setDemo] = useState(read);
  useEffect(() => { const f = () => setDemo(read()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return demo;
}

/** The hub's answer in the shape the talk panels draw. */
function liveAnswer(r: AskReply, device: Device): Answer {
  const skill = typeof r.skill === 'string' && SKILLS.some((s) => s.id === r.skill) ? (r.skill as SkillId) : undefined;
  const known = Boolean(r.intent && r.intent !== 'none');
  return {
    speak: r.speak, via: known || r.needs_confirm ? 'pattern' : 'unknown', intent: r.intent || (r.needs_confirm ? 'confirm' : 'none'), open: skill,
    needsConfirm: r.needs_confirm ? { id: String(r.code ?? 'pending'), kind: skill === 'money' ? 'log_cash' : 'draft', skill: skill ?? 'receptionist', summary: r.speak, speak: r.speak, source: device, createdAt: Date.now(), ttlSec: 600 } : undefined,
  };
}
const failAnswer = (e: unknown): Answer => ({ speak: e instanceof HubError ? e.message : 'The hub did not answer.', via: 'unknown', intent: 'error' });

export function StoreProvider({ children }: { children: ReactNode }) {
  const live = useLive();
  const demoRoute = useDemoRoute();
  const isLive = Boolean(live.conn) && !demoRoute;
  const [state, dispatch] = useReducer(reduce, undefined, () => init(load()));
  const [systemDark, setSystemDark] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false));
  const world = useMemo(() => (isLive ? buildLiveWorld(live) : buildWorld(state)), [isLive, live, state]);
  const ref = useRef({ world, state, live, isLive });
  useEffect(() => { ref.current = { world, state, live, isLive }; });
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  useEffect(() => () => clear(), []);
  useEffect(() => { if (!window.matchMedia) return; const m = window.matchMedia('(prefers-color-scheme: dark)'); const on = () => setSystemDark(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  useEffect(() => { try { const { scenario, layout, appearance, large } = state; localStorage.setItem(KEY, JSON.stringify({ scenario, layout, appearance, large })); } catch { /* ignore */ } }, [state.scenario, state.layout, state.appearance, state.large]); // eslint-disable-line

  const say = useCallback((text: string, device: Device) => {
    clear();
    const { isLive: lv, live: l } = ref.current;
    if (lv && l.client) {
      if (!text.trim()) return;                 // the phone's talk bar opens its sheet with an empty say
      const client = l.client;
      dispatch({ t: 'talk', talk: { phase: 'thinking', device, transcript: text, answer: null } });
      void (async () => {
        let a: Answer;
        try { a = liveAnswer(await client.ask(text, 'web'), device); } catch (e) { a = failAnswer(e); }
        dispatch({ t: 'talk', talk: { phase: 'answer', device, transcript: text, answer: a } });
        nativePost({ type: 'answer', speak: a.speak, needsConfirm: Boolean(a.needsConfirm) });   // the native app reads it aloud
        void l.refresh();
      })();
      return;
    }
    dispatch({ t: 'talk', talk: { phase: 'listening', device, transcript: '', answer: null } });
    timers.current.push(window.setTimeout(() => dispatch({ t: 'talk', talk: { phase: 'listening', device, transcript: text, answer: null } }), 500));
    timers.current.push(window.setTimeout(() => dispatch({ t: 'talk', talk: { phase: 'thinking', device, transcript: text, answer: null } }), 1100));
    timers.current.push(window.setTimeout(() => {
      const a = answer(text, ref.current.world, device, Date.now());
      dispatch({ t: 'apply', a, device, text });
      dispatch({ t: 'talk', talk: { phase: 'answer', device, transcript: text, answer: a } });
    }, 1550));
  }, []);
  // The native apps drive this same flow from the phone's microphone (native.ts): words so far while you speak, then the final words.
  useEffect(() => {
    const dev = (): Device => (window.innerWidth <= 760 ? 'phone' : 'pad');
    const offListening = onNative<{ text?: string }>('kitt:listening', (d) => dispatch({ t: 'talk', talk: { phase: 'listening', device: dev(), transcript: d?.text ?? '', answer: null } }));
    const offSay = onNative<{ text?: string }>('kitt:say', (d) => {
      if (d?.text?.trim()) say(d.text.trim(), dev());
      else dispatch({ t: 'talk', talk: { phase: 'idle', device: dev(), transcript: '', answer: null } });
    });
    return () => { offListening(); offSay(); };
  }, [say]);

  const act = useCallback((what: 'confirm' | 'cancel', device: Device) => {
    const { isLive: lv, live: l, world: w } = ref.current;
    if (lv && l.client) {
      const client = l.client; const code = w.pending?.id;
      const transcript = what === 'confirm' ? 'Kit, confirm' : 'Kit, cancel';
      dispatch({ t: 'talk', talk: { phase: 'thinking', device, transcript, answer: null } });
      void (async () => {
        let a: Answer;
        try {
          const r = await (what === 'confirm' ? client.confirm(code, 'web') : client.cancel(code, 'web'));
          a = { speak: r.speak, via: 'confirm', intent: what, effect: { type: what } };
        } catch (e) { a = e instanceof HubError && e.status === 409 ? { speak: 'That request changed on the hub. Review the new one first.', via: 'confirm', intent: what } : failAnswer(e); }
        dispatch({ t: 'talk', talk: { phase: 'answer', device, transcript, answer: a } });
        void l.refresh();
      })();
      return;
    }
    const a = answer(what, ref.current.world, device, Date.now());
    dispatch({ t: 'apply', a, device, text: what });
    dispatch({ t: 'talk', talk: { phase: 'answer', device, transcript: what === 'confirm' ? 'Kit, confirm' : 'Kit, cancel', answer: a } });
  }, []);

  const value: Ctx = useMemo(() => ({
    state, world, systemDark, isLive, live,
    set: (patch) => dispatch({ t: 'set', patch }), scenario: (id) => dispatch({ t: 'scenario', id }),
    say, act, dismissTalk: () => { clear(); dispatch({ t: 'talk', talk: IDLE }); },
    moveLink: (id, dir) => dispatch({ t: 'moveLink', id, dir, ids: ref.current.world.links.map((l) => l.id) }),
    setLinkOrder: (ids) => dispatch({ t: 'order', ids }), toggleLink: (id) => dispatch({ t: 'toggleLink', id }), reset: () => dispatch({ t: 'reset' }),
    layoutFor: (d) => resolveLayout(d, state.layout),
    themeFor: (d) => (d === 'car' || d === 'watch' ? (state.appearance === 'light' ? 'light' : 'dark') : state.appearance === 'system' ? (systemDark ? 'dark' : 'light') : state.appearance),
  }), [state, world, systemDark, isLive, live, say, act]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useStore(): Ctx { const c = useContext(C); if (!c) throw new Error('StoreProvider missing'); return c; }

/** Seconds left on the pending action, ticking once a second. */
export function useCountdown(p: Pending | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!p) return; const i = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(i); }, [p]);
  if (!p) return null;
  return Math.max(0, p.ttlSec - Math.floor((Math.max(now, p.createdAt) - p.createdAt) / 1000));
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
