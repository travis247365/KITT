// Small helpers for reading what the hub sends (shapes vary by skill) and formatting it. The mapping onto the screens' World
// model lives in src/liveWorld.ts.
import type { Level } from './kit';

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** A count or amount out of whatever the skill sent: a number, a numeric string, an array (its length) or a totals object. */
export function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (Array.isArray(v)) return v.length;
  if (isObj(v)) for (const k of ['total', 's', 'sum', 'amount', 'value', 'zmw', 'monthly_zmw', 'monthly', 'n', 'count']) if (typeof v[k] === 'number') return v[k] as number;
  return 0;
}
export const str = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : '');
export const first = (o: Obj, keys: string[]): unknown => { for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
export const firstStr = (o: Obj, keys: string[]): string => str(first(o, keys));
export const firstNum = (o: Obj, keys: string[]): number => num(first(o, keys));

/** SQLite gives "YYYY-MM-DD HH:MM:SS" in UTC with no zone; the hub's own stamps are ISO with Z; dates alone are days. */
export function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  s = s.replace(' ', 'T');
  if (/T\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const fmt = (d: Date, tz: string | undefined, opts: Intl.DateTimeFormatOptions) => {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(d); } catch { return new Intl.DateTimeFormat('en-GB', opts).format(d); }
};
export const fmtTime = (v: unknown, tz?: string) => { const d = parseDate(v); return d ? fmt(d, tz, { hour: '2-digit', minute: '2-digit' }) : str(v); };
export const fmtDay = (v: unknown, tz?: string) => { const d = parseDate(v); return d ? fmt(d, tz, { weekday: 'short', day: 'numeric', month: 'short' }) : str(v); };
/** "Tue 17:40" for today-ish stamps, "Sat 7 Nov" for older ones: what the designed rows expect. */
export function fmtWhen(v: unknown, tz?: string, now = Date.now()): string {
  const d = parseDate(v); if (!d) return str(v);
  return now - d.getTime() < 6 * 86400000 ? `${fmt(d, tz, { weekday: 'short' })} ${fmtTime(d, tz)}` : fmtDay(d, tz);
}
export function ago(v: unknown, now = Date.now()): string {
  const d = parseDate(v); if (!d) return str(v);
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDay(d);
}
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

export function levelOf(v: unknown): Level | undefined {
  const s = str(v).toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low' || s === 'info') return s;
  if (s === 'warn' || s === 'warning') return 'medium';
  if (s === 'error' || s === 'sev1') return 'high';
  return undefined;
}

/** The hub's coverage figure (7-day uptime), whatever shape it arrives in. */
export function coveragePct(v: unknown): number | null {
  if (typeof v === 'number') return v <= 1 ? Math.round(v * 100) : Math.round(v);
  if (isObj(v)) { const p = first(v, ['uptime_pct', 'pct', 'percent', 'coverage', 'ratio']); if (typeof p === 'number') return p <= 1 ? Math.round(p * 100) : Math.round(p); }
  return null;
}

/** The skill views the Now screen and the TV tiles need first; the rest load when their screen opens. */
export const HEADLINE_SKILLS = ['security', 'chief', 'money', 'receptionist', 'whatsapp', 'subscriptions'];
