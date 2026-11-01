// Skill 9 — Public Shop Log for Travis Paul Consulting: a build-in-public changelog. Entries are PRIVATE until Travis says
// "publish"; the public page is generated locally (TPCL brand) and client names are scrubbed to generic phrases.
import fs from 'node:fs';
import path from 'node:path';
import { spokenList, plural } from '../../voice.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS shoplog_entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, tags TEXT, source TEXT,
     visibility TEXT NOT NULL DEFAULT 'private', public_title TEXT, public_body TEXT, published_at TEXT
   );`,
];

// Client/vendor names to scrub are NOT kept in the repo: add them to ~/.config/kitt/kitt.json → shoplog.redactions as [regexSource, replacement] pairs.
const DEFAULT_REDACTIONS = [];
const KINDS = { shipped: /^(shipped|released|launched|deployed|delivered)\b/i, building: /^(building|working on|started|prototyping|designing)\b/i, learned: /^(learned|learnt|lesson|insight|til)\b/i, talk: /^(talk|spoke|presented|webinar|podcast)\b/i, note: /.*/ };

export default function define(ctx) {
  const { db, config, paths, log } = ctx;
  const outDir = path.join(paths.dataDir, 'shoplog');
  const redactions = [...DEFAULT_REDACTIONS, ...((config.shoplog?.redactions || []).map(([a, b]) => [new RegExp(a, 'gi'), b]))];
  const scrub = (t) => { let s = String(t || ''); for (const [re, rep] of redactions) s = s.replace(re, rep); s = s.replace(/\bK\s?\d[\d,]*(\.\d+)?\b|\bZMW\s?\d[\d,]*/g, 'an undisclosed amount').replace(/\b\d{1,3}(\.\d+)?\s?%/g, 'a measurable share'); return s; };
  const classify = (t) => Object.entries(KINDS).find(([, re]) => re.test(t))?.[0] || 'note';

  function add(text, source) {
    const raw = String(text || '').trim(); if (!raw) return null;
    const kind = classify(raw); const title = raw.replace(/^(shipped|released|launched|deployed|delivered|building|working on|started|learned|learnt|lesson|talk|spoke|presented)[:\s-]*/i, '').split(/[.!?]/)[0].slice(0, 120);
    const r = db.prepare('INSERT INTO shoplog_entries(kind, title, body, source, public_title, public_body) VALUES (?, ?, ?, ?, ?, ?) RETURNING id').get(kind, title, raw, source || 'cli', scrub(title), scrub(raw));
    return db.prepare('SELECT * FROM shoplog_entries WHERE id = ?').get(r.id);
  }

  function render() {
    fs.mkdirSync(outDir, { recursive: true });
    const rows = db.prepare("SELECT * FROM shoplog_entries WHERE visibility = 'public' ORDER BY published_at DESC, id DESC").all();
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const item = (e) => `<article class="e"><div class="meta"><span class="kind ${e.kind}">${esc(e.kind)}</span><time>${esc((e.published_at || e.ts).slice(0, 10))}</time></div><h2>${esc(e.public_title)}</h2><p>${esc(e.public_body)}</p></article>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shop Log — Travis Paul Consulting</title><meta name="description" content="What Travis Paul Consulting is building and shipping, in public.">
<link rel="alternate" type="application/rss+xml" title="TPCL Shop Log" href="feed.xml"><style>
:root{--ink:#3A3A3A;--bg:#FFFFFF;--amber:#FFC107;--cyan:#00BCD4;--surface:#B8C5D6}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Poppins,-apple-system,Helvetica,Arial,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:40px 16px 80px}.accent{width:56px;height:14px;background:var(--amber);margin-bottom:18px}h1{font-weight:700;font-size:32px;margin:0 0 6px}.lede{margin:0 0 36px;color:#555}
.e{border-top:1px solid #e6e6e6;padding:22px 0}.meta{display:flex;gap:14px;align-items:center;font-size:13px;color:#666}.kind{font-weight:500;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;background:var(--surface);color:var(--ink)}.kind.shipped{background:var(--amber)}.kind.building{background:#eef2f6}
h2{font-size:20px;font-weight:500;margin:8px 0 6px}p{margin:0}footer{margin-top:48px;font-size:13px;color:#666}
@media (prefers-color-scheme:dark){:root{--bg:#3A3A3A;--ink:#FFFFFF;--surface:#4a4a4a}.accent{background:var(--cyan)}.kind.shipped{background:var(--cyan)}.e{border-color:#555}.lede,.meta,footer{color:#cfd6dd}}
</style></head><body><div class="wrap"><div class="accent"></div><h1>SHOP LOG</h1><p class="lede">What Travis Paul Consulting is building and shipping, logged from the road. Client names are generic by design.</p>
${rows.map(item).join('\n') || '<p>Nothing published yet.</p>'}
<footer>Travis Paul Consulting Limited · Lusaka · <a href="feed.xml">RSS</a></footer></div></body></html>`;
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>TPCL Shop Log</title><link>https://linktr.ee/tpconsulting.co</link><description>Build-in-public log of Travis Paul Consulting</description>${rows.map((e) => `<item><title>${esc(e.public_title)}</title><description>${esc(e.public_body)}</description><guid isPermaLink="false">shoplog-${e.id}</guid><pubDate>${new Date((e.published_at || e.ts).replace(' ', 'T') + 'Z').toUTCString()}</pubDate><category>${esc(e.kind)}</category></item>`).join('')}</channel></rss>`;
    fs.writeFileSync(path.join(outDir, 'feed.xml'), rss, 'utf8');
    fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(rows.map((e) => ({ id: e.id, date: (e.published_at || e.ts).slice(0, 10), kind: e.kind, title: e.public_title, body: e.public_body })), null, 2), 'utf8');
    return { dir: outDir, count: rows.length };
  }

  const recent = (days) => db.prepare("SELECT * FROM shoplog_entries WHERE ts >= datetime('now', ?) ORDER BY id DESC").all(`-${days} days`);

  return {
    id: 'shoplog', name: 'Shop Log', aliases: ['log'],
    description: 'a build-in-public log for TPCL: capture by voice, publish on confirmation, client names made generic',
    migrations: MIGRATIONS,
    intents: [
      { name: 'add', description: 'log a shop entry', examples: ['log: shipped version 1.4 of the demo'], patterns: ['(shop )?log(:| that| this)? {text}', 'log for the shop(:)? {text}', 'add to the shop log(:)? {text}'], slots: ['text'] },
      { name: 'publish', description: 'publish the latest private entry', examples: ['publish the last log entry'], patterns: ['publish (the )?(last|latest) (log )?entry', 'publish (that|it)', 'make (the )?(last|latest) entry public'], write: true },
      { name: 'week', description: 'what was logged this week', examples: ['what did I ship this week'], patterns: ['what did (i|we) (ship|log|build) this week', '(shop )?log (recap|summary|this week)', 'what have i (shipped|logged) (recently|this week)'] },
      { name: 'draft_post', description: 'draft a LinkedIn post from this week\'s public entries', examples: ['draft the weekly LinkedIn post'], patterns: ['draft (the |a )?(weekly )?linkedin post', 'write (the )?week in review post'] },
    ],
    routines: [{ name: 'shoplog.render', cron: '0 8 * * *', description: 'regenerate the public page files', run: async () => ({ summary: JSON.stringify(render()) }) }],
    async handle(intent, slots, c) {
      if (intent === 'add') { const e = add(slots.text, c.source); if (!e) return { speak: 'What should I log?' }; return { speak: `Logged as ${e.kind}: ${e.title}. It stays private until you say publish. Public version would read: ${e.public_title}.`, display: e }; }
      if (intent === 'publish') { const e = db.prepare("SELECT * FROM shoplog_entries WHERE visibility = 'private' ORDER BY id DESC LIMIT 1").get(); if (!e) return { speak: 'No private entries to publish.' }; return { speak: `Publish this entry publicly: ${e.public_body}?`, confirm: { summary: `publish shop log entry ${e.id}`, action: { type: 'publish', id: e.id } } }; }
      if (intent === 'week') { const rows = recent(7); return { speak: rows.length ? `${plural(rows.length, 'entry', 'entries')} this week: ${spokenList(rows.map((e) => `${e.kind}: ${e.title}`), { max: 6 })}. ${rows.filter((e) => e.visibility === 'private').length} still private.` : 'Nothing logged this week.', display: rows }; }
      if (intent === 'draft_post') { const rows = recent(7).filter((e) => e.visibility === 'public'); if (!rows.length) return { speak: 'No public entries this week to draft from.' }; const text = `This week at Travis Paul Consulting:\n${rows.map((e) => `• ${e.public_title}`).join('\n')}\n\nBuilding in public, one log entry at a time. #Zambia #Data #Consulting`; const f = path.join(outDir, `linkedin-draft-${new Date().toISOString().slice(0, 10)}.txt`); fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(f, text, 'utf8'); return { speak: `Draft saved with ${plural(rows.length, 'bullet')}. It is a draft file, not posted.`, display: { file: f, text } }; }
      return { speak: "I didn't catch which log action that was." };
    },
    async execute(action) { if (action.type === 'publish') { db.prepare("UPDATE shoplog_entries SET visibility = 'public', published_at = datetime('now') WHERE id = ?").run(action.id); const r = render(); return { speak: `Published. The page now has ${plural(r.count, 'public entry', 'public entries')}; files are in the KITT data folder, ready to deploy when you approve.` }; } return { speak: 'Unknown action.' }; },
    async brief({ kind }) { if (kind !== 'evening') return null; const t = recent(1); return t.length ? { speak: `Shop log: ${plural(t.length, 'entry', 'entries')} today.` } : null; },
    async view() { return { entries: recent(90), public_dir: outDir, public_count: db.prepare("SELECT count(*) n FROM shoplog_entries WHERE visibility = 'public'").get().n }; },
    async health() { return { ok: true, detail: `${db.prepare("SELECT count(*) n FROM shoplog_entries").get().n} entries, ${db.prepare("SELECT count(*) n FROM shoplog_entries WHERE visibility = 'public'").get().n} public; output ${outDir}` }; },
    async dashboard() { const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); const rows = recent(60); return `<p>Public page: <code>${esc(path.join(outDir, 'index.html'))}</code></p><table><tr><th>When</th><th>Kind</th><th>Title (private)</th><th>Public version</th><th>Visibility</th></tr>${rows.map((e) => `<tr><td>${esc(e.ts.slice(0, 10))}</td><td>${esc(e.kind)}</td><td>${esc(e.title)}</td><td>${esc(e.public_title)}</td><td>${esc(e.visibility)}</td></tr>`).join('')}</table>`; },
    _internal: { add, render, scrub, classify },
  };
}
