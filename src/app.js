// Application assembly: config → db → brain → notifier → skills → intents → scheduler. Used by the HTTP server and the CLI alike.
import { loadConfig } from './config.js';
import { openDb, migrateCore, kv } from './db.js';
import { log } from './log.js';
import { createBrain, BrainError } from './brain/index.js';
import { createNotifier } from './notify.js';
import * as composio from './composio.js';
import { loadSkills, withTimeout } from './skills/index.js';
import { createIntentRouter } from './intents/router.js';
import { createScheduler } from './scheduler.js';
import { recordAudit } from './audit.js';
import { createPending, getPending, resolvePending, claimPending, listPending } from './confirm.js';
import { assembleBrief } from './brief.js';
import { speakable, spokenList } from './voice.js';
import { createPodcast } from './carplay/podcast.js';

export async function createApp({ skillsFilter } = {}) {
  const { config, secrets, paths, version } = loadConfig({ warn: (m) => log.warn(m) });
  const db = openDb(paths.dbFile);
  migrateCore(db);
  const brain = createBrain({ secrets, config, paths });
  const notifier = createNotifier({ db, secrets, config });
  const composioApi = { execute: composio.execute, schema: composio.schema, connections: composio.connections, search: composio.search, available: composio.composioAvailable(), ComposioError: composio.ComposioError };

  const base = { db, kv: { get: (ns, k, f) => kv.get(db, ns, k, f), set: (ns, k, v) => kv.set(db, ns, k, v), del: (ns, k) => kv.del(db, ns, k), list: (ns) => kv.list(db, ns) }, config, secrets, paths, version, log, brain, notifier, composio: composioApi, tz: config.tz };

  const enabled = (skillsFilter || config.skills?.enabled || []);
  const { skills, failures } = await loadSkills(base, enabled);
  const byId = Object.fromEntries(skills.map((s) => [s.id, s]));
  base.skills = byId;
  const intents = createIntentRouter({ skills, brain });
  const scheduler = createScheduler({ db, tz: config.tz, notifier, baseCtx: base });
  for (const s of skills) for (const r of s.routines || []) {
    const override = config.routines?.[r.name] || {};
    scheduler.register({ ...r, ...override, skill: s.id });
  }
  scheduler.register({ name: 'core.spool_flush', cron: '*/5 * * * *', skill: 'kitt', description: 'retry spooled pushes/emails', catchUpMinutes: 0, run: async () => ({ summary: JSON.stringify(await notifier.flushSpool()) }) });
  // Reachability log: a row every 15 minutes while the hub runs → "hub was up X% of the last 7 days" (the apps' go/no-go metric).
  db.exec('CREATE TABLE IF NOT EXISTS uptime_log (ts TEXT PRIMARY KEY, on_ac INTEGER, battery_pct INTEGER, rss_mb INTEGER)');
  const heartbeat = async () => {
    let onAc = null; let pct = null;
    try { const { execFile } = await import('node:child_process'); const out = await new Promise((res) => execFile('/usr/bin/pmset', ['-g', 'batt'], { timeout: 5000 }, (e, o) => res(o || ''))); onAc = /AC Power/.test(out) ? 1 : 0; const m = /(\d{1,3})%/.exec(out); pct = m ? Number(m[1]) : null; } catch { /* pmset missing */ }
    db.prepare('INSERT OR REPLACE INTO uptime_log(ts, on_ac, battery_pct, rss_mb) VALUES (?, ?, ?, ?)').run(new Date().toISOString().slice(0, 16), onAc, pct, Math.round(process.memoryUsage().rss / 1048576));
    return { summary: `ac=${onAc} batt=${pct}` };
  };
  scheduler.register({ name: 'core.heartbeat', cron: '*/15 * * * *', skill: 'kitt', description: 'reachability log (power, battery, memory)', catchUpMinutes: 0, run: heartbeat });
  function coverage(days = 7) { const n = db.prepare("SELECT count(*) n FROM uptime_log WHERE ts >= strftime('%Y-%m-%dT%H:%M', 'now', ?)").get(`-${days} days`).n; const expected = days * 96; return { days, heartbeats: n, expected, uptime_pct: Math.min(100, Math.round((n / expected) * 1000) / 10), on_ac_pct: n ? Math.round((db.prepare("SELECT count(*) n FROM uptime_log WHERE on_ac = 1 AND ts >= strftime('%Y-%m-%dT%H:%M', 'now', ?)").get(`-${days} days`).n / n) * 100) : null }; }
  const podcast = createPodcast(base);
  base.podcast = podcast;
  const renderBrief = async (kind) => { const b = await brief(kind, { source: 'podcast' }); const rest = db.prepare('SELECT text FROM continuations WHERE source = ?').get('podcast'); const full = b.speak + (rest ? ' ' + rest.text : ''); const ep = await podcast.render({ slug: kind, title: `${kind[0].toUpperCase() + kind.slice(1)} brief ${new Date().toISOString().slice(0, 10)}`, text: full.replace(/ Say 'Kit, more' for the rest\./g, '') }); return { summary: `${ep.file} (${ep.duration}s)` }; };
  scheduler.register({ name: 'core.podcast_morning', cron: '5 7 * * *', skill: 'kitt', description: 'render the morning brief as a podcast episode', catchUpMinutes: 300, run: () => renderBrief('morning') });
  scheduler.register({ name: 'core.podcast_evening', cron: '45 17 * * *', skill: 'kitt', description: 'render the evening recap as a podcast episode', catchUpMinutes: 180, run: () => renderBrief('evening') });

  const voiceOpts = { maxChars: config.voice?.maxChars || 900 };

  function finish(source, text, extra = {}) {
    const { text: spoken, rest } = speakable(text, voiceOpts);
    if (rest) db.prepare("INSERT INTO continuations(source, text, created_at) VALUES (?, ?, datetime('now')) ON CONFLICT(source) DO UPDATE SET text = excluded.text, created_at = excluded.created_at").run(source, rest);
    else db.prepare('DELETE FROM continuations WHERE source = ?').run(source);
    return { speak: spoken, ...extra };
  }

  function helpText() {
    const names = skills.map((s) => s.name);
    if (!names.length) return 'No skills are connected yet. I can still take a morning brief, confirm or cancel actions, and report my status.';
    return `I can help with ${spokenList(names, { max: 12, more: false })}. Try: good morning, what's on my plate, what's my cash position, any new comments, anything renewing this week, run the security check, or log an idea.`;
  }

  async function statusText() {
    const h = await health();
    const bad = Object.entries(h.skills).filter(([, v]) => v && v.ok === false).map(([k]) => k);
    return `Kit online, version ${version}. ${skills.length} skills loaded${failures.length ? `, ${failures.length} unavailable` : ''}. Brain ${h.brain.ok ? 'ready' : 'unavailable'}.${bad.length ? ` Attention: ${spokenList(bad)}.` : ''}`;
  }

  async function composeBrief(kind, { source = 'cli' } = {}) {
    const cfg = config.briefs?.[kind] || { order: skills.map((s) => s.id) };
    const order = (cfg.order || []).filter((id) => byId[id]).concat(skills.map((s) => s.id).filter((id) => !(cfg.order || []).includes(id)));
    const parts = await Promise.all(order.map(async (id) => {
      const s = byId[id];
      if (typeof s.brief !== 'function') return null;
      const budget = source === 'siri' ? Math.min(cfg.per_skill_timeout_ms || 25000, config.briefs?.siri_per_skill_timeout_ms || 8000) : (cfg.per_skill_timeout_ms || 25000);
      const r = await withTimeout(Promise.resolve().then(() => s.brief({ ...base, kind, source })), budget, `${id}.brief`);
      if (!r.ok) { log.warn('brief part failed', { id, err: r.error }); return null; }
      const v = r.value;
      if (!v) return null;
      return typeof v === 'string' ? { speak: v, decisions: 0 } : { speak: v.speak, decisions: v.decisions || 0 };
    }));
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    const greet = kind === 'morning' ? (hour < 12 ? 'Good morning, Travis.' : 'Hello, Travis.') : 'Evening recap.';
    return assembleBrief({ kind, greet, parts, hubDecisions: listPending(db).length });
  }

  async function brief(name, { source = 'cli' } = {}) {
    const started = Date.now();
    let text;
    if (name === 'morning' || name === 'evening') text = await composeBrief(name, { source });
    else {
      const s = byId[name] || skills.find((x) => x.aliases?.includes(name));
      if (!s) text = `I don't have a brief called ${name}.`;
      else if (typeof s.brief !== 'function') text = `${s.name} has no brief.`;
      else { const r = await s.brief({ ...base, kind: 'full', source }); text = typeof r === 'string' ? r : r?.speak || `${s.name}: nothing to report.`; }
    }
    recordAudit(db, { source, skill: 'kitt', intent: `brief:${name}`, outcome: 'ok', latency_ms: Date.now() - started });
    kv.set(db, 'briefs', name, { at: new Date().toISOString(), text });
    return finish(source, text);
  }

  async function ask(text, { source = 'cli' } = {}) {
    const started = Date.now();
    const r = await intents.route(text, { fast: source === 'siri' });
    const ctx = { ...base, source, text, norm: r.norm, now: new Date() };
    let out;
    try {
      if (r.skill === 'kitt') out = await handleGlobal(r.intent, ctx);
      else if (r.skill === 'none' || !byId[r.skill]) {
        out = { speak: r.kind === 'rate_limit' ? "My language brain is rate limited right now. Try a direct command like 'what's on my plate'." : r.via === 'llm-error' ? "I couldn't reach my language brain. Try a direct command." : "I didn't catch a command I know. Say 'Kit, help' for options." };
      } else {
        const skill = byId[r.skill];
        const res = await skill.handle(r.intent, r.slots || {}, ctx);
        out = typeof res === 'string' ? { speak: res } : (res || { speak: 'Done.' });
        if (out.confirm) {
          const p = createPending(db, { source, skill: skill.id, summary: out.confirm.summary, action: out.confirm.action });
          out = { ...out, speak: `${out.speak || out.confirm.summary} Say 'Kit, confirm' within ${p.expires_in_min} minutes to proceed, or 'Kit, cancel'.`, needs_confirm: true, code: p.code };
          delete out.confirm;
        }
      }
      recordAudit(db, { source, skill: r.skill, intent: r.intent, input: text, outcome: out.needs_confirm ? 'needs_confirm' : 'ok', detail: `${r.via}${r.confidence ? ` ${r.confidence}` : ''}`, latency_ms: Date.now() - started, intent_hit: r.via === 'global' || r.via === 'pattern' ? 1 : 0 });
      return finish(source, out.speak, { display: out.display, needs_confirm: out.needs_confirm || false, intent: `${r.skill}.${r.intent}`, via: r.via });
    } catch (e) {
      log.error('ask failed', { intent: `${r.skill}.${r.intent}`, err: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') });
      recordAudit(db, { source, skill: r.skill, intent: r.intent, input: text, outcome: 'error', detail: e.message, latency_ms: Date.now() - started, intent_hit: r.via === 'global' || r.via === 'pattern' ? 1 : 0 });
      const friendly = e instanceof BrainError ? (e.kind === 'rate_limit' ? 'My language brain is rate limited. Try again in a few minutes.' : 'My language brain is unavailable.') : e.needsLink ? `That needs a connection I don't have yet: ${e.slug || 'a Composio link'}. I've noted it.` : `That failed: ${e.message.slice(0, 120)}`;
      return finish(source, friendly, { error: true, intent: `${r.skill}.${r.intent}` });
    }
  }

  async function handleGlobal(intent, ctx) {
    switch (intent) {
      case 'confirm': return confirm(ctx.source);
      case 'cancel': return cancel(ctx.source);
      case 'more': return more(ctx.source);
      case 'repeat': { const row = db.prepare('SELECT detail FROM audit WHERE source = ? AND outcome IN (\'ok\',\'needs_confirm\') ORDER BY id DESC LIMIT 1').get(ctx.source); return { speak: row ? 'Repeating is not stored yet; ask the question again.' : 'Nothing to repeat.' }; }
      case 'help': return { speak: helpText() };
      case 'status': return { speak: await statusText() };
      case 'morning': return { speak: await composeBrief('morning', { source: ctx.source }) };
      case 'evening': return { speak: await composeBrief('evening', { source: ctx.source }) };
      case 'empty': return { speak: "I didn't hear anything. Try again." };
      default: return { speak: "I didn't catch that." };
    }
  }

  // `code` is optional: voice has none, but a screen that shows a decision sends the code it showed. If the hub's pending action is a
  // different one by now, nothing runs and the caller gets `stale` (HTTP 409) so it can show the new request instead.
  async function confirm(source, code) {
    const p = getPending(db);
    if (!p) return { speak: 'There is nothing waiting for confirmation.' };
    if (code && String(code) !== p.code) return { speak: 'That request changed. Review the new one before confirming.', stale: true };
    if (!claimPending(db, p.code)) return { speak: 'That is already being handled.' };
    const skill = byId[p.skill];
    if (!skill || typeof skill.execute !== 'function') { resolvePending(db, p.code, 'failed'); return { speak: `I can't execute that; ${p.skill} is unavailable.` }; }
    try {
      const res = await skill.execute(p.action, { ...base, source, now: new Date() });
      resolvePending(db, p.code, 'done');
      recordAudit(db, { source, skill: p.skill, intent: `execute:${p.action?.type || 'action'}`, input: p.summary, outcome: 'ok', detail: `asked via ${p.source}, confirmed via ${source}` });
      return typeof res === 'string' ? { speak: res } : (res || { speak: 'Done.' });
    } catch (e) {
      resolvePending(db, p.code, 'failed');
      recordAudit(db, { source, skill: p.skill, intent: `execute:${p.action?.type || 'action'}`, input: p.summary, outcome: 'error', detail: e.message });
      return { speak: `That failed: ${e.message.slice(0, 140)}` };
    }
  }

  function cancel(source, code) {
    const p = getPending(db);
    if (!p) return { speak: 'Nothing to cancel.' };
    if (code && String(code) !== p.code) return { speak: 'That request changed. Review the new one before cancelling.', stale: true };
    if (!claimPending(db, p.code, 'cancelled')) return { speak: 'That is already being handled.' };
    recordAudit(db, { source, skill: p.skill, intent: 'cancel', input: p.summary, outcome: 'ok', detail: `asked via ${p.source}, cancelled via ${source}` });
    return { speak: `Cancelled: ${p.summary}` };
  }

  function more(source) {
    const row = db.prepare('SELECT text FROM continuations WHERE source = ?').get(source);
    if (!row) return { speak: "That's everything." };
    return { speak: row.text, _continuation: true };
  }

  async function health() {
    const skillHealth = {};
    for (const s of skills) {
      if (typeof s.health !== 'function') { skillHealth[s.id] = { ok: true, detail: 'no health check' }; continue; }
      const r = await withTimeout(Promise.resolve().then(() => s.health(base)), 15000, `${s.id}.health`);
      skillHealth[s.id] = r.ok ? r.value : { ok: false, detail: r.error };
    }
    for (const f of failures) skillHealth[f.id] = { ok: false, detail: f.error, unavailable: true };
    return { ok: true, version, brain: await brain.health(), notifier: notifier.configured, composio: composioApi.available, skills: skillHealth, routines: scheduler.list(), pending: listPending(db) };
  }

  /** Compact JSON for the apps and watch complications. */
  async function state() {
    const h = await health();
    const briefs = {}; for (const row of kv.list(db, 'briefs')) briefs[row.key] = row.value;
    return { version, now: new Date().toISOString(), tz: config.tz, brain: h.brain, notifier: h.notifier, pending: h.pending, coverage: coverage(7), routines: h.routines.map((r) => ({ name: r.name, skill: r.skill, last_run_at: r.last_run_at, last_status: r.last_status })), skills: Object.fromEntries(skills.map((s) => [s.id, { name: s.name, description: s.description, ...(h.skills[s.id] || {}) }])), unavailable: failures, briefs };
  }

  /** Changes since an audit id (for app polling): audit rows, pending actions, continuation flags. */
  function events(since = 0, limit = 100) {
    const rows = db.prepare('SELECT id, ts, source, skill, intent, input, outcome, detail, latency_ms FROM audit WHERE id > ? ORDER BY id LIMIT ?').all(Number(since) || 0, Math.min(500, limit));
    return { since: Number(since) || 0, next: rows.length ? rows[rows.length - 1].id : Number(since) || 0, audit: rows, pending: listPending(db), continuations: db.prepare('SELECT source, created_at FROM continuations').all() };
  }

  return { ...base, skills: byId, skillList: skills, failures, intents, scheduler, ask, brief, confirm, cancel, more, health, helpText, statusText, finish, state, events, podcast, coverage, heartbeat };
}
