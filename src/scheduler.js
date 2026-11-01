// Routine scheduler with cron expressions, Africa/Lusaka local time, and catch-up semantics:
// if the Mac was asleep at 07:00, the morning routine still runs when it wakes (within the catch-up window).
import { log } from './log.js';
import { recordAudit } from './audit.js';

const FIELDS = [['min', 0, 59], ['hour', 0, 23], ['dom', 1, 31], ['mon', 1, 12], ['dow', 0, 6]];

function parseField(field, min, max) {
  if (field === '*') return null;
  const set = new Set();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`bad cron field "${field}"`);
    let lo = m[1] === '*' ? min : Number(m[1]);
    let hi = m[2] !== undefined ? Number(m[2]) : (m[1] === '*' ? max : lo);
    const step = m[3] !== undefined ? Number(m[3]) : 1;
    if (max === 6) { if (lo === 7) lo = 0; if (hi === 7) hi = 0; }
    if (lo < min || hi > max || step < 1) throw new Error(`cron field out of range "${field}"`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}

export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron needs 5 fields: "${expr}"`);
  const out = { expr };
  FIELDS.forEach(([name, min, max], i) => { out[name] = parseField(parts[i], min, max); });
  return out;
}

export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
  const p = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { year: Number(p.year), mon: Number(p.month), dom: Number(p.day), hour: Number(p.hour), min: Number(p.minute), dow, key: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` };
}

export function matches(cron, parts) {
  return (!cron.min || cron.min.has(parts.min)) && (!cron.hour || cron.hour.has(parts.hour)) && (!cron.dom || cron.dom.has(parts.dom)) && (!cron.mon || cron.mon.has(parts.mon)) && (!cron.dow || cron.dow.has(parts.dow));
}

/** For crons with a single fixed hour:minute, the most recent scheduled instant on the given local day (as a Date), or null. */
export function scheduledToday(cron, now, tz) {
  if (!cron.min || cron.min.size !== 1 || !cron.hour || cron.hour.size !== 1) return null;
  const p = localParts(now, tz);
  if ((cron.dow && !cron.dow.has(p.dow)) || (cron.dom && !cron.dom.has(p.dom)) || (cron.mon && !cron.mon.has(p.mon))) return null;
  const [hh] = [...cron.hour]; const [mm] = [...cron.min];
  const asUtcNow = Date.UTC(p.year, p.mon - 1, p.dom, p.hour, p.min);
  const offsetMs = asUtcNow - Math.floor(now.getTime() / 60000) * 60000;
  return new Date(Date.UTC(p.year, p.mon - 1, p.dom, hh, mm) - offsetMs);
}

export function createScheduler({ db, tz = 'Africa/Lusaka', notifier, tickMs = 30000, baseCtx = {} }) {
  const routines = new Map();
  const running = new Set();
  let timer = null;

  function register(r) {
    if (!r.name || !r.cron || typeof r.run !== 'function') throw new Error(`invalid routine ${r.name}`);
    routines.set(r.name, { ...r, parsed: parseCron(r.cron), catchUpMinutes: r.catchUpMinutes ?? 360, enabled: r.enabled !== false });
    db.prepare('INSERT OR IGNORE INTO routine_runs(name) VALUES (?)').run(r.name);
  }

  function lastRun(name) {
    const row = db.prepare('SELECT last_run_at FROM routine_runs WHERE name = ?').get(name);
    return row?.last_run_at ? new Date(row.last_run_at.replace(' ', 'T') + (row.last_run_at.endsWith('Z') ? '' : 'Z')) : null;
  }

  async function runNow(name, { source = 'cron', now = new Date() } = {}) {
    const r = routines.get(name);
    if (!r) throw new Error(`unknown routine ${name}`);
    if (running.has(name)) return { skipped: 'already running' };
    running.add(name);
    const started = Date.now();
    let status = 'ok'; let summary = ''; let result = null;
    try {
      result = await r.run({ ...baseCtx, now, source, routine: r.name });
      summary = (result && (result.summary || result.speak)) || 'done';
      if (result?.notify?.push && notifier) await notifier.push(result.notify.push);
      if (result?.notify?.email && notifier) await notifier.email(result.notify.email);
    } catch (e) {
      status = 'error'; summary = e.message;
      log.error('routine failed', { name, err: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') });
    } finally {
      running.delete(name);
      const ms = Date.now() - started;
      db.prepare("UPDATE routine_runs SET last_run_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_status = ?, last_summary = ?, last_duration_ms = ?, run_count = run_count + 1 WHERE name = ?")
        .run(status, String(summary).slice(0, 2000), ms, name);
      recordAudit(db, { source, skill: r.skill, intent: `routine:${name}`, outcome: status, detail: summary, latency_ms: ms });
      log.info('routine ran', { name, status, ms, source });
    }
    return { name, status, summary, result, ms: Date.now() - started };
  }

  async function tick(now = new Date()) {
    const parts = localParts(now, tz);
    for (const r of routines.values()) {
      if (!r.enabled || running.has(r.name)) continue;
      const last = lastRun(r.name);
      const lastKey = last ? localParts(last, tz).key : null;
      let due = false;
      if (matches(r.parsed, parts) && lastKey !== parts.key) due = true;
      else {
        const sched = scheduledToday(r.parsed, now, tz);
        if (sched && sched <= now && now - sched <= r.catchUpMinutes * 60000 && (!last || last < sched)) { due = true; log.info('routine catch-up', { name: r.name, scheduled: sched.toISOString() }); }
      }
      if (due) runNow(r.name, { source: 'cron', now }).catch(() => {});
    }
  }

  function start() {
    if (timer) return;
    setTimeout(() => tick().catch((e) => log.error('tick failed', { err: e.message })), 5000);
    timer = setInterval(() => tick().catch((e) => log.error('tick failed', { err: e.message })), tickMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  function list() {
    return [...routines.values()].map((r) => {
      const row = db.prepare('SELECT * FROM routine_runs WHERE name = ?').get(r.name) || {};
      return { name: r.name, skill: r.skill, cron: r.cron, description: r.description, enabled: r.enabled, last_run_at: row.last_run_at, last_status: row.last_status, last_summary: row.last_summary, run_count: row.run_count || 0 };
    });
  }

  return { register, runNow, tick, start, stop, list, routines };
}
