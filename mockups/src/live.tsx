// The live connection: one hub, polled, shared by every screen (phone, desk, TV). Nothing here is synthetic.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HubClient, HubError, loadConn, saveConn, servedByHub, type AskReply, type AuditRow, type Episode, type HubConn, type HubState, type PendingAction, type SkillViewResponse } from './hub';
import { HEADLINE_SKILLS } from './model';

export type LiveStatus = 'unset' | 'connecting' | 'online' | 'offline';
export interface Talk { phase: 'idle' | 'thinking' | 'answer'; text: string; reply: AskReply | null; error?: string }

export interface Live {
  conn: HubConn | null; client: HubClient | null; status: LiveStatus; error: string | null; lastOk: number | null;
  state: HubState | null; audit: AuditRow[]; pending: PendingAction[];
  views: Record<string, SkillViewResponse | undefined>; viewErrors: Record<string, string>; viewLoading: Record<string, boolean>;
  talk: Talk; hubHere: string | null;
  connect: (c: HubConn) => Promise<void>; disconnect: () => void; refresh: () => Promise<void>;
  loadView: (id: string, force?: boolean) => Promise<SkillViewResponse | null>;
  ask: (text: string) => Promise<AskReply | null>; confirm: (code?: string) => Promise<AskReply | null>; cancel: (code?: string) => Promise<AskReply | null>; more: () => Promise<AskReply | null>;
  dismissTalk: () => void;
  episodes: () => Promise<Episode[]>; audioURL: (file: string) => Promise<string>;
}

const C = createContext<Live | null>(null);
const IDLE: Talk = { phase: 'idle', text: '', reply: null };
const POLL_MS = 20_000;
const VIEW_TTL_MS = 60_000;

const msg = (e: unknown) => (e instanceof HubError ? e.message : e instanceof Error ? e.message : String(e));

