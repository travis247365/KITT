// Skill 8 — Link-in-Bio Manager on Linktree, through Linktree's OFFICIAL MCP server (https://mcp.linktr.ee/mcp, OAuth 2.1 with
// dynamic client registration — verified 2026-10-26). No scraping, no browser automation. Writes go through "Kit, confirm".
import { createMcpOAuthClient } from '../../services/mcp-oauth.js';
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS linktree_links (id TEXT PRIMARY KEY, position INTEGER, title TEXT, url TEXT, active INTEGER, type TEXT, clicks INTEGER, raw TEXT, synced_at TEXT NOT NULL DEFAULT (datetime('now')));
   CREATE TABLE IF NOT EXISTS linktree_stats (day TEXT PRIMARY KEY, views INTEGER, clicks INTEGER, ctr REAL, raw TEXT, fetched_at TEXT NOT NULL DEFAULT (datetime('now')));`,
];

export default function define(ctx) {
  const { db, config, log } = ctx;
  const username = config.linktree?.username || 'tpconsulting.co';
  const mcp = createMcpOAuthClient({ name: 'Linktree', resourceUrl: 'https://mcp.linktr.ee/mcp', kv: ctx.kv, ns: 'linktree', redirectPort: config.linktree?.oauth_port || 2001 });

  const target = () => ({ username });

  async function syncLinks() {
    const r = await mcp.callTool('get_links', target());
    const list = extractList(r.data, ['links', 'items', 'data']);
    db.prepare('DELETE FROM linktree_links').run();
    const ins = db.prepare('INSERT INTO linktree_links(id, position, title, url, active, type, clicks, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    list.forEach((l, i) => ins.run(String(l.id ?? i), Number(l.position ?? i), l.title || '', l.url || '', l.active === false ? 0 : 1, l.type || '', l.clicks ?? null, JSON.stringify(l).slice(0, 4000)));
    ctx.kv.set('linktree', 'last_sync', { at: new Date().toISOString(), count: list.length });
    return list;
  }

  async function syncAnalytics() {
    try { const r = await mcp.callTool('get_account_analytics', { ...target(), period: 'last7days' }); const d = r.data || {}; const day = new Date().toISOString().slice(0, 10); db.prepare('INSERT OR REPLACE INTO linktree_stats(day, views, clicks, ctr, raw) VALUES (?, ?, ?, ?, ?)').run(day, num(d.views ?? d.totalViews), num(d.clicks ?? d.totalClicks), Number(d.ctr ?? d.clickThroughRate) || null, JSON.stringify(d).slice(0, 4000)); return d; }
    catch (e) { log.warn('linktree analytics failed', { err: e.message }); return null; }
  }

  const links = () => db.prepare('SELECT * FROM linktree_links ORDER BY position').all();
  const findLink = (q) => { const s = String(q || '').toLowerCase().trim(); return links().find((l) => l.title.toLowerCase() === s) || links().find((l) => l.title.toLowerCase().includes(s)) || links().find((l) => s.split(/\s+/).filter((w) => w.length > 3).every((w) => l.title.toLowerCase().includes(w))) || null; };

  return {
    id: 'linktree', name: 'Link in Bio', aliases: ['links'],
    description: 'reads and reorders your Linktree links and reports clicks, via Linktree\'s official MCP server',
    migrations: MIGRATIONS,
    intents: [
      { name: 'list', description: 'read out the current links', examples: ['what links are on my Linktree'], patterns: ['(what|which) links are on (my )?(linktree|link in bio|bio)', 'read (me )?(my )?(linktree|link in bio) links', 'list (my )?(linktree|bio) links', 'my linktree'] },
      { name: 'stats', description: 'profile views and clicks', examples: ['how is my Linktree doing'], patterns: ['how is (my )?linktree (doing|performing)', 'linktree (stats|analytics|clicks|views)', 'how many clicks on (my )?(linktree|links)', 'top links'] },
      { name: 'top', description: 'move a link to the top', examples: ['put the Upwork link on top'], patterns: ['(put|move) (the )?{link} (link )?(on top|to the top|first)', 'make {link} the first link'], slots: ['link'], write: true },
      { name: 'hide', description: 'hide (deactivate) a link', examples: ['hide the Fiverr link'], patterns: ['(hide|disable|turn off|deactivate) (the )?{link}( link)?'], slots: ['link'], write: true },
      { name: 'show', description: 'show (activate) a link', examples: ['show the webinar link'], patterns: ['(show|enable|turn on|activate|unhide) (the )?{link}( link)?'], slots: ['link'], write: true },
      { name: 'add', description: 'add a link', examples: ['add a link titled Partner deck to partner.example.com'], patterns: ['add (a )?link (titled|called|named) {title} (to|pointing to|for) {url}', 'add {url} as {title}'], slots: ['title', 'url'], write: true },
      { name: 'sync', description: 'refresh from Linktree now', examples: ['refresh my linktree'], patterns: ['(refresh|sync|update) (my )?(linktree|links)'] },
    ],
    routines: [
      { name: 'linktree.daily', cron: '50 6 * * *', description: 'refresh links and 7-day analytics', run: async () => { const l = await syncLinks(); const a = await syncAnalytics(); return { summary: `${l.length} links; analytics ${a ? 'ok' : 'unavailable'}` }; } },
    ],
    async handle(intent, slots) {
      const st = mcp.status();
      if (!st.connected) return { speak: "Linktree isn't connected yet. On the Mac run: kitt linktree login, and sign in once in the browser." };
      try {
        if (intent === 'sync') { const l = await syncLinks(); await syncAnalytics(); return { speak: `Linktree refreshed: ${plural(l.length, 'link')}.` }; }
        if (!links().length) await syncLinks();
        if (intent === 'list') { const ls = links(); return { speak: `${plural(ls.length, 'link')} on ${username}: ${spokenList(ls.map((l) => `${l.title}${l.active ? '' : ' (hidden)'}`), { max: 8 })}.`, display: ls }; }
        if (intent === 'stats') { const a = await syncAnalytics(); const top = await mcp.callTool('get_top_links', target()).catch(() => null); const tl = top ? extractList(top.data, ['links', 'items', 'data']).slice(0, 3) : []; return { speak: `${a ? `Last seven days: ${num(a.views ?? a.totalViews) ?? 'unknown'} views, ${num(a.clicks ?? a.totalClicks) ?? 'unknown'} clicks.` : 'Analytics unavailable.'}${tl.length ? ` Top links: ${spokenList(tl.map((l) => `${l.title || l.url} ${num(l.clicks ?? l.totalClicks) ?? 0}`))}.` : ''}`, display: { analytics: a, top: tl } }; }
        if (intent === 'top' || intent === 'hide' || intent === 'show') { const l = findLink(slots.link); if (!l) return { speak: `I can't find a link matching ${slots.link}.` }; const verb = intent === 'top' ? 'move to the top' : intent === 'hide' ? 'hide' : 'show'; return { speak: `${verb[0].toUpperCase() + verb.slice(1)} "${l.title}"?`, confirm: { summary: `linktree: ${verb} ${l.title}`, action: { type: intent, id: l.id, title: l.title } } }; }
        if (intent === 'add') { const url = String(slots.url || '').trim(); const title = String(slots.title || '').trim(); if (!/^https?:\/\//i.test(url) && !/\.[a-z]{2,}/i.test(url)) return { speak: 'I need a web address for the link.' }; return { speak: `Add "${title}" pointing to ${url}?`, confirm: { summary: `linktree: add ${title}`, action: { type: 'add', title, url: /^https?:/i.test(url) ? url : `https://${url}` } } }; }
      } catch (e) { if (e.needsLogin) return { speak: 'Linktree needs a fresh login on the Mac: kitt linktree login.' }; throw e; }
      return { speak: "I didn't catch which Linktree action that was." };
    },
    async execute(action) {
      if (action.type === 'top') { await mcp.callTool('reorder_link', { ...target(), id: action.id, to: 0 }); await syncLinks(); return { speak: `"${action.title}" is now first.` }; }
      if (action.type === 'hide' || action.type === 'show') { await mcp.callTool('update_link', { ...target(), id: action.id, active: action.type === 'show' }); await syncLinks(); return { speak: `"${action.title}" is now ${action.type === 'show' ? 'visible' : 'hidden'}.` }; }
      if (action.type === 'add') { await mcp.callTool('add_link', { ...target(), title: action.title, url: action.url, active: true }); await syncLinks(); return { speak: `Added "${action.title}".` }; }
      return { speak: 'Unknown action.' };
    },
    async brief() { return null; }, // nothing to say daily unless asked
    async view() { return { status: mcp.status(), username, links: links(), stats: db.prepare('SELECT * FROM linktree_stats ORDER BY day DESC LIMIT 14').all(), last_sync: ctx.kv.get('linktree', 'last_sync') }; },
    async health() { const st = mcp.status(); const ls = ctx.kv.get('linktree', 'last_sync'); return { ok: st.connected, detail: st.connected ? `connected (refresh ${st.has_refresh ? 'yes' : 'no'}); ${ls ? `${ls.count} links at ${ls.at}` : 'not synced yet'}` : 'not connected: run kitt linktree login' }; },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); const ls = links(); const stat = db.prepare('SELECT * FROM linktree_stats ORDER BY day DESC LIMIT 1').get(); return `<p>${mcp.status().connected ? 'Connected' : 'Not connected'}${stat ? ` · last 7 days: ${stat.views ?? '?'} views, ${stat.clicks ?? '?'} clicks` : ''}</p><table><tr><th>#</th><th>Title</th><th>URL</th><th>Active</th><th>Clicks</th></tr>${ls.map((l) => `<tr><td>${l.position + 1}</td><td>${esc(l.title)}</td><td>${esc(l.url)}</td><td>${l.active ? 'yes' : 'no'}</td><td>${l.clicks ?? ''}</td></tr>`).join('')}</table>`; },
    routes: [{ method: 'POST', path: '/login', scope: 'admin', handler: async () => { const { authUrl } = await mcp.login({ open: false }); return { authUrl, note: 'open this URL in a browser on the Mac within 10 minutes' }; } }],
    _mcp: mcp,
  };
}

function extractList(data, keys) { if (Array.isArray(data)) return data; for (const k of keys) if (Array.isArray(data?.[k])) return data[k]; if (data && typeof data === 'object') for (const v of Object.values(data)) if (Array.isArray(v)) return v; return []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
