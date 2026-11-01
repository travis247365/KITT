// Skill 5 — AI Chief of Staff: reads an operations board (a Next.js app) through its own
// JSON API with a password session, caches items and service-ops records, and answers "what's on my plate".
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS chief_items (
     id TEXT PRIMARY KEY, ref TEXT, title TEXT, workstream TEXT, client TEXT, status TEXT, priority TEXT, due_date TEXT, target TEXT, r TEXT, a TEXT,
     importance TEXT, urgency TEXT, plan_bucket TEXT, labels TEXT, position REAL, raw TEXT, synced_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS chief_ops (collection TEXT NOT NULL, id TEXT NOT NULL, title TEXT, severity TEXT, status TEXT, process TEXT, created_at TEXT, raw TEXT, synced_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (collection, id));`,
];

const OPEN_INCIDENT = (s) => !['resolved', 'closed'].includes(String(s || '').toLowerCase());

export default function define(ctx) {
  const { db, secrets, config, log } = ctx;
  const base = (secrets.KITT_COO_BASE_URL || config.chief?.base_url || 'https://board.example').replace(/\/$/, '');
  const password = secrets.KITT_COO_PASSWORD || '';
  const email = (secrets.KITT_COO_EMAIL || '').trim(); // optional: sign in as a dedicated board account instead of the shared team password
  let cookie = ctx.kv.get('chief', 'cookie', null);
  let syncing = null;

  async function login() {
    if (!password) throw new Error('KITT_COO_PASSWORD not set (the board team password, or the password of the KITT_COO_EMAIL account)');
    const r = await fetch(`${base}${email ? '/api/auth/login' : '/api/login'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(email ? { email, password } : { password }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`board login failed: HTTP ${r.status}${r.status === 403 && email ? ' (account not confirmed yet)' : ''}`);
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
    const c = sc.map((s) => s.split(';')[0]).find((s) => s.startsWith(`${config.chief?.cookie_name || 'session'}=`));
    if (!c) throw new Error('board login returned no session cookie');
    const j = await r.json().catch(() => ({}));
    cookie = { value: c, role: j.role || 'member', at: new Date().toISOString() };
    ctx.kv.set('chief', 'cookie', cookie);
    return cookie;
  }

  async function api(path, { method = 'GET', body, retry = true } = {}) {
    if (!cookie) await login();
    const r = await fetch(`${base}${path}`, { method, headers: { cookie: cookie.value, 'content-type': 'application/json', 'user-agent': 'kitt/0.1' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    if (r.status === 401 && retry) { cookie = null; await login(); return api(path, { method, body, retry: false }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`board ${method} ${path}: HTTP ${r.status} ${j.error || ''}`);
    return j;
  }

  async function sync() {
    const started = Date.now();
    const items = await api('/api/items');
    const ins = db.prepare(`INSERT INTO chief_items(id, ref, title, workstream, client, status, priority, due_date, target, r, a, importance, urgency, plan_bucket, labels, position, raw, synced_at)
      VALUES (@id, @ref, @title, @workstream, @client, @status, @priority, @due_date, @target, @r, @a, @importance, @urgency, @plan_bucket, @labels, @position, @raw, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET ref = excluded.ref, title = excluded.title, workstream = excluded.workstream, client = excluded.client, status = excluded.status, priority = excluded.priority, due_date = excluded.due_date, target = excluded.target, r = excluded.r, a = excluded.a, importance = excluded.importance, urgency = excluded.urgency, plan_bucket = excluded.plan_bucket, labels = excluded.labels, position = excluded.position, raw = excluded.raw, synced_at = excluded.synced_at`);
    const ids = new Set();
    for (const it of items.items || []) {
      ids.add(String(it.id));
      ins.run({ id: String(it.id), ref: it.ref || '', title: it.title || '', workstream: it.workstream || '', client: it.client || '', status: it.status || '', priority: it.priority || '', due_date: it.due_date || '', target: it.target || '', r: it.r || '', a: it.a || '', importance: it.importance || '', urgency: it.urgency || '', plan_bucket: it.plan_bucket || '', labels: JSON.stringify(it.labels || []), position: typeof it.position === 'number' ? it.position : null, raw: JSON.stringify(it).slice(0, 20000) });
    }
    for (const row of db.prepare('SELECT id FROM chief_items').all()) if (!ids.has(row.id)) db.prepare('DELETE FROM chief_items WHERE id = ?').run(row.id);
    const ops = {};
    for (const col of ['incidents', 'downtime', 'approvals']) {
      try {
        const r = await api(`/api/ops/${col}`);
        const rows = r.items || [];
        db.prepare('DELETE FROM chief_ops WHERE collection = ?').run(col);
        const insO = db.prepare('INSERT OR REPLACE INTO chief_ops(collection, id, title, severity, status, process, created_at, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        for (const o of rows) insO.run(col, String(o.id), o.title || '', o.severity || '', o.status || '', o.process || '', o.created_at || '', JSON.stringify(o).slice(0, 5000));
        ops[col] = rows.length;
      } catch (e) { ops[col] = `error: ${e.message}`; }
    }
    ctx.kv.set('chief', 'last_sync', { at: new Date().toISOString(), items: ids.size, ops, ms: Date.now() - started, role: cookie?.role });
    log.info('board sync', { items: ids.size, ops, ms: Date.now() - started });
    return { items: ids.size, ops };
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const q = (where, params = []) => db.prepare(`SELECT * FROM chief_items WHERE ${where} ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, due_date`).all(...params);
  const overdue = () => q("status <> 'Done' AND due_date <> '' AND due_date < ?", [today()]);
  const dueSoon = (days = 7) => q("status <> 'Done' AND due_date <> '' AND due_date >= ? AND due_date <= ?", [today(), new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)]);
  const blocked = () => q("status = 'Blocked'");
  const highOpen = () => q("status <> 'Done' AND priority = 'High'");
  const incidents = () => db.prepare("SELECT * FROM chief_ops WHERE collection = 'incidents'").all().filter((i) => OPEN_INCIDENT(i.status));
  const downtime = () => db.prepare("SELECT * FROM chief_ops WHERE collection = 'downtime' AND status = 'ongoing'").all();
  const approvals = () => db.prepare("SELECT * FROM chief_ops WHERE collection = 'approvals' AND status = 'pending'").all();
  const short = (it) => `${it.title}${it.client ? ` for ${it.client}` : ''}`;
  const dstr = (iso) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

  function findItem(text) {
    const s = String(text || '').toLowerCase().trim(); if (!s) return null;
    const rows = db.prepare('SELECT * FROM chief_items').all();
    return rows.find((r) => r.ref.toLowerCase() === s) || rows.find((r) => r.title.toLowerCase().includes(s)) || rows.find((r) => s.split(/\s+/).filter((w) => w.length > 3).every((w) => r.title.toLowerCase().includes(w))) || null;
  }

  function plate() {
    const od = overdue(), ds = dueSoon(7), bl = blocked(), hi = highOpen(), inc = incidents(), dt = downtime(), ap = approvals();
    const parts = [];
    if (inc.length || dt.length) parts.push(`Service ops: ${inc.length ? `${plural(inc.length, 'open incident')}${inc.some((i) => i.severity === 'sev1') ? ' including a sev one' : ''}` : ''}${inc.length && dt.length ? ' and ' : ''}${dt.length ? `${plural(dt.length, 'ongoing outage')}` : ''}.`);
    if (od.length) parts.push(`${plural(od.length, 'overdue item')}: ${spokenList(od.map(short), { max: 3 })}.`);
    if (bl.length) parts.push(`${plural(bl.length, 'blocked item')}: ${spokenList(bl.map(short), { max: 2 })}.`);
    if (ds.length) parts.push(`Due this week: ${spokenList(ds.map((it) => `${short(it)} by ${dstr(it.due_date)}`), { max: 3 })}.`);
    if (ap.length) parts.push(`${plural(ap.length, 'approval')} waiting.`);
    if (!parts.length) parts.push(`${plural(hi.length, 'high-priority item')} open, nothing overdue or blocked.`);
    return { speak: parts.join(' '), display: { overdue: od, due_soon: ds, blocked: bl, high_open: hi, incidents: inc, downtime: dt, approvals: ap } };
  }

  return {
    id: 'chief', name: 'Chief of Staff', aliases: ['board', 'plate'],
    description: "what's on your plate from the Operations board: overdue, blocked, due this week, incidents, approvals",
    migrations: MIGRATIONS,
    intents: [
      { name: 'plate', description: 'summary of what needs attention on the board', examples: ["what's on my plate"], patterns: ["(what's|what is|whats) on my plate( today)?", 'my plate', "(what's|what is) (on the|the) (board|agenda)( today)?", 'what (do i|should i) (need to|have to) (do|focus on)( today)?', 'priorities( today)?', 'what needs (my )?attention'] },
      { name: 'overdue', description: 'overdue action items', examples: ["what's overdue"], patterns: ["(what's|what is|whats) overdue", 'overdue (items|actions|tasks)', 'anything overdue', 'what am i late on'] },
      { name: 'blocked', description: 'blocked action items', examples: ["what's blocked"], patterns: ["(what's|what is|whats) blocked", 'blocked (items|actions)', 'anything blocked'] },
      { name: 'incidents', description: 'open incidents and outages', examples: ['any open incidents'], patterns: ['(any |are there any )?open incidents', 'incidents( status)?', 'any outages', "(what's|what is) down", 'service (ops|operations) status'] },
      { name: 'approvals', description: 'pending approvals', examples: ['pending approvals'], patterns: ['(any |my )?pending approvals', 'what needs (my )?approval', 'approvals waiting'] },
      { name: 'status', description: 'status of one item', examples: ['status of the vendor addendum'], patterns: ['status of (the )?{item}', "(what's|what is) the status of (the )?{item}", 'where are we on (the )?{item}', 'update on (the )?{item}'], slots: ['item'] },
      { name: 'add', description: 'add an action item to the board', examples: ['add action item: call the bank about the loan'], patterns: ['add (an )?(action )?(item|task)(:| called| titled)? {title}', 'new (action )?(item|task)(:| called)? {title}', 'put {title} on the board'], slots: ['title'], write: true },
      { name: 'done', description: 'mark an item done', examples: ['mark the roster import done'], patterns: ['mark (the )?{item} (as )?(done|complete|completed|finished)', '{item} is done', 'close (the )?{item}'], slots: ['item'], write: true },
      { name: 'sync', description: 'refresh from the board now', examples: ['refresh the board'], patterns: ['(refresh|sync|update|reload) (the )?board', 'pull (the )?board'] },
    ],
    routines: [
      { name: 'chief.sync', cron: '*/30 6-20 * * *', description: 'refresh the board cache every 30 minutes in working hours', catchUpMinutes: 0, run: async () => { if (!password) return { summary: 'skipped: KITT_COO_PASSWORD not set' }; const r = await sync(); return { summary: `${r.items} items; ops ${JSON.stringify(r.ops)}` }; } },
      { name: 'chief.evening_push', cron: '30 17 * * 1-5', description: 'evening push with counts only (no client names)', catchUpMinutes: 120, run: async () => { if (!password) return { summary: 'skipped: KITT_COO_PASSWORD not set' }; await sync().catch(() => {}); const p = plate(); const d = p.display; return { summary: p.speak, notify: { push: { title: 'KITT evening board check', body: `${d.overdue.length} overdue · ${d.blocked.length} blocked · ${d.due_soon.length} due this week · ${d.incidents.length} open incidents · ${d.approvals.length} approvals`, tags: 'clipboard' } } }; } },
    ],
    async handle(intent, slots, c) {
      const fresh = ctx.kv.get('chief', 'last_sync');
      if (intent === 'sync' || !fresh) {
        if (!password) return { speak: 'I cannot reach the Operations board yet: the board password is not in my configuration.' };
        if (c.source === 'cli' || !fresh) { try { await sync(); } catch (e) { return { speak: `Board sync failed: ${e.message.slice(0, 120)}` }; } if (intent === 'sync') return { speak: `Board refreshed: ${db.prepare('SELECT count(*) n FROM chief_items').get().n} items.` }; }
        else { if (!syncing) syncing = sync().catch((e) => log.warn('board sync failed', { err: e.message })).finally(() => { syncing = null; }); return { speak: 'Refreshing the board in the background.' }; }
      }
      if (intent === 'plate') return plate();
      if (intent === 'overdue') { const od = overdue(); return { speak: od.length ? `${plural(od.length, 'overdue item')}: ${spokenList(od.map((it) => `${short(it)}, due ${dstr(it.due_date)}`), { max: 6 })}.` : 'Nothing overdue.', display: od }; }
      if (intent === 'blocked') { const bl = blocked(); return { speak: bl.length ? `${plural(bl.length, 'blocked item')}: ${spokenList(bl.map(short), { max: 6 })}.` : 'Nothing blocked.', display: bl }; }
      if (intent === 'incidents') { const inc = incidents(), dt = downtime(); return { speak: inc.length || dt.length ? `${plural(inc.length, 'open incident')}${inc.length ? `: ${spokenList(inc.map((i) => `${i.severity ? i.severity.toUpperCase() + ' ' : ''}${i.title}`), { max: 4 })}` : ''}. ${dt.length ? `${plural(dt.length, 'ongoing outage')}: ${spokenList(dt.map((d) => d.title), { max: 3 })}.` : 'No ongoing outages.'}` : 'No open incidents and no ongoing outages.', display: { inc, dt } }; }
      if (intent === 'approvals') { const ap = approvals(); return { speak: ap.length ? `${plural(ap.length, 'pending approval')}: ${spokenList(ap.map((a) => a.title), { max: 5 })}.` : 'No approvals waiting.', display: ap }; }
      if (intent === 'status') { const it = findItem(slots.item); if (!it) return { speak: `I can't find an item matching ${slots.item}.` }; return { speak: `${it.title}: ${it.status}${it.priority ? `, ${it.priority.toLowerCase()} priority` : ''}${it.due_date ? `, due ${dstr(it.due_date)}` : it.target ? `, target ${it.target}` : ''}${it.r ? `, responsible ${it.r}` : ''}${it.client ? `, client ${it.client}` : ''}.`, display: it }; }
      if (intent === 'add') { const title = String(slots.title || '').trim(); if (!title) return { speak: 'What should the item say?' }; return { speak: `Add "${title}" to the board as not started, medium priority?`, confirm: { summary: `add board item: ${title}`, action: { type: 'add', title } } }; }
      if (intent === 'done') { const it = findItem(slots.item); if (!it) return { speak: `I can't find ${slots.item} on the board.` }; return { speak: `Mark "${it.title}" as done?`, confirm: { summary: `mark done: ${it.title}`, action: { type: 'done', id: it.id, title: it.title } } }; }
      return { speak: "I didn't catch which board question that was." };
    },
    async execute(action) {
      if (action.type === 'add') { const r = await api('/api/items', { method: 'POST', body: { title: action.title, status: 'Not started', priority: 'Medium', workstream: 'KITT', notes: 'Added by voice via KITT' } }); await sync().catch(() => {}); return { speak: `Added "${action.title}" to the board${r?.item?.ref ? ` as ${r.item.ref}` : ''}.` }; }
      if (action.type === 'done') { await api(`/api/items/${encodeURIComponent(action.id)}`, { method: 'PUT', body: { status: 'Done' } }); await sync().catch(() => {}); return { speak: `Marked "${action.title}" done.` }; }
      return { speak: 'Unknown action.' };
    },
    async brief({ kind }) {
      if (!ctx.kv.get('chief', 'last_sync')) { if (!password) return kind === 'morning' ? { speak: 'The Operations board is not connected yet.' } : null; try { await sync(); } catch { return { speak: 'The Operations board is unreachable.' }; } }
      const p = plate(); const d = p.display;
      if (kind === 'evening') return { speak: `Board: ${d.overdue.length} overdue, ${d.blocked.length} blocked, ${d.incidents.length} open incidents, ${d.approvals.length} approvals waiting.` };
      return { speak: `Board: ${p.speak}` };
    },
    async view() { const ls = ctx.kv.get('chief', 'last_sync'); if (!ls) return { connected: Boolean(password), synced: false }; const p = plate(); return { connected: true, synced: true, last_sync: ls, speak: p.speak, ...p.display, counts: { total: db.prepare('SELECT count(*) n FROM chief_items').get().n, by_status: db.prepare('SELECT status, count(*) n FROM chief_items GROUP BY status').all() } }; },
    async health() { const ls = ctx.kv.get('chief', 'last_sync'); return { ok: Boolean(password) && (!ls || !Object.values(ls.ops || {}).some((v) => typeof v === 'string')), detail: !password ? 'KITT_COO_PASSWORD not set' : ls ? `last sync ${ls.at} as ${ls.role}; ${ls.items} items; ops ${JSON.stringify(ls.ops)}` : 'never synced' }; },
    async dashboard() { const p = plate(); const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); const row = (it) => `<tr><td>${esc(it.ref)}</td><td>${esc(it.title)}</td><td>${esc(it.client)}</td><td>${esc(it.status)}</td><td>${esc(it.priority)}</td><td>${esc(it.due_date)}</td><td>${esc(it.r)}</td></tr>`; const tbl = (title, rows) => rows.length ? `<h3>${title} (${rows.length})</h3><table><tr><th>Ref</th><th>Title</th><th>Client</th><th>Status</th><th>Priority</th><th>Due</th><th>R</th></tr>${rows.map(row).join('')}</table>` : ''; return `<p>${esc(p.speak)}</p>${tbl('Overdue', p.display.overdue)}${tbl('Blocked', p.display.blocked)}${tbl('Due in 7 days', p.display.due_soon)}`; },
    _internal: { sync, plate, findItem, overdue, dueSoon, blocked },
  };
}