export function LiveProvider({ children }: { children: ReactNode }) {
  const [conn, setConn] = useState<HubConn | null>(() => loadConn());
  const client = useMemo(() => (conn ? new HubClient(conn) : null), [conn]);
  const [status, setStatus] = useState<LiveStatus>(conn ? 'connecting' : 'unset');
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [state, setState] = useState<HubState | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [views, setViews] = useState<Record<string, SkillViewResponse | undefined>>({});
  const [viewErrors, setViewErrors] = useState<Record<string, string>>({});
  const [viewLoading, setViewLoading] = useState<Record<string, boolean>>({});
  const [talk, setTalk] = useState<Talk>(IDLE);
  const viewAt = useRef<Record<string, number>>({});
  const blobs = useRef<Map<string, string>>(new Map());
  const polling = useRef(false);

  const refresh = useCallback(async () => {
    if (!client || polling.current) return;
    polling.current = true;
    try {
      const [s, ev] = await Promise.all([client.state(), client.events(80)]);
      setState(s); setAudit([...ev.audit].reverse()); setPending(ev.pending ?? s.pending ?? []);
      setStatus('online'); setError(null); setLastOk(Date.now());
    } catch (e) {
      setStatus('offline'); setError(msg(e));
    } finally { polling.current = false; }
  }, [client]);

  // poll while the page is visible; one immediate read when it becomes visible again
  useEffect(() => {
    if (!client) { setStatus('unset'); setState(null); setAudit([]); setPending([]); setViews({}); viewAt.current = {}; return; }
    setStatus('connecting');
    void refresh();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [client, refresh]);

  const loadView = useCallback(async (id: string, force = false) => {
    if (!client) return null;
    const at = viewAt.current[id] || 0;
    if (!force && Date.now() - at < VIEW_TTL_MS) return null;
    viewAt.current[id] = Date.now();
    setViewLoading((m) => ({ ...m, [id]: true }));
    try {
      const r = await client.skillView(id);
      setViews((m) => ({ ...m, [id]: r })); setViewErrors((m) => { const n = { ...m }; delete n[id]; return n; });
      return r;
    } catch (e) {
      viewAt.current[id] = 0;
      setViewErrors((m) => ({ ...m, [id]: msg(e) }));
      return null;
    } finally { setViewLoading((m) => ({ ...m, [id]: false })); }
  }, [client]);

  // the headline skills feed the Now screen and the TV tiles: refreshed every minute while online
  useEffect(() => {
    if (status !== 'online' || !state) return;
    const ids = HEADLINE_SKILLS.filter((id) => state.skills[id]);
    void Promise.allSettled(ids.map((id) => loadView(id)));
  }, [status, state, loadView]);

  const connect = useCallback(async (c: HubConn) => {
    const cl = new HubClient(c);
    await cl.state();                      // throws with a readable message when the address or the token is wrong
    saveConn(cl.conn); setConn(cl.conn); setTalk(IDLE);
  }, []);
  const disconnect = useCallback(() => { saveConn(null); setConn(null); setError(null); setLastOk(null); setTalk(IDLE); }, []);

  const run = useCallback(async (text: string, call: () => Promise<AskReply>) => {
    if (!client) return null;
    setTalk({ phase: 'thinking', text, reply: null });
    try {
      const r = await call();
      setTalk({ phase: 'answer', text, reply: r });
      void refresh();
      return r;
    } catch (e) {
      const m = e instanceof HubError && e.status === 409 ? 'That request changed on the hub. Review the new one before confirming.' : msg(e);
      setTalk({ phase: 'answer', text, reply: null, error: m });
      void refresh();
      return null;
    }
  }, [client, refresh]);

  const ask = useCallback((text: string) => run(text, () => client!.ask(text)), [client, run]);
  const confirm = useCallback((code?: string) => run('Kit, confirm', () => client!.confirm(code)), [client, run]);
  const cancel = useCallback((code?: string) => run('Kit, cancel', () => client!.cancel(code)), [client, run]);
  const more = useCallback(() => run('more', () => client!.more()), [client, run]);
  const dismissTalk = useCallback(() => setTalk(IDLE), []);

  const episodes = useCallback(async () => (client ? (await client.episodes()).episodes : []), [client]);
  const audioURL = useCallback(async (file: string) => {
    if (!client) throw new Error('not connected');
    const hit = blobs.current.get(file); if (hit) return hit;
    const url = URL.createObjectURL(await client.audioBlob(file));
    blobs.current.set(file, url); return url;
  }, [client]);
  useEffect(() => () => { for (const u of blobs.current.values()) URL.revokeObjectURL(u); blobs.current.clear(); }, [client]);

  const value: Live = useMemo(() => ({
    conn, client, status, error, lastOk, state, audit, pending, views, viewErrors, viewLoading, talk, hubHere: servedByHub(),
    connect, disconnect, refresh, loadView, ask, confirm, cancel, more, dismissTalk, episodes, audioURL,
  }), [conn, client, status, error, lastOk, state, audit, pending, views, viewErrors, viewLoading, talk, connect, disconnect, refresh, loadView, ask, confirm, cancel, more, dismissTalk, episodes, audioURL]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useLive(): Live { const c = useContext(C); if (!c) throw new Error('LiveProvider missing'); return c; }

/** Wall clock in the hub's time zone, ticking twice a minute. */
export function useClock(tz?: string): { time: string; date: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(id); }, []);
  return useMemo(() => {
    const f = (o: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o }).format(now); } catch { return new Intl.DateTimeFormat('en-GB', o).format(now); } };
    return { time: f({ hour: '2-digit', minute: '2-digit' }), date: f({ weekday: 'short', day: 'numeric', month: 'short' }) };
  }, [now, tz]);
}

/** Seconds until a pending action expires, ticking once a second (null when there is no expiry). */
export function useExpiry(expiresAt?: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!expiresAt) return; const i = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(i); }, [expiresAt]);
  if (!expiresAt) return null;
  const s = expiresAt.replace(' ', 'T'); const t = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((t - now) / 1000));
}
