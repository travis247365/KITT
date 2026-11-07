// The hub's HTTP contract as the web app uses it (see src/server.js in the hub). Bearer token on every /v1 route.

export interface HubConn { url: string; token: string }

export interface SkillHealth { name: string; description?: string; ok?: boolean; detail?: string; unavailable?: boolean }
export interface PendingAction {
  code: string; skill: string; summary: string; source?: string; speak?: string;
  created_at?: string; expires_at?: string; status?: string; [k: string]: unknown;
}
export interface Routine { name: string; skill?: string; cron?: string; description?: string; last_run_at?: string | null; last_status?: string | null }
export interface HubState {
  version: string; now: string; tz?: string;
  brain?: { ok?: boolean; provider?: string; detail?: string };
  notifier?: unknown; pending: PendingAction[]; coverage?: unknown;
  routines: Routine[]; skills: Record<string, SkillHealth>;
  unavailable?: { id: string; error?: string }[]; briefs?: Record<string, unknown>;
}
export interface AuditRow { id: number; ts: string; source: string; skill?: string | null; intent?: string | null; input?: string | null; outcome: string; detail?: string | null; latency_ms?: number | null }
export interface HubEvents { since: number; next: number; audit: AuditRow[]; pending: PendingAction[]; continuations: { source: string; created_at: string }[] }
export interface Episode { id: number; slug: string; title: string; description?: string; file: string; bytes?: number; duration_s?: number; created_at?: string; published_at?: string }
export interface AskReply { speak: string; intent?: string; skill?: string; needs_confirm?: boolean; code?: string; via?: string; [k: string]: unknown }
export interface SkillIntent { name: string; examples: string[]; write: boolean }
export interface SkillViewResponse { id: string; name: string; description?: string; health?: { ok?: boolean; detail?: string }; intents?: SkillIntent[]; routines?: Routine[]; view: Record<string, unknown> }

export class HubError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) { super(message); this.status = status; this.body = body; }
}

/** "10.0.1.30:2000" → "http://10.0.1.30:2000"; trailing slashes dropped. */
export function normalizeURL(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '');
}

/** What a browser can say about an address before trying it: https pages cannot call an http hub (mixed content). */
export function mixedContent(url: string): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(url);
}

export class HubClient {
  conn: HubConn;
  constructor(conn: HubConn) { this.conn = { url: normalizeURL(conn.url), token: conn.token.trim() }; }

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.conn.token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${this.conn.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store' });
    } catch (e) {
      throw new HubError(0, mixedContent(this.conn.url) ? 'This page is https and the hub is http: browsers block that. Open the app from the hub itself, or give the hub an https address.' : `Cannot reach the hub (${(e as Error).message}).`);
    }
    if (res.status === 204) return {} as T;
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') ? (data as { error: string }).error : `${res.status} ${res.statusText}`;
      throw new HubError(res.status, res.status === 401 || res.status === 403 ? 'The hub refused the app token.' : msg, data);
    }
    return data as T;
  }

  /** No token needed: the cheapest reachability check. */
  async reachable(signal?: AbortSignal): Promise<{ ok: boolean; version?: string }> {
    try {
      const res = await fetch(`${this.conn.url}/healthz`, { signal, cache: 'no-store' });
      if (!res.ok) return { ok: false };
      const j = (await res.json()) as { version?: string };
      return { ok: true, version: j.version };
    } catch { return { ok: false }; }
  }

  state(signal?: AbortSignal) { return this.req<HubState>('GET', '/v1/state', undefined, signal); }
  events(latest = 60, signal?: AbortSignal) { return this.req<HubEvents>('GET', `/v1/events?latest=${latest}`, undefined, signal); }
  eventsSince(since: number, signal?: AbortSignal) { return this.req<HubEvents>('GET', `/v1/events?since=${since}&limit=200`, undefined, signal); }
  skillView(id: string, signal?: AbortSignal) { return this.req<SkillViewResponse>('GET', `/v1/skills/${encodeURIComponent(id)}/view`, undefined, signal); }
  ask(text: string, source = 'web') { return this.req<AskReply>('POST', '/v1/ask', { text, source }); }
  confirm(code?: string, source = 'web') { return this.req<AskReply>('POST', '/v1/confirm', { source, ...(code ? { code } : {}) }); }
  cancel(code?: string, source = 'web') { return this.req<AskReply>('POST', '/v1/cancel', { source, ...(code ? { code } : {}) }); }
  more(source = 'web') { return this.req<AskReply>('GET', `/v1/more?source=${encodeURIComponent(source)}`); }
  episodes(signal?: AbortSignal) { return this.req<{ episodes: Episode[] }>('GET', '/v1/episodes', undefined, signal); }

  /** The audio route wants the bearer header, which an <audio src> cannot send: fetch it and play the blob. */
  async audioBlob(file: string, signal?: AbortSignal): Promise<Blob> {
    const res = await fetch(`${this.conn.url}/v1/audio/${encodeURIComponent(file)}`, { headers: { authorization: `Bearer ${this.conn.token}` }, signal });
    if (!res.ok) throw new HubError(res.status, res.status === 404 ? 'That brief is no longer on the hub.' : 'The brief could not be downloaded.');
    return res.blob();
  }
}

const KEY = 'kitt.web.hub.v1';

/** The address the page was served from, when the hub itself serves the app (http://<mac>:2000/app/). */
export function servedByHub(): string | null {
  if (typeof window === 'undefined') return null;
  return /^\/app(\/|$)/.test(window.location.pathname) ? window.location.origin : null;
}

export function loadConn(): HubConn | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const c = JSON.parse(raw) as HubConn; if (c && c.url && c.token) return c; }
  } catch { /* private mode */ }
  return null;
}
export function saveConn(c: HubConn | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}
